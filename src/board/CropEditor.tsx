// 图片裁剪编辑器（非破坏）：原图半透明垫底，裁剪窗口高亮，8 手柄调整 + 框内拖动平移窗口。
// 渲染在内容层（页面坐标，跟随旋转），提交/取消由 BoardCanvas 控制。
import { Group, Image as KImage, Rect as KRect } from "react-konva";
import type Konva from "konva";
import { type ImageShape } from "./store";
import { useImageEl } from "./useImage";

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const FULL: CropRect = { x: 0, y: 0, w: 1, h: 1 };
const MIN = 0.02; // 裁剪窗口最小占比

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 由形状当前状态推出"完整原图"在局部坐标系下的几何 */
export function fullExtent(shape: ImageShape) {
  const c0 = shape.crop ?? FULL;
  const W = shape.w / c0.w;
  const H = shape.h / c0.h;
  return { W, H, ox: -c0.x * W, oy: -c0.y * H };
}

export default function CropEditor({
  shape,
  rect,
  zoom,
  onChange,
}: {
  shape: ImageShape;
  rect: CropRect;
  zoom: number;
  onChange: (r: CropRect) => void;
}) {
  const img = useImageEl(shape.src);
  const { W, H, ox, oy } = fullExtent(shape);
  const bx = ox + rect.x * W;
  const by = oy + rect.y * H;
  const bw = rect.w * W;
  const bh = rect.h * H;
  const hs = 11 / zoom; // 手柄屏幕恒定大小
  if (!img) return null;

  const crop = {
    x: rect.x * img.naturalWidth,
    y: rect.y * img.naturalHeight,
    width: rect.w * img.naturalWidth,
    height: rect.h * img.naturalHeight,
  };

  // 8 手柄：归一化锚点（0/0.5/1），拖动调整相邻边
  const HANDLES: [number, number][] = [
    [0, 0], [0.5, 0], [1, 0], [0, 0.5], [1, 0.5], [0, 1], [0.5, 1], [1, 1],
  ];

  const onHandleDrag = (ax: number, ay: number) => (ev: Konva.KonvaEventObject<DragEvent>) => {
    // 手柄中心在全图归一化坐标中的位置
    const nx = ((ev.target.x() + hs / 2) - ox) / W;
    const ny = ((ev.target.y() + hs / 2) - oy) / H;
    let { x, y, w, h } = rect;
    if (ax === 0) {
      const right = x + w;
      x = clamp(nx, 0, right - MIN);
      w = right - x;
    } else if (ax === 1) {
      w = clamp(nx, x + MIN, 1) - x;
    }
    if (ay === 0) {
      const bottom = y + h;
      y = clamp(ny, 0, bottom - MIN);
      h = bottom - y;
    } else if (ay === 1) {
      h = clamp(ny, y + MIN, 1) - y;
    }
    onChange({ x, y, w, h });
  };

  return (
    <Group name="ui" x={shape.x} y={shape.y} rotation={shape.rotation}>
      {/* 原图全貌（半透明） */}
      <KImage name="ui" image={img} x={ox} y={oy} width={W} height={H} opacity={0.35} listening={false} />
      {/* 裁剪窗口（高亮，框内拖动平移窗口） */}
      <KImage name="ui" image={img} x={bx} y={by} width={bw} height={bh} crop={crop} listening={false} />
      <KRect
        name="ui"
        x={bx}
        y={by}
        width={bw}
        height={bh}
        stroke="#2f80ed"
        strokeWidth={1.5 / zoom}
        draggable
        onDragMove={(ev) => {
          const dx = (ev.target.x() - bx) / W;
          const dy = (ev.target.y() - by) / H;
          onChange({
            ...rect,
            x: clamp(rect.x + dx, 0, 1 - rect.w),
            y: clamp(rect.y + dy, 0, 1 - rect.h),
          });
        }}
      />
      {/* 全图范围参考线 */}
      <KRect
        name="ui"
        x={ox}
        y={oy}
        width={W}
        height={H}
        stroke="rgba(255,255,255,0.35)"
        strokeWidth={1 / zoom}
        dash={[4 / zoom, 4 / zoom]}
        listening={false}
      />
      {HANDLES.map(([ax, ay]) => (
        <KRect
          key={`${ax}-${ay}`}
          name="ui"
          x={bx + ax * bw - hs / 2}
          y={by + ay * bh - hs / 2}
          width={hs}
          height={hs}
          cornerRadius={2 / zoom}
          fill="#fff"
          stroke="#2f80ed"
          strokeWidth={1.5 / zoom}
          draggable
          onDragMove={onHandleDrag(ax, ay)}
        />
      ))}
    </Group>
  );
}
