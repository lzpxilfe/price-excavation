import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/", init = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, {
      ...init,
      headers: { accept: "text/html", ...(init.headers ?? {}) },
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("한국어 계산기 화면과 로컬 우선 안내를 서버 렌더링한다", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<html[^>]+lang="ko"/i);
  assert.match(html, /<title>터파기 — 발굴 현장 토공·공기·단가 계산기<\/title>/i);
  assert.match(html, /발굴 현장 계산기/);
  assert.match(html, /현장 위치/);
  assert.match(html, /로컬 전용 저장/);
  assert.match(html, /측량 파일과 조사자 정보는 이 기기를 떠나지 않습니다/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("외부 프록시는 동의·범위·형식을 서버에서 검증한다", async () => {
  const withoutConsent = await render("/api/geocode", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "경주 황남동", consent: false }),
  });
  assert.equal(withoutConsent.status, 400);

  const legacyGet = await render("/api/geocode?q=%EA%B2%BD%EC%A3%BC&consent=true");
  assert.equal(legacyGet.status, 405);

  const invalidWeatherDate = await render("/api/weather?stationId=283&startDate=2026-02-30&endDate=2026-03-01&consent=true");
  assert.equal(invalidWeatherDate.status, 400);

  const outsideParcel = await render("/api/parcel?longitude=0&latitude=0&consent=true");
  assert.equal(outsideParcel.status, 400);

  const invalidRoute = await render("/api/directions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      consent: true,
      origin: { longitude: 999, latitude: 37 },
      destination: { longitude: 127, latitude: 37 },
    }),
  });
  assert.equal(invalidRoute.status, 400);
});

test("소셜 카드와 API 키 비노출 계약을 유지한다", async () => {
  await access(new URL("../public/og.png", import.meta.url));
  for (const screenshot of [
    "01-location-input.jpg",
    "02-public-case-result.jpg",
    "03-three-ledgers.jpg",
  ]) {
    await access(new URL(`../docs/screenshots/${screenshot}`, import.meta.url));
  }
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, /공개자료 실증: 어디까지 계산할 수 있나/);
  assert.match(readme, /창녕 우천리 M14/);
  assert.match(readme, /docs\/screenshots\/02-public-case-result\.jpg/);
  const html = await (await render()).text();
  assert.match(html, /og\.png/);
  for (const secretName of ["VWORLD_API_KEY", "DATA_GO_KR_SERVICE_KEY", "KAKAO_MOBILITY_REST_KEY"]) {
    assert.doesNotMatch(html, new RegExp(secretName));
  }
  const page = await readFile(new URL("../app/calculator-app.tsx", import.meta.url), "utf8");
  assert.match(page, /new Worker\(/);
  assert.match(page, /indexedDB|saveActiveProject/);
  assert.match(page, /\/api\/geocode/);
  assert.match(page, /\/api\/directions/);
  assert.match(page, /\/api\/weather/);
  assert.match(page, /nearestAsosStation/);
  assert.match(page, /scenarioDateRange/);
  assert.match(page, /observationSource/);
});
