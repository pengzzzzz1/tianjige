import net from "node:net";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

const MAX_ARTICLE_CHARS = 150_000;
const MIN_ARTICLE_CHARS = 160;
const TRANSLATION_CHUNK_CHARS = 3_500;
const TRANSLATION_BATCH_CHARS = 38_000;

export async function fetchArticleContent({ item, translator, fetchImpl = fetch }) {
  assertSafeArticleUrl(item.url);
  let extracted = null;
  let directError = null;

  try {
    const html = await fetchHtml(item.url, fetchImpl);
    extracted = extractReadableArticle(html, item.url);
    if (!extracted?.contentOriginal || extracted.contentOriginal.length < MIN_ARTICLE_CHARS) {
      throw new Error("正文结构无法识别");
    }
  } catch (error) {
    directError = error instanceof Error ? error.message : String(error);
    extracted = null;
  }

  if (!extracted) {
    try {
      const markdown = await fetchReaderText(item.url, fetchImpl);
      const contentOriginal = cleanReaderMarkdown(markdown);
      if (contentOriginal.length >= MIN_ARTICLE_CHARS) {
        extracted = {
          contentOriginal,
          byline: "",
          excerpt: item.summaryOriginal || "",
          method: "reader",
        };
      }
    } catch {
      // The stored source summary remains available as the final in-app fallback.
    }
  }

  if (!extracted) {
    const fallback = normalizeArticleText(item.summaryOriginal || item.summary || "");
    if (fallback.length < 40) {
      throw new Error(directError || "该来源暂未提供可读取的正文");
    }
    extracted = {
      contentOriginal: fallback,
      byline: "",
      excerpt: fallback.slice(0, 280),
      method: "summary",
    };
  }

  const contentOriginal = extracted.contentOriginal.slice(0, MAX_ARTICLE_CHARS);
  const contentZh = isMostlyChinese(contentOriginal)
    ? contentOriginal
    : await translateArticle(contentOriginal, translator);

  return {
    contentOriginal,
    contentZh,
    byline: extracted.byline || "",
    excerpt: extracted.excerpt || "",
    method: extracted.method,
    status: extracted.method === "summary" ? "partial" : "ready",
    wordCount: countReadableCharacters(contentZh),
  };
}

export function extractReadableArticle(html, url) {
  const dom = new JSDOM(html, { url });
  const article = new Readability(dom.window.document, {
    charThreshold: 120,
    keepClasses: false,
  }).parse();
  if (!article) return null;

  const contentDom = new JSDOM(`<body>${article.content || ""}</body>`);
  const articleTitle = normalizeInlineText(article.title || "");
  const blocks = [...contentDom.window.document.querySelectorAll("h1, h2, h3, p, li, blockquote, pre")]
    .map((element) => normalizeInlineText(element.textContent))
    .filter((text) => text.length > 1 && text !== articleTitle && !isBoilerplate(text));
  const uniqueBlocks = blocks.filter((text, index) => text !== blocks[index - 1]);
  const contentOriginal = normalizeArticleText(
    uniqueBlocks.length ? uniqueBlocks.join("\n\n") : article.textContent || "",
  );

  return {
    contentOriginal,
    byline: normalizeInlineText(article.byline || ""),
    excerpt: normalizeInlineText(article.excerpt || ""),
    method: "direct",
  };
}

export async function translateArticle(text, translator) {
  if (!translator?.enabled) return text;
  const chunks = chunkArticleText(text);
  const translated = [];
  let cursor = 0;

  while (cursor < chunks.length) {
    const batch = [];
    let characters = 0;
    while (cursor < chunks.length && batch.length < 20) {
      const chunk = chunks[cursor];
      if (batch.length && characters + chunk.length > TRANSLATION_BATCH_CHARS) break;
      batch.push(chunk);
      characters += chunk.length;
      cursor += 1;
    }
    translated.push(...await translateBatchWithRetry(batch, translator));
  }

  return translated.join("\n\n");
}

export function chunkArticleText(text, maxChars = TRANSLATION_CHUNK_CHARS) {
  const paragraphs = normalizeArticleText(text).split(/\n{2,}/).filter(Boolean);
  const chunks = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxChars) {
      chunks.push(paragraph);
      continue;
    }
    let remaining = paragraph;
    while (remaining.length > maxChars) {
      const window = remaining.slice(0, maxChars + 1);
      const candidates = [window.lastIndexOf("。"), window.lastIndexOf("！"), window.lastIndexOf("？"),
        window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "), window.lastIndexOf("; ")];
      const splitAt = Math.max(...candidates);
      const end = splitAt > maxChars * 0.55 ? splitAt + 1 : maxChars;
      chunks.push(remaining.slice(0, end).trim());
      remaining = remaining.slice(end).trim();
    }
    if (remaining) chunks.push(remaining);
  }
  return chunks;
}

export function cleanReaderMarkdown(markdown) {
  let text = String(markdown || "");
  const marker = text.indexOf("Markdown Content:");
  if (marker >= 0) text = text.slice(marker + "Markdown Content:".length);
  return normalizeArticleText(text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/\*\*|__|`/g, ""));
}

function normalizeArticleText(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .split(/\n+/)
    .map(normalizeInlineText)
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function normalizeInlineText(value) {
  return String(value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
}

async function translateBatchWithRetry(batch, translator) {
  try {
    return await translator.translateMany(batch);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 350));
    return translator.translateMany(batch);
  }
}

function isBoilerplate(text) {
  return text.length < 120 && /^(责任编辑|【纠错】|相关阅读|更多新闻|Copyright|All rights reserved|Sign up|Subscribe)/i.test(text);
}

async function fetchHtml(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: {
      accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.7",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 TianJiGe/1.3",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(22_000),
  });
  if (!response.ok) throw new Error(`原站 HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (contentType && !/html|xhtml|text\/plain/i.test(contentType)) throw new Error("原站未返回网页正文");
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > 8_000_000) throw new Error("原文页面过大");
  return response.text();
}

async function fetchReaderText(url, fetchImpl) {
  const readerUrl = `https://r.jina.ai/${url}`;
  const response = await fetchImpl(readerUrl, {
    headers: { accept: "text/plain", "user-agent": "TianJiGe/1.3" },
    signal: AbortSignal.timeout(28_000),
  });
  if (!response.ok) throw new Error(`只读通道 HTTP ${response.status}`);
  return response.text();
}

function assertSafeArticleUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("仅支持 HTTP/HTTPS 文章");
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local")) throw new Error("不读取本机地址");
  const ipVersion = net.isIP(hostname);
  if (ipVersion && isPrivateIp(hostname)) throw new Error("不读取内网地址");
}

function isPrivateIp(hostname) {
  if (hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.startsWith("fe80:")) {
    return true;
  }
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4) return false;
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

function isMostlyChinese(text) {
  const characters = String(text || "").replace(/\s/g, "");
  if (!characters) return false;
  const chinese = (characters.match(/[\u3400-\u9fff]/g) || []).length;
  return chinese / characters.length > 0.25;
}

function countReadableCharacters(text) {
  return String(text || "").replace(/\s/g, "").length;
}
