import Delaunator from "delaunator";
import { geometryPolygons, signedRingArea } from "./boundary.ts";
import type {
  Boundary,
  ConstantBase,
  ControlPointBase,
  LinearRing,
  Position,
  SurveyPoint,
  SurveySurface,
  VolumeBase,
  VolumeCalculationInput,
  VolumeCalculationResult,
} from "./types.ts";
import { MAX_SURVEY_POINTS } from "./types.ts";
import { assertValid, clamp, finitePositive } from "./validation.ts";

const EPSILON = 1e-9;
type Triangle = [number, number, number];
type TrianglePoints = [Position, Position, Position];

function pointKey(point: Pick<SurveyPoint, "x" | "y">): string {
  return `${point.x}\u0000${point.y}`;
}

function cross(a: Position, b: Position, c: Position): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function triangleArea(a: Position, b: Position, c: Position): number {
  return Math.abs(cross(a, b, c)) / 2;
}

function delaunay(pointsInput: SurveyPoint[]): { points: SurveyPoint[]; triangles: Triangle[] } {
  const points = [...pointsInput].sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z);
  assertValid(points.length >= 3, "surface.points", "too_few_points", "TIN 생성에는 측점이 3개 이상 필요합니다.");
  const mesh = Delaunator.from(points, (point) => point.x, (point) => point.y);
  const triangles: Triangle[] = [];
  for (let index = 0; index < mesh.triangles.length; index += 3) {
    const triangle: Triangle = [
      mesh.triangles[index] as number,
      mesh.triangles[index + 1] as number,
      mesh.triangles[index + 2] as number,
    ];
    const a = points[triangle[0]] as SurveyPoint;
    const b = points[triangle[1]] as SurveyPoint;
    const c = points[triangle[2]] as SurveyPoint;
    if (triangleArea([a.x, a.y], [b.x, b.y], [c.x, c.y]) <= EPSILON) continue;
    triangles.push(cross([a.x, a.y], [b.x, b.y], [c.x, c.y]) >= 0 ? triangle : [triangle[0], triangle[2], triangle[1]]);
  }
  assertValid(triangles.length > 0, "surface.points", "degenerate_surface", "측점이 일직선상에 있어 표면을 만들 수 없습니다.");
  return { points, triangles };
}

function pointInsideTriangle(point: Position, a: Position, b: Position, c: Position): boolean {
  const first = cross(a, b, point);
  const second = cross(b, c, point);
  const third = cross(c, a, point);
  return first >= -EPSILON && second >= -EPSILON && third >= -EPSILON;
}

function triangulateRing(ring: LinearRing): TrianglePoints[] {
  let vertices = ring.slice(0, -1);
  if (signedRingArea(ring) < 0) vertices = [...vertices].reverse();
  const indices = vertices.map((_, index) => index);
  const output: TrianglePoints[] = [];
  let guard = 0;
  while (indices.length > 3 && guard < vertices.length ** 2) {
    let found = false;
    for (let index = 0; index < indices.length; index += 1) {
      const previous = indices[(index - 1 + indices.length) % indices.length] as number;
      const current = indices[index] as number;
      const next = indices[(index + 1) % indices.length] as number;
      const a = vertices[previous] as Position;
      const b = vertices[current] as Position;
      const c = vertices[next] as Position;
      if (cross(a, b, c) <= EPSILON) continue;
      const contains = indices.some((candidate) => {
        if (candidate === previous || candidate === current || candidate === next) return false;
        return pointInsideTriangle(vertices[candidate] as Position, a, b, c);
      });
      if (contains) continue;
      output.push([a, b, c]);
      indices.splice(index, 1);
      found = true;
      break;
    }
    if (!found) break;
    guard += 1;
  }
  if (indices.length === 3) {
    output.push([
      vertices[indices[0] as number] as Position,
      vertices[indices[1] as number] as Position,
      vertices[indices[2] as number] as Position,
    ]);
  }
  assertValid(output.length === Math.max(1, vertices.length - 2), "boundary", "triangulation_failed", "경계 링을 삼각분할할 수 없습니다.");
  return output;
}

type SignedBoundaryTriangle = { triangle: TrianglePoints; sign: 1 | -1 };

