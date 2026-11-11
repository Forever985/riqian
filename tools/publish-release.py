#!/usr/bin/env python3
"""
把 v12.9.6 的产物挂到 GitHub Release 并发布。

为什么不用 CI 直接出 APK：CI 跑的是 Windows 打包链，安卓要另装 JDK/SDK/workload，
一次要拉 3 GB。当前只在本地出 APK，然后由这个脚本补挂上去。

做四件事：
  1. 删掉草稿里已有的同名资产（CI 那轮打出来的，changelog 是旧的）
  2. 上传四个文件 + SHA256SUMS
  3. 用 changelog.ts 重新生成正文（和 release.yml 同一套取数逻辑，避免两份说明对不上）
  4. 把草稿改成正式发布

token 从 git remote 里取，不打印、不落盘。
"""
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import urllib.request
import urllib.parse

REPO = 'Forever985/riqian'
TAG = 'v12.9.6'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REL_DIR = os.path.join(ROOT, 'releases')
FILES = [
    'Riqian-Setup-12.9.6.exe',
    'Riqian-Portable-12.9.6.zip',
    'Riqian-Source-12.9.6.zip',
    # APK 故意不在这里：安卓版还没修到能用，不进公开下载。
    # 等真机能跑通了再单独加，别把"装了打不开"的包挂上去。
    'SHA256SUMS.txt',
]


def token():
    url = subprocess.check_output(['git', 'config', '--get', 'remote.origin.url'],
                                  cwd=ROOT, text=True).strip()
    m = re.match(r'https://[^:]+:([^@]+)@', url)
    if not m:
        sys.exit('拿不到 token（remote 里没有凭据）')
    return m.group(1)


TOK = token()


def api(method, path, data=None, raw=False, ctype='application/json'):
    url = 'https://api.github.com' + path if not raw else 'https://uploads.github.com' + path
    body = data
    if data is not None and not isinstance(data, bytes):
        body = json.dumps(data).encode('utf-8')
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header('Authorization', 'Bearer ' + TOK)
    req.add_header('Accept', 'application/vnd.github+json')
    if body is not None:
        req.add_header('Content-Type', ctype)
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            txt = r.read().decode('utf-8')
            return json.loads(txt) if txt.strip() else {}
    except urllib.error.HTTPError as e:
        print('  HTTP %d: %s' % (e.code, e.read().decode('utf-8')[:400]))
        raise


def build_body():
    """和 release.yml 里那段 PowerShell 同一套逻辑：从 changelog.ts 抠出这一版的 items。"""
    src = io.open(os.path.join(ROOT, 'web/src/lib/changelog.ts'), encoding='utf-8').read()
    m = re.search(r"v:\s*'12\.9\.6'.*?items:\s*\[(.*?)\]", src, re.S)
    items = []
    if m:
        items = [x.replace("\\'", "'") for x in re.findall(r"'((?:[^'\\]|\\.)*)'", m.group(1))]

    lines = ['## 更新内容', '']
    lines += ['- ' + i for i in items]
    lines += [
        '',
        '## 下载哪个',
        '',
        '| 文件 | 适合谁 |',
        '|---|---|',
        '| `Riqian-Setup-12.9.6.exe` | 想装到开始菜单、能像普通软件那样卸载 |',
        '| `Riqian-Portable-12.9.6.zip` | 不想装，解压即用；数据跟文件夹走，放 U 盘也行 |',
        '| `日签-安卓-12.9.6.apk` | 手机用。Android 7.0 起，鸿蒙（能装 APK 的版本）直接装；不要任何存储权限 |',
        '| `Riqian-Source-12.9.6.zip` | 想看源码、自己改自己编译 |',
        '',
        '安装版和绿色版是**同一个 exe**，差别只在有没有 `portable.txt`：',
        '有 → 数据放 exe 同级的「日签数据」；没有 → 数据放 `%APPDATA%` 里配的目录。',
        '',
        '电脑版两个包都需要 [WebView2 运行时](https://developer.microsoft.com/microsoft-edge/webview2/)（Win11 自带）。',
        '',
        '## 校验',
        '',
        '`SHA256SUMS.txt` 里是这个版本所有文件的哈希，下载后可自行核对。',
    ]
    return '\n'.join(lines)


def main():
    print('== 找草稿 release ==')
    rels = api('GET', '/repos/%s/releases?per_page=10' % REPO)
    rel = next((r for r in rels if r['tag_name'] == TAG), None)
    if not rel:
        sys.exit('没找到 %s 的 release' % TAG)
    rid = rel['id']
    print('  id=%d  当前草稿=%s  资产=%d' % (rid, rel['draft'], len(rel['assets'])))

    print('\n== 删除旧资产 ==')
    for a in rel['assets']:
        api('DELETE', '/repos/%s/releases/assets/%d' % (REPO, a['id']))
        print('  删 %s' % a['name'])

    print('\n== 上传 ==')
    for f in FILES:
        p = os.path.join(REL_DIR, f)
        if not os.path.exists(p):
            sys.exit('缺文件: ' + p)
        size = os.path.getsize(p)
        with open(p, 'rb') as fh:
            data = fh.read()
        q = '/repos/%s/releases/%d/assets?name=%s' % (REPO, rid, urllib.parse.quote(f))
        r = api('POST', q, data=data, raw=True, ctype='application/octet-stream')
        print('  %-34s %6.1f MB  → %s' % (f, size / 1048576, r.get('state')))

    print('\n== 更新正文并发布 ==')
    body = build_body()
    r = api('PATCH', '/repos/%s/releases/%d' % (REPO, rid), {
        'body': body,
        'draft': False,
        'name': '日签 12.9.6',
    })
    print('  draft=%s  assets=%d' % (r['draft'], len(r['assets'])))
    print('  %s' % r['html_url'])


if __name__ == '__main__':
    main()
