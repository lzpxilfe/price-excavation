import type {
  Boundary,
  BoundaryGeoJsonOptions,
  BoundaryGeometry,
  LinearRing,
  MultiPolygonCoordinates,
  PolygonCoordinates,
  Position,
  ValidationIssue,
} from "./types.ts";
import { projectCoordinateToMeters } from "./survey.ts";
import { assertValid, throwIssues } from "./validation.ts";

const EPSILON = 1e-9;

type GeoJsonLike = {
  type?: unknown;
  coordinates?: unknown;
  geometry?: unknown;
  features?: unknown;
};

function samePosition(a: Position, b: Position): boolean {
  return Math.abs(a[0] - b[0]) <= EPSILON && Math.abs(a[1] - b[1]) <= EPSILON;
}

export function signedRingArea(ring: LinearRing): number {
  let twiceArea = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const current = ring[index] as Position;
    const next = ring[index + 1] as Position;
    twiceArea += current[0] * next[1] - next[0] * current[1];
  }
  return twiceArea / 2;
}

function orientation(a: Position, b: Position, c: Position): number {
  const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return Math.abs(cross) <= EPSILON ? 0 : Math.sign(cross);
}

function onSegment(a: Position, b: Position, point: Position): boolean {
  return (
    orientation(a, b, point) === 0 &&
    point[0] >= Math.min(a[0], b[0]) - EPSILON &&
    point[0] <= Math.max(a[0], b[0]) + EPSILON &&
    point[1] >= Math.min(a[1], b[1]) - EPSILON &&
    point[1] <= Math.max(a[1], b[1]) + EPSILON
  );
}

export function segmentsIntersect(a: Position, b: Position, c: Position, d: Position): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (abC !== abD && cdA !== cdB) return true;
  return (
    (abC === 0 && onSegment(a, b, c)) ||
    (abD === 0 && onSegment(a, b, d)) ||
    (cdA === 0 && onSegment(c, d, a)) ||
    (cdB === 0 && onSegment(c, d, b))
  );
}

export function pointInRing(point: Position, ring: LinearRing, includeBoundary = true): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 2; index < ring.length - 1; previous = index, index += 1) {
    const a = ring[index] as Position;
    const b = ring[previous] as Position;
    if (onSegment(a, b, point)) return includeBoundary;
    const crosses = (a[1] > point[1]) !== (b[1] > point[1]);
    if (crosses) {
      const crossingX = (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0];
      if (point[0] < crossingX) inside = !inside;
    }
  }
  return inside;
}

