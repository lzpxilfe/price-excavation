import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  RATE_SET_2026,
  calculateInvestigationEstimate,
  type CostRange,
  type InvestigationConditions,
  type InvestigationType,
  type RolePersonDays,
  type WorkforceRole,
} from "../packages/core/src/index.ts";

type Percentiles = { p20: number; p50: number; p80: number };

interface AreaBand {
  id: string;
  label: string;
  minExclusiveM2: number | null;
  maxInclusiveM2: number | null;
}

interface AggregateCell {
  investigationClass: InvestigationType;
  areaBandId: string;
  n: number;
  registeredDurationDays: Percentiles;
  elapsedCalendarDays: Percentiles;
  elapsedToRegisteredRatio: Percentiles;
  evidenceLevel: "descriptive_aggregate";
  qualityFlags: string[];
}

interface BenchmarkFixture {
  version: string;
  asOf: string;
  sourceSnapshot: {
    sourceId: string;
    title: string;
    landingPageUrl: string;
    snapshotDate: string;
    licenseEvidence: { label: string; url: string; checkedAt: string };
    checksum: { algorithm: string; value: string };
  };
  evidencePolicy: {
    levels: Record<string, string>;
    prohibitedInferences: string[];
    publication: { minimumCellSize: number; mode: string; suppressedFields: string[] };
  };
  cohort: {
    permitYearRange: { from: number; to: number };
    areaBands: AreaBand[];
    audit: { eligibleAggregateRows: number };
  };
  cells: AggregateCell[];
}

interface ScenarioDefinition {
  id: string;
  label: string;
  conditions: InvestigationConditions;
  assumptions: string[];
}

export interface OfficialScenarioResult {
  id: string;
  label: string;
  evidenceLevel: "conditional_inverse";
  assumptions: string[];
  rolePersonDays: RolePersonDays[];
  totalFieldPersonDays: number;
  reportWorkDaysWithOnePersonPerRole: number;
  totalIncludingVatKrw: CostRange;
  minimumConcurrentRoleCounts: Record<WorkforceRole, number> | null;
  resultingBottleneckDays: number | null;
}

export interface PublicBenchmarkReport {
  version: string;
  asOf: string;
  source: BenchmarkFixture["sourceSnapshot"];
  publicationPolicy: BenchmarkFixture["evidencePolicy"]["publication"];
  prohibitedInferences: string[];
  query: {
    investigationType: InvestigationType;
    areaM2: number;
    targetRegisteredDurationDays: number | null;
  } | null;
  cohortReference: (AggregateCell & { areaBand: AreaBand }) | null;
  officialScenarioGrid: OfficialScenarioResult[];
  interpretation: string[];
}

const fixtureUrl = new URL(
  "../data/public-benchmarks/permit-registry-2026-06-30.aggregate.json",
  import.meta.url,
);

const ONE_PERSON_PER_ROLE: Record<WorkforceRole, number> = {
  director: 1,
  supervisor: 1,
  researcher: 1,
  assistantResearcher: 1,
  assistant: 1,
  laborer: 1,
};

const LOW_CONDITIONS: InvestigationConditions = {
  terrain: "flat",
  surveyConditions: "good",
  siteType: "living",
  soilDifficulty: "easy",
  findsLevel: "low",
  featureDensity: "low",
  identificationDifficulty: "easy",
  featureComplexity: "easy",
  layers: 1,
  siteFactorVariant: "low",
};

function scenarioDefinitions(investigationType: InvestigationType): ScenarioDefinition[] {
  if (investigationType === "trial") {
    return [
      {
        id: "trial-flat-good",
        label: "평지·양호 조건",
        conditions: { ...LOW_CONDITIONS },
        assumptions: ["지형=평지", "조사조건=양호", "그 밖의 정밀발굴 전용 조건은 시굴식에 영향을 주지 않음"],
      },
      {
        id: "trial-mountain-poor",
        label: "산지·불량 조건",
        conditions: { ...LOW_CONDITIONS, terrain: "mountain", surveyConditions: "poor" },
        assumptions: ["지형=산지", "조사조건=불량", "그 밖의 정밀발굴 전용 조건은 시굴식에 영향을 주지 않음"],
      },
    ];
  }
  return [
    {
      id: "precision-low-grid",
      label: "저조건 격자",
      conditions: { ...LOW_CONDITIONS },
      assumptions: ["생활유적·평지·양호", "토질·유물량·유구밀도·식별·복잡도=낮음/쉬움", "단층"],
    },
    {
      id: "precision-middle-grid",
      label: "중간 민감도 격자",
      conditions: {
        ...LOW_CONDITIONS,
        findsLevel: "medium",
        featureDensity: "medium",
        featureComplexity: "difficult",
        layers: 2,
      },
      assumptions: ["생활유적·평지·양호", "유물량·유구밀도=중간", "유구복잡도=어려움", "2개 층"],
    },
    {
      id: "precision-high-grid",
      label: "상조건 격자",
      conditions: {
        terrain: "mountain",
        surveyConditions: "poor",
        siteType: "fortress",
        soilDifficulty: "difficult",
        findsLevel: "high",
        featureDensity: "high",
        identificationDifficulty: "difficult",
        featureComplexity: "difficult",
        layers: 3,
        siteFactorVariant: "high",
      },
      assumptions: ["관방유적·산지·불량", "토질·유물량·유구밀도·식별·복잡도=높음/어려움", "3개 층"],
    },
  ];
}

