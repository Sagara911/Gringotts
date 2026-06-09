import { useEffect, useState, useCallback, useMemo } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
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
  colors: string[];
}

type Filter =
  | { kind: "all" }
  | { kind: "tag"; value: string }
  | { kind: "folder"; value: string }
  | { kind: "color"; value: string };

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

// ===== 配色分桶 =====
const COLOR_BUCKETS = [
  { key: "red", name: "红", hex: "#d04a4a" },
  { key: "orange", name: "橙", hex: "#d98a3a" },
  { key: "yellow", name: "黄", hex: "#d4c24a" },
  { key: "green", name: "绿", hex: "#5aa85a" },
  { key: "cyan", name: "青", hex: "#4ab5b5" },
  { key: "blue", name: "蓝", hex: "#4a6fd0" },
  { key: "purple", name: "紫", hex: "#8a5ad0" },
  { key: "pink", name: "粉", hex: "#d05a9a" },
  { key: "mono", name: "黑白灰", hex: "#888888" },
];

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, l];
}

function bucketOf(hex?: string): string {
  if (!hex) return "mono";
  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  if (s < 0.18 || l < 0.12 || l > 0.92) return "mono";
  if (h < 15 || h >= 345) return "red";
  if (h < 45) return "orange";
  if (h < 70) return "yellow";
  if (h < 170) return "green";
  if (h < 200) return "cyan";
  if (h < 255) return "blue";
  if (h < 290) return "purple";
  return "pink";
}

// 取画面里最鲜艳的色来归类（避免暗调图全被算成黑白灰）
function primaryBucket(colors: string[]): string {
  let best = "mono";
  let bestSat = -1;
  for (const c of colors) {
    const [r, g, b] = hexToRgb(c);
    const [, s, l] = rgbToHsl(r, g, b);
    if (s >= 0.18 && l >= 0.12 && l <= 0.92 && s > bestSat) {
      bestSat = s;
      best = bucketOf(c);
    }
  }
  return best;
}

