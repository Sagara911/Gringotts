// 拖动吸附：对其他形状的边缘/中线吸附，返回位移修正量与命中的参考线（页面坐标）
import { type BoardShape, type Box, shapeBounds } from "./store";

export interface SnapTargets {
  xs: number[]; // 每个形状的 左/中/右
  ys: number[]; // 每个形状的 顶/中/底
}

export function collectSnapTargets(shapes: BoardShape[], excludeIds: Set<string>): SnapTargets {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const s of shapes) {
    if (excludeIds.has(s.id)) continue;
    const b = shapeBounds(s);
    xs.push(b.x, b.x + b.w / 2, b.x + b.w);
    ys.push(b.y, b.y + b.h / 2, b.y + b.h);
  }
  return { xs, ys };
}

export interface SnapResult {
  dx: number;
  dy: number;
  vLines: number[];
  hLines: number[];
}

/** 给定移动中选区的包围盒，返回吸附修正量与参考线 */
export function snapMove(box: Box, targets: SnapTargets, threshold: number): SnapResult {
  const myXs = [box.x, box.x + box.w / 2, box.x + box.w];
  const myYs = [box.y, box.y + box.h / 2, box.y + box.h];
  let bestX: { d: number; line: number } | null = null;
  let bestY: { d: number; line: number } | null = null;
  for (const mx of myXs) {
    for (const tx of targets.xs) {
      const d = tx - mx;
      if (Math.abs(d) <= threshold && (!bestX || Math.abs(d) < Math.abs(bestX.d))) {
        bestX = { d, line: tx };
      }
    }
  }
  for (const my of myYs) {
    for (const ty of targets.ys) {
      const d = ty - my;
      if (Math.abs(d) <= threshold && (!bestY || Math.abs(d) < Math.abs(bestY.d))) {
        bestY = { d, line: ty };
      }
    }
  }
  return {
    dx: bestX?.d ?? 0,
    dy: bestY?.d ?? 0,
    vLines: bestX ? [bestX.line] : [],
    hLines: bestY ? [bestY.line] : [],
  };
}
