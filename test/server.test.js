import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startServer } from "../src/server.js";

test("local API boots and exposes the expanded source catalog", async (context) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tianjige-test-"));
  const runtime = await startServer({ port: 0, dataDir, autoRefresh: false });
  context.after(async () => {
    await runtime.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const health = await fetch(`${runtime.url}/api/health`).then((response) => response.json());
  const bootstrap = await fetch(`${runtime.url}/api/bootstrap`).then((response) => response.json());
  assert.equal(health.ok, true);
  assert.ok(bootstrap.sources.length >= 70);
  assert.ok(bootstrap.sources.some((source) => source.id === "cctv-latest" && source.category === "要闻"));
});
