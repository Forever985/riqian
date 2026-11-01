#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
重新生成 web/src/lib/pinyinData.ts（第 148 条拼音搜索用的汉字 → 拼音表）。

为什么需要这个脚本
------------------
web/src/lib/pinyinData.ts 里那张表是**手工维护的**，只覆盖设置页文案里出现过的字。
设置页将来加了新的中文，表里查不到的字会回落到「按原字匹配」——搜索不会坏，
但拼音搜不出来。改完文案跑一次本脚本即可补齐。

用法
----
    python tests/gen-pinyin.py --check     # 只报告缺哪些字，不写文件（推荐先跑这个）
    python tests/gen-pinyin.py            # 补齐新字并写回 pinyinData.ts
    python tests/gen-pinyin.py --refresh  # 连已有读音一起重算

    python tests/gen-pinyin.py --src web/src/views/Settings.tsx ...   # 换扫描范围

读音从哪来
----------
1. 优先用 pypinyin（`pip install pypinyin`）——它对单字给的默认读音最贴日常用法。
2. 装不上时**回落到 Windows 自带的单字拼音表**
   `C:\\Windows\\System32\\chs_singlechar_pinyin.dat`：20955 条 8 字节定长记录，
   小端 uint16 码位 + 6 字节 ASCII 拼音。
   ⚠️ 这张表给的是**字库默认读音**，多音字经常给成生僻那个（度→du、番→pan、且→ju、
   似→shi、弄→long、壳→qiao）。所以下面有一张 OVERRIDES 手工校正表。
   只拿它补缺字，已有条目一律不动，避免把人工校准过的读音改坏。
3. 都没有就直接报错退出，不瞎猜。

行为约定
--------
* **默认合并，不覆盖已有读音。** 多音字该读哪个取决于上下文，人工定的优先级高于机器。
  要重算得显式 --refresh。
* 键按 Unicode 码位排序输出，跟现有文件一致，diff 才不会满屏都是。
* 只扫 `--src` 给出的文件里出现的汉字，不生成全字表
  （理由见 pinyinData.ts 顶部注释：为了一个搜索框不值当几百 KB）。

依赖
----
    pip install pypinyin        # 可选，装不上也能跑（用系统表）
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "web" / "src" / "lib" / "pinyinData.ts"

# 默认扫描范围：设置页的全部文案都在这里
DEFAULT_SRC = [
    ROOT / "web" / "src" / "views" / "Settings.tsx",
    ROOT / "web" / "src" / "views" / "SettingsV8.tsx",
]

# Windows 自带单字拼音表（回落源）
WIN_PINYIN_DAT = Path("C:/Windows/System32/chs_singlechar_pinyin.dat")

# 一行放几项，照现有文件排版定的，纯为了 diff 好读
PER_LINE = 8

ENTRY_RE = re.compile(r"'([^'])'\s*:\s*'([^']*)'")

# 会被渲染 / 可被搜索的属性字符串：label="…" sub="…" kw="…"
# 也覆盖 JSX 里用模板串或单引号的情况
ATTR_RE = re.compile(
    r'(?:label|sub|kw)\s*=\s*(?:"([^"]*)"|\{`([^`]*)`\}|\{\'([^\']*)\'\})'
)

# 多音字校正：字 → 设置页语境下该读的音。
# 系统词典给的是字库默认读音，下面这些给错了，会让「搜 qie 找不到而且」这类情况发生。
OVERRIDES: dict[str, str] = {
    "且": "qie",   # 系统给 ju（狂且），日常是 qie
    "似": "si",    # 系统给 shi（似的），日常是 si
    "弄": "nong",  # 系统给 long（弄堂），日常是 nong
    "壳": "ke",    # 系统给 qiao（地壳），界面里是「外壳」
    "度": "du",    # 系统给 duo（忖度）
    "番": "fan",   # 系统给 pan（番禺）
    "谁": "shui",  # 系统给 shei（口语），输 shui 的人更多
}


