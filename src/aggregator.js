import { fetchSource } from "./sources.js";

export class Aggregator {
  constructor({ store, translator, onEvent = () => {}, fetcher = fetchSource, concurrency = 8 }) {
    this.store = store;
    this.translator = translator;
    this.onEvent = onEvent;
    this.fetcher = fetcher;
    this.concurrency = Math.max(1, Number(concurrency) || 8);
    this.batchCursor = 0;
    this.running = false;
  }

  async refresh({ sourceId = null, batchSize = null } = {}) {
    if (this.running) return { running: true, inserted: 0, translated: 0, errors: [] };
    this.running = true;
    this.onEvent("refresh", { status: "started" });
    const allSources = sourceId
      ? [this.store.getSource(sourceId)].filter(Boolean)
      : this.store.listSources({ enabledOnly: true });
    const sources = this.selectBatch(allSources, sourceId ? null : batchSize);
    const report = {
      running: false,
      inserted: 0,
      translated: 0,
      errors: [],
      sources: sources.length,
      sourceTotal: allSources.length,
      batch: Boolean(batchSize),
    };
    const hadExistingItems = this.store.stats().total > 0;
    const baselineSourceIds = new Set(sources.filter((source) => source.itemCount === 0).map((source) => source.id));
    const insertedIds = [];

    try {
      const workerCount = Math.min(this.concurrency, sources.length);
      const workers = Array.from({ length: workerCount }, async (_, workerIndex) => {
        for (let index = workerIndex; index < sources.length; index += workerCount) {
          const source = sources[index];
          try {
            const items = await this.fetcher(source);
            let insertedForSource = 0;
            for (const item of items) {
              const insertedId = this.store.insertItem(item);
              if (insertedId) {
                insertedForSource += 1;
                insertedIds.push(insertedId);
              }
            }
            report.inserted += insertedForSource;
            this.store.markSourceResult(source.id);
            this.onEvent("source", { sourceId: source.id, inserted: insertedForSource });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            report.errors.push({ sourceId: source.id, sourceName: source.name, message });
            this.store.markSourceResult(source.id, message);
          }
        }
      });
      await Promise.all(workers);
      report.translated = await this.translatePending();
      if (hadExistingItems && insertedIds.length) {
        const insertedSet = new Set(insertedIds);
        const newItems = this.store.listItems({ limit: Math.min(insertedIds.length + 20, 250) })
          .filter((item) => insertedSet.has(item.id));
        const majorItems = newItems
          .filter((item) => !baselineSourceIds.has(item.sourceId))
          .filter((item) => item.importance === "major" || item.importance === "critical")
          .sort((a, b) => b.importanceScore - a.importanceScore)
          .slice(0, 8);
        report.major = majorItems.length;
        if (majorItems.length) {
          this.onEvent("major", {
            count: majorItems.length,
            items: majorItems.map((item) => ({
              id: item.id,
              title: item.title,
              sourceName: item.sourceName,
              category: item.category,
              url: item.url,
              importance: item.importance,
              reasons: item.importanceReasons,
            })),
          });
        }
      } else {
        report.major = 0;
      }
      this.onEvent("refresh", { status: "finished", ...report });
      return report;
    } finally {
      this.running = false;
    }
  }

  selectBatch(sources, batchSize) {
    const size = Math.min(Math.max(Number(batchSize) || sources.length, 1), sources.length);
    if (!sources.length || size >= sources.length) return sources;
    const start = this.batchCursor % sources.length;
    const batch = Array.from({ length: size }, (_, index) => sources[(start + index) % sources.length]);
    this.batchCursor = (start + size) % sources.length;
    return batch;
  }

  async translatePending(limit = 500) {
    if (!this.translator.enabled) return 0;
    const pending = this.store.getPendingTranslations(limit);
    if (!pending.length) return 0;
    let translatedCount = 0;

    for (let start = 0; start < pending.length; start += 20) {
      const batch = pending.slice(start, start + 20);
      const texts = batch.flatMap((item) => [item.title_original, item.summary_original || ""]);
      try {
        const translated = await this.translator.translateMany(texts);
        batch.forEach((item, index) => {
          this.store.setTranslation(item.id, translated[index * 2], translated[index * 2 + 1] || "");
          translatedCount += 1;
        });
      } catch (error) {
        this.onEvent("translation", {
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
        break;
      }
    }
    return translatedCount;
  }
}
