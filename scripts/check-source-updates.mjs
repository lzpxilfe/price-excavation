import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const registry = JSON.parse(
  await readFile(new URL("../data/sources/2026.1.json", import.meta.url), "utf8"),
);
const baseline = registry.sources.find((source) => source.id === "khs-buried-heritage-fee-2026-2");
assert.ok(baseline, "국가유산청 조사대가 기준 출처가 등록되어 있어야 합니다.");

const rulePath = [
  "문화체육관광부",
  "국가유산청",
  "고시",
  "매장유산 조사용역 대가의 기준",
  "본문.md",
].map(encodeURIComponent).join("/");
const endpoint = new URL(`https://raw.githubusercontent.com/legalize-kr/admrule-kr/main/${rulePath}`);

const response = await fetch(endpoint, {
  headers: {
    accept: "text/markdown",
    "user-agent": "price-excavation-source-watch/0.1 (+https://github.com/lzpxilfe/price-excavation)",
  },
  signal: AbortSignal.timeout(20_000),
});
assert.equal(response.ok, true, `Legalize-KR 행정규칙 원문 응답 오류: ${response.status}`);
const document = await response.text();
const frontmatter = document.match(/^---\r?\n([\s\S]*?)\r?\n---/);
assert.ok(frontmatter, "Legalize-KR 행정규칙 원문의 메타데이터를 찾지 못했습니다.");

const metadata = Object.fromEntries(
  frontmatter[1]
    .split(/\r?\n/)
    .map((line) => line.match(/^([^:]+):\s*['"]?(.+?)['"]?\s*$/))
    .filter((match) => match !== null)
    .map((match) => [match[1].trim(), match[2].trim()]),
);

assert.equal(metadata["행정규칙명"], baseline.title, "다른 행정규칙을 조회했습니다.");
assert.equal(metadata["소관부처명"], "국가유산청", "국가유산청 고시를 조회해야 합니다.");
assert.equal(metadata["현행여부"], "Y", "현행 행정규칙이 아닙니다.");

const expectedNotice = baseline.noticeNumber.match(/제(.+?)호/)?.[1];
const expectedEffective = baseline.effectiveFrom;
const expectedSequence = new URL(baseline.landingPageUrl).searchParams.get("admRulSeq");
const observations = {
  noticeNumber: metadata["발령번호"],
  effectiveFrom: metadata["시행일자"],
  sequence: metadata["행정규칙일련번호"],
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
