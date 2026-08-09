import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";
import {
  buildBenchmarkFromBytes,
  buildBenchmarkFromRecords,
} from "../scripts/build-permit-benchmark.mjs";

const execFileAsync = promisify(execFile);
const root = new URL("../", import.meta.url);
const fixtureUrl = new URL(
  "../data/public-benchmarks/permit-registry-2026-06-30.aggregate.json",
  import.meta.url,
);

async function fixture() {
  return JSON.parse(await readFile(fixtureUrl, "utf8"));
}

async function runBenchmark(...argumentsList) {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--experimental-strip-types", "scripts/run-public-cases.ts", "--json", ...argumentsList],
    { cwd: root },
  );
  return JSON.parse(stdout);
}

function publicRecord({
  permitNumber,
  investigationClass,
  areaM2,
  durationDays,
  startDate,
  completionDate,
}) {
  return {
    허가번호: permitNumber,
    발굴허가일: "2024-01-01",
    발굴기간: String(durationDays),
    착수일: startDate,
    발굴완료일: completionDate,
    시굴면적: investigationClass === "trial" ? String(areaM2) : "0",
    발굴면적: investigationClass === "precision" ? String(areaM2) : "0",
    조사면적: String(areaM2),
  };
}

test("공개 허가자료는 식별 행 없이 최소 30건 익명 코호트로만 게시한다", async () => {
  const benchmark = await fixture();
  assert.equal(benchmark.evidencePolicy.publication.mode, "aggregate-only");
  assert.equal(benchmark.evidencePolicy.publication.minimumCellSize, 30);
  assert.equal(benchmark.cells.length, 12);
  assert.equal(benchmark.cells.reduce((total, cell) => total + cell.n, 0), 7_123);
  assert.ok(benchmark.cells.every(({ n }) => n >= 30));
  assert.deepEqual(benchmark.cohort.permitYearRange, { from: 2021, to: 2025 });
  assert.equal(benchmark.cohort.audit.inputRows, 11_517);
  assert.equal(benchmark.cohort.audit.completePermitYearRows, 9_445);
  assert.equal(benchmark.cohort.audit.rowsAfterDateAndValueFilters, 8_427);
  assert.equal(benchmark.cohort.audit.eligibleAggregateRows, 7_123);
  assert.equal(benchmark.cohort.audit.excludedInvestigationClass.mixed, 77);
  assert.equal(benchmark.cohort.audit.excludedInvestigationClass.unspecified, 1_227);

  const serializedCells = JSON.stringify(benchmark.cells);
  for (const prohibitedValue of ["조사기관", "허가번호", "유적명", "주소", "좌표"]) {
    assert.doesNotMatch(serializedCells, new RegExp(prohibitedValue));
  }
  assert.doesNotMatch(serializedCells, /(?:산|번지)\s*\d+/);
  assert.doesNotMatch(serializedCells, /\b20\d{6}\b/);
  assert.equal("cases" in benchmark, false);
});

test("집계 분위수와 라이선스·출처 스냅샷은 재현 가능한 값으로 고정한다", async () => {
  const benchmark = await fixture();
  assert.equal(benchmark.sourceSnapshot.licenseEvidence.label, "이용허락범위 제한 없음");
  assert.match(benchmark.sourceSnapshot.checksum.value, /^[a-f0-9]{64}$/);
  for (const cell of benchmark.cells) {
    for (const metric of ["registeredDurationDays", "elapsedCalendarDays", "elapsedToRegisteredRatio"]) {
      assert.ok(cell[metric].p20 <= cell[metric].p50);
      assert.ok(cell[metric].p50 <= cell[metric].p80);
    }
    assert.equal(cell.evidenceLevel, "descriptive_aggregate");
  }
  const precision = benchmark.cells.find(({ investigationClass, areaBandId }) => (
    investigationClass === "precision" && areaBandId === "1001-3000"
  ));
  assert.equal(precision.n, 316);
  assert.deepEqual(precision.registeredDurationDays, { p20: 20, p50: 26, p80: 38 });
  assert.deepEqual(precision.elapsedCalendarDays, { p20: 31, p50: 49, p80: 121 });
});

