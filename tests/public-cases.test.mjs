import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = new URL("../", import.meta.url);

async function runCases() {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--experimental-strip-types", "scripts/run-public-cases.ts", "--json"],
    { cwd: root },
  );
  return JSON.parse(stdout);
}

test("공개사례 fixture는 2026 단가 엔진의 고정 결과를 재현한다", async () => {
  const fixture = JSON.parse(await readFile(
    new URL("../data/public-cases/2026.1.json", import.meta.url),
    "utf8",
  ));
  const report = await runCases();
  assert.equal(report.results.length, fixture.cases.length);

  for (const definition of fixture.cases) {
    const actual = report.results.find(({ id }) => id === definition.id);
    assert.ok(actual, `${definition.id}: 실행 결과`);
    assert.equal(actual.standardFieldDays, definition.expectedSnapshot.standardFieldDays);
    assert.equal(actual.reportWorkDays, definition.expectedSnapshot.reportWorkDays);
    assert.equal(actual.directLaborKrw, definition.expectedSnapshot.directLaborKrw);
    assert.deepEqual(actual.totalIncludingVatKrw, definition.expectedSnapshot.totalIncludingVatKrw);
    assert.ok(definition.assumptions.length > 0, `${definition.id}: 공개되지 않은 입력 가정`);
    assert.ok(definition.notComparable.length > 0, `${definition.id}: 비교 제한`);
  }
});

test("공개계획의 58일은 팀 배치 민감도를 드러내되 정확도 주장으로 쓰지 않는다", async () => {
  const { results } = await runCases();
  const fourLaborers = results.find(({ id }) => id === "changnyeong-ucheonri-2026-low");
  const twoLaborers = results.find(({ id }) => id === "changnyeong-ucheonri-2026-two-laborers");
  assert.equal(fourLaborers.standardFieldDays, 28.575);
  assert.equal(twoLaborers.standardFieldDays, 57.15);
  assert.ok(Math.abs(twoLaborers.fieldDifferenceDays) < 1);
  assert.equal(twoLaborers.directLaborKrw, fourLaborers.directLaborKrw);
  assert.match(twoLaborers.notComparable.join(" "), /증거가 아님/);
});

test("허가대장 감사는 공개 기준선의 모집단과 결측 한계를 고정한다", async () => {
  const fixture = JSON.parse(await readFile(
    new URL("../data/public-cases/2026.1.json", import.meta.url),
    "utf8",
  ));
  assert.equal(fixture.permitRegistryAudit.totalRows, 11_517);
  assert.equal(fixture.permitRegistryAudit.rowsAfterRemovingReversedDates, 10_003);
  assert.equal(fixture.permitRegistryAudit.coveragePercent.usableCalendarBenchmark, 86.9);
  assert.match(fixture.methodology.prohibitedUse, /개인화/);
  for (const artifact of fixture.sourceArtifacts) {
    assert.ok(URL.canParse(artifact.url));
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
  }
});

test("VWorld 주소 응답은 프로젝트에 반영·저장하지 않고 세션 미리보기만 쓴다", async () => {
  const source = await readFile(new URL("../app/calculator-app.tsx", import.meta.url), "utf8");
  const addressBranch = source.slice(
    source.indexOf('if (kind === "address")'),
    source.indexOf('} else if (kind === "route")'),
  );
  assert.match(addressBranch, /setGeocodePreview/);
  assert.doesNotMatch(addressBranch, /updateLocationAndInvalidateWeather/);
  assert.doesNotMatch(addressBranch, /\/api\/parcel/);
  assert.match(source, /응답은 화면에만 표시하며 저장·내보내기하지 않습니다/);
});
