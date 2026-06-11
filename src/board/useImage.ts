// 图片元素加载缓存：画布与裁剪编辑器共用
import { useEffect, useReducer } from "react";

const imgCache = new Map<string, HTMLImageElement>();
const imgWaiters = new Map<string, Set<() => void>>();

export function useImageEl(src: string): HTMLImageElement | null {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!src) return; // 空 src：不创建 Image、不加载（LOD 下用于“暂不加载原图”）
    if (imgCache.has(src)) return;
    let subs = imgWaiters.get(src);
    if (!subs) {
      subs = new Set();
      imgWaiters.set(src, subs);
      const el = new window.Image();
      el.onload = () => {
        imgCache.set(src, el);
        imgWaiters.get(src)?.forEach((f) => f());
        imgWaiters.delete(src);
      };
      el.onerror = () => imgWaiters.delete(src);
      el.src = src;
    }
    subs.add(force);
    return () => void imgWaiters.get(src)?.delete(force);
  }, [src]);
  return imgCache.get(src) ?? null;
}
