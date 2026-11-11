import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 构建目标：一份内联的 index.html，交给 HtmlHost 的虚拟主机映射加载。
 *
 * 注意：**不是** NavigateToString。那个 API 有 2 MB 上限，本项目 2026-11-01 就绕开了
 * （见 HtmlHost.cs 的注释）。所以这里没有任何体积红线，别为了"别超 2MB"砍功能。
 *
 * - format: 'iife'  → 单文件就要 iife，省掉模块解析
 * - cssCodeSplit: false → 只产出一个 css，便于内联
 * - 产物由 scripts/inline.mjs 合并进 wwwroot/index.html
 * - KaTeX 字体**不在** CSS 里（曾经是），由 scripts/prep-katex.mjs 外置到
 *   wwwroot/fonts/，省 327 KB 且几乎不可压缩的那部分就此消失
 */
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    /*
     * 构建目标：**按最旧的那个 WebView 定，不是按最新的定**。
     *
     * 这份产物同时喂两个壳：
     *   · 桌面 WebView2（Chromium 110+，随便用新语法）
     *   · 安卓 WebView / 鸿蒙的 WebView（内核版本可能低到 Chromium 78 左右）
     *
     * 原来写的是 'chrome110'，跟着桌面定的。后果很隐蔽：
     * 打包产物里有 486 处 `?.`、242 处 `??`，这些是 ES2020 语法，
     * 要求 Chrome 80+。老内核遇到它们不是"某个按钮点不动"，
     * 而是**整个脚本语法错误、一行都不执行 → 白屏**。
     * 而白屏看起来像"程序坏了"，很难联想到是构建目标的问题。
     *
     * 所以降到 chrome70：esbuild 会把 `?.` / `??` 降级成条件表达式，
     * 语法上留足余量。代价是产物稍大一点，这和"手机上能打开"比不值一提。
     *
     * 注意 esbuild **只降语法、不补 API**。产物里若用到
     * Object.fromEntries（Chrome 73+）、Array.at（92+）这类，它不会 polyfill，
     * 只能靠人工核查 —— 已核查：只用了 Object.fromEntries（2 处），
     * 对 Chromium 73+ 都安全。
     */
    target: 'chrome70',
    cssCodeSplit: false,
    modulePreload: false,
    assetsInlineLimit: 0,
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
        assetFileNames: 'app.[ext]',
      },
    },
  },
});
