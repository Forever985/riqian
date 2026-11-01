const { run } = require('./_probe');

run(async (P) => {
  P.say('用 fetch 直连宿主调试网关写两张图');
  P.out(await P.eval(async () => {
    const info = await (await fetch('/__info')).json().catch(() => null);
    return info;
  }));
});