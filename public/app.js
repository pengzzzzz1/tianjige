const state = {
  items: [],
  sources: [],
  subscriptions: [],
  stats: {},
  settings: { refreshSeconds: 15, batchSize: 16 },
  region: "all",
  category: "all",
  query: "",
  matchOnly: false,
  selectedId: null,
  seenMaxId: 0,
  refreshing: false,
  nextRefreshAt: 0,
  reader: { itemId: null, data: null, mode: "zh", fontSize: 17, loading: false, error: null },
};

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();
  startClock();
  await loadBootstrap();
  connectEvents();
  scheduleNextRefreshLabel();
}

async function loadBootstrap({ notify = false } = {}) {
  try {
    const response = await fetch("/api/bootstrap");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const previousMax = state.seenMaxId;
    state.items = data.items;
    state.sources = data.sources;
    state.subscriptions = data.subscriptions;
    state.stats = data.stats;
    state.settings = data.settings;
    state.refreshing = data.refreshing;
    state.seenMaxId = Math.max(0, ...state.items.map((item) => item.id));
    if (notify && previousMax) notifyNewMatches(previousMax);
    render();
    setConnected(true);
  } catch (error) {
    setConnected(false);
    toast(`连接失败：${error.message}`, "error");
    $("#news-feed").innerHTML = emptyMarkup("cloud-off", "无法读取情报", "确认本地服务仍在运行，然后再次刷新。", "重试");
    $("#news-feed button")?.addEventListener("click", () => loadBootstrap());
    refreshIcons();
  }
}

function render() {
  renderMetrics();
  renderSubscriptions();
  renderSources();
  renderFeed();
  renderTopics();
  renderSettings();
  updateRefreshState();
  refreshIcons();
}

function renderMetrics() {
  const total = state.stats.total || 0;
  const cn = state.stats.regions?.["国内"] || 0;
  const global = state.stats.regions?.["国际"] || 0;
  const watched = state.items.filter((item) => item.relevance > 0).length;
  setText("#count-all", total);
  setText("#count-cn", cn);
  setText("#count-global", global);
  setText("#count-watch", watched);
  setText("#metric-24h", state.stats.last24h || 0);
  setText("#metric-policy", state.stats.policy7d || 0);
  setText("#metric-translation", total ? `${Math.round((state.stats.translated / total) * 100)}%` : "0%");
  setText("#pulse-cn", cn);
  setText("#pulse-global", global);
  const max = Math.max(cn, global, 1);
  $("#bar-cn").style.width = `${Math.round((cn / max) * 100)}%`;
  $("#bar-global").style.width = `${Math.round((global / max) * 100)}%`;
  setText("#last-updated", state.stats.latestFetchAt ? `最近同步 ${formatRelative(state.stats.latestFetchAt)}` : "等待首次同步");
}

function renderSubscriptions() {
  const container = $("#subscription-list");
  if (!state.subscriptions.length) {
    container.innerHTML = `<span class="muted-mini">还没有关注词</span>`;
    return;
  }
  container.innerHTML = state.subscriptions.map((item) => `
    <span class="subscription-chip">
      <span>${escapeHtml(item.keyword)}</span>
      <button type="button" data-delete-subscription="${item.id}" title="删除 ${escapeHtml(item.keyword)}" aria-label="删除 ${escapeHtml(item.keyword)}"><i data-lucide="x"></i></button>
    </span>
  `).join("");
}

function renderSources() {
  const enabled = state.sources.filter((source) => source.enabled);
  $("#source-mini-list").innerHTML = enabled.slice(0, 6).map((source) => `
    <div class="source-mini ${source.lastError ? "is-error" : ""}" title="${source.lastError ? escapeHtml(source.lastError) : `${escapeHtml(source.name)} · ${escapeHtml(source.authority)}`}">
      <i style="background:${safeColor(source.color)}"></i>
      <span>${escapeHtml(source.name)}</span>
      <small>${source.itemCount}</small>
    </div>
  `).join("");
}

