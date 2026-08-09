import {
  INVESTIGATION_STAGES,
  OFFICIAL_RATE_SOURCE_2026,
  PRECISION_STANDARD_COEFFICIENTS_2026,
  RATE_SET_2026,
  REPORT_WORK_MULTIPLIERS_2026,
  TRIAL_STANDARD_COEFFICIENTS_2026,
} from "./rates-2026.ts";
import type { StandardCoefficientRow } from "./rates-2026.ts";
import type {
  CostRange,
  InvestigationConditions,
  InvestigationEstimateInput,
  InvestigationEstimateResult,
  InvestigationStage,
  PrecisionSiteType,
  RateSet,
  RolePersonDays,
  WorkforceRole,
} from "./types.ts";
import { assertValid, finitePositive, ratio, roundTo } from "./validation.ts";

const WORKFORCE_ROLES: readonly WorkforceRole[] = [
  "director",
  "supervisor",
  "researcher",
  "assistantResearcher",
  "assistant",
  "laborer",
];

type FactorTuple = [WorkforceRole, InvestigationStage, number];
type FactorMatrix = Record<WorkforceRole, Record<InvestigationStage, number>>;

function createFactorMatrix(): FactorMatrix {
  return Object.fromEntries(WORKFORCE_ROLES.map((role) => [
    role,
    Object.fromEntries(INVESTIGATION_STAGES.map((stage) => [stage, 1])),
  ])) as FactorMatrix;
}

function applyFactors(matrix: FactorMatrix, tuples: readonly FactorTuple[]): void {
  tuples.forEach(([role, stage, factor]) => {
    matrix[role][stage] *= factor;
  });
}

function choice<T extends string>(value: T, options: Record<T, readonly FactorTuple[]>): readonly FactorTuple[] {
  return options[value];
}

function trialFactors(conditions: InvestigationConditions): FactorMatrix {
  const factors = createFactorMatrix();
  applyFactors(factors, choice(conditions.terrain, {
    mountain: [
      ["director", "recording", 1.1], ["director", "closeout", .9],
      ["supervisor", "preparation", .9], ["supervisor", "featureExposure", 1], ["supervisor", "closeout", 1],
      ["researcher", "featureExposure", 1.1],
    ],
    flat: [
      ["director", "recording", .8], ["director", "closeout", .7],
      ["supervisor", "preparation", .8], ["supervisor", "featureExposure", .8], ["supervisor", "closeout", .7],
      ["researcher", "featureExposure", .7],
    ],
  }));
  applyFactors(factors, choice(conditions.surveyConditions, {
    poor: [["assistant", "recording", 1.1], ["assistant", "closeout", 1]],
    good: [["assistant", "recording", 1], ["assistant", "closeout", .9]],
  }));
  return factors;
}

const PRODUCTION_SITE_FACTORS: readonly FactorTuple[] = [
  ["director", "preparation", 1.5],
  ["researcher", "featureExcavation", .7],
  ["assistantResearcher", "closeout", .8],
];

function pairedFactors(high: readonly FactorTuple[], low: readonly FactorTuple[], variant: "high" | "low"): readonly FactorTuple[] {
  return variant === "high" ? high : low;
}

