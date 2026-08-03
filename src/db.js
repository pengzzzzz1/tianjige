import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { assessImportance } from "./importance.js";

const isoNow = () => new Date().toISOString();

export class Store {
  constructor(filename) {
    this.db = new DatabaseSync(filename);
    this.db.exec("PRAGMA foreign_keys = ON;");
    if (filename !== ":memory:") {
      this.db.exec("PRAGMA journal_mode = WAL;");
    }
    this.init();
  }

  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'rss',
        region TEXT NOT NULL,
        category TEXT NOT NULL,
        official INTEGER NOT NULL DEFAULT 0,
        authority TEXT NOT NULL DEFAULT '专业媒体',
        enabled INTEGER NOT NULL DEFAULT 1,
        color TEXT NOT NULL DEFAULT '#177e89',
        link_pattern TEXT,
        last_success_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        guid TEXT NOT NULL,
        url TEXT NOT NULL,
        title_original TEXT NOT NULL,
        title_zh TEXT,
        summary_original TEXT NOT NULL DEFAULT '',
        summary_zh TEXT,
        published_at TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        region TEXT NOT NULL,
        category TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT 'unknown',
        translated INTEGER NOT NULL DEFAULT 0,
        tags TEXT NOT NULL DEFAULT '[]',
        content_original TEXT,
        content_zh TEXT,
        content_status TEXT NOT NULL DEFAULT 'idle',
        content_fetched_at TEXT,
        content_error TEXT,
        content_byline TEXT,
        content_method TEXT,
        content_word_count INTEGER NOT NULL DEFAULT 0,
        UNIQUE(source_id, guid)
      );

      CREATE INDEX IF NOT EXISTS idx_items_published ON items(published_at DESC);
      CREATE INDEX IF NOT EXISTS idx_items_source ON items(source_id);
      CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);

      CREATE TABLE IF NOT EXISTS subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        keyword TEXT NOT NULL COLLATE NOCASE UNIQUE,
        type TEXT NOT NULL DEFAULT 'keyword',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    this.ensureSourceColumns();
    this.ensureItemContentColumns();
  }

  ensureSourceColumns() {
    const columns = new Set(this.db.prepare("PRAGMA table_info(sources)").all().map((row) => row.name));
    if (!columns.has("authority")) {
      this.db.exec("ALTER TABLE sources ADD COLUMN authority TEXT NOT NULL DEFAULT '专业媒体'");
    }
  }

  ensureItemContentColumns() {
    const columns = new Set(this.db.prepare("PRAGMA table_info(items)").all().map((row) => row.name));
    const migrations = [
      ["content_original", "TEXT"],
      ["content_zh", "TEXT"],
      ["content_status", "TEXT NOT NULL DEFAULT 'idle'"],
      ["content_fetched_at", "TEXT"],
      ["content_error", "TEXT"],
      ["content_byline", "TEXT"],
      ["content_method", "TEXT"],
      ["content_word_count", "INTEGER NOT NULL DEFAULT 0"],
    ];
    for (const [name, definition] of migrations) {
      if (!columns.has(name)) this.db.exec(`ALTER TABLE items ADD COLUMN ${name} ${definition}`);
    }
  }

  seedSources(sources) {
    const statement = this.db.prepare(`
      INSERT INTO sources
        (id, name, url, kind, region, category, official, authority, enabled, color, link_pattern, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        url = excluded.url,
        kind = excluded.kind,
        region = excluded.region,
        category = excluded.category,
        official = excluded.official,
        authority = excluded.authority,
        color = excluded.color,
        link_pattern = excluded.link_pattern
    `);
    for (const source of sources) {
      statement.run(
        source.id,
        source.name,
        source.url,
        source.kind,
        source.region,
        source.category,
        source.official ? 1 : 0,
        source.authority || (source.official ? "官方发布" : "专业媒体"),
        source.color,
        source.linkPattern || null,
        isoNow(),
      );
    }
  }

  seedSubscriptions() {
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO subscriptions (keyword, type, enabled, created_at) VALUES (?, ?, 1, ?)",
    );
    for (const [keyword, type] of [["A股", "market"], ["美联储", "policy"], ["人工智能", "theme"]]) {
      insert.run(keyword, type, isoNow());
    }
  }

  listSources({ enabledOnly = false } = {}) {
    const where = enabledOnly ? "WHERE enabled = 1" : "";
    return this.db.prepare(`
      SELECT s.*,
        COUNT(i.id) AS item_count,
        MAX(i.published_at) AS latest_item_at
      FROM sources s
      LEFT JOIN items i ON i.source_id = s.id
      ${where}
      GROUP BY s.id
      ORDER BY s.region,
        CASE s.authority WHEN '官方发布' THEN 1 WHEN '一线媒体' THEN 2 WHEN '专业媒体' THEN 3 ELSE 4 END,
        s.name
    `).all().map(mapSource);
  }

  getSource(id) {
    const row = this.db.prepare(`
      SELECT s.*, COUNT(i.id) AS item_count, MAX(i.published_at) AS latest_item_at
      FROM sources s
      LEFT JOIN items i ON i.source_id = s.id
      WHERE s.id = ?
      GROUP BY s.id
    `).get(id);
    return row ? mapSource(row) : null;
  }

  addSource(source) {
    this.db.prepare(`
      INSERT INTO sources
        (id, name, url, kind, region, category, official, authority, enabled, color, link_pattern, created_at)
      VALUES (?, ?, ?, 'rss', ?, ?, 0, '自定义', 1, ?, NULL, ?)
    `).run(source.id, source.name, source.url, source.region, source.category, source.color, isoNow());
    return this.getSource(source.id);
  }

  setSourceEnabled(id, enabled) {
    return this.db.prepare("UPDATE sources SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id).changes > 0;
  }

  removeSource(id) {
    return this.db.prepare("DELETE FROM sources WHERE id = ? AND official = 0").run(id).changes > 0;
  }

  markSourceResult(id, error = null) {
    if (error) {
      this.db.prepare("UPDATE sources SET last_error = ? WHERE id = ?").run(String(error).slice(0, 500), id);
    } else {
      this.db.prepare("UPDATE sources SET last_success_at = ?, last_error = NULL WHERE id = ?").run(isoNow(), id);
    }
  }

  insertItem(item) {
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO items
        (source_id, guid, url, title_original, title_zh, summary_original, summary_zh,
         published_at, fetched_at, region, category, language, translated, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      item.sourceId,
      item.guid,
      item.url,
      item.title,
      item.titleZh || null,
      item.summary,
      item.summaryZh || null,
      item.publishedAt,
      isoNow(),
      item.region,
      item.category,
      item.language,
      item.translated ? 1 : 0,
      JSON.stringify(item.tags || []),
    );
    if (result.changes) return Number(result.lastInsertRowid);
    this.db.prepare(`
      UPDATE items
      SET url = ?, title_original = ?, title_zh = COALESCE(?, title_zh),
          summary_original = ?, summary_zh = COALESCE(?, summary_zh), published_at = ?,
          region = ?, category = ?, language = ?, translated = ?, tags = ?
      WHERE source_id = ? AND guid = ?
    `).run(
      item.url,
      item.title,
      item.titleZh || null,
      item.summary,
      item.summaryZh || null,
      item.publishedAt,
      item.region,
      item.category,
      item.language,
      item.translated ? 1 : 0,
      JSON.stringify(item.tags || []),
      item.sourceId,
      item.guid,
    );
    return null;
  }

  getPendingTranslations(limit = 30) {
    return this.db.prepare(`
      SELECT id, title_original, summary_original
      FROM items
      WHERE translated = 0
      ORDER BY published_at DESC
      LIMIT ?
    `).all(limit);
  }

  setTranslation(id, titleZh, summaryZh) {
    this.db.prepare(`
      UPDATE items
      SET title_zh = ?, summary_zh = ?, translated = 1
      WHERE id = ?
    `).run(titleZh, summaryZh, id);
  }

  getItemForContent(id) {
    return this.db.prepare(`
      SELECT i.*, s.name AS source_name, s.official, s.authority AS source_authority, s.color AS source_color
      FROM items i
      JOIN sources s ON s.id = i.source_id
      WHERE i.id = ?
    `).get(id) || null;
  }

  getArticleContent(id) {
    const row = this.getItemForContent(id);
    if (!row) return null;
    return mapArticleContent(row);
  }

  setArticleContentStatus(id, status, error = null) {
    this.db.prepare(`
      UPDATE items SET content_status = ?, content_error = ? WHERE id = ?
    `).run(status, error ? String(error).slice(0, 500) : null, id);
  }

  saveArticleContent(id, article) {
    this.db.prepare(`
      UPDATE items
      SET content_original = ?, content_zh = ?, content_status = ?, content_fetched_at = ?,
          content_error = NULL, content_byline = ?, content_method = ?, content_word_count = ?
      WHERE id = ?
    `).run(
      article.contentOriginal,
      article.contentZh,
      article.status,
      isoNow(),
      article.byline || "",
      article.method,
      Number(article.wordCount || 0),
      id,
    );
  }

  listSubscriptions() {
    return this.db.prepare("SELECT * FROM subscriptions ORDER BY created_at DESC").all()
      .map((row) => ({ ...row, enabled: Boolean(row.enabled) }));
  }

  addSubscription(keyword, type = "keyword") {
    this.db.prepare(`
      INSERT INTO subscriptions (keyword, type, enabled, created_at)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(keyword) DO UPDATE SET enabled = 1, type = excluded.type
    `).run(keyword.trim(), type, isoNow());
    return this.db.prepare("SELECT * FROM subscriptions WHERE keyword = ? COLLATE NOCASE").get(keyword.trim());
  }

  removeSubscription(id) {
    return this.db.prepare("DELETE FROM subscriptions WHERE id = ?").run(id).changes > 0;
  }

  listItems(filters = {}) {
    const clauses = [];
    const params = [];
    if (filters.region && filters.region !== "all") {
      clauses.push("i.region = ?");
      params.push(filters.region);
    }
    if (filters.category && filters.category !== "all") {
      clauses.push("i.category = ?");
      params.push(filters.category);
    }
    if (filters.sourceId) {
      clauses.push("i.source_id = ?");
      params.push(filters.sourceId);
    }
    if (filters.query) {
      clauses.push(`(
        i.title_original LIKE ? OR i.title_zh LIKE ? OR
        i.summary_original LIKE ? OR i.summary_zh LIKE ?
      )`);
      const query = `%${filters.query}%`;
      params.push(query, query, query, query);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.min(Math.max(Number(filters.limit) || 80, 1), 250);
    const offset = Math.max(Number(filters.offset) || 0, 0);
    const rows = this.db.prepare(`
      SELECT i.*, s.name AS source_name, s.official, s.authority AS source_authority, s.color AS source_color
      FROM items i
      JOIN sources s ON s.id = i.source_id
      ${where}
      ORDER BY i.published_at DESC, i.id DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    const subscriptions = this.listSubscriptions().filter((item) => item.enabled);
    return rows.map((row) => mapItem(row, subscriptions));
  }

  stats() {
    const totals = this.db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN datetime(published_at) >= datetime('now', '-24 hours') THEN 1 ELSE 0 END) AS last24h,
        SUM(CASE WHEN category IN ('政策', '监管') AND datetime(published_at) >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS policy7d,
        SUM(CASE WHEN translated = 1 THEN 1 ELSE 0 END) AS translated
      FROM items
    `).get();
    const regionRows = this.db.prepare("SELECT region, COUNT(*) AS count FROM items GROUP BY region").all();
    return {
      total: Number(totals.total || 0),
      last24h: Number(totals.last24h || 0),
      policy7d: Number(totals.policy7d || 0),
      translated: Number(totals.translated || 0),
      regions: Object.fromEntries(regionRows.map((row) => [row.region, Number(row.count)])),
      latestFetchAt: this.db.prepare("SELECT MAX(last_success_at) AS value FROM sources").get().value || null,
    };
  }

  getSetting(key, fallback = null) {
    return this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key)?.value ?? fallback;
  }

  setSetting(key, value) {
    this.db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, String(value));
  }

  close() {
    this.db.close();
  }
}

