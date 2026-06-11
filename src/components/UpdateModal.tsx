// 自研更新弹窗（替代系统原生对话框）：Nobi 暗色风格 + 下载进度条。
import { useEffect, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import "./UpdateModal.css";

type Phase = "prompt" | "downloading" | "done" | "error";

export default function UpdateModal({
  update,
  onClose,
}: {
  update: Update;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("prompt");
  const [pct, setPct] = useState(0);
  const [err, setErr] = useState("");
  const [downloaded, setDownloaded] = useState(0);
  const [total, setTotal] = useState(0);

  // Esc 关闭（仅在非下载阶段）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase !== "downloading") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, onClose]);

  async function start() {
    setPhase("downloading");
    let got = 0;
    let len = 0;
    try {
      await update.downloadAndInstall((ev) => {
        if (ev.event === "Started") {
          len = ev.data.contentLength ?? 0;
          setTotal(len);
        } else if (ev.event === "Progress") {
          got += ev.data.chunkLength;
          setDownloaded(got);
          if (len > 0) setPct(Math.min(100, Math.round((got / len) * 100)));
        } else if (ev.event === "Finished") {
          setPct(100);
        }
      });
      setPhase("done");
    } catch (e) {
      setErr(String(e));
      setPhase("error");
    }
  }

  const mb = (n: number) => (n / 1024 / 1024).toFixed(1);

  return (
    <div className="upd-overlay" onClick={() => phase !== "downloading" && onClose()}>
      <div className="upd-modal" onClick={(e) => e.stopPropagation()}>
        <div className="upd-icon">✦</div>

        {phase === "prompt" && (
          <>
            <h3>发现新版本</h3>
            <div className="upd-ver">
              <span className="upd-old">v{update.currentVersion}</span>
              <span className="upd-arrow">→</span>
              <span className="upd-new">v{update.version}</span>
            </div>
            {update.body && <div className="upd-notes">{update.body}</div>}
            <div className="upd-actions">
              <button className="upd-btn ghost" onClick={onClose}>
                以后再说
              </button>
              <button className="upd-btn primary" onClick={start}>
                立即更新
              </button>
            </div>
          </>
        )}

        {phase === "downloading" && (
          <>
            <h3>正在更新…</h3>
            <div className="upd-bar">
              <div className="upd-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="upd-progress-text">
              {total > 0 ? `${mb(downloaded)} / ${mb(total)} MB · ${pct}%` : "连接中…"}
            </div>
          </>
        )}

        {phase === "done" && (
          <>
            <h3>更新完成 🎉</h3>
            <p className="upd-sub">重启 Nobi 后新版本生效。</p>
            <div className="upd-actions">
              <button className="upd-btn ghost" onClick={onClose}>
                稍后重启
              </button>
              <button className="upd-btn primary" onClick={() => relaunch()}>
                立即重启
              </button>
            </div>
          </>
        )}

        {phase === "error" && (
          <>
            <h3>更新失败</h3>
            <p className="upd-sub upd-err">{err}</p>
            <div className="upd-actions">
              <button className="upd-btn ghost" onClick={onClose}>
                关闭
              </button>
              <button className="upd-btn primary" onClick={start}>
                重试
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
