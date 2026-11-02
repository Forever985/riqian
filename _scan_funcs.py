# -*- coding: utf-8 -*-
"""扫描超长函数。只读分析，不改代码。

C#：匹配「访问修饰符 + 返回类型 + 名字(参数)」+ 后续大括号块
TS：匹配 function 声明、const x = (...) => {、export function
"""
import os, re, io, sys, json

ROOT = r'C:/Users/18405/WorkBuddy/2026-10-28-10-51-20/riqian4'
SKIP_DIRS = {'node_modules', 'bin', 'obj', 'bin_check', 'obj_check', '.git', 'dist', 'wwwroot', 'tests'}


def walk(d, exts):
    out = []
    for base, dirs, files in os.walk(d):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
        for f in files:
            if f.endswith(exts):
                out.append(os.path.join(base, f))
    return out


def brace_end(lines, start_idx):
    """从 start_idx 行开始找配对大括号的结束行。跳过字符串/注释里的括号（粗略但够用）。"""
    depth = 0
    started = False
    in_block = False
    for i in range(start_idx, len(lines)):
        line = lines[i]
        j = 0
        while j < len(line):
            ch = line[j]
            nxt = line[j + 1] if j + 1 < len(line) else ''
            if in_block:
                if ch == '*' and nxt == '/':
                    in_block = False; j += 2; continue
                j += 1; continue
            if ch == '/' and nxt == '*':
                in_block = True; j += 2; continue
            if ch == '/' and nxt == '/':
                break
            if ch == '"' or ch == "'":
                q = ch; j += 1
                while j < len(line):
                    if line[j] == '\\': j += 2; continue
                    if line[j] == q: break
                    j += 1
                j += 1; continue
            if ch == '{':
                depth += 1; started = True
            elif ch == '}':
                depth -= 1
                if started and depth == 0:
                    return i
            j += 1
    return None


CS_SIG = re.compile(
    r'^\s*(?:public|private|protected|internal|static|async|override|virtual|sealed|partial|new|unsafe|extern|readonly|\s)+'
    r'[\w<>\[\],\.\?\s]+?\s+(\w+)\s*\([^;]*$'
)


def scan_cs(path):
    lines = io.open(path, encoding='utf-8', errors='replace').read().split('\n')
    out = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if '(' in line and not line.strip().startswith('//') and '=>' not in line:
            m = CS_SIG.match(line)
            if m:
                name = m.group(1)
                if name not in ('if', 'for', 'while', 'switch', 'catch', 'using', 'lock', 'return', 'new'):
                    end = brace_end(lines, i)
                    if end is not None:
                        n = end - i + 1
                        if n >= 60:
                            out.append({'file': os.path.basename(path), 'name': name, 'line': i + 1, 'len': n,
                                        'kind': 'cs'})
                        i = end + 1
                        continue
        i += 1
    return out


TS_PATTERNS = [
    re.compile(r'^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*[<(]'),
    re.compile(r'^\s*(?:export\s+)?const\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s*)?\([^)]*\)\s*(?::[^=]+)?=>\s*\{?\s*$'),
    re.compile(r'^\s*(?:export\s+)?const\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s*)?\w+\s*=>\s*\{?\s*$'),
]


def scan_ts(path):
    lines = io.open(path, encoding='utf-8', errors='replace').read().split('\n')
    out = []
    i = 0
    while i < len(lines):
        line = lines[i]
        name = None
        for pat in TS_PATTERNS:
            m = pat.match(line)
            if m:
                name = m.group(1); break
        if name:
            # 声明可能跨多行（参数换行），往后找第一个 '{'
            k = i
            end = None
            while k < min(i + 6, len(lines)):
                if '{' in lines[k]:
                    end = brace_end(lines, k); break
                if lines[k].rstrip().endswith(';'):
                    break
                k += 1
            if end is not None:
                n = end - i + 1
                if n >= 60:
                    out.append({'file': os.path.relpath(path, ROOT).replace('\\', '/'),
                                'name': name, 'line': i + 1, 'len': n, 'kind': 'ts'})
                i = end + 1
                continue
        i += 1
    return out


def main():
    allf = []
    for p in walk(ROOT, ('.cs',)):
        allf += scan_cs(p)
    for p in walk(os.path.join(ROOT, 'web', 'src'), ('.ts', '.tsx')):
        allf += scan_ts(p)
    allf.sort(key=lambda x: -x['len'])
    print('超长函数（>=60 行）共 %d 个\n' % len(allf))
    print('%-8s %-30s %-42s %5s %6s' % ('长度', '函数名', '文件', '行号', '类型'))
    print('-' * 100)
    for f in allf[:45]:
        print('%-8d %-30s %-42s %5d %6s' % (f['len'], f['name'][:30], f['file'][-42:], f['line'], f['kind']))
    # 按长度分桶
    buckets = {'>=300': 0, '200-299': 0, '120-199': 0, '60-119': 0}
    for f in allf:
        if f['len'] >= 300: buckets['>=300'] += 1
        elif f['len'] >= 200: buckets['200-299'] += 1
        elif f['len'] >= 120: buckets['120-199'] += 1
        else: buckets['60-119'] += 1
    print('\n分布:', json.dumps(buckets, ensure_ascii=False))
    io.open(os.path.join(ROOT, 'docs', '_func_scan.json'), 'w', encoding='utf-8').write(
        json.dumps(allf, ensure_ascii=False, indent=1))


main()