function siteTypeFactors(siteType: PrecisionSiteType, variant: "high" | "low"): readonly FactorTuple[] {
  switch (siteType) {
    case "living":
      return [["director", "preparation", .8], ["assistantResearcher", "closeout", .9]];
    case "production":
    case "cultivation":
    case "other":
      return PRODUCTION_SITE_FACTORS;
    case "architecture":
      return [["director", "closeout", 4.1], ["researcher", "topsoilRemoval", 3.3]];
    case "fortress":
      return [
        ["director", "featureExposure", 7.2], ["director", "featureExcavation", 3.2],
        ["supervisor", "preparation", 7.9], ["supervisor", "featureExposure", 3.6], ["supervisor", "recording", 2.4],
        ["researcher", "preparation", 7.6], ["researcher", "topsoilRemoval", 4.3], ["researcher", "featureExposure", 6.6], ["researcher", "closeout", 12.7],
        ["assistantResearcher", "preparation", 4.7], ["assistantResearcher", "topsoilRemoval", 2.8], ["assistantResearcher", "featureExposure", 3.8], ["assistantResearcher", "closeout", 6.4],
        ["assistant", "recording", 2.2], ["assistant", "closeout", 2],
      ];
    case "paleolithic":
      return [
        ["researcher", "topsoilRemoval", 2], ["researcher", "featureExcavation", 2.4],
        ["assistantResearcher", "topsoilRemoval", 3.2], ["assistantResearcher", "featureExcavation", 3.4],
        ["laborer", "preparation", .2], ["laborer", "closeout", 4.2],
      ];
    case "tomb_stone":
      return pairedFactors(
        [
          ["supervisor", "topsoilRemoval", 1.2], ["supervisor", "featureExcavation", 1.6], ["supervisor", "closeout", 2.4],
          ["researcher", "featureExposure", 2.6], ["researcher", "featureExcavation", 4.6], ["researcher", "recording", 3],
          ["assistantResearcher", "topsoilRemoval", 2.4], ["assistantResearcher", "featureExcavation", 3.8], ["assistantResearcher", "recording", 4.6],
          ["assistant", "topsoilRemoval", 3.4], ["assistant", "featureExcavation", 3.6], ["assistant", "recording", 5.4],
          ["laborer", "recording", 1.8], ["laborer", "closeout", 2.6],
        ],
        [
          ["supervisor", "topsoilRemoval", .9], ["supervisor", "featureExcavation", 1.2], ["supervisor", "closeout", 1.8],
          ["researcher", "featureExposure", 2], ["researcher", "featureExcavation", 3.5], ["researcher", "recording", 2.3],
          ["assistantResearcher", "topsoilRemoval", 1.8], ["assistantResearcher", "featureExcavation", 2.9], ["assistantResearcher", "recording", 3.5],
          ["assistant", "topsoilRemoval", 2.6], ["assistant", "featureExcavation", 2.7], ["assistant", "recording", 4.1],
          ["laborer", "recording", 1.4], ["laborer", "closeout", 2],
        ],
        variant,
      );
    case "tomb_pit":
      return pairedFactors(
        [
          ["supervisor", "topsoilRemoval", .6], ["supervisor", "featureExcavation", .8], ["supervisor", "closeout", 1.2],
          ["researcher", "featureExposure", 1.3], ["researcher", "featureExcavation", 2.3], ["researcher", "recording", 1.5],
          ["assistantResearcher", "topsoilRemoval", 1.2], ["assistantResearcher", "featureExcavation", 1.9], ["assistantResearcher", "recording", 2.3],
          ["assistant", "topsoilRemoval", 1.7], ["assistant", "featureExcavation", 1.8], ["assistant", "recording", 2.7],
          ["laborer", "recording", .9], ["laborer", "closeout", 1.3],
        ],
        [
          ["supervisor", "topsoilRemoval", .4], ["supervisor", "featureExcavation", .6], ["supervisor", "closeout", .9],
          ["researcher", "featureExposure", 1], ["researcher", "featureExcavation", 1.9], ["researcher", "recording", 1.2],
          ["assistantResearcher", "topsoilRemoval", .9], ["assistantResearcher", "featureExcavation", 1.6], ["assistantResearcher", "recording", 1.9],
          ["assistant", "topsoilRemoval", 1.4], ["assistant", "featureExcavation", 1.5], ["assistant", "recording", 2.3],
          ["laborer", "recording", .7], ["laborer", "closeout", 1],
        ],
        variant,
      );
  }
}