function boundaryTriangles(boundary: Boundary): SignedBoundaryTriangle[] {
  const triangles: SignedBoundaryTriangle[] = [];
  geometryPolygons(boundary.geometry).forEach(([outer, ...holes]) => {
    if (outer) triangulateRing(outer).forEach((triangle) => triangles.push({ triangle, sign: 1 }));
    holes.forEach((hole) => triangulateRing(hole).forEach((triangle) => triangles.push({ triangle, sign: -1 })));
  });
  return triangles;
}

function lineIntersection(start: Position, end: Position, clipStart: Position, clipEnd: Position): Position {
  const directionX = end[0] - start[0];
  const directionY = end[1] - start[1];
  const clipX = clipEnd[0] - clipStart[0];
  const clipY = clipEnd[1] - clipStart[1];
  const denominator = directionX * clipY - directionY * clipX;
  if (Math.abs(denominator) <= EPSILON) return end;
  const t = ((clipStart[0] - start[0]) * clipY - (clipStart[1] - start[1]) * clipX) / denominator;
  return [start[0] + t * directionX, start[1] + t * directionY];
}

function intersectConvex(subjectInput: Position[], clipTriangle: TrianglePoints): Position[] {
  let subject = subjectInput;
  for (let edge = 0; edge < 3 && subject.length > 0; edge += 1) {
    const clipStart = clipTriangle[edge] as Position;
    const clipEnd = clipTriangle[(edge + 1) % 3] as Position;
    const input = subject;
    subject = [];
    let start = input[input.length - 1] as Position;
    for (const end of input) {
      const endInside = cross(clipStart, clipEnd, end) >= -EPSILON;
      const startInside = cross(clipStart, clipEnd, start) >= -EPSILON;
      if (endInside) {
        if (!startInside) subject.push(lineIntersection(start, end, clipStart, clipEnd));
        subject.push(end);
      } else if (startInside) {
        subject.push(lineIntersection(start, end, clipStart, clipEnd));
      }
      start = end;
    }
  }
  return subject;
}

function polygonAreaCentroid(polygon: Position[]): { area: number; centroid: Position } | null {
  if (polygon.length < 3) return null;
  let twiceArea = 0;
  let xMoment = 0;
  let yMoment = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index] as Position;
    const next = polygon[(index + 1) % polygon.length] as Position;
    const term = current[0] * next[1] - next[0] * current[1];
    twiceArea += term;
    xMoment += (current[0] + next[0]) * term;
    yMoment += (current[1] + next[1]) * term;
  }
  if (Math.abs(twiceArea) <= EPSILON) return null;
  return {
    area: Math.abs(twiceArea) / 2,
    centroid: [xMoment / (3 * twiceArea), yMoment / (3 * twiceArea)],
  };
}

function clipBySign(
  polygon: Position[],
  valueAt: (position: Position) => number,
  keepPositive: boolean,
): Position[] {
  if (polygon.length === 0) return [];
  const output: Position[] = [];
  let start = polygon[polygon.length - 1] as Position;
  let startValue = valueAt(start);
  let startInside = keepPositive ? startValue >= -EPSILON : startValue <= EPSILON;
  for (const end of polygon) {
    const endValue = valueAt(end);
    const endInside = keepPositive ? endValue >= -EPSILON : endValue <= EPSILON;
    if (endInside !== startInside) {
      const denominator = startValue - endValue;
      const t = Math.abs(denominator) <= EPSILON ? .5 : startValue / denominator;
      output.push([start[0] + t * (end[0] - start[0]), start[1] + t * (end[1] - start[1])]);
    }
    if (endInside) output.push(end);
    start = end;
    startValue = endValue;
    startInside = endInside;
  }
  return output;
}

function integrateDifferencePolygon(
  polygon: Position[],
  valueAt: (position: Position) => number,
): { fill: number; cut: number; area: number } {
  const whole = polygonAreaCentroid(polygon);
  if (!whole) return { fill: 0, cut: 0, area: 0 };
  const positive = polygonAreaCentroid(clipBySign(polygon, valueAt, true));
  const negative = polygonAreaCentroid(clipBySign(polygon, valueAt, false));
  const fill = positive ? positive.area * Math.max(0, valueAt(positive.centroid)) : 0;
  const cut = negative ? negative.area * Math.max(0, -valueAt(negative.centroid)) : 0;
  return { fill, cut, area: whole.area };
}

function barycentricValue(
  point: Position,
  triangle: TrianglePoints,
  values: [number, number, number],
): number {
  const [a, b, c] = triangle;
  const denominator = cross(a, b, c);
  const first = cross(point, b, c) / denominator;
  const second = cross(a, point, c) / denominator;
  const third = 1 - first - second;
  return first * values[0] + second * values[1] + third * values[2];
}