export function geometryPolygons(geometry: BoundaryGeometry): MultiPolygonCoordinates {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

export function pointInBoundary(point: Position, geometry: BoundaryGeometry): boolean {
  return geometryPolygons(geometry).some((polygon) => {
    const [outer, ...holes] = polygon;
    return Boolean(outer && pointInRing(point, outer) && !holes.some((hole) => pointInRing(point, hole)));
  });
}

export function boundaryArea(geometry: BoundaryGeometry): number {
  return geometryPolygons(geometry).reduce((total, polygon) => {
    const [outer, ...holes] = polygon;
    if (!outer) return total;
    return total + Math.abs(signedRingArea(outer)) - holes.reduce((sum, hole) => sum + Math.abs(signedRingArea(hole)), 0);
  }, 0);
}

function validateRing(ring: LinearRing, path: string, issues: ValidationIssue[]): void {
  if (ring.length < 4) {
    issues.push({ path, code: "ring_too_short", message: `${path}에는 닫힘점을 포함해 좌표가 4개 이상 필요합니다.` });
    return;
  }
  if (!samePosition(ring[0] as Position, ring[ring.length - 1] as Position)) {
    issues.push({ path, code: "ring_not_closed", message: `${path}의 첫 좌표와 마지막 좌표가 같아야 합니다.` });
    return;
  }
  if (Math.abs(signedRingArea(ring)) <= EPSILON) {
    issues.push({ path, code: "zero_area_ring", message: `${path}의 면적이 0입니다.` });
  }
  const edgeCount = ring.length - 1;
  for (let first = 0; first < edgeCount; first += 1) {
    for (let second = first + 1; second < edgeCount; second += 1) {
      const adjacent = Math.abs(first - second) <= 1 || (first === 0 && second === edgeCount - 1);
      if (adjacent) continue;
      if (
        segmentsIntersect(
          ring[first] as Position,
          ring[first + 1] as Position,
          ring[second] as Position,
          ring[second + 1] as Position,
        )
      ) {
        issues.push({ path, code: "self_intersection", message: `${path}가 자기 교차합니다.` });
        return;
      }
    }
  }
}

function ringEdgesIntersect(first: LinearRing, second: LinearRing): boolean {
  for (let a = 0; a < first.length - 1; a += 1) {
    for (let b = 0; b < second.length - 1; b += 1) {
      if (segmentsIntersect(first[a] as Position, first[a + 1] as Position, second[b] as Position, second[b + 1] as Position)) {
        return true;
      }
    }
  }
  return false;
}

function pointInPolygonInterior(point: Position, polygon: PolygonCoordinates): boolean {
  const [outer, ...holes] = polygon;
  return Boolean(
    outer &&
    pointInRing(point, outer, false) &&
    !holes.some((hole) => pointInRing(point, hole, true)),
  );
}

function polygonsOverlapOrTouch(first: PolygonCoordinates, second: PolygonCoordinates): boolean {
  // MultiPolygon components are integrated independently. Reject shared or
  // crossing boundaries as well as containment so their area can never be
  // counted twice. A component fully inside another component's hole remains
  // valid because it is outside that polygon's interior.
  if (first.some((firstRing) => second.some((secondRing) => ringEdgesIntersect(firstRing, secondRing)))) {
    return true;
  }
  const firstOuter = first[0];
  const secondOuter = second[0];
  return Boolean(
    (firstOuter?.[0] && pointInPolygonInterior(firstOuter[0], second)) ||
    (secondOuter?.[0] && pointInPolygonInterior(secondOuter[0], first)),
  );
}

function normalizePolygon(polygon: PolygonCoordinates, path: string, issues: ValidationIssue[]): PolygonCoordinates {
  if (polygon.length === 0) {
    issues.push({ path, code: "empty_polygon", message: `${path}에 외곽선이 없습니다.` });
    return polygon;
  }
  polygon.forEach((ring, ringIndex) => validateRing(ring, `${path}[${ringIndex}]`, issues));
  const [outer, ...holes] = polygon;
  if (!outer) return polygon;
  holes.forEach((hole, holeIndex) => {
    if (!pointInRing(hole[0] as Position, outer, false) || ringEdgesIntersect(outer, hole)) {
      issues.push({
        path: `${path}[${holeIndex + 1}]`,
        code: "invalid_hole",
        message: "구멍은 외곽선 안에 있고 외곽선과 교차하지 않아야 합니다.",
      });
    }
    for (let prior = 0; prior < holeIndex; prior += 1) {
      const other = holes[prior] as LinearRing;
      if (ringEdgesIntersect(hole, other) || pointInRing(hole[0] as Position, other, false) || pointInRing(other[0] as Position, hole, false)) {
        issues.push({
          path: `${path}[${holeIndex + 1}]`,
          code: "overlapping_holes",
          message: "구멍끼리 겹치거나 교차할 수 없습니다.",
        });
      }
    }
  });
  const normalizedOuter = signedRingArea(outer) > 0 ? outer : [...outer].reverse();
  const normalizedHoles = holes.map((hole) => signedRingArea(hole) < 0 ? hole : [...hole].reverse());
  return [normalizedOuter, ...normalizedHoles];
}

function readGeometry(value: unknown): { type: "Polygon" | "MultiPolygon"; coordinates: unknown } {
  assertValid(typeof value === "object" && value !== null, "geojson", "invalid_geojson", "GeoJSON 객체가 필요합니다.");
  const object = value as GeoJsonLike;
  if (object.type === "Feature") return readGeometry(object.geometry);
  if (object.type === "FeatureCollection") {
    assertValid(Array.isArray(object.features) && object.features.length === 1, "geojson.features", "feature_count", "FeatureCollection은 Polygon/MultiPolygon 피처 하나만 포함해야 합니다.");
    return readGeometry(object.features[0]);
  }
  assertValid(object.type === "Polygon" || object.type === "MultiPolygon", "geojson.type", "unsupported_geometry", "Polygon 또는 MultiPolygon만 지원합니다.");
  return { type: object.type, coordinates: object.coordinates };
}

function parsePosition(value: unknown, path: string): Position {
  assertValid(Array.isArray(value) && value.length >= 2, path, "invalid_position", `${path}는 [x, y] 좌표여야 합니다.`);
  const x = Number(value[0]);
  const y = Number(value[1]);
  assertValid(Number.isFinite(x) && Number.isFinite(y), path, "invalid_position", `${path} 좌표는 유한수여야 합니다.`);
  return [x, y];
}

function parsePolygonCoordinates(value: unknown, path: string): PolygonCoordinates {
  assertValid(Array.isArray(value), path, "invalid_coordinates", `${path} 좌표 배열이 필요합니다.`);
  return value.map((ring, ringIndex) => {
    assertValid(Array.isArray(ring), `${path}[${ringIndex}]`, "invalid_ring", "선형 링 좌표 배열이 필요합니다.");
    return ring.map((position, positionIndex) => parsePosition(position, `${path}[${ringIndex}][${positionIndex}]`));
  });
}

export function parseBoundaryGeoJson(
  input: string | unknown,
  options: BoundaryGeoJsonOptions,
): Boundary {
  assertValid(options.crs?.trim(), "crs", "missing_crs", "경계 좌표계(CRS)를 선택해야 합니다.");
  assertValid(options.horizontalUnit, "horizontalUnit", "missing_unit", "경계 수평 단위를 선택해야 합니다.");
  let parsed: unknown = input;
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input) as unknown;
    } catch {
      assertValid(false, "geojson", "invalid_json", "GeoJSON JSON 문법이 올바르지 않습니다.");
    }
  }
  const raw = readGeometry(parsed);
  const rawPolygons: MultiPolygonCoordinates = raw.type === "Polygon"
    ? [parsePolygonCoordinates(raw.coordinates, "coordinates")]
    : (() => {
        assertValid(Array.isArray(raw.coordinates), "coordinates", "invalid_coordinates", "MultiPolygon 좌표 배열이 필요합니다.");
        return raw.coordinates.map((polygon, index) => parsePolygonCoordinates(polygon, `coordinates[${index}]`));
      })();

  let outputCrs = options.crs;
  let transformedFromGeographic = false;
  const projected = rawPolygons.map((polygon) => polygon.map((ring) => ring.map(([x, y]) => {
    const coordinate = projectCoordinateToMeters(x, y, options.crs, options.horizontalUnit);
    outputCrs = coordinate.crs;
    transformedFromGeographic ||= coordinate.transformedFromGeographic;
    return [coordinate.x, coordinate.y] as Position;
  })));
  const issues: ValidationIssue[] = [];
  const normalized = projected.map((polygon, index) => normalizePolygon(polygon, `polygon[${index}]`, issues));
  for (let first = 0; first < normalized.length; first += 1) {
    for (let second = first + 1; second < normalized.length; second += 1) {
      if (polygonsOverlapOrTouch(normalized[first] as PolygonCoordinates, normalized[second] as PolygonCoordinates)) {
        issues.push({
          path: `polygon[${second}]`,
          code: "overlapping_polygons",
          message: "MultiPolygon 구성 면은 겹치거나 경계를 공유할 수 없습니다. 하나의 면으로 병합해 주세요.",
        });
      }
    }
  }
  if (issues.length > 0) throwIssues("경계 GeoJSON을 사용할 수 없습니다.", issues);

  const geometry: BoundaryGeometry = raw.type === "Polygon"
    ? { type: "Polygon", coordinates: normalized[0] as PolygonCoordinates }
    : { type: "MultiPolygon", coordinates: normalized };
  const areaM2 = boundaryArea(geometry);
  assertValid(areaM2 > EPSILON, "geometry", "zero_area", "경계의 유효 면적이 0입니다.");

  return {
    id: options.id ?? "boundary-1",
    name: options.name ?? "계산 경계",
    source: options.source,
    geometry,
    crs: outputCrs,
    sourceCrs: options.crs,
    horizontalUnit: "m",
    sourceHorizontalUnit: options.horizontalUnit,
    transformedFromGeographic,
    areaM2,
  };
}
