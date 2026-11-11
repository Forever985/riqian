using System.Linq;
using System.Text.Json;

namespace Riqian
{
    /// <summary>
    /// RPC 参数读取的小工具。
    ///
    /// 从 MainForm.cs / MainFormV10.cs 搬出来的，原因很实际：Dispatch 那一整套
    /// （297 个方法）要在安卓上原样复用，而这些静态方法是它的底层依赖。
    /// 留在 MainForm 里就等于把分发逻辑焊死在 WinForms 上。
    ///
    /// 语义保持不变，尤其这几条是踩过坑才定下来的：
    ///   · S()  找不到 key 返回 def（**不是空串**），因为「没传」和「传了空串」
    ///          在不少接口里含义不同（比如颜色不传 = 别动，传空 = 清掉）
    ///   · I()  找不到返回 -1，专门用来表达「这次不作处理」
    ///   · SN() 找不到返回 null（三个值：没传 / null / 空串要能区分开）
    ///
    /// 都是 static：它们不碰任何实例状态，搬出来不影响任何调用点。
    /// </summary>
    internal static class RpcArgs
    {
        /// <summary>取字符串。没传 → def；显式 null → def；数字/布尔 → 转成字符串。</summary>
        public static string S(JsonElement a, string k, string def = null)
        {
            if (a.ValueKind != JsonValueKind.Object || !a.TryGetProperty(k, out var v)) return def;
            return v.ValueKind == JsonValueKind.String ? v.GetString()
                 : v.ValueKind == JsonValueKind.Null ? def
                 : v.ToString();
        }

        /// <summary>
        /// 取整数。没传 → def（默认 -1，表示「这次别动」）。
        ///
        /// ⚠️ 这里必须用 TryGetInt32，不能直接 GetInt32()。
        ///
        /// 直接调的后果是：任何一个整数参数只要收到超出 int 范围的数字
        /// （比如金额传了 99999999999），整个请求会抛 FormatException 变成
        /// 一条 `{"ok":false,"type":"FormatException"}` —— 用户看到的不是
        /// 「金额太大」这种人话，而是一个他看不懂的格式错误。
        /// #250 测愿望单时就是这么撞出来的。
        ///
        /// 处理方式：超范围时**夹到 int 的边界值**，而不是退回 def。
        /// 理由：夹到边界之后，上层的业务校验（`priceCents > 上限`）还能
        /// 正常命中并给出人话提示；退回 def 会被当成「没传」，
        /// 反而可能绕过校验（比如 fav 没传 = 不动，而传了个超大数变成了"不动"）。
        /// </summary>
        public static int I(JsonElement a, string k, int def = -1)
        {
            if (a.ValueKind != JsonValueKind.Object || !a.TryGetProperty(k, out var v)) return def;
            if (v.ValueKind == JsonValueKind.Number)
            {
                if (v.TryGetInt32(out var n)) return n;
                // 超出范围：按符号夹到边界
                if (v.TryGetDouble(out var d)) return d > 0 ? int.MaxValue : int.MinValue;
                return def;
            }
            if (v.ValueKind == JsonValueKind.String)
            {
                var s = v.GetString();
                if (int.TryParse(s, out var n2)) return n2;
                // 字符串里也可能是超范围的数字字面量
                if (double.TryParse(s, out var d2)) return d2 > 0 ? int.MaxValue : int.MinValue;
            }
            return def;
        }

        /// <summary>取长整数。金额这类「分」为单位的量用它，避免撞 int 上限。</summary>
        public static long L(JsonElement a, string k, long def = -1)
        {
            if (a.ValueKind != JsonValueKind.Object || !a.TryGetProperty(k, out var v)) return def;
            if (v.ValueKind == JsonValueKind.Number)
            {
                if (v.TryGetInt64(out var n)) return n;
                if (v.TryGetDouble(out var d)) return d > 0 ? long.MaxValue : long.MinValue;
                return def;
            }
            if (v.ValueKind == JsonValueKind.String)
            {
                var s = v.GetString();
                if (long.TryParse(s, out var n2)) return n2;
                if (double.TryParse(s, out var d2)) return d2 > 0 ? long.MaxValue : long.MinValue;
            }
            return def;
        }

        /// <summary>取浮点。字符串形式也认（前端有时把数字序列化成字符串）。</summary>
        public static double D(JsonElement a, string k, double def = 0)
        {
            if (a.ValueKind == JsonValueKind.Object && a.TryGetProperty(k, out var v))
            {
                if (v.ValueKind == JsonValueKind.Number && v.TryGetDouble(out var d)) return d;
                if (v.ValueKind == JsonValueKind.String && double.TryParse(v.GetString(), out var d2)) return d2;
            }
            return def;
        }

        /// <summary>取字符串数组。跳过空串 —— 空元素在 id 列表里一定是噪音。</summary>
        public static string[] Arr(JsonElement a, string k)
        {
            if (a.ValueKind != JsonValueKind.Object || !a.TryGetProperty(k, out var v) || v.ValueKind != JsonValueKind.Array)
                return new string[0];
            return v.EnumerateArray().Select(x => x.GetString() ?? "").Where(x => x != "").ToArray();
        }

        /// <summary>
        /// 可空字符串：没传 → null，传 null → null，传 "" → ""。
        /// 用于「三态」参数（不传=别动 / null=清空 / 有值=设成它）。
        /// </summary>
        public static string SN(JsonElement a, string k)
        {
            if (a.ValueKind != JsonValueKind.Object || !a.TryGetProperty(k, out var v)) return null;
            if (v.ValueKind == JsonValueKind.Null) return null;
            if (v.ValueKind == JsonValueKind.String) return v.GetString();
            return v.ToString();
        }
    }
}