test("오프라인 빌더는 행을 익명 셀로만 축약하고 R-7 분위수를 계산한다", () => {
  const rows = [];
  for (let index = 1; index <= 30; index += 1) {
    rows.push(publicRecord({
      permitNumber: `T-${index}`,
      investigationClass: "trial",
      areaM2: 500,
      durationDays: index,
      startDate: "2024-01-01",
      completionDate: `2024-01-${String(index).padStart(2, "0")}`,
    }));
    rows.push(publicRecord({
      permitNumber: `P-${index}`,
      investigationClass: "precision",
      areaM2: 800,
      durationDays: index,
      startDate: "2024-01-01",
      completionDate: `2024-01-${String(index).padStart(2, "0")}`,
    }));
  }
  const benchmark = buildBenchmarkFromRecords(rows, "a".repeat(64));
  assert.equal(benchmark.cells.length, 2);
  assert.equal(benchmark.cohort.audit.eligibleAggregateRows, 60);
  assert.deepEqual(benchmark.cells[0].registeredDurationDays, { p20: 6.8, p50: 15.5, p80: 24.2 });
  assert.ok(benchmark.cells.every(({ n }) => n === 30));
  assert.doesNotMatch(JSON.stringify(benchmark.cells), /T-1|P-1/);
});

test("오프라인 빌더는 공식 스냅샷과 체크섬이 다른 바이트를 거부한다", () => {
  const modifiedBytes = new TextEncoder().encode("공식 스냅샷이 아닌 변조 입력");
  assert.throws(
    () => buildBenchmarkFromBytes(modifiedBytes),
    /공식 2026-06-30 스냅샷의 SHA-256과 다릅니다/,
  );
});

test("면적 질의는 익명 코호트와 여러 공식 조건격자를 나란히 반환한다", async () => {
  const report = await runBenchmark("--type", "precision", "--area", "1200");
  assert.deepEqual(report.query, {
    investigationType: "precision",
    areaM2: 1200,
    targetRegisteredDurationDays: null,
  });
  assert.equal(report.cohortReference.areaBandId, "1001-3000");
  assert.equal(report.cohortReference.n, 316);
  assert.deepEqual(report.cohortReference.registeredDurationDays, { p20: 20, p50: 26, p80: 38 });
  assert.equal(report.officialScenarioGrid.length, 3);
  assert.ok(report.officialScenarioGrid.every(({ evidenceLevel }) => evidenceLevel === "conditional_inverse"));
  assert.ok(report.officialScenarioGrid.every(({ minimumConcurrentRoleCounts }) => minimumConcurrentRoleCounts === null));
});

test("기간 역산은 실제 팀을 맞히지 않고 조건별 최소 동시배치 집합을 반환한다", async () => {
  const targetDays = 26;
  const report = await runBenchmark(
    "--type", "precision",
    "--area", "1200",
    "--target-days", String(targetDays),
  );
  assert.equal(report.officialScenarioGrid.length, 3);
  for (const scenario of report.officialScenarioGrid) {
    assert.ok(scenario.resultingBottleneckDays <= targetDays);
    for (const row of scenario.rolePersonDays) {
      assert.equal(
        scenario.minimumConcurrentRoleCounts[row.role],
        Math.max(1, Math.ceil(row.fieldDays / targetDays)),
      );
    }
  }
  assert.match(report.interpretation.join(" "), /실제 투입인원이 아닙니다/);
  assert.ok(report.prohibitedInferences.some((value) => value.includes("실제 투입인원")));
});

test("발굴기간과 착수~완료 경과일은 작업일·중단사유로 재명명하지 않는다", async () => {
  const benchmark = await fixture();
  const policy = benchmark.evidencePolicy.prohibitedInferences.join(" ");
  assert.match(policy, /순수 현장 작업일로 단정/);
  assert.match(policy, /기상·휴일·행정중단으로 분해/);
  assert.match(policy, /개인 생산성 보정/);
});

test("CLI는 조건 없는 기간 역산과 미지원 인자를 조용히 무시하지 않는다", async () => {
  await assert.rejects(
    execFileAsync(
      process.execPath,
      ["--experimental-strip-types", "scripts/run-public-cases.ts", "--target-days", "26"],
      { cwd: root },
    ),
    (error) => error.code === 1 && /--target-days는 --type 및 --area와 함께/.test(error.stderr),
  );
  await assert.rejects(
    execFileAsync(
      process.execPath,
      ["--experimental-strip-types", "scripts/run-public-cases.ts", "--bogus", "value"],
      { cwd: root },
    ),
    (error) => error.code === 1 && /지원하지 않는 인자입니다: --bogus/.test(error.stderr),
  );
});
