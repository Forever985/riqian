const { run } = require('./_probe');

run(async (P) => {
  P.say('当前在哪一页');
  P.out(await P.eval(() => ({
    topbar: document.querySelector('.topbar h2')?.textContent,
    hasManager: !!document.querySelector('.mf-group'),
    buttons: Array.from(document.querySelectorAll('button[data-act]')).map((b) => b.getAttribute('data-act')).slice(0, 30),
  })));

  P.say('切到多媒体库');
  await P.go('media');
  await P.sleep(1200);
  P.out(await P.eval(() => ({
    topbar: document.querySelector('.topbar h2')?.textContent,
    hasManager: !!document.querySelector('.mf-group'),
    folderRow: Array.from(document.querySelectorAll('[data-folder]')).length,
    acts: Array.from(document.querySelectorAll('button[data-act]')).map((b) => b.getAttribute('data-act')),
  })));
});