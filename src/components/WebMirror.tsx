// 看球镜像小窗：把一个网页"拉到桌面"，无边框/透明/永远置顶，浮在别的软件上方看直播。
// 独立的第二个 WebviewWindow（label=web-*），main.tsx 按 #web 路由到这里。
// 与悬浮参考浮窗（RefWindow）同款窗体；内容区从"贴图片"换成"贴网页 iframe"，顶栏加地址栏。
// 注意：部分站点用 X-Frame-Options/CSP 禁止被 iframe 嵌入，这类页会拒载——换能嵌的源即可。
import { useRef, useState } from "react";
import { getCurrentWebviewWindow, WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalSize } from "@tauri-apps/api/dpi";
import "./WebMirror.css";

const LS_KEY = "nobi.webmirror.url";

function parseHash() {
  const q = location.hash.includes("?") ? location.hash.slice(location.hash.indexOf("?") + 1) : "";
  return new URLSearchParams(q).get("u") || "";
}

// 裸域名补 https://，已带协议则原样
function normalizeUrl(s: string): string {
  const t = s.trim();
  if (!t) return "";
  return /^[a-z]+:\/\//i.test(t) ? t : `https://${t}`;
}

export default function WebMirror() {
  const initial = useRef(parseHash()).current;
  const [url, setUrl] = useState(initial); // 实际加载的地址
  const [input, setInput] = useState(initial); // 地址栏文本
  const [opacity, setOpacity] = useState(1);
  // 惰性取窗：放进事件回调，避免无 Tauri 运行时（纯浏览器预览）渲染期就抛错
  const win = () => getCurrentWebviewWindow();

  const go = () => {
    const u = normalizeUrl(input);
    setInput(u);
    setUrl(u);
    try {
      if (u) localStorage.setItem(LS_KEY, u);
    } catch {
      /* 预览环境无 localStorage，忽略 */
    }
  };

  // 兜底：iframe 被站点反嵌（X-Frame-Options/CSP）挡住白屏时用——开一个独立的带标题栏
  // 小窗，整窗直接加载外链（真浏览器窗，绕过反嵌）。代价：没有窗内地址栏，靠系统标题栏
  // 移动/关闭。仍带 web- 前缀，故老板键 Alt+` 一并能藏/恢复。
  const openDirect = () => {
    const u = normalizeUrl(input || url);
    if (!u) return;
    try {
      localStorage.setItem(LS_KEY, u);
    } catch {
      /* ignore */
    }
    try {
      new WebviewWindow(`web-d${Date.now()}`, {
        url: u,
        width: 480,
        height: 320,
        alwaysOnTop: true,
        resizable: true,
        title: "看球（直开外链）",
      });
    } catch {
      /* 无 Tauri 运行时（纯浏览器预览）忽略 */
    }
  };

  // 自驱缩放：手柄拖动直接 setSize（不走 OS startResizeDragging，避免本机闪烁）；宽高都跟手，
  // rAF 合帧限流。setPointerCapture 让指针滑过 iframe 时事件仍归手柄，不被 iframe 吞掉。
  const onResizeGrip = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.screenX;
    const startY = e.screenY;
    const startW = window.innerWidth;
    const startH = window.innerHeight;
    const w = win();
    e.currentTarget.setPointerCapture(e.pointerId);
    let nextW = startW;
    let nextH = startH;
    let raf = 0;
    const apply = () => {
      raf = 0;
      void w.setSize(new LogicalSize(Math.round(nextW), Math.round(nextH)));
    };
    const move = (ev: PointerEvent) => {
      nextW = Math.max(220, startW + (ev.screenX - startX));
      nextH = Math.max(160, startH + (ev.screenY - startY));
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const up = () => {
      if (raf) cancelAnimationFrame(raf);
      void w.setSize(new LogicalSize(Math.round(nextW), Math.round(nextH)));
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // 在顶栏空白处按下即拖整窗（系统级移动）；地址栏/按钮自身不触发（stopPropagation）
  const startDrag = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    void win().startDragging();
  };

  return (
    <div className={"wm-root" + (url ? "" : " bar-pinned")} style={{ opacity }}>
      {url ? (
        <iframe
          className="wm-frame"
          src={url}
          title="看球小窗"
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture; clipboard-write"
          allowFullScreen
          referrerPolicy="no-referrer-when-downgrade"
        />
      ) : (
        <div className="wm-empty">在顶栏地址栏输入网址 → 回车看球</div>
      )}

      <div className="wm-bar" onPointerDown={startDrag}>
        <input
          className="wm-url"
          value={input}
          placeholder="粘贴直播页网址，回车打开"
          spellCheck={false}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") go();
          }}
        />
        <button className="wm-go" title="打开" onPointerDown={(e) => e.stopPropagation()} onClick={go}>
          ▶
        </button>
        <button
          className="wm-go"
          title="直开：此站被 iframe 反嵌挡住(白屏)时用——开独立窗整窗加载，绕过拦截；但没有窗内地址栏，靠系统标题栏移动/关闭"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={openDirect}
        >
          ↗
        </button>
        <input
          className="wm-opacity"
          type="range"
          min={0.2}
          max={1}
          step={0.05}
          value={opacity}
          title="不透明度（压低别挡下面的活）"
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => setOpacity(Number(e.target.value))}
        />
        <button
          className="wm-close"
          title="关闭"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => void win().close()}
        >
          ✕
        </button>
      </div>

      {/* 右下角缩放手柄 */}
      <div className="wm-resize" title="拖动缩放" onPointerDown={onResizeGrip} />
    </div>
  );
}
