import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_WEATHER_POLICY,
  PROJECT_SCHEMA_VERSION,
  RATE_SET_2026,
  calculateCalibration,
  calculateWeatherSchedule,
  createDefaultProject,
} from "../src/index.ts";
import type { ActualProject } from "../src/index.ts";

test("같은 날 여러 기상기준을 넘겨도 비작업일은 한 번만 센다", () => {
  const result = calculateWeatherSchedule({
    startDate: "2026-01-06",
    asOfDate: "2026-01-01",
    fieldWorkDays: 3,
    policy: { ...DEFAULT_WEATHER_POLICY, confirmedByUser: true, historyYears: 1 },
    observations: [
      { date: "2025-01-06", precipitationMm: 7, maxInstantWindMps: 17, apparentTemperatureMaxC: 10, minimumTemperatureC: 5, newSnowCm: 0 },
      { date: "2025-01-07", precipitationMm: 0, maxInstantWindMps: 2, apparentTemperatureMaxC: 10, minimumTemperatureC: 5, newSnowCm: 0 },
      { date: "2025-01-08", precipitationMm: 0, maxInstantWindMps: 2, apparentTemperatureMaxC: 10, minimumTemperatureC: 5, newSnowCm: 0 },
      { date: "2025-01-09", precipitationMm: 0, maxInstantWindMps: 2, apparentTemperatureMaxC: 10, minimumTemperatureC: 5, newSnowCm: 0 },
    ],
    standbyCostKrwPerWeatherDay: 500_000,
  });
  assert.equal(result.mode, "historical");
  assert.equal(result.scenarios.length, 1);
  assert.equal(result.scenarios[0]?.calendarDays, 4);
  assert.equal(result.scenarios[0]?.weatherNonWorkDays, 1);
  assert.deepEqual(result.scenarios[0]?.weatherDates, ["2025-01-06"]);
  assert.equal(result.scenarios[0]?.weatherReasonCounts.precipitation, 1);
  assert.equal(result.scenarios[0]?.weatherReasonCounts.wind, 1);
  assert.equal(result.standbyCostKrw.median, 500_000);
});

test("최근 5개 완전연도의 같은 착수월에서 중앙값·80분위를 계산한다", () => {
  const observations = [];
  const delayByYear: Record<number, number> = { 2021: 0, 2022: 1, 2023: 2, 2024: 3, 2025: 4 };
  for (const [yearText, delay] of Object.entries(delayByYear)) {
    const year = Number(yearText);
    for (let day = 4; day <= 17; day += 1) {
      const date = `${year}-03-${String(day).padStart(2, "0")}`;
      observations.push({
        date,
        precipitationMm: day < 4 + delay ? 10 : 0,
        apparentTemperatureMaxC: 10,
        minimumTemperatureC: 5,
        newSnowCm: 0,
        maxInstantWindMps: 1,
      });
    }
  }
  const result = calculateWeatherSchedule({
    startDate: "2026-03-04",
    asOfDate: "2026-01-01",
    fieldWorkDays: 5,
    observations,
    policy: { ...DEFAULT_WEATHER_POLICY, confirmedByUser: true, historyYears: 5 },
  });
  assert.equal(result.scenarios.length, 5);
  const calendarDays = result.scenarios.map(({ calendarDays }) => calendarDays);
  assert.equal(result.medianCalendarDays, [...calendarDays].sort((a, b) => a - b)[2]);
  assert.equal(result.p80CalendarDays, [...calendarDays].sort((a, b) => a - b)[3]);
});

test("관측이 없으면 수동 비작업률로 완주하고 법정 가산율이 아님을 경고한다", () => {
  const result = calculateWeatherSchedule({
    startDate: "2026-08-03",
    fieldWorkDays: 10,
    policy: DEFAULT_WEATHER_POLICY,
    manualWeatherNonWorkRate: .2,
  });
  assert.equal(result.mode, "manual_rate");
  assert.equal(result.scenarios[0]?.weatherNonWorkDays, 3);
  assert.ok(result.medianCalendarDays >= 17);
  assert.ok(result.warnings.some((warning) => warning.includes("법정 가산율")));
  assert.ok(result.warnings.some((warning) => warning.includes("수동")));
});

test("필요 일정의 관측 피복이 불완전하면 과거통계를 확정하지 않고 수동모드로 전환한다", () => {
  const result = calculateWeatherSchedule({
    startDate: "2026-03-04",
    asOfDate: "2026-01-01",
    fieldWorkDays: 5,
    observations: [{ date: "2025-03-04", precipitationMm: 0 }],
    policy: { ...DEFAULT_WEATHER_POLICY, confirmedByUser: true, historyYears: 1 },
    manualWeatherNonWorkRate: .1,
  });
  assert.equal(result.mode, "manual_rate");
  assert.equal(result.scenarios.length, 1);
  assert.ok(result.warnings.some((warning) => warning.includes("확정하지 않았")));
});