function contains(areaM2: number, band: AreaBand): boolean {
  return (band.minExclusiveM2 === null || areaM2 > band.minExclusiveM2) &&
    (band.maxInclusiveM2 === null || areaM2 <= band.maxInclusiveM2);
}

function minimumCountsForDays(rows: RolePersonDays[], targetDays: number): Record<WorkforceRole, number> {
  return Object.fromEntries(rows.map(({ role, fieldDays }) => [
    role,
    Math.max(1, Math.ceil(fieldDays / targetDays)),
  ])) as Record<WorkforceRole, number>;
}

function bottleneckDays(rows: RolePersonDays[], counts: Record<WorkforceRole, number>): number {
  return Math.max(...rows.map(({ role, fieldDays }) => fieldDays / counts[role]));
}

function officialScenarios(
  investigationType: InvestigationType,
  areaM2: number,
  targetDays: number | null,
): OfficialScenarioResult[] {
  return scenarioDefinitions(investigationType).map((definition) => {
    const estimate = calculateInvestigationEstimate({
      investigationType,
      areaM2,
      conditions: definition.conditions,
      team: { id: "anonymous-grid", name: "조건부 공식식", roleCounts: ONE_PERSON_PER_ROLE },
      rateSet: RATE_SET_2026,
      directExpenseMode: "ratio",
      vatRate: .1,
      earthworkDays: 0,
      overlapRate: 0,
      overlapConfirmed: false,
      productivityFactor: 1,
      reinstatementCostKrw: 0,
      safetyCostKrw: 0,
    });
    const minimumConcurrentRoleCounts = targetDays === null
      ? null
      : minimumCountsForDays(estimate.official.rolePersonDays, targetDays);
    return {
      id: definition.id,
      label: definition.label,
      evidenceLevel: "conditional_inverse",
      assumptions: [
        ...definition.assumptions,
        "2026 공식 대가기준과 중간 선택률 사용",
        ...(targetDays === null ? [] : ["입력한 대장 기재기간을 중단 없는 현장 가용일로 가정한 조건부 역산"]),
      ],
      rolePersonDays: estimate.official.rolePersonDays,
      totalFieldPersonDays: Number(estimate.official.rolePersonDays
        .reduce((total, row) => total + row.fieldDays, 0).toFixed(1)),
      reportWorkDaysWithOnePersonPerRole: estimate.reportWorkDays,
      totalIncludingVatKrw: estimate.official.totalIncludingVatKrw,
      minimumConcurrentRoleCounts,
      resultingBottleneckDays: minimumConcurrentRoleCounts === null
        ? null
        : Number(bottleneckDays(estimate.official.rolePersonDays, minimumConcurrentRoleCounts).toFixed(3)),
    };
  });
}

async function loadFixture(): Promise<BenchmarkFixture> {
  return JSON.parse(await readFile(fixtureUrl, "utf8")) as BenchmarkFixture;
}

export async function queryPublicBenchmark(input?: {
  investigationType: InvestigationType;
  areaM2: number;
  targetRegisteredDurationDays?: number;
}): Promise<PublicBenchmarkReport> {
  const fixture = await loadFixture();
  if (!input) {
    return {
      version: fixture.version,
      asOf: fixture.asOf,
      source: fixture.sourceSnapshot,
      publicationPolicy: fixture.evidencePolicy.publication,
      prohibitedInferences: fixture.evidencePolicy.prohibitedInferences,
      query: null,
      cohortReference: null,
      officialScenarioGrid: [],
      interpretation: [
        `${fixture.cohort.audit.eligibleAggregateRows}개 공개 행을 식별정보 없이 ${fixture.cells.length}개 코호트로 집계했습니다.`,
        "각 분위수는 대장 기재값의 설명통계이며 실제 작업일 예측이나 모델 정확도 검증값이 아닙니다.",
      ],
    };
  }
  if (!Number.isFinite(input.areaM2) || input.areaM2 <= 0) throw new Error("면적은 0보다 큰 유한수여야 합니다.");
  const targetDays = input.targetRegisteredDurationDays ?? null;
  if (targetDays !== null && (!Number.isFinite(targetDays) || targetDays <= 0)) {
    throw new Error("대장 기재기간은 0보다 큰 유한수여야 합니다.");
  }
  const band = fixture.cohort.areaBands.find((candidate) => contains(input.areaM2, candidate));
  if (!band) throw new Error("면적 구간을 찾을 수 없습니다.");
  const cell = fixture.cells.find(({ investigationClass, areaBandId }) => (
    investigationClass === input.investigationType && areaBandId === band.id
  ));
  if (!cell) throw new Error("최소 셀 크기를 충족하는 공개 코호트가 없습니다.");
  return {
    version: fixture.version,
    asOf: fixture.asOf,
    source: fixture.sourceSnapshot,
    publicationPolicy: fixture.evidencePolicy.publication,
    prohibitedInferences: fixture.evidencePolicy.prohibitedInferences,
    query: {
      investigationType: input.investigationType,
      areaM2: input.areaM2,
      targetRegisteredDurationDays: targetDays,
    },
    cohortReference: { ...cell, areaBand: band },
    officialScenarioGrid: officialScenarios(input.investigationType, input.areaM2, targetDays),
    interpretation: [
      "코호트 수치는 동일 조사유형·면적구간의 대장 기재값을 요약한 설명통계입니다.",
      "공식 시나리오는 공개 행에서 알 수 없는 현장조건을 명시적으로 바꾼 민감도 계산입니다.",
      ...(targetDays === null ? [] : [
        "최소 동시배치는 입력 기간을 중단 없는 현장 가용일로 가정한 수학적 하한이며 실제 투입인원이 아닙니다.",
      ]),
    ],
  };
}