function renderFeed() {
  const items = filteredItems();
  const regionLabels = { all: "全部地区", 国内: "国内市场", 国际: "国际市场", watch: "我的关注" };
  const titles = { all: "最新资讯", 国内: "国内资讯", 国际: "国际资讯", watch: "我的关注" };
  setText("#feed-eyebrow", `${regionLabels[state.region]} · 实时更新`);
  setText("#feed-title", titles[state.region]);
  setText("#result-count", `${items.length} 条`);
  $("#match-only").checked = state.matchOnly;
  $$(".region-button").forEach((button) => button.classList.toggle("active", button.dataset.region === state.region));
  $$(".category-tab").forEach((button) => {
    const active = button.dataset.category === state.category;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });

  const feed = $("#news-feed");
  if (!items.length) {
    feed.innerHTML = emptyMarkup("inbox", "当前筛选下没有情报", "调整地区、类别或搜索词后再看。", "清除筛选");
    $("#news-feed button")?.addEventListener("click", clearFilters);
    return;
  }
  feed.innerHTML = items.map(newsMarkup).join("");

  if (!state.selectedId || !items.some((item) => item.id === state.selectedId)) {
    state.selectedId = items[0]?.id || null;
  }
  renderDetail();
}

function filteredItems() {
  const query = state.query.trim().toLowerCase();
  return state.items.filter((item) => {
    if (["国内", "国际"].includes(state.region) && item.region !== state.region) return false;
    if (state.region === "watch" && item.relevance === 0) return false;
    if (state.category !== "all" && item.category !== state.category) return false;
    if (state.matchOnly && item.relevance === 0) return false;
    if (query && !`${item.title} ${item.summary} ${item.titleOriginal} ${item.sourceName}`.toLowerCase().includes(query)) return false;
    return true;
  });
}

function newsMarkup(item) {
  const date = new Date(item.publishedAt);
  const sourceColor = safeColor(item.sourceColor);
  const tags = item.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
  const matches = item.matches.slice(0, 2).map((keyword) => `<span class="match-badge">命中 ${escapeHtml(keyword)}</span>`).join("");
  return `
    <article class="news-item ${state.selectedId === item.id ? "selected" : ""}" data-item-id="${item.id}" style="--source-color:${sourceColor}" tabindex="0">
      <time class="news-time" datetime="${escapeHtml(item.publishedAt)}">${pad(date.getHours())}:${pad(date.getMinutes())}<small>${formatDay(date)}</small></time>
      <div class="news-body">
        <div class="news-meta">
          <span class="source-label">${escapeHtml(item.sourceName)}</span>
          <span class="authority-badge ${authorityClass(item.authority)}">${escapeHtml(item.authority || "专业媒体")}</span>
          <span class="category-badge">${escapeHtml(item.category)}</span>
          ${item.importance !== "normal" ? `<span class="major-badge">${item.importance === "critical" ? "特级" : "重大"}</span>` : ""}
          ${matches}
        </div>
        <h2 class="news-title">${escapeHtml(item.title)}</h2>
        ${item.summary ? `<p class="news-summary">${escapeHtml(item.summary)}</p>` : ""}
        ${tags ? `<div class="news-tags">${tags}</div>` : ""}
      </div>
      <span class="news-open"><i data-lucide="chevron-right"></i></span>
    </article>
  `;
}

function renderDetail() {
  const item = state.items.find((candidate) => candidate.id === state.selectedId);
  if (!item) return;
  const panel = $("#detail-panel");
  panel.style.setProperty("--source-color", safeColor(item.sourceColor));
  panel.innerHTML = `
    <div class="detail-meta">
      <span class="detail-source"><i></i>${escapeHtml(item.sourceName)} · ${escapeHtml(item.authority || "专业媒体")}</span>
      <time class="detail-time">${formatFullTime(item.publishedAt)}</time>
    </div>
    <h2 class="detail-title">${escapeHtml(item.title)}</h2>
    ${item.summary ? `<p class="detail-summary">${escapeHtml(item.summary)}</p>` : '<p class="detail-summary">该来源未提供摘要，可打开原文查看完整内容。</p>'}
    <div class="detail-tags">${[item.region, item.category, ...(item.importance !== "normal" ? [item.importance === "critical" ? "特级情报" : "重大情报", ...item.importanceReasons] : []), ...item.tags, ...item.matches].map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
    ${item.titleOriginal !== item.title ? `
      <details class="original-block">
        <summary>查看原文标题</summary>
        <p>${escapeHtml(item.titleOriginal)}</p>
      </details>
    ` : ""}
    <div class="detail-actions">
      <button class="detail-read" type="button" data-read-item="${item.id}"><i data-lucide="book-open-text"></i>${item.hasFullContent ? "阅读已缓存中文全文" : "阅读中文全文"}</button>
      <a class="detail-external" href="${safeUrl(item.url)}" target="_blank" rel="noopener noreferrer" title="在浏览器打开原文" aria-label="在浏览器打开原文"><i data-lucide="external-link"></i></a>
    </div>
  `;
}

