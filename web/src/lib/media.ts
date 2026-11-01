/**
 * 图片库索引。日记里存的是内容哈希 id，渲染时在这里解析成 https://riqian.local/xxx
 * 用模块级可变索引，避免 markdown/bbcode 与 store 互相 import 成环。
 */
import type { MediaItem } from '../types';

let byId: Record<string, MediaItem> = {};
let byName: Record<string, MediaItem> = {};
let all: MediaItem[] = [];

export function setMediaIndex(list: MediaItem[]) {
  byId = {};
  byName = {};
  all = list;
  for (const m of list) {
    byId[m.id] = m;
    // 同名多张时保留最近导入的那张作为「按名字猜」的默认
    const key = `name:${m.name || ''}`;
    if (m.name && !byName[key]) byName[key] = m;
  }
}

export const mediaAll = () => all;

export function resolveRef(ref: string | null | undefined): MediaItem | null {
  if (!ref) return null;
  return byId[ref] || byName[`name:${ref}`] || null;
}

export function imgUrl(ref: string | null | undefined, thumb = false): string {
  if (!ref) return '';
  if (/^(https?:|data:|blob:)/.test(ref)) return ref;
  const m = resolveRef(ref);
  if (!m) return '';
  // thumb 为空 = 后端没能生成缩略图（GDI+ 读不了 webp/gif 等），直接用原图，别去撞 404。
  // file 为空 = 这条记录只是「网络链接」或文件已被移走，返回空串让 <img> 不发请求。
  const name = thumb && m.thumb ? `.thumb/${encodeURIComponent(m.thumb)}` : (m.file ? encodeURIComponent(m.file) : '');
  return name ? `https://riqian.local/${name}` : '';
}

export function rawUrl(file: string): string {
  return `https://riqian.local/${encodeURIComponent(file)}`;
}
