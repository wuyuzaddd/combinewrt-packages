import type { Catalog, CatalogPackage, CatalogVersion } from "./types.js";

export interface RenderOptions {
  baseUrl?: string;
  feedUrl?: string;
  keyUrl?: string;
}

export const DEFAULT_BASE_URL = "https://wuyuzaddd.github.io/combinewrt-packages";
export const DEFAULT_FEED_URL = `${DEFAULT_BASE_URL}/x86_64/packages.adb`;
export const DEFAULT_KEY_URL = `${DEFAULT_BASE_URL}/keys/combinewrt-feed.pub.pem`;

const STYLE = `
:root{color-scheme:light dark;--bg:#f7f8fa;--fg:#16181d;--muted:#5c6470;--card:#fff;--line:#dfe3e9;--accent:#2563eb;--accent-fg:#fff;--chip:#eef2f8;--code:#f1f3f6}
@media (prefers-color-scheme:dark){:root{--bg:#101216;--fg:#e8eaee;--muted:#9aa4b2;--card:#181b21;--line:#2a2f38;--accent:#60a5fa;--accent-fg:#0b1220;--chip:#222834;--code:#1c2027}}
*{box-sizing:border-box}html{background:var(--bg);color:var(--fg)}
body{margin:0;font:16px/1.65 ui-sans-serif,system-ui,-apple-system,"Segoe UI","Noto Sans SC",sans-serif}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:64rem;margin:0 auto;padding:0 1.25rem}
header.site{border-bottom:1px solid var(--line);background:var(--card)}
header.site .wrap{display:flex;align-items:center;justify-content:space-between;gap:1rem;min-height:3.5rem}
.brand{font-weight:700;color:var(--fg)}nav{display:flex;gap:1rem;flex-wrap:wrap;font-size:.95rem}
main{padding:2rem 0 3rem}
h1{font-size:2rem;line-height:1.2;margin:0 0 .5rem}h2{line-height:1.3}
p{margin:.5rem 0}.muted{color:var(--muted)}
.hero{padding:1rem 0 1.5rem;border-bottom:1px solid var(--line)}
.meta{display:flex;gap:.5rem 1rem;flex-wrap:wrap;color:var(--muted);font-size:.9rem;margin-top:.75rem}
.feed{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin-top:1rem}
code{background:var(--code);padding:.15rem .35rem;border-radius:4px;font-size:.9em;overflow-wrap:anywhere}
.feed code{padding:.5rem .6rem}
button{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--fg);padding:.45rem .8rem;border-radius:6px;cursor:pointer}
button:hover{border-color:var(--accent)}
.toolbar{display:flex;gap:.75rem;flex-wrap:wrap;align-items:center;padding:1.25rem 0}
.toolbar input,.toolbar select{font:inherit;padding:.5rem .6rem;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg);min-width:10rem}
.toolbar input{flex:1 1 16rem}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(17rem,1fr));gap:1rem;padding:0;margin:0;list-style:none}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:1rem;display:flex;flex-direction:column;gap:.6rem}
.card-head{display:flex;justify-content:space-between;gap:.5rem;align-items:baseline}
.card h2{font-size:1.05rem;margin:0}
.card p{margin:0;color:var(--muted);font-size:.92rem;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.chips{display:flex;gap:.4rem;flex-wrap:wrap;font-size:.78rem;color:var(--muted)}
.chip{background:var(--chip);padding:.15rem .45rem;border-radius:999px}
.version{font-size:.8rem;background:var(--chip);padding:.15rem .45rem;border-radius:999px;white-space:nowrap}
.download{margin-top:auto;display:inline-block;background:var(--accent);color:var(--accent-fg);padding:.5rem .8rem;border-radius:6px;text-align:center;font-weight:600}
.download:hover{text-decoration:none;filter:brightness(1.08)}
.breadcrumb{font-size:.9rem;color:var(--muted);margin-bottom:1rem}
.panel{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:1rem 1.25rem;margin:1.25rem 0}
dl.meta-grid{display:grid;grid-template-columns:max-content 1fr;gap:.4rem 1rem;margin:.5rem 0}
dl.meta-grid dt{color:var(--muted)}dl.meta-grid dd{margin:0}
table{width:100%;border-collapse:collapse;font-size:.92rem}
th,td{text-align:left;padding:.55rem .4rem;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:600}
.table-scroll{overflow-x:auto}
.deps{display:flex;gap:.4rem;flex-wrap:wrap;padding:0;margin:.5rem 0;list-style:none}
.deps li{background:var(--chip);padding:.2rem .5rem;border-radius:6px;font-size:.85rem}
.notice{border-left:3px solid var(--accent);padding:.25rem 0 .25rem .9rem;margin:1rem 0;color:var(--muted)}
footer.site{border-top:1px solid var(--line);color:var(--muted);font-size:.85rem;padding:1.5rem 0 2.5rem}
footer.site .wrap{display:flex;flex-direction:column;gap:.5rem}
[hidden]{display:none!important}
@media (max-width:40rem){h1{font-size:1.6rem}.toolbar input,.toolbar select{min-width:0;width:100%}}
`;