function renderTopics() {
  const counts = new Map();
  for (const item of state.items.slice(0, 100)) {
    for (const tag of item.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  const topics = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  $("#topic-cloud").innerHTML = topics.length
    ? topics.map(([tag, count], index) => `<span class="${index < 2 ? "hot" : ""}">${escapeHtml(tag)} ${count}</span>`).join("")
    : "<span>等待主题聚合</span>";
}

function renderSettings() {
  $("#refresh-seconds").value = String(state.settings.refreshSeconds || 15);
  $("#source-settings-list").innerHTML = state.sources.map((source) => `
    <div class="source-setting">
      <div><div class="source-setting-title"><strong>${escapeHtml(source.name)}</strong><span class="authority-badge ${authorityClass(source.authority)}">${escapeHtml(source.authority || "专业媒体")}</span></div><small>${escapeHtml(source.region)} · ${escapeHtml(source.category)} · ${source.itemCount} 条${source.lastError ? " · 同步异常" : ""}</small></div>
      <label class="switch" title="${source.enabled ? "停用" : "启用"} ${escapeHtml(source.name)}">
        <input type="checkbox" data-source-toggle="${escapeHtml(source.id)}" ${source.enabled ? "checked" : ""} />
        <span></span>
      </label>
      ${source.authority === "自定义" ? `<button class="delete-source" type="button" data-delete-source="${escapeHtml(source.id)}" title="删除来源" aria-label="删除 ${escapeHtml(source.name)}"><i data-lucide="trash-2"></i></button>` : '<span aria-label="内置来源"></span>'}
    </div>
  `).join("");
}

function bindEvents() {
  $("#subscription-form").addEventListener("submit", addSubscription);
  $("#subscription-list").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-delete-subscription]");
    if (!button) return;
    await api(`/api/subscriptions/${button.dataset.deleteSubscription}`, { method: "DELETE" });
    await loadBootstrap();
  });

  $$(".region-button").forEach((button) => button.addEventListener("click", () => {
    state.region = button.dataset.region;
    renderFeed();
    refreshIcons();
  }));
  $$(".category-tab").forEach((button) => button.addEventListener("click", () => {
    state.category = button.dataset.category;
    renderFeed();
    refreshIcons();
  }));
  $("#match-only").addEventListener("change", (event) => {
    state.matchOnly = event.target.checked;
    renderFeed();
    refreshIcons();
  });
  $("#search-input").addEventListener("input", debounce((event) => {
    state.query = event.target.value;
    renderFeed();
    refreshIcons();
  }, 180));
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      $("#search-input").focus();
    }
  });

  $("#news-feed").addEventListener("click", selectNews);
  $("#news-feed").addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") selectNews(event);
  });
  $("#detail-panel").addEventListener("click", (event) => {
    const button = event.target.closest("[data-read-item]");
    if (button) openReader(Number(button.dataset.readItem));
  });
  $("#refresh-button").addEventListener("click", refreshNow);
  $("#notification-button").addEventListener("click", enableNotifications);
  $("#settings-button").addEventListener("click", openSettings);
  $("#manage-sources-button").addEventListener("click", openSettings);
  $("#source-settings-list").addEventListener("change", toggleSource);
  $("#source-settings-list").addEventListener("click", deleteSource);
  $("#source-form").addEventListener("submit", addSource);
  $("#refresh-seconds").addEventListener("change", saveRefreshInterval);
  $("#reader-dialog").addEventListener("click", handleReaderControls);
  $("#reader-refresh").addEventListener("click", () => loadReaderContent({ refresh: true }));
  $$(".mobile-nav button").forEach((button) => button.addEventListener("click", () => mobileAction(button)));
}

