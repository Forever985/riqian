/**
 * 把 KaTeX 的样式表变成「字体外置版」：@font-face 指向真实 .woff2 文件，
 * 而不是把字体 base64 内嵌进 CSS。
 *
 * 为什么不直接用 katex.min.css：它给每个字体列了 woff2 / woff / ttf 三种格式，
 * 浏览器只会用第一个，另两种带进来纯属让产物变胖（+876KB）。只保留 woff2。
 *
 * 为什么外置而不是内嵌（2026-11-02 改的）：
 * - 20 个字体 base64 后 346 KB，占整个 index.html 的 20%，而且几乎不可压缩
 *   （实测 CSS 含字体 gzip 284 KB vs 不含字体 27 KB —— 字体是纯熵）。
 * - base64 本身还有 33% 膨胀：254 KB 的 woff2 变成 346 KB 文本。
 * - 这个节省是**零代价**的：字体跟代码不同，浏览器本来就要单独解析它。
 *   内嵌只是把整包变成一个巨大字符串，CSSOM 要等字体字节全部解析完才可用，
 *   反而推迟首屏。
 *
 * 为什么现在能外置：页面早就不走 NavigateToString 了（那条路才有 2 MB 上限），
 * 现在走 HtmlHost 的虚拟主机映射，页面有真实 origin，可以正常请求同源静态资源。
 *
 * 产物：
 *   src/lib/katex.gen.css     —— @font-face 用 url(fonts/xxx.woff2)
 *   ../wwwroot/fonts/*.woff2  —— 真实字体文件，csproj 会复制进输出目录
 *
 * 由 npm run build 自动重新生成，不要手改。
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'node_modules', 'katex', 'dist');
const out = join(here, '..', 'src', 'lib', 'katex.gen.css');
const fontOut = join(here, '..', '..', 'wwwroot', 'fonts');

let css = readFileSync(join(dist, 'katex.min.css'), 'utf8');

// 1) 去掉 woff / ttf 兜底，只留 woff2（WebView2 = Chromium，必然支持）
css = css.replace(/,url\(fonts\/[^)]+\.woff\) format\("woff"\),url\(fonts\/[^)]+\.ttf\) format\("truetype"\)/g, () => '');

// 2) 字体文件拷到 wwwroot/fonts/。CSS 里的 url 保持相对路径 fonts/xxx.woff2 ——
//    这段 CSS 会被内联进 index.html 的 <style>，相对路径按 index.html 的位置解析，
//    index.html 在 wwwroot 根、字体在 wwwroot/fonts，正好对上。
if (existsSync(fontOut)) rmSync(fontOut, { recursive: true, force: true });
mkdirSync(fontOut, { recursive: true });

const fonts = readdirSync(join(dist, 'fonts')).filter((f) => f.endsWith('.woff2'));
let bytes = 0;
for (const f of fonts) {
  const src = join(dist, 'fonts', f);
  bytes += readFileSync(src).length;
  copyFileSync(src, join(fontOut, f));
}

// 3) 自检 a：不允许还有内嵌字体（否则外置没生效）
if (/url\(data:font/.test(css)) {
  console.error('[katex] ❌ 还有内嵌字体没剥掉，构建中止');
  process.exit(1);
}
// 4) 自检 b：引用数必须和文件数一致，否则缺字体会静默变豆腐块
const refs = css.match(/url\(fonts\/[^)]+\.woff2\)/g) || [];
if (refs.length !== fonts.length) {
  console.error(`[katex] ❌ 字体引用 ${refs.length} 处，但文件有 ${fonts.length} 个，对不上`);
  process.exit(1);
}

writeFileSync(out, css, 'utf8');
console.log(
  `[katex] 已生成 katex.gen.css（${fonts.length} 个字体外置到 wwwroot/fonts/，`
  + `${(bytes / 1024).toFixed(0)} KB 真实文件 / CSS 仅 ${(css.length / 1024).toFixed(0)} KB）`,
);