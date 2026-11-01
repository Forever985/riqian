import { useEffect } from 'react';

/**
 * 全局悬浮提示（第 152 条）。
 *
 * 为什么不用原生 `title`：那是系统画的黄底黑字小气泡 —— 等 1 秒才出来、
 * 样式跟主题完全不搭、还带一个尖角阴影。全软件两百多处 title 全走那条路，
 * 所以到处都显得「粗陋」。
 *
 * 这里把 title 收归己有：鼠标一进入就把 title 挪到 data-tip 并删掉属性，
 * 系统那条就再也不会弹；取而代之的是主题化的小条 —— 快（420ms）、
 * 跟随配色、圆角、带一点位移淡入，位置不够会翻到下面。
 *
 * 新代码建议直接写 `data-tip="..."`；写 `title` 也照常生效，不用改老代码。
 * 支持 `data-tip-pos="bottom"` 强制朝下。
 */
const SHOW_MS = 420;

export function TooltipLayer() {
  useEffect(() => {
    const tip = document.createElement('div');
    tip.className = 'tip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);

    let timer = 0;
    let cur: HTMLElement | null = null;

    const hide = () => {
      window.clearTimeout(timer);
      cur = null;
      tip.classList.remove('on');
    };

    /** 取出提示文案；顺手把原生 title 摘掉，免得两个气泡打架 */
    const read = (el: HTMLElement): string => {
      const own = el.getAttribute('data-tip');
      if (own) return own;
      const t = el.getAttribute('title');
      if (!t) return '';
      el.setAttribute('data-tip', t);
      el.removeAttribute('title');
      return t;
    };

    const place = (el: HTMLElement, text: string) => {
      tip.textContent = text;
      tip.style.left = '0px';
      tip.style.top = '0px';
      tip.classList.add('on');

      const w = tip.offsetWidth;
      const h = tip.offsetHeight;
      const r = el.getBoundingClientRect();
      const gap = 9;
      const forced = el.getAttribute('data-tip-pos');

      // 上面放不下就翻到下面；下面也放不下就贴着视口边缘
      let below = forced === 'bottom';
      if (!forced && r.top - h - gap < 8) below = true;

      let top = below ? r.bottom + gap : r.top - h - gap;
      if (top < 8) top = 8;
      if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);

      const center = r.left + r.width / 2;
      let left = Math.round(center - w / 2);
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));

      tip.style.left = `${left}px`;
      tip.style.top = `${Math.round(top)}px`;
      tip.dataset.pos = below ? 'bottom' : 'top';

      // 小尖角跟着元素的真实中心走，被视口挤过的时候仍然指向正确的位置
      const arrow = Math.round(center - left);
      tip.style.setProperty('--ax', `${Math.max(10, Math.min(arrow, w - 10))}px`);
    };

    const onOver = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (!t || !t.closest) return;
      if (tip.contains(t)) return;
      const el = t.closest<HTMLElement>('[data-tip], [title]');
      if (!el || el === cur) return;

      const text = read(el).trim();
      if (!text) return;
      // 按钮本来就有同样的字，再弹一次纯属噪音
      const shown = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (shown && shown === text.replace(/\s+/g, ' ')) return;

      window.clearTimeout(timer);
      hide();
      cur = el;
      /*
       * 大块头（整张卡片那种）要慢一点再弹。
       * 卡片上的提示是「按住可以拖动」这种说明性文字，
       * 用户在里面读内容、点按钮的时候不应该一直被顶出来；
       * 停够 900ms 才认为他是真的在端详这张卡。
       */
      const r = el.getBoundingClientRect();
      const big = r.width * r.height > 45000;
      timer = window.setTimeout(() => {
        if (cur === el) place(el, text);
      }, big ? 900 : SHOW_MS);
    };

    const onOut = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (!t || !t.closest) return;
      const el = t.closest<HTMLElement>('[data-tip], [title]');
      if (el && el === cur) hide();
    };

    document.addEventListener('pointerover', onOver, true);
    document.addEventListener('pointerout', onOut, true);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', hide, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);

    return () => {
      document.removeEventListener('pointerover', onOver, true);
      document.removeEventListener('pointerout', onOut, true);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('keydown', hide, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
      window.clearTimeout(timer);
      tip.remove();
    };
  }, []);

  return null;
}