function convexHull(points: SurveyPoint[]): LinearRing {
  const sorted = [...points]
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .map(({ x, y }) => [x, y] as Position);
  const half = (values: Position[]): Position[] => {
    const result: Position[] = [];
    for (const point of values) {
      while (result.length >= 2 && cross(result[result.length - 2] as Position, result[result.length - 1] as Position, point) <= EPSILON) {
        result.pop();
      }
      result.push(point);
    }
    return result;
  };
  const lower = half(sorted);
  const upper = half([...sorted].reverse());
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  assertValid(hull.length >= 3, "surface.points", "degenerate_surface", "측점의 볼록껍질 면적이 0입니다.");
  return [...hull, hull[0] as Position];
}

function hullCoverage(points: SurveyPoint[], boundaryParts: SignedBoundaryTriangle[], boundaryAreaM2: number): number {
  const hullTriangles = triangulateRing(convexHull(points));
  let covered = 0;
  for (const hullTriangle of hullTriangles) {
    for (const boundaryPart of boundaryParts) {
      const intersection = polygonAreaCentroid(intersectConvex([...hullTriangle], boundaryPart.triangle));
      if (intersection) covered += boundaryPart.sign * intersection.area;
    }
  }
  return clamp(covered / boundaryAreaM2, 0, 1);
}

function isSurveySurface(base: VolumeBase): base is SurveySurface {
  return "role" in base && "columnMapping" in base;
}

function isConstantBase(base: VolumeBase): base is ConstantBase {
  return "kind" in base && base.kind === "constant";
}

function isControlBase(base: VolumeBase): base is ControlPointBase {
  return "kind" in base && base.kind === "control_points";
}

function validateVolumeInput(input: VolumeCalculationInput): void {
  const { top, base, boundary } = input;
  assertValid(top.points.length <= MAX_SURVEY_POINTS, "top.points", "point_limit_exceeded", `상부 표면은 ${MAX_SURVEY_POINTS.toLocaleString("ko-KR")}개 측점 이하여야 합니다.`);
  assertValid(top.crs === boundary.crs, "boundary.crs", "crs_mismatch", "상부 표면과 경계의 좌표계가 다릅니다.");
  if (isSurveySurface(base)) {
    assertValid(base.points.length <= MAX_SURVEY_POINTS, "base.points", "point_limit_exceeded", `기준 표면은 ${MAX_SURVEY_POINTS.toLocaleString("ko-KR")}개 측점 이하여야 합니다.`);
    assertValid(top.crs === base.crs, "base.crs", "crs_mismatch", "상부 표면과 기준 표면의 좌표계가 다릅니다.");
    assertValid(top.verticalDatum === base.verticalDatum, "base.verticalDatum", "vertical_datum_mismatch", "상·하면의 수직기준이 다릅니다.");
  } else if (isControlBase(base)) {
    assertValid(base.points.length >= 3, "base.points", "too_few_control_points", "기준지반 제어점은 최소 3개 필요합니다.");
    assertValid(base.points.length <= MAX_SURVEY_POINTS, "base.points", "point_limit_exceeded", "제어점 수가 제한을 초과했습니다.");
    assertValid(top.crs === base.crs, "base.crs", "crs_mismatch", "상부 표면과 제어점의 좌표계가 다릅니다.");
    assertValid(top.verticalDatum === base.verticalDatum, "base.verticalDatum", "vertical_datum_mismatch", "상부 표면과 제어점의 수직기준이 다릅니다.");
  } else {
    assertValid(Number.isFinite(base.elevationM), "base.elevationM", "invalid_elevation", "고정 기준고는 유한수여야 합니다.");
    assertValid(top.verticalDatum === base.verticalDatum, "base.verticalDatum", "vertical_datum_mismatch", "상부 표면과 고정 기준고의 수직기준이 다릅니다.");
  }
  if (input.gridCellSizeM !== undefined) finitePositive(input.gridCellSizeM, "gridCellSizeM");
  const coverageThreshold = input.coverageThreshold ?? .95;
  assertValid(coverageThreshold > 0 && coverageThreshold <= 1, "coverageThreshold", "invalid_ratio", "피복률 기준은 0 초과 1 이하여야 합니다.");
}

