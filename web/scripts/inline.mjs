/**
 * 把 dist 里的 js/css 内联成一个 HTML，输出到 ..\wwwroot\index.html
 *
 * ⚠️ 两个必须守住的坑（都踩过）：
 * 1. 替换文本里绝不能用字符串 —— String.replace 会把 $&、$'、$`、$1 当特殊指令，
 *    而 React 打包产物里恰好含有 $&，于是整包被污染成 "</body>"，页面白屏。
 *    → 所有 replace 一律传函数。
 * 2. 内联脚本里的 </script 会提前闭合标签 → 必须转义。
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');
const outFile = join(here, '..', '..', 'wwwroot', 'index.html');

if (!existsSync(dist)) {
  console.error('[inline] 找不到 dist，先跑 vite build');
  process.exit(1);
}

const files = readdirSync(dist);
const jsName = files.find((f) => f.endsWith('.js'));
const cssName = files.find((f) => f.endsWith('.css'));
if (!jsName) {
  console.error('[inline] dist 里没有 js 产物');
  process.exit(1);
}

let html = readFileSync(join(dist, 'index.html'), 'utf8');
const js = readFileSync(join(dist, jsName), 'utf8');
const css = cssName ? readFileSync(join(dist, cssName), 'utf8') : '';

// 1) 转义 </script（用函数做替换，避免 $ 特殊模式）
const safeJs = js.replace(/<\/script/gi, () => '<\\/script');

// 2) 去掉 vite 注入的外链标签
html = html.replace(/<script[^>]*src="[^"]*"[^>]*><\/script>\s*/gi, () => '');
html = html.replace(/<link[^>]*rel="stylesheet"[^>]*>\s*/gi, () => '');
html = html.replace(/<link[^>]*rel="modulepreload"[^>]*>\s*/gi, () => '');

// 3) 内联（关键：传函数，不传字符串）
html = html.replace('</head>', () => `<style>\n${css}\n</style>\n</head>`);
html = html.replace('</body>', () => `<script>\n${safeJs}\n</script>\n</body>`);

/* ---------------- 产物自检：坏了就让构建失败，别把错误带进 exe ---------------- */

const fail = (msg) => {
  console.error('[inline] ❌ 自检失败：' + msg);
  process.exit(1);
};

// a) 替换有没有污染脚本：
//    不能简单地断言「脚本里不许有 </body>」——v8 的分享页模板里就合法地带着 </body>，
//    那条断言会把正常代码判成坏包。真正要防的是「凭空多出来」：
//    内联只是把 </script 转义掉，其它字符一个都不该变，所以 </body> 的数量必须完全相同。
const bodyInJs = (safeJs.match(/<\/body>/g) || []).length;
const bodyInRaw = (js.match(/<\/body>/g) || []).length;
if (bodyInJs !== bodyInRaw) {
  fail(`脚本里 </body> 从 ${bodyInRaw} 处变成 ${bodyInJs} 处，很可能又被 replace 的 $ 模式污染了`);
}
if (/<\/script/i.test(safeJs)) fail('脚本里仍有未转义的 </script');

// b) 结构完整（脚本自身可能含有 "<script>" 字样，按其出现次数算期望值）
const scriptInJs = (safeJs.match(/<script>/g) || []).length;
if (!html.includes('<div id="root">')) fail('缺少 #root 容器');
if ((html.split('</body>').length - 1) !== 1 + bodyInJs) fail('</body> 数量异常');
if ((html.split('<script>').length - 1) !== 1 + scriptInJs) fail('<script> 数量异常');
if (!html.trimEnd().endsWith('</html>')) fail('结尾不完整');

// c) 语法自检：能在 JS 引擎里编译通过
try {
  // eslint-disable-next-line no-new-func
  new Function(safeJs);
} catch (e) {
  fail('内联脚本语法错误 → ' + e.message);
}

writeFileSync(outFile, html, 'utf8');
const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
console.log(
  `[inline] 已生成 wwwroot/index.html  ${kb} KB  `
  + `(js ${(Buffer.byteLength(js) / 1024).toFixed(1)} KB, css ${(Buffer.byteLength(css) / 1024).toFixed(1)} KB)  ✓ 自检通过`,
);
