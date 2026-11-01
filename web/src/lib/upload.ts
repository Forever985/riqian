/**
 * 图片导入的统一入口。
 * 拖拽和粘贴拿不到磁盘路径，只能读成 base64 交给宿主落盘；
 * 宿主仍走「临时文件 → 算哈希 → 原子改名」那套，所以去重和防覆盖逻辑不变。
 */
import { api } from '../api';

const IMG_RE = /^image\//i;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = () => reject(new Error('读取失败'));
    fr.readAsDataURL(file);
  });
}

export function pickImageFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.style.display = 'none';
    input.onchange = () => {
      resolve(Array.from(input.files || []));
      input.remove();
    };
    document.body.appendChild(input);
    input.click();
  });
}

/** 把一批 File 导入图片库，返回成功的图片 id */
export async function importImageFiles(files: File[]): Promise<string[]> {
  const ids: string[] = [];
  for (const f of files) {
    if (!IMG_RE.test(f.type) && !/\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name)) continue;
    try {
      const data = await readAsDataUrl(f);
      const r = await api.media.saveBase64(f.name || 'paste.png', data);
      if (r?.ok && r.id) ids.push(r.id);
    } catch {
      /* 单张失败不影响其它 */
    }
  }
  return ids;
}

/** 从剪贴板 / 拖拽事件里挑出图片文件 */
export function imageFilesFromDataTransfer(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const out: File[] = [];
  if (dt.files && dt.files.length) {
    Array.from(dt.files).forEach((f) => {
      if (IMG_RE.test(f.type) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name)) out.push(f);
    });
  } else if (dt.items) {
    Array.from(dt.items).forEach((it) => {
      if (it.kind === 'file' && IMG_RE.test(it.type)) {
        const f = it.getAsFile();
        if (f) out.push(f);
      }
    });
  }
  return out;
}
