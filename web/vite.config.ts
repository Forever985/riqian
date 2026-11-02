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
    target: 'chrome110',
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