function precisionFactors(conditions: InvestigationConditions): FactorMatrix {
  const factors = createFactorMatrix();
  applyFactors(factors, choice(conditions.terrain, {
    mountain: [
      ["researcher", "topsoilRemoval", 1], ["researcher", "featureExcavation", 1],
      ["assistantResearcher", "featureExposure", 1.1], ["assistantResearcher", "featureExcavation", 1.1], ["assistantResearcher", "closeout", 1.1],
      ["assistant", "topsoilRemoval", 1.5],
    ],
    flat: [
      ["researcher", "topsoilRemoval", .7], ["researcher", "featureExcavation", .8],
      ["assistantResearcher", "featureExposure", .9], ["assistantResearcher", "featureExcavation", .9], ["assistantResearcher", "closeout", .9],
      ["assistant", "topsoilRemoval", .5],
    ],
  }));
  applyFactors(factors, choice(conditions.soilDifficulty, {
    difficult: [["director", "recording", 1.2], ["laborer", "featureExposure", 1.5], ["laborer", "featureExcavation", 1.5]],
    easy: [["director", "recording", .9], ["laborer", "featureExposure", .7], ["laborer", "featureExcavation", .7]],
  }));
  applyFactors(factors, choice(conditions.surveyConditions, {
    poor: [
      ["director", "preparation", 1.3], ["researcher", "featureExposure", 1.4], ["researcher", "closeout", 1.5],
      ["laborer", "topsoilRemoval", 1.2], ["laborer", "recording", 1.2], ["laborer", "closeout", 1.2],
    ],
    good: [
      ["director", "preparation", 1.1], ["researcher", "featureExposure", 1], ["researcher", "closeout", 1],
      ["laborer", "topsoilRemoval", .8], ["laborer", "recording", .8], ["laborer", "closeout", .8],
    ],
  }));
  applyFactors(factors, choice(conditions.findsLevel, {
    high: [
      ["director", "featureExcavation", 1.5], ["director", "recording", 1.5],
      ["researcher", "featureExposure", 1.4], ["researcher", "recording", 1.1],
      ["assistantResearcher", "featureExcavation", 1.1],
      ["assistant", "preparation", 1.5], ["assistant", "featureExposure", 1.2], ["assistant", "recording", 1.2],
      ["laborer", "featureExposure", 1.5], ["laborer", "featureExcavation", 1.9], ["laborer", "recording", 2],
    ],
    medium: [
      ["director", "featureExcavation", 1.2], ["director", "recording", 1.1],
      ["researcher", "featureExposure", 1.1], ["researcher", "recording", 1],
      ["assistantResearcher", "featureExcavation", 1],
      ["assistant", "preparation", 1.1], ["assistant", "featureExposure", 1], ["assistant", "recording", 1],
      ["laborer", "featureExposure", 1.1], ["laborer", "featureExcavation", 1.3], ["laborer", "recording", 1.2],
    ],
    low: [
      ["director", "featureExcavation", .9], ["director", "recording", .9],
      ["researcher", "featureExposure", .8], ["researcher", "recording", .9],
      ["assistantResearcher", "featureExcavation", .9],
      ["assistant", "preparation", .4], ["assistant", "featureExposure", .8], ["assistant", "recording", .8],
      ["laborer", "featureExposure", .7], ["laborer", "featureExcavation", .7], ["laborer", "recording", .4],
    ],
  }));
  applyFactors(factors, choice(conditions.featureDensity, {
    high: [
      ["director", "featureExcavation", 1.5], ["director", "recording", 1.6], ["researcher", "featureExcavation", 1.2],
      ["assistantResearcher", "featureExposure", 1.1], ["assistantResearcher", "featureExcavation", 1.4], ["assistantResearcher", "recording", 1.2],
      ["laborer", "preparation", 1.8], ["laborer", "featureExposure", 1.6], ["laborer", "featureExcavation", 1.6], ["laborer", "recording", 1.9],
    ],
    medium: [
      ["director", "featureExcavation", 1], ["director", "recording", 1.1], ["researcher", "featureExcavation", 1],
      ["assistantResearcher", "featureExposure", .9], ["assistantResearcher", "featureExcavation", 1], ["assistantResearcher", "recording", 1],
      ["laborer", "preparation", 1.3], ["laborer", "featureExposure", 1.2], ["laborer", "featureExcavation", 1.2], ["laborer", "recording", 1.4],
    ],
    low: [
      ["director", "featureExcavation", .9], ["director", "recording", .9], ["researcher", "featureExcavation", .8],
      ["assistantResearcher", "featureExposure", .5], ["assistantResearcher", "featureExcavation", .9], ["assistantResearcher", "recording", .8],
      ["laborer", "preparation", .9], ["laborer", "featureExposure", .8], ["laborer", "featureExcavation", .8], ["laborer", "recording", .9],
    ],
  }));
  applyFactors(factors, choice(conditions.identificationDifficulty, {
    difficult: [
      ["assistantResearcher", "featureExposure", 1.1], ["assistant", "preparation", 1.3],
      ["laborer", "featureExposure", 1.1], ["laborer", "featureExcavation", 1.2],
    ],
    easy: [
      ["assistantResearcher", "featureExposure", .9], ["assistant", "preparation", .8],
      ["laborer", "featureExposure", .9], ["laborer", "featureExcavation", .8],
    ],
  }));
  applyFactors(factors, choice(conditions.featureComplexity, {
    difficult: [["supervisor", "preparation", 1.3], ["supervisor", "topsoilRemoval", 1.2], ["laborer", "recording", 1.1]],
    easy: [["supervisor", "preparation", 1], ["supervisor", "topsoilRemoval", 1], ["laborer", "recording", .8]],
  }));
  if (conditions.layers === 2) {
    applyFactors(factors, [
      ["director", "recording", 1.4],
      ["supervisor", "topsoilRemoval", 2], ["supervisor", "featureExcavation", 2.1],
      ["researcher", "featureExposure", 1.8], ["researcher", "featureExcavation", 1.7],
      ["assistantResearcher", "featureExposure", 1.8], ["assistantResearcher", "featureExcavation", 1.8],
      ["assistant", "featureExcavation", 1.6], ["laborer", "topsoilRemoval", 1.5],
    ]);
  } else if (conditions.layers === 3) {
    applyFactors(factors, [
      ["director", "featureExcavation", 1.3], ["director", "recording", 1.4],
      ["supervisor", "topsoilRemoval", 2], ["supervisor", "featureExcavation", 2.1], ["supervisor", "recording", 1.4],
      ["researcher", "featureExposure", 2.3], ["researcher", "featureExcavation", 2.2], ["researcher", "recording", 1.6],
      ["assistantResearcher", "featureExposure", 2.5], ["assistantResearcher", "featureExcavation", 1.8],
      ["assistant", "featureExposure", 1.6], ["assistant", "featureExcavation", 1.6],
      ["laborer", "topsoilRemoval", 1.5], ["laborer", "featureExposure", 1.7], ["laborer", "recording", 1.7],
    ]);
  }
  applyFactors(factors, siteTypeFactors(conditions.siteType, conditions.siteFactorVariant));
  return factors;
}

