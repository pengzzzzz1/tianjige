export class EdgeTranslator {
  constructor({ enabled = true } = {}) {
    this.enabled = enabled;
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  async translateMany(texts) {
    if (!this.enabled || !texts.length) return texts;
    const token = await this.getToken();
    const response = await fetch(
      "https://api-edge.cognitive.microsofttranslator.com/translate?api-version=3.0&to=zh-Hans",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(texts.map((text) => ({ Text: String(text || "").slice(0, 4_500) }))),
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!response.ok) throw new Error(`翻译服务 HTTP ${response.status}`);
    const result = await response.json();
    return result.map((entry, index) => entry?.translations?.[0]?.text || texts[index]);
  }

  async getToken() {
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token;
    const response = await fetch("https://edge.microsoft.com/translate/auth", {
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`翻译授权 HTTP ${response.status}`);
    this.token = await response.text();
    this.tokenExpiresAt = Date.now() + 8 * 60 * 1000;
    return this.token;
  }
}
