/**
 * 探测脚本的公共外壳 —— 专治「跑完什么都没有」。
 *
 * 起因：之前写的探测脚本把好几步塞进同一个 evaluate，中间任何一步抛错，
 * 整段 IIFE 静默结束，终端一个字符都不输出。人只能干等，看着像卡死，
 * 实际上早就挂了。这个壳把那四种死法逐一堵上：
 *
 *   1. 没 try/catch        → 每步单独包，出错打印 err。
 *   2. 没顶层 .catch()     → main() 统一兜底，连不上 CDP 也说得清。
 *   3. 没超时              → 每个 evaluate 都有 timeout，页面冻住不会挂死。
 *   4. 多步混在一起        → 强制 step() 一步一件事，各自打印。
 *
 * 用法：
 *   const { run } = require('./_probe');
 *   run(async (P) => {
 *     P.say('notes 页');
 *     P.out(await P.eval(() => document.querySelectorAll('.nbook').length));
 *   });
 */
const { chromium } = require('playwright-core');

const PORT = Number(process.argv[2] || 57001);
/** 单个 evaluate 的上限。WebView2 在窗口不可见时会挂起页面，
 *  不设这个就会永远 pending —— 这正是上次"卡住"的物理原因。 */
const EVAL_TIMEOUT = 8000;

function withTimeout(promise, ms, what) {
  let timer;
  const guard = new Promise((_, rej) => {
    timer = setTimeout(
      () => rej(new Error(`超时 ${ms}ms：${what}（页面可能被挂起了）`)),
      ms,
    );
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

function createProbe(page) {
  let n = 0;
  const P = {
    page,
    /** 步骤标题，带序号，输出一眼能看出走到哪了 */
    say(t) { console.log(`\n[${++n}] ${t}`); },
    /** 打印任意值；undefined 也要显式打出来，不能看着像没输出 */
    out(v) {
      console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 1));
    },
    /** 安全 evaluate：自带超时 + 异常捕获。失败返回 {__err}，不抛 */
    async eval(fn, arg, label = 'evaluate') {
      try {
        const r = await withTimeout(page.evaluate(fn, arg), EVAL_TIMEOUT, label);
        return r;
      } catch (e) {
        console.log(`  ✗ ${label} 失败：${e.message}`);
        return { __err: e.message };
      }
    },
    /** 点侧栏切页；切完确认真的切过去了，而不是闷头往下走 */
    async go(key) {
      await page.keyboard.press('Escape').catch(() => {});
      const ok = await P.eval((k) => {
        const b = document.querySelector(`.nav button[data-nav="${k}"]`);
        if (!b) return false;
        b.click();
        return true;
      }, key, `点击侧栏 ${key}`);
      if (ok !== true) {
        console.log(`  ✗ 找不到侧栏按钮 data-nav="${key}"`);
        return false;
      }
      await page.waitForTimeout(1200);
      return true;
    },
    sleep: (ms) => page.waitForTimeout(ms),
  };
  return P;
}

/**
 * 入口。所有异常都在这里落定，保证终端一定有输出、退出码一定有意义。
 */
function run(body) {
  (async () => {
    let browser = null;
    try {
      browser = await withTimeout(
        chromium.connectOverCDP(`http://127.0.0.1:${PORT}`),
        8000,
        `连接 CDP ${PORT}`,
      );
      const pages = browser.contexts()[0]?.pages() || [];
      if (!pages.length) throw new Error(`CDP ${PORT} 连上了但没有页面`);
      const page = pages[0];
      page.setDefaultTimeout(15000);

      // 页面里的 JS 报错也要看见，不能被吞
      const pageErrs = [];
      page.on('pageerror', (e) => pageErrs.push(e.message));

      await body(createProbe(page), page);

      if (pageErrs.length) {
        console.log('\n⚠ 页面异常：');
        pageErrs.forEach((m) => console.log('  - ' + m));
      }
      console.log('\n完成。');
    } catch (e) {
      console.error('\n✗ 探测中断：' + (e && e.message ? e.message : e));
      console.error('  提示：确认软件在跑，且启动时带了 --remote-debugging-port=' + PORT);
      process.exitCode = 1;
    } finally {
      // 只断连接，不关用户的应用
      if (browser) await browser.close().catch(() => {});
    }
  })();
}

module.exports = { run, PORT };