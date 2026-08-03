import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SOURCES,
  parseCctvJsonp,
  parseEastmoneyJson,
  parseHtmlCards,
  parseSinaJson,
  parseWallstreetcnJson,
  parseHtmlLinks,
} from "../src/sources.js";

const source = {
  id: "fixture",
  name: "测试来源",
  url: "https://example.com/news/",
  region: "国内",
  category: "要闻",
};

test("built-in source ids are unique and include mainstream domestic feeds", () => {
  const ids = DEFAULT_SOURCES.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ["cctv-latest", "eastmoney-latest", "sina-finance", "wallstreetcn-live", "yicai-latest", "36kr"]) {
    assert.ok(ids.includes(id), `missing source: ${id}`);
  }
});

test("parses CCTV JSONP", () => {
  const items = parseCctvJsonp(`news({"data":{"list":[{"id":"1","url":"https://news.cctv.com/2026/08/03/a.shtml","title":"测试新闻标题","brief":"测试摘要","focus_date":"2026-08-03 10:20:00"}]}})`, source);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "测试新闻标题");
  assert.equal(items[0].language, "zh");
});

test("parses financial JSON providers", () => {
  const eastmoney = parseEastmoneyJson(JSON.stringify({ data: { list: [{ code: "e1", uniqueUrl: "https://finance.example/e1", title: "东方财富测试资讯", summary: "市场摘要", showTime: "2026-08-03 10:00:00" }] } }), source);
  const sina = parseSinaJson(JSON.stringify({ result: { data: [{ docid: "s1", url: "https://finance.example/s1", title: "新浪财经测试资讯", intro: "财经摘要", ctime: 1785722400 }] } }), source);
  const wallstreet = parseWallstreetcnJson(JSON.stringify({ data: { items: [{ id: 2, uri: "https://wallstreetcn.com/livenews/2", title: "见闻快讯测试资讯", content_text: "快讯摘要", display_time: 1785722400 }] } }), source);
  assert.deepEqual([eastmoney.length, sina.length, wallstreet.length], [1, 1, 1]);
});

test("parses selector-based HTML cards", () => {
  const html = `<article data-id="42" data-time="1785722400"><a href="/news/42"><h2>网页卡片测试资讯</h2><p>网页摘要内容</p></a></article>`;
  const items = parseHtmlCards(html, {
    ...source,
    itemSelector: "article",
    linkSelector: "a",
    titleSelector: "h2",
    summarySelector: "p",
    dateAttribute: "data-time",
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].url, "https://example.com/news/42");
  assert.equal(items[0].summary, "网页摘要内容");
});

test("extracts and removes dates appended to HTML link titles", () => {
  const items = parseHtmlLinks(
    `<a href="/sports/20260803/example.html">测试体育新闻标题 2026-08-03 09:24:17</a>`,
    { ...source, linkPattern: "/sports/" },
  );
  assert.equal(items[0].title, "测试体育新闻标题");
  assert.equal(items[0].publishedAt, "2026-08-03T01:24:17.000Z");
});
