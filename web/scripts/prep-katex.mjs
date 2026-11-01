/**
 * 把 KaTeX 的样式表变成「字体内联版」，供单文件 HTML 离线使用。
 *
 * 为什么不直接在 vite 里 import katex.min.css：
 * - 它给每个字体列了 woff2 / woff / ttf 三种格式，浏览器只会用第一个，
 *   另外两种内联进来纯属让 exe 变胖（+876KB）。
 * - 这里只保留 woff2 并转成 data URI，产物约 400KB，打包后无需任何外部文件。
 *
 * 生成物 src/lib/katex.gen.css 由 npm run build 自动重新生成，不要手改。
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'node_modules', 'katex', 'dist');
const out = join(here, '..', 'src', 'lib', 'katex.gen.css');

let css = readFileSync(join(dist, 'katex.min.css'), 'utf8');

// 1) 去掉 woff / ttf 兜底，只留 woff2（WebView2 = Chromium，必然支持）
css = css.replace(/,url\(fonts\/[^)]+\.woff\) format\("woff"\),url\(fonts\/[^)]+\.ttf\) format\("truetype"\)/g, () => '');

// 2) woff2 → base64 data URI
const fonts = readdirSync(join(dist, 'fonts')).filter((f) => f.endsWith('.woff2'));
let bytes = 0;
for (const f of fonts) {
  const buf = readFileSync(join(dist, 'fonts', f));
  bytes += buf.length;
  const uri = `data:font/woff2;base64,${buf.toString('base64')}`;
  const re = new RegExp(`url\\(fonts/${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g');
  css = css.replace(re, () => `url(${uri})`);
}

// 3) 残留检查：不允许还有相对路径字体，否则内联 HTML 里会 404
const left = css.match(/url\(fonts\//g);
if (left) {
  console.error(`[katex] ❌ 还有 ${left.length} 处字体没内联，构建中止`);
  process.exit(1);
}

writeFileSync(out, css, 'utf8');
console.log(`[katex] 已生成 katex.gen.css（${fonts.length} 个字体，${(bytes / 1024).toFixed(0)} KB → 内联后 ${(css.length / 1024).toFixed(0)} KB）`);
