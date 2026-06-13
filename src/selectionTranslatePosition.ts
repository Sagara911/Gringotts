import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { monitorFromPoint, primaryMonitor } from "@tauri-apps/api/window";

export const SELECTION_TRANSLATE_CHIP_SIZE = new LogicalSize(116, 40);
export const SELECTION_TRANSLATE_BUSY_SIZE = new LogicalSize(400, 210);
export const SELECTION_TRANSLATE_PANEL_SIZE = new LogicalSize(460, 380);

const POINTER_GAP = 12;
const SCREEN_PADDING = 8;
const MENU_AVOID_WIDTH = 320;
const MENU_AVOID_HEIGHT = 280;

function clamp(v: number, min: number, max: number) {
  if (max < min) return min;
  return Math.min(Math.max(v, min), max);
}

type Rect = { x: number; y: number; width: number; height: number };

function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

function intersectionArea(a: Rect, b: Rect) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

async function monitorBounds(x: number, y: number, size: LogicalSize) {
  const monitor =
    (await monitorFromPoint(x, y).catch(() => null)) ??
    (await primaryMonitor().catch(() => null));

  if (!monitor) return null;

  const area = monitor.workArea;
  const scale = monitor.scaleFactor || 1;
  const width = Math.round(size.width * scale);
  const height = Math.round(size.height * scale);

  return {
    width,
    height,
    minX: area.position.x + SCREEN_PADDING,
    minY: area.position.y + SCREEN_PADDING,
    maxX: area.position.x + area.size.width - width - SCREEN_PADDING,
    maxY: area.position.y + area.size.height - height - SCREEN_PADDING,
  };
}

export async function selectionTranslateAnchoredPosition(
  anchorX: number,
  anchorY: number,
  size: LogicalSize,
) {
  const bounds = await monitorBounds(anchorX, anchorY, size);
  if (!bounds) {
    return new PhysicalPosition(anchorX, anchorY);
  }

  return new PhysicalPosition(
    Math.round(clamp(anchorX, bounds.minX, bounds.maxX)),
    Math.round(clamp(anchorY, bounds.minY, bounds.maxY)),
  );
}

export async function selectionTranslatePosition(
  pointerX: number,
  pointerY: number,
  size: LogicalSize,
) {
  const bounds = await monitorBounds(pointerX, pointerY, size);
  if (!bounds) {
    return new PhysicalPosition(pointerX + POINTER_GAP, pointerY - size.height - POINTER_GAP);
  }

  const avoid = rect(
    pointerX - SCREEN_PADDING,
    pointerY - SCREEN_PADDING,
    MENU_AVOID_WIDTH,
    MENU_AVOID_HEIGHT,
  );
  const candidates = [
    { x: pointerX + POINTER_GAP, y: pointerY - bounds.height - POINTER_GAP, bias: -24 },
    { x: pointerX - bounds.width / 2, y: pointerY - bounds.height - POINTER_GAP, bias: -8 },
    { x: pointerX - bounds.width - POINTER_GAP, y: pointerY - bounds.height - POINTER_GAP, bias: 0 },
    { x: pointerX - bounds.width - POINTER_GAP, y: pointerY + POINTER_GAP, bias: 4 },
    { x: pointerX - bounds.width / 2, y: pointerY + POINTER_GAP, bias: 8 },
    { x: pointerX + POINTER_GAP, y: pointerY + POINTER_GAP, bias: 16 },
  ].map(({ x, y, bias }, index) => {
    const cx = clamp(x, bounds.minX, bounds.maxX);
    const cy = clamp(y, bounds.minY, bounds.maxY);
    const candidate = rect(cx, cy, bounds.width, bounds.height);
    const moved = Math.abs(cx - x) + Math.abs(cy - y);
    const overlap = intersectionArea(candidate, avoid);
    return {
      x: cx,
      y: cy,
      score: overlap * 20 + moved * 2 + index + bias,
    };
  });
  const best = candidates.reduce((a, b) => (b.score < a.score ? b : a));

  return new PhysicalPosition(Math.round(best.x), Math.round(best.y));
}
