import type {
  WeatherCalculationInput,
  WeatherObservation,
  WeatherScheduleResult,
  WeatherYearScenario,
} from "./types.ts";
import { addUtcDays, assertValid, finitePositive, isoDate, parseIsoDate, ratio } from "./validation.ts";

type WeatherReason = "precipitation" | "heat" | "cold" | "snow" | "wind";

function weatherReasons(observation: WeatherObservation | undefined, input: WeatherCalculationInput): WeatherReason[] {
  if (!observation) return [];
  const reasons: WeatherReason[] = [];
  const policy = input.policy;
  if (
    policy.precipitationThresholdMm !== undefined &&
    observation.precipitationMm !== undefined &&
    observation.precipitationMm >= policy.precipitationThresholdMm
  ) reasons.push("precipitation");
  if (
    policy.apparentTemperatureThresholdC !== undefined &&
    observation.apparentTemperatureMaxC !== undefined &&
    observation.apparentTemperatureMaxC >= policy.apparentTemperatureThresholdC
  ) reasons.push("heat");
  if (
    policy.minimumTemperatureThresholdC !== undefined &&
    observation.minimumTemperatureC !== undefined &&
    observation.minimumTemperatureC <= policy.minimumTemperatureThresholdC
  ) reasons.push("cold");
  if (
    policy.newSnowThresholdCm !== undefined &&
    observation.newSnowCm !== undefined &&
    observation.newSnowCm >= policy.newSnowThresholdCm
  ) reasons.push("snow");
  if (
    policy.maxInstantWindThresholdMps !== undefined &&
    observation.maxInstantWindMps !== undefined &&
    observation.maxInstantWindMps >= policy.maxInstantWindThresholdMps
  ) reasons.push("wind");
  return reasons;
}

function percentileNearestRank(values: number[], percentile: number): number {
  assertValid(values.length > 0, "values", "empty_distribution", "분위수를 계산할 값이 없습니다.");
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)] as number;
}

function dateInYear(month: number, day: number, year: number): Date {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay)));
}

function exactDateKeys(values: string[] | undefined): Set<string> {
  return new Set((values ?? []).map((value, index) => isoDate(parseIsoDate(value, `dates[${index}]`))));
}

function simulateHistoricalYear(
  sourceYear: number,
  startMonth: number,
  startDay: number,
  targetWorkDays: number,
  observationMap: Map<string, WeatherObservation>,
  input: WeatherCalculationInput,
  holidayKeys: Set<string>,
  otherKeys: Set<string>,
): WeatherYearScenario {
  const start = dateInYear(startMonth, startDay, sourceYear);
  let date = start;
  let workDays = 0;
  let weekendDays = 0;
  let holidayDays = 0;
  let otherNonWorkDays = 0;
  let weatherNonWorkDays = 0;
  let observedCandidateDays = 0;
  let candidateDays = 0;
  const weatherDates: string[] = [];
  const weatherReasonCounts: Record<string, number> = {};
  let calendarDays = 0;
  while (workDays < targetWorkDays) {
    calendarDays += 1;
    assertValid(calendarDays <= 3_660, "fieldWorkDays", "schedule_too_long", "일정 시뮬레이션이 10년을 초과합니다.");
    const key = isoDate(date);
    const weekday = date.getUTCDay();
    if (!input.policy.workingWeekdays.includes(weekday)) {
      weekendDays += 1;
    } else if (holidayKeys.has(key)) {
      holidayDays += 1;
    } else if (otherKeys.has(key)) {
      otherNonWorkDays += 1;
    } else {
      candidateDays += 1;
      const observation = observationMap.get(key);
      if (observation) observedCandidateDays += 1;
      const reasons = weatherReasons(observation, input);
      if (reasons.length > 0) {
        weatherNonWorkDays += 1;
        weatherDates.push(key);
        reasons.forEach((reason) => {
          weatherReasonCounts[reason] = (weatherReasonCounts[reason] ?? 0) + 1;
        });
      } else {
        workDays += 1;
      }
    }
    if (workDays < targetWorkDays) date = addUtcDays(date, 1);
  }
  return {
    sourceYear,
    calendarDays,
    workDays,
    weekendDays,
    holidayDays,
    weatherNonWorkDays,
    otherNonWorkDays,
    weatherDates,
    weatherReasonCounts,
    observationCoverageRatio: candidateDays === 0 ? 0 : observedCandidateDays / candidateDays,
  };
}