def is_han(ch: str) -> bool:
    return "\u4e00" <= ch <= "\u9fff"


def read_text(p: Path) -> str:
    for enc in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return p.read_text(encoding=enc)
        except UnicodeDecodeError:
            continue
    raise SystemExit(f"读不出这个文件的编码：{p}")


def parse_existing(src: str) -> dict[str, str]:
    i = src.find("export const PINYIN")
    if i < 0:
        return {}
    return {k: v for k, v in ENTRY_RE.findall(src[i:])}


def split_header(src: str) -> str:
    """保留 `export const PINYIN` 之前的所有内容（含顶部注释），原样写回。"""
    i = src.find("export const PINYIN")
    if i < 0:
        raise SystemExit("pinyinData.ts 里找不到 'export const PINYIN'，文件被改过？")
    return src[:i]


def collect_chars(paths: list[Path], whole_file: bool = False) -> tuple[set[str], dict[str, int]]:
    """扫出会被渲染的汉字。

    ⚠️ 默认**只扫属性字符串**（label / sub / kw），不扫整个文件。
    这个默认值是被一次错误结论换来的：第一版按全文扫，报「缺 126 字」，
    结果那 126 个字全部来自 JS 注释（`// 避免把答案弄丢` 之类）——注释不渲染，
    永远搜不到，为它补表纯属白干。
    真的要看全文（比如排查），用 --all。
    """
    seen: set[str] = set()
    per_file: dict[str, int] = {}
    for p in paths:
        if not p.exists():
            print(f"  ! 跳过不存在的文件：{p}", file=sys.stderr)
            continue
        text = read_text(p)
        if whole_file:
            chars = {c for c in text if is_han(c)}
        else:
            chars = set()
            for m in ATTR_RE.finditer(text):
                txt = m.group(1) or m.group(2) or m.group(3) or ""
                chars |= {c for c in txt if is_han(c)}
        per_file[p.name] = len(chars)
        seen |= chars
    return seen, per_file


def load_pypinyin():
    try:
        from pypinyin import Style, lazy_pinyin
        return Style, lazy_pinyin
    except ImportError:
        return None