function connectEvents() {
  const events = new EventSource("/api/events");
  events.addEventListener("ready", () => setConnected(true));
  events.addEventListener("refresh", async (event) => {
    const data = JSON.parse(event.data);
    state.refreshing = data.status === "started";
    updateRefreshState();
    if (data.status === "finished") {
      await loadBootstrap({ notify: true });
      scheduleNextRefreshLabel();
      if (data.inserted || data.errors?.length) {
        toast(`批次完成：${data.sources} 个来源，新增 ${data.inserted} 条，中文转换 ${data.translated} 条`);
      }
    }
  });
  events.addEventListener("major", (event) => {
    const data = JSON.parse(event.data);
    if (navigator.userAgent.includes("Electron") || !data.items?.length) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const first = data.items[0];
    const notification = new Notification(
      data.count > 1 ? `天机阁 · ${data.count} 条重大情报` : "天机阁 · 重大情报",
      { body: first.title, tag: `tianjige-major-${first.id}` },
    );
    notification.onclick = () => window.open(first.url, "_blank", "noopener,noreferrer");
  });
  events.onerror = () => setConnected(false);
}

async function addSubscription(event) {
  event.preventDefault();
  const input = $("#subscription-input");
  const keyword = input.value.trim();
  if (!keyword) return;
  try {
    await api("/api/subscriptions", { method: "POST", body: JSON.stringify({ keyword, type: inferSubscriptionType(keyword) }) });
    input.value = "";
    await loadBootstrap();
    toast(`已关注“${keyword}”`);
  } catch (error) {
    toast(error.message, "error");
  }
}

async function refreshNow() {
  if (state.refreshing) return;
  try {
    state.refreshing = true;
    updateRefreshState();
    await api("/api/refresh", { method: "POST", body: "{}" });
    toast("已开始同步国内外情报源");
  } catch (error) {
    state.refreshing = false;
    updateRefreshState();
    toast(error.message, "error");
  }
}

function selectNews(event) {
  const article = event.target.closest("[data-item-id]");
  if (!article) return;
  state.selectedId = Number(article.dataset.itemId);
  $$(".news-item").forEach((item) => item.classList.toggle("selected", Number(item.dataset.itemId) === state.selectedId));
  renderDetail();
  refreshIcons();
  if (window.innerWidth <= 940) {
    openReader(state.selectedId);
  }
}

function openReader(itemId) {
  const item = state.items.find((candidate) => candidate.id === Number(itemId));
  if (!item) return;
  state.reader = { ...state.reader, itemId: item.id, data: null, mode: "zh", loading: true, error: null };
  $("#reader-source").textContent = `${item.sourceName} · ${formatFullTime(item.publishedAt)}`;
  $("#reader-external").href = safeUrl(item.url);
  renderReader();
  const dialog = $("#reader-dialog");
  if (!dialog.open) dialog.showModal();
  refreshIcons();
  loadReaderContent();
}

async function loadReaderContent({ refresh = false } = {}) {
  const itemId = state.reader.itemId;
  if (!itemId || state.reader.loading && state.reader.data) return;
  state.reader.loading = true;
  state.reader.error = null;
  renderReader();
  try {
    const suffix = refresh ? "?refresh=1" : "";
    const data = await api(`/api/items/${itemId}/content${suffix}`);
    if (state.reader.itemId !== itemId) return;
    state.reader.data = data;
    const item = state.items.find((candidate) => candidate.id === itemId);
    if (item) {
      item.contentStatus = data.status;
      item.hasFullContent = true;
      renderDetail();
    }
  } catch (error) {
    if (state.reader.itemId === itemId) state.reader.error = error.message;
  } finally {
    if (state.reader.itemId === itemId) {
      state.reader.loading = false;
      renderReader();
      refreshIcons();
    }
  }
}