function commonXyPairs(top: SurveyPoint[], base: SurveyPoint[]): Array<{ top: SurveyPoint; base: SurveyPoint }> | null {
  if (top.length !== base.length) return null;
  const baseByXy = new Map(base.map((point) => [pointKey(point), point]));
  const pairs = top.map((point) => ({ top: point, base: baseByXy.get(pointKey(point)) }));
  return pairs.every((pair) => pair.base !== undefined)
    ? pairs.map(({ top: topPoint, base: basePoint }) => ({ top: topPoint, base: basePoint as SurveyPoint }))
    : null;
}

function tinCalculation(
  pointsWithDifference: SurveyPoint[],
  boundaryParts: SignedBoundaryTriangle[],
): { fill: number; cut: number; area: number; triangleCount: number } {
  const mesh = delaunay(pointsWithDifference);
  let fill = 0;
  let cut = 0;
  let area = 0;
  for (const triangleIndices of mesh.triangles) {
    const trianglePoints = triangleIndices.map((index) => mesh.points[index] as SurveyPoint);
    const geometry = trianglePoints.map(({ x, y }) => [x, y] as Position) as TrianglePoints;
    const values = trianglePoints.map(({ z }) => z) as [number, number, number];
    const valueAt = (position: Position): number => barycentricValue(position, geometry, values);
    for (const boundaryPart of boundaryParts) {
      const clipped = intersectConvex([...geometry], boundaryPart.triangle);
      const integrated = integrateDifferencePolygon(clipped, valueAt);
      fill += boundaryPart.sign * integrated.fill;
      cut += boundaryPart.sign * integrated.cut;
      area += boundaryPart.sign * integrated.area;
    }
  }
  return { fill: Math.max(0, fill), cut: Math.max(0, cut), area: Math.max(0, area), triangleCount: mesh.triangles.length };
}

type KdNode = { point: SurveyPoint; axis: 0 | 1; left?: KdNode; right?: KdNode };

function buildKdTree(points: SurveyPoint[], depth = 0): KdNode | undefined {
  if (points.length === 0) return undefined;
  const axis = (depth % 2) as 0 | 1;
  const sorted = [...points].sort((a, b) => (axis === 0 ? a.x - b.x : a.y - b.y) || a.x - b.x || a.y - b.y);
  const middle = Math.floor(sorted.length / 2);
  return {
    point: sorted[middle] as SurveyPoint,
    axis,
    left: buildKdTree(sorted.slice(0, middle), depth + 1),
    right: buildKdTree(sorted.slice(middle + 1), depth + 1),
  };
}

function nearest(tree: KdNode | undefined, target: Position, count: number): SurveyPoint[] {
  const best: Array<{ point: SurveyPoint; distanceSquared: number }> = [];
  const insert = (point: SurveyPoint): void => {
    const distanceSquared = (point.x - target[0]) ** 2 + (point.y - target[1]) ** 2;
    const existing = best.find(({ point: candidate }) => candidate.x === point.x && candidate.y === point.y);
    if (existing) return;
    best.push({ point, distanceSquared });
    best.sort((a, b) => a.distanceSquared - b.distanceSquared || a.point.x - b.point.x || a.point.y - b.point.y);
    if (best.length > count) best.pop();
  };
  const visit = (node: KdNode | undefined): void => {
    if (!node) return;
    insert(node.point);
    const targetAxis = node.axis === 0 ? target[0] : target[1];
    const nodeAxis = node.axis === 0 ? node.point.x : node.point.y;
    const near = targetAxis < nodeAxis ? node.left : node.right;
    const far = targetAxis < nodeAxis ? node.right : node.left;
    visit(near);
    const worst = best.length < count ? Infinity : (best[best.length - 1]?.distanceSquared ?? Infinity);
    if ((targetAxis - nodeAxis) ** 2 <= worst) visit(far);
  };
  visit(tree);
  return best.map(({ point }) => point);
}

function idw(tree: KdNode | undefined, target: Position): number {
  const points = nearest(tree, target, 4);
  assertValid(points.length >= 1, "surface.points", "empty_surface", "보간할 측점이 없습니다.");
  let weighted = 0;
  let totalWeight = 0;
  for (const point of points) {
    const distanceSquared = (point.x - target[0]) ** 2 + (point.y - target[1]) ** 2;
    if (distanceSquared <= EPSILON ** 2) return point.z;
    const weight = 1 / distanceSquared;
    weighted += weight * point.z;
    totalWeight += weight;
  }
  return weighted / totalWeight;
}

