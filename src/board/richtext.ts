// 富文本排版引擎 + TipTap 文档互转（纯函数，无 React/Konva 依赖）。
// 渲染端：runs → 逐段测量 → 自动换行 → 行内分段坐标，交给 Konva 摆放。
// 编辑端：runs ↔ TipTap JSON 文档（bold/italic/underline/textStyle.color 四种 mark）。
import { FONT_FAMILY, colorHex, type RichRun, type TextShape } from "./store";

export interface RichSeg {
  text: string;
  x: number;
  w: number;
  run: RichRun;
}
export interface RichLine {
  segs: RichSeg[];
  width: number;
}
export interface RichLayout {
  lines: RichLine[];
  width: number;
  height: number;
}

let mctx: CanvasRenderingContext2D | null = null;

export function runFont(fontSize: number, run: { bold?: boolean; italic?: boolean }): string {
  return `${run.italic ? "italic " : ""}${run.bold ? "bold " : ""}${fontSize}px ${FONT_FAMILY}`;
}

function measure(text: string, font: string): number {
  if (!mctx) mctx = document.createElement("canvas").getContext("2d")!;
  mctx.font = font;
  return mctx.measureText(text).width;
}

/** 分词（决定折行点）：CJK 单字可断、连续拉丁/数字成词、空白独立成段 */
function tokenize(text: string): string[] {
  const out: string[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push(buf);
    buf = "";
  };
  for (const ch of text) {
    if (/\s/.test(ch)) {
      flush();
      // 连续空白合并
      if (out.length && /^\s+$/.test(out[out.length - 1])) out[out.length - 1] += ch;
      else out.push(ch);
    } else if (/[⺀-鿿豈-﫿＀-￯　-〿]/.test(ch)) {
      flush();
      out.push(ch); // CJK：单字成词
    } else {
      buf += ch;
    }
  }
  flush();
  return out;
}

/** 混排布局：maxW 为换行宽度（无则只按 \n 分行） */
export function layoutRuns(runs: RichRun[], fontSize: number, maxW?: number): RichLayout {
  const lines: RichLine[] = [];
  let segs: RichSeg[] = [];
  let x = 0;
  const pushLine = () => {
    lines.push({ segs, width: x });
    segs = [];
    x = 0;
  };

  for (const run of runs) {
    const font = runFont(fontSize, run);
    const paras = run.text.split("\n");
    paras.forEach((para, pi) => {
      let buf = "";
      let bufW = 0;
      const flushBuf = () => {
        if (buf) {
          segs.push({ text: buf, x, w: bufW, run });
          x += bufW;
          buf = "";
          bufW = 0;
        }
      };
      const tokens = maxW ? tokenize(para) : para ? [para] : [];
      for (const tk of tokens) {
        const w = measure(tk, font);
        if (maxW && x + bufW + w > maxW && x + bufW > 0) {
          flushBuf();
          pushLine();
          if (/^\s+$/.test(tk)) continue; // 行首空白丢弃
        }
        if (maxW && w > maxW && tk.length > 1) {
          // 单词比整行还宽：逐字符硬断
          for (const ch of tk) {
            const cw = measure(ch, font);
            if (x + bufW + cw > maxW && x + bufW > 0) {
              flushBuf();
              pushLine();
            }
            buf += ch;
            bufW += cw;
          }
        } else {
          buf += tk;
          bufW += w;
        }
      }
      flushBuf();
      if (pi < paras.length - 1) pushLine(); // 手动换行
    });
  }
  pushLine();
  const width = Math.max(1, ...lines.map((l) => l.width));
  return { lines, width, height: Math.max(1, lines.length) * fontSize * 1.35 };
}

// ---------- TipTap 文档互转 ----------

const sameStyle = (a: RichRun, b: RichRun) =>
  !!a.bold === !!b.bold &&
  !!a.italic === !!b.italic &&
  !!a.underline === !!b.underline &&
  (a.color ?? "") === (b.color ?? "");

/** runs → TipTap JSON（\n 拆为段落） */
export function runsToDoc(runs: RichRun[]): Record<string, unknown> {
  const paras: unknown[] = [];
  let cur: unknown[] = [];
  const pushP = () => {
    paras.push({ type: "paragraph", ...(cur.length ? { content: cur } : {}) });
    cur = [];
  };
  for (const r of runs) {
    const parts = r.text.split("\n");
    parts.forEach((p, i) => {
      if (p) {
        const marks: unknown[] = [];
        if (r.bold) marks.push({ type: "bold" });
        if (r.italic) marks.push({ type: "italic" });
        if (r.underline) marks.push({ type: "underline" });
        if (r.color) marks.push({ type: "textStyle", attrs: { color: colorHex(r.color) } });
        cur.push({ type: "text", text: p, ...(marks.length ? { marks } : {}) });
      }
      if (i < parts.length - 1) pushP();
    });
  }
  pushP();
  return { type: "doc", content: paras };
}

/** TipTap JSON → runs（相邻同款分段合并，段落边界并入 \n） */
export function docToRuns(doc: unknown): RichRun[] {
  const runs: RichRun[] = [];
  const push = (r: RichRun) => {
    const last = runs[runs.length - 1];
    if (last && sameStyle(last, r)) last.text += r.text;
    else runs.push(r);
  };
  const paras = (doc as { content?: unknown[] })?.content ?? [];
  paras.forEach((p, pi) => {
    for (const n of (p as { content?: unknown[] })?.content ?? []) {
      const node = n as { type: string; text?: string; marks?: { type: string; attrs?: { color?: string } }[] };
      if (node.type !== "text" || !node.text) continue;
      const run: RichRun = { text: node.text };
      for (const m of node.marks ?? []) {
        if (m.type === "bold") run.bold = true;
        else if (m.type === "italic") run.italic = true;
        else if (m.type === "underline") run.underline = true;
        else if (m.type === "textStyle" && m.attrs?.color) run.color = m.attrs.color;
      }
      push(run);
    }
    if (pi < paras.length - 1) push({ text: "\n" });
  });
  // 末尾纯 \n run 合并产生的孤立空行保留（用户手动空行）；全空则返回 []
  return runs.length === 1 && runs[0].text === "" ? [] : runs;
}

export const runsToText = (runs: RichRun[]) => runs.map((r) => r.text).join("");

/** 形状 → 编辑用文档：有 runs 用 runs，否则把整块样式当作单一分段（旧数据兼容） */
export function shapeToDoc(s: TextShape): Record<string, unknown> {
  const runs: RichRun[] =
    s.runs && s.runs.length
      ? s.runs
      : [{ text: s.text, bold: s.bold, italic: s.italic, underline: s.underline }];
  return runsToDoc(runs);
}
