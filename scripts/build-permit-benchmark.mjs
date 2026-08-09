import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const SOURCE = Object.freeze({
  sourceId: "khs-excavation-permit-registry-2026-06-30",
  title: "국가유산청 발굴허가대장 2026-06-30 게시본",
  publisher: "국가유산청",
  landingPageUrl: "https://www.data.go.kr/data/15088662/fileData.do",
  artifactUrl: "https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003672641&fileDetailSn=1&insertDataPrcus=N",
  snapshotDate: "2026-06-30",
  publishedAt: "2026-07-10",
  encoding: "CP949",
  licenseEvidence: {
    label: "이용허락범위 제한 없음",
    url: "https://www.data.go.kr/data/15088662/fileData.do",
    checkedAt: "2026-08-10",
  },
});

const EXPECTED_SOURCE_SHA256 = "6029fc250cd7a3b2f80703856dc5b42162d847490248db523f7dd1e19de3c8fd";

const AREA_BANDS = Object.freeze([
  { id: "lte-100", label: "100㎡ 이하", minExclusiveM2: null, maxInclusiveM2: 100 },
  { id: "101-500", label: "100㎡ 초과~500㎡ 이하", minExclusiveM2: 100, maxInclusiveM2: 500 },
  { id: "501-1000", label: "500㎡ 초과~1,000㎡ 이하", minExclusiveM2: 500, maxInclusiveM2: 1_000 },
  { id: "1001-3000", label: "1,000㎡ 초과~3,000㎡ 이하", minExclusiveM2: 1_000, maxInclusiveM2: 3_000 },
  { id: "3001-10000", label: "3,000㎡ 초과~10,000㎡ 이하", minExclusiveM2: 3_000, maxInclusiveM2: 10_000 },
  { id: "gt-10000", label: "10,000㎡ 초과", minExclusiveM2: 10_000, maxInclusiveM2: null },
]);

const REQUIRED_COLUMNS = Object.freeze([
  "허가번호",
  "발굴허가일",
  "발굴기간",
  "착수일",
  "발굴완료일",
  "시굴면적",
  "발굴면적",
  "조사면적",
]);

const SUPPRESSED_FIELDS = Object.freeze([
  "연번",
  "허가번호",
  "유적명",
  "신청시도",
  "신청시군구",
  "사업시행자 유형",
  "조사기관",
  "조사기관유형",
  "발굴신청장소 공백수정",
  "조사장소",
  "주소",
  "좌표",
]);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.endsWith("\r") ? field.slice(0, -1) : field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("닫히지 않은 CSV 따옴표가 있습니다.");
  if (field.length > 0 || row.length > 0) {
    row.push(field.endsWith("\r") ? field.slice(0, -1) : field);
    rows.push(row);
  }
  return rows.filter((values) => values.some((value) => value !== ""));
}

