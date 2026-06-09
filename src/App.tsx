import { useEffect, useState, useCallback } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import "./App.css";

interface Asset {
  id: number;
  path: string;
  name: string;
  format: string;
  width: number;
  height: number;
  sizeBytes: number;
  folder: string;
  source: string;
  author: string;
  tags: string[];
  addedAt: number;
  thumb: string;
}

function humanSize(bytes: number): string {
  if (!bytes) return "—";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

function Inspector({ asset }: { asset: Asset | null }) {
  if (!asset) {
    return (
      <section className="inspector">
        <div className="empty">从网格中选择一张素材查看详情</div>
      </section>
    );
  }
  return (
    <section className="inspector">
      <img className="preview" src={convertFileSrc(asset.path)} alt={asset.name} />
      <h3 title={asset.name}>{asset.name}</h3>
      <div className="dim">
        {asset.format} · {asset.width}×{asset.height} · {humanSize(asset.sizeBytes)}
      </div>

      <div className="section">
        <h5>来源</h5>
        <div className="dim">
          {asset.source || "—"}
          {asset.author ? ` · 作者 ${asset.author}` : ""}
        </div>
        <div className="dim path" title={asset.path}>
          {asset.path}
        </div>
      </div>

      <div className="section">
        <h5>标签</h5>
        <div className="tags">
          {asset.tags.length === 0 ? (
            <span className="dim">暂无（待 AI 自动打标）</span>
          ) : (
            asset.tags.map((t) => (
              <span className="tag" key={t}>
                {t}
              </span>
            ))
          )}
        </div>
      </div>

      <div className="section">
        <h5>✨ AI 操作</h5>
        <div className="ai-actions">
          <button className="ai-btn">
            反推绘画提示词<span className="hint">从这张图生成 SD/MJ 提示词</span>
          </button>
          <button className="ai-btn">
            自动打标签<span className="hint">Gemma / WD14（阶段二接入）</span>
          </button>
          <button className="ai-btn">
            找相似<span className="hint">向量检索视觉近似素材（阶段二）</span>
          </button>
          <button className="ai-btn">
            📌 加入参考板<span className="hint">摊到无限画布上对着画</span>
          </button>
        </div>
        <div className="placeholder-note">* AI 功能为占位，待接入本地模型 / API</div>
      </div>
    </section>
  );
}

function App() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const reload = useCallback(async () => {
    try {
      const list = await invoke<Asset[]>("list_assets");
      setAssets(list);
    } catch (e) {
      setStatus(`加载失败：${e}`);
    }
  }, []);

  const buildThumbs = useCallback(async () => {
    try {
      setStatus("正在生成缩略图…");
      const n = await invoke<number>("build_thumbnails");
      if (n > 0) await reload();
      setStatus(n > 0 ? `已生成 ${n} 张缩略图` : "");
    } catch (e) {
      setStatus(`缩略图生成失败：${e}`);
    }
  }, [reload]);

  useEffect(() => {
    (async () => {
      await reload();
      buildThumbs();
    })();
  }, [reload, buildThumbs]);

  async function handleImport() {
    try {
      const dir = await open({ directory: true, multiple: false });
      if (!dir || typeof dir !== "string") return;
      setBusy(true);
      setStatus("正在扫描…");
      const added = await invoke<number>("import_folder", { path: dir });
      await reload();
      setStatus(`已导入 ${added} 张新素材`);
      await buildThumbs();
    } catch (e) {
      setStatus(`导入失败：${e}`);
    } finally {
      setBusy(false);
    }
  }

  const filtered = assets.filter(
    (a) =>
      query.trim() === "" ||
      a.name.toLowerCase().includes(query.toLowerCase()) ||
      a.tags.some((t) => t.includes(query))
  );
  const selected = assets.find((a) => a.id === selectedId) ?? null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          🏦 Gringotts <small>古灵阁 · 素材金库</small>
        </div>
        <div className="search">
          <span className="icon">🔍</span>
          <input
            placeholder='搜索文件名 / 标签（例 "夜景" "厚涂"）'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button className="btn">筛选 ▾</button>
        <button className="btn primary" onClick={handleImport} disabled={busy}>
          {busy ? "导入中…" : "导入文件夹"}
        </button>
      </header>

      <aside className="sidebar">
        <div className="nav-group">
          <h4>资料库</h4>
          <div className="nav-item active">
            📁 <span>全部素材</span>
            <span className="count">{assets.length}</span>
          </div>
        </div>
        <div className="nav-group">
          <h4>智能合集</h4>
          <div className="nav-item">⭐ <span>最近导入</span><span className="count">{assets.length}</span></div>
          <div className="nav-item">⭐ <span>按风格</span><span className="count">—</span></div>
          <div className="nav-item">⭐ <span>按配色</span><span className="count">—</span></div>
          <div className="nav-item">⭐ <span>重复项（视觉近似）</span><span className="count">0</span></div>
        </div>
        <div className="nav-group">
          <h4>标签</h4>
          <div className="nav-item child dim">（待 AI 自动打标后出现）</div>
        </div>
      </aside>

      <main className="grid-wrap">
        <div className="grid-head">
          <span>全部素材 · {filtered.length} 项</span>
          <span>{status}</span>
        </div>

        {assets.length === 0 ? (
          <div className="empty big">
            金库还是空的 🏦
            <div className="placeholder-note">
              点右上角「导入文件夹」选一个图片目录，开始建立你的素材库
            </div>
          </div>
        ) : (
          <div className="grid">
            {filtered.map((a) => (
              <div
                key={a.id}
                className={"card" + (a.id === selectedId ? " selected" : "")}
                onClick={() => setSelectedId(a.id)}
              >
                <div className="thumb">
                  <img src={convertFileSrc(a.thumb || a.path)} loading="lazy" alt={a.name} />
                </div>
                <div className="meta">
                  <div className="name" title={a.name}>
                    {a.name}
                  </div>
                  <div className="sub">
                    {a.format} · {a.width}×{a.height}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {assets.length > 0 && filtered.length === 0 && (
          <div className="empty">没有匹配「{query}」的素材</div>
        )}
      </main>

      <Inspector asset={selected} />
    </div>
  );
}

export default App;