function handleReaderControls(event) {
  const modeButton = event.target.closest("[data-reader-mode]");
  if (modeButton) {
    state.reader.mode = modeButton.dataset.readerMode;
    renderReader();
    refreshIcons();
    return;
  }
  const fontButton = event.target.closest("[data-reader-font]");
  if (fontButton) {
    const delta = fontButton.dataset.readerFont === "increase" ? 1 : -1;
    state.reader.fontSize = Math.min(21, Math.max(14, state.reader.fontSize + delta));
    $("#reader-content").style.setProperty("--reader-font-size", `${state.reader.fontSize}px`);
  }
}

function renderReader() {
  const container = $("#reader-content");
  $$("[data-reader-mode]", $("#reader-dialog")).forEach((button) => {
    button.classList.toggle("active", button.dataset.readerMode === state.reader.mode);
  });
  if (state.reader.loading) {
    container.innerHTML = `
      <div class="reader-loading">
        <span class="loader"></span>
        <strong>正在读取并翻译正文</strong>
        <p>首次读取会抓取原文、清理页面并转换为中文。</p>
      </div>`;
    return;
  }
  if (state.reader.error || !state.reader.data) {
    container.innerHTML = `
      <div class="reader-error">
        <i data-lucide="file-warning"></i>
        <strong>正文暂时无法读取</strong>
        <p>${escapeHtml(state.reader.error || "该来源没有返回正文内容")}</p>
        <button class="primary-button" type="button" id="reader-retry">重新读取</button>
      </div>`;
    $("#reader-retry")?.addEventListener("click", () => loadReaderContent({ refresh: true }));
    return;
  }

  const data = state.reader.data;
  const originalMode = state.reader.mode === "original";
  const content = originalMode ? data.contentOriginal : data.contentZh;
  const title = originalMode ? data.titleOriginal : data.title;
  const methodLabels = { direct: "原站正文", reader: "只读正文", summary: "来源摘要" };
  const paragraphs = String(content || "").split(/\n{2,}/).filter(Boolean);
  container.innerHTML = `
    <article class="reader-article">
      <div class="reader-state-strip">
        <span><i></i>${escapeHtml(methodLabels[data.method] || "正文")}</span>
        <span>${data.cached ? "本机缓存" : "刚刚获取"}</span>
        <span>${data.wordCount || 0} 字</span>
      </div>
      <h1>${escapeHtml(title)}</h1>
      <div class="reader-byline">${data.byline ? `${escapeHtml(data.byline)} · ` : ""}${escapeHtml(data.sourceName)} · ${formatFullTime(data.publishedAt)}</div>
      ${data.status === "partial" ? '<div class="reader-partial"><i data-lucide="info"></i><span>该来源限制完整正文访问，当前显示可读取内容。</span></div>' : ""}
      <div class="reader-prose">${paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}</div>
    </article>`;
  container.style.setProperty("--reader-font-size", `${state.reader.fontSize}px`);
}

function openSettings() {
  $("#settings-dialog").showModal();
  refreshIcons();
}

