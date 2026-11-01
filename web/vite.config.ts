import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 构建目标：一份可被 WebView2 用 NavigateToString 加载的单文件 HTML。
 * - format: 'iife'  → 不用 ES module，避免 about:blank 源的模块加载问题
 * - cssCodeSplit: false → 只产出一个 css，便于内联
 * - 产物由 scripts/inline.mjs 合并进 wwwroot/index.html
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
