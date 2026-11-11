/**
 * 老旧 WebView 的最小补丁。
 *
 * **必须在所有别的 import 之前被求值**（ESM 按 import 声明顺序执行），
 * 所以 main.tsx 的第一行就 import 这个文件 —— 放到后面就晚了。
 *
 * 为什么需要它：这份产物要同时喂桌面 WebView2 和安卓/鸿蒙的 WebView。
 * 鸿蒙老版本的 WebView 内核可能只到 Chromium 70 出头，
 * 而我们在语法层面已经把 `?.` / `??` 交给 esbuild 降级了（vite target=chrome70），
 * **但 esbuild 只降语法、不补 API**。
 *
 * 当前用到的、超出 chrome70 的 API 只有一个：`Object.fromEntries`（Chrome 73+）。
 * 两处调用（iconPack / Stats）。虽然只差三个版本，但缺了就是运行时 TypeError，
 * 表现可能是「某个页面打不开」，也可能是「设置读不出来」。
 *
 * 注意这里**刻意不去改 TypeScript 的类型声明**：给 Object.fromEntries 加
 * `| undefined` 会让两处调用点报 "possibly undefined"，等于用补丁换一堆编译错误。
 * 只在运行时挂上去，类型层面维持 lib 原来的非空声明。
 *
 * 以后如果引入新的 API（Array.at / structuredClone / replaceAll 等），
 * 请**先在这里补，或者干脆别用**，别指望构建工具。
 */

const obj = Object as unknown as { fromEntries?: (entries: Iterable<readonly unknown[]>) => unknown };

if (typeof obj.fromEntries !== 'function') {
  obj.fromEntries = function fromEntries(entries: Iterable<readonly unknown[]>) {
    const out: Record<string, unknown> = {};
    /*
     * 用 Array.from 物化，而不是直接 for...of 迭代入参：
     * Map 的 entries() 和老内核里的迭代器协议在跨实现时行为不一致，
     * 先转成数组最稳，代价可以忽略（只在老内核走到这条路）。
     */
    for (const pair of Array.from(entries)) {
      if (pair && pair.length >= 2) out[String(pair[0])] = pair[1];
    }
    return out;
  };
}

export {};