async function toggleSource(event) {
  const input = event.target.closest("[data-source-toggle]");
  if (!input) return;
  try {
    await api(`/api/sources/${encodeURIComponent(input.dataset.sourceToggle)}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: input.checked }),
    });
    await loadBootstrap();
  } catch (error) {
    input.checked = !input.checked;
    toast(error.message, "error");
  }
}

async function deleteSource(event) {
  const button = event.target.closest("[data-delete-source]");
  if (!button) return;
  try {
    await api(`/api/sources/${encodeURIComponent(button.dataset.deleteSource)}`, { method: "DELETE" });
    await loadBootstrap();
    toast("来源已删除");
  } catch (error) {
    toast(error.message, "error");
  }
}

async function addSource(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await api("/api/sources", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form.entries())),
    });
    event.currentTarget.reset();
    await loadBootstrap();
    toast("RSS 来源已添加");
  } catch (error) {
    toast(error.message, "error");
  }
}

async function saveRefreshInterval(event) {
  try {
    await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ refreshSeconds: Number(event.target.value) }),
    });
    state.settings.refreshSeconds = Number(event.target.value);
    scheduleNextRefreshLabel();
    toast("刷新间隔已保存并立即生效");
  } catch (error) {
    toast(error.message, "error");
  }
}

async function enableNotifications() {
  if (!("Notification" in window)) return toast("当前浏览器不支持桌面通知", "error");
  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    toast("订阅提醒已开启");
    $("#notification-button").style.color = "var(--policy)";
  } else {
    toast("浏览器没有授予通知权限", "error");
  }
}

function notifyNewMatches(previousMax) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  state.items.filter((item) => item.id > previousMax && item.relevance > 0).slice(0, 4).forEach((item) => {
    const notification = new Notification(`天机阁 · ${item.matches.join("、")}`, { body: item.title, tag: `tianjige-${item.id}` });
    notification.onclick = () => window.open(item.url, "_blank", "noopener,noreferrer");
  });
}

function mobileAction(button) {
  $$(".mobile-nav button").forEach((item) => item.classList.toggle("active", item === button));
  const action = button.dataset.mobileAction;
  if (action === "watch") {
    state.region = "watch";
    renderFeed();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } else if (action === "sources" || action === "settings") {
    openSettings();
  } else {
    state.region = "all";
    renderFeed();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  refreshIcons();
}

function updateRefreshState() {
  const button = $("#refresh-button");
  button.classList.toggle("is-spinning", state.refreshing);
  button.disabled = state.refreshing;
  setText("#refresh-state", state.refreshing ? "正在批量抓取并翻译" : "实时批量获取已开启");
}

function setConnected(connected) {
  $("#connection-dot").classList.toggle("connected", connected);
  setText("#connection-label", connected ? "情报源在线" : "连接已中断");
}

function startClock() {
  const update = () => {
    const now = new Date();
    setText("#current-date", new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", weekday: "short" }).format(now));
    setText("#current-time", new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(now));
    if (!state.refreshing && state.nextRefreshAt) {
      const seconds = Math.max(0, Math.ceil((state.nextRefreshAt - Date.now()) / 1000));
      setText("#next-refresh", `${seconds} 秒后`);
    } else if (state.refreshing) {
      setText("#next-refresh", "同步中");
    }
  };
  update();
  setInterval(update, 1000);
}

function scheduleNextRefreshLabel() {
  const seconds = state.settings.refreshSeconds || 15;
  state.nextRefreshAt = Date.now() + seconds * 1000;
  setText("#next-refresh", `${seconds} 秒后`);
}

function clearFilters() {
  state.region = "all";
  state.category = "all";
  state.query = "";
  state.matchOnly = false;
  $("#search-input").value = "";
  renderFeed();
  refreshIcons();
}

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { "content-type": "application/json", ...(options.headers || {}) }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `请求失败：HTTP ${response.status}`);
  return body;
}

function toast(message, type = "success") {
  const element = document.createElement("div");
  element.className = `toast ${type}`;
  element.textContent = message;
  $("#toast-region").append(element);
  setTimeout(() => element.remove(), 3600);
}

function emptyMarkup(icon, title, text, action) {
  return `<div class="empty-state"><i data-lucide="${icon}"></i><strong>${escapeHtml(title)}</strong><p>${escapeHtml(text)}</p>${action ? `<button class="primary-button" type="button">${escapeHtml(action)}</button>` : ""}</div>`;
}

function inferSubscriptionType(keyword) {
  if (/^(sh|sz|hk)?\d{5,6}$/i.test(keyword)) return "stock";
  if (/政策|央行|美联储|利率|监管/.test(keyword)) return "policy";
  return "keyword";
}

function formatRelative(value) {
  const delta = Date.now() - new Date(value).getTime();
  if (delta < 60_000) return "刚刚";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  return `${Math.floor(delta / 86_400_000)} 天前`;
}

function formatDay(date) {
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "今天";
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "昨天";
  return `${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
}

function formatFullTime(value) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function refreshIcons() {
  window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
}

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = String(value);
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "#";
  } catch {
    return "#";
  }
}

function safeColor(value) {
  return /^#[0-9a-f]{6}$/i.test(value || "") ? value : "#177e89";
}

function authorityClass(value) {
  return ({
    "官方发布": "official",
    "一线媒体": "first-line",
    "专业媒体": "professional",
    "自定义": "custom",
  })[value] || "professional";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

function pad(value) { return String(value).padStart(2, "0"); }
function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
