// 箭头绑定解算（纯函数）：端点绑定到形状后，按"从对方端点射向目标中心、与目标边缘的交点"
// 实时定位。形状移动/缩放时调用 reflowArrows 把绑定箭头端点重算回存储坐标——
// 这样渲染层、端点把手、导出全部用同一份真值，无需每帧解算。
import { type ArrowShape, type BoardShape, shapeBounds } from "./store";

interface P {
  x: number;
  y: number;
}

/** 射线从矩形中心射向 toward，求与矩形边缘（外扩 pad）交点 */
function edgePoint(box: { x: number; y: number; w: number; h: number }, toward: P, pad = 5): P {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const hw = box.w / 2 + pad;
  const hh = box.h / 2 + pad;
  const scale = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

/** 解算箭头实际端点（相对格式，与存储一致）；无绑定端用原 free 端点 */
export function resolveArrow(
  a: ArrowShape,
  get: (id: string) => BoardShape | undefined
): { x: number; y: number; x2: number; y2: number } {
  let start: P = { x: a.x, y: a.y };
  let end: P = { x: a.x + a.x2, y: a.y + a.y2 };
  const sT = a.bindStart && get(a.bindStart.shapeId);
  const eT = a.bindEnd && get(a.bindEnd.shapeId);
  if (sT) start = edgePoint(shapeBounds(sT), end);
  if (eT) end = edgePoint(shapeBounds(eT), start);
  if (sT) start = edgePoint(shapeBounds(sT), end); // 二次精修（两端都绑时收敛）
  return { x: start.x, y: start.y, x2: end.x - start.x, y2: end.y - start.y };
}

/** 重算所有绑定箭头端点，返回新数组（无变化返回原数组，避免无谓重渲） */
export function reflowArrows(shapes: BoardShape[]): BoardShape[] {
  const map = new Map(shapes.map((s) => [s.id, s]));
  const get = (id: string) => map.get(id);
  let changed = false;
  const out = shapes.map((s) => {
    if (s.type !== "arrow" || (!s.bindStart && !s.bindEnd)) return s;
    const r = resolveArrow(s, get);
    if (r.x !== s.x || r.y !== s.y || r.x2 !== s.x2 || r.y2 !== s.y2) {
      changed = true;
      return { ...s, ...r };
    }
    return s;
  });
  return changed ? out : shapes;
}

/** 命中检测：页面坐标点落在哪个可绑形状上（逆序取最上层；排除箭头/自身/锁定） */
export function hitTestShape(
  shapes: BoardShape[],
  page: P,
  excludeId?: string
): string | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (s.type === "arrow" || s.id === excludeId || s.locked) continue;
    const b = shapeBounds(s);
    if (page.x >= b.x && page.x <= b.x + b.w && page.y >= b.y && page.y <= b.y + b.h) {
      return s.id;
    }
  }
  return null;
}

/** 移除指向已删形状的绑定 */
export function pruneBindings(shapes: BoardShape[], removedIds: Set<string>): BoardShape[] {
  return shapes.map((s) => {
    if (s.type !== "arrow") return s;
    let bs = s.bindStart;
    let be = s.bindEnd;
    if (bs && removedIds.has(bs.shapeId)) bs = undefined;
    if (be && removedIds.has(be.shapeId)) be = undefined;
    return bs === s.bindStart && be === s.bindEnd ? s : { ...s, bindStart: bs, bindEnd: be };
  });
}
