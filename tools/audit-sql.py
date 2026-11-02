#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 C# 源码里的 SQL 抽出来，拿真实库结构 EXPLAIN 一遍。
SQLite 会直接报 "no such column / no such table"，比人肉核对可靠得多。

要点：
  · 参数占位符（$x / @x / :x / ?）统一换成 NULL，这样不用绑定就能解析
  · C# 插值洞 {xxx} 换成 1=1（这些位置通常拼的是条件片段）
  · 只 EXPLAIN，不执行 —— 不会改任何数据
"""
import re, sqlite3, sys, os

DB = sys.argv[1] if len(sys.argv) > 1 else 'riqian.db'
ROOT = sys.argv[2] if len(sys.argv) > 2 else '.'

c = sqlite3.connect(DB)
tables = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
tables.add('sqlite_sequence')

# 抽 C# 里的字符串字面量（逐字串 @"..." 和普通串 "..."）
PAT_VERBATIM = re.compile(r'@"((?:[^"]|"")*)"', re.S)
PAT_NORMAL = re.compile(r'(?<!@)"((?:[^"\\\n]|\\.)*)"')

SQL_START = re.compile(r'^\s*(SELECT|INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|PRAGMA|WITH|BEGIN|COMMIT|ROLLBACK)\b', re.I)

def normalize(sql):
    s = sql.replace('""', '"')
    s = re.sub(r'\{[^{}]*\}', '1=1', s)              # C# 插值洞
    s = re.sub(r'[$@:][A-Za-z_][A-Za-z0-9_]*', 'NULL', s)   # 命名参数
    s = s.replace('?', 'NULL')
    return s.strip()

def check(sql):
    """返回错误文本，None 表示能解析"""
    s = normalize(sql)
    if not s or not SQL_START.match(s):
        return None
    # 多语句：取第一段足够（UNION/CTE 里没有分号）
    s = s.split(';')[0].strip()
    if not s:
        return None
    try:
        c.execute('EXPLAIN ' + s)
        return None
    except sqlite3.Error as e:
        msg = str(e)
        # 表不存在只在「代码里的临时表 / 迁移中间表」出现，单独归类
        return msg

files = sorted(f for f in os.listdir(ROOT) if f.endswith('.cs'))
problems = {'no column': [], 'no table': [], 'other': [], 'syntax': []}
checked = 0

for fn in files:
    src = open(os.path.join(ROOT, fn), encoding='utf-8', errors='ignore').read()
    lines = src.split('\n')
    for pat in (PAT_VERBATIM, PAT_NORMAL):
        for m in pat.finditer(src):
            sql = m.group(1)
            # 快速过滤：看起来不像 SQL 就跳过，省时间
            if not SQL_START.match(normalize(sql) or ''):
                continue
            line_no = src[:m.start()].count('\n') + 1
            err = check(sql)
            checked += 1
            if err is None:
                continue
            low = err.lower()
            item = '%s:%d  %s' % (fn, line_no, err)
            if 'no such column' in low:
                problems['no column'].append(item)
            elif 'no such table' in low:
                problems['no table'].append(item)
            elif 'syntax error' in low or 'incomplete input' in low:
                problems['syntax'].append(item)
            else:
                problems['other'].append(item)

print('库: %s（%d 张表）' % (DB, len(tables) - 1))
print('扫了 %d 条 SQL\n' % checked)

for k, title in [
    ('no column', '❌ 列不存在（代码写了、库里没有 —— 一跑就报错）'),
    ('no table',  '⚠️ 表不存在（多半是迁移中间表 / 代码里先建后用）'),
    ('syntax',    '⚠️ 语法解析失败（可能是抽取时被截断，需人工看）'),
    ('other',     '其它'),
]:
    print('=' * 72)
    print(title + '  共 %d 条' % len(problems[k]))
    print('=' * 72)
    if not problems[k]:
        print('  无')
    else:
        # 相同错误合并显示
        seen = {}
        for it in problems[k]:
            key = it.split('  ', 1)[-1]
            seen.setdefault(key, []).append(it.split('  ')[0])
        for key in sorted(seen):
            locs = seen[key]
            print('  %s' % key)
            print('      出现在: %s' % ', '.join(locs[:6]) + (' …等 %d 处' % len(locs) if len(locs) > 6 else ''))
    print()