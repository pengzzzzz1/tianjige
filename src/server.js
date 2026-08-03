import express from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { Store } from "./db.js";
import { DEFAULT_SOURCES } from "./sources.js";
import { EdgeTranslator } from "./translator.js";
import { Aggregator } from "./aggregator.js";
import { fetchArticleContent } from "./article.js";

const currentFile = fileURLToPath(import.meta.url);
const rootDir = path.dirname(path.dirname(currentFile));
const allowedCategories = ["要闻", "财经", "交易", "股票", "投资", "经济", "政策", "监管", "科技", "数码", "体育"];
const DEFAULT_REFRESH_SECONDS = 15;
const DEFAULT_BATCH_SIZE = 16;

export async function startServer(options = {}) {
  const port = Number(options.port ?? process.env.PORT ?? 4173);
  const host = options.host || "127.0.0.1";
  const dataDir = options.dataDir || process.env.TIANJIGE_DATA_DIR || path.join(rootDir, "data");
  const autoRefresh = options.autoRefresh !== false;
  fs.mkdirSync(dataDir, { recursive: true });

  const store = new Store(path.join(dataDir, "tian-ji-ge.db"));
  store.seedSources(DEFAULT_SOURCES);
  store.seedSubscriptions();
  if (!store.getSetting("refreshSeconds")) {
    store.setSetting("refreshSeconds", process.env.REFRESH_SECONDS || DEFAULT_REFRESH_SECONDS);
  }
  if (Number(store.getSetting("batchSize", 0)) < DEFAULT_BATCH_SIZE) {
    store.setSetting("batchSize", DEFAULT_BATCH_SIZE);
  }

  const clients = new Set();
  const sendEvent = (event, data) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const response of clients) response.write(payload);
    if (event === "major") options.onMajorNews?.(data);
  };
  const translator = new EdgeTranslator({ enabled: process.env.TRANSLATION_ENABLED !== "false" });
  const aggregator = new Aggregator({ store, translator, onEvent: sendEvent });
  const articleLoader = options.articleLoader || fetchArticleContent;
  const contentJobs = new Map();
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));
  app.use("/vendor/lucide", express.static(path.join(rootDir, "node_modules", "lucide", "dist", "umd")));
  app.use(express.static(path.join(rootDir, "public")));

  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true,
      refreshing: aggregator.running,
      refreshSeconds: Number(store.getSetting("refreshSeconds", DEFAULT_REFRESH_SECONDS)),
      batchSize: Number(store.getSetting("batchSize", DEFAULT_BATCH_SIZE)),
      sources: store.listSources({ enabledOnly: true }).length,
      time: new Date().toISOString(),
    });
  });

  app.get("/api/bootstrap", (_request, response) => {
    response.json({
      items: store.listItems({ limit: 150 }),
      sources: store.listSources(),
      subscriptions: store.listSubscriptions(),
      stats: store.stats(),
      settings: {
        refreshSeconds: Number(store.getSetting("refreshSeconds", DEFAULT_REFRESH_SECONDS)),
        batchSize: Number(store.getSetting("batchSize", DEFAULT_BATCH_SIZE)),
        translationEnabled: translator.enabled,
      },
      refreshing: aggregator.running,
    });
  });

  app.get("/api/items", (request, response) => {
    response.json({ items: store.listItems(request.query), stats: store.stats() });
  });

  app.get("/api/items/:id/content", async (request, response) => {
    const id = Number(request.params.id);
    const item = store.getItemForContent(id);
    if (!item) return response.status(404).json({ error: "文章不存在" });
    const cached = store.getArticleContent(id);
    const forceRefresh = request.query.refresh === "1";
    if (!forceRefresh && ["ready", "partial"].includes(cached.status) && cached.contentZh) {
      return response.json({ ...cached, cached: true });
    }

    let job = contentJobs.get(id);
    if (!job) {
      store.setArticleContentStatus(id, "loading");
      job = articleLoader({
        item: {
          id,
          url: item.url,
          title: item.title_zh || item.title_original,
          titleOriginal: item.title_original,
          summary: item.summary_zh || item.summary_original,
          summaryOriginal: item.summary_original,
        },
        translator,
      }).then((article) => {
        store.saveArticleContent(id, article);
        return store.getArticleContent(id);
      }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        store.setArticleContentStatus(id, "error", message);
        throw error;
      }).finally(() => contentJobs.delete(id));
      contentJobs.set(id, job);
    }

    try {
      response.json({ ...await job, cached: false });
    } catch (error) {
      response.status(502).json({
        error: error instanceof Error ? error.message : "正文读取失败",
        content: store.getArticleContent(id),
      });
    }
  });

  app.get("/api/sources", (_request, response) => response.json({ sources: store.listSources() }));

  app.post("/api/sources", (request, response) => {
    const name = String(request.body?.name || "").trim();
    const rawUrl = String(request.body?.url || "").trim();
    if (!name || !rawUrl) return response.status(400).json({ error: "来源名称和 RSS 地址不能为空" });
    let parsed;
    try {
      parsed = new URL(rawUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("invalid protocol");
    } catch {
      return response.status(400).json({ error: "请输入有效的 HTTP/HTTPS RSS 地址" });
    }
    const id = `custom-${crypto.createHash("sha1").update(parsed.href).digest("hex").slice(0, 12)}`;
    try {
      const source = store.addSource({
        id,
        name,
        url: parsed.href,
        region: request.body?.region === "国内" ? "国内" : "国际",
        category: allowedCategories.includes(request.body?.category) ? request.body.category : "交易",
        color: "#177e89",
      });
      response.status(201).json({ source });
    } catch (error) {
      response.status(409).json({ error: "该来源已经存在", detail: error.message });
    }
  });

  app.patch("/api/sources/:id", (request, response) => {
    const updated = store.setSourceEnabled(request.params.id, Boolean(request.body?.enabled));
    response.status(updated ? 200 : 404).json({ ok: updated });
  });

  app.delete("/api/sources/:id", (request, response) => {
    const removed = store.removeSource(request.params.id);
    response.status(removed ? 200 : 400).json({ ok: removed, error: removed ? null : "内置来源只能停用，不能删除" });
  });

  app.get("/api/subscriptions", (_request, response) => {
    response.json({ subscriptions: store.listSubscriptions() });
  });

  app.post("/api/subscriptions", (request, response) => {
    const keyword = String(request.body?.keyword || "").trim();
    if (keyword.length < 1 || keyword.length > 40) {
      return response.status(400).json({ error: "订阅词长度应为 1 到 40 个字符" });
    }
    const subscription = store.addSubscription(keyword, String(request.body?.type || "keyword"));
    response.status(201).json({ subscription });
  });

  app.delete("/api/subscriptions/:id", (request, response) => {
    const removed = store.removeSubscription(Number(request.params.id));
    response.status(removed ? 200 : 404).json({ ok: removed });
  });

  app.post("/api/refresh", (request, response) => {
    if (aggregator.running) return response.status(202).json({ accepted: false, refreshing: true });
    response.status(202).json({ accepted: true, refreshing: true });
    aggregator.refresh({ sourceId: request.body?.sourceId || null }).catch((error) => {
      sendEvent("refresh", { status: "error", message: error.message });
    });
  });

  let intervalHandle = null;
  const scheduleRefresh = () => {
    clearInterval(intervalHandle);
    const seconds = Number(store.getSetting("refreshSeconds", DEFAULT_REFRESH_SECONDS));
    const batchSize = Number(store.getSetting("batchSize", DEFAULT_BATCH_SIZE));
    intervalHandle = setInterval(
      () => aggregator.refresh({ batchSize }).catch(console.error),
      seconds * 1000,
    );
    intervalHandle.unref();
  };

  app.put("/api/settings", (request, response) => {
    if (request.body?.refreshSeconds != null) {
      const value = Math.min(Math.max(Number(request.body.refreshSeconds) || DEFAULT_REFRESH_SECONDS, 10), 3600);
      store.setSetting("refreshSeconds", value);
    }
    scheduleRefresh();
    response.json({
      ok: true,
      refreshSeconds: Number(store.getSetting("refreshSeconds", DEFAULT_REFRESH_SECONDS)),
      batchSize: Number(store.getSetting("batchSize", DEFAULT_BATCH_SIZE)),
    });
  });

  app.get("/api/events", (request, response) => {
    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders();
    response.write(`event: ready\ndata: {"ok":true}\n\n`);
    clients.add(response);
    request.on("close", () => clients.delete(response));
  });

  app.get("*path", (_request, response) => response.sendFile(path.join(rootDir, "public", "index.html")));

  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(port, host, () => resolve(listener));
    listener.once("error", reject);
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const url = `http://${host}:${actualPort}`;
  console.log(`天机阁已启动：${url}`);

  if (autoRefresh) scheduleRefresh();
  const startupTimer = autoRefresh
    ? setTimeout(() => aggregator.refresh({
      batchSize: Number(store.getSetting("batchSize", DEFAULT_BATCH_SIZE)),
    }).catch(console.error), 600)
    : null;
  startupTimer?.unref();

  const close = () => new Promise((resolve) => {
    if (startupTimer) clearTimeout(startupTimer);
    clearInterval(intervalHandle);
    for (const client of clients) client.end();
    server.close(async () => {
      await Promise.allSettled([...contentJobs.values()]);
      store.close();
      resolve();
    });
  });

  return { app, server, store, aggregator, url, close };
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(currentFile);
if (isCli) {
  const runtime = await startServer();
  const shutdown = async () => {
    await runtime.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