function parseCli(argumentsList: string[]): {
  input?: { investigationType: InvestigationType; areaM2: number; targetRegisteredDurationDays?: number };
  json: boolean;
} {
  const valueFlags = new Set(["--type", "--area", "--target-days"]);
  const values = new Map<string, string>();
  let json = false;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--json") {
      if (json) throw new Error("중복 인자입니다: --json");
      json = true;
      continue;
    }
    if (!valueFlags.has(argument)) throw new Error(`지원하지 않는 인자입니다: ${argument}`);
    if (values.has(argument)) throw new Error(`중복 인자입니다: ${argument}`);
    const value = argumentsList[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${argument} 값을 입력해야 합니다.`);
    values.set(argument, value);
    index += 1;
  }

  const type = values.get("--type");
  const area = values.get("--area");
  const targetDays = values.get("--target-days");
  if ((type === undefined) !== (area === undefined)) throw new Error("--type과 --area는 함께 입력해야 합니다.");
  if (targetDays !== undefined && type === undefined) {
    throw new Error("--target-days는 --type 및 --area와 함께 입력해야 합니다.");
  }
  if (type !== undefined && type !== "trial" && type !== "precision") throw new Error("--type은 trial 또는 precision이어야 합니다.");
  return {
    json,
    input: type === undefined || area === undefined ? undefined : {
      investigationType: type,
      areaM2: Number(area),
      ...(targetDays === undefined ? {} : { targetRegisteredDurationDays: Number(targetDays) }),
    },
  };
}

function formatDistribution(value: Percentiles): string {
  return `${value.p20} / ${value.p50} / ${value.p80}`;
}

function printHumanReadable(report: PublicBenchmarkReport, fixture: BenchmarkFixture): void {
  console.log(`발굴허가대장 익명 집계 ${report.version} · 기준 ${report.source.snapshotDate}`);
  console.log(`${report.source.licenseEvidence.label} · 원문 행은 저장소에 재배포하지 않음`);
  if (!report.query) {
    console.log(`\n조사유형  면적구간                    n     대장 기재기간 p20/p50/p80    착수~완료 경과일 p20/p50/p80`);
    for (const cell of fixture.cells) {
      const band = fixture.cohort.areaBands.find(({ id }) => id === cell.areaBandId);
      console.log(
        `${cell.investigationClass.padEnd(10)} ${(band?.label ?? cell.areaBandId).padEnd(25)} ${String(cell.n).padStart(5)}   ${formatDistribution(cell.registeredDurationDays).padEnd(26)} ${formatDistribution(cell.elapsedCalendarDays)}`,
      );
    }
    console.log("\n주의: 두 기간은 공개 대장의 서로 다른 기재값이며 순수 작업일·중단일로 해석하지 않습니다.");
    return;
  }
  const cell = report.cohortReference;
  console.log(`\n질의: ${report.query.investigationType} · ${report.query.areaM2.toLocaleString("ko-KR")}㎡`);
  console.log(`익명 코호트: ${cell?.areaBand.label}, n=${cell?.n}`);
  console.log(`대장 기재기간 p20/p50/p80: ${formatDistribution(cell!.registeredDurationDays)}일`);
  console.log(`착수~완료 경과일 p20/p50/p80: ${formatDistribution(cell!.elapsedCalendarDays)}일`);
  if (report.query.targetRegisteredDurationDays !== null) {
    console.log(`\n조건부 역산 목표: ${report.query.targetRegisteredDurationDays}일`);
    for (const scenario of report.officialScenarioGrid) {
      const counts = Object.entries(scenario.minimumConcurrentRoleCounts ?? {})
        .map(([role, count]) => `${role} ${count}`)
        .join(" · ");
      console.log(`• ${scenario.label}: 최소 동시배치 ${counts} · 계산 병목 ${scenario.resultingBottleneckDays}일`);
    }
    console.log("실제 투입 복원이 아니라 명시된 조건 아래의 수학적 하한입니다.");
  }
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) {
  try {
    const cli = parseCli(process.argv.slice(2));
    const report = await queryPublicBenchmark(cli.input);
    if (cli.json) console.log(JSON.stringify(report, null, 2));
    else printHumanReadable(report, await loadFixture());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