function Inspector({
  asset,
  onAddTag,
  onRemoveTag,
}: {
  asset: Asset | null;
  onAddTag: (id: number, tag: string) => void;
  onRemoveTag: (id: number, tag: string) => void;
}) {
  const [tagInput, setTagInput] = useState("");
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
          {asset.tags.map((t) => (
            <span className="tag removable" key={t} onClick={() => onRemoveTag(asset.id, t)}>
              {t} <span className="x">×</span>
            </span>
          ))}
        </div>
        <input
          className="tag-input"
          placeholder="添加标签后回车（可用 / 分层，如 场景/夜景）"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && tagInput.trim()) {
              onAddTag(asset.id, tagInput.trim());
              setTagInput("");
            }
          }}
        />
      </div>

      <div className="section">
        <h5>配色</h5>
        <div className="palette">
          {asset.colors.length === 0 ? (
            <span className="dim">—</span>
          ) : (
            asset.colors.map((c, i) => (
              <div className="swatch" key={c + i} style={{ background: c }} title={c} />
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
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [batchTag, setBatchTag] = useState("");

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
      setStatus("正在生成缩略图 / 提取配色…");
      const n = await invoke<number>("build_thumbnails");
      if (n > 0) await reload();
      setStatus(n > 0 ? `已处理 ${n} 张（缩略图 / 配色）` : "");
    } catch (e) {
      setStatus(`处理失败：${e}`);
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

  async function handleExport() {
    try {
      const path = await save({
        defaultPath: "gringotts-metadata.json",
        filters: [
          { name: "JSON", extensions: ["json"] },
          { name: "CSV", extensions: ["csv"] },
        ],
      });
      if (!path) return;
      const format = path.toLowerCase().endsWith(".csv") ? "csv" : "json";
      const n = await invoke<number>("export_metadata", { path, format });
      setStatus(`已导出 ${n} 条元数据 → ${path}`);
    } catch (e) {
      setStatus(`导出失败：${e}`);
    }
  }

  async function addTag(id: number, tag: string) {
    const a = assets.find((x) => x.id === id);
    if (!a) return;
    const next = a.tags.includes(tag) ? a.tags : [...a.tags, tag];
    await invoke("set_tags", { id, tags: next });
    await reload();
  }
  async function removeTag(id: number, tag: string) {
    const a = assets.find((x) => x.id === id);
    if (!a) return;
    await invoke("set_tags", { id, tags: a.tags.filter((t) => t !== tag) });
    await reload();
  }
  async function applyBatchTag() {
    const t = batchTag.trim();
    if (!t || sel.size === 0) return;
    await invoke("add_tag_bulk", { ids: Array.from(sel), tag: t });
    setBatchTag("");
    await reload();
    setStatus(`已给 ${sel.size} 项添加标签「${t}」`);
  }

  function onCardClick(e: React.MouseEvent, id: number) {
    if (e.ctrlKey || e.metaKey) {
      setSel((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    } else {
      setSel(new Set([id]));
    }
    setSelectedId(id);
  }

  // ===== 侧边栏派生数据 =====
  const folders = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of assets) if (a.folder) m.set(a.folder, (m.get(a.folder) ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [assets]);

  const tags = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of assets) for (const t of a.tags) m.set(t, (m.get(t) ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [assets]);

  const colorCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of assets) {
      const k = primaryBucket(a.colors);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [assets]);

  // ===== 过滤 =====
  const matchesFilter = (a: Asset) => {
    switch (filter.kind) {
      case "all":
        return true;
      case "tag":
        return a.tags.some((t) => t === filter.value || t.startsWith(filter.value + "/"));
      case "folder":
        return a.folder === filter.value;
      case "color":
        return primaryBucket(a.colors) === filter.value;
    }
  };
  const matchesQuery = (a: Asset) =>
    query.trim() === "" ||
    a.name.toLowerCase().includes(query.toLowerCase()) ||
    a.tags.some((t) => t.includes(query));

  const filtered = assets.filter((a) => matchesFilter(a) && matchesQuery(a));
  const selected = assets.find((a) => a.id === selectedId) ?? null;

  const isActive = (f: Filter) =>
    f.kind === filter.kind &&
    (f.kind === "all" || (f as any).value === (filter as any).value);

  const filterLabel =
    filter.kind === "all"
      ? "全部素材"
      : filter.kind === "tag"
      ? `标签：${filter.value}`
      : filter.kind === "folder"
      ? `文件夹：${filter.value}`
      : `配色：${COLOR_BUCKETS.find((c) => c.key === filter.value)?.name ?? filter.value}`;

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
        <button className="btn" onClick={handleExport} title="导出元数据（不锁定）">
          导出
        </button>
        <button className="btn primary" onClick={handleImport} disabled={busy}>
          {busy ? "导入中…" : "导入文件夹"}
        </button>
      </header>

      <aside className="sidebar">
        <div className="nav-group">
          <h4>资料库</h4>
          <div
            className={"nav-item" + (isActive({ kind: "all" }) ? " active" : "")}
            onClick={() => setFilter({ kind: "all" })}
          >
            📁 <span>全部素材</span>
            <span className="count">{assets.length}</span>
          </div>
        </div>

        {folders.length > 0 && (
          <div className="nav-group">
            <h4>文件夹</h4>
            {folders.map(([name, count]) => (
              <div
                key={name}
                className={
                  "nav-item" + (isActive({ kind: "folder", value: name }) ? " active" : "")
                }
                onClick={() => setFilter({ kind: "folder", value: name })}
              >
                🗂 <span className="ellip">{name}</span>
                <span className="count">{count}</span>
              </div>
            ))}
          </div>
        )}

        <div className="nav-group">
          <h4>配色</h4>
          <div className="color-grid">
            {COLOR_BUCKETS.map((c) => (
              <div
                key={c.key}
                className={
                  "color-chip" + (isActive({ kind: "color", value: c.key }) ? " active" : "")
                }
                title={`${c.name} · ${colorCounts.get(c.key) ?? 0}`}
                onClick={() => setFilter({ kind: "color", value: c.key })}
              >
                <span className="dot" style={{ background: c.hex }} />
                {c.name}
              </div>
            ))}
          </div>
        </div>

        <div className="nav-group">
          <h4>标签</h4>
          {tags.length === 0 ? (
            <div className="nav-item child dim">（暂无，选中图片后可打标签）</div>
          ) : (
            tags.map(([name, count]) => (
              <div
                key={name}
                className={
                  "nav-item child" + (isActive({ kind: "tag", value: name }) ? " active" : "")
                }
                onClick={() => setFilter({ kind: "tag", value: name })}
              >
                🏷 <span className="ellip">{name}</span>
                <span className="count">{count}</span>
              </div>
            ))
          )}
        </div>
      </aside>

      <main className="grid-wrap">
        <div className="grid-head">
          <span>
            {filterLabel} · {filtered.length} 项
          </span>
          <span>{status}</span>
        </div>

        {sel.size > 1 && (
          <div className="batch-bar">
            <span>已选 {sel.size} 项</span>
            <input
              placeholder="批量打标签后回车"
              value={batchTag}
              onChange={(e) => setBatchTag(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyBatchTag()}
            />
            <button className="btn" onClick={applyBatchTag}>
              打标签
            </button>
            <button className="btn" onClick={() => setSel(new Set())}>
              清除选择
            </button>
          </div>
        )}

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
                className={
                  "card" +
                  (a.id === selectedId ? " selected" : "") +
                  (sel.has(a.id) ? " multi" : "")
                }
                onClick={(e) => onCardClick(e, a.id)}
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
          <div className="empty">没有匹配的素材</div>
        )}
      </main>

      <Inspector asset={selected} onAddTag={addTag} onRemoveTag={removeTag} />
    </div>
  );
}

export default App;
