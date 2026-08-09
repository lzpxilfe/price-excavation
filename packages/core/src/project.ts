import {
  DEFAULT_EQUIPMENT_PROFILE,
  DEFAULT_HAUL_ROUTE,
  DEFAULT_INVESTIGATION_INPUT,
  DEFAULT_SOIL_BATCH,
  DEFAULT_TRUCK_PROFILE,
  DEFAULT_WEATHER_POLICY,
} from "./defaults.ts";
import { RATE_SET_2026 } from "./rates-2026.ts";
import { PROJECT_SCHEMA_VERSION } from "./types.ts";
import type { ExcavationProject } from "./types.ts";
import { assertValid } from "./validation.ts";

export interface CreateDefaultProjectOptions {
  id?: string;
  name?: string;
  now?: Date | string;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function makeId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `pexc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createDefaultProject(options: CreateDefaultProjectOptions = {}): ExcavationProject {
  const now = options.now instanceof Date ? new Date(options.now) : new Date(options.now ?? Date.now());
  assertValid(Number.isFinite(now.getTime()), "now", "invalid_date", "프로젝트 기준시각이 유효하지 않습니다.");
  const timestamp = now.toISOString();
  const team = clone(DEFAULT_INVESTIGATION_INPUT.team);
  const investigation = clone(DEFAULT_INVESTIGATION_INPUT);
  investigation.team = team;
  investigation.rateSet = clone(RATE_SET_2026);
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: options.id ?? makeId(),
    name: options.name ?? "새 발굴 견적",
    createdAt: timestamp,
    updatedAt: timestamp,
    locale: "ko-KR",
    currency: "KRW",
    location: {
      address: "",
      externalLookupEnabled: false,
    },
    survey: {
      surfaces: [],
      boundary: null,
    },
    soilBatches: [clone(DEFAULT_SOIL_BATCH)],
    trucks: [clone(DEFAULT_TRUCK_PROFILE)],
    equipment: [clone(DEFAULT_EQUIPMENT_PROFILE)],
    route: clone(DEFAULT_HAUL_ROUTE),
    investigation,
    weatherPolicy: clone(DEFAULT_WEATHER_POLICY),
    weatherStartDate: timestamp.slice(0, 10),
    actualProjects: [],
    investigators: [],
    calibrations: [],
    rateSetSnapshot: clone(RATE_SET_2026),
    estimate: null,
    notices: [
      "계산 결과는 견적·일정 검토를 돕는 참고자료이며 법적 측량성과, 대형차 운행허가 또는 확정계약금액을 대신하지 않습니다.",
      "외부 조회는 사용자가 활성화할 때만 좌표를 전송하며 측량 CSV와 조사자 정보는 로컬에 둡니다.",
      "공식 대가, 표준 토공원가, 현장 시나리오는 이중계상 방지를 위해 별도 원장으로 보존합니다.",
    ],
  };
}
