import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = new URL("../", import.meta.url);
const dataRoot = new URL("../data/", import.meta.url);
const allowedLifecycle = new Set(["draft", "reviewed", "published", "superseded"]);

async function jsonFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? jsonFiles(path) : extname(entry.name) === ".json" ? [path] : [];
    }),
  );
  return nested.flat();
}

const files = await jsonFiles(dataRoot.pathname);
assert.ok(files.length > 0, "data/에는 버전이 지정된 JSON 자료가 있어야 합니다.");

for (const path of files) {
  const label = relative(root.pathname, path);
  const parsed = JSON.parse(await readFile(path, "utf8"));
  assert.match(parsed.schemaVersion ?? "", /^\d+\.\d+\.\d+$/, `${label}: schemaVersion`);
  assert.match(parsed.version ?? "", /^\d{4}\.\d+(?:\.\d+)?$/, `${label}: version`);
  assert.ok(allowedLifecycle.has(parsed.status), `${label}: 알 수 없는 lifecycle status ${parsed.status}`);
  assert.match(parsed.asOf ?? "", /^\d{4}-\d{2}-\d{2}$/, `${label}: asOf`);
}

const sources = JSON.parse(
  await readFile(new URL("../data/sources/2026.1.json", import.meta.url), "utf8"),
);
const sourceIds = new Set(sources.sources.map((source) => source.id));
assert.equal(sourceIds.size, sources.sources.length, "source id는 중복될 수 없습니다.");
for (const source of sources.sources) {
  assert.ok(source.title && source.publisher, `${source.id}: title/publisher`);
  assert.ok(URL.canParse(source.landingPageUrl), `${source.id}: landingPageUrl`);
  assert.match(source.provenance?.checkedAt ?? "", /^\d{4}-\d{2}-\d{2}$/, `${source.id}: checkedAt`);
}

for (const path of files.filter((path) => !path.includes("/sources/"))) {
  const parsed = JSON.parse(await readFile(path, "utf8"));
  for (const sourceId of parsed.sourceIds ?? []) {
    assert.ok(sourceIds.has(sourceId), `${relative(root.pathname, path)}: 등록되지 않은 sourceId ${sourceId}`);
  }
}

console.log(`${files.length}개 데이터 파일과 ${sources.sources.length}개 출처를 확인했습니다.`);
