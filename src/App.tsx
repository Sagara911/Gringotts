import { useState } from "react";
import "./App.css";
import {
  MOCK_ASSETS,
  FOLDERS,
  SMART_COLLECTIONS,
  ALL_TAGS,
  type Asset,
} from "./mockData";

function thumbStyle(colors: string[]): React.CSSProperties {
  const [a, b, c] = colors;
  return {
    background: `linear-gradient(135deg, ${a} 0%, ${b ?? a} 60%, ${c ?? b ?? a} 100%)`,
  };
}

function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="nav-group">
        <h4>资料库</h4>
        {FOLDERS.map((f) => (
          <div key={f.name} className={"nav-item" + (f.active ? " active" : "")}>
            📁 <span>{f.name}</span>
            <span className="count">{f.count}</span>
          </div>
        ))}
      </div>

      <div className="nav-group">
        <h4>智能合集</h4>
        {SMART_COLLECTIONS.map((s) => (
          <div key={s.name} className="nav-item">
            ⭐ <span>{s.name}</span>
            <span className="count">{s.count}</span>
          </div>
        ))}
      </div>

      <div className="nav-group">
        <h4>标签</h4>
        {ALL_TAGS.map((t) => (
          <div key={t} className="nav-item child">
            🏷 {t}
          </div>
        ))}
      </div>
    </aside>
  );
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
      <div className="preview" style={thumbStyle(asset.colors)} />
      <h3>{asset.name}</h3>
      <div className="dim">
        {asset.format} · {asset.width}×{asset.height}
      </div>

      <div className="section">
        <h5>来源</h5>
        <div className="dim">
          {asset.source} · 作者 {asset.author}
        </div>
      </div>

      <div className="section">
        <h5>标签</h5>
        <div className="tags">
          {asset.tags.map((t) => (
            <span className="tag" key={t}>
              {t}
            </span>
          ))}
        </div>
      </div>

      <div className="section">
        <h5>配色</h5>
        <div className="palette">
          {asset.colors.map((c) => (
            <div className="swatch" key={c} style={{ background: c }} title={c} />
          ))}
        </div>
      </div>

      <div className="section">
        <h5>✨ AI 操作</h5>
        <div className="ai-actions">
          <button className="ai-btn">
            反推绘画提示词
            <span className="hint">从这张图生成 SD/MJ 提示词</span>
          </button>
          <button className="ai-btn">
            分析画面
            <span className="hint">打光 / 构图 / 配色拉片</span>
          </button>
          <button className="ai-btn">
            找相似
            <span className="hint">在库里检索视觉近似的素材</span>
          </button>
          <button className="ai-btn">
            📌 加入参考板
            <span className="hint">摊到无限画布上对着画</span>
          </button>
        </div>
        <div className="placeholder-note">* AI 功能为占位，待接入本地模型 / API</div>
      </div>
    </section>
  );
}

function App() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState("");

  const assets = MOCK_ASSETS.filter(
    (a) =>
      query.trim() === "" ||
      a.name.includes(query) ||
      a.tags.some((t) => t.includes(query))
  );
  const selected = MOCK_ASSETS.find((a) => a.id === selectedId) ?? null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          🏦 Gringotts <small>古灵阁 · 素材金库</small>
        </div>
        <div className="search">
          <span className="icon">🔍</span>
          <input
            placeholder='用大白话搜：例 "夜景 赛博朋克" 或 "厚涂"'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button className="btn">筛选 ▾</button>
        <button className="btn">导入</button>
      </header>

      <Sidebar />

      <main className="grid-wrap">
        <div className="grid-head">
          <span>全部素材 · {assets.length} 项</span>
          <span>缩略图 ⊞</span>
        </div>
        <div className="grid">
          {assets.map((a) => (
            <div
              key={a.id}
              className={"card" + (a.id === selectedId ? " selected" : "")}
              onClick={() => setSelectedId(a.id)}
            >
              <div className="thumb" style={thumbStyle(a.colors)} />
              <div className="meta">
                <div className="name">{a.name}</div>
                <div className="sub">
                  {a.format} · {a.width}×{a.height}
                </div>
              </div>
            </div>
          ))}
        </div>
        {assets.length === 0 && <div className="empty">没有匹配的素材</div>}
      </main>

      <Inspector asset={selected} />
    </div>
  );
}

export default App;