function mapSource(row) {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    kind: row.kind,
    region: row.region,
    category: row.category,
    official: Boolean(row.official),
    authority: row.authority || (row.official ? "官方发布" : "专业媒体"),
    enabled: Boolean(row.enabled),
    color: row.color,
    linkPattern: row.link_pattern,
    itemCount: Number(row.item_count || 0),
    latestItemAt: row.latest_item_at || null,
    lastSuccessAt: row.last_success_at || null,
    lastError: row.last_error || null,
  };
}

function mapItem(row, subscriptions) {
  const title = row.title_zh || row.title_original;
  const summary = row.summary_zh || row.summary_original;
  const haystack = `${title} ${summary} ${row.title_original}`.toLowerCase();
  const matches = subscriptions
    .filter((subscription) => haystack.includes(subscription.keyword.toLowerCase()))
    .map((subscription) => subscription.keyword);
  const item = {
    id: row.id,
    sourceId: row.source_id,
    sourceName: row.source_name,
    sourceColor: row.source_color,
    official: Boolean(row.official),
    authority: row.source_authority || (row.official ? "官方发布" : "专业媒体"),
    url: row.url,
    title,
    summary,
    titleOriginal: row.title_original,
    summaryOriginal: row.summary_original,
    publishedAt: row.published_at,
    fetchedAt: row.fetched_at,
    region: row.region,
    category: row.category,
    language: row.language,
    translated: Boolean(row.translated),
    tags: safeJson(row.tags, []),
    matches,
    relevance: matches.length,
    contentStatus: row.content_status || "idle",
    hasFullContent: row.content_status === "ready" || row.content_status === "partial",
  };
  const importance = assessImportance(item);
  return {
    ...item,
    importance: importance.level,
    importanceScore: importance.score,
    importanceReasons: importance.reasons,
  };
}

function mapArticleContent(row) {
  return {
    id: Number(row.id),
    url: row.url,
    title: row.title_zh || row.title_original,
    titleOriginal: row.title_original,
    sourceName: row.source_name,
    publishedAt: row.published_at,
    contentOriginal: row.content_original || "",
    contentZh: row.content_zh || "",
    status: row.content_status || "idle",
    fetchedAt: row.content_fetched_at || null,
    error: row.content_error || null,
    byline: row.content_byline || "",
    method: row.content_method || null,
    wordCount: Number(row.content_word_count || 0),
  };
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function defaultDatabasePath(rootDir) {
  return path.join(rootDir, "data", "wen-ce.db");
}
