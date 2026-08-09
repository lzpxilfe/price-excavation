import assert from "node:assert/strict";
import test from "node:test";
import {
  DomainValidationError,
  calculateVolume,
  parseBoundaryGeoJson,
  parseSurveyCsv,
} from "../src/index.ts";
import type { Boundary, SurveyPoint, SurveySurface } from "../src/index.ts";

const csvOptions = (role: "top" | "base" | "base_control") => ({
  role,
  crs: "EPSG:5179",
  horizontalUnit: "m" as const,
  verticalUnit: "m" as const,
  verticalDatum: "EL.m",
});

function boundary(coordinates: number[][][][], type: "Polygon" | "MultiPolygon" = "Polygon"): Boundary {
  return parseBoundaryGeoJson(
    { type, coordinates: type === "Polygon" ? coordinates[0] : coordinates },
    { source: "survey", crs: "EPSG:5179", horizontalUnit: "m" },
  );
}

function approximately(actual: number, expected: number, tolerance = 1e-7): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≉ ${expected}`);
}

test("측량 CSV는 열 매핑·따옴표·ft 단위와 surface 필터를 처리한다", () => {
  const parsed = parseSurveyCsv(
    'id,easting,northing,height,surface\n"P,1",0,0,3.280839895,top\nP2,32.80839895,0,6.56167979,top\nP3,0,32.80839895,9.842519685,top\nP4,2,2,2,base',
    {
      role: "top",
      crs: "LOCAL_FT",
      horizontalUnit: "ft",
      verticalUnit: "ft",
      verticalDatum: "local",
      columns: { x: "easting", y: "northing", z: "height", pointId: "id", surface: "surface" },
    },
  );
  assert.equal(parsed.points.length, 3);
  assert.equal(parsed.points[0]?.pointId, "P,1");
  approximately(parsed.points[1]?.x ?? 0, 10, 1e-8);
  approximately(parsed.points[0]?.z ?? 0, 1, 1e-8);
  assert.equal(parsed.crs, "LOCAL_FT:metric-normalized");
});

test("EPSG:4326 경위도는 한국 통합좌표계 미터로 변환하며 CRS/단위가 없거나 중복 XY이면 차단한다", () => {
  const geographic = parseSurveyCsv("x,y,z\n127,37,10\n127.001,37,10\n127,37.001,10", {
    role: "top",
    crs: "EPSG:4326",
    horizontalUnit: "degree",
    verticalUnit: "m",
    verticalDatum: "EL.m",
  });
  assert.equal(geographic.crs, "EPSG:5179");
  assert.equal(geographic.transformedFromGeographic, true);
  assert.ok((geographic.points[0]?.x ?? 0) > 900_000);
  assert.ok((geographic.points[0]?.y ?? 0) > 1_800_000);
  assert.throws(
    () => parseSurveyCsv("x,y,z\n0,0,0\n1,0,0\n0,1,0", { ...csvOptions("top"), crs: "" }),
    DomainValidationError,
  );
  assert.throws(
    () => parseSurveyCsv("x,y,z\n0,0,0\n0,0,1\n0,1,0", csvOptions("top")),
    (error: unknown) => error instanceof DomainValidationError && error.issues[0]?.code === "duplicate_xy",
  );
});

test("Polygon 구멍·오목 경계·MultiPolygon 면적을 보존하고 자기교차를 거부한다", () => {
  const withHole = boundary([[
    [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
    [[2, 2], [2, 8], [8, 8], [8, 2], [2, 2]],
  ]]);
  assert.equal(withHole.areaM2, 64);
  const concave = boundary([[[[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4], [0, 0]]]]);
  assert.equal(concave.areaM2, 7);
  const multi = boundary([
    [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
    [[[10, 0], [13, 0], [13, 2], [10, 2], [10, 0]]],
  ], "MultiPolygon");
  assert.equal(multi.areaM2, 10);
  assert.throws(
    () => boundary([
      [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
      [[[1, 0], [3, 0], [3, 2], [1, 2], [1, 0]]],
    ], "MultiPolygon"),
    (error: unknown) => error instanceof DomainValidationError && error.issues.some(({ code }) => code === "overlapping_polygons"),
  );
  assert.throws(
    () => boundary([[[[0, 0], [2, 2], [0, 2], [2, 0], [0, 0]]]]),
    (error: unknown) => error instanceof DomainValidationError && error.issues.some(({ code }) => code === "self_intersection"),
  );
});

test("공통 XY TIN은 평면 체적과 혼합 절·성토를 정확히 적분한다", () => {
  const top = parseSurveyCsv("x,y,z\n0,0,-5\n10,0,5\n10,10,5\n0,10,-5", csvOptions("top"));
  const base = parseSurveyCsv("x,y,z\n0,0,0\n10,0,0\n10,10,0\n0,10,0", csvOptions("base"));
  const result = calculateVolume({
    top,
    base,
    boundary: boundary([[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]]),
  });
  assert.equal(result.method, "common_xy_tin");
  approximately(result.fillVolumeM3, 125);
  approximately(result.cutVolumeM3, 125);
  approximately(result.netVolumeM3, 0);
  approximately(result.stockpileVolumeM3, 125);
});

test("TIN 경계 클리핑은 구멍과 멀티폴리곤을 체적에서 차감한다", () => {
  const top = parseSurveyCsv("x,y,z\n0,0,1\n13,0,1\n13,10,1\n0,10,1", csvOptions("top"));
  const base = parseSurveyCsv("x,y,z\n0,0,0\n13,0,0\n13,10,0\n0,10,0", csvOptions("base"));
  const target = boundary([
    [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[2, 2], [2, 8], [8, 8], [8, 2], [2, 2]],
    ],
    [[[11, 0], [13, 0], [13, 3], [11, 3], [11, 0]]],
  ], "MultiPolygon");
  const result = calculateVolume({ top, base, boundary: target });
  approximately(result.boundaryAreaM2, 70);
  approximately(result.fillVolumeM3, 70);
});

test("서로 다른 측점망은 결정론적 격자로 전환하고 절반 셀 오차를 보고한다", () => {
  const top = parseSurveyCsv("x,y,z\n0,0,1\n10,0,1\n10,10,1\n0,10,1", csvOptions("top"));
  const base = parseSurveyCsv("x,y,z\n0,0,0\n10,0,0\n10,10,0\n0,10,0\n5,5,0", csvOptions("base"));
  const result = calculateVolume({
    top,
    base,
    boundary: boundary([[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]]),
    gridCellSizeM: 2.5,
  });
  assert.equal(result.method, "deterministic_grid");
  approximately(result.fillVolumeM3, 100);
  approximately(result.numericalErrorM3, 0);
  assert.ok(result.warnings.some((warning) => warning.includes("절반 셀")));
});

test("혼합 절·성토의 수치오차는 순체적 상쇄로 과소 표시하지 않는다", () => {
  const top = parseSurveyCsv("x,y,z\n0,0,-6\n10,0,-6\n10,10,-6\n0,10,-6\n5,5,5", csvOptions("top"));
  const base = parseSurveyCsv("x,y,z\n0,0,0\n10,0,0\n10,10,0\n0,10,0", csvOptions("base"));
  const target = boundary([[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]]);
  const coarse = calculateVolume({ top, base, boundary: target, gridCellSizeM: 4 });
  const halfCell = calculateVolume({ top, base, boundary: target, gridCellSizeM: 2 });
  const fillDifference = Math.abs(halfCell.fillVolumeM3 - coarse.fillVolumeM3);
  const cutDifference = Math.abs(halfCell.cutVolumeM3 - coarse.cutVolumeM3);
  const netDifference = Math.abs(halfCell.netVolumeM3 - coarse.netVolumeM3);
  approximately(coarse.numericalErrorM3, Math.max(fillDifference, cutDifference, netDifference));
  assert.ok(coarse.numericalErrorM3 > netDifference);
});

test("고정 기준고와 제어점 기준면을 지원하고 제어점 방식은 낮은 신뢰도로 표시한다", () => {
  const top = parseSurveyCsv("x,y,z\n0,0,2\n10,0,2\n10,10,2\n0,10,2", csvOptions("top"));
  const target = boundary([[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]]);
  const fixed = calculateVolume({ top, base: { kind: "constant", elevationM: 1, verticalDatum: "EL.m" }, boundary: target });
  approximately(fixed.fillVolumeM3, 100);
  assert.equal(fixed.confidence, "low");
  const controlled = calculateVolume({
    top,
    base: {
      kind: "control_points",
      points: [[0, 0], [10, 0], [10, 10], [0, 10]].map(([x, y]) => ({ x: x as number, y: y as number, z: 1 })),
      crs: "EPSG:5179",
      verticalDatum: "EL.m",
    },
    boundary: target,
    gridCellSizeM: 2.5,
  });
  approximately(controlled.fillVolumeM3, 100);
  assert.equal(controlled.confidence, "low");
  assert.ok(controlled.warnings.some((warning) => warning.includes("신뢰도가 낮")));
});

test("95% 피복률, CRS, 수직기준 검증은 계산 전에 실패한다", () => {
  const top = parseSurveyCsv("x,y,z\n0,0,1\n5,0,1\n5,5,1\n0,5,1", csvOptions("top"));
  const base = parseSurveyCsv("x,y,z\n0,0,0\n5,0,0\n5,5,0\n0,5,0", csvOptions("base"));
  const large = boundary([[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]]);
  assert.throws(
    () => calculateVolume({ top, base, boundary: large }),
    (error: unknown) => error instanceof DomainValidationError && error.issues[0]?.code === "insufficient_coverage",
  );
  assert.throws(
    () => calculateVolume({ top, base: { ...base, verticalDatum: "other" }, boundary: large }),
    (error: unknown) => error instanceof DomainValidationError && error.issues[0]?.code === "vertical_datum_mismatch",
  );
});

test("95~99.9% 피복은 IDW 격자로 미피복 띠를 보완하고 실제 방식을 경고한다", () => {
  const top = parseSurveyCsv("x,y,z\n0,0,1\n9.75,0,1\n9.75,10,1\n0,10,1", csvOptions("top"));
  const base = parseSurveyCsv("x,y,z\n0,0,0\n9.75,0,0\n9.75,10,0\n0,10,0", csvOptions("base"));
  const result = calculateVolume({
    top,
    base,
    boundary: boundary([[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]]),
    gridCellSizeM: 2.5,
  });
  assert.equal(result.method, "deterministic_grid");
  approximately(result.fillVolumeM3, 100);
  assert.ok(result.warnings.some((warning) => warning.includes("IDW로 외삽")));
});

test("5만 공통 측점은 Delaunator TIN으로 실용 시간 안에 처리한다", { timeout: 15_000 }, () => {
  const points: SurveyPoint[] = [];
  for (let y = 0; y < 200; y += 1) {
    for (let x = 0; x < 250; x += 1) points.push({ x, y, z: 1 });
  }
  const makeSurface = (role: "top" | "base", values: SurveyPoint[]): SurveySurface => ({
    id: role,
    name: role,
    role,
    points: values,
    crs: "EPSG:5179",
    sourceCrs: "EPSG:5179",
    horizontalUnit: "m",
    sourceHorizontalUnit: "m",
    verticalUnit: "m",
    sourceVerticalUnit: "m",
    verticalDatum: "EL.m",
    columnMapping: { x: "x", y: "y", z: "z" },
    transformedFromGeographic: false,
  });
  const result = calculateVolume({
    top: makeSurface("top", points),
    base: makeSurface("base", points.map((point) => ({ ...point, z: 0 }))),
    boundary: boundary([[[[0, 0], [249, 0], [249, 199], [0, 199], [0, 0]]]]),
  });
  assert.equal(result.method, "common_xy_tin");
  approximately(result.fillVolumeM3, 249 * 199, 1e-6);
});