function boundingBox(boundary: Boundary): { minX: number; minY: number; maxX: number; maxY: number } {
  const positions = geometryPolygons(boundary.geometry).flat(2);
  return {
    minX: Math.min(...positions.map(([x]) => x)),
    minY: Math.min(...positions.map(([, y]) => y)),
    maxX: Math.max(...positions.map(([x]) => x)),
    maxY: Math.max(...positions.map(([, y]) => y)),
  };
}

function suggestedGridSize(boundaryAreaM2: number, topPointCount: number, basePointCount: number): number {
  const densityCount = Math.max(3, Math.min(topPointCount, basePointCount));
  return Math.max(.01, Math.sqrt(boundaryAreaM2 / densityCount));
}

function gridCalculation(
  cellSizeM: number,
  boundary: Boundary,
  boundaryParts: SignedBoundaryTriangle[],
  topTree: KdNode | undefined,
  baseAt: (position: Position) => number,
): { fill: number; cut: number; processed: number } {
  const box = boundingBox(boundary);
  const columns = Math.ceil((box.maxX - box.minX) / cellSizeM);
  const rows = Math.ceil((box.maxY - box.minY) / cellSizeM);
  assertValid(columns * rows <= 1_000_000, "gridCellSizeM", "grid_too_dense", "격자 셀이 100만 개를 넘습니다. 셀 크기를 늘리세요.");
  let fill = 0;
  let cut = 0;
  let processed = 0;
  for (let row = 0; row < rows; row += 1) {
    const minY = box.minY + row * cellSizeM;
    const maxY = Math.min(box.maxY, minY + cellSizeM);
    for (let column = 0; column < columns; column += 1) {
      const minX = box.minX + column * cellSizeM;
      const maxX = Math.min(box.maxX, minX + cellSizeM);
      const cell: Position[] = [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];
      let touched = false;
      for (const boundaryPart of boundaryParts) {
        const clipped = intersectConvex(cell, boundaryPart.triangle);
        if (clipped.length < 3) continue;
        touched = true;
        // Sign clipping asks for the same vertices repeatedly. Cache within the
        // clipped cell to avoid repeated k-d-tree nearest-neighbour searches.
        const valueCache = new Map<string, number>();
        const valueAt = (position: Position): number => {
          const key = `${position[0]},${position[1]}`;
          const cached = valueCache.get(key);
          if (cached !== undefined) return cached;
          const value = idw(topTree, position) - baseAt(position);
          valueCache.set(key, value);
          return value;
        };
        const integrated = integrateDifferencePolygon(clipped, valueAt);
        fill += boundaryPart.sign * integrated.fill;
        cut += boundaryPart.sign * integrated.cut;
      }
      if (touched) processed += 1;
    }
  }
  return { fill: Math.max(0, fill), cut: Math.max(0, cut), processed };
}

