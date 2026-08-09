import benchmarkRegistry from "@/data/public-benchmarks/permit-registry-2026-06-30.aggregate.json";

type InvestigationType = "trial" | "precision";
type Percentiles = { p20: number; p50: number; p80: number };

interface AreaBand {
  id: string;
  label: string;
  minExclusiveM2: number | null;
  maxInclusiveM2: number | null;
}

interface BenchmarkCell {
  investigationClass: InvestigationType;
  areaBandId: string;
  n: number;
  registeredDurationDays: Percentiles;
  elapsedCalendarDays: Percentiles;
}

export interface PermitRegistryBenchmark {
  benchmarkId: string;
  version: string;
  asOf: string;
  investigationType: InvestigationType;
  areaBandId: string;
  areaBandLabel: string;
  n: number;
  registeredDurationDays: Percentiles;
  elapsedCalendarDays: Percentiles;
  sourceSnapshotDate: string;
  sourceTitle: string;
  sourceUrl: string;
  sourceChecksumSha256: string;
  licenseLabel: string;
  licenseCheckedAt: string;
}

export function findPermitRegistryBenchmark(
  investigationType: InvestigationType,
  areaM2: number,
): PermitRegistryBenchmark | null {
  if (!Number.isFinite(areaM2) || areaM2 <= 0) return null;
  const bands = benchmarkRegistry.cohort.areaBands as AreaBand[];
  const cells = benchmarkRegistry.cells as BenchmarkCell[];
  const band = bands.find(({ minExclusiveM2, maxInclusiveM2 }) => (
    (minExclusiveM2 === null || areaM2 > minExclusiveM2) &&
    (maxInclusiveM2 === null || areaM2 <= maxInclusiveM2)
  ));
  if (!band) return null;
  const cell = cells.find((candidate) => (
    candidate.investigationClass === investigationType && candidate.areaBandId === band.id
  ));
  if (!cell) return null;
  return {
    benchmarkId: benchmarkRegistry.benchmarkId,
    version: benchmarkRegistry.version,
    asOf: benchmarkRegistry.asOf,
    investigationType,
    areaBandId: band.id,
    areaBandLabel: band.label,
    n: cell.n,
    registeredDurationDays: cell.registeredDurationDays,
    elapsedCalendarDays: cell.elapsedCalendarDays,
    sourceSnapshotDate: benchmarkRegistry.sourceSnapshot.snapshotDate,
    sourceTitle: benchmarkRegistry.sourceSnapshot.title,
    sourceUrl: benchmarkRegistry.sourceSnapshot.landingPageUrl,
    sourceChecksumSha256: benchmarkRegistry.sourceSnapshot.checksum.value,
    licenseLabel: benchmarkRegistry.sourceSnapshot.licenseEvidence.label,
    licenseCheckedAt: benchmarkRegistry.sourceSnapshot.licenseEvidence.checkedAt,
  };
}