test("공휴일·기타 중단일은 연도별 실제 날짜로만 중복 제거한다", () => {
  const observations = [
    { date: "2024-05-06", precipitationMm: 0 },
    { date: "2024-05-07", precipitationMm: 0 },
    { date: "2025-05-05", precipitationMm: 0 },
    { date: "2025-05-06", precipitationMm: 0 },
  ];
  const result = calculateWeatherSchedule({
    startDate: "2026-05-05",
    asOfDate: "2026-01-01",
    fieldWorkDays: 1,
    observations,
    holidayDates: ["2024-05-06", "2025-05-05"],
    policy: { ...DEFAULT_WEATHER_POLICY, confirmedByUser: true, historyYears: 2 },
  });
  assert.equal(result.mode, "historical");
  assert.deepEqual(result.scenarios.map(({ sourceYear, calendarDays }) => [sourceYear, calendarDays]), [[2024, 3], [2025, 2]]);
});

function actual(id: string, ratio: number, overrides: Partial<ActualProject> = {}): ActualProject {
  return {
    id,
    name: id,
    investigationType: "trial",
    completedAt: "2026-01-01",
    teamId: "team-1",
    investigatorIds: ["person-1"],
    areaM2: 1_000,
    standardFieldDays: 10,
    actualFieldDays: 10 * ratio,
    qualityWeight: 1,
    ...overrides,
  };
}

test("0~2건은 보정하지 않고 3건부터 사전가중치 3의 기하평균을 적용한다", () => {
  const two = calculateCalibration({
    actualProjects: [actual("a", 2), actual("b", 2)],
    investigationType: "trial",
    teamId: "team-1",
    asOfDate: "2026-01-01",
  });
  assert.equal(two.team.applied, false);
  assert.equal(two.team.factor, 1);
  const three = calculateCalibration({
    actualProjects: [actual("a", 2), actual("b", 2), actual("c", 2)],
    investigationType: "trial",
    teamId: "team-1",
    asOfDate: "2026-01-01",
  });
  assert.equal(three.team.applied, true);
  assert.ok(Math.abs(three.team.factor - Math.sqrt(2)) < 1e-12);
  assert.deepEqual(three.team.includedProjectIds, ["a", "b", "c"]);
  assert.equal(three.team.distribution, undefined);
});

test("개인 계수는 팀 계수를 제거한 잔차에 적용하고 제외·최근성·5건 분포를 공개한다", () => {
  const records = [
    actual("a", 2), actual("b", 2), actual("c", 2), actual("d", 2), actual("e", 2),
    actual("excluded", 10, { excluded: true }),
  ];
  const snapshot = calculateCalibration({
    actualProjects: records,
    investigationType: "trial",
    teamId: "team-1",
    investigatorId: "person-1",
    asOfDate: "2026-01-01",
  });
  assert.equal(snapshot.team.sampleCount, 5);
  assert.deepEqual(snapshot.team.distribution, { p20: 2, median: 2, p80: 2 });
  assert.deepEqual(snapshot.team.excludedProjectIds, ["excluded"]);
  assert.equal(snapshot.personal?.applied, true);
  assert.ok((snapshot.personal?.factor ?? 0) > 1);
  assert.ok(snapshot.combinedFactor > snapshot.team.factor);
});

test("기본 프로젝트는 버전·단가 스냅샷·세 원장 안내를 포함하고 호출마다 깊게 분리된다", () => {
  const first = createDefaultProject({ id: "p1", name: "현장 A", now: "2026-08-09T00:00:00.000Z" });
  const second = createDefaultProject({ id: "p2", now: "2026-08-09T00:00:00.000Z" });
  assert.equal(first.schemaVersion, PROJECT_SCHEMA_VERSION);
  assert.equal(first.name, "현장 A");
  assert.equal(first.weatherStartDate, "2026-08-09");
  assert.equal(first.rateSetSnapshot.id, RATE_SET_2026.id);
  assert.equal(first.location.externalLookupEnabled, false);
  assert.ok(first.notices.some((notice) => notice.includes("별도 원장")));
  first.soilBatches[0]!.volumeM3 = 42;
  assert.notEqual(second.soilBatches[0]?.volumeM3, 42);
  assert.notEqual(first.investigation.team, first.rateSetSnapshot);
});
