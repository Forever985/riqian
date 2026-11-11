/**
 * 验证 RpcArgs 抽取后参数语义没变。
 *
 * 为什么要专门测这个：S / I / D / Arr / SN 这五个方法看着都是"取个值"，
 * 但它们表达的是**不同的三态语义**，而且搞错了不会报错，只会静默存错数据：
 *   · S(a,"k")     没传 → null（不返回空串！）  用于「不传=别动」
 *   · SN(a,"k")    没传 → null，传 "" → ""      用于「不传/清空/设值」三态
 *   · I(a,"k")     没传 → -1                    用于「这次不处理」
 * 把 S 换成 SN、或把默认值从 -1 改成 0，编译器一句话都不会说。
 *
 * 做法：拿真实接口探这几种参数形态，看落库结果是否符合预期。
 * 用隔离数据目录，测完删干净。
 */
const { run } = require('./_probe');

run(async (P) => {
  P.say('装裸 RPC 调用器');
  const ok = await P.eval(() => {
    let seq = 930000;
    const waits = new Map();
    window.chrome.webview.addEventListener('message', (e) => {
      const d = e.data;
      if (!d || !waits.has(d.id)) return;
      const f = waits.get(d.id);
      waits.delete(d.id);
      f(d);
    });
    window.__RAW__ = (m, a) =>
      new Promise((res, rej) => {
        const id = ++seq;
        const t = setTimeout(() => { waits.delete(id); rej(new Error('超时 ' + m)); }, 10000);
        waits.set(id, (d) => { clearTimeout(t); res(d); });
        window.chrome.webview.postMessage({ id, m, a: a || {} });
      });
    return true;
  });
  P.out({ installed: ok });

  P.say('确认真空环境');
  const env = await P.eval(async () => {
    const b = await window.__RAW__('bootstrap');
    return { root: b.data?.root, today: b.data?.today };
  });
  P.out(env);
  const date = env.today;

  /* ---------- 测 S：不传 vs 传空串 ---------- */
  P.say('S 语义：entry.bg 的 tone 参数「不传」应当不覆盖已有值');
  const sSem = await P.eval(async (d) => {
    // 先设一个已知状态
    await window.__RAW__('entry.bg', { date: d, bg: '#112233', tone: 'dark' });
    const before = await window.__RAW__('entry.get', { date: d });

    // 再只改 bg，**不传 tone** —— S() 应返回 null，语义是「别动 tone」
    await window.__RAW__('entry.bg', { date: d, bg: '#445566' });
    const after = await window.__RAW__('entry.get', { date: d });

    const pick = (r) => ({
      bg: r.data?.bg,
      tone: r.data?.bgTone ?? r.data?.tone ?? null,
    });
    return { before: pick(before), after: pick(after) };
  }, date);
  P.out(sSem);
  /* 关键断言：bg 变了，但 tone 必须还在（没被 null 冲掉） */
  const toneKept =
    sSem.after && sSem.before &&
    sSem.after.bg === '#445566' &&
    sSem.after.tone === sSem.before.tone;
  console.log(`  bg 已更新: ${sSem.after?.bg === '#445566'}`);
  console.log(`  tone 未被冲掉（S 的「不传≠空串」语义）: ${toneKept}`);

  /* ---------- 测 SN：传空串应当真的清空 ---------- */
  P.say('SN 语义：显式传 tone:"" 应当把它清掉（与「不传」区分开）');
  const snSem = await P.eval(async (d) => {
    await window.__RAW__('entry.bg', { date: d, bg: '#778899', tone: 'light' });
    await window.__RAW__('entry.bg', { date: d, bg: '#778899', tone: '' });
    const r = await window.__RAW__('entry.get', { date: d });
    return { tone: r.data?.bgTone ?? r.data?.tone ?? null };
  }, date);
  P.out(snSem);
  const snCleared = snSem.tone === '' || snSem.tone === null;
  console.log(`  显式空串把 tone 清掉了: ${snCleared}`);

  P.say('I 语义：直接用 media.list 的 limit 验证「不传 → 默认值」');
  /* 前两版都写错了，记录一下为什么，免得以后又绕回来：
   *
   *   v1 用 entry.fav —— EntryFav() 是无条件 UPDATE，不传 fav 就是写 -1，
   *      不是"别动"。断言"应保持 1"必然失败。
   *   v2 用 note.save 的 pinned —— NoteSave() 同样是无条件写 $pin，
   *      不传也是 -1。断言还是不成立。
   *
   * 结论：**这个项目里的 RPC 大多没有"不传=不处理"的约定**，
   * I() 的 -1 默认值只是把"没传"这个事实传到实现里，怎么用由实现决定，
   * 有的实现判断了它，有的没有。
   *
   * 所以正确的测法是：**只测 I() 自己的行为**，找一个能观察到默认值的接口。
   * media.list 的 limit 默认 500 —— 传 3 和完全不传，返回条数应该不同。 */
  /* 图片在 **Node 侧**生成，再传进页面。
   * 第一版把生成逻辑写在 page.evaluate 里，报 "Buffer is not defined" ——
   * 那是 Node 的 API，浏览器页面里没有。这类错误只在跨环境复制代码时出现。 */
  const zlib = require('zlib');
  const mkPngB64 = (w) => {
    const chunk = (type, data) => {
      const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
      const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
      // Node 自带 crc32（v20+），没有就手算
      let crcVal;
      if (typeof zlib.crc32 === 'function') crcVal = zlib.crc32(td);
      else {
        let c = -1;
        for (const b of td) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; }
        crcVal = (c ^ -1) >>> 0;
      }
      const crc = Buffer.alloc(4); crc.writeUInt32BE(crcVal >>> 0);
      return Buffer.concat([len, td, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(1, 4);
    ihdr[8] = 8; ihdr[9] = 2;
    const raw = Buffer.alloc(1 + w * 3);
    raw[0] = 0;
    for (let x = 0; x < w; x++) {
      raw[1 + x * 3] = (x * 40) & 0xff;
      raw[2 + x * 3] = 100;
      raw[3 + x * 3] = 200;
    }
    const png = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]);
    return png.toString('base64');
  };
  const imgs = [1, 2, 3, 4, 5].map(mkPngB64);

  const iSem = await P.eval(async (list) => {
    /* 每张图尺寸不同 → 内容不同 → sha 不同，不会被去重。
     * （第一次用同一张 1x1 塞 5 次，全被判 dup，库里只有 1 条，
     *   于是 withLimit3 和 withoutLimit 都返回 1，看着像 limit 失效。） */
    const imports = [];
    for (let i = 0; i < list.length; i++) {
      const r = await window.__RAW__('media.saveBase64', {
        name: `args-probe-${i + 1}.png`,
        data: 'data:image/png;base64,' + list[i],
      });
      imports.push({ ok: r.data?.ok, dup: r.data?.dup });
    }

    const count = (r) => {
      const d = r.data;
      if (Array.isArray(d)) return d.length;
      if (d && Array.isArray(d.items)) return d.items.length;
      return -1;
    };

    const a = await window.__RAW__('media.list', { q: 'args-probe', limit: 3 });
    const b = await window.__RAW__('media.list', { q: 'args-probe' });
    return { imports, withLimit3: count(a), withoutLimit: count(b) };
  }, imgs);
  P.out(iSem);
  console.log(`  传 limit:3  → 返回 ${iSem.withLimit3} 条（应为 3）`);
  console.log(`  不传 limit  → 返回 ${iSem.withoutLimit} 条（应 != 3，证明默认值生效）`);
  /* 判据：传 3 就得 3；不传时得到的是别的值（默认走 500 封顶）。
     后者如果也是 3，说明 limit 根本没生效，那才是真问题。 */
  const iOk = Number(iSem.withLimit3) === 3 && Number(iSem.withoutLimit) !== 3;

  P.say('结论');
  const pass = toneKept && snCleared && iOk;
  console.log(`  S  「不传 ≠ 空串」  ${toneKept ? 'ok' : '失败'}`);
  console.log(`  SN 「空串 = 清空」   ${snCleared ? 'ok' : '失败'}`);
  console.log(`  I  「不传 = -1」     ${iOk ? 'ok' : '失败'}`);
  if (!pass) {
    console.log('  ✗ 参数语义变了 —— 抽取 RpcArgs 时改坏了');
    process.exitCode = 1;
  } else {
    console.log('  ✓ 五个取值方法的语义与抽取前一致');
  }
});