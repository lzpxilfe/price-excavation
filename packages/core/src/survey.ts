import proj4 from "proj4";
import { MAX_SURVEY_POINTS } from "./types.ts";
import type {
  HorizontalUnit,
  SurveyCsvColumnMapping,
  SurveyCsvOptions,
  SurveyPoint,
  SurveySurface,
  ValidationIssue,
} from "./types.ts";
import { assertValid, throwIssues } from "./validation.ts";

const FEET_TO_METERS = .3048;
const KOREA_2000_UNIFIED_CS =
  "+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs";

function parseDelimitedRow(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      cells.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }
  assertValid(!quoted, "csv", "unterminated_quote", "CSV에 닫히지 않은 따옴표가 있습니다.");
  cells.push(value.trim());
  return cells;
}

function delimiterScore(line: string, delimiter: string): number {
  let score = 0;
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') quoted = !quoted;
    if (!quoted && line[index] === delimiter) score += 1;
  }
  return score;
}

function inferDelimiter(header: string): "," | ";" | "\t" {
  const candidates: Array<"," | ";" | "\t"> = [",", "\t", ";"];
  return candidates.sort((a, b) => delimiterScore(header, b) - delimiterScore(header, a))[0] ?? ",";
}

function isGeographicCrs(crs: string): boolean {
  const normalized = crs.replace(/\s/g, "").toUpperCase();
  return normalized === "EPSG:4326" || normalized === "WGS84" || normalized.includes("CRS84");
}

export function projectCoordinateToMeters(
  x: number,
  y: number,
  crs: string,
  unit: HorizontalUnit,
): { x: number; y: number; crs: string; transformedFromGeographic: boolean } {
  if (unit === "degree") {
    assertValid(
      isGeographicCrs(crs),
      "crs",
      "unsupported_geographic_crs",
      "degree 단위는 EPSG:4326/WGS84 경위도에서만 지원합니다.",
    );
    assertValid(x >= 122 && x <= 132, "x", "outside_korea", "경위도 체적 계산은 대한민국 인근(경도 122~132도)만 지원합니다.");
    assertValid(
      y >= 30 && y <= 44,
      "y",
      "outside_korea",
      "경위도 체적 계산은 대한민국 인근(위도 30~44도)만 지원합니다.",
    );
    const [projectedX, projectedY] = proj4("EPSG:4326", KOREA_2000_UNIFIED_CS, [x, y]);
    return { x: projectedX, y: projectedY, crs: "EPSG:5179", transformedFromGeographic: true };
  }
  if (unit === "ft") {
    return {
      x: x * FEET_TO_METERS,
      y: y * FEET_TO_METERS,
      crs: `${crs}:metric-normalized`,
      transformedFromGeographic: false,
    };
  }
  return { x, y, crs, transformedFromGeographic: false };
}

function resolveColumn(
  headers: string[],
  requested: string | undefined,
  fallback: string,
  required: boolean,
): { name?: string; index: number } {
  const candidate = requested ?? fallback;
  const exact = headers.indexOf(candidate);
  const insensitive = headers.findIndex((header) => header.toLowerCase() === candidate.toLowerCase());
  const index = exact >= 0 ? exact : insensitive;
  if (required) {
    assertValid(index >= 0, `columns.${fallback}`, "missing_column", `CSV에 '${candidate}' 열이 없습니다.`);
  }
  return { name: index >= 0 ? headers[index] : undefined, index };
}

