// 联系表（contact sheet）导出：把一组素材排成带文件名标注的缩略图网格，
// 分页渲染到 canvas → 每页转 JPEG → 手搓最小 PDF（DCTDecode 内嵌，无三方依赖）。
// 用途：把一个合集 / 一批选中图打包成 PDF 图集发给客户/同事。

export interface SheetItem {
  src: string; // 已 convertFileSrc 解析的可显示地址（缩略图优先）
  name: string;
}

// A4 纵向 @150dpi 左右
const PAGE_W = 1240;
const PAGE_H = 1754;
const MARGIN = 48;
const GAP = 20;
const CAPTION_H = 26;
const TITLE_H = 56;
const FONT = "'Segoe UI','Microsoft YaHei',sans-serif";

/** fetch→blob 载图（同源 objectURL，canvas 不被跨源污染，toDataURL 才不报错） */
async function loadImage(src: string): Promise<HTMLImageElement | null> {
  let obj = "";
  try {
    const blob = await fetch(src).then((r) => r.blob());
    obj = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("load"));
      img.src = obj;
    });
    return img;
  } catch {
    return null;
  } finally {
    if (obj) URL.revokeObjectURL(obj);
  }
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + "…").width > maxW) s = s.slice(0, -1);
  return s + "…";
}

/** 渲染一页网格到 canvas，返回 JPEG 字节 + 像素宽高 */
async function renderPage(
  items: SheetItem[],
  cols: number,
  rows: number,
  title: string | null
): Promise<{ jpeg: Uint8Array; w: number; h: number }> {
  const cv = document.createElement("canvas");
  cv.width = PAGE_W;
  cv.height = PAGE_H;
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);

  const top = MARGIN + (title ? TITLE_H : 0);
  if (title) {
    ctx.fillStyle = "#111111";
    ctx.font = `bold 30px ${FONT}`;
    ctx.textBaseline = "top";
    ctx.fillText(ellipsize(ctx, title, PAGE_W - MARGIN * 2), MARGIN, MARGIN);
  }

  const cellW = (PAGE_W - MARGIN * 2 - GAP * (cols - 1)) / cols;
  const gridH = PAGE_H - top - MARGIN;
  const cellH = (gridH - GAP * (rows - 1)) / rows;
  const imgH = cellH - CAPTION_H;

  for (let i = 0; i < items.length; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x = MARGIN + c * (cellW + GAP);
    const y = top + r * (cellH + GAP);
    // 缩略图背景
    ctx.fillStyle = "#f0f0f2";
    ctx.fillRect(x, y, cellW, imgH);
    const img = await loadImage(items[i].src);
    if (img && img.naturalWidth) {
      const s = Math.min(cellW / img.naturalWidth, imgH / img.naturalHeight);
      const w = img.naturalWidth * s;
      const h = img.naturalHeight * s;
      ctx.drawImage(img, x + (cellW - w) / 2, y + (imgH - h) / 2, w, h);
    } else {
      ctx.fillStyle = "#bbbbbb";
      ctx.font = `14px ${FONT}`;
      ctx.fillText("（无法加载）", x + 8, y + 8);
    }
    // 文件名标注
    ctx.fillStyle = "#333333";
    ctx.font = `14px ${FONT}`;
    ctx.textBaseline = "top";
    ctx.fillText(ellipsize(ctx, items[i].name, cellW), x, y + imgH + 6);
  }

  const dataUrl = cv.toDataURL("image/jpeg", 0.85);
  return { jpeg: b64ToBytes(dataUrl.split(",")[1]), w: PAGE_W, h: PAGE_H };
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 手搓最小 PDF：每页一张铺满的 JPEG（/DCTDecode），多页拼成图集 */
function buildPdf(pages: { jpeg: Uint8Array; w: number; h: number }[]): Uint8Array {
  const enc = (s: string) => Uint8Array.from(s, (ch) => ch.charCodeAt(0) & 0xff);
  const chunks: Uint8Array[] = [];
  let len = 0;
  const offsets: number[] = [];
  const push = (u: Uint8Array) => {
    chunks.push(u);
    len += u.length;
  };
  const str = (s: string) => push(enc(s));
  const startObj = (n: number) => {
    offsets[n] = len;
  };

  const totalObjs = 2 + pages.length * 3;
  str("%PDF-1.3\n");

  startObj(1);
  str("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  startObj(2);
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ");
  str(`2 0 obj\n<< /Type /Pages /Kids [ ${kids} ] /Count ${pages.length} >>\nendobj\n`);

  pages.forEach((pg, i) => {
    const pageN = 3 + i * 3;
    const contentN = 4 + i * 3;
    const imgN = 5 + i * 3;

    startObj(pageN);
    str(
      `${pageN} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pg.w} ${pg.h}] ` +
        `/Resources << /XObject << /Im0 ${imgN} 0 R >> >> /Contents ${contentN} 0 R >>\nendobj\n`
    );

    const content = `q\n${pg.w} 0 0 ${pg.h} 0 0 cm\n/Im0 Do\nQ\n`;
    startObj(contentN);
    str(`${contentN} 0 obj\n<< /Length ${content.length} >>\nstream\n`);
    str(content);
    str("endstream\nendobj\n");

    startObj(imgN);
    str(
      `${imgN} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pg.w} /Height ${pg.h} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.jpeg.length} >>\nstream\n`
    );
    push(pg.jpeg);
    str("\nendstream\nendobj\n");
  });

  const xrefOffset = len;
  str(`xref\n0 ${totalObjs + 1}\n`);
  str("0000000000 65535 f \n");
  for (let n = 1; n <= totalObjs; n++) {
    str(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  }
  str(`trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** 字节 → base64（分块避免 apply 爆栈），供 saveFile 落盘 */
export function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** 生成联系表 PDF 字节。cols 列；行数按页高自适应 */
export async function buildContactSheetPdf(
  items: SheetItem[],
  title: string,
  cols = 3
): Promise<Uint8Array> {
  // 估算每页行数：首页留标题高度，按统一行数排版（用首页行数即可，差异可接受）
  const top = MARGIN + TITLE_H;
  const cellW = (PAGE_W - MARGIN * 2 - GAP * (cols - 1)) / cols;
  const cellH = cellW + CAPTION_H - CAPTION_H * 0; // 近似方格 + 标注
  const rows = Math.max(1, Math.floor((PAGE_H - top - MARGIN + GAP) / (cellH + GAP)));
  const perPage = cols * rows;

  const pages: { jpeg: Uint8Array; w: number; h: number }[] = [];
  for (let i = 0; i < items.length; i += perPage) {
    const slice = items.slice(i, i + perPage);
    const pageTitle = i === 0 ? `${title} · 共 ${items.length} 张` : null;
    pages.push(await renderPage(slice, cols, rows, pageTitle));
  }
  return buildPdf(pages);
}