function manualScenario(input: WeatherCalculationInput, targetWorkDays: number): WeatherYearScenario {
  const rate = input.manualWeatherNonWorkRate ?? 0;
  ratio(rate, "manualWeatherNonWorkRate");
  assertValid(rate < 1, "manualWeatherNonWorkRate", "invalid_ratio", "수동 기상 비작업률은 1보다 작아야 합니다.");
  const requiredCandidateDays = Math.ceil(targetWorkDays / (1 - rate));
  const weatherNonWorkDays = requiredCandidateDays - targetWorkDays;
  const start = parseIsoDate(input.startDate, "startDate");
  const holidayKeys = exactDateKeys(input.holidayDates);
  const otherKeys = exactDateKeys(input.otherNonWorkDates);
  let date = start;
  let candidates = 0;
  let calendarDays = 0;
  let weekendDays = 0;
  let holidayDays = 0;
  let otherNonWorkDays = 0;
  while (candidates < requiredCandidateDays) {
    calendarDays += 1;
    const key = isoDate(date);
    if (!input.policy.workingWeekdays.includes(date.getUTCDay())) weekendDays += 1;
    else if (holidayKeys.has(key)) holidayDays += 1;
    else if (otherKeys.has(key)) otherNonWorkDays += 1;
    else candidates += 1;
    if (candidates < requiredCandidateDays) date = addUtcDays(date, 1);
  }
  return {
    sourceYear: start.getUTCFullYear(),
    calendarDays,
    workDays: targetWorkDays,
    weekendDays,
    holidayDays,
    weatherNonWorkDays,
    otherNonWorkDays,
    weatherDates: [],
    weatherReasonCounts: { manual_rate: weatherNonWorkDays },
    observationCoverageRatio: 0,
  };
}

