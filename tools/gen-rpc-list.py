#!/usr/bin/env python3
"""
从 C# 源码里抽出所有 RPC 方法名。

为什么要这么做：分发是 MainForm*.cs 里 227 条 `if (m == "xxx")` 和 switch 里的
`case "xxx":` 拼出来的，都是字符串字面量 —— 运行时反射扫不到，编译器也不管。
所以只能在源码层面捞，然后：
  1. 写进 MainForm.cs 的 RealRpcMethods 数组（供 RpcCatalog.SelfCheck 交叉校验）
  2. 生成 docs/接口清单.md（供人和 AI 查阅）

用法：  python tools/gen-rpc-list.py
"""
import re, io, glob, os, sys, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 这些是从「快捷键虚拟键码」那张表里误抓的，不是 RPC
NOT_RPC = {
    'space','tab','enter','esc','escape','left','right','up','down',
    'home','end','insert','delete','toggle','boss','backlinks','onthisday',
    'check.toggle','checks.for',
}

def balanced_block(s, open_idx):
    """从 open_idx 处的 { 开始，返回配平后的整块文本"""
    depth = 0
    i = open_idx
    while i < len(s):
        if s[i] == '{': depth += 1
        elif s[i] == '}':
            depth -= 1
            if depth == 0: return s[open_idx:i+1]
        i += 1
    return s[open_idx:]

def collect():
    names = set()
    for f in sorted(glob.glob(os.path.join(ROOT, 'MainForm*.cs'))):
        s = io.open(f, encoding='utf-8').read()
        # if (m == "xxx")
        names |= set(re.findall(r'if\s*\(\s*m\s*==\s*"([^"]+)"\s*\)', s))
        # 只取 switch (m) { ... } 块里的 case
        for mt in re.finditer(r'switch\s*\(\s*m\s*\)\s*\{', s):
            block = balanced_block(s, mt.end()-1)
            names |= set(re.findall(r'case\s+"([^"]+)"\s*:', block))
    return sorted(n for n in names if n and n not in NOT_RPC)

def write_array(names):
    """把方法名写进 MainForm.cs 的 RealRpcMethods"""
    path = os.path.join(ROOT, 'MainForm.cs')
    s = io.open(path, encoding='utf-8').read()

    # 每行 4 个，别让源码里出现一条 8000 字符的巨行
    lines = []
    for i in range(0, len(names), 4):
        chunk = ', '.join('"%s"' % n for n in names[i:i+4])
        lines.append('            ' + chunk + ',')
    body = '\n'.join(lines)

    new = re.sub(
        r'(public static readonly string\[\] RealRpcMethods = new string\[\]\s*\{)(.*?)(\};)',
        lambda m: m.group(1) + '\n            /* @@RPC_LIST_BEGIN@@ 由 tools/gen-rpc-list.py 自动生成，别手改 */\n'
                  + body + '\n            /* @@RPC_LIST_END@@ */\n            ' + m.group(3),
        s, flags=re.S)
    if new == s:
        # 两种可能，别混成一句话：
        #   a) 数组压根不在（正则没命中）—— 那是真出问题了
        #   b) 命中了但生成结果和现有内容一模一样 —— 这是正常的幂等，
        #      连跑两次就会走到这里（第一次已经写完）。旧版把 b 也报成 a，很吓人。
        if 'RealRpcMethods' not in s:
            print('!! 没找到 RealRpcMethods 数组，跳过写入'); return
        print('MainForm.cs 已是最新（%d 个方法），无需改写' % len(names)); return
    io.open(path, 'w', encoding='utf-8', newline='').write(new)
    print('已写入 MainForm.cs：%d 个方法' % len(names))

def write_md(names):
    docs = os.path.join(ROOT, 'docs')
    os.makedirs(docs, exist_ok=True)

    # 从 RpcCatalog.cs 里捞描述，做成一表（有这个信息文档才有用）
    cat = io.open(os.path.join(ROOT, 'RpcCatalog.cs'), encoding='utf-8').read()
    meta = {}
    for mt in re.finditer(r'M\("([^"]+)",\s*"([^"]*)",\s*"([^"]*)",\s*"([^"]*)",\s*(true|false)?', cat):
        meta[mt.group(1)] = dict(group=mt.group(2), desc=mt.group(3), args=mt.group(4),
                                 write=(mt.group(5) == 'true'))

    out = ['# 日签 RPC 接口清单', '',
           '> 本文件由 `tools/gen-rpc-list.py` 自动生成，**不要手改**。',
           '> 改完接口重跑一次脚本即可。', '',
           '共 **%d** 个方法。这些方法同时可用于：' % len(names), '',
           '- 前端页面（`web/src/api.ts` 调 `rpc()`）',
           '- AI 调试网关（`POST http://127.0.0.1:<port>/rpc`）', '',
           '## 按分组', '']

    groups = {}
    for n in names:
        g = meta.get(n, {}).get('group') or n.split('.')[0]
        groups.setdefault(g, []).append(n)

    for g in sorted(groups):
        out.append('### %s' % g)
        out.append('')
        out.append('| 方法 | 说明 | 参数 | 写 |')
        out.append('|---|---|---|---|')
        for n in sorted(groups[g]):
            m = meta.get(n, {})
            out.append('| `%s` | %s | `%s` | %s |' % (
                n, m.get('desc', ''), m.get('args', ''), '**是**' if m.get('write') else ''))
        out.append('')

    nocat = [n for n in names if n not in meta]
    if nocat:
        out += ['## 尚未登记进 RpcCatalog 的方法', '',
                '这些方法能用，但 AI 通过 `diag.methods` 看不到说明（清单漏更新）。', '']
        for n in nocat: out.append('- `%s`' % n)
        out.append('')

    io.open(os.path.join(docs, '接口清单.md'), 'w', encoding='utf-8', newline='').write('\n'.join(out))
    print('已写 docs/接口清单.md：%d 个方法，%d 个未登记' % (len(names), len(nocat)))

if __name__ == '__main__':
    ns = collect()
    if not ns:
        print('没抽到方法，检查路径'); sys.exit(1)
    write_array(ns)
    write_md(ns)
