import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const registry = JSON.parse(
  await readFile(new URL("../data/sources/2026.1.json", import.meta.url), "utf8"),
);
const baseline = registry.sources.find((source) => source.id === "khs-buried-heritage-fee-2026-2");
assert.ok(baseline, "국가유산청 조사대가 기준 출처가 등록되어 있어야 합니다.");

const endpoint = new URL("https://www.law.go.kr/DRF/lawSearch.do");
endpoint.search = new URLSearchParams({
  OC: process.env.LAW_OPEN_API_OC || "test",
  target: "admrul",
  type: "JSON",
  nw: "1",
  search: "1",
  query: baseline.title,
  display: "20",
  page: "1",
}).toString();

const response = await fetch(endpoint, {
  headers: {
    accept: "application/json",
    "user-agent": "price-excavation-source-watch/0.1 (+https://github.com/lzpxilfe/price-excavation)",
  },
  signal: AbortSignal.timeout(20_000),
});
assert.equal(response.ok, true, `국가법령정보 API 응답 오류: ${response.status}`);
const payload = await response.json();
assert.equal(payload?.AdmRulSearch?.resultCode, "00", "국가법령정보 API 검색에 실패했습니다.");

const rawItems = payload.AdmRulSearch.admrul;
const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
const current = items.find(
  (item) => item["행정규칙명"] === baseline.title && item["소관부처명"] === "국가유산청",
);
assert.ok(current, `현행 '${baseline.title}'을 찾지 못했습니다.`);

const expectedNotice = baseline.noticeNumber.match(/제(.+?)호/)?.[1];
const expectedEffective = baseline.effectiveFrom.replaceAll("-", "");
const expectedSequence = new URL(baseline.landingPageUrl).searchParams.get("admRulSeq");
const observations = {
  noticeNumber: current["발령번호"],
  effectiveFrom: current["시행일자"],
  sequence: current["행정규칙일련번호"],
};
const changes = [
  expectedNotice !== observations.noticeNumber && `발령번호 ${expectedNotice} → ${observations.noticeNumber}`,
  expectedEffective !== observations.effectiveFrom && `시행일 ${expectedEffective} → ${observations.effectiveFrom}`,
  expectedSequence !== observations.sequence && `행정규칙 일련번호 ${expectedSequence} → ${observations.sequence}`,
].filter(Boolean);

if (changes.length > 0) {
  console.error("국가유산청 조사대가 기준의 변경 후보를 발견했습니다.");
  changes.forEach((change) => console.error(`- ${change}`));
  console.error("기존 데이터는 변경하지 않았습니다. 원문 수집·차이검사·사람 승인을 진행하세요.");
  process.exitCode = 2;
} else {
  console.log(`변경 없음: ${baseline.noticeNumber}, 시행 ${baseline.effectiveFrom}`);
}