export function calculateWeatherSchedule(input: WeatherCalculationInput): WeatherScheduleResult {
  parseIsoDate(input.startDate, "startDate");
  finitePositive(input.fieldWorkDays, "fieldWorkDays");
  assertValid(
    input.policy.workingWeekdays.length > 0 && input.policy.workingWeekdays.every((day) => Number.isInteger(day) && day >= 0 && day <= 6),
    "policy.workingWeekdays",
    "invalid_weekdays",
    "작업 요일은 0(일)~6(토) 중 하나 이상이어야 합니다.",
  );
  assertValid(new Set(input.policy.workingWeekdays).size === input.policy.workingWeekdays.length, "policy.workingWeekdays", "duplicate_weekdays", "작업 요일이 중복되었습니다.");
  assertValid(Number.isInteger(input.policy.historyYears) && input.policy.historyYears > 0, "policy.historyYears", "invalid_history_years", "기상 이력 연수는 1 이상의 정수여야 합니다.");
  const targetWorkDays = Math.ceil(input.fieldWorkDays);
  const start = parseIsoDate(input.startDate, "startDate");
  const asOf = parseIsoDate(input.asOfDate ?? input.startDate, "asOfDate");
  const completeBeforeYear = asOf.getUTCFullYear();
  const observationMap = new Map<string, WeatherObservation>();
  for (const [index, observation] of (input.observations ?? []).entries()) {
    parseIsoDate(observation.date, `observations[${index}].date`);
    assertValid(!observationMap.has(observation.date), `observations[${index}].date`, "duplicate_observation", "같은 날짜의 기상 관측값이 중복되었습니다.");
    observationMap.set(observation.date, observation);
  }
  const observedYears = [...new Set([...observationMap.keys()]
    .map((date) => Number(date.slice(0, 4)))
    .filter((year) => year < completeBeforeYear))]
    .sort((a, b) => b - a);
  const holidayKeys = exactDateKeys(input.holidayDates);
  const otherKeys = exactDateKeys(input.otherNonWorkDates);
  const reviewedScenarios = observedYears.map((year) => simulateHistoricalYear(
    year,
    start.getUTCMonth(),
    start.getUTCDate(),
    targetWorkDays,
    observationMap,
    input,
    holidayKeys,
    otherKeys,
  ));
  const completeScenarios = reviewedScenarios
    .filter(({ observationCoverageRatio }) => observationCoverageRatio >= .999999)
    .slice(0, input.policy.historyYears)
    .sort((a, b) => a.sourceYear - b.sourceYear);
  const hasCompleteHistory = completeScenarios.length === input.policy.historyYears;
  const mode: WeatherScheduleResult["mode"] = hasCompleteHistory ? "historical" : "manual_rate";
  const scenarios = hasCompleteHistory
    ? completeScenarios
    : [manualScenario(input, targetWorkDays)];
  const medianCalendarDays = percentileNearestRank(scenarios.map(({ calendarDays }) => calendarDays), .5);
  const p80CalendarDays = percentileNearestRank(scenarios.map(({ calendarDays }) => calendarDays), .8);
  const medianWeatherNonWorkDays = percentileNearestRank(scenarios.map(({ weatherNonWorkDays }) => weatherNonWorkDays), .5);
  const p80WeatherNonWorkDays = percentileNearestRank(scenarios.map(({ weatherNonWorkDays }) => weatherNonWorkDays), .8);
  const standbyRate = input.standbyCostKrwPerWeatherDay ?? 0;
  finitePositive(standbyRate, "standbyCostKrwPerWeatherDay", true);
  const warnings: string[] = [];
  if (!input.policy.confirmedByUser) warnings.push("기상정책은 발굴조사 법정 가산율이 아닌 토공사 참고 템플릿이며 적용 전 확인이 필요합니다.");
  if (mode === "manual_rate") warnings.push("필요한 완전연도 기상관측값이 부족해 사용자가 수동 입력한 비작업률로 계산했습니다.");
  if (!hasCompleteHistory) {
    warnings.push(`요청한 ${input.policy.historyYears}개년 중 ${completeScenarios.length}개 완전연도만 확인되어 과거기상 통계를 확정하지 않았습니다.`);
  }
  const fieldChecks: Array<[keyof WeatherObservation, number | undefined, string]> = [
    ["precipitationMm", input.policy.precipitationThresholdMm, "강수량"],
    ["apparentTemperatureMaxC", input.policy.apparentTemperatureThresholdC, "체감온도"],
    ["minimumTemperatureC", input.policy.minimumTemperatureThresholdC, "최저기온"],
    ["newSnowCm", input.policy.newSnowThresholdCm, "신적설"],
    ["maxInstantWindMps", input.policy.maxInstantWindThresholdMps, "최대순간풍속"],
  ];
  fieldChecks.forEach(([key, threshold, label]) => {
    if (threshold !== undefined && (input.observations ?? []).every((observation) => observation[key] === undefined)) {
      warnings.push(`${label} 관측항목이 없어 해당 기준은 제외되었습니다.`);
    }
  });
  return {
    mode,
    scenarios,
    medianCalendarDays,
    p80CalendarDays,
    medianWeatherNonWorkDays,
    p80WeatherNonWorkDays,
    medianFinishDate: isoDate(addUtcDays(start, medianCalendarDays - 1)),
    p80FinishDate: isoDate(addUtcDays(start, p80CalendarDays - 1)),
    standbyCostKrw: {
      median: Math.round(medianWeatherNonWorkDays * standbyRate),
      p80: Math.round(p80WeatherNonWorkDays * standbyRate),
    },
    warnings,
    policySource: input.policy.source,
  };
}
