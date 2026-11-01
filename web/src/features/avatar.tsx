import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../components/ui';

const OUT = 320;   // 导出尺寸（正方形，显示时由 CSS 裁圆）

/**
 * 头像裁剪：拖动 + 缩放 + 圆形预览（第 51 条）。
 * 联网看过主流做法（微信 / QQ / GitHub 的头像上传）：都是「圆形取景框 + 双指/滚轮缩放 + 拖动定位」，
 * 所以这里只做这三件事，不引入第三方裁剪库 —— 一个 canvas 就够了，还省 100KB。
 */
export function AvatarCrop({
  src, onCancel, onDone,
}: {
  src: string;
  onCancel: () => void;
  onDone: (dataUrl: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  // 加载图片
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { imgRef.current = img; setReady(true); };
    img.onerror = () => setReady(false);
    img.src = src;
  }, [src]);

  const draw = () => {
    const cv = canvasRef.current;
    const img = imgRef.current;
    if (!cv || !img) return;
    const g = cv.getContext('2d');
    if (!g) return;

    const W = cv.width;
    const H = cv.height;
    g.clearRect(0, 0, W, H);

    // 底：棋盘格，方便看透明区
    g.save();
    g.fillStyle = 'rgba(0,0,0,.04)';
    g.fillRect(0, 0, W, H);

    const base = Math.max(W / img.width, H / img.height);
    const k = base * zoom;
    const dw = img.width * k;
    const dh = img.height * k;
    const x = (W - dw) / 2 + off.x;
    const y = (H - dh) / 2 + off.y;

    // 圆形裁切
    g.beginPath();
    g.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2);
    g.clip();
    g.drawImage(img, x, y, dw, dh);
    g.restore();

    // 取景框
    g.save();
    g.strokeStyle = 'rgba(255,255,255,.9)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  };

  useEffect(() => { if (ready) draw(); }, [ready, zoom, off]);

  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const cv = canvasRef.current;
    const scale = cv ? cv.width / cv.getBoundingClientRect().width : 1;
    setOff({ x: d.ox + (e.clientX - d.x) * scale, y: d.oy + (e.clientY - d.y) * scale });
  };
  const onUp = () => { dragRef.current = null; };

  const exportPng = () => {
    const cv = canvasRef.current;
    if (!cv) return '';
    // 用一个离屏 canvas 按 320×320 重画一遍，保证输出尺寸稳定
    const out = document.createElement('canvas');
    out.width = OUT; out.height = OUT;
    const g = out.getContext('2d');
    const img = imgRef.current;
    if (!g || !img) return '';
    const base = Math.max(OUT / img.width, OUT / img.height);
    const k = base * zoom * (OUT / cv.width);
    const dw = img.width * k;
    const dh = img.height * k;
    const f = OUT / cv.width;
    g.drawImage(img, (OUT - dw) / 2 + off.x * f, (OUT - dh) / 2 + off.y * f, dw, dh);
    return out.toDataURL('image/png');
  };

  return (
    <Dialog
      title="调整头像"
      onClose={onCancel}
      footer={<>
        <button className="btn" onClick={onCancel}>取消</button>
        <button className="btn" onClick={() => { setZoom(1); setOff({ x: 0, y: 0 }); }}>重置</button>
        <button className="btn primary" disabled={!ready} onClick={() => onDone(exportPng())}>用这张</button>
      </>}
    >
      <div className="crop">
        <canvas
          ref={canvasRef}
          width={300}
          height={300}
          className="crop-cv"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
        <div className="crop-side">
          <div className="small muted" style={{ lineHeight: 1.9 }}>
            按住图片拖动位置，用下面的滑杆放大缩小。
            框里看到什么就存什么，显示时会再裁成圆的。
          </div>
          <label className="crop-lab">
            缩放
            <input
              type="range" min={1} max={3} step={0.02}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
            <span className="val">{zoom.toFixed(2)}×</span>
          </label>
          <div className="row" style={{ marginTop: 6 }}>
            <button className="btn sm" onClick={() => setZoom((z) => Math.min(3, z + 0.1))}>放大</button>
            <button className="btn sm" onClick={() => setZoom((z) => Math.max(1, z - 0.1))}>缩小</button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