function interpolatedStagePersonDays(rows: readonly StandardCoefficientRow[], areaM2: number, stageIndex: number): number {
  const first = rows[0] as StandardCoefficientRow;
  const last = rows[rows.length - 1] as StandardCoefficientRow;
  if (areaM2 < first.areaM2) return first.coefficients[stageIndex] * areaM2;
  if (areaM2 > last.areaM2) return last.coefficients[stageIndex] * areaM2;
  const upperIndex = rows.findIndex((row) => row.areaM2 >= areaM2);
  const upper = rows[Math.max(0, upperIndex)] as StandardCoefficientRow;
  if (upper.areaM2 === areaM2 || upperIndex === 0) return upper.coefficients[stageIndex] * upper.areaM2;
  const lower = rows[upperIndex - 1] as StandardCoefficientRow;
  const lowerDays = lower.coefficients[stageIndex] * lower.areaM2;
  const upperDays = upper.coefficients[stageIndex] * upper.areaM2;
  return lowerDays + (upperDays - lowerDays) * (areaM2 - lower.areaM2) / (upper.areaM2 - lower.areaM2);
}

function won(value: number): number {
  // The official calculator truncates each separately displayed person-day × rate row to whole won.
  return Math.floor(value + 1e-7);
}

function roleDailyRate(rateSet: RateSet, role: WorkforceRole): number {
  return role === "laborer" ? rateSet.laborerDailyRateKrw : rateSet.investigatorDailyRatesKrw[role];
}

function makeRange(min: number, selected: number, max: number): CostRange {
  return { min: Math.round(min), selected: Math.round(selected), max: Math.round(max) };
}

function selectedRatio(value: number | undefined, min: number, max: number, path: string): number {
  const selected = value ?? (min + max) / 2;
  assertValid(selected >= min && selected <= max, path, "ratio_out_of_range", `${path} 값은 공식 범위 ${min}~${max} 안이어야 합니다.`);
  return selected;
}