function recordRows(csvRows) {
  if (csvRows.length < 2) throw new Error("머리글과 한 행 이상의 데이터가 필요합니다.");
  const headers = csvRows[0].map((value, index) => index === 0 ? value.replace(/^\uFEFF/, "").trim() : value.trim());
  for (const column of REQUIRED_COLUMNS) {
    if (!headers.includes(column)) throw new Error(`필수 열이 없습니다: ${column}`);
  }
  return csvRows.slice(1).map((values, rowIndex) => {
    if (values.length !== headers.length) {
      throw new Error(`${rowIndex + 2}행의 열 수가 머리글과 다릅니다.`);
    }
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function numberValue(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value.replaceAll(",", "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function isoDateValue(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
  const [year, month, day] = value.trim().split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date
    : null;
}

function permitYear(row) {
  return isoDateValue(row["발굴허가일"])?.getUTCFullYear() ?? null;
}

function investigationClass(row) {
  const trialArea = numberValue(row["시굴면적"]) ?? 0;
  const precisionArea = numberValue(row["발굴면적"]) ?? 0;
  if (trialArea > 0 && precisionArea === 0) return "trial";
  if (precisionArea > 0 && trialArea === 0) return "precision";
  if (trialArea > 0 && precisionArea > 0) return "mixed";
  return "unspecified";
}

function areaBand(areaM2) {
  return AREA_BANDS.find(({ minExclusiveM2, maxInclusiveM2 }) => (
    (minExclusiveM2 === null || areaM2 > minExclusiveM2) &&
    (maxInclusiveM2 === null || areaM2 <= maxInclusiveM2)
  ));
}

function percentile(values, probability) {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) throw new Error("빈 집합의 분위수를 계산할 수 없습니다.");
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const value = lower === upper
    ? sorted[lower]
    : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
  return Number(value.toFixed(2));
}

function distribution(values) {
  return {
    p20: percentile(values, .2),
    p50: percentile(values, .5),
    p80: percentile(values, .8),
  };
}

function filterRows(rows) {
  const completeYearRows = rows.filter((row) => {
    const year = permitYear(row);
    return year !== null && year >= 2021 && year <= 2025;
  });
  let remaining = completeYearRows;
  const sequentialExclusions = {};
  const applyFilter = (key, predicate) => {
    const kept = remaining.filter(predicate);
    sequentialExclusions[key] = remaining.length - kept.length;
    remaining = kept;
  };
  applyFilter("nonPositiveOrInvalidSurveyArea", (row) => (numberValue(row["조사면적"]) ?? 0) > 0);
  applyFilter("nonPositiveOrInvalidRegisteredDuration", (row) => (numberValue(row["발굴기간"]) ?? 0) > 0);
  applyFilter("missingOrInvalidStartDate", (row) => isoDateValue(row["착수일"]) !== null);
  applyFilter("missingOrInvalidCompletionDate", (row) => isoDateValue(row["발굴완료일"]) !== null);
  applyFilter("completionBeforeStart", (row) => isoDateValue(row["발굴완료일"]) >= isoDateValue(row["착수일"]));

  const classCounts = Object.fromEntries(["trial", "precision", "mixed", "unspecified"].map((key) => [
    key,
    remaining.filter((row) => investigationClass(row) === key).length,
  ]));
  const eligibleRows = remaining.filter((row) => ["trial", "precision"].includes(investigationClass(row)));
  const permitCounts = new Map();
  for (const row of eligibleRows) {
    const permitNumber = row["허가번호"];
    permitCounts.set(permitNumber, (permitCounts.get(permitNumber) ?? 0) + 1);
  }
  const repeated = [...permitCounts.values()].filter((count) => count > 1);

  return {
    completeYearRows,
    dateEligibleRows: remaining,
    eligibleRows,
    audit: {
      inputRows: rows.length,
      completePermitYearRows: completeYearRows.length,
      sequentialExclusions,
      rowsAfterDateAndValueFilters: remaining.length,
      excludedInvestigationClass: {
        mixed: classCounts.mixed,
        unspecified: classCounts.unspecified,
      },
      eligibleAggregateRows: eligibleRows.length,
      repeatedPermitNumberQualityFlag: {
        groups: repeated.length,
        extraRows: repeated.reduce((total, count) => total + count - 1, 0),
        treatment: "원문의 행 단위를 유지하되 식별자는 공개 집계에서 제거함",
      },
    },
  };
}

export function buildBenchmarkFromRecords(rows, sourceChecksum) {
  const { eligibleRows, audit } = filterRows(rows);
  const cells = [];
  for (const investigationClassValue of ["trial", "precision"]) {
    for (const band of AREA_BANDS) {
      const members = eligibleRows.filter((row) => (
        investigationClass(row) === investigationClassValue &&
        areaBand(numberValue(row["조사면적"]))?.id === band.id
      ));
      if (members.length < 30) continue;
      const registered = members.map((row) => numberValue(row["발굴기간"]));
      const elapsed = members.map((row) => {
        const start = isoDateValue(row["착수일"]);
        const completion = isoDateValue(row["발굴완료일"]);
        return Math.round((completion.getTime() - start.getTime()) / 86_400_000) + 1;
      });
      cells.push({
        investigationClass: investigationClassValue,
        areaBandId: band.id,
        n: members.length,
        registeredDurationDays: distribution(registered),
        elapsedCalendarDays: distribution(elapsed),
        elapsedToRegisteredRatio: distribution(elapsed.map((value, index) => value / registered[index])),
        evidenceLevel: "descriptive_aggregate",
        qualityFlags: [
          "대장 기재 발굴기간은 순수 현장 작업일로 해석하지 않음",
          "착수~완료 경과일에는 기상·휴일·행정중단이 분리되어 있지 않음",
        ],
      });
    }
  }
  if (cells.some(({ n }) => n < 30)) throw new Error("공개 셀의 최소 크기 30을 충족하지 못했습니다.");
  const publishedRows = cells.reduce((total, cell) => total + cell.n, 0);
  if (publishedRows !== audit.eligibleAggregateRows) {
    throw new Error(`집계 셀 합계 ${publishedRows}가 적격 행 ${audit.eligibleAggregateRows}과 다릅니다.`);
  }

  return {
    schemaVersion: "1.0.0",
    benchmarkId: "permit-registry-anonymous-aggregate-2026.1",
    version: "2026.1.0",
    asOf: "2026-08-10",
    status: "published",
    sourceIds: [SOURCE.sourceId],
    sourceSnapshot: {
      ...SOURCE,
      checksum: { algorithm: "SHA-256", value: sourceChecksum },
    },
    evidencePolicy: {
      levels: {
        observed_public: "원문에 기재된 값. 저장소에는 행 단위 원문을 재배포하지 않음",
        deterministic_derived: "공개값에서 고정 산식으로 만든 조사유형·면적구간·포함 경과일",
        descriptive_aggregate: "최소 30건 코호트의 설명적 분위수이며 예측값이나 실제 작업일이 아님",
        conditional_inverse: "공식식과 사용자가 확인한 가정 아래 가능한 조건 집합이며 실제 투입의 복원이 아님",
      },
      prohibitedInferences: [
        "대장 기재 발굴기간을 순수 현장 작업일로 단정",
        "착수~완료 경과일의 차이를 기상·휴일·행정중단으로 분해",
        "역산값이 가까운 팀 구성을 실제 투입인원으로 단정",
        "공개 행을 팀·개인 생산성 보정이나 기관 간 순위에 사용",
        "코호트 분위수를 모델 정확도 검증값으로 사용",
      ],
      publication: {
        mode: "aggregate-only",
        minimumCellSize: 30,
        suppressedFields: SUPPRESSED_FIELDS,
      },
    },
    cohort: {
      permitYearRange: { from: 2021, to: 2025 },
      investigationClasses: {
        trial: "시굴면적 > 0, 발굴면적 = 0인 공개 행에서 파생",
        precision: "발굴면적 > 0, 시굴면적 = 0인 공개 행에서 파생",
      },
      areaBands: AREA_BANDS,
      percentileMethod: "R-7 선형보간: h=(n-1)p",
      audit,
    },
    cells,
  };
}

export function buildBenchmarkFromBytes(bytes) {
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (checksum !== EXPECTED_SOURCE_SHA256) {
    throw new Error(
      `공식 2026-06-30 스냅샷의 SHA-256과 다릅니다: expected=${EXPECTED_SOURCE_SHA256}, actual=${checksum}`,
    );
  }
  const text = new TextDecoder("euc-kr", { fatal: true }).decode(bytes);
  return buildBenchmarkFromRecords(recordRows(parseCsv(text)), checksum);
}

async function main() {
  const argumentsList = process.argv.slice(2);
  const inputPath = argumentsList.find((value) => !value.startsWith("--"));
  const outputFlagIndex = argumentsList.indexOf("--output");
  const outputPath = outputFlagIndex >= 0 ? argumentsList[outputFlagIndex + 1] : null;
  if (!inputPath || (outputFlagIndex >= 0 && !outputPath)) {
    console.error("사용법: node scripts/build-permit-benchmark.mjs <CP949 CSV 경로> [--output <JSON 경로>]");
    process.exitCode = 1;
    return;
  }
  const benchmark = buildBenchmarkFromBytes(await readFile(inputPath));
  const serialized = `${JSON.stringify(benchmark, null, 2)}\n`;
  if (outputPath) {
    await writeFile(outputPath, serialized, "utf8");
    console.log(`${benchmark.cells.length}개 익명 셀, ${benchmark.cohort.audit.eligibleAggregateRows}개 행을 ${outputPath}에 기록했습니다.`);
  } else {
    process.stdout.write(serialized);
  }
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) await main();
