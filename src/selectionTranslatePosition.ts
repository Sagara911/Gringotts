import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { monitorFromPoint, primaryMonitor } from "@tauri-apps/api/window";

export const SELECTION_TRANSLATE_CHIP_SIZE = new LogicalSize(116, 40);
export const SELECTION_TRANSLATE_BUSY_SIZE = new LogicalSize(400, 210);
export const SELECTION_TRANSLATE_PANEL_SIZE = new LogicalSize(420, 310);

const POINTER_GAP = 12;
const SCREEN_PADDING = 8;

function clamp(v: number, min: number, max: number) {
  if (max < min) return min;
  return Math.min(Math.max(v, min), max);
}

export async function selectionTranslatePosition(
  pointerX: number,
  pointerY: number,
  size: LogicalSize,
) {
  const preferredX = pointerX + POINTER_GAP;
  const preferredY = pointerY + POINTER_GAP;
  const monitor =
    (await monitorFromPoint(pointerX, pointerY).catch(() => null)) ??
    (await primaryMonitor().catch(() => null));

  if (!monitor) {
    return new PhysicalPosition(preferredX, preferredY);
  }

  const area = monitor.workArea;
  const scale = monitor.scaleFactor || 1;
  const width = Math.round(size.width * scale);
  const height = Math.round(size.height * scale);
  const minX = area.position.x + SCREEN_PADDING;
  const minY = area.position.y + SCREEN_PADDING;
  const maxX = area.position.x + area.size.width - width - SCREEN_PADDING;
  const maxY = area.position.y + area.size.height - height - SCREEN_PADDING;

  return new PhysicalPosition(
    Math.round(clamp(preferredX, minX, maxX)),
    Math.round(clamp(preferredY, minY, maxY)),
  );
}
