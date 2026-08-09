import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_HAUL_ROUTE,
  DEFAULT_INVESTIGATION_INPUT,
  DEFAULT_TEAM_PROFILE,
  RATE_SET_2026,
  calculateHaul,
  calculateInvestigationEstimate,
  convertSoilVolume,
} from "../src/index.ts";

function approximately(actual: number, expected: number, tolerance = 1e-9): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≉ ${expected}`);
}

test("토량 상태변환은 L·C 정의와 질량보존을 만족한다", () => {
  const result = convertSoilVolume({
    id: "soil",
    name: "토사",
    soilType: "보통토",
    volumeM3: 1_000,
    state: "natural",
    looseFactorL: 1.25,
    compactionFactorC: .9,
    naturalWetDensityTonnesPerM3: 1.8,
  });
  assert.equal(result.naturalVolumeM3, 1_000);
  assert.equal(result.looseVolumeM3, 1_250);
  assert.equal(result.compactedVolumeM3, 900);
  assert.equal(result.massTonnes, 1_800);
  approximately(result.looseVolumeM3 * result.looseDensityTonnesPerM3, 1_800);
  approximately(result.compactedVolumeM3 * result.compactedDensityTonnesPerM3, 1_800);
  assert.equal(result.massConservationErrorTonnes, 0);
});

test("흐트러짐·다짐 상태 입력도 같은 자연토량과 질량으로 역산한다", () => {
  const loose = convertSoilVolume({
    id: "loose", name: "loose", soilType: "토사", volumeM3: 1_250, state: "loose",
    looseFactorL: 1.25, compactionFactorC: .9, naturalWetDensityTonnesPerM3: 1.8,
  });
  const compacted = convertSoilVolume({
    id: "compacted", name: "compacted", soilType: "토사", volumeM3: 900, state: "compacted",
    looseFactorL: 1.25, compactionFactorC: .9, naturalWetDensityTonnesPerM3: 1.8,
  });
  approximately(loose.naturalVolumeM3, 1_000);
  approximately(compacted.naturalVolumeM3, 1_000);
  approximately(loose.massTonnes, compacted.massTonnes);
});

test("덤프 1회 적재량은 중량·용적 중 작은 값이며 100㎥는 12회이다", () => {
  const result = calculateHaul({
    looseVolumeM3: 100,
    looseDensityTonnesPerM3: 1.8,
    truck: {
      id: "truck", name: "15t", payloadTonnes: 15, bedVolumeM3: 12,
      weightLoadFactor: 1, volumeLoadFactor: 1, fleetSize: 1, turningSpaceConfirmed: true,
    },
    route: { ...DEFAULT_HAUL_ROUTE, heavyTruckConfirmed: true },
    workMinutesPerDay: 480,
    operatingEfficiency: .8,
  });
  approximately(result.massLimitedLoadM3, 15 / 1.8);
  assert.equal(result.volumeLimitedLoadM3, 12);
  assert.equal(result.limitingConstraint, "mass");
  assert.equal(result.totalLoadedTrips, 12);
  approximately(result.lastTripLoadM3, 100 - 11 * (15 / 1.8));
  assert.equal(result.totalDistanceKm, 240);
});

test("사이클·차량대수·목표일수·굴삭기 병목과 표준/현장 비용을 분리한다", () => {
  const result = calculateHaul({
    looseVolumeM3: 1_000,
    looseDensityTonnesPerM3: 1.5,
    truck: {
      id: "truck", name: "truck", payloadTonnes: 15, bedVolumeM3: 12,
      weightLoadFactor: 1, volumeLoadFactor: 1, fleetSize: 3,
      standardDailyRateKrw: 700_000, actualDailyRateKrw: 800_000,
      turningSpaceConfirmed: false,
    },
    route: { ...DEFAULT_HAUL_ROUTE, source: "kakao_car_reference", heavyTruckConfirmed: false },
    equipment: {
      id: "excavator", name: "excavator", productionM3PerHour: 30, efficiency: .5,
      standardDailyRateKrw: 900_000, actualDailyRateKrw: 1_000_000,
    },
    workMinutesPerDay: 480,
    operatingEfficiency: .8,
    targetDays: 4,
  });
  assert.equal(result.cycleMinutes, 64);
  assert.equal(result.tripsPerTruckDay, 6);
  assert.equal(result.requiredFleetForTarget, 5);
  assert.equal(result.bottleneck, "equipment");
  assert.equal(result.estimatedDays, 9);
  assert.equal(result.standardCostKrw, (700_000 * 3 + 900_000) * 9);
  assert.equal(result.scenarioCostKrw, (800_000 * 3 + 1_000_000) * 9);
  assert.ok(result.warnings.some((warning) => warning.includes("승용차")));
  assert.ok(result.warnings.some((warning) => warning.includes("목표일수")));
});

test("2026 시굴 1,000㎡ 평지·양호 공식 계산기 골든 케이스를 재현한다", () => {
  const result = calculateInvestigationEstimate({
    ...DEFAULT_INVESTIGATION_INPUT,
    investigationType: "trial",
    areaM2: 1_000,
    team: DEFAULT_TEAM_PROFILE,
  });
  const investigators = result.official.rolePersonDays.slice(0, 5);
  assert.deepEqual(investigators.map(({ fieldDays }) => fieldDays), [1.1, 2.4, 4.7, 4.1, .6]);
  assert.deepEqual(investigators.map(({ fieldWeeklyHolidayDays }) => fieldWeeklyHolidayDays), [0, 0, 0, 0, 0]);
  assert.deepEqual(investigators.map(({ reportDays }) => reportDays), [.2, .7, .9, .8, .1]);
  assert.equal(investigators.reduce((sum, row) => sum + row.fieldCostKrw, 0), 3_068_587);
  assert.equal(investigators.reduce((sum, row) => sum + row.reportCostKrw, 0), 653_278);
  assert.equal(result.official.directLaborKrw, 3_721_865);
});

test("2026 정밀 1,000㎡ 생활유적·저난도 공식 계산기 골든 케이스를 재현한다", () => {
  const result = calculateInvestigationEstimate({
    ...DEFAULT_INVESTIGATION_INPUT,
    investigationType: "precision",
    areaM2: 1_000,
    team: DEFAULT_TEAM_PROFILE,
    selectedDirectExpenseRatio: 2.3,
  });
  const investigators = result.official.rolePersonDays.slice(0, 5);
  assert.deepEqual(investigators.map(({ fieldDays }) => fieldDays), [3.3, 10.8, 17.9, 17.8, 15]);
  assert.deepEqual(investigators.map(({ fieldWeeklyHolidayDays }) => fieldWeeklyHolidayDays), [0, 2, 3, 3, 3]);
  assert.deepEqual(investigators.map(({ reportDays }) => reportDays), [2.3, 14.1, 17.9, 16, 12]);
  assert.deepEqual(investigators.map(({ reportWeeklyHolidayDays }) => reportWeeklyHolidayDays), [0, 2, 3, 3, 2]);
  assert.equal(investigators.reduce((sum, row) => sum + row.fieldCostKrw, 0), 16_205_854);
  assert.equal(investigators.reduce((sum, row) => sum + row.reportCostKrw, 0), 15_925_162);
  assert.equal(result.official.directLaborKrw, 32_131_016);
});

test("공식 비용 범위·직접산출·VAT·토공 중첩 확인과 개인화 공기를 분리한다", () => {
  const ratioEstimate = calculateInvestigationEstimate({
    ...DEFAULT_INVESTIGATION_INPUT,
    team: DEFAULT_TEAM_PROFILE,
    productivityFactor: 1.2,
    earthworkDays: 4,
    overlapRate: .5,
    overlapConfirmed: false,
  });
  assert.ok(ratioEstimate.official.directExpenseKrw.min < ratioEstimate.official.directExpenseKrw.selected);
  assert.ok(ratioEstimate.official.directExpenseKrw.selected < ratioEstimate.official.directExpenseKrw.max);
  assert.equal(ratioEstimate.personalizedFieldDays, ratioEstimate.standardFieldDays * 1.2);
  assert.equal(ratioEstimate.combinedOnSiteDays, ratioEstimate.earthworkDays + ratioEstimate.personalizedFieldDays);
  assert.ok(ratioEstimate.warnings.some((warning) => warning.includes("이중계상")));
  const itemized = calculateInvestigationEstimate({
    ...DEFAULT_INVESTIGATION_INPUT,
    team: DEFAULT_TEAM_PROFILE,
    directExpenseMode: "itemized",
    itemizedDirectExpenseKrw: 1_234_567,
  });
  assert.deepEqual(itemized.official.directExpenseKrw, { min: 1_234_567, selected: 1_234_567, max: 1_234_567 });
  assert.equal(itemized.official.source.checksumSha256, RATE_SET_2026.sources[0]?.checksumSha256);
});
