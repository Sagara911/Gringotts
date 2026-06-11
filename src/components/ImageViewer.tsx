// 看图 / 练习全屏浮层：画师作画辅助工具（PureRef 式参考板的杀手锏）。
// 三件套——取色器（从参考图吸色攒色板）、速写计时器（定时轮播练 gesture）、
// 灰度/镜像/模糊（一键换看法：看明暗 / 看构图 / 看大色块）。
// 自包含哑组件：收 assets 播放列表 + 起始 index + onClose，内部无后端调用。
import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Asset } from "../types";
import "./ImageViewer.css";

const TIMER_PRESETS = [30, 60, 90, 120, 300]; // 秒
const PALETTE_MAX = 24;

const rgbToHex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");

const fmtSec = (s: number) =>
  s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s}s`;

export default function ImageViewer({
  assets,
  index,
  onClose,
}: {
  assets: Asset[];
  index: number;
  onClose: () => void;
}) {
  const count = assets.length;
  const [idx, setIdx] = useState(Math.min(Math.max(0, index), Math.max(0, count - 1)));

  // 看法切换
  const [gray, setGray] = useState(false);
  const [mirror, setMirror] = useState(false);
  const [blur, setBlur] = useState(false);
  const [picking, setPicking] = useState(false);

  // 取色板（跨图累积）
  const [palette, setPalette] = useState<string[]>([]);
  const [toast, setToast] = useState("");

  // 速写计时器
  const [interval, setIntervalSec] = useState(0); // 0=关
  const [remain, setRemain] = useState(0);
  const [running, setRunning] = useState(false);
  const [shuffle, setShuffle] = useState(false);

  const asset = assets[idx];
  const [objUrl, setObjUrl] = useState("");
  const [tainted, setTainted] = useState(false); // 取色画布是否被污染（取不了色）
  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // 顺序前后翻
  const go = useCallback(
    (d: number) => count > 0 && setIdx((i) => (i + d + count) % count),
    [count]
  );
  // 计时器推进：随机模式下跳到不同的随机张，否则顺序下一张
  const advance = useCallback(() => {
    if (count <= 1) return;
    setIdx((i) => {
      if (!shuffle) return (i + 1) % count;
      let n = i;
      while (n === i) n = Math.floor(Math.random() * count);
      return n;
    });
  }, [count, shuffle]);

  // 当前图：fetch→blob objectURL（同源 blob，取色画布不被跨源污染）
  useEffect(() => {
    if (!asset) return;
    let url = "";
    let alive = true;
    setTainted(false);
    fetch(convertFileSrc(asset.path))
      .then((r) => r.blob())
      .then((b) => {
        if (!alive) return;
        url = URL.createObjectURL(b);
        setObjUrl(url);
      })
      .catch(() => {
        // 退化：直接用 asset 协议地址（可显示，但取色可能被污染）
        if (alive) {
          setObjUrl(convertFileSrc(asset.path));
          setTainted(true);
        }
      });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [asset?.id]);

  // 图加载完把真实像素画进取色画布（封顶 2000px 控内存；CSS 滤镜不影响 drawImage 取真色）
  const onImgLoad = () => {
    const img = imgRef.current;
    const cv = canvasRef.current;
    if (!img || !cv) return;
    const max = 2000;
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight, 1));
    cv.width = Math.max(1, Math.round(img.naturalWidth * scale));
    cv.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const cx = cv.getContext("2d", { willReadFrequently: true });
    if (!cx) return;
    try {
      cx.drawImage(img, 0, 0, cv.width, cv.height);
    } catch {
      setTainted(true);
    }
  };

  const copy = (hex: string) => {
    navigator.clipboard.writeText(hex).catch(() => {});
    setToast(`已复制 ${hex}`);
  };

  const addColor = (hex: string) => {
    setPalette((p) => (p.includes(hex) ? p : [hex, ...p].slice(0, PALETTE_MAX)));
    copy(hex);
  };

  // 在图上点 → 取色
  const sample = (e: React.MouseEvent) => {
    if (!picking) return;
    const img = imgRef.current;
    const cv = canvasRef.current;
    if (!img || !cv) return;
    const rect = img.getBoundingClientRect();
    let nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;
    if (mirror) nx = 1 - nx; // 镜像显示时翻回真实横坐标
    const px = Math.min(cv.width - 1, Math.max(0, Math.floor(nx * cv.width)));
    const py = Math.min(cv.height - 1, Math.max(0, Math.floor(ny * cv.height)));
    const cx = cv.getContext("2d", { willReadFrequently: true });
    if (!cx) return;
    try {
      const d = cx.getImageData(px, py, 1, 1).data;
      addColor(rgbToHex(d[0], d[1], d[2]));
    } catch {
      setToast("无法取色（图像受保护）");
      setTainted(true);
    }
  };

  // toast 自动消失
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 1400);
    return () => clearTimeout(t);
  }, [toast]);

  // 计时器倒计时
  useEffect(() => {
    if (!running || interval <= 0) return;
    const t = setInterval(() => {
      setRemain((r) => {
        if (r <= 1) {
          advance();
          return interval;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [running, interval, advance]);

  const startTimer = (sec: number) => {
    setIntervalSec(sec);
    setRemain(sec);
    setRunning(true);
  };
  const stopTimer = () => {
    setRunning(false);
    setIntervalSec(0);
    setRemain(0);
  };

  // 键盘
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          onClose();
          break;
        case "ArrowRight":
          go(1);
          break;
        case "ArrowLeft":
          go(-1);
          break;
        case " ":
          if (interval > 0) {
            e.preventDefault();
            setRunning((r) => !r);
          }
          break;
        case "g":
        case "G":
          setGray((v) => !v);
          break;
        case "m":
        case "M":
          setMirror((v) => !v);
          break;
        case "b":
        case "B":
          setBlur((v) => !v);
          break;
        case "i":
        case "I":
          setPicking((v) => !v);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose, interval]);

  if (!asset) return null;
  const filter =
    [gray && "grayscale(1)", blur && "blur(12px)"].filter(Boolean).join(" ") || "none";
  const transform = mirror ? "scaleX(-1)" : "none";

  return (
    <div className="iv-overlay" onClick={onClose}>
      <div className="iv-stage" onClick={(e) => e.stopPropagation()}>
        {/* 顶栏：看法切换 + 取色器 + 关闭 */}
        <div className="iv-toolbar">
          <div className="iv-group">
            <button
              className={"iv-tool" + (picking ? " on" : "")}
              onClick={() => setPicking((v) => !v)}
              title="取色器（I）：点图吸色，自动复制并攒进色板"
            >
              🎨 取色
            </button>
            <button
              className={"iv-tool" + (gray ? " on" : "")}
              onClick={() => setGray((v) => !v)}
              title="灰度（G）：看明暗关系"
            >
              灰度
            </button>
            <button
              className={"iv-tool" + (mirror ? " on" : "")}
              onClick={() => setMirror((v) => !v)}
              title="镜像（M）：翻转看构图破绽"
            >
              镜像
            </button>
            <button
              className={"iv-tool" + (blur ? " on" : "")}
              onClick={() => setBlur((v) => !v)}
              title="模糊（B）：眯眼看大色块/明暗团"
            >
              模糊
            </button>
          </div>
          <div className="iv-title" title={asset.name}>
            {asset.name}
            <span className="iv-sub">
              {idx + 1}/{count} · {asset.width}×{asset.height}
            </span>
          </div>
          <button className="iv-close" onClick={onClose} title="关闭（Esc）">
            ✕
          </button>
        </div>

        {/* 中央图 */}
        <div className="iv-canvas">
          {count > 1 && (
            <button className="iv-nav left" onClick={() => go(-1)} title="上一张（←）">
              ‹
            </button>
          )}
          <img
            ref={imgRef}
            className={"iv-img" + (picking ? " picking" : "")}
            src={objUrl}
            alt={asset.name}
            onLoad={onImgLoad}
            onClick={sample}
            style={{ filter, transform }}
            draggable={false}
          />
          {count > 1 && (
            <button className="iv-nav right" onClick={() => go(1)} title="下一张（→）">
              ›
            </button>
          )}
          <canvas ref={canvasRef} style={{ display: "none" }} />
          {toast && <div className="iv-toast">{toast}</div>}
        </div>

        {/* 底栏：速写计时器 + 色板 */}
        <div className="iv-bottom">
          <div className="iv-timer">
            <span className="iv-label">速写计时</span>
            {TIMER_PRESETS.map((s) => (
              <button
                key={s}
                className={"iv-chip" + (interval === s ? " on" : "")}
                onClick={() => startTimer(s)}
              >
                {fmtSec(s)}
              </button>
            ))}
            {interval > 0 && (
              <>
                <button
                  className="iv-chip play"
                  onClick={() => setRunning((r) => !r)}
                  title="暂停/继续（空格）"
                >
                  {running ? "⏸" : "▶"} {fmtSec(remain)}
                </button>
                <button
                  className={"iv-chip" + (shuffle ? " on" : "")}
                  onClick={() => setShuffle((v) => !v)}
                  title="随机顺序轮播"
                  disabled={count <= 1}
                >
                  🔀 随机
                </button>
                <button className="iv-chip" onClick={stopTimer}>
                  停止
                </button>
              </>
            )}
          </div>

          <div className="iv-palette">
            <span className="iv-label">{tainted ? "取色不可用" : "色板"}</span>
            {/* 本图已提取的主色：快速加入色板 */}
            {asset.colors?.slice(0, 6).map((c, i) => (
              <button
                key={"src" + i}
                className="iv-swatch src"
                style={{ background: c }}
                title={`本图主色 ${c} · 点击加入色板`}
                onClick={() => addColor(c)}
              />
            ))}
            {palette.length > 0 && <span className="iv-divider" />}
            {palette.map((c, i) => (
              <button
                key={"p" + i}
                className="iv-swatch"
                style={{ background: c }}
                title={`${c} · 点击复制`}
                onClick={() => copy(c)}
              />
            ))}
            {palette.length > 0 && (
              <button className="iv-chip" onClick={() => setPalette([])} title="清空攒的色">
                清空
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