const FILTER_SCRIPT = `
(() => {
  const q = document.getElementById("q");
  const license = document.getElementById("license");
  const source = document.getElementById("source");
  const cards = Array.from(document.querySelectorAll(".card"));
  const count = document.getElementById("count");
  const empty = document.getElementById("empty");
  if (!q || !license || !source || cards.length === 0) return;
  const apply = () => {
    const term = q.value.trim().toLowerCase();
    let shown = 0;
    for (const card of cards) {
      const name = (card.dataset.name || "").toLowerCase();
      const description = (card.dataset.description || "").toLowerCase();
      const text = name + " " + description;
      const licenseOk =
        license.value === "" ||
        (license.value === "__none"
          ? (card.dataset.license || "") === ""
          : card.dataset.license === license.value);
      const ok =
        (term === "" || text.includes(term)) &&
        licenseOk &&
        (source.value === "" || card.dataset.source === source.value);
      card.hidden = !ok;
      if (ok) shown += 1;
    }
    if (count) count.textContent = shown + " 个软件包";
    if (empty) empty.hidden = shown !== 0;
  };
  for (const control of [q, license, source]) control.addEventListener("input", apply);
  apply();
})();
`;

const COPY_SCRIPT = `
(() => {
  for (const button of document.querySelectorAll("[data-copy]")) {
    button.addEventListener("click", async () => {
      const target = document.getElementById(button.dataset.copy);
      if (!target) return;
      const text = target.textContent || "";
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = "已复制";
      } catch {
        const range = document.createRange();
        range.selectNodeContents(target);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        button.textContent = "请手动复制";
      }
    });
  }
})();
`;

export function renderSite(catalog: Catalog, options: RenderOptions = {}): Map<string, string> {
  const feedUrl = options.feedUrl ?? catalog.feedUrl ?? DEFAULT_FEED_URL;
  const keyUrl = options.keyUrl ?? `${options.baseUrl ?? DEFAULT_BASE_URL}/keys/combinewrt-feed.pub.pem`;

  const files = new Map<string, string>();
  files.set("index.html", renderIndex(catalog, feedUrl));
  files.set("install.html", renderInstall(catalog, feedUrl, keyUrl));
  files.set("catalog.json", `${JSON.stringify(catalog, null, 2)}\n`);
  files.set("404.html", render404());
  files.set(".nojekyll", "");
  for (const entry of catalog.packages) {
    files.set(`packages/${entry.name}.html`, renderPackagePage(catalog, entry, feedUrl));
  }
  return files;
}

export function renderIndex(catalog: Catalog, feedUrl: string): string {
  const licenses = [...new Set(catalog.packages.map((entry) => entry.license).filter(Boolean))].sort();
  const sources = [...new Set(catalog.packages.map((entry) => entry.sourceRepo))].sort();

  const cards = catalog.packages
    .map(
      (entry) => `<li class="card" data-name="${escapeHtml(entry.name)}" data-description="${escapeHtml(
        entry.description,
      )}" data-license="${escapeHtml(entry.license)}" data-source="${escapeHtml(entry.sourceRepo)}">
  <div class="card-head"><h2><a href="packages/${encodeURIComponent(entry.name)}.html">${escapeHtml(
        entry.name,
      )}</a></h2><span class="version">${escapeHtml(entry.latest.version)}</span></div>
  <p>${escapeHtml(entry.description) || "暂无描述"}</p>
  <div class="chips"><span class="chip">${escapeHtml(entry.license) || "未声明许可"}</span><span class="chip">${formatBytes(
        entry.latest.fileSize,
      )}</span><span class="chip">${entry.versions.length} 个版本</span></div>
  <a class="download" href="x86_64/${encodeURIComponent(entry.latest.asset)}">下载 ${escapeHtml(
        entry.latest.version,
      )}</a>
</li>`,
    )
    .join("\n");

  const hasUnlicensed = catalog.packages.some((entry) => !entry.license);
  const body = `<section class="hero">
  <h1>CombineWRT 软件包</h1>
  <p class="muted">为 ImmortalWrt ${escapeHtml(catalog.baseVersion)}（${escapeHtml(
    catalog.arch,
  )}）构建的签名 apk 软件源。所有包都来自固定源码版本，索引使用 EC P-256 密钥签名。</p>
  <div class="meta"><span>固件基线 ${escapeHtml(catalog.baseVersion)}</span><span>架构 ${escapeHtml(
    catalog.arch,
  )}</span><span>构建 #${catalog.buildRunId}</span><span>更新于 ${escapeHtml(
    formatDate(catalog.generatedAt),
  )}</span></div>
  <div class="feed"><span class="muted">软件源</span><code id="feed-url">${escapeHtml(
    feedUrl,
  )}</code><button type="button" data-copy="feed-url">复制</button></div>
</section>
<section class="toolbar" aria-label="搜索与筛选">
  <input id="q" type="search" placeholder="搜索软件包名称或描述" autocomplete="off" />
  <select id="license" aria-label="按许可证筛选"><option value="">全部许可证</option>${licenses
    .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
    .join("")}${hasUnlicensed ? '<option value="__none">未声明许可</option>' : ""}</select>
  <select id="source" aria-label="按来源筛选"><option value="">全部来源</option>${sources
    .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
    .join("")}</select>
  <span id="count" class="muted">${catalog.packages.length} 个软件包</span>
</section>
<p id="empty" class="notice" hidden>没有匹配的软件包，试试其它关键词。</p>
<ul class="grid">
${cards}
</ul>`;

  return layout({
    title: "CombineWRT 软件包",
    description: "CombineWRT 的签名 apk 软件源与软件包目录",
    prefix: "",
    body,
    script: FILTER_SCRIPT + COPY_SCRIPT,
  });
}

