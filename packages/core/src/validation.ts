import type { ValidationIssue } from "./types.ts";

export class DomainValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(message: string, issues: ValidationIssue[]) {
    super(message);
    this.name = "DomainValidationError";
    this.issues = issues;
  }
}

export function assertValid(
  condition: unknown,
  path: string,
  code: string,
  message: string,
): asserts condition {
  if (!condition) {
    throw new DomainValidationError(message, [{ path, code, message }]);
  }
}

export function throwIssues(message: string, issues: ValidationIssue[]): never {
  throw new DomainValidationError(message, issues);
}

export function finitePositive(value: number, path: string, allowZero = false): void {
  assertValid(
    Number.isFinite(value) && (allowZero ? value >= 0 : value > 0),
    path,
    "invalid_number",
    `${path} 값은 ${allowZero ? "0 이상" : "0보다 큰"} 유한수여야 합니다.`,
  );
}

export function ratio(value: number, path: string, allowZero = true): void {
  assertValid(
    Number.isFinite(value) && value <= 1 && (allowZero ? value >= 0 : value > 0),
    path,
    "invalid_ratio",
    `${path} 값은 ${allowZero ? "0 이상 " : "0 초과 "}1 이하여야 합니다.`,
  );
}

export function roundTo(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function parseIsoDate(value: string, path: string): Date {
  assertValid(
    /^\d{4}-\d{2}-\d{2}$/.test(value),
    path,
    "invalid_date",
    `${path} 값은 YYYY-MM-DD 형식이어야 합니다.`,
  );
  const date = new Date(`${value}T00:00:00Z`);
  assertValid(
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value,
    path,
    "invalid_date",
    `${path} 값이 유효한 날짜가 아닙니다.`,
  );
  return date;
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addUtcDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function daysBetween(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / 86_400_000;
}
