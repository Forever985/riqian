using System;

namespace Riqian
{
    /// <summary>
    /// 文本处理的小工具。抽出来是为了让数据层能脱离 WinForms 编译。
    ///
    /// 背景：DbV7 读外部 JSON 前要剥掉 BOM / 零宽字符 / 前后空白，
    /// 原来这个方法是 MainForm 的静态成员 —— 数据层因此硬依赖了宿主窗体，
    /// 安卓上直接编译不过。而它本身只是三行纯字符串操作，没有任何窗体语义。
    ///
    /// 为什么必须统一走这里：用 Encoding.UTF8 写文件会带 BOM，
    /// JsonDocument.Parse 见到 0xEF 就报错。以前各写各的 TrimStart，
    /// 补丁迟早漏一处（记忆里已经栽过一次）。
    /// </summary>
    public static class TextUtil
    {
        /// <summary>剥掉 BOM、零宽空格、不换行空格和首尾空白。空输入返回空串。</summary>
        public static string StripJsonPreamble(string text)
        {
            if (string.IsNullOrEmpty(text)) return text ?? "";
            return text.TrimStart('\uFEFF', '\u200B', '\u00A0', ' ', '\t', '\r', '\n');
        }
    }
}
