using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;

namespace Riqian
{
    /// <summary>
    /// 第 165 条：快捷浮窗的落库部分。
    ///
    /// 刻意不放在前端：浮窗不经过 WebView2，如果保存要绕回前端，
    /// 主窗口一旦是隐藏的、或者前端还在初始化，这一笔就丢了。
    /// 这里直接用现成的 Db 方法，保证「按下回车 = 已入库」。
    /// </summary>
    public partial class Db
    {
        public (bool ok, string err, int n) QuickCaptureSave(string kind, string text)
        {
            var t = (text ?? "").Trim();
            if (t.Length == 0) return (false, "没有内容", 0);
            var today = DateTime.Now.ToString("yyyy-MM-dd");

            try
            {
                switch (kind)
                {
                    case "todo":
                    {
                        // 一行一条：用户在浮窗里常是「列个清单」而不是「写一句话」，
                        // 每一行都建一条待办比塞进备注里有用得多
                        var lines = t.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)
                                     .Select(x => x.Trim())
                                     .Where(x => x.Length > 0)
                                     .ToList();
                        if (lines.Count == 0) return (false, "没有内容", 0);
                        foreach (var line in lines) TodoAdd2(line, today, "", 1, "", null);
                        return (true, null, lines.Count);
                    }

                    case "note":
                    {
                        var book = "";
                        if (Notebooks() is IEnumerable<object> books)
                        {
                            var first = books.FirstOrDefault();
                            book = first?.GetType().GetProperty("id")?.GetValue(first)?.ToString() ?? "";
                        }
                        var body = "<p>" + Esc(t).Replace("\r\n", "<br>").Replace("\n", "<br>") + "</p>";
                        var title = t.Split('\n')[0].Trim();
                        if (title.Length > 24) title = title.Substring(0, 24);
                        if (title.Length == 0) title = "随手记";
                        var r = NoteSave("", book, title, body, 0);
                        return (true, null, 1);
                    }

                    case "diary":
                    {
                        /*
                         * 追加到今天的第一个正文模块末尾。
                         * 这里只动 vals 里那一行，不走 EntrySave ——
                         * EntrySave 会重写整天的 vals，前端此刻若正持有草稿就会被覆盖掉。
                         */
                        var mods = (Modules() as System.Collections.IEnumerable)?
                            .Cast<object>()
                            .Select(o => new
                            {
                                id = o.GetType().GetProperty("id")?.GetValue(o)?.ToString() ?? "",
                                type = o.GetType().GetProperty("type")?.GetValue(o)?.ToString() ?? "",
                                enabled = Convert.ToInt32(o.GetType().GetProperty("enabled")?.GetValue(o) ?? 1),
                            })
                            .ToList();
                        var target = mods?.FirstOrDefault(m => m.type == "richtext" && m.enabled == 1);
                        if (target == null) return (false, "还没有正文模块", 0);

                        var raw = Scalar("SELECT val FROM vals WHERE date=$d AND module_id=$m",
                            ("$d", today), ("$m", target.id));
                        var cur = Unquote(raw == null ? "" : raw.ToString());
                        var para = "<p>" + Esc(t).Replace("\r\n", "<br>").Replace("\n", "<br>") + "</p>";
                        var next = cur + para;

                        Exec("INSERT INTO vals(date,module_id,val) VALUES($d,$m,$v) " +
                             "ON CONFLICT(date,module_id) DO UPDATE SET val=$v",
                            ("$d", today), ("$m", target.id), ("$v", JsonSerializer.Serialize(next)));

                        // 只写了 vals 的话，entries 里可能还没有这一天的行，
                        // 前端切到「今天」会看到空白 —— 这里补一行并推进 rev，同步才会认
                        var now = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
                        var exists = Int(Scalar("SELECT COUNT(*) FROM entries WHERE date=$d", ("$d", today))) > 0;
                        if (exists)
                        {
                            Exec("UPDATE entries SET rev=rev+1, updated_at=$u WHERE date=$d", ("$u", now), ("$d", today));
                            Touch("entries", today, "upd",
                                Int(Scalar("SELECT rev FROM entries WHERE date=$d", ("$d", today))));
                        }
                        else
                        {
                            Exec("INSERT INTO entries(date,fav,bg,bg_tone,plain,title,created_at,updated_at,status) " +
                                 "VALUES($d,0,'','','','',$c,$c,'draft')", ("$d", today), ("$c", now));
                            Touch("entries", today, "ins", 1);
                        }
                        return (true, null, 1);
                    }

                    default:
                        return (false, "不支持的类型", 0);
                }
            }
            catch (Exception ex)
            {
                Diag.Error("quick", "快捷落库失败 kind=" + kind, ex);
                return (false, ex.Message, 0);
            }
        }

        /// <summary>JSON 字符串值 → 原文。</summary>
        private static string Unquote(string raw)
        {
            var s = (raw ?? "").Trim();
            if (s.Length >= 2 && s[0] == '"' && s[s.Length - 1] == '"')
            {
                try { return JsonSerializer.Deserialize<string>(s) ?? ""; }
                catch { return s.Trim('"'); }
            }
            if (s.Length == 0 || s == "null") return "";
            return s;
        }

        private static string Esc(string s)
            => (s ?? "").Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;");
    }
}