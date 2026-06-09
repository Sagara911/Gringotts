// 内置 CLIP（transformers.js，从 CDN 动态加载，自包含、零安装）。
// 中文查询先用 opus-mt 翻成英文，再喂给 CLIP 文本编码器。
// 模型首次使用时从 HuggingFace CDN 下载并缓存，之后离线可用。

const TJS = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0";
const CLIP_ID = "Xenova/clip-vit-base-patch32";
const MT_ID = "Xenova/opus-mt-zh-en";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _t: any = null;
async function lib() {
  if (!_t) _t = await import(/* @vite-ignore */ TJS);
  return _t;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _clip: any = null;
async function clip() {
  if (_clip) return _clip;
  const t = await lib();
  const [tok, tmodel, proc, vmodel] = await Promise.all([
    t.AutoTokenizer.from_pretrained(CLIP_ID),
    t.CLIPTextModelWithProjection.from_pretrained(CLIP_ID),
    t.AutoProcessor.from_pretrained(CLIP_ID),
    t.CLIPVisionModelWithProjection.from_pretrained(CLIP_ID),
  ]);
  _clip = { RawImage: t.RawImage, tok, tmodel, proc, vmodel };
  return _clip;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _tr: any = null;
async function translateIfCN(text: string): Promise<string> {
  if (!/[一-鿿]/.test(text)) return text; // 无中文则跳过翻译
  const t = await lib();
  if (!_tr) _tr = await t.pipeline("translation", MT_ID);
  const out = await _tr(text);
  return out?.[0]?.translation_text || text;
}

/** 文本 → CLIP 向量（中文自动翻英） */
export async function textVector(text: string): Promise<number[]> {
  const en = await translateIfCN(text);
  const c = await clip();
  const inputs = c.tok([en], { padding: true, truncation: true });
  const out = await c.tmodel(inputs);
  return Array.from(out.text_embeds.data as Float32Array);
}

/** 图片 URL → CLIP 向量 */
export async function imageVector(url: string): Promise<number[]> {
  const c = await clip();
  const img = await c.RawImage.read(url);
  const inputs = await c.proc(img);
  const out = await c.vmodel(inputs);
  return Array.from(out.image_embeds.data as Float32Array);
}
