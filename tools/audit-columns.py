#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 C# 代码里引用到的「列名」和真实数据库结构对照，找出不存在的列。

覆盖面有限但很值：
  ① Str(r["xxx"]) / Int(r["xxx"]) 这类行字典读取 —— 表不确定，只能查「这个列名在**任何**表里都不存在」
  ② SQL 字符串里的 INSERT INTO t(...) 列清单 / WHERE x= / SET x= —— 能定位到具体表

重点不是零误报，而是把「代码写了、库里没有」这种一跑就炸的问题挑出来。
"""
import re, sqlite3, sys, os, collections

DB = 'riqian.db'
ROOT = sys.argv[1] if len(sys.argv) > 1 else '.'

c = sqlite3.connect(DB)
tables = {r[0]: [x[1] for x in c.execute('PRAGMA table_info(%s)' % r[0])]
          for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
all_cols = set()
for cols in tables.values():
    all_cols.update(x.lower() for x in cols)

# SQL 关键字 / 函数名，不当作列
KEYWORDS = set('''
select from where and or not null is in like glob between case when then else end as
order by group having limit offset asc desc distinct union all insert into values update
set delete create table index if exists primary key foreign references default unique
join left right inner outer on using count sum avg min max ifnull nullif coalesce
substr length lower upper trim replace cast integer text real blob date datetime
true false begin commit rollback autoreplace ignore abort
'''.split())

files = [f for f in os.listdir(ROOT) if f.endswith('.cs')]
print('扫描 %d 个 C# 文件\n' % len(files))

# ---------- ① 行字典读取：Str(r["xxx"]) ----------
rowread = collections.defaultdict(set)   # col -> {file:line}
pat_row = re.compile(r'(?:Str|Int|Long|Double)\(\s*\w+\[\s*"([A-Za-z_][A-Za-z0-9_]*)"\s*\]\s*\)')
for fn in files:
    with open(os.path.join(ROOT, fn), encoding='utf-8', errors='ignore') as fh:
        for ln, line in enumerate(fh, 1):
            for m in pat_row.finditer(line):
                rowread[m.group(1).lower()].add('%s:%d' % (fn, ln))

missing_row = {k: v for k, v in rowread.items() if k not in all_cols}
print('=' * 70)
print('① 行字典读取：引用了「任何表里都没有」的列名')
print('=' * 70)
if not missing_row:
    print('  无')
for k in sorted(missing_row):
    print('  ❌ %-20s %s' % (k, ', '.join(sorted(missing_row[k]))))

# ---------- ② SQL 里 INSERT INTO t(...) 的列清单 ----------
print()
print('=' * 70)
print('② SQL INSERT 的列清单与真实表结构不符')
print('=' * 70)
pat_ins = re.compile(r'INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(\w+)\s*\(([^)]*)\)', re.I | re.S)
bad_ins = []
for fn in files:
    src = open(os.path.join(ROOT, fn), encoding='utf-8', errors='ignore').read()
    for m in pat_ins.finditer(src):
        t = m.group(1)
        if t not in tables:
            continue
        cols = [x.strip().lower() for x in m.group(2).split(',') if x.strip()]
        absent = [x for x in cols if x not in [y.lower() for y in tables[t]]]
        if absent:
            line = src[:m.start()].count('\n') + 1
            bad_ins.append((fn, line, t, absent))
if not bad_ins:
    print('  无')
for fn, ln, t, absent in bad_ins:
    print('  ❌ %s:%d  表 %s 缺列 %s' % (fn, ln, t, absent))

# ---------- ③ UPDATE t SET col= 的列 ----------
print()
print('=' * 70)
print('③ SQL UPDATE SET 里用到、但表里没有的列')
print('=' * 70)
pat_upd = re.compile(r'UPDATE\s+(\w+)\s+SET\s+([^;]*?)(?:WHERE|$)', re.I | re.S)
bad_upd = []
for fn in files:
    src = open(os.path.join(ROOT, fn), encoding='utf-8', errors='ignore').read()
    for m in pat_upd.finditer(src):
        t = m.group(1)
        if t not in tables:
            continue
        body = m.group(2)
        tcols = [y.lower() for y in tables[t]]
        # 只取 `col=` 形式（排除 col=col+1 这类也照样算 col）
        for cm in re.finditer(r'(?:^|,)\s*([A-Za-z_][A-Za-z0-9_]*)\s*=', body):
            col = cm.group(1).lower()
            if col in KEYWORDS:
                continue
            if col not in tcols:
                line = src[:m.start()].count('\n') + 1
                bad_upd.append((fn, line, t, col))
if not bad_upd:
    print('  无')
seen = set()
for fn, ln, t, col in bad_upd:
    k = (fn, t, col)
    if k in seen:
        continue
    seen.add(k)
    print('  ❌ %s:%d  UPDATE %s SET %s —— 表里没有 %s' % (fn, ln, t, col, col))