export function parseSurveyCsv(csv: string, options: SurveyCsvOptions): SurveySurface {
  assertValid(csv.trim().length > 0, "csv", "empty_csv", "CSV 내용이 비어 있습니다.");
  assertValid(options.crs?.trim(), "crs", "missing_crs", "좌표계(CRS)를 선택해야 합니다.");
  assertValid(options.horizontalUnit, "horizontalUnit", "missing_unit", "수평 단위를 선택해야 합니다.");
  assertValid(options.verticalUnit, "verticalUnit", "missing_unit", "수직 단위를 선택해야 합니다.");
  assertValid(options.verticalDatum?.trim(), "verticalDatum", "missing_vertical_datum", "수직기준을 입력해야 합니다.");
  assertValid(
    isGeographicCrs(options.crs) ? options.horizontalUnit === "degree" : options.horizontalUnit !== "degree",
    "horizontalUnit",
    "crs_unit_mismatch",
    "EPSG:4326/WGS84는 degree, 투영좌표계는 m 또는 ft 단위를 사용해야 합니다.",
  );

  const lines = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  assertValid(lines.length >= 2, "csv", "no_data_rows", "CSV에는 머리글과 한 개 이상의 측점이 필요합니다.");
  const headerLine = lines[0] ?? "";
  const delimiter = options.delimiter ?? inferDelimiter(headerLine);
  const headers = parseDelimitedRow(headerLine, delimiter);
  const duplicateHeaders = headers.filter((header, index) => headers.indexOf(header) !== index);
  assertValid(duplicateHeaders.length === 0, "csv.headers", "duplicate_header", "CSV 머리글 이름이 중복되었습니다.");

  const xColumn = resolveColumn(headers, options.columns?.x, "x", true);
  const yColumn = resolveColumn(headers, options.columns?.y, "y", true);
  const zColumn = resolveColumn(headers, options.columns?.z, "z", true);
  const pointIdColumn = resolveColumn(headers, options.columns?.pointId, "point_id", false);
  const surfaceColumn = resolveColumn(headers, options.columns?.surface, "surface", false);
  const maxPoints = options.maxPoints ?? MAX_SURVEY_POINTS;
  assertValid(
    Number.isInteger(maxPoints) && maxPoints > 0 && maxPoints <= MAX_SURVEY_POINTS,
    "maxPoints",
    "invalid_limit",
    `측점 제한은 1~${MAX_SURVEY_POINTS.toLocaleString("ko-KR")}개여야 합니다.`,
  );

  const issues: ValidationIssue[] = [];
  const points: SurveyPoint[] = [];
  const seenCoordinates = new Set<string>();
  let resultCrs = options.crs;
  let transformedFromGeographic = false;
  const expectedSurface = options.surfaceValue ?? options.role;

  for (let rowIndex = 1; rowIndex < lines.length; rowIndex += 1) {
    const cells = parseDelimitedRow(lines[rowIndex] ?? "", delimiter);
    if (surfaceColumn.index >= 0 && cells[surfaceColumn.index] !== expectedSurface) continue;
    const rawX = Number(cells[xColumn.index]);
    const rawY = Number(cells[yColumn.index]);
    const rawZ = Number(cells[zColumn.index]);
    if (![rawX, rawY, rawZ].every(Number.isFinite)) {
      issues.push({
        path: `csv.row[${rowIndex + 1}]`,
        code: "invalid_coordinate",
        message: `${rowIndex + 1}행의 x, y, z는 모두 유한수여야 합니다.`,
      });
      if (issues.length >= 20) break;
      continue;
    }
    const projected = projectCoordinateToMeters(rawX, rawY, options.crs, options.horizontalUnit);
    resultCrs = projected.crs;
    transformedFromGeographic ||= projected.transformedFromGeographic;
    const z = options.verticalUnit === "ft" ? rawZ * FEET_TO_METERS : rawZ;
    const key = `${projected.x}\u0000${projected.y}`;
    if (seenCoordinates.has(key)) {
      issues.push({
        path: `csv.row[${rowIndex + 1}]`,
        code: "duplicate_xy",
        message: `${rowIndex + 1}행의 XY 좌표가 같은 표면 안에서 중복되었습니다.`,
      });
      if (issues.length >= 20) break;
      continue;
    }
    seenCoordinates.add(key);
    const pointId = pointIdColumn.index >= 0 ? cells[pointIdColumn.index]?.trim() : undefined;
    points.push({ x: projected.x, y: projected.y, z, ...(pointId ? { pointId } : {}) });
    if (points.length > maxPoints) {
      issues.push({
        path: "csv",
        code: "point_limit_exceeded",
        message: `표면당 측점은 최대 ${maxPoints.toLocaleString("ko-KR")}개까지 처리합니다.`,
      });
      break;
    }
  }

  if (issues.length > 0) throwIssues("측량 CSV를 읽을 수 없습니다.", issues);
  assertValid(points.length >= 3, "points", "too_few_points", "표면 계산에는 서로 다른 측점이 최소 3개 필요합니다.");

  const columnMapping: SurveyCsvColumnMapping = {
    x: xColumn.name ?? "x",
    y: yColumn.name ?? "y",
    z: zColumn.name ?? "z",
    ...(pointIdColumn.name ? { pointId: pointIdColumn.name } : {}),
    ...(surfaceColumn.name ? { surface: surfaceColumn.name } : {}),
  };

  return {
    id: options.id ?? `surface-${options.role}`,
    name: options.name ?? (options.role === "top" ? "상부 표면" : "기준 표면"),
    role: options.role,
    points,
    crs: resultCrs,
    sourceCrs: options.crs,
    horizontalUnit: "m",
    sourceHorizontalUnit: options.horizontalUnit,
    verticalUnit: "m",
    sourceVerticalUnit: options.verticalUnit,
    verticalDatum: options.verticalDatum,
    ...(options.accuracyM !== undefined
      ? { accuracyM: options.horizontalUnit === "ft" ? options.accuracyM * FEET_TO_METERS : options.accuracyM }
      : {}),
    columnMapping,
    transformedFromGeographic,
  };
}
