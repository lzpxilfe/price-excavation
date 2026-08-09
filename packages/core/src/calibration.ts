import type {
  ActualProject,
  CalibrationFactorResult,
  CalibrationInput,
  CalibrationSnapshot,
} from "./types.ts";
import { assertValid, daysBetween, finitePositive, parseIsoDate } from "./validation.ts";

function nearestRank(values: number[], percentile: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * percentile) - 1)] as number;
}

function weightedFactor(
  records: ActualProject[],
  ratios: number[],
  asOf: Date,
  priorWeight: number,
  halfLifeDays: number,
  minSamples: number,
  distributionMinSamples: number,
  excludedProjectIds: string[],
): CalibrationFactorResult {
  let logSum = 0;
  let effectiveWeight = 0;
  records.forEach((record, index) => {
    const completedAt = parseIsoDate(record.completedAt, `actualProjects.${record.id}.completedAt`);
    const ageDays = Math.max(0, daysBetween(asOf, completedAt));
    const qualityWeight = record.qualityWeight ?? 1;
    const recencyWeight = .5 ** (ageDays / halfLifeDays);
    const weight = qualityWeight * recencyWeight;
    logSum += weight * Math.log(ratios[index] as number);
    effectiveWeight += weight;
  });
  const applied = records.length >= minSamples;
  const factor = applied ? Math.exp(logSum / (priorWeight + effectiveWeight)) : 1;
  return {
    applied,
    factor,
    sampleCount: records.length,
    includedProjectIds: records.map(({ id }) => id),
    excludedProjectIds,
    effectiveWeight,
    ...(records.length >= distributionMinSamples
      ? {
          distribution: {
            p20: nearestRank(ratios, .2),
            median: nearestRank(ratios, .5),
            p80: nearestRank(ratios, .8),
          },
        }
      : {}),
  };
}

function validateRecord(record: ActualProject, asOf: Date): void {
  finitePositive(record.standardFieldDays, `actualProjects.${record.id}.standardFieldDays`);
  finitePositive(record.actualFieldDays, `actualProjects.${record.id}.actualFieldDays`);
  const completedAt = parseIsoDate(record.completedAt, `actualProjects.${record.id}.completedAt`);
  assertValid(completedAt <= asOf, `actualProjects.${record.id}.completedAt`, "future_completion", "완료일은 기준일 이후일 수 없습니다.");
  const quality = record.qualityWeight ?? 1;
  assertValid(quality >= 0 && quality <= 1, `actualProjects.${record.id}.qualityWeight`, "invalid_quality", "품질가중치는 0~1이어야 합니다.");
}

export function calculateCalibration(input: CalibrationInput): CalibrationSnapshot {
  const asOfText = input.asOfDate ?? new Date().toISOString().slice(0, 10);
  const asOf = parseIsoDate(asOfText, "asOfDate");
  const priorWeight = input.priorWeight ?? 3;
  const recencyHalfLifeDays = input.recencyHalfLifeDays ?? 730;
  const minSamples = input.minSamples ?? 3;
  const distributionMinSamples = input.distributionMinSamples ?? 5;
  finitePositive(priorWeight, "priorWeight", true);
  finitePositive(recencyHalfLifeDays, "recencyHalfLifeDays");
  assertValid(Number.isInteger(minSamples) && minSamples >= 1, "minSamples", "invalid_sample_limit", "최소 사례 수는 1 이상의 정수여야 합니다.");
  assertValid(Number.isInteger(distributionMinSamples) && distributionMinSamples >= minSamples, "distributionMinSamples", "invalid_distribution_limit", "분포 표시 최소 사례 수는 보정 최소 사례 수 이상이어야 합니다.");
  const candidates = input.actualProjects.filter((project) => (
    project.investigationType === input.investigationType && project.teamId === input.teamId
  ));
  const excludedProjectIds = candidates.filter(({ excluded, qualityWeight }) => excluded || qualityWeight === 0).map(({ id }) => id);
  const teamRecords = candidates.filter(({ excluded, qualityWeight }) => !excluded && qualityWeight !== 0);
  teamRecords.forEach((record) => validateRecord(record, asOf));
  const teamRatios = teamRecords.map((record) => record.actualFieldDays / record.standardFieldDays);
  const team = weightedFactor(
    teamRecords,
    teamRatios,
    asOf,
    priorWeight,
    recencyHalfLifeDays,
    minSamples,
    distributionMinSamples,
    excludedProjectIds,
  );
  let personal: CalibrationFactorResult | undefined;
  if (input.investigatorId) {
    const individualCandidates = candidates.filter(({ investigatorIds }) => investigatorIds?.includes(input.investigatorId as string));
    const personalExcluded = individualCandidates.filter(({ excluded, qualityWeight }) => excluded || qualityWeight === 0).map(({ id }) => id);
    const personalRecords = individualCandidates.filter(({ excluded, qualityWeight }) => !excluded && qualityWeight !== 0);
    personalRecords.forEach((record) => validateRecord(record, asOf));
    const teamBaseline = team.applied ? team.factor : 1;
    const residuals = personalRecords.map((record) => record.actualFieldDays / record.standardFieldDays / teamBaseline);
    personal = weightedFactor(
      personalRecords,
      residuals,
      asOf,
      priorWeight,
      recencyHalfLifeDays,
      minSamples,
      distributionMinSamples,
      personalExcluded,
    );
  }
  const warnings: string[] = [];
  if (!team.applied) warnings.push(`동일 조사유형의 팀 완료사례가 ${minSamples}건 미만이어서 팀 보정을 적용하지 않았습니다.`);
  if (input.investigatorId && personal && !personal.applied) warnings.push(`개인 완료사례가 ${minSamples}건 미만이어서 개인 잔차 보정을 적용하지 않았습니다.`);
  if (team.sampleCount < distributionMinSamples) warnings.push(`${distributionMinSamples}건 미만이므로 과거 분포 분위수를 표시하지 않습니다.`);
  if (team.applied && (team.factor < .5 || team.factor > 2)) warnings.push("팀 보정계수가 0.5~2.0 범위를 벗어납니다. 입력 실적과 제외 여부를 확인하세요.");
  return {
    id: input.id ?? `calibration-${input.investigationType}-${input.teamId}-${asOfText}`,
    createdAt: `${asOfText}T00:00:00.000Z`,
    investigationType: input.investigationType,
    teamId: input.teamId,
    ...(input.investigatorId ? { investigatorId: input.investigatorId } : {}),
    team,
    ...(personal ? { personal } : {}),
    combinedFactor: team.factor * (personal?.factor ?? 1),
    priorWeight,
    recencyHalfLifeDays,
    method: "quality_recency_weighted_geometric_mean",
    warnings,
  };
}
