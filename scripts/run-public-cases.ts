import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  RATE_SET_2026,
  calculateInvestigationEstimate,
  type CostRange,
  type InvestigationEstimateInput,
} from "../packages/core/src/index.ts";

interface PublicCaseDefinition {
  id: string;
  title: string;
  evidenceLevel: string;
  publicFacts: Record<string, unknown>;
  engineInput: Omit<InvestigationEstimateInput, "rateSet">;
  expectedSnapshot: {
    standardFieldDays: number;
    reportWorkDays: number;
    directLaborKrw: number;
    totalIncludingVatKrw: CostRange;
  };
  assumptions: string[];
  notComparable: string[];
}

interface PublicCaseFixture {
  version: string;
  asOf: string;
  cases: PublicCaseDefinition[];
}

export interface PublicCaseResult {
  id: string;
  title: string;
  evidenceLevel: string;
  publicFieldReferenceDays: number | null;
  publicBudgetVatIncludedKrw: number | null;
  standardFieldDays: number;
  reportWorkDays: number;
  directLaborKrw: number;
  totalIncludingVatKrw: CostRange;
  fieldDifferenceDays: number | null;
  selectedBudgetDifferenceKrw: number | null;
  selectedBudgetDifferencePercent: number | null;
  assumptions: string[];
  notComparable: string[];
}

const fixtureUrl = new URL("../data/public-cases/2026.1.json", import.meta.url);

export async function calculatePublicCases(): Promise<{
  version: string;
  asOf: string;
  results: PublicCaseResult[];
}> {
  const fixture = JSON.parse(await readFile(fixtureUrl, "utf8")) as PublicCaseFixture;
  const results = fixture.cases.map((definition) => {
    const estimate = calculateInvestigationEstimate({
      ...definition.engineInput,
      rateSet: RATE_SET_2026,
    });
    const publicFieldReferenceDays = typeof definition.publicFacts.plannedFieldDays === "number"
      ? definition.publicFacts.plannedFieldDays
      : typeof definition.publicFacts.registryDurationDays === "number"
        ? definition.publicFacts.registryDurationDays
        : null;
    const publicBudgetVatIncludedKrw = typeof definition.publicFacts.budgetVatIncludedKrw === "number"
      ? definition.publicFacts.budgetVatIncludedKrw
      : null;
    const selectedBudgetDifferenceKrw = publicBudgetVatIncludedKrw === null
      ? null
      : estimate.official.totalIncludingVatKrw.selected - publicBudgetVatIncludedKrw;

    return {
      id: definition.id,
      title: definition.title,
      evidenceLevel: definition.evidenceLevel,
      publicFieldReferenceDays,
      publicBudgetVatIncludedKrw,
      standardFieldDays: estimate.standardFieldDays,
      reportWorkDays: estimate.reportWorkDays,
      directLaborKrw: estimate.official.directLaborKrw,
      totalIncludingVatKrw: estimate.official.totalIncludingVatKrw,
      fieldDifferenceDays: publicFieldReferenceDays === null
        ? null
        : estimate.standardFieldDays - publicFieldReferenceDays,
      selectedBudgetDifferenceKrw,
      selectedBudgetDifferencePercent: selectedBudgetDifferenceKrw === null || publicBudgetVatIncludedKrw === null
        ? null
        : selectedBudgetDifferenceKrw / publicBudgetVatIncludedKrw * 100,
      assumptions: definition.assumptions,
      notComparable: definition.notComparable,
    };
  });
  return { version: fixture.version, asOf: fixture.asOf, results };
}

function formatWon(value: number): string {
  return `${new Intl.NumberFormat("ko-KR").format(value)}원`;
}

function printHumanReadable(report: Awaited<ReturnType<typeof calculatePublicCases>>): void {
  console.log(`공개자료 실증 ${report.version} · ${report.asOf}`);
  console.log("공개값은 정답 레이블이 아니라 계획·허가 기준선입니다. 모든 가정과 비교 제한은 fixture에 고정됩니다.\n");
  for (const result of report.results) {
    const publicDays = result.publicFieldReferenceDays === null ? "없음" : `${result.publicFieldReferenceDays}일`;
    const difference = result.fieldDifferenceDays === null ? "-" : `${result.fieldDifferenceDays >= 0 ? "+" : ""}${result.fieldDifferenceDays.toFixed(3)}일`;
    const budget = result.publicBudgetVatIncludedKrw === null ? "없음" : formatWon(result.publicBudgetVatIncludedKrw);
    const budgetDifference = result.selectedBudgetDifferencePercent === null
      ? "-"
      : `${result.selectedBudgetDifferencePercent >= 0 ? "+" : ""}${result.selectedBudgetDifferencePercent.toFixed(1)}%`;
    console.log(`• ${result.title}`);
    console.log(`  공개 현장기간 ${publicDays} · 엔진 ${result.standardFieldDays.toFixed(3)}일 · 차이 ${difference}`);
    console.log(`  공개 예산 ${budget} · 엔진 VAT 포함 선택 ${formatWon(result.totalIncludingVatKrw.selected)} · 차이 ${budgetDifference}`);
  }
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) {
  const report = await calculatePublicCases();
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else printHumanReadable(report);
}