export function calculateInvestigationEstimate(input: InvestigationEstimateInput): InvestigationEstimateResult {
  finitePositive(input.areaM2, "areaM2");
  const rateSet = input.rateSet ?? RATE_SET_2026;
  const tables = input.investigationType === "trial" ? TRIAL_STANDARD_COEFFICIENTS_2026 : PRECISION_STANDARD_COEFFICIENTS_2026;
  const factors = input.investigationType === "trial" ? trialFactors(input.conditions) : precisionFactors(input.conditions);
  const personDays: RolePersonDays[] = WORKFORCE_ROLES.map((role) => {
    const rawField = INVESTIGATION_STAGES.reduce((total, stage, stageIndex) => (
      total + interpolatedStagePersonDays(tables[role], input.areaM2, stageIndex) * factors[role][stage]
    ), 0);
    const fieldDays = roundTo(rawField, 1);
    const reportDays = roundTo(rawField * REPORT_WORK_MULTIPLIERS_2026[input.investigationType][role], 1);
    const fieldWeeklyHolidayDays = Math.floor(fieldDays / 5);
    const reportWeeklyHolidayDays = Math.floor(reportDays / 5);
    const dailyRateKrw = roleDailyRate(rateSet, role);
    const fieldCostKrw = won(fieldDays * dailyRateKrw) + won(fieldWeeklyHolidayDays * dailyRateKrw);
    const reportCostKrw = won(reportDays * dailyRateKrw) + won(reportWeeklyHolidayDays * dailyRateKrw);
    return {
      role,
      fieldDays,
      fieldWeeklyHolidayDays,
      reportDays,
      reportWeeklyHolidayDays,
      dailyRateKrw,
      fieldCostKrw,
      reportCostKrw,
      totalCostKrw: fieldCostKrw + reportCostKrw,
    };
  });
  const directLaborKrw = personDays
    .filter(({ role }) => role !== "laborer")
    .reduce((total, row) => total + row.totalCostKrw, 0);
  const laborerReferenceCostKrw = personDays.find(({ role }) => role === "laborer")?.totalCostKrw ?? 0;

  const expenseRange = rateSet.directExpenseRatios[input.investigationType];
  let directExpenseKrw: CostRange;
  if (input.directExpenseMode === "itemized") {
    finitePositive(input.itemizedDirectExpenseKrw ?? NaN, "itemizedDirectExpenseKrw", true);
    const selected = input.itemizedDirectExpenseKrw as number;
    directExpenseKrw = makeRange(selected, selected, selected);
  } else {
    const selectedExpenseRatio = selectedRatio(input.selectedDirectExpenseRatio, expenseRange.min, expenseRange.max, "selectedDirectExpenseRatio");
    directExpenseKrw = makeRange(
      directLaborKrw * expenseRange.min,
      directLaborKrw * selectedExpenseRatio,
      directLaborKrw * expenseRange.max,
    );
  }
  const overheadRatio = selectedRatio(
    input.selectedOverheadRatio,
    rateSet.overheadRatio.min,
    rateSet.overheadRatio.max,
    "selectedOverheadRatio",
  );
  const overheadKrw = makeRange(
    directLaborKrw * rateSet.overheadRatio.min,
    directLaborKrw * overheadRatio,
    directLaborKrw * rateSet.overheadRatio.max,
  );
  const academicRatio = selectedRatio(
    input.selectedAcademicFeeRatio,
    rateSet.academicFeeRatio.min,
    rateSet.academicFeeRatio.max,
    "selectedAcademicFeeRatio",
  );
  const academicFeeKrw = makeRange(
    (directLaborKrw + overheadKrw.min) * rateSet.academicFeeRatio.min,
    (directLaborKrw + overheadKrw.selected) * academicRatio,
    (directLaborKrw + overheadKrw.max) * rateSet.academicFeeRatio.max,
  );
  const reinstatementCostKrw = input.reinstatementCostKrw ?? 0;
  const safetyCostKrw = input.safetyCostKrw ?? 0;
  finitePositive(reinstatementCostKrw, "reinstatementCostKrw", true);
  finitePositive(safetyCostKrw, "safetyCostKrw", true);
  const extras = reinstatementCostKrw + safetyCostKrw;
  const subtotalExcludingVatKrw = makeRange(
    directLaborKrw + directExpenseKrw.min + overheadKrw.min + academicFeeKrw.min + extras,
    directLaborKrw + directExpenseKrw.selected + overheadKrw.selected + academicFeeKrw.selected + extras,
    directLaborKrw + directExpenseKrw.max + overheadKrw.max + academicFeeKrw.max + extras,
  );
  const vatRate = input.vatRate ?? .1;
  ratio(vatRate, "vatRate");
  const vatKrw = makeRange(
    subtotalExcludingVatKrw.min * vatRate,
    subtotalExcludingVatKrw.selected * vatRate,
    subtotalExcludingVatKrw.max * vatRate,
  );
  const totalIncludingVatKrw = makeRange(
    subtotalExcludingVatKrw.min + vatKrw.min,
    subtotalExcludingVatKrw.selected + vatKrw.selected,
    subtotalExcludingVatKrw.max + vatKrw.max,
  );

  const roleDuration = (key: "fieldDays" | "reportDays"): number => Math.max(...personDays.map((row) => {
    const count = input.team.roleCounts[row.role];
    assertValid(Number.isInteger(count) && count >= 0, `team.roleCounts.${row.role}`, "invalid_team_count", "역할별 인원은 0 이상의 정수여야 합니다.");
    assertValid(row[key] === 0 || count > 0, `team.roleCounts.${row.role}`, "missing_required_role", `${row.role} 참여인일이 있으므로 배치인원이 1명 이상이어야 합니다.`);
    return count > 0 ? row[key] / count : 0;
  }));
  const standardFieldDays = roleDuration("fieldDays");
  const reportWorkDays = roleDuration("reportDays");
  const productivityFactor = input.productivityFactor ?? 1;
  finitePositive(productivityFactor, "productivityFactor");
  const personalizedFieldDays = standardFieldDays * productivityFactor;
  const earthworkDays = input.earthworkDays ?? 0;
  finitePositive(earthworkDays, "earthworkDays", true);
  const overlapRate = input.overlapConfirmed ? input.overlapRate ?? 0 : 0;
  ratio(overlapRate, "overlapRate");
  const combinedOnSiteDays = earthworkDays + personalizedFieldDays - Math.min(earthworkDays, personalizedFieldDays) * overlapRate;
  const warnings = [
    "공식 대가기준 결과는 현장 조건에 따라 계약 당사자가 조정할 수 있는 참고 산출값입니다.",
    "조사인력 기준단가에 포함된 보험료와 퇴직적립금을 재가산하지 않았습니다.",
  ];
  if (input.directExpenseMode === "ratio") {
    warnings.push("직접경비 비율에는 현장 인부·임차료 등이 포함될 수 있으므로 별도 장비비를 합산할 때 이중계상을 확인하세요.");
  }
  if (!input.overlapConfirmed && (input.overlapRate ?? 0) > 0) warnings.push("토공·조사 중첩은 확인되지 않아 기간 계산에 적용하지 않았습니다.");
  if (input.investigationType === "precision" && input.conditions.layers === 3) {
    warnings.push("4층 이상 중층 또는 기준 수량보다 현저히 많은 유물·유구는 고시상 실비 산출 협의 대상입니다.");
  }
  return {
    investigationType: input.investigationType,
    areaM2: input.areaM2,
    official: {
      directLaborKrw,
      laborerReferenceCostKrw,
      directExpenseKrw,
      overheadKrw,
      academicFeeKrw,
      subtotalExcludingVatKrw,
      vatKrw,
      totalIncludingVatKrw,
      reinstatementCostKrw,
      safetyCostKrw,
      rolePersonDays: personDays,
      formulas: [
        "현장 참여인일 = 면적별 보간 인일 × 단계별 보정계수 (역할 합계 소수 첫째 자리 반올림)",
        "정리·보고서 인일 = 현장 참여인일 × 별표 보고서 표준품셈 (소수 첫째 자리 반올림)",
        "주휴 인일 = floor(각 작업구분 참여인일 / 5)",
        "직접인건비 = 조사인력 역할별 (참여인일 + 주휴인일) × 2026 일급",
      ],
      warnings: [...warnings],
      source: rateSet.sources.find(({ id }) => id === OFFICIAL_RATE_SOURCE_2026.id) ?? rateSet.sources[0] ?? OFFICIAL_RATE_SOURCE_2026,
    },
    standardFieldDays,
    personalizedFieldDays,
    reportWorkDays,
    earthworkDays,
    combinedOnSiteDays,
    confidence: productivityFactor === 1 ? "high" : "medium",
    warnings,
  };
}