export function calculateVolume(input: VolumeCalculationInput): VolumeCalculationResult {
  validateVolumeInput(input);
  const { top, base, boundary } = input;
  const boundaryParts = boundaryTriangles(boundary);
  const coverageThreshold = input.coverageThreshold ?? .95;
  const topCoverageRatio = hullCoverage(top.points, boundaryParts, boundary.areaM2);
  const basePoints = isSurveySurface(base) || isControlBase(base) ? base.points : null;
  const baseCoverageRatio = basePoints ? hullCoverage(basePoints, boundaryParts, boundary.areaM2) : 1;
  assertValid(
    topCoverageRatio + 1e-8 >= coverageThreshold,
    "top.points",
    "insufficient_coverage",
    `상부 표면의 경계 피복률이 ${(topCoverageRatio * 100).toFixed(1)}%로 ${(coverageThreshold * 100).toFixed(0)}% 미만입니다.`,
  );
  assertValid(
    baseCoverageRatio + 1e-8 >= coverageThreshold,
    "base.points",
    "insufficient_coverage",
    `기준 표면의 경계 피복률이 ${(baseCoverageRatio * 100).toFixed(1)}%로 ${(coverageThreshold * 100).toFixed(0)}% 미만입니다.`,
  );

  const warnings: string[] = [];
  if (boundary.source === "cadastral_reference") {
    warnings.push("연속지적도 경계는 위치 확인용 참고정보이며 측량성과나 실제 적치토 경계가 아닙니다.");
  }
  if (topCoverageRatio < .999 || baseCoverageRatio < .999) {
    warnings.push("표면이 경계를 완전히 덮지 않는 5% 이내 구역은 인접 4개 측점 IDW로 외삽했습니다.");
  }
  const maxTinPoints = input.maxTinPoints ?? MAX_SURVEY_POINTS;
  const paired = isSurveySurface(base) ? commonXyPairs(top.points, base.points) : null;
  // A TIN cannot integrate the sliver outside the measured convex hull. For
  // accepted 95–99.9% coverage, use the documented IDW grid extrapolation.
  const canUseTin =
    (paired !== null || isConstantBase(base)) &&
    top.points.length <= maxTinPoints &&
    topCoverageRatio >= .999 &&
    baseCoverageRatio >= .999;
  let fill: number;
  let cut: number;
  let processedElementCount: number;
  let numericalErrorM3 = 0;
  let gridCellSizeM: number | undefined;
  let method: VolumeCalculationResult["method"];

  if (canUseTin) {
    const differences = paired
      ? paired.map(({ top: topPoint, base: basePoint }) => ({ ...topPoint, z: topPoint.z - basePoint.z }))
      : top.points.map((point) => ({ ...point, z: point.z - (base as ConstantBase).elevationM }));
    const calculated = tinCalculation(differences, boundaryParts);
    fill = calculated.fill;
    cut = calculated.cut;
    processedElementCount = calculated.triangleCount;
    method = "common_xy_tin";
  } else {
    method = "deterministic_grid";
    const topTree = buildKdTree(top.points);
    let baseAt: (position: Position) => number;
    if (isConstantBase(base)) {
      baseAt = () => base.elevationM;
    } else {
      const baseTree = buildKdTree(base.points);
      baseAt = (position) => idw(baseTree, position);
    }
    const suggested = suggestedGridSize(boundary.areaM2, top.points.length, basePoints?.length ?? top.points.length);
    const box = boundingBox(boundary);
    const boundingArea = Math.max(EPSILON, (box.maxX - box.minX) * (box.maxY - box.minY));
    const minimumForFineLimit = Math.sqrt(boundingArea / 1_000_000) * 2;
    gridCellSizeM = Math.max(input.gridCellSizeM ?? suggested, minimumForFineLimit);
    const coarse = gridCalculation(gridCellSizeM, boundary, boundaryParts, topTree, baseAt);
    const fine = gridCalculation(gridCellSizeM / 2, boundary, boundaryParts, topTree, baseAt);
    fill = coarse.fill;
    cut = coarse.cut;
    processedElementCount = coarse.processed;
    const fillSensitivity = Math.abs(fine.fill - coarse.fill);
    const cutSensitivity = Math.abs(fine.cut - coarse.cut);
    const netSensitivity = Math.abs((fine.fill - fine.cut) - (coarse.fill - coarse.cut));
    // Fill and cut can move in opposite directions and cancel in the net.
    // Report the largest component sensitivity so a mixed surface never looks
    // artificially stable merely because those errors offset one another.
    numericalErrorM3 = Math.max(fillSensitivity, cutSensitivity, netSensitivity);
    warnings.push("서로 다른 측점망은 공통 격자 IDW 보간으로 계산했으며 절반 셀 재계산의 성토·절토·순체적 차이 중 큰 값을 수치오차로 표시했습니다.");
  }

  if (isControlBase(base)) warnings.push("기준지반 제어점 보간은 적치 전 전체 표면 비교보다 신뢰도가 낮습니다.");
  if (isConstantBase(base)) warnings.push("고정 기준고를 사용했습니다. 실제 원지반 경사를 반영하는지 확인하세요.");
  const netVolumeM3 = fill - cut;
  return {
    method,
    confidence: isControlBase(base) || isConstantBase(base) ? "low" : method === "common_xy_tin" ? "high" : "medium",
    fillVolumeM3: fill,
    cutVolumeM3: cut,
    netVolumeM3,
    stockpileVolumeM3: input.stockpilePositiveOnly === false ? Math.max(0, netVolumeM3) : fill,
    boundaryAreaM2: boundary.areaM2,
    topCoverageRatio,
    baseCoverageRatio,
    ...(gridCellSizeM !== undefined ? { gridCellSizeM } : {}),
    numericalErrorM3,
    processedElementCount,
    warnings,
    formula: method === "common_xy_tin"
      ? "V = Σ[A × (d1 + d2 + d3) / 3] (경계·양/음 깊이로 클리핑)"
      : "V ≈ Σ[클리핑 셀 면적 × IDW 보간 높이차]",
  };
}