def load_win_tab() -> dict[int, str]:
    """解析 Windows 单字拼音表：20955 条 × 8 字节。"""
    if not WIN_PINYIN_DAT.exists():
        return {}
    import struct

    d = WIN_PINYIN_DAT.read_bytes()
    tab: dict[int, str] = {}
    for i in range(len(d) // 8):
        cp = struct.unpack_from("<H", d, i * 8)[0]
        py = d[i * 8 + 2 : i * 8 + 8].split(b"\x00")[0].decode("ascii", "ignore").lower()
        py = re.sub(r"[^a-z]", "", py)
        if py:
            tab[cp] = py
    return tab


def to_pinyin(chars: set[str]) -> tuple[dict[str, str], str]:
    """返回 (字→拼音, 用了哪个源)。"""
    out: dict[str, str] = {}
    src_name = ""

    pp = load_pypinyin()
    if pp:
        Style, lazy_pinyin = pp
        src_name = "pypinyin"
        bad: list[str] = []
        for ch in sorted(chars):
            s = "".join(lazy_pinyin(ch, style=Style.NORMAL, errors="ignore")).strip().lower()
            s = re.sub(r"[^a-z]", "", s)
            if s:
                out[ch] = s
            else:
                bad.append(ch)
        if bad:
            print(f"  ! pypinyin 没给出读音，已跳过：{''.join(bad)}", file=sys.stderr)
    else:
        tab = load_win_tab()
        if not tab:
            raise SystemExit(
                "没有可用的拼音源。二选一：\n"
                "  pip install pypinyin\n"
                "  或确认存在 C:\\Windows\\System32\\chs_singlechar_pinyin.dat"
            )
        src_name = f"系统表 {WIN_PINYIN_DAT.name}（{len(tab)} 条）"
        bad = []
        for ch in sorted(chars):
            py = tab.get(ord(ch))
            if py:
                out[ch] = py
            else:
                bad.append(ch)
        if bad:
            print(f"  ! 系统表里没有这些字，已跳过：{''.join(bad)}", file=sys.stderr)

    # 校正多音字
    fixed = {k: v for k, v in OVERRIDES.items() if k in out and out[k] != v}
    for k, v in fixed.items():
        out[k] = v
    if fixed and src_name != "pypinyin":
        print(f"  · 校正 {len(fixed)} 个多音字：" + "、".join(f"{k}→{v}" for k, v in fixed.items()))

    return out, src_name


def render(header: str, table: dict[str, str]) -> str:
    keys = sorted(table)  # Unicode 码位序，跟现有文件一致
    lines: list[str] = []
    for i in range(0, len(keys), PER_LINE):
        chunk = keys[i : i + PER_LINE]
        lines.append("  " + ", ".join(f"'{k}':'{table[k]}'" for k in chunk) + ",")
    if lines:
        lines[-1] = lines[-1].rstrip(",")  # 最后一项不留逗号
    return (
        header
        + "export const PINYIN: Record<string, string> = {\n"
        + "\n".join(lines)
        + "\n};\n"
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="重新生成 pinyinData.ts 的汉字拼音表")
    ap.add_argument("--check", action="store_true", help="只报告缺字，不写文件")
    ap.add_argument("--refresh", action="store_true", help="连已有读音一起重算")
    ap.add_argument("--all", action="store_true", help="扫整个文件（含注释），默认只扫可搜文案")
    ap.add_argument("--src", nargs="*", type=Path, help="覆盖默认扫描文件")
    args = ap.parse_args()

    if not TARGET.exists():
        raise SystemExit(f"找不到 {TARGET}")

    src_text = read_text(TARGET)
    header = split_header(src_text)
    existing = parse_existing(src_text)
    print(f"现有表：{len(existing)} 字")

    paths = args.src or DEFAULT_SRC
    chars, per_file = collect_chars(paths, whole_file=args.all)
    for name, n in per_file.items():
        print(f"  扫到 {name}: {n} 个汉字")
    scope = "全文（含注释）" if args.all else "可搜文案（label/sub/kw）"
    print(f"合计去重：{len(chars)} 字 · 范围：{scope}")

    missing = sorted(chars - set(existing))
    unused = sorted(set(existing) - chars)

    if args.check:
        if missing:
            print(f"\n缺 {len(missing)} 字（拼音搜不到，会回落原字匹配）：")
            print("  " + "".join(missing))
        else:
            print("\n没有缺字。")
        if unused:
            print(f"\n有 {len(unused)} 字在表里但文案里已不出现（无害，可留）：")
            print("  " + "".join(unused))
        return 0 if not missing else 2

    need = set(missing) | (chars if args.refresh else set())
    if not need:
        print("\n没有新字，不需要改动。")
        return 0

    fresh, src_name = to_pinyin(need)
    print(f"读音来源：{src_name}")

    table = dict(existing)
    if args.refresh:
        table.update(fresh)
    else:
        for k, v in fresh.items():
            table.setdefault(k, v)

    added = [k for k in fresh if k not in existing]
    changed = [k for k in fresh if k in existing and existing[k] != fresh[k]]

    TARGET.write_text(render(header, table), encoding="utf-8")

    print(f"\n已写回 {TARGET.relative_to(ROOT)}：{len(table)} 字（原 {len(existing)}）")
    if added:
        print(f"  新增 {len(added)} 字：{''.join(sorted(added))}")
    if changed:
        print(
            f"  改读音 {len(changed)} 字："
            + "、".join(f"{k}:{existing[k]}→{fresh[k]}" for k in sorted(changed))
        )
    print("\n别忘了 npm run build —— pinyinData.ts 是编译进产物的。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())