export function renderPackagePage(catalog: Catalog, entry: CatalogPackage, feedUrl: string): string {
  const sourceLink = `https://github.com/${entry.sourceRepo}/tree/${entry.sourceCommit}/${entry.sourcePath}`;
  const versions = entry.versions
    .map(
      (version) => `<tr>
  <td><strong>${escapeHtml(version.version)}</strong>${version === entry.latest ? ' <span class="chip">最新</span>' : ""}</td>
  <td>${escapeHtml(formatDate(version.publishedAt))}</td>
  <td>${formatBytes(version.fileSize)}</td>
  <td><code title="${escapeHtml(version.sha256)}">${escapeHtml(version.sha256.slice(0, 16))}…</code></td>
  <td><a href="../x86_64/${encodeURIComponent(version.asset)}">下载</a></td>
</tr>`,
    )
    .join("\n");

  const deps =
    entry.latest.depends.length === 0
      ? '<p class="muted">无额外依赖。</p>'
      : `<ul class="deps">${entry.latest.depends
          .map((dep) => `<li>${escapeHtml(dep)}</li>`)
          .join("")}</ul>`;

  const body = `<p class="breadcrumb"><a href="../index.html">全部软件包</a> / ${escapeHtml(entry.name)}</p>
<h1>${escapeHtml(entry.name)}</h1>
<p class="muted">${escapeHtml(entry.description) || "暂无描述"}</p>
<p><a class="download" href="../x86_64/${encodeURIComponent(
    entry.latest.asset,
  )}">下载 ${escapeHtml(entry.latest.version)}</a></p>
<div class="panel">
  <h2>包信息</h2>
  <dl class="meta-grid">
    <dt>最新版本</dt><dd>${escapeHtml(entry.latest.version)}</dd>
    <dt>架构</dt><dd>${escapeHtml(entry.latest.arch)}</dd>
    <dt>文件大小</dt><dd>${formatBytes(entry.latest.fileSize)}</dd>
    <dt>安装后大小</dt><dd>${formatBytes(entry.latest.installedSize)}</dd>
    <dt>许可证</dt><dd>${escapeHtml(entry.license) || "未声明"}</dd>
    <dt>发布时间</dt><dd>${escapeHtml(formatDate(entry.latest.publishedAt))}</dd>
    <dt>SHA-256</dt><dd><code>${escapeHtml(entry.latest.sha256)}</code></dd>
    <dt>来源</dt><dd><a href="${escapeHtml(sourceLink)}" rel="noreferrer">${escapeHtml(
      entry.sourceRepo,
    )} @ ${escapeHtml(entry.sourceCommit.slice(0, 12))}</a><br /><span class="muted">${escapeHtml(
      entry.sourcePath,
    )}</span></dd>
  </dl>
</div>
<div class="panel">
  <h2>依赖</h2>
  ${deps}
</div>
<div class="panel">
  <h2>全部版本</h2>
  <div class="table-scroll"><table>
    <thead><tr><th>版本</th><th>发布时间</th><th>大小</th><th>SHA-256</th><th>下载</th></tr></thead>
    <tbody>
${versions}
    </tbody>
  </table></div>
</div>
<div class="panel">
  <h2>从软件源安装</h2>
  <p>添加软件源与公钥后执行：</p>
  <p><code>apk add ${escapeHtml(entry.name)}</code></p>
  <p class="muted">软件源地址：<code>${escapeHtml(feedUrl)}</code> · <a href="../install.html">完整安装说明</a></p>
</div>`;

  return layout({
    title: `${entry.name} — CombineWRT 软件包`,
    description: entry.description || entry.name,
    prefix: "../",
    body,
    script: "",
  });
}

export function renderInstall(catalog: Catalog, feedUrl: string, keyUrl: string): string {
  const names = catalog.packages.map((entry) => entry.name).join(" ");
  const body = `<p class="breadcrumb"><a href="index.html">全部软件包</a> / 安装</p>
<h1>安装软件源</h1>
<p class="muted">以下命令在运行 ImmortalWrt ${escapeHtml(
    catalog.baseVersion,
  )} 的设备上执行。软件源索引与所有包均由 CombineWRT 签名。</p>
<div class="panel">
  <h2>1. 安装公钥</h2>
  <pre><code>wget -O /etc/apk/keys/combinewrt-feed.pub.pem ${escapeHtml(keyUrl)}</code></pre>
  <p class="muted">公钥地址：<code>${escapeHtml(keyUrl)}</code></p>
</div>
<div class="panel">
  <h2>2. 添加软件源</h2>
  <pre><code>echo "${escapeHtml(feedUrl)}" &gt;&gt; /etc/apk/repositories
apk update</code></pre>
  <p class="muted">软件源必须指向 <code>packages.adb</code> 本身；使用目录地址会返回 404。</p>
</div>
<div class="panel">
  <h2>3. 安装软件包</h2>
  <pre><code>apk add ${escapeHtml(names)}</code></pre>
  <p class="muted">也可以只安装需要的包：<code>apk add luci-app-store</code>。</p>
</div>
<div class="panel">
  <h2>源码与许可</h2>
  <ul class="plain">${catalog.packages
    .map((entry) => {
      const sourceLink = `https://github.com/${entry.sourceRepo}/tree/${entry.sourceCommit}/${entry.sourcePath}`;
      return `<li><a href="${escapeHtml(sourceLink)}" rel="noreferrer">${escapeHtml(
        entry.name,
      )}</a> · ${escapeHtml(entry.license) || "未声明许可"} · <span class="muted">${escapeHtml(
        entry.sourceRepo,
      )} @ ${escapeHtml(entry.sourceCommit.slice(0, 12))} / ${escapeHtml(entry.sourcePath)}</span></li>`;
    })
    .join("")}</ul>
  <p class="muted">每个包对应的源码提交与目录均可追溯；GPL 等 copyleft 包的完整源码可从上述链接取得。本页不镜像上游源码。</p>
</div>
<div class="panel">
  <h2>常见问题</h2>
  <dl class="meta-grid">
    <dt>404</dt><dd>软件源地址必须包含 <code>/x86_64/packages.adb</code>，不能只写到目录。</dd>
    <dt>签名错误</dt><dd>确认公钥位于 <code>/etc/apk/keys/</code>，且索引没有被中间人修改。</dd>
    <dt>架构不匹配</dt><dd>本软件源只提供 x86_64 版本；其它架构请勿添加。</dd>
  </dl>
</div>
<p class="notice">索引被篡改或包内容与索引不一致时，apk 会拒绝安装。这是预期行为，不要使用 <code>--allow-untrusted</code> 绕过。</p>`;

  return layout({
    title: "安装 — CombineWRT 软件包",
    description: "如何添加 CombineWRT 签名 apk 软件源",
    prefix: "",
    body,
    script: COPY_SCRIPT,
  });
}

function render404(): string {
  return layout({
    title: "找不到页面 — CombineWRT 软件包",
    description: "页面不存在",
    prefix: "",
    body: `<h1>404</h1><p>没有找到这个页面。</p><p><a href="index.html">返回软件包列表</a></p>`,
    script: "",
  });
}

interface LayoutOptions {
  title: string;
  description: string;
  prefix: string;
  body: string;
  script: string;
}

function layout(options: LayoutOptions): string {
  const prefix = options.prefix;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(options.title)}</title>
<meta name="description" content="${escapeHtml(options.description)}" />
<style>${STYLE}</style>
</head>
<body>
<header class="site"><div class="wrap">
  <a class="brand" href="${prefix}index.html">CombineWRT 软件包</a>
  <nav><a href="${prefix}index.html">软件包</a><a href="${prefix}install.html">安装</a><a href="${prefix}catalog.json">catalog.json</a></nav>
</div></header>
<main><div class="wrap">
${options.body}
</div></main>
<footer class="site"><div class="wrap">
  <span>CombineWRT 社区构建，与 OpenWrt、ImmortalWrt、LuCI 项目没有隶属关系。</span>
  <span>软件包版权归各自上游作者所有，来源与许可证见包详情页。软件源索引使用 EC P-256 密钥签名。</span>
</div></footer>
${options.script ? `<script>${options.script}</script>` : ""}
</body>
</html>
`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function formatDate(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toISOString().slice(0, 10);
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export type { Catalog, CatalogPackage, CatalogVersion };
