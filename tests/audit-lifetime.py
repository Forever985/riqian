#!/usr/bin/env python3
"""
生命周期审计：找出「短命对象被长寿的东西继续访问」这一类 bug。

为什么要有这个脚本
------------------
2026-11-02 / 11-09 / 11-10 三次界面线程崩溃，堆栈一模一样：

    ObjectDisposedException: 'Riqian.ToastForm'
      at Form.set_Opacity(...)
      at ToastForm.<.ctor>b__16_1(...)   ← 淡入淡出的 Timer 还在跳

根因不是「写错了一行」，而是**一个模式**：
`System.Windows.Forms.Timer` 不会因为宿主窗体被 Dispose 而自动停
（它有自己隐藏的窗口），于是窗体没了、定时器还在按 16ms 打，
tick 里一碰控件就抛。

这类 bug 的共同点是「生命周期不匹配」，它有很多张脸：

    ① 定时器比宿主活得久        ← 本次踩的
    ② 静态委托持有已释放窗体    ← Host.* / RpcDispatcher.*
    ③ 后台任务 await 之后碰控件
    ④ 原生句柄（HICON/GDI）没释放
    ⑤ 事后访问已关闭的窗体（先判 IsDisposed 就没事）

这个脚本把 ① 和 ④ 做成机械检查 —— 因为这两条**能静态判定**。
②③⑤ 需要人看，但脚本会把可疑点列出来当索引。

用法
----
    python tests/audit-lifetime.py            # 扫仓库根
    python tests/audit-lifetime.py <目录>      # 扫指定目录（用于反向验证）
退出码 0 = 干净，1 = 有问题（可以挂到 CI 上）
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = sys.argv[1] if len(sys.argv) > 1 else ROOT


def read(path):
    for enc in ('utf-8-sig', 'utf-8', 'gbk'):
        try:
            with open(path, encoding=enc) as f:
                return f.read()
        except (UnicodeDecodeError, LookupError):
            continue
    return ''


def strip_comments_and_strings(src):
    """
    去掉注释和字符串字面量。

    必须去 —— 否则注释里出现的 "new Timer" 会被当成真代码，
    而这个项目的注释写得比代码还多，误报会淹掉真问题。
    """
    out = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c == '/' and i + 1 < n and src[i + 1] == '/':
            while i < n and src[i] != '\n':
                i += 1
        elif c == '/' and i + 1 < n and src[i + 1] == '*':
            i += 2
            while i + 1 < n and not (src[i] == '*' and src[i + 1] == '/'):
                i += 1
            i += 2
        elif c == '"':
            # 逐字字符串 @"..." 与普通字符串都按「跳到匹配的引号」处理
            verbatim = i > 0 and src[i - 1] == '@'
            i += 1
            while i < n:
                if not verbatim and src[i] == '\\':
                    i += 2
                    continue
                if src[i] == '"':
                    if verbatim and i + 1 < n and src[i + 1] == '"':
                        i += 2
                        continue
                    i += 1
                    break
                i += 1
        elif c == "'":
            i += 1
            while i < n:
                if src[i] == '\\':
                    i += 2
                    continue
                if src[i] == "'":
                    i += 1
                    break
                i += 1
        else:
            out.append(c)
            i += 1
    return ''.join(out)


def class_blocks(src):
    """找 class X ... { ... } 的块，返回 (类名, 基类, 起始偏移, 块文本, 行号)。"""
    res = []
    for m in re.finditer(r'\bclass\s+([A-Za-z_]\w*)\s*(?::\s*([A-Za-z_][\w.]*))?[^{;]*\{', src):
        name, base = m.group(1), m.group(2) or ''
        start = m.end() - 1
        depth = 0
        i = start
        while i < len(src):
            if src[i] == '{':
                depth += 1
            elif src[i] == '}':
                depth -= 1
                if depth == 0:
                    break
            i += 1
        line = src.count('\n', 0, m.start()) + 1
        res.append((name, base, m.start(), src[start:i + 1], line))
    return res


def find_timer_fields(body):
    """
    找定时器字段名：`private readonly Timer _fade = new ...`
    也认 `_t = new System.Windows.Forms.Timer { ... }`。
    """
    names = set()
    for m in re.finditer(
            r'([A-Za-z_]\w*)\s*=\s*new\s+(?:System\.Windows\.Forms\.)?(?:Forms\.)?Timer\b', body):
        names.add(m.group(1))
    for m in re.finditer(
            r'\b(?:private|internal|protected|public)[\w\s]*?\b([A-Za-z_]\w*)\s*=\s*new\s+'
            r'(?:System\.Windows\.Forms\.)?(?:Forms\.)?Timer\b', body):
        names.add(m.group(1))
    return names


def stops_timer(body, name):
    """有这个定时器的 Stop/Dispose 调用吗（不算 tick 里那种顺手 stop）。"""
    if re.search(r'\b%s\s*\.\s*(Stop|Dispose)\s*\(' % re.escape(name), body):
        # 只要出现过就算 —— 但必须是在 Dispose/OnFormClosing/OnFormClosed 里，
        # 否则"淡出完自己 Stop"这种不算（那正是 ToastForm 原本的写法）。
        for hook in ('Dispose', 'OnFormClosing', 'OnFormClosed'):
            for m in re.finditer(r'\b(?:override\s+\w+\s+)?%s\s*\(' % hook, body):
                seg = body[m.start():m.start() + 2500]
                if re.search(r'\b%s\s*\.\s*(Stop|Dispose)\s*\(' % re.escape(name), seg):
                    return True
        return False
    return False


def main():
    problems = []
    suspects = []
    scanned = 0

    for dirpath, dirnames, filenames in os.walk(TARGET):
        dirnames[:] = [d for d in dirnames
                       if d not in ('android', 'bin', 'obj', 'node_modules', '.git', 'releases')]
        for fn in filenames:
            if not fn.endswith('.cs'):
                continue
            path = os.path.join(dirpath, fn)
            raw = read(path)
            if not raw:
                continue
            scanned += 1
            src = strip_comments_and_strings(raw)

            for name, base, _, body, line in class_blocks(src):
                if base != 'Form':
                    continue

                # 规则①：窗体里的定时器必须有人停
                for t in find_timer_fields(body):
                    if not stops_timer(body, t):
                        problems.append(
                            (path, line, f'{name} 里的定时器 {t} 没有在 Dispose/OnFormClosing 里停掉'))

                # 规则②：HICON 必须 DestroyIcon
                if 'Icon.FromHandle' in body and 'DestroyIcon' not in body:
                    problems.append((path, line, f'{name} 用了 Icon.FromHandle 但没 DestroyIcon'))

            # 规则③（只提示，不判错）：静态委托注册后有没有摘
            if re.search(r':\s*Form\b', src) and re.search(r'(Host|RpcDispatcher)\.\w+Fn\s*=', src):
                if 'DetachGlobals' not in src and '= null' not in src:
                    suspects.append((path, '注册了静态委托，但没看到摘除'))

    print('=' * 66)
    print('  生命周期审计 —— 「短命对象被长寿的东西继续访问」')
    print('=' * 66)
    print(f'\n扫描 {scanned} 个 .cs 文件\n')

    if problems:
        print(f'✗ {len(problems)} 处问题：\n')
        for path, line, msg in problems:
            print(f'  {os.path.relpath(path, TARGET)}:{line}')
            print(f'     {msg}\n')
    else:
        print('✓ 定时器 / 原生句柄：没有发现「宿主没了它还在跑」的情况\n')

    if suspects:
        print(f'（另有 {len(suspects)} 处需要人看，不判错）：')
        for path, msg in suspects:
            print(f'  {os.path.relpath(path, TARGET)} — {msg}')
        print()

    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
