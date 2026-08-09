"use client";

import {
  type ChangeEvent,
  type ReactNode,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  calculateCalibration,
  calculateHaul,
  calculateInvestigationEstimate,
  calculateWeatherSchedule,
  convertSoilVolume,
  createDefaultProject,
  DEFAULT_WEATHER_POLICY,
  parseBoundaryGeoJson,
  parseSurveyCsv,
} from "@/packages/core/src";
import type {
  ActualProject,
  CalibrationSnapshot,
  HaulCalculationResult,
  InvestigationEstimateResult,
  PexcProjectFile,
  RateSet,
  RateSourceMetadata,
  SoilVolumeResult,
  VolumeCalculationResult,
  WeatherObservation,
  WeatherScheduleResult,
} from "@/packages/core/src";
import {
  clearActiveProject,
  loadActiveProject,
  saveActiveProject,
} from "./lib/project-storage";
import {
  findPermitRegistryBenchmark,
  type PermitRegistryBenchmark,
} from "./lib/public-benchmark";
import { z } from "zod";
import asosStationRegistry from "@/data/weather-stations/asos-2026-08-10.json";

type StepId =
  | "location"
  | "survey"
  | "soil"
  | "equipment"
  | "route"
  | "investigation"
  | "team"
  | "weather"
  | "result"
  | "actual";

type SaveState = "loading" | "saved" | "saving" | "error";

interface SurveyFileBundle {
  topCsv: string;
  baseCsv: string;
  boundaryGeoJson: string;
}

interface TeamRole {
  id: string;
  label: string;
  count: number;
  dailyRate: number;
  personDays: number;
}

interface DailyLog {
  id: string;
  date: string;
  workType: string;
  quantity: number;
  people: number;
  equipmentHours: number;
  interruption: string;
}

interface WeatherObservationSource {
  stationId: string;
  stationName: string;
  stationLatitude: number;
  stationLongitude: number;
  siteLatitude: number;
  siteLongitude: number;
  distanceKm: number;
  startMonthDay: string;
  sourceYears: number[];
  queryStartDate: string;
  queryEndDate: string;
  registryVersion: string;
  asOfDate: string;
  fetchedAt: string;
}

interface ProjectDraft {
  schemaVersion: "1.0.0";
  id: string;
  updatedAt: string;
  name: string;
  rateSetSnapshot: RateSet;
  publicBenchmarkSnapshot: PermitRegistryBenchmark | null;
  location: {
    address: string;
    parcel: string;
    latitude: number;
    longitude: number;
    externalLookup: boolean;
    parcelReferenceGeoJson: string;
  };
  survey: {
    crs: string;
    verticalDatum: string;
    horizontalUnit: "m" | "ft" | "degree";
    verticalUnit: "m" | "ft";
    method: "surface" | "control" | "constant" | "manual";
    topFile: string;
    topPoints: number;
    baseFile: string;
    basePoints: number;
    boundaryFile: string;
    constantElevation: number;
    coverage: number;
    naturalVolume: number;
    numericalError: number;
    numericalErrorM3: number;
    fillVolumeM3: number;
    cutVolumeM3: number;
    netVolumeM3: number;
    requestedGridCellSizeM: number;
    gridCellSizeM: number;
    calculationMethod: "common_xy_tin" | "deterministic_grid" | "manual";
    confidence: "high" | "medium" | "low";
    formula: string;
    volumeWarnings: string[];
  };
  soil: {
    type: "보통토사" | "점성토" | "사질토" | "혼합토";
    inputState: "natural" | "loose" | "compacted";
    swellFactor: number;
    compactionFactor: number;
    wetDensity: number;
  };
  equipment: {
    excavatorName: string;
    bucketCapacity: number;
    productivity: number;
    excavatorStandardDayRate: number;
    dayRate: number;
    truckName: string;
    payloadTon: number;
    bedVolume: number;
    weightLoadRate: number;
    volumeLoadRate: number;
    truckCount: number;
    truckStandardDayRate: number;
    truckDayRate: number;
    targetDays: number;
    mode: "fleet" | "target";
    workMinutes: number;
    efficiency: number;
    cycle: {
      loading: number;
      entry: number;
      cover: number;
      wash: number;
      loadedTravel: number;
      unloading: number;
      emptyReturn: number;
      waiting: number;
    };
  };
  route: {
    destination: string;
    oneWayKm: number;
    loadedMinutes: number;
    returnMinutes: number;
    destinationLatitude: number;
    destinationLongitude: number;
    routeLookup: boolean;
    confirmed: boolean;
    roadWidth: string;
    surface: string;
    slope: string;
    accessNote: string;
  };
  investigation: {
    type: "trial" | "precision";
    area: number;
    siteType: string;
    siteFactorVariant: "high" | "low";
    terrain: string;
    condition: string;
    relicAmount: string;
    featureDensity: string;
    visibility: string;
    complexity: string;
    layers: number;
    earthworkOverlap: number;
    directExpenseRate: number;
    overheadRate: number;
    academicRate: number;
    vatIncluded: boolean;
  };
  team: {
    roles: TeamRole[];
    profileName: string;
    investigatorAlias: string;
    calibrationSamples: Array<{
      id: string;
      completedAt: string;
      investigationType: "trial" | "precision";
      standardDays: number;
      actualDays: number;
      qualityWeight: number;
      excluded: boolean;
      investigatorIds: string[];
      investigatorAlias: string;
      investigatorDays: number;
      areaM2: number;
      volumeM3: number;
      featureDensity: string;
      soilType: string;
      teamRoleCounts: Record<string, number>;
      totalPersonDays: number;
      equipmentDays: number;
      loadedTrips: number;
      calendarDays: number;
      weatherStoppedDays: number;
      otherStoppedDays: number;
      logs: DailyLog[];
    }>;
  };
  weather: {
    startDate: string;
    station: string;
    externalLookup: boolean;
    policyConfirmed: boolean;
    rainMm: number;
    feelsLikeC: number;
    minimumC: number;
    snowCm: number;
    gustMs: number;
    medianLostDays: number;
    p80LostDays: number;
    otherLostDays: number;
    equipmentStandbyRate: number;
    laborStandbyRate: number;
    observations: WeatherObservation[];
    observationSource: WeatherObservationSource | null;
    policySource: RateSourceMetadata;
  };
  actual: {
    completed: boolean;
    actualWorkDays: number;
    actualCalendarDays: number;
    actualVolume: number;
    actualTrips: number;
    weatherLostDays: number;
    otherLostDays: number;
    qualityWeight: number;
    excluded: boolean;
    investigatorAlias: string;
    investigatorDays: number;
    actualPersonDays: number;
    actualEquipmentDays: number;
    logs: DailyLog[];
  };
}

const MAX_PROJECT_FILE_BYTES = 32 * 1024 * 1024;
const MAX_EMBEDDED_SURVEY_CHARACTERS = 12 * 1024 * 1024;
const safeText = (maximum = 1_000) => z.string().max(maximum);
const finiteNumber = z.number().finite().min(-1_000_000_000_000).max(1_000_000_000_000);
const nonNegativeNumber = finiteNumber.min(0);
const safeDate = safeText(40).refine((value) => !Number.isNaN(Date.parse(value)), "유효한 날짜가 아닙니다.");

const rateSourceImportSchema = z.object({
  id: safeText(200),
  title: safeText(500),
  authority: safeText(200),
  noticeNumber: safeText(200),
  publishedOn: safeDate,
  effectiveFrom: safeDate,
  effectiveTo: safeDate.optional(),
  url: safeText(2_048),
  checksumSha256: safeText(128),
  status: z.enum(["draft", "reviewed", "published", "superseded"]),
  notes: z.array(safeText(1_000)).max(50),
});

const rateSetImportSchema = z.object({
  id: safeText(200),
  label: safeText(500),
  effectiveFrom: safeDate,
  effectiveTo: safeDate.optional(),
  currency: z.literal("KRW"),
  unit: z.literal("person_day"),
  region: z.literal("KR"),
  vatIncluded: z.literal(false),
  status: z.enum(["draft", "reviewed", "published", "superseded"]),
  investigatorDailyRatesKrw: z.object({
    director: nonNegativeNumber,
    supervisor: nonNegativeNumber,
    researcher: nonNegativeNumber,
    assistantResearcher: nonNegativeNumber,
    assistant: nonNegativeNumber,
  }),
  laborerDailyRateKrw: nonNegativeNumber,
  directExpenseRatios: z.object({
    trial: z.object({ min: nonNegativeNumber, max: nonNegativeNumber }),
    precision: z.object({ min: nonNegativeNumber, max: nonNegativeNumber }),
  }),
  overheadRatio: z.object({ min: nonNegativeNumber, max: nonNegativeNumber }),
  academicFeeRatio: z.object({ min: nonNegativeNumber, max: nonNegativeNumber }),
  sources: z.array(rateSourceImportSchema).min(1).max(50),
});

const teamRoleImportSchema = z.object({
  id: safeText(100),
  label: safeText(100),
  count: nonNegativeNumber,
  dailyRate: nonNegativeNumber,
  personDays: nonNegativeNumber,
});

const dailyLogImportSchema = z.object({
  id: safeText(200),
  date: safeDate,
  workType: safeText(200),
  quantity: nonNegativeNumber,
  people: nonNegativeNumber,
  equipmentHours: nonNegativeNumber,
  interruption: safeText(500),
});

const calibrationSampleImportSchema = z.object({
  id: safeText(200),
  completedAt: safeDate,
  investigationType: z.enum(["trial", "precision"]),
  standardDays: nonNegativeNumber,
  actualDays: nonNegativeNumber,
  qualityWeight: nonNegativeNumber,
  excluded: z.boolean(),
  investigatorIds: z.array(safeText(200)).max(50).default([]),
  investigatorAlias: safeText(200).default(""),
  investigatorDays: nonNegativeNumber.default(0),
  areaM2: nonNegativeNumber.default(0),
  volumeM3: nonNegativeNumber.default(0),
  featureDensity: safeText(100).default(""),
  soilType: safeText(100).default(""),
  teamRoleCounts: z.record(z.string().max(100), nonNegativeNumber).default({}),
  totalPersonDays: nonNegativeNumber.default(0),
  equipmentDays: nonNegativeNumber.default(0),
  loadedTrips: nonNegativeNumber.default(0),
  calendarDays: nonNegativeNumber.default(0),
  weatherStoppedDays: nonNegativeNumber.default(0),
  otherStoppedDays: nonNegativeNumber.default(0),
  logs: z.array(dailyLogImportSchema).max(5_000).default([]),
});

const weatherObservationImportSchema = z.object({
  date: safeDate,
  precipitationMm: finiteNumber.optional(),
  apparentTemperatureMaxC: finiteNumber.optional(),
  minimumTemperatureC: finiteNumber.optional(),
  newSnowCm: finiteNumber.optional(),
  maxInstantWindMps: finiteNumber.optional(),
});

const weatherObservationSourceImportSchema = z.object({
  stationId: safeText(20),
  stationName: safeText(200),
  stationLatitude: finiteNumber,
  stationLongitude: finiteNumber,
  siteLatitude: finiteNumber,
  siteLongitude: finiteNumber,
  distanceKm: nonNegativeNumber,
  startMonthDay: safeText(5).regex(/^\d{2}-\d{2}$/),
  sourceYears: z.array(z.number().int().min(1900).max(2200)).length(5),
  queryStartDate: safeDate,
  queryEndDate: safeDate,
  registryVersion: safeText(100),
  asOfDate: safeDate,
  fetchedAt: safeDate,
});

const publicBenchmarkImportSchema = z.object({
  benchmarkId: safeText(200),
  version: safeText(100),
  asOf: safeDate,
  investigationType: z.enum(["trial", "precision"]),
  areaBandId: safeText(100),
  areaBandLabel: safeText(200),
  n: z.number().int().min(30).max(1_000_000),
  registeredDurationDays: z.object({
    p20: nonNegativeNumber,
    p50: nonNegativeNumber,
    p80: nonNegativeNumber,
  }),
  elapsedCalendarDays: z.object({
    p20: nonNegativeNumber,
    p50: nonNegativeNumber,
    p80: nonNegativeNumber,
  }),
  sourceSnapshotDate: safeDate,
  sourceTitle: safeText(500),
  sourceUrl: safeText(2_048).url(),
  sourceChecksumSha256: safeText(64).regex(/^[a-f0-9]{64}$/),
  licenseLabel: safeText(200),
  licenseCheckedAt: safeDate,
});

// Import is deliberately stricter than the calculation UI. Nested fields are
// optional for safe 1.x migration, but any value that is present must have the
// expected primitive type and bounded size before normalization can see it.
const projectDraftImportSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  id: safeText(200),
  updatedAt: safeDate,
  name: safeText(500),
  rateSetSnapshot: rateSetImportSchema,
  publicBenchmarkSnapshot: publicBenchmarkImportSchema.nullable().optional(),
  location: z.object({
    address: safeText(1_000), parcel: safeText(1_000), latitude: finiteNumber,
    longitude: finiteNumber, externalLookup: z.boolean(), parcelReferenceGeoJson: safeText(2 * 1024 * 1024),
  }).partial(),
  survey: z.object({
    crs: safeText(100), verticalDatum: safeText(500),
    horizontalUnit: z.enum(["m", "ft", "degree"]), verticalUnit: z.enum(["m", "ft"]),
    method: z.enum(["surface", "control", "constant", "manual"]),
    topFile: safeText(1_000), topPoints: nonNegativeNumber, baseFile: safeText(1_000),
    basePoints: nonNegativeNumber, boundaryFile: safeText(1_000), constantElevation: finiteNumber,
    coverage: nonNegativeNumber, naturalVolume: nonNegativeNumber, numericalError: nonNegativeNumber,
    numericalErrorM3: nonNegativeNumber, fillVolumeM3: nonNegativeNumber, cutVolumeM3: nonNegativeNumber,
    netVolumeM3: finiteNumber, requestedGridCellSizeM: nonNegativeNumber, gridCellSizeM: nonNegativeNumber,
    calculationMethod: z.enum(["common_xy_tin", "deterministic_grid", "manual"]),
    confidence: z.enum(["high", "medium", "low"]), formula: safeText(2_000),
    volumeWarnings: z.array(safeText(2_000)).max(100),
  }).partial(),
  soil: z.object({
    type: z.enum(["보통토사", "점성토", "사질토", "혼합토"]),
    inputState: z.enum(["natural", "loose", "compacted"]),
    swellFactor: nonNegativeNumber, compactionFactor: nonNegativeNumber, wetDensity: nonNegativeNumber,
  }).partial(),
  equipment: z.object({
    excavatorName: safeText(500), bucketCapacity: nonNegativeNumber, productivity: nonNegativeNumber,
    excavatorStandardDayRate: nonNegativeNumber, dayRate: nonNegativeNumber, truckName: safeText(500),
    payloadTon: nonNegativeNumber, bedVolume: nonNegativeNumber, weightLoadRate: nonNegativeNumber,
    volumeLoadRate: nonNegativeNumber, truckCount: nonNegativeNumber, truckStandardDayRate: nonNegativeNumber,
    truckDayRate: nonNegativeNumber, targetDays: nonNegativeNumber, mode: z.enum(["fleet", "target"]),
    workMinutes: nonNegativeNumber, efficiency: nonNegativeNumber,
    cycle: z.object({
      loading: nonNegativeNumber, entry: nonNegativeNumber, cover: nonNegativeNumber,
      wash: nonNegativeNumber, loadedTravel: nonNegativeNumber, unloading: nonNegativeNumber,
      emptyReturn: nonNegativeNumber, waiting: nonNegativeNumber,
    }).partial(),
  }).partial(),
  route: z.object({
    destination: safeText(1_000), oneWayKm: nonNegativeNumber, loadedMinutes: nonNegativeNumber,
    returnMinutes: nonNegativeNumber, destinationLatitude: finiteNumber, destinationLongitude: finiteNumber,
    routeLookup: z.boolean(), confirmed: z.boolean(), roadWidth: safeText(200),
    surface: safeText(200), slope: safeText(200), accessNote: safeText(2_000),
  }).partial(),
  investigation: z.object({
    type: z.enum(["trial", "precision"]), area: nonNegativeNumber, siteType: safeText(200),
    siteFactorVariant: z.enum(["high", "low"]),
    terrain: safeText(200), condition: safeText(200), relicAmount: safeText(200),
    featureDensity: safeText(200), visibility: safeText(200), complexity: safeText(200),
    layers: nonNegativeNumber, earthworkOverlap: nonNegativeNumber, directExpenseRate: nonNegativeNumber,
    overheadRate: nonNegativeNumber, academicRate: nonNegativeNumber, vatIncluded: z.boolean(),
  }).partial(),
  team: z.object({
    roles: z.array(teamRoleImportSchema).max(20), profileName: safeText(500),
    investigatorAlias: safeText(200), calibrationSamples: z.array(calibrationSampleImportSchema).max(1_000),
  }).partial(),
  weather: z.object({
    startDate: safeDate, station: safeText(500), externalLookup: z.boolean(), policyConfirmed: z.boolean(),
    rainMm: finiteNumber, feelsLikeC: finiteNumber, minimumC: finiteNumber, snowCm: finiteNumber,
    gustMs: finiteNumber, medianLostDays: nonNegativeNumber, p80LostDays: nonNegativeNumber,
    otherLostDays: nonNegativeNumber, equipmentStandbyRate: nonNegativeNumber,
    laborStandbyRate: nonNegativeNumber, observations: z.array(weatherObservationImportSchema).max(2_500),
    observationSource: weatherObservationSourceImportSchema.nullable(),
    policySource: rateSourceImportSchema,
  }).partial(),
  actual: z.object({
    completed: z.boolean(), actualWorkDays: nonNegativeNumber, actualCalendarDays: nonNegativeNumber,
    actualVolume: nonNegativeNumber, actualTrips: nonNegativeNumber, weatherLostDays: nonNegativeNumber,
    otherLostDays: nonNegativeNumber, qualityWeight: nonNegativeNumber, excluded: z.boolean(),
    investigatorAlias: safeText(200), investigatorDays: nonNegativeNumber,
    actualPersonDays: nonNegativeNumber, actualEquipmentDays: nonNegativeNumber,
    logs: z.array(dailyLogImportSchema).max(5_000),
  }).partial(),
});

const surveyFileBundleImportSchema = z.object({
  topCsv: safeText(MAX_EMBEDDED_SURVEY_CHARACTERS),
  baseCsv: safeText(MAX_EMBEDDED_SURVEY_CHARACTERS),
  boundaryGeoJson: safeText(MAX_EMBEDDED_SURVEY_CHARACTERS),
});

const projectFileImportSchema = z.object({
  format: z.literal("price-excavation-project").optional(),
  schemaVersion: z.literal("1.0.0").optional(),
  project: projectDraftImportSchema,
  surveyFiles: surveyFileBundleImportSchema.optional(),
});

function decodeProjectPayload(value: unknown): { project: ProjectDraft; surveyFiles: SurveyFileBundle } | null {
  const wrapped = projectFileImportSchema.safeParse(value);
  if (wrapped.success) {
    return {
      project: normalizeProjectDraft(wrapped.data.project as ProjectDraft),
      surveyFiles: wrapped.data.surveyFiles ?? { topCsv: "", baseCsv: "", boundaryGeoJson: "" },
    };
  }
  const bare = projectDraftImportSchema.safeParse(value);
  return bare.success
    ? { project: normalizeProjectDraft(bare.data as ProjectDraft), surveyFiles: { topCsv: "", baseCsv: "", boundaryGeoJson: "" } }
    : null;
}

interface EstimateView {
  soil: SoilVolumeResult;
  haul: HaulCalculationResult;
  investigation: InvestigationEstimateResult;
  weatherSchedule: WeatherScheduleResult;
  calibration: CalibrationSnapshot;
  naturalVolume: number;
  looseVolume: number;
  compactedVolume: number;
  massTon: number;
  looseDensity: number;
  loadPerTrip: number;
  totalTrips: number;
  lastLoad: number;
  cycleMinutes: number;
  tripsPerTruckDay: number;
  truckDays: number;
  excavatorDays: number;
  earthworkDays: number;
  investigationDays: number;
  calibratedInvestigationDays: number;
  fieldDays: number;
  medianCalendarDays: number;
  p80CalendarDays: number;
  p80WeatherNonWorkDays: number;
  reportDays: number;
  personDays: number;
  directLabor: number;
  weeklyAllowance: number;
  directExpense: number;
  overhead: number;
  academic: number;
  officialSubtotal: number;
  standardEarthwork: number;
  fieldScenario: number;
  vat: number;
  bottleneck: "굴삭기" | "덤프";
}

const STEPS: Array<{
  id: StepId;
  short: string;
  title: string;
  description: string;
}> = [
  { id: "location", short: "위치", title: "현장 위치", description: "주소와 필지를 확인합니다." },
  { id: "survey", short: "측량", title: "측량면과 경계", description: "두 표면 사이의 체적을 계산합니다." },
  { id: "soil", short: "토질", title: "토질과 토량 환산", description: "자연·흐트러짐·다짐 상태를 구분합니다." },
  { id: "equipment", short: "장비", title: "장비와 덤프", description: "현장 장비와 운반 능력을 입력합니다." },
  { id: "route", short: "경로", title: "운반 경로", description: "사토장까지의 실운행 조건을 반영합니다." },
  { id: "investigation", short: "조사", title: "조사유형과 유적조건", description: "시굴·정밀발굴의 표준 공기를 산정합니다." },
  { id: "team", short: "팀", title: "팀 구성", description: "역할별 인원과 현장 경험을 반영합니다." },
  { id: "weather", short: "날씨", title: "날씨와 비작업일", description: "착수월의 현실적인 달력일을 봅니다." },
  { id: "result", short: "결과", title: "견적 결과", description: "서로 다른 세 원장을 나누어 확인합니다." },
  { id: "actual", short: "실적", title: "완료 실적", description: "실제 공기를 다음 견적에 연결합니다." },
];

const ProjectMap = lazy(() => import("./components/project-map"));

// Keep the server-rendered first frame deterministic. Once a project is edited
// its updatedAt becomes the live clock; completion events use the browser date.
const DATA_AS_OF_DATE = "2026-08-10";
const TODAY = DATA_AS_OF_DATE;
const DAY_MS = 86_400_000;
type AsosStation = (typeof asosStationRegistry.stations)[number];

function haversineDistanceKm(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const radians = (value: number) => value * Math.PI / 180;
  const latitudeDelta = radians(latitudeB - latitudeA);
  const longitudeDelta = radians(longitudeB - longitudeA);
  const sineLatitude = Math.sin(latitudeDelta / 2);
  const sineLongitude = Math.sin(longitudeDelta / 2);
  const chord = sineLatitude ** 2 +
    Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB)) * sineLongitude ** 2;
  return 6_371.0088 * 2 * Math.atan2(Math.sqrt(chord), Math.sqrt(1 - chord));
}

function nearestAsosStation(latitude: number, longitude: number): { station: AsosStation; distanceKm: number } {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < 32 || latitude > 39.5 || longitude < 124 || longitude > 132) {
    throw new Error("대한민국 현장 좌표를 확인해 주세요. ASOS 최근접 선택은 국내 범위에서만 지원합니다.");
  }
  const candidates = asosStationRegistry.stations.map((station) => ({
    station,
    distanceKm: haversineDistanceKm(latitude, longitude, station.latitude, station.longitude),
  }));
  const nearest = candidates.sort((left, right) => left.distanceKm - right.distanceKm)[0];
  if (!nearest) throw new Error("ASOS 관측소 레지스트리가 비어 있습니다.");
  return nearest;
}

function dateInScenarioYear(reference: Date, year: number): Date {
  const month = reference.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(reference.getUTCDate(), lastDay)));
}

function scenarioDateRange(reference: Date, sourceYear: number): { startDate: string; endDate: string } {
  const start = dateInScenarioYear(reference, sourceYear);
  const nextStart = dateInScenarioYear(reference, sourceYear + 1);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: new Date(nextStart.getTime() - DAY_MS).toISOString().slice(0, 10),
  };
}

function fiveLatestCompleteScenarioYears(reference: Date, asOfDate: string): number[] {
  const availableThrough = new Date(`${asOfDate}T00:00:00Z`);
  availableThrough.setUTCDate(availableThrough.getUTCDate() - 1);
  let latestSourceYear = availableThrough.getUTCFullYear();
  while (new Date(`${scenarioDateRange(reference, latestSourceYear).endDate}T00:00:00Z`) > availableThrough) {
    latestSourceYear -= 1;
  }
  return Array.from({ length: 5 }, (_, index) => latestSourceYear - 4 + index);
}

function makeDefaultProject(fresh = false): ProjectDraft {
  const coreProject = createDefaultProject({
    ...(fresh ? {} : { id: "local-draft" }),
    name: "합성 예시 A · 시굴조사",
    now: fresh ? new Date() : `${DATA_AS_OF_DATE}T00:00:00+09:00`,
  });
  const rates = coreProject.rateSetSnapshot;

  return {
    schemaVersion: "1.0.0",
    id: coreProject.id,
    updatedAt: coreProject.updatedAt,
    name: coreProject.name,
    rateSetSnapshot: JSON.parse(JSON.stringify(coreProject.rateSetSnapshot)) as RateSet,
    publicBenchmarkSnapshot: findPermitRegistryBenchmark("trial", 1000),
    location: {
      address: "합성 예시 좌표 · 실제 현장 아님",
      parcel: "참조 경계 미입력",
      latitude: 36.35,
      longitude: 127.38,
      externalLookup: false,
      parcelReferenceGeoJson: "",
    },
    survey: {
      crs: "EPSG:5186",
      verticalDatum: "인천만 평균해수면 (인천 datum)",
      horizontalUnit: "m",
    verticalUnit: "m",
      method: "manual",
      topFile: "",
      topPoints: 0,
      baseFile: "",
      basePoints: 0,
      boundaryFile: "",
      constantElevation: 25,
      coverage: 100,
      naturalVolume: 1000,
      numericalError: 1.8,
      numericalErrorM3: 18,
      fillVolumeM3: 1000,
      cutVolumeM3: 0,
      netVolumeM3: 1000,
      requestedGridCellSizeM: 0,
      gridCellSizeM: 0,
      calculationMethod: "manual",
      confidence: "low",
      formula: "사용자가 확인한 입력 체적",
      volumeWarnings: ["수동 체적은 측량 표면·경계 검증을 거치지 않았습니다."],
    },
    soil: {
      type: "보통토사",
      inputState: "natural",
      swellFactor: 1.25,
      compactionFactor: 0.9,
      wetDensity: 1.8,
    },
    equipment: {
      excavatorName: "굴삭기 0.8㎥",
      bucketCapacity: 0.8,
      productivity: 180,
      excavatorStandardDayRate: 720000,
      dayRate: 780000,
      truckName: "덤프트럭 15t",
      payloadTon: 15,
      bedVolume: 12,
      weightLoadRate: 1,
      volumeLoadRate: 0.95,
      truckCount: 4,
      truckStandardDayRate: 650000,
      truckDayRate: 720000,
      targetDays: 8,
      mode: "fleet",
      workMinutes: 480,
      efficiency: 0.82,
      cycle: {
        loading: 8,
        entry: 4,
        cover: 3,
        wash: 4,
        loadedTravel: 28,
        unloading: 6,
        emptyReturn: 23,
        waiting: 6,
      },
    },
    route: {
      destination: "수동 입력 사토장 (합성)",
      oneWayKm: 10,
      loadedMinutes: 28,
      returnMinutes: 23,
      destinationLatitude: 36.27,
      destinationLongitude: 127.25,
      routeLookup: false,
      confirmed: false,
      roadWidth: "4m 이상",
      surface: "포장",
      slope: "완만",
      accessNote: "합성 예시 · 실제 진입조건은 현장에서 확인",
    },
    investigation: {
      type: "trial",
      area: 1000,
      siteType: "생활유적",
      siteFactorVariant: "low",
      terrain: "평지",
      condition: "양호",
      relicAmount: "보통",
      featureDensity: "낮음",
      visibility: "양호",
      complexity: "낮음",
      layers: 1,
      earthworkOverlap: 0,
      directExpenseRate: 2.1,
      overheadRate: 1.05,
      academicRate: 0.25,
      vatIncluded: false,
    },
    team: {
      profileName: "합성 팀 A",
      investigatorAlias: "조사원 가람",
      roles: [
        { id: "director", label: "조사단장", count: 1, dailyRate: rates.investigatorDailyRatesKrw.director, personDays: 0 },
        { id: "supervisor", label: "책임조사원", count: 1, dailyRate: rates.investigatorDailyRatesKrw.supervisor, personDays: 0 },
        { id: "researcher", label: "조사원", count: 2, dailyRate: rates.investigatorDailyRatesKrw.researcher, personDays: 0 },
        { id: "assistantResearcher", label: "준조사원", count: 2, dailyRate: rates.investigatorDailyRatesKrw.assistantResearcher, personDays: 0 },
        { id: "assistant", label: "보조원", count: 2, dailyRate: rates.investigatorDailyRatesKrw.assistant, personDays: 0 },
        { id: "laborer", label: "보통인부", count: 4, dailyRate: rates.laborerDailyRateKrw, personDays: 0 },
      ],
      calibrationSamples: [],
    },
    weather: {
      startDate: "2026-09-07",
      station: "대전 ASOS (133)",
      externalLookup: false,
      policyConfirmed: false,
      rainMm: 5,
      feelsLikeC: 33,
      minimumC: 0,
      snowCm: 5,
      gustMs: 15,
      medianLostDays: 3,
      p80LostDays: 5,
      otherLostDays: 1,
      equipmentStandbyRate: 0.5,
      laborStandbyRate: 0.7,
      observations: [],
      observationSource: null,
      policySource: JSON.parse(JSON.stringify(coreProject.weatherPolicy.source)) as RateSourceMetadata,
    },
    actual: {
      completed: false,
      actualWorkDays: 10,
      actualCalendarDays: 16,
      actualVolume: 1000,
      actualTrips: 120,
      weatherLostDays: 3,
      otherLostDays: 1,
      qualityWeight: 1,
      excluded: false,
      investigatorAlias: "조사원 가람",
      investigatorDays: 8,
      actualPersonDays: 80,
      actualEquipmentDays: 8,
      logs: [
        {
          id: "sample-log-1",
          date: TODAY,
          workType: "표토 제거",
          quantity: 180,
          people: 8,
          equipmentHours: 8,
          interruption: "없음",
        },
      ],
    },
  };
}

const LEGACY_DEMO_FINGERPRINTS = new Set([2557109474, 508404017]);

function legacyDemoFingerprint(value: Partial<ProjectDraft>): number {
  const location = value.location as Partial<ProjectDraft["location"]> | undefined;
  const identity = [
    value.name ?? "",
    location?.address ?? "",
    location?.parcel ?? "",
    String(location?.latitude ?? ""),
    String(location?.longitude ?? ""),
  ].join("\u001f");
  let hash = 2166136261;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeProjectDraft(value: ProjectDraft): ProjectDraft {
  const fallback = makeDefaultProject();
  const raw = value as Partial<ProjectDraft>;
  const rawSurvey = (raw.survey ?? {}) as Partial<ProjectDraft["survey"]> & { verticalUnit?: string };
  const rawTeam = (raw.team ?? {}) as Partial<ProjectDraft["team"]>;
  const rawRoles = rawTeam.roles ?? [];
  const legacyRoleIds: Record<string, string> = { supervisor: "manager", assistantResearcher: "junior" };
  const rateSetSnapshot = raw.rateSetSnapshot
    ? (JSON.parse(JSON.stringify(raw.rateSetSnapshot)) as RateSet)
    : fallback.rateSetSnapshot;
  const roleRate = (id: string): number => id === "laborer"
    ? rateSetSnapshot.laborerDailyRateKrw
    : rateSetSnapshot.investigatorDailyRatesKrw[id as keyof RateSet["investigatorDailyRatesKrw"]];
  const roles = fallback.team.roles.map((role) => {
    const saved = rawRoles.find((candidate) =>
      candidate.id === role.id || candidate.id === legacyRoleIds[role.id],
    );
    return {
      ...role,
      ...saved,
      id: role.id,
      label: role.label,
      dailyRate: roleRate(role.id),
      count: Math.max(1, Math.round(saved?.count ?? role.count)),
    };
  });
  const calibrationSamples = (rawTeam.calibrationSamples ?? []).map((sample) => ({
    ...sample,
    investigatorIds: sample.investigatorIds ?? [],
    investigatorAlias: sample.investigatorAlias ?? "",
    investigatorDays: sample.investigatorDays ?? 0,
    areaM2: sample.areaM2 ?? 0,
    volumeM3: sample.volumeM3 ?? 0,
    featureDensity: sample.featureDensity ?? "",
    soilType: sample.soilType ?? "",
    teamRoleCounts: sample.teamRoleCounts ?? {},
    totalPersonDays: sample.totalPersonDays ?? 0,
    equipmentDays: sample.equipmentDays ?? 0,
    loadedTrips: sample.loadedTrips ?? 0,
    calendarDays: sample.calendarDays ?? 0,
    weatherStoppedDays: sample.weatherStoppedDays ?? 0,
    otherStoppedDays: sample.otherStoppedDays ?? 0,
    logs: sample.logs ?? [],
  }));
  const crs = rawSurvey.crs ?? fallback.survey.crs;
  const horizontalUnit = crs === "EPSG:4326"
    ? "degree"
    : rawSurvey.horizontalUnit === "degree"
      ? "m"
      : rawSurvey.horizontalUnit ?? fallback.survey.horizontalUnit;
  const verticalUnit = rawSurvey.verticalUnit === "ft" ? "ft" : "m";
  const rawActual = (raw.actual ?? {}) as Partial<ProjectDraft["actual"]>;
  const rawInvestigation = (raw.investigation ?? {}) as Partial<ProjectDraft["investigation"]>;
  const migratedSiteType = rawInvestigation.siteType === "분묘유적"
    ? "토광묘"
    : rawInvestigation.siteType;
  const investigation = {
    ...fallback.investigation,
    ...rawInvestigation,
    ...(migratedSiteType ? { siteType: migratedSiteType } : {}),
    siteFactorVariant: rawInvestigation.siteFactorVariant ?? "low",
  } as ProjectDraft["investigation"];
  const currentPublicBenchmark = findPermitRegistryBenchmark(investigation.type, investigation.area);
  const publicBenchmarkSnapshot = raw.publicBenchmarkSnapshot && currentPublicBenchmark &&
      raw.publicBenchmarkSnapshot.investigationType === currentPublicBenchmark.investigationType &&
      raw.publicBenchmarkSnapshot.areaBandId === currentPublicBenchmark.areaBandId
    ? raw.publicBenchmarkSnapshot
    : currentPublicBenchmark;
  if (raw.id === "local-draft" && LEGACY_DEMO_FINGERPRINTS.has(legacyDemoFingerprint(raw))) {
    return {
      ...fallback,
      team: { ...fallback.team, calibrationSamples },
    };
  }
  return {
    ...fallback,
    ...raw,
    rateSetSnapshot,
    publicBenchmarkSnapshot,
    location: { ...fallback.location, ...(raw.location ?? {}) },
    survey: { ...fallback.survey, ...rawSurvey, crs, horizontalUnit, verticalUnit },
    soil: { ...fallback.soil, ...(raw.soil ?? {}) },
    equipment: { ...fallback.equipment, ...(raw.equipment ?? {}), cycle: { ...fallback.equipment.cycle, ...(raw.equipment?.cycle ?? {}) } },
    route: { ...fallback.route, ...(raw.route ?? {}) },
    investigation,
    team: { ...fallback.team, ...rawTeam, roles, calibrationSamples },
    weather: {
      ...fallback.weather,
      ...(raw.weather ?? {}),
      observations: raw.weather?.observations ?? [],
      observationSource: raw.weather?.observationSource ?? null,
      policySource: raw.weather?.policySource ?? fallback.weather.policySource,
    },
    actual: { ...fallback.actual, ...rawActual, logs: rawActual.logs ?? [] },
  };
}

function weatherObservationSourceIsCurrent(project: ProjectDraft): boolean {
  const source = project.weather.observationSource;
  if (!source || !project.weather.observations.length) return false;
  return (
    project.weather.station.includes(`(${source.stationId})`) &&
    source.startMonthDay === project.weather.startDate.slice(5) &&
    Math.abs(source.siteLatitude - project.location.latitude) < 1e-7 &&
    Math.abs(source.siteLongitude - project.location.longitude) < 1e-7
  );
}

function calculateView(project: ProjectDraft): EstimateView {
  const soil = convertSoilVolume({
    id: "soil-active",
    name: project.soil.type,
    soilType: project.soil.type,
    volumeM3: Math.max(0, project.survey.naturalVolume),
    state: project.soil.inputState,
    looseFactorL: Math.max(0.01, project.soil.swellFactor),
    compactionFactorC: Math.max(0.01, project.soil.compactionFactor),
    naturalWetDensityTonnesPerM3: Math.max(0.01, project.soil.wetDensity),
  });

  const workingHours = Math.max(1, project.equipment.workMinutes) / 60;
  const equipmentEfficiency = Math.min(1, Math.max(0.01, project.equipment.efficiency));
  const requestedTargetDays = project.equipment.mode === "target"
    ? Math.max(1, Math.round(project.equipment.targetDays))
    : undefined;
  const calculateHaulScenario = (fleetSize: number, targetDays?: number) => calculateHaul({
    looseVolumeM3: soil.looseVolumeM3,
    looseDensityTonnesPerM3: soil.looseDensityTonnesPerM3,
    truck: {
      id: "truck-active",
      name: project.equipment.truckName,
      payloadTonnes: Math.max(0.01, project.equipment.payloadTon),
      bedVolumeM3: Math.max(0.01, project.equipment.bedVolume),
      weightLoadFactor: Math.min(1, Math.max(0.01, project.equipment.weightLoadRate)),
      volumeLoadFactor: Math.min(1, Math.max(0.01, project.equipment.volumeLoadRate)),
      fleetSize,
      standardDailyRateKrw: Math.max(0, project.equipment.truckStandardDayRate),
      actualDailyRateKrw: Math.max(0, project.equipment.truckDayRate),
      turningSpaceConfirmed: project.route.confirmed,
    },
    route: {
      oneWayDistanceKm: Math.max(0, project.route.oneWayKm),
      loadMinutes: Math.max(0.01, project.equipment.cycle.loading),
      siteEntryMinutes: Math.max(0, project.equipment.cycle.entry),
      coverMinutes: Math.max(0, project.equipment.cycle.cover),
      washMinutes: Math.max(0, project.equipment.cycle.wash),
      loadedTravelMinutes: Math.max(0, project.equipment.cycle.loadedTravel),
      dumpMinutes: Math.max(0, project.equipment.cycle.unloading),
      emptyReturnMinutes: Math.max(0, project.equipment.cycle.emptyReturn),
      queueMinutes: Math.max(0, project.equipment.cycle.waiting),
      source: project.route.routeLookup ? "kakao_car_reference" : "manual",
      heavyTruckConfirmed: project.route.confirmed,
    },
    equipment: {
      id: "excavator-active",
      name: project.equipment.excavatorName,
      bucketVolumeM3: Math.max(0.01, project.equipment.bucketCapacity),
      productionM3PerHour: Math.max(0.01, project.equipment.productivity) / workingHours / equipmentEfficiency,
      efficiency: equipmentEfficiency,
      standardDailyRateKrw: Math.max(0, project.equipment.excavatorStandardDayRate),
      actualDailyRateKrw: Math.max(0, project.equipment.dayRate),
    },
    workMinutesPerDay: Math.max(1, project.equipment.workMinutes),
    operatingEfficiency: equipmentEfficiency,
    fleetSize,
    targetDays,
  });
  // Size first, then apply the selected target fleet to every downstream
  // duration and cost. The configured fleet remains the source in fleet mode.
  const sizing = requestedTargetDays === undefined
    ? null
    : calculateHaulScenario(1, requestedTargetDays);
  const selectedFleetSize = sizing?.requiredFleetForTarget
    ?? Math.max(1, Math.round(project.equipment.truckCount));
  const haul = calculateHaulScenario(selectedFleetSize, requestedTargetDays);

  const teamId = "local-team";
  const actualProjects: ActualProject[] = project.team.calibrationSamples.map((sample) => ({
    id: sample.id,
    name: `${project.team.profileName} 완료사례`,
    investigationType: sample.investigationType,
    completedAt: sample.completedAt,
    teamId,
    areaM2: sample.areaM2 || project.investigation.area,
    standardFieldDays: sample.standardDays,
    actualFieldDays: sample.actualDays,
    investigatorIds: sample.investigatorIds,
    volumeM3: sample.volumeM3,
    featureDensity: sample.featureDensity === "높음" ? 1 : sample.featureDensity === "보통" ? .5 : sample.featureDensity ? .25 : undefined,
    soilType: sample.soilType || undefined,
    equipmentDays: sample.equipmentDays,
    loadedTrips: sample.loadedTrips,
    weatherStoppedDays: sample.weatherStoppedDays,
    otherStoppedDays: sample.otherStoppedDays,
    logs: sample.logs.map((log) => ({
      date: log.date,
      movedVolumeM3: log.quantity,
      equipmentHours: log.equipmentHours,
      weatherStopped: /기상|눈|비|바람/.test(log.interruption),
      ...(log.interruption && log.interruption !== "없음" ? { otherStopReason: log.interruption } : {}),
    })),
    qualityWeight: sample.qualityWeight,
    excluded: sample.excluded,
  }));
  const calibration = calculateCalibration({
    actualProjects,
    investigationType: project.investigation.type,
    teamId,
    investigatorId: project.team.investigatorAlias.trim() ? investigatorIdFromAlias(project.team.investigatorAlias) : undefined,
    asOfDate: TODAY,
  });
  const roleCounts = Object.fromEntries(
    project.team.roles.map((role) => [role.id, Math.max(1, Math.round(role.count))]),
  ) as Record<"director" | "supervisor" | "researcher" | "assistantResearcher" | "assistant" | "laborer", number>;
  const siteTypeMap: Record<string, "living" | "production" | "architecture" | "fortress" | "paleolithic" | "tomb_stone" | "tomb_pit" | "cultivation" | "other"> = {
    생활유적: "living",
    생산유적: "production",
    "석실·석곽분": "tomb_stone",
    토광묘: "tomb_pit",
    분묘유적: "tomb_pit",
    복합유적: "other",
  };
  const level = (value: string): "high" | "medium" | "low" => value === "높음" || value === "많음" ? "high" : value === "보통" ? "medium" : "low";
  const expenseRange = project.rateSetSnapshot.directExpenseRatios[project.investigation.type];
  const investigation = calculateInvestigationEstimate({
    investigationType: project.investigation.type,
    areaM2: Math.max(1, project.investigation.area),
    conditions: {
      terrain: project.investigation.terrain === "산지" ? "mountain" : "flat",
      surveyConditions: project.investigation.condition === "불량" ? "poor" : "good",
      siteType: siteTypeMap[project.investigation.siteType] ?? "other",
      soilDifficulty: project.soil.type === "점성토" || project.soil.type === "혼합토" ? "difficult" : "easy",
      findsLevel: level(project.investigation.relicAmount),
      featureDensity: level(project.investigation.featureDensity),
      identificationDifficulty: project.investigation.visibility === "어려움" ? "difficult" : "easy",
      featureComplexity: project.investigation.complexity === "높음" ? "difficult" : "easy",
      layers: Math.min(3, Math.max(1, Math.round(project.investigation.layers))) as 1 | 2 | 3,
      siteFactorVariant: project.investigation.siteFactorVariant,
    },
    team: { id: teamId, name: project.team.profileName, roleCounts },
    rateSet: project.rateSetSnapshot,
    directExpenseMode: "ratio",
    selectedDirectExpenseRatio: Math.min(expenseRange.max, Math.max(expenseRange.min, project.investigation.directExpenseRate)),
    selectedOverheadRatio: Math.min(project.rateSetSnapshot.overheadRatio.max, Math.max(project.rateSetSnapshot.overheadRatio.min, project.investigation.overheadRate)),
    selectedAcademicFeeRatio: Math.min(project.rateSetSnapshot.academicFeeRatio.max, Math.max(project.rateSetSnapshot.academicFeeRatio.min, project.investigation.academicRate)),
    vatRate: 0.1,
    earthworkDays: haul.estimatedDays,
    overlapRate: Math.min(0.5, Math.max(0, project.investigation.earthworkOverlap)),
    overlapConfirmed: project.investigation.earthworkOverlap > 0,
    productivityFactor: calibration.combinedFactor,
  });

  const dailyTeamCost = project.team.roles.reduce(
    (sum, role) => sum + Math.max(0, role.count) * Math.max(0, role.dailyRate),
    0,
  );
  const standbyCostPerDay =
    (project.equipment.dayRate + project.equipment.truckDayRate * haul.fleetSize) * project.weather.equipmentStandbyRate +
    dailyTeamCost * project.weather.laborStandbyRate;
  const manualWeatherRate = Math.min(0.9, Math.max(0, project.weather.medianLostDays / 22));
  const manualP80Rate = Math.min(0.9, Math.max(0, project.weather.p80LostDays / 22));
  const policy = {
    id: "earthwork-reference-2026",
    name: "토공사 비작업일 참고 템플릿",
    precipitationThresholdMm: project.weather.rainMm,
    apparentTemperatureThresholdC: project.weather.feelsLikeC,
    minimumTemperatureThresholdC: project.weather.minimumC,
    newSnowThresholdCm: project.weather.snowCm,
    maxInstantWindThresholdMps: project.weather.gustMs,
    workingWeekdays: [1, 2, 3, 4, 5],
    historyYears: 5,
    legalRate: false as const,
    confirmedByUser: project.weather.policyConfirmed,
    source: project.weather.policySource ?? DEFAULT_WEATHER_POLICY.source,
  };
  const weatherStartDate = /^\d{4}-\d{2}-\d{2}$/.test(project.weather.startDate)
    ? project.weather.startDate
    : TODAY;
  const weatherAsOfDate = project.weather.observationSource?.asOfDate ?? TODAY;
  // A station, site coordinate, or start-month change invalidates historical
  // rows even before the UI state-clearing effect has had a chance to run.
  const currentWeatherObservations = weatherObservationSourceIsCurrent(project)
    ? project.weather.observations
    : undefined;
  const weatherSchedule = calculateWeatherSchedule({
    startDate: weatherStartDate,
    fieldWorkDays: investigation.combinedOnSiteDays,
    observations: currentWeatherObservations,
    policy,
    // The core ignores this fallback when five complete historical years are
    // available and uses it only if uploaded/API observations are incomplete.
    manualWeatherNonWorkRate: manualWeatherRate,
    standbyCostKrwPerWeatherDay: standbyCostPerDay,
    otherNonWorkDates: [],
    asOfDate: weatherAsOfDate,
  });
  const conservativeWeather = calculateWeatherSchedule({
    startDate: weatherStartDate,
    fieldWorkDays: investigation.combinedOnSiteDays,
    observations: currentWeatherObservations,
    policy,
    manualWeatherNonWorkRate: manualP80Rate,
    standbyCostKrwPerWeatherDay: standbyCostPerDay,
    otherNonWorkDates: [],
    asOfDate: weatherAsOfDate,
  });

  const weeklyAllowance = investigation.official.rolePersonDays.reduce(
    (sum, role) => role.role === "laborer"
      ? sum
      : sum + (role.fieldWeeklyHolidayDays + role.reportWeeklyHolidayDays) * role.dailyRateKrw,
    0,
  );
  const personDays = investigation.official.rolePersonDays.reduce(
    (sum, role) => sum + role.fieldDays + role.fieldWeeklyHolidayDays + role.reportDays + role.reportWeeklyHolidayDays,
    0,
  );
  const selectedSubtotal = investigation.official.subtotalExcludingVatKrw.selected;
  const fieldScenario = haul.scenarioCostKrw + investigation.official.directLaborKrw + weatherSchedule.standbyCostKrw.median;

  return {
    soil,
    haul,
    investigation,
    weatherSchedule,
    calibration,
    naturalVolume: soil.naturalVolumeM3,
    looseVolume: soil.looseVolumeM3,
    compactedVolume: soil.compactedVolumeM3,
    massTon: soil.massTonnes,
    looseDensity: soil.looseDensityTonnesPerM3,
    loadPerTrip: haul.loadPerTripM3,
    totalTrips: haul.totalLoadedTrips,
    lastLoad: haul.lastTripLoadM3,
    cycleMinutes: haul.cycleMinutes,
    tripsPerTruckDay: haul.tripsPerTruckDay,
    truckDays: haul.vehicleOnlyDays,
    excavatorDays: haul.equipmentCapacityM3PerDay ? Math.ceil(soil.looseVolumeM3 / haul.equipmentCapacityM3PerDay) : haul.estimatedDays,
    earthworkDays: haul.estimatedDays,
    investigationDays: investigation.standardFieldDays,
    calibratedInvestigationDays: investigation.personalizedFieldDays,
    fieldDays: investigation.combinedOnSiteDays,
    medianCalendarDays: weatherSchedule.medianCalendarDays + project.weather.otherLostDays,
    p80CalendarDays: conservativeWeather.p80CalendarDays + project.weather.otherLostDays,
    p80WeatherNonWorkDays: conservativeWeather.p80WeatherNonWorkDays,
    reportDays: investigation.reportWorkDays,
    personDays,
    directLabor: Math.max(0, investigation.official.directLaborKrw - weeklyAllowance),
    weeklyAllowance,
    directExpense: investigation.official.directExpenseKrw.selected,
    overhead: investigation.official.overheadKrw.selected,
    academic: investigation.official.academicFeeKrw.selected,
    officialSubtotal: selectedSubtotal,
    standardEarthwork: haul.standardCostKrw,
    fieldScenario,
    vat: investigation.official.vatKrw.selected,
    bottleneck: haul.bottleneck === "equipment" ? "굴삭기" : "덤프",
  };
}

function formatNumber(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits }).format(value);
}

function investigatorIdFromAlias(alias: string): string {
  const normalized = alias.trim().normalize("NFKC").toLocaleLowerCase("ko-KR");
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `investigator-${(hash >>> 0).toString(36)}`;
}

function todayInKorea(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatCurrency(value: number): string {
  if (value >= 100000000) return `${formatNumber(value / 100000000, 1)}억원`;
  if (value >= 10000) return `${formatNumber(value / 10000, 0)}만원`;
  return `${formatNumber(value, 0)}원`;
}

function downloadFile(name: string, body: string, type: string): void {
  const blob = new Blob([body], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function escapeCsv(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export default function CalculatorApp() {
  const [project, setProject] = useState<ProjectDraft>(() => makeDefaultProject());
  const [activeStep, setActiveStep] = useState<StepId>("location");
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const [toast, setToast] = useState("");
  const [mobileStepsOpen, setMobileStepsOpen] = useState(false);
  const [surveyBusy, setSurveyBusy] = useState(false);
  const [surveyProgress, setSurveyProgress] = useState(0);
  const [surveyProgressLabel, setSurveyProgressLabel] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [geocodePreview, setGeocodePreview] = useState<null | {
    address: string;
    parcel: string;
    latitude: number;
    longitude: number;
  }>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const mainPanelRef = useRef<HTMLElement>(null);
  const projectLoadedRef = useRef(false);
  const surveyFiles = useRef<{ topCsv: string; baseCsv: string; boundaryGeoJson: string }>({
    topCsv: "",
    baseCsv: "",
    boundaryGeoJson: "",
  });
  const volumeWorkerRef = useRef<Worker | null>(null);

  const calculation = useMemo(() => {
    try {
      return { estimate: calculateView(project), error: "" };
    } catch (error) {
      return {
        estimate: calculateView(makeDefaultProject()),
        error: error instanceof Error ? error.message : "입력값을 계산할 수 없습니다.",
      };
    }
  }, [project]);
  const estimate = calculation.estimate;
  const activeIndex = STEPS.findIndex((step) => step.id === activeStep);
  const active = STEPS[activeIndex];

  useEffect(() => {
    let cancelled = false;
    loadActiveProject<unknown>()
      .then((saved) => {
        if (!cancelled && saved) {
          const decoded = decodeProjectPayload(saved);
          if (!decoded) throw new Error("저장된 프로젝트가 손상되었거나 지원하지 않는 형식입니다.");
          setProject(decoded.project);
          surveyFiles.current = decoded.surveyFiles;
        }
        if (!cancelled) {
          projectLoadedRef.current = true;
          setSaveState("saved");
        }
      })
      .catch(() => {
        if (cancelled) return;
        // Keep the invalid record untouched for manual recovery, but allow the
        // safe in-memory default to replace it after the user's next edit.
        projectLoadedRef.current = true;
        setSaveState("error");
        setToast("저장된 프로젝트를 안전하게 불러오지 못해 기본값으로 시작합니다.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!projectLoadedRef.current) return;
    const timer = window.setTimeout(() => {
      setSaveState("saving");
      saveActiveProject({
        project: { ...project, updatedAt: new Date().toISOString() },
        surveyFiles: surveyFiles.current,
      })
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("error"));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [project]);

  useEffect(() => {
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    return () => volumeWorkerRef.current?.terminate();
  }, []);

  function updateProjectName(name: string): void {
    setProject((current) => ({ ...current, name, updatedAt: new Date().toISOString() }));
  }

  function updateSection<K extends keyof ProjectDraft>(section: K, patch: Partial<ProjectDraft[K]>): void {
    setProject((current) => {
      const nextSection = { ...(current[section] as object), ...patch } as ProjectDraft[K];
      const next = {
        ...current,
        [section]: nextSection,
        updatedAt: new Date().toISOString(),
      } as ProjectDraft;
      if (section === "investigation") {
        const investigation = nextSection as ProjectDraft["investigation"];
        next.publicBenchmarkSnapshot = findPermitRegistryBenchmark(
          investigation.type,
          investigation.area,
        );
      }
      return next;
    });
  }

  function updateLocationAndInvalidateWeather(patch: Partial<ProjectDraft["location"]>): void {
    setProject((current) => ({
      ...current,
      location: { ...current.location, ...patch },
      weather: { ...current.weather, observations: [], observationSource: null },
      updatedAt: new Date().toISOString(),
    }));
  }

  function setStep(id: StepId): void {
    setActiveStep(id);
    setMobileStepsOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
    window.requestAnimationFrame(() => mainPanelRef.current?.focus());
  }

  function moveStep(direction: -1 | 1): void {
    const next = Math.min(STEPS.length - 1, Math.max(0, activeIndex + direction));
    setStep(STEPS[next].id);
  }

  async function handleSurveyFile(kind: "top" | "base", event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    setSurveyBusy(true);
    try {
      const csv = await file.text();
      const parsed = parseSurveyCsv(csv, {
          role: kind === "top" ? "top" : project.survey.method === "control" ? "base_control" : "base",
          crs: project.survey.crs,
          horizontalUnit: project.survey.horizontalUnit,
          verticalUnit: project.survey.verticalUnit,
          verticalDatum: project.survey.verticalDatum,
      });
      surveyFiles.current[kind === "top" ? "topCsv" : "baseCsv"] = csv;
      const points = parsed.points.length;
      updateSection("survey", {
        [`${kind}File`]: file.name,
        [`${kind}Points`]: Math.max(0, points),
        method: project.survey.method === "manual" ? "surface" : project.survey.method,
      } as Partial<ProjectDraft["survey"]>);
      setToast(`${kind === "top" ? "상부면" : "기준면"} ${formatNumber(points, 0)}점을 불러왔습니다.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "CSV 형식을 확인해 주세요.");
    } finally {
      setSurveyBusy(false);
      event.target.value = "";
    }
  }

  async function handleBoundaryFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    setSurveyBusy(true);
    try {
      const text = await file.text();
      const boundary = parseBoundaryGeoJson(text, {
        crs: project.survey.crs,
        horizontalUnit: project.survey.horizontalUnit,
        source: "survey",
      });
      surveyFiles.current.boundaryGeoJson = text;
      updateSection("survey", { boundaryFile: file.name });
      setToast(`계산 경계 ${formatNumber(boundary.areaM2)}㎡를 확인했습니다.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "GeoJSON 경계를 확인해 주세요.");
    } finally {
      setSurveyBusy(false);
      event.target.value = "";
    }
  }

  async function runVolumeCalculation(): Promise<void> {
    if (!surveyFiles.current.topCsv || (project.survey.method !== "constant" && !surveyFiles.current.baseCsv) || !surveyFiles.current.boundaryGeoJson) {
      setToast(project.survey.method === "constant" ? "상부면 CSV와 계산 경계 GeoJSON을 모두 넣어 주세요." : "상부면·기준면 CSV와 계산 경계 GeoJSON을 모두 넣어 주세요.");
      return;
    }
    volumeWorkerRef.current?.terminate();
    setSurveyBusy(true);
    setSurveyProgress(5);
    setSurveyProgressLabel("계산 작업을 준비하는 중");
    const worker = new Worker(new URL("./workers/volume.worker.ts", import.meta.url), { type: "module" });
    volumeWorkerRef.current = worker;
    worker.onmessage = (event: MessageEvent<{
      type: "progress" | "complete" | "error";
      progress?: number;
      message?: string;
      result?: VolumeCalculationResult;
      pointCounts?: { top: number; base: number };
    }>) => {
      if (event.data.type === "progress") {
        setSurveyProgress(Math.round((event.data.progress ?? 0) * 100));
        setSurveyProgressLabel(event.data.message ?? "계산 중");
        return;
      }
      if (event.data.type === "complete" && event.data.result) {
        const result = event.data.result;
        setSurveyProgress(100);
        setSurveyProgressLabel("계산 완료");
        updateSection("survey", {
          naturalVolume: result.stockpileVolumeM3,
          coverage: Math.min(result.topCoverageRatio, result.baseCoverageRatio) * 100,
          numericalError: result.stockpileVolumeM3 > 0
            ? (result.numericalErrorM3 / result.stockpileVolumeM3) * 100
            : 0,
          numericalErrorM3: result.numericalErrorM3,
          fillVolumeM3: result.fillVolumeM3,
          cutVolumeM3: result.cutVolumeM3,
          netVolumeM3: result.netVolumeM3,
          gridCellSizeM: result.gridCellSizeM ?? 0,
          calculationMethod: result.method,
          confidence: result.confidence,
          formula: result.formula,
          volumeWarnings: result.warnings,
          topPoints: event.data.pointCounts?.top ?? project.survey.topPoints,
          basePoints: event.data.pointCounts?.base ?? project.survey.basePoints,
        });
        updateSection("soil", { inputState: "natural" });
        setToast(`자연상태 체적 ${formatNumber(result.stockpileVolumeM3)}㎥를 계산했습니다.`);
      } else {
        setToast(event.data.message ?? "체적 계산을 완료하지 못했습니다.");
      }
      worker.terminate();
      volumeWorkerRef.current = null;
      setSurveyBusy(false);
    };
    worker.onerror = () => {
      setToast("체적 계산 작업을 시작하지 못했습니다.");
      worker.terminate();
      volumeWorkerRef.current = null;
      setSurveyBusy(false);
    };
    worker.postMessage({
      topCsv: surveyFiles.current.topCsv,
      baseCsv: surveyFiles.current.baseCsv,
      boundaryGeoJson: surveyFiles.current.boundaryGeoJson,
      topOptions: {
        role: "top",
        crs: project.survey.crs,
        horizontalUnit: project.survey.horizontalUnit,
        verticalUnit: project.survey.verticalUnit,
        verticalDatum: project.survey.verticalDatum,
      },
      baseOptions: {
        role: project.survey.method === "control" ? "base_control" : "base",
        crs: project.survey.crs,
        horizontalUnit: project.survey.horizontalUnit,
        verticalUnit: project.survey.verticalUnit,
        verticalDatum: project.survey.verticalDatum,
      },
      boundaryOptions: {
        crs: project.survey.crs,
        horizontalUnit: project.survey.horizontalUnit,
        source: "survey",
      },
      baseMode: project.survey.method === "control" ? "control" : project.survey.method === "constant" ? "constant" : "surface",
      constantElevationM: project.survey.constantElevation,
      calculationOptions: {
        coverageThreshold: 0.95,
        stockpilePositiveOnly: true,
        ...(project.survey.requestedGridCellSizeM > 0
          ? { gridCellSizeM: project.survey.requestedGridCellSizeM }
          : {}),
      },
    });
  }

  function cancelVolumeCalculation(): void {
    volumeWorkerRef.current?.terminate();
    volumeWorkerRef.current = null;
    setSurveyBusy(false);
    setSurveyProgress(0);
    setSurveyProgressLabel("");
    setToast("체적 계산을 취소했습니다.");
  }

  function exportProject(): void {
    const payload: PexcProjectFile<ProjectDraft> = {
      format: "price-excavation-project",
      schemaVersion: project.schemaVersion,
      exportedAt: new Date().toISOString(),
      project,
      surveyFiles: surveyFiles.current,
      estimate: {
        calculatedAt: new Date().toISOString(),
        official: estimate.investigation.official,
        standardEarthwork: estimate.haul,
        fieldScenario: {
          investigation: estimate.investigation,
          weather: estimate.weatherSchedule,
          calibration: estimate.calibration,
          scenarioCostKrw: estimate.fieldScenario,
        },
        assumptions: [
          `체적산식 ${project.survey.formula}`,
          `체적방식 ${project.survey.calculationMethod}, 격자 ${project.survey.gridCellSizeM || "해당 없음"}m`,
          `토량환산계수 L=${project.soil.swellFactor}, C=${project.soil.compactionFactor}`,
          `운반경로 ${project.route.oneWayKm}km, 대형차 확인=${project.route.confirmed}`,
          `기상정책 사용자 확인=${project.weather.policyConfirmed}`,
          ...(project.weather.observationSource
            ? [`ASOS ${project.weather.observationSource.stationName}(${project.weather.observationSource.stationId}), 현장거리 ${project.weather.observationSource.distanceKm.toFixed(1)}km, 조회 ${project.weather.observationSource.queryStartDate}~${project.weather.observationSource.queryEndDate}`]
            : ["ASOS 관측자료 없음, 사용자 수동 비작업률 적용"]),
          ...(project.publicBenchmarkSnapshot
            ? [
              `공개 허가자료 ${project.publicBenchmarkSnapshot.sourceSnapshotDate} 스냅샷, ${project.publicBenchmarkSnapshot.areaBandLabel} n=${project.publicBenchmarkSnapshot.n}, SHA-256 ${project.publicBenchmarkSnapshot.sourceChecksumSha256}`,
              `조건부 역산은 대장 기재기간 p50=${project.publicBenchmarkSnapshot.registeredDurationDays.p50}일을 중단 없는 현장 가용일로 놓은 수학적 하한이며 실제 팀 복원이 아님`,
            ]
            : ["공개 허가자료 익명 기준선 없음"]),
        ],
        warnings: [
          ...project.survey.volumeWarnings,
          ...estimate.haul.warnings,
          ...estimate.investigation.warnings,
          ...estimate.weatherSchedule.warnings,
          ...estimate.calibration.warnings,
        ],
        sourceSnapshot: project.rateSetSnapshot,
      },
      notices: [
        "참고용 추정 결과이며 법적 측량성과, 대형차 운행허가 또는 확정 견적을 대신하지 않습니다.",
        "공식 대가, 표준 토공원가, 현장 시나리오는 서로 다른 원장이며 합산 시 이중계상을 확인해야 합니다.",
      ],
    };
    downloadFile(
      `${project.name.replaceAll(/[^0-9A-Za-z가-힣_-]/g, "_")}.pexc.json`,
      JSON.stringify(payload, null, 2),
      "application/json;charset=utf-8",
    );
    setToast("프로젝트 파일을 내보냈습니다.");
  }

  function exportCsv(): void {
    const rows: Array<[string, string, string | number, string]> = [
      ["공식 대가기준", "직접인건비", Math.round(estimate.directLabor), "원"],
      ["공식 대가기준", "주휴수당", Math.round(estimate.weeklyAllowance), "원"],
      ["공식 대가기준", "직접경비", Math.round(estimate.directExpense), "원"],
      ["공식 대가기준", "제경비", Math.round(estimate.overhead), "원"],
      ["공식 대가기준", "학술료", Math.round(estimate.academic), "원"],
      ["공식 대가기준", "소계(최저)", Math.round(estimate.investigation.official.subtotalExcludingVatKrw.min), "원"],
      ["공식 대가기준", "소계(선택)", Math.round(estimate.investigation.official.subtotalExcludingVatKrw.selected), "원"],
      ["공식 대가기준", "소계(최고)", Math.round(estimate.investigation.official.subtotalExcludingVatKrw.max), "원"],
      ["공식 대가기준", "VAT(선택)", Math.round(estimate.vat), "원"],
      ["공식 대가기준", "VAT포함 합계(선택)", Math.round(estimate.investigation.official.totalIncludingVatKrw.selected), "원"],
      ["표준 토공원가", "자연토 체적", estimate.naturalVolume, "㎥"],
      ["표준 토공원가", "흐트러진 체적", estimate.looseVolume, "㎥"],
      ["표준 토공원가", "총 적재운행", estimate.totalTrips, "회"],
      ["표준 토공원가", "장비·운반비", Math.round(estimate.standardEarthwork), "원"],
      ["현장 시나리오", "순수 현장일", estimate.fieldDays, "일"],
      ["현장 시나리오", "달력일 중앙값", estimate.medianCalendarDays, "일"],
      ["현장 시나리오", "예상비용", Math.round(estimate.fieldScenario), "원"],
      ["적용정보", "단가세트", project.rateSetSnapshot.label, ""],
      ["적용정보", "시행일", project.rateSetSnapshot.effectiveFrom, ""],
      ["적용정보", "고시번호", estimate.investigation.official.source.noticeNumber, ""],
      ...(project.publicBenchmarkSnapshot ? [
        ["공개 허가자료", "집계 버전", project.publicBenchmarkSnapshot.version, ""],
        ["공개 허가자료", "원문 스냅샷", project.publicBenchmarkSnapshot.sourceSnapshotDate, ""],
        ["공개 허가자료", "출처", project.publicBenchmarkSnapshot.sourceUrl, ""],
        ["공개 허가자료", "이용허락", `${project.publicBenchmarkSnapshot.licenseLabel} (${project.publicBenchmarkSnapshot.licenseCheckedAt} 확인)`, ""],
        ["공개 허가자료", "코호트", `${project.publicBenchmarkSnapshot.investigationType}/${project.publicBenchmarkSnapshot.areaBandLabel}`, ""],
        ["공개 허가자료", "표본수", project.publicBenchmarkSnapshot.n, "건"],
        ["공개 허가자료", "대장 기재기간 p20/p50/p80", `${project.publicBenchmarkSnapshot.registeredDurationDays.p20}/${project.publicBenchmarkSnapshot.registeredDurationDays.p50}/${project.publicBenchmarkSnapshot.registeredDurationDays.p80}`, "일"],
        ["공개 허가자료", "착수~완료 경과일 p20/p50/p80", `${project.publicBenchmarkSnapshot.elapsedCalendarDays.p20}/${project.publicBenchmarkSnapshot.elapsedCalendarDays.p50}/${project.publicBenchmarkSnapshot.elapsedCalendarDays.p80}`, "일"],
        ["공개 허가자료", "조건부 최소 동시배치", estimate.investigation.official.rolePersonDays.map((row) => {
          const label = project.team.roles.find((role) => role.id === row.role)?.label ?? row.role;
          const targetDays = Math.max(0.01, project.publicBenchmarkSnapshot!.registeredDurationDays.p50);
          return `${label} ${Math.max(1, Math.ceil(row.fieldDays / targetDays))}`;
        }).join(" · "), "명"],
        ["공개 허가자료", "원문 SHA-256", project.publicBenchmarkSnapshot.sourceChecksumSha256, ""],
      ] as Array<[string, string, string | number, string]> : []),
      ["적용정보", "기상자료", project.weather.observationSource
        ? `${project.weather.observationSource.stationName} ASOS (${project.weather.observationSource.stationId}), ${project.weather.observationSource.queryStartDate}~${project.weather.observationSource.queryEndDate}`
        : "수동 비작업률", ""],
    ];
    const csv = ["원장,항목,값,단위", ...rows.map((row) => row.map(escapeCsv).join(","))].join("\n");
    downloadFile(`${project.name}-계산결과.csv`, `\ufeff${csv}`, "text/csv;charset=utf-8");
    setToast("계산 결과 CSV를 내보냈습니다.");
  }

  async function importProject(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > MAX_PROJECT_FILE_BYTES) {
        throw new Error("프로젝트 파일은 32MB 이하여야 합니다.");
      }
      const decoded = decodeProjectPayload(JSON.parse(await file.text()) as unknown);
      if (!decoded) {
        throw new Error("필수 필드·단가 고정본·배열 크기를 확인해 주세요. 지원하는 .pexc.json이 아닙니다.");
      }
      setProject(decoded.project);
      surveyFiles.current = decoded.surveyFiles;
      setActiveStep("location");
      setToast("프로젝트를 불러왔습니다.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "프로젝트 파일을 읽지 못했습니다.");
    } finally {
      event.target.value = "";
    }
  }

  async function resetProject(): Promise<void> {
    if (!window.confirm("새 프로젝트를 시작할까요? 현장 입력은 초기화하고 팀·조사자 별칭과 완료사례는 이어갑니다.")) return;
    await clearActiveProject();
    const next = makeDefaultProject(true);
    next.team = {
      ...next.team,
      profileName: project.team.profileName,
      investigatorAlias: project.team.investigatorAlias,
      calibrationSamples: project.team.calibrationSamples,
    };
    setProject(next);
    setGeocodePreview(null);
    surveyFiles.current = { topCsv: "", baseCsv: "", boundaryGeoJson: "" };
    setActiveStep("location");
    setToast("팀의 완료사례를 이어받아 새 프로젝트를 열었습니다.");
  }

  async function tryExternalLookup(kind: "address" | "route" | "weather"): Promise<void> {
    const enabled =
      kind === "address"
        ? project.location.externalLookup
        : kind === "route"
          ? project.route.routeLookup
          : project.weather.externalLookup;
    if (!enabled) {
      setToast("외부 조회에 동의하면 연결할 수 있습니다. 수동 입력만으로도 계산할 수 있어요.");
      return;
    }
    setLookupBusy(true);
    try {
      if (kind === "address") {
        const response = await fetch("/api/geocode", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: project.location.address, consent: true }),
        });
        const payload = await response.json() as {
          error?: string;
          items?: Array<{ title: string; roadAddress: string; parcelAddress: string; longitude: number; latitude: number }>;
        };
        if (!response.ok) throw new Error(payload.error ?? "주소 조회에 실패했습니다.");
        const first = payload.items?.find((item) => Number.isFinite(item.longitude) && Number.isFinite(item.latitude));
        if (!first) throw new Error("검색된 주소가 없습니다. 주소 또는 좌표를 직접 입력해 주세요.");
        setGeocodePreview({
          address: first.roadAddress || first.title,
          parcel: first.parcelAddress,
          longitude: first.longitude,
          latitude: first.latitude,
        });
        setToast("VWorld 실시간 결과를 표시했습니다. 이용조건에 따라 프로젝트에는 저장하지 않습니다.");
      } else if (kind === "route") {
        const response = await fetch("/api/directions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            consent: true,
            origin: { longitude: project.location.longitude, latitude: project.location.latitude },
            destination: {
              longitude: project.route.destinationLongitude,
              latitude: project.route.destinationLatitude,
            },
          }),
        });
        const payload = await response.json() as { error?: string; distanceKm?: number; durationMinutes?: number };
        if (!response.ok) throw new Error(payload.error ?? "경로 조회에 실패했습니다.");
        const distanceKm = payload.distanceKm ?? project.route.oneWayKm;
        const loadedMinutes = Math.ceil(payload.durationMinutes ?? project.route.loadedMinutes);
        const returnMinutes = Math.max(1, Math.ceil(loadedMinutes * 0.88));
        updateSection("route", { oneWayKm: distanceKm, loadedMinutes, returnMinutes });
        updateSection("equipment", {
          cycle: { ...project.equipment.cycle, loadedTravel: loadedMinutes, emptyReturn: returnMinutes },
        });
        setToast("승용차 경로를 초깃값으로 반영했습니다. 대형차 조건을 확인해 주세요.");
      } else {
        const reference = new Date(`${project.weather.startDate}T00:00:00Z`);
        if (Number.isNaN(reference.getTime())) throw new Error("착수 예정일을 확인해 주세요.");
        const { station, distanceKm } = nearestAsosStation(
          project.location.latitude,
          project.location.longitude,
        );
        const asOfDate = todayInKorea();
        const sourceYears = fiveLatestCompleteScenarioYears(reference, asOfDate);
        const ranges = sourceYears.map((sourceYear) => ({
          sourceYear,
          ...scenarioDateRange(reference, sourceYear),
        }));
        const requests = ranges.map(async ({ sourceYear, startDate, endDate }) => {
          const query = new URLSearchParams({ stationId: station.id, startDate, endDate, consent: "true" });
          const response = await fetch(`/api/weather?${query}`);
          const payload = await response.json() as {
            error?: string;
            stationId?: string;
            items?: Array<{
              date: string;
              precipitationMm?: number;
              minimumTemperatureC?: number;
              newSnowCm?: number;
              maximumGustMs?: number;
            }>;
          };
          if (!response.ok) throw new Error(payload.error ?? `${sourceYear}년 기상자료 조회에 실패했습니다.`);
          if (payload.stationId !== station.id) throw new Error("기상자료 관측소 출처가 요청값과 일치하지 않습니다.");
          return payload.items ?? [];
        });
        const rows = (await Promise.all(requests)).flat();
        const observations = [...new Map(rows.map((row) => [row.date, row])).values()].map((row): WeatherObservation => ({
          date: row.date,
          ...(Number.isFinite(row.precipitationMm) ? { precipitationMm: row.precipitationMm } : {}),
          ...(Number.isFinite(row.minimumTemperatureC) ? { minimumTemperatureC: row.minimumTemperatureC } : {}),
          ...(Number.isFinite(row.newSnowCm) ? { newSnowCm: row.newSnowCm } : {}),
          ...(Number.isFinite(row.maximumGustMs) ? { maxInstantWindMps: row.maximumGustMs } : {}),
        })).sort((left, right) => left.date.localeCompare(right.date));
        if (!observations.length) throw new Error("관측자료가 없습니다. 수동 비작업일을 유지합니다.");
        const firstRange = ranges[0];
        const lastRange = ranges.at(-1);
        if (!firstRange || !lastRange) throw new Error("기상 조회기간을 만들지 못했습니다.");
        updateSection("weather", {
          station: `${station.name} ASOS (${station.id})`,
          observations,
          observationSource: {
            stationId: station.id,
            stationName: station.name,
            stationLatitude: station.latitude,
            stationLongitude: station.longitude,
            siteLatitude: project.location.latitude,
            siteLongitude: project.location.longitude,
            distanceKm,
            startMonthDay: project.weather.startDate.slice(5),
            sourceYears,
            queryStartDate: firstRange.startDate,
            queryEndDate: lastRange.endDate,
            registryVersion: asosStationRegistry.version,
            asOfDate,
            fetchedAt: new Date().toISOString(),
          },
        });
        setToast(`${station.name} ASOS(${station.id}, ${distanceKm.toFixed(1)}km)의 5개 완전연도를 반영했습니다.`);
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : "외부 조회에 실패해 수동 입력값을 유지합니다.");
    } finally {
      setLookupBusy(false);
    }
  }

  function updateRole(id: string, patch: Partial<TeamRole>): void {
    updateSection("team", {
      roles: project.team.roles.map((role) => (role.id === id ? { ...role, ...patch } : role)),
    });
  }

  function updateCalibrationSample(
    id: string,
    patch: Partial<ProjectDraft["team"]["calibrationSamples"][number]>,
  ): void {
    updateSection("team", {
      calibrationSamples: project.team.calibrationSamples.map((sample) =>
        sample.id === id ? { ...sample, ...patch } : sample,
      ),
    });
  }

  function saveCompletedCase(): void {
    const sampleId = `actual-${project.id}`;
    if (project.team.calibrationSamples.some((sample) => sample.id === sampleId)) {
      setToast("이 프로젝트의 완료사례는 이미 저장돼 있습니다.");
      return;
    }
    const investigatorIds = project.actual.investigatorAlias.trim()
      ? [investigatorIdFromAlias(project.actual.investigatorAlias)]
      : [];
    updateSection("team", {
      investigatorAlias: project.actual.investigatorAlias,
      calibrationSamples: [
        ...project.team.calibrationSamples,
        {
          id: sampleId,
          completedAt: todayInKorea(),
          investigationType: project.investigation.type,
          standardDays: estimate.investigation.standardFieldDays,
          actualDays: Math.max(0.1, project.actual.actualWorkDays),
          qualityWeight: Math.min(1, Math.max(0, project.actual.qualityWeight)),
          excluded: project.actual.excluded,
          investigatorIds,
          investigatorAlias: project.actual.investigatorAlias.trim(),
          investigatorDays: Math.max(0, project.actual.investigatorDays),
          areaM2: Math.max(0, project.investigation.area),
          volumeM3: Math.max(0, project.actual.actualVolume),
          featureDensity: project.investigation.featureDensity,
          soilType: project.soil.type,
          teamRoleCounts: Object.fromEntries(project.team.roles.map((role) => [role.id, Math.max(0, role.count)])),
          totalPersonDays: Math.max(0, project.actual.actualPersonDays),
          equipmentDays: Math.max(0, project.actual.actualEquipmentDays),
          loadedTrips: Math.max(0, project.actual.actualTrips),
          calendarDays: Math.max(0, project.actual.actualCalendarDays),
          weatherStoppedDays: Math.max(0, project.actual.weatherLostDays),
          otherStoppedDays: Math.max(0, project.actual.otherLostDays),
          logs: project.actual.logs.map((log) => ({ ...log })),
        },
      ],
    });
    setToast("완료사례를 저장했습니다. 코어 보정계수가 자동으로 다시 계산됩니다.");
  }

  function updateCycle(key: keyof ProjectDraft["equipment"]["cycle"], value: number): void {
    updateSection("equipment", {
      cycle: { ...project.equipment.cycle, [key]: value },
    });
  }

  function addDailyLog(): void {
    updateSection("actual", {
      logs: [
        ...project.actual.logs,
        {
          id: `log-${Date.now().toString(36)}`,
          date: todayInKorea(),
          workType: "조사 작업",
          quantity: 0,
          people: project.team.roles.reduce((sum, role) => sum + role.count, 0),
          equipmentHours: 0,
          interruption: "없음",
        },
      ],
    });
  }

  function updateLog(id: string, patch: Partial<DailyLog>): void {
    updateSection("actual", {
      logs: project.actual.logs.map((log) => (log.id === id ? { ...log, ...patch } : log)),
    });
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#step-content">본문으로 바로가기</a>
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <div>
            <strong>발굴 현장 계산기</strong>
            <span>토공 · 공기 · 대가</span>
          </div>
        </div>
        <label className="project-title-input">
          <span>프로젝트</span>
          <input aria-label="프로젝트 이름" value={project.name} onChange={(event) => updateProjectName(event.target.value)} />
        </label>
        <div className="topbar-actions">
          <span className={`save-status ${saveState}`} aria-live="polite">
            <span aria-hidden="true" />
            {saveState === "loading" ? "불러오는 중" : saveState === "saving" ? "저장 중" : saveState === "error" ? "저장 실패" : "이 기기에 저장됨"}
          </span>
          <button className="icon-button" type="button" onClick={() => importInputRef.current?.click()} title="프로젝트 불러오기" aria-label="프로젝트 불러오기">↥</button>
          <button className="icon-button" type="button" onClick={exportProject} title="원본 측점·경계가 포함된 프로젝트 내보내기" aria-label="원본 측점·경계가 포함된 프로젝트 내보내기">↧</button>
          <button className="more-button" type="button" onClick={resetProject} aria-label="새 프로젝트 시작">새 프로젝트</button>
          <input ref={importInputRef} hidden tabIndex={-1} type="file" accept=".json,.pexc.json,application/json" onChange={importProject} />
        </div>
      </header>

      <div className="workspace">
        <aside className={`step-sidebar ${mobileStepsOpen ? "is-open" : ""}`} aria-label="계산 단계">
          <div className="sidebar-heading">
            <span>견적 작성</span>
            <strong>{activeIndex + 1}<small>/10</small></strong>
          </div>
          <div className="progress-track" aria-hidden="true"><span style={{ width: `${((activeIndex + 1) / STEPS.length) * 100}%` }} /></div>
          <nav>
            {STEPS.map((step, index) => (
              <button
                className={step.id === activeStep ? "active" : index < activeIndex ? "complete" : ""}
                key={step.id}
                type="button"
                onClick={() => setStep(step.id)}
                aria-current={step.id === activeStep ? "step" : undefined}
              >
                <span className="step-number">{index < activeIndex ? "✓" : String(index + 1).padStart(2, "0")}</span>
                <span><strong>{step.title}</strong><small>{step.description}</small></span>
              </button>
            ))}
          </nav>
          <div className="privacy-note">
            <span aria-hidden="true">⌂</span>
            <p><strong>로컬 전용 저장</strong>측량 파일과 조사자 정보는 이 기기를 떠나지 않습니다.</p>
          </div>
        </aside>

        <main ref={mainPanelRef} id="step-content" className="main-panel" tabIndex={-1}>
          <div className="mobile-step-trigger">
            <button type="button" onClick={() => setMobileStepsOpen((open) => !open)} aria-expanded={mobileStepsOpen}>
              <span><b>{String(activeIndex + 1).padStart(2, "0")}</b> {active.title}</span>
              <span aria-hidden="true">{mobileStepsOpen ? "닫기" : "전체 단계"}</span>
            </button>
          </div>

          <div className="step-heading">
            <div>
              <span className="eyebrow">STEP {String(activeIndex + 1).padStart(2, "0")}</span>
              <h1>{active.title}</h1>
              <p>{active.description}</p>
            </div>
            <div className="engine-status" title="핵심 계산 엔진 연결 상태">
              <span /> 공식 산식 엔진 연결됨
            </div>
          </div>

          {calculation.error && (
            <div className="calculation-error" role="alert"><b>입력 확인</b>{calculation.error} 마지막 유효 예시 결과를 표시합니다.</div>
          )}

          {renderStep()}

          <footer className="step-footer">
            <button className="button secondary" type="button" onClick={() => moveStep(-1)} disabled={activeIndex === 0}>← 이전</button>
            <span>{activeIndex + 1} / {STEPS.length}</span>
            {activeIndex < STEPS.length - 1 ? (
              <button className="button primary" type="button" onClick={() => moveStep(1)}>{activeIndex === 7 ? "결과 보기" : "저장하고 다음"} <span aria-hidden="true">→</span></button>
            ) : (
              <button className="button primary" type="button" onClick={() => setStep("result")}>결과로 돌아가기 →</button>
            )}
          </footer>
        </main>

        <aside className="summary-rail" aria-label="실시간 계산 요약">
          <div className="summary-card sticky-summary">
            <div className="summary-title"><span>실시간 요약</span><small>입력 즉시 갱신</small></div>
            <Metric label="자연토 체적" value={formatNumber(estimate.naturalVolume)} unit="㎥" />
            <Metric label="흐트러진 토량" value={formatNumber(estimate.looseVolume)} unit="㎥" accent />
            <Metric label="덤프 운반" value={formatNumber(estimate.totalTrips, 0)} unit="회" />
            <div className="summary-divider" />
            <Metric label="순수 현장일" value={formatNumber(estimate.fieldDays, 0)} unit="일" large />
            <Metric label="달력일 · 중앙값" value={formatNumber(estimate.medianCalendarDays, 0)} unit="일" />
            <div className="summary-cost">
              <span>현장 시나리오</span>
              <strong>{formatCurrency(estimate.fieldScenario)}</strong>
              <small>VAT 별도 · 참고 추정</small>
            </div>
            <button className="text-button" type="button" onClick={() => setStep("result")}>전체 산출 근거 보기 <span>→</span></button>
          </div>
          <p className="rail-footnote">마지막 저장 {new Date(project.updatedAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}</p>
        </aside>
      </div>

      {toast && <div className="toast" role="status"><span aria-hidden="true">✓</span>{toast}</div>}
    </div>
  );

  function renderStep(): ReactNode {
    switch (activeStep) {
      case "location":
        return renderLocationStep();
      case "survey":
        return renderSurveyStep();
      case "soil":
        return renderSoilStep();
      case "equipment":
        return renderEquipmentStep();
      case "route":
        return renderRouteStep();
      case "investigation":
        return renderInvestigationStep();
      case "team":
        return renderTeamStep();
      case "weather":
        return renderWeatherStep();
      case "result":
        return renderResultStep();
      case "actual":
        return renderActualStep();
    }
  }

  function renderLocationStep(): ReactNode {
    return (
      <div className="step-grid map-step">
        <section className="card form-card">
          <SectionTitle number="01" title="현장 기본정보" description="주소를 직접 입력하면 외부 서비스 없이도 계산할 수 있습니다." />
          <div className="field-grid one-column">
            <TextField label="프로젝트명" value={project.name} onChange={updateProjectName} />
            <TextField label="도로명·지번 주소" value={project.location.address} onChange={(address) => { setGeocodePreview(null); updateSection("location", { address }); }} action={<button type="button" onClick={() => tryExternalLookup("address")} disabled={lookupBusy}>실시간 확인</button>} />
            <TextField label="대상 필지" value={project.location.parcel} onChange={(parcel) => updateSection("location", { parcel })} hint="연속지적도는 위치 확인용이며 측량성과가 아닙니다." />
            <div className="field-grid two-column compact">
              <NumberField label="위도" value={project.location.latitude} decimals={4} onChange={(latitude) => updateLocationAndInvalidateWeather({ latitude })} />
              <NumberField label="경도" value={project.location.longitude} decimals={4} onChange={(longitude) => updateLocationAndInvalidateWeather({ longitude })} />
            </div>
            {geocodePreview && (
              <div className="inline-warning" role="status">
                <b>실시간 조회 · 저장 안 함</b>
                {geocodePreview.address}{geocodePreview.parcel ? ` · ${geocodePreview.parcel}` : ""}<br />
                {geocodePreview.latitude.toFixed(6)}, {geocodePreview.longitude.toFixed(6)}
              </div>
            )}
          </div>
          <ConsentRow
            checked={project.location.externalLookup}
            onChange={(externalLookup) => {
              if (!externalLookup) setGeocodePreview(null);
              updateSection("location", { externalLookup });
            }}
            title="VWorld 주소 실시간 조회 허용"
            description="켜면 주소 문자열만 전송합니다. 응답은 화면에만 표시하며 저장·내보내기하지 않습니다."
          />
        </section>
        <section className="card map-card" aria-label="현장 위치 미리보기">
          <div className="map-toolbar">
            <span><b>위치 미리보기</b><small>참고도</small></span>
          </div>
          <Suspense fallback={<div className="map-loading" role="status">개략 위치 지도를 준비하는 중…</div>}>
            <ProjectMap
              latitude={project.location.latitude}
              longitude={project.location.longitude}
              areaM2={project.investigation.area}
              parcelReferenceGeoJson={project.location.parcelReferenceGeoJson}
            />
          </Suspense>
          <div className="map-caption"><span className="status-dot ok" /> {project.location.parcelReferenceGeoJson ? "VWorld 연속지적도 참고경계를 표시했습니다." : "입력 좌표만 표시했습니다."}<small>참고경계는 지적측량성과가 아니며, 체적 계산은 별도 측량 GeoJSON으로 확정하세요.</small></div>
        </section>
      </div>
    );
  }

  function renderSurveyStep(): ReactNode {
    return (
      <div className="content-stack">
        <section className="card form-card">
          <SectionTitle number="02" title="좌표계와 기준" description="좌표계·단위·수직기준이 명확해야 체적을 계산할 수 있습니다." badge="필수" />
          <div className="field-grid three-column">
            <SelectField label="좌표계 (CRS)" value={project.survey.crs} options={["EPSG:5186", "EPSG:5187", "EPSG:5179", "EPSG:4326"]} onChange={(crs) => updateSection("survey", { crs, horizontalUnit: crs === "EPSG:4326" ? "degree" : project.survey.horizontalUnit === "degree" ? "m" : project.survey.horizontalUnit })} />
            <SelectField label="수평 단위" value={project.survey.horizontalUnit} options={project.survey.crs === "EPSG:4326" ? ["degree"] : ["m", "ft"]} onChange={(horizontalUnit) => updateSection("survey", { horizontalUnit: horizontalUnit as "m" | "ft" | "degree" })} />
            <SelectField label="수직 단위" value={project.survey.verticalUnit} options={["m", "ft"]} onChange={(verticalUnit) => updateSection("survey", { verticalUnit: verticalUnit as "m" | "ft" })} />
          </div>
          <TextField label="수직 기준" value={project.survey.verticalDatum} onChange={(verticalDatum) => updateSection("survey", { verticalDatum })} />
        </section>

        <section className="surface-layout">
          <div className="card form-card">
            <SectionTitle number="03" title="표면 자료" description="CSV 필수 열은 x, y, z이며 point_id와 surface는 선택입니다." />
            <div className="segmented" role="group" aria-label="기준면 방식">
              {[{ value: "surface", label: "전·후 표면" }, { value: "control", label: "기준점 보간" }, { value: "constant", label: "고정 기준고" }, { value: "manual", label: "수동 체적" }].map((option) => (
                <button key={option.value} type="button" aria-pressed={project.survey.method === option.value} className={project.survey.method === option.value ? "selected" : ""} onClick={() => updateSection("survey", { method: option.value as ProjectDraft["survey"]["method"] })}>{option.label}</button>
              ))}
            </div>
            {project.survey.method !== "manual" && (
              <NumberField
                label="격자 셀 크기"
                value={project.survey.requestedGridCellSizeM}
                decimals={2}
                suffix="m · 0은 자동"
                onChange={(requestedGridCellSizeM) => updateSection("survey", { requestedGridCellSizeM: Math.max(0, requestedGridCellSizeM) })}
                hint={project.survey.gridCellSizeM > 0 ? `마지막 계산에서 ${formatNumber(project.survey.gridCellSizeM, 2)}m 사용` : "공통 XY TIN은 격자를 사용하지 않습니다."}
              />
            )}
            {project.survey.method !== "manual" ? (
              <div className="upload-grid">
                <FileDrop label="상부면 CSV" fileName={project.survey.topFile} detail={project.survey.topPoints ? `${formatNumber(project.survey.topPoints, 0)} points` : "측량 후 표면"} accept=".csv,text/csv" onChange={(event) => handleSurveyFile("top", event)} />
                {project.survey.method === "constant" ? (
                  <div className="constant-base-input"><span aria-hidden="true">↕</span><NumberField label="고정 기준고" value={project.survey.constantElevation} decimals={3} suffix="m" onChange={(constantElevation) => updateSection("survey", { constantElevation })} /><small>{project.survey.verticalDatum} 기준</small></div>
                ) : (
                  <FileDrop label={project.survey.method === "surface" ? "기준면 CSV" : "기준점 CSV"} fileName={project.survey.baseFile} detail={project.survey.basePoints ? `${formatNumber(project.survey.basePoints, 0)} points` : project.survey.method === "surface" ? "적치 전 표면" : "최소 3점"} accept=".csv,text/csv" onChange={(event) => handleSurveyFile("base", event)} />
                )}
                <FileDrop label="계산 경계 GeoJSON" fileName={project.survey.boundaryFile} detail="Polygon · MultiPolygon" accept=".json,.geojson,application/geo+json" onChange={handleBoundaryFile} wide />
              </div>
            ) : (
              <div className="manual-volume-box">
                <NumberField label={`${project.soil.inputState === "natural" ? "자연" : project.soil.inputState === "loose" ? "흐트러진" : "다짐"}상태 입력 체적`} value={project.survey.naturalVolume} suffix="㎥" onChange={(naturalVolume) => updateSection("survey", { naturalVolume })} />
                <p><span aria-hidden="true">i</span> 측량 자료가 없는 초기 견적용입니다. 결과에는 신뢰등급 ‘개략’으로 표시됩니다.</p>
              </div>
            )}
            {project.survey.method !== "manual" && (
              surveyBusy ? (
                <div className="calculation-progress" role="status" aria-live="polite">
                  <div><span>{surveyProgressLabel}</span><b>{surveyProgress}%</b></div>
                  <div className="calculation-progress-track"><span style={{ width: `${surveyProgress}%` }} /></div>
                  <button type="button" onClick={cancelVolumeCalculation}>계산 취소</button>
                </div>
              ) : (
                <button className="button primary calculate-button" type="button" onClick={runVolumeCalculation}>체적 계산하기</button>
              )
            )}
          </div>
          <div className="card section-preview">
            <span className="preview-label">단면 개념도</span>
            <div className="soil-section" aria-label="상부면과 기준면의 단면 개념도">
              <div className="section-volume"><span>적치토</span><b>{formatNumber(estimate.naturalVolume)}㎥</b></div>
              <div className="section-top-line" /><div className="section-ground-line" />
              <div className="section-dots">{Array.from({ length: 20 }, (_, index) => <i key={index} />)}</div>
            </div>
            <dl className="quality-list">
              <div><dt>경계 피복률</dt><dd className={project.survey.coverage >= 95 ? "good" : "bad"}>{formatNumber(project.survey.coverage)}%</dd></div>
              <div><dt>성토 / 절토</dt><dd>{formatNumber(project.survey.fillVolumeM3)} / {formatNumber(project.survey.cutVolumeM3)}㎥</dd></div>
              <div><dt>순체적</dt><dd>{formatNumber(project.survey.netVolumeM3)}㎥</dd></div>
              <div><dt>수치 오차</dt><dd>± {formatNumber(project.survey.numericalErrorM3)}㎥ · {formatNumber(project.survey.numericalError)}%</dd></div>
              <div><dt>계산 방식</dt><dd>{project.survey.calculationMethod === "common_xy_tin" ? "공통 XY TIN" : project.survey.calculationMethod === "deterministic_grid" ? `IDW 격자 ${formatNumber(project.survey.gridCellSizeM, 2)}m` : "수동 입력"}</dd></div>
              <div><dt>신뢰등급</dt><dd>{project.survey.confidence === "high" ? "A · 높음" : project.survey.confidence === "medium" ? "B · 검토" : project.survey.method === "manual" ? "D · 수동" : "C · 개략"}</dd></div>
            </dl>
            {project.survey.coverage < 95 && <div className="inline-warning danger">경계 피복률이 95% 미만입니다. 경계를 줄이거나 측점을 보강하세요.</div>}
            {project.survey.volumeWarnings.map((warning) => <div className="inline-warning" key={warning}><b>체적</b>{warning}</div>)}
          </div>
        </section>
      </div>
    );
  }

  function renderSoilStep(): ReactNode {
    return (
      <div className="content-stack">
        <section className="card form-card">
          <SectionTitle number="04" title="토질과 상태" description="L과 C는 현장 시험값을 우선하고, 기본값은 초기 검토에만 사용하세요." />
          <div className="choice-cards four">
            {["보통토사", "점성토", "사질토", "혼합토"].map((type) => (
              <button key={type} type="button" aria-pressed={project.soil.type === type} className={project.soil.type === type ? "selected" : ""} onClick={() => updateSection("soil", { type: type as ProjectDraft["soil"]["type"] })}>
                <span className={`soil-swatch soil-${type}`} aria-hidden="true" /><strong>{type}</strong><small>{type === "보통토사" ? "기본 권장" : "값 직접 확인"}</small>
              </button>
            ))}
          </div>
          <div className="soil-state-selector">
            <div><span className="eyebrow">입력 체적 상태</span><strong>현재 {project.soil.inputState === "natural" ? "자연상태" : project.soil.inputState === "loose" ? "흐트러진 상태" : "다짐상태"} 체적을 입력 중입니다.</strong><p>선택한 상태의 체적을 기준으로 코어 엔진이 나머지 두 상태와 질량을 역산합니다.</p></div>
            <div className="segmented" role="group" aria-label="입력 체적 상태">
              {[
                ["natural", "자연상태"],
                ["loose", "흐트러짐"],
                ["compacted", "다짐상태"],
              ].map(([value, label]) => <button key={value} type="button" aria-pressed={project.soil.inputState === value} className={project.soil.inputState === value ? "selected" : ""} onClick={() => updateSection("soil", { inputState: value as ProjectDraft["soil"]["inputState"] })}>{label}</button>)}
            </div>
          </div>
          <div className="field-grid three-column roomy">
            <NumberField label="토량환산계수 L" value={project.soil.swellFactor} decimals={2} onChange={(swellFactor) => updateSection("soil", { swellFactor })} hint="흐트러진 체적 ÷ 자연 체적" />
            <NumberField label="토량환산계수 C" value={project.soil.compactionFactor} decimals={2} onChange={(compactionFactor) => updateSection("soil", { compactionFactor })} hint="다짐 체적 ÷ 자연 체적" />
            <NumberField label="자연토 습윤밀도" value={project.soil.wetDensity} decimals={2} suffix="t/㎥" onChange={(wetDensity) => updateSection("soil", { wetDensity })} hint="시험값 또는 현장 확인값" />
          </div>
        </section>
        <section className="conversion-card card">
          <div className="conversion-state"><span>자연상태</span><strong>{formatNumber(estimate.naturalVolume)}<small>㎥</small></strong><em>기준 1.00</em></div>
          <span className="conversion-arrow">× {project.soil.swellFactor}</span>
          <div className="conversion-state highlight"><span>흐트러진 상태</span><strong>{formatNumber(estimate.looseVolume)}<small>㎥</small></strong><em>덤프 운반 기준</em></div>
          <span className="conversion-arrow">× {project.soil.compactionFactor}</span>
          <div className="conversion-state"><span>다짐상태</span><strong>{formatNumber(estimate.compactedVolume)}<small>㎥</small></strong><em>자연토 기준 환산</em></div>
          <div className="mass-check"><span>질량보존 확인</span><strong>{formatNumber(estimate.massTon)} t</strong><small>흐트러진 밀도 {formatNumber(estimate.looseDensity, 2)}t/㎥</small></div>
        </section>
        <div className="inline-warning"><b>산식</b> L = 흐트러진체적 / 자연체적 · C = 다짐체적 / 자연체적. 적용한 계수와 출처는 결과 파일에 함께 저장됩니다.</div>
      </div>
    );
  }

  function renderEquipmentStep(): ReactNode {
    const cycleLabels: Array<[keyof ProjectDraft["equipment"]["cycle"], string]> = [
      ["loading", "상차"], ["entry", "진입"], ["cover", "덮개"], ["wash", "세륜"],
      ["loadedTravel", "적재주행"], ["unloading", "하차"], ["emptyReturn", "공차복귀"], ["waiting", "대기"],
    ];
    const targetFleet = estimate.haul.requiredFleetForTarget ?? estimate.haul.fleetSize;
    return (
      <div className="content-stack">
        <div className="equipment-grid">
          <section className="card form-card">
            <SectionTitle number="05" title="굴삭기" description="현장 임대단가가 있으면 표준단가보다 우선합니다." />
            <TextField label="장비 규격" value={project.equipment.excavatorName} onChange={(excavatorName) => updateSection("equipment", { excavatorName })} />
            <div className="field-grid two-column compact">
              <NumberField label="버킷 용량" value={project.equipment.bucketCapacity} decimals={1} suffix="㎥" onChange={(bucketCapacity) => updateSection("equipment", { bucketCapacity })} />
              <NumberField label="일 생산량" value={project.equipment.productivity} suffix="㎥/일" onChange={(productivity) => updateSection("equipment", { productivity })} />
            </div>
            <div className="field-grid two-column compact rate-pair">
              <NumberField label="표준 참고단가" value={project.equipment.excavatorStandardDayRate} suffix="원/일" onChange={(excavatorStandardDayRate) => updateSection("equipment", { excavatorStandardDayRate })} />
              <NumberField label="현장 임대료" value={project.equipment.dayRate} suffix="원/일" onChange={(dayRate) => updateSection("equipment", { dayRate })} />
            </div>
          </section>
          <section className="card form-card">
            <SectionTitle number="06" title="덤프트럭" description="차량 명칭 대신 등록증상 적재중량과 적재함 실용적을 확인합니다." />
            <TextField label="차량 규격" value={project.equipment.truckName} onChange={(truckName) => updateSection("equipment", { truckName })} />
            <div className="field-grid two-column compact">
              <NumberField label="유효 적재중량" value={project.equipment.payloadTon} decimals={1} suffix="t" onChange={(payloadTon) => updateSection("equipment", { payloadTon })} />
              <NumberField label="적재함 실용적" value={project.equipment.bedVolume} decimals={1} suffix="㎥" onChange={(bedVolume) => updateSection("equipment", { bedVolume })} />
              <NumberField label="중량 적재율" value={project.equipment.weightLoadRate * 100} suffix="%" onChange={(value) => updateSection("equipment", { weightLoadRate: value / 100 })} />
              <NumberField label="용적 적재율" value={project.equipment.volumeLoadRate * 100} suffix="%" onChange={(value) => updateSection("equipment", { volumeLoadRate: value / 100 })} />
            </div>
            <div className="field-grid two-column compact rate-pair">
              <NumberField label="표준 참고단가" value={project.equipment.truckStandardDayRate} suffix="원/대·일" onChange={(truckStandardDayRate) => updateSection("equipment", { truckStandardDayRate })} />
              <NumberField label="현장 임대료" value={project.equipment.truckDayRate} suffix="원/대·일" onChange={(truckDayRate) => updateSection("equipment", { truckDayRate })} />
            </div>
          </section>
        </div>

        <section className="card form-card">
          <SectionTitle number="07" title="1회 운반 사이클" description={`현재 한 바퀴 ${formatNumber(estimate.cycleMinutes, 0)}분 · 차량당 하루 ${estimate.tripsPerTruckDay}회`} />
          <div className="cycle-grid">
            {cycleLabels.map(([key, label], index) => (
              <div className="cycle-item" key={key}>
                <span className="cycle-index">{index + 1}</span>
                <NumberField label={label} value={project.equipment.cycle[key]} suffix="분" onChange={(value) => updateCycle(key, value)} />
              </div>
            ))}
          </div>
          <div className="field-grid two-column roomy">
            <NumberField label="하루 작업시간" value={project.equipment.workMinutes} suffix="분" onChange={(workMinutes) => updateSection("equipment", { workMinutes })} />
            <NumberField label="작업 효율" value={project.equipment.efficiency * 100} suffix="%" onChange={(value) => updateSection("equipment", { efficiency: value / 100 })} />
          </div>
        </section>

        <section className="card dispatch-card">
          <div>
            <span className="eyebrow">배차 시나리오</span>
            <div className="segmented compact-segment" role="group" aria-label="배차 계산 방식">
              <button type="button" aria-pressed={project.equipment.mode === "fleet"} className={project.equipment.mode === "fleet" ? "selected" : ""} onClick={() => updateSection("equipment", { mode: "fleet" })}>차량대수로 기간 계산</button>
              <button type="button" aria-pressed={project.equipment.mode === "target"} className={project.equipment.mode === "target" ? "selected" : ""} onClick={() => updateSection("equipment", { mode: "target" })}>목표기간으로 대수 계산</button>
            </div>
          </div>
          <div className="dispatch-input">
            {project.equipment.mode === "fleet" ? (
              <NumberField label="투입 차량" value={project.equipment.truckCount} suffix="대" onChange={(truckCount) => updateSection("equipment", { truckCount: Math.max(1, Math.round(truckCount)) })} />
            ) : (
              <NumberField label="목표 작업일" value={project.equipment.targetDays} suffix="일" onChange={(targetDays) => updateSection("equipment", { targetDays: Math.max(1, Math.round(targetDays)) })} />
            )}
          </div>
          <div className="dispatch-result">
            <span>{project.equipment.mode === "fleet" ? "예상 운반기간" : "필요 차량대수"}</span>
            <strong>{project.equipment.mode === "fleet" ? Math.ceil(estimate.truckDays) : targetFleet}<small>{project.equipment.mode === "fleet" ? "일" : "대"}</small></strong>
            <em>병목: {estimate.bottleneck}</em>
          </div>
        </section>
      </div>
    );
  }

  function renderRouteStep(): ReactNode {
    return (
      <div className="step-grid route-step">
        <section className="card form-card">
          <SectionTitle number="08" title="사토장과 이동시간" description="일반차 길찾기는 초깃값일 뿐, 대형차 운행 가능 여부를 직접 확인해야 합니다." />
          <TextField label="목적지" value={project.route.destination} onChange={(destination) => updateSection("route", { destination })} action={<button type="button" onClick={() => tryExternalLookup("route")} disabled={lookupBusy}>경로 찾기</button>} />
          <div className="field-grid two-column compact route-coordinates">
            <NumberField label="목적지 위도" value={project.route.destinationLatitude} decimals={4} onChange={(destinationLatitude) => updateSection("route", { destinationLatitude })} />
            <NumberField label="목적지 경도" value={project.route.destinationLongitude} decimals={4} onChange={(destinationLongitude) => updateSection("route", { destinationLongitude })} />
          </div>
          <div className="field-grid three-column roomy">
            <NumberField label="편도 거리" value={project.route.oneWayKm} decimals={1} suffix="km" onChange={(oneWayKm) => updateSection("route", { oneWayKm })} />
            <NumberField label="적재 주행" value={project.route.loadedMinutes} suffix="분" onChange={(loadedMinutes) => { updateSection("route", { loadedMinutes }); updateCycle("loadedTravel", loadedMinutes); }} />
            <NumberField label="공차 복귀" value={project.route.returnMinutes} suffix="분" onChange={(returnMinutes) => { updateSection("route", { returnMinutes }); updateCycle("emptyReturn", returnMinutes); }} />
          </div>
          <ConsentRow checked={project.route.routeLookup} onChange={(routeLookup) => updateSection("route", { routeLookup })} title="Kakao 일반차 경로 조회 허용" description="현장·사토장 좌표만 전송하며 결과는 수동으로 확정합니다." />
          <div className="inline-warning"><b>일반차 경로</b> 폭·중량제한·회전반경·시간대별 통행제한은 자동 판정하지 않습니다.</div>
        </section>
        <section className="card checklist-card">
          <SectionTitle number="09" title="현장 확인표" description="확인된 조건은 결과의 신뢰 상태에 반영됩니다." />
          <div className="field-grid two-column compact">
            <SelectField label="최소 도로폭" value={project.route.roadWidth} options={["4m 미만", "4m 이상", "6m 이상"]} onChange={(roadWidth) => updateSection("route", { roadWidth })} />
            <SelectField label="노면" value={project.route.surface} options={["포장", "비포장", "혼합"]} onChange={(surface) => updateSection("route", { surface })} />
            <SelectField label="경사" value={project.route.slope} options={["완만", "보통", "급경사"]} onChange={(slope) => updateSection("route", { slope })} />
            <TextField label="진입·운영 메모" value={project.route.accessNote} onChange={(accessNote) => updateSection("route", { accessNote })} />
          </div>
          <ConsentRow checked={project.route.confirmed} onChange={(confirmed) => updateSection("route", { confirmed })} title="실무자가 운반 경로를 확인했습니다" description="통행 가능 여부, 사토장 운영시간, 세륜 위치를 확인했습니다." emphasis />
          <div className={`route-status ${project.route.confirmed ? "confirmed" : "pending"}`}>
            <span aria-hidden="true">{project.route.confirmed ? "✓" : "!"}</span>
            <p><strong>{project.route.confirmed ? "경로 확인 완료" : "경로 확인 필요"}</strong>{project.route.confirmed ? "현장 시나리오가 최종 상태입니다." : "결과는 검토 중 상태로 표시됩니다."}</p>
          </div>
        </section>
      </div>
    );
  }

  function renderInvestigationStep(): ReactNode {
    return (
      <div className="content-stack">
        <section className="card investigation-hero">
          <div>
            <span className="eyebrow">조사 단계 선택</span>
            <h2>어떤 조사를 준비하고 있나요?</h2>
          </div>
          <div className="investigation-options">
            <button type="button" aria-pressed={project.investigation.type === "trial"} className={project.investigation.type === "trial" ? "selected" : ""} onClick={() => updateSection("investigation", { type: "trial", directExpenseRate: Math.min(project.rateSetSnapshot.directExpenseRatios.trial.max, Math.max(project.rateSetSnapshot.directExpenseRatios.trial.min, project.investigation.directExpenseRate)) })}><span>시굴</span><strong>시굴조사</strong><small>트렌치 중심의 유적 분포 확인</small></button>
            <button type="button" aria-pressed={project.investigation.type === "precision"} className={project.investigation.type === "precision" ? "selected" : ""} onClick={() => updateSection("investigation", { type: "precision", directExpenseRate: Math.min(project.rateSetSnapshot.directExpenseRatios.precision.max, Math.max(project.rateSetSnapshot.directExpenseRatios.precision.min, project.investigation.directExpenseRate)) })}><span>정밀</span><strong>정밀발굴조사</strong><small>유구 노출·기록·수습까지 반영</small></button>
          </div>
        </section>
        <section className="card form-card">
          <SectionTitle number="10" title="조사 조건" description="공식 참여인일 산정에 영향을 주는 현장 조건입니다." />
          <div className="field-grid three-column roomy">
            <NumberField label="조사 대상면적" value={project.investigation.area} suffix="㎡" onChange={(area) => updateSection("investigation", { area })} />
            <SelectField label="유적 종류" value={project.investigation.siteType} options={["생활유적", "석실·석곽분", "토광묘", "생산유적", "복합유적"]} onChange={(siteType) => updateSection("investigation", { siteType })} />
            <SelectField label="지형" value={project.investigation.terrain} options={["평지", "구릉지", "산지"]} onChange={(terrain) => updateSection("investigation", { terrain })} />
            <SelectField label="조사 여건" value={project.investigation.condition} options={["양호", "보통", "불량"]} onChange={(condition) => updateSection("investigation", { condition })} />
            <SelectField label="유물량" value={project.investigation.relicAmount} options={["적음", "보통", "많음"]} onChange={(relicAmount) => updateSection("investigation", { relicAmount })} />
            <SelectField label="유구 밀도" value={project.investigation.featureDensity} options={["낮음", "보통", "높음"]} onChange={(featureDensity) => updateSection("investigation", { featureDensity })} />
            <SelectField label="식별 난이도" value={project.investigation.visibility} options={["양호", "보통", "어려움"]} onChange={(visibility) => updateSection("investigation", { visibility })} />
            <SelectField label="유구 복잡도" value={project.investigation.complexity} options={["낮음", "보통", "높음"]} onChange={(complexity) => updateSection("investigation", { complexity })} />
            <NumberField label="문화층 수" value={project.investigation.layers} suffix="개 층" onChange={(layers) => updateSection("investigation", { layers: Math.max(1, Math.round(layers)) })} />
            {(project.investigation.siteType === "석실·석곽분" || project.investigation.siteType === "토광묘") && (
              <SelectField
                label="분묘 유형 보정"
                value={project.investigation.siteFactorVariant === "high" ? "높은 조건" : "낮은 조건"}
                options={["낮은 조건", "높은 조건"]}
                onChange={(value) => updateSection("investigation", { siteFactorVariant: value === "높은 조건" ? "high" : "low" })}
              />
            )}
          </div>
        </section>
        <section className="card overlap-card">
          <div><span className="eyebrow">공정 중첩</span><strong>토공과 조사 작업을 일부 겹치나요?</strong><p>기본은 안전한 순차 배치입니다. 실제 작업계획이 확정된 경우만 변경하세요.</p></div>
          <div className="range-field">
            <div><span>순차</span><b>{Math.round(project.investigation.earthworkOverlap * 100)}%</b><span>중첩</span></div>
            <input type="range" min="0" max="50" step="5" value={project.investigation.earthworkOverlap * 100} onChange={(event) => updateSection("investigation", { earthworkOverlap: Number(event.target.value) / 100 })} aria-label="토공과 조사 중첩률" />
          </div>
        </section>
        <section className="card form-card">
          <SectionTitle number="10A" title="공식 선택률" description="프로젝트에 고정한 단가세트의 허용 범위 안에서 선택합니다." />
          <div className="field-grid three-column roomy">
            <NumberField label={`직접경비 (${formatNumber(project.rateSetSnapshot.directExpenseRatios[project.investigation.type].min * 100, 0)}~${formatNumber(project.rateSetSnapshot.directExpenseRatios[project.investigation.type].max * 100, 0)}%)`} value={project.investigation.directExpenseRate * 100} suffix="%" onChange={(value) => { const range = project.rateSetSnapshot.directExpenseRatios[project.investigation.type]; updateSection("investigation", { directExpenseRate: Math.min(range.max, Math.max(range.min, value / 100)) }); }} />
            <NumberField label={`제경비 (${formatNumber(project.rateSetSnapshot.overheadRatio.min * 100, 0)}~${formatNumber(project.rateSetSnapshot.overheadRatio.max * 100, 0)}%)`} value={project.investigation.overheadRate * 100} suffix="%" onChange={(value) => updateSection("investigation", { overheadRate: Math.min(project.rateSetSnapshot.overheadRatio.max, Math.max(project.rateSetSnapshot.overheadRatio.min, value / 100)) })} />
            <NumberField label={`학술료 (${formatNumber(project.rateSetSnapshot.academicFeeRatio.min * 100, 0)}~${formatNumber(project.rateSetSnapshot.academicFeeRatio.max * 100, 0)}%)`} value={project.investigation.academicRate * 100} suffix="%" onChange={(value) => updateSection("investigation", { academicRate: Math.min(project.rateSetSnapshot.academicFeeRatio.max, Math.max(project.rateSetSnapshot.academicFeeRatio.min, value / 100)) })} />
          </div>
        </section>
        <section className="card vat-display-card">
          <div><span className="eyebrow">결과 표시 기준</span><strong>VAT 10%를 주요 합계에 포함할까요?</strong><p>산출표에는 별도·포함 금액을 항상 함께 표시합니다.</p></div>
          <div className="segmented" role="group" aria-label="VAT 표시 기준">
            <button type="button" aria-pressed={!project.investigation.vatIncluded} className={!project.investigation.vatIncluded ? "selected" : ""} onClick={() => updateSection("investigation", { vatIncluded: false })}>VAT 별도</button>
            <button type="button" aria-pressed={project.investigation.vatIncluded} className={project.investigation.vatIncluded ? "selected" : ""} onClick={() => updateSection("investigation", { vatIncluded: true })}>VAT 포함</button>
          </div>
        </section>
      </div>
    );
  }

  function renderTeamStep(): ReactNode {
    const crewCount = project.team.roles.reduce((sum, role) => sum + role.count, 0);
    const currentSamples = project.team.calibrationSamples.filter(
      (sample) => sample.investigationType === project.investigation.type,
    );
    const appliedCount = estimate.calibration.team.sampleCount;
    const personalCount = estimate.calibration.personal?.sampleCount ?? 0;
    return (
      <div className="content-stack">
        <section className="card form-card">
          <div className="team-heading-row">
            <SectionTitle number="11" title="역할별 배치" description="인원수는 현장일, 참여인일은 공식 직접인건비에 반영됩니다." />
            <div className="crew-total"><span>현장 인원</span><strong>{crewCount}<small>명</small></strong></div>
          </div>
          <div className="team-table" role="table" aria-label="역할별 팀 구성">
            <div className="team-row team-header" role="row"><span role="columnheader">역할</span><span role="columnheader">배치 인원</span><span role="columnheader">참여인일</span><span role="columnheader">적용 일단가</span></div>
            {project.team.roles.map((role) => (
              <div className="team-row" role="row" key={role.id}>
                <strong role="cell">{role.label}</strong>
                <label role="cell"><span className="visually-hidden">{role.label} 인원</span><input type="number" min="1" value={role.count} onChange={(event) => updateRole(role.id, { count: Math.max(1, Number(event.target.value) || 1) })} /><em>명</em></label>
                <output role="cell">{formatNumber((() => { const row = estimate.investigation.official.rolePersonDays.find((item) => item.role === role.id); return row ? row.fieldDays + row.fieldWeeklyHolidayDays + row.reportDays + row.reportWeeklyHolidayDays : 0; })(), 1)}<em>인일</em></output>
                <output role="cell">{formatNumber(estimate.investigation.official.rolePersonDays.find((item) => item.role === role.id)?.dailyRateKrw ?? role.dailyRate, 0)}<em>원</em></output>
              </div>
            ))}
          </div>
          <p className="table-note">{project.rateSetSnapshot.label} · {estimate.investigation.official.source.noticeNumber} · {project.rateSetSnapshot.effectiveFrom} 시행 · 프로젝트에 고정됨</p>
        </section>
        <section className="card calibration-card">
          <div className="calibration-copy">
            <span className="eyebrow">현장 감각 보정</span>
            <h2>“우리 팀이라면 며칠 걸릴까?”를 숫자로 남깁니다.</h2>
            <p>같은 조사유형의 완료사례가 3건 쌓이면, 실제일 ÷ 표준일의 가중 기하평균으로 다음 현장을 보정합니다.</p>
            <div className="field-grid two-column compact">
              <TextField label="팀 프로필 별칭" value={project.team.profileName} onChange={(profileName) => updateSection("team", { profileName })} />
              <TextField label="선택적 조사자 별칭" value={project.team.investigatorAlias} onChange={(investigatorAlias) => updateSection("team", { investigatorAlias })} hint="비우면 개인 보정을 계산하지 않습니다." />
            </div>
          </div>
          <div className="calibration-gauge">
            <div className="gauge-ring" style={{ "--gauge": `${Math.min(100, (appliedCount / 3) * 100)}%` } as React.CSSProperties}><strong>{appliedCount}<small>/3건</small></strong></div>
            <span>{estimate.calibration.team.applied ? "팀 자동 보정 적용 중" : "팀 보정까지 필요한 사례"}</span>
            <div className="calibration-factor"><span>팀 × 개인</span><b>{estimate.calibration.combinedFactor.toFixed(2)}</b></div>
            {project.team.investigatorAlias && <small className="personal-sample-count">개인 사례 {personalCount}건 · {estimate.calibration.personal?.applied ? "잔차 보정 적용" : "미적용"}</small>}
          </div>
        </section>
        {!estimate.calibration.team.applied && <div className="inline-warning"><b>아직 공식 기준을 사용합니다.</b> 같은 조사유형의 포함 사례 {Math.max(0, 3 - appliedCount)}건을 더 기록하면 팀 보정이 활성화됩니다.</div>}
        <section className="card calibration-history">
          <div className="history-heading">
            <div><span className="eyebrow">사용 사례 공개</span><h3>{project.investigation.type === "trial" ? "시굴조사" : "정밀발굴조사"} 완료사례 {currentSamples.length}건</h3><p>최근성과 품질가중치를 적용하며 제외한 사례는 계수에 쓰지 않습니다.</p></div>
            <button className="button secondary" type="button" disabled={!project.team.calibrationSamples.length} onClick={() => { if (window.confirm("이 기기의 팀·개인 완료사례를 모두 초기화할까요?")) updateSection("team", { calibrationSamples: [] }); }}>사례 초기화</button>
          </div>
          <div className="history-list">
            {currentSamples.length ? currentSamples.map((sample) => (
              <div className={`history-row ${sample.excluded ? "excluded" : ""}`} key={sample.id}>
                <span className="history-date">{sample.completedAt.slice(0, 7).replace("-", ".")}</span>
                <div><strong>{sample.actualDays}일 <small>/ 표준 {sample.standardDays}일</small></strong><span>비율 {(sample.actualDays / sample.standardDays).toFixed(2)} · 품질 {Math.round(sample.qualityWeight * 100)}%</span></div>
                <div className="history-person"><span>{sample.investigatorIds.length ? sample.investigatorAlias || "개인 별칭" : "팀 사례"}</span><small>{sample.investigatorIds.length ? `${sample.investigatorDays}일 참여` : "개인 미지정"}</small></div>
                <label className="include-toggle"><input type="checkbox" checked={!sample.excluded} onChange={(event) => updateCalibrationSample(sample.id, { excluded: !event.target.checked })} /><span>{sample.excluded ? "제외" : "포함"}</span></label>
              </div>
            )) : <p className="empty-history">이 조사유형의 완료사례가 없습니다. 완료실적 단계에서 첫 사례를 남겨 보세요.</p>}
          </div>
          {estimate.calibration.team.distribution && <div className="distribution-row"><span>과거 분포</span><b>P20 {estimate.calibration.team.distribution.p20.toFixed(2)}</b><b>중앙 {estimate.calibration.team.distribution.median.toFixed(2)}</b><b>P80 {estimate.calibration.team.distribution.p80.toFixed(2)}</b></div>}
        </section>
      </div>
    );
  }

  function renderWeatherStep(): ReactNode {
    const startDate = new Date(`${project.weather.startDate}T00:00:00`);
    const startDateLabel = Number.isFinite(startDate.getTime())
      ? startDate.toLocaleDateString("ko-KR", { month: "long", day: "numeric" })
      : "날짜 미정";
    return (
      <div className="content-stack">
        <section className="weather-overview">
          <div className="card weather-card weather-primary">
            <span>착수 예정</span><strong>{startDateLabel}</strong><small>{project.weather.station}</small>
          </div>
          <div className="card weather-card"><span>{estimate.weatherSchedule.mode === "historical" ? "최근 5년 중앙값" : "수동률 중앙값"}</span><strong>{estimate.weatherSchedule.medianWeatherNonWorkDays}<small>일</small></strong><em>달력 {estimate.medianCalendarDays}일</em></div>
          <div className="card weather-card"><span>{estimate.weatherSchedule.mode === "historical" ? "보수적 80분위" : "수동 보수 시나리오"}</span><strong>{estimate.p80WeatherNonWorkDays}<small>일</small></strong><em>달력 {estimate.p80CalendarDays}일</em></div>
        </section>
        <div className={`weather-data-status ${estimate.weatherSchedule.mode}`}>
          <span aria-hidden="true">{estimate.weatherSchedule.mode === "historical" ? "✓" : "i"}</span>
          <p>
            <strong>{estimate.weatherSchedule.mode === "historical" ? "ASOS 관측 범위 적용" : "수동 비작업률 적용"}</strong>
            {estimate.weatherSchedule.mode === "historical" && project.weather.observationSource
              ? `${project.weather.observationSource.stationName}(${project.weather.observationSource.stationId}) · 현장과 ${project.weather.observationSource.distanceKm.toFixed(1)}km · ${estimate.weatherSchedule.scenarios.length}개 완전연도`
              : "외부 자료가 없거나 입력과 출처가 달라 중앙값·보수값을 각각 코어 일정 엔진으로 계산했습니다."}
          </p>
          {project.weather.observations.length > 0 && <button type="button" onClick={() => updateSection("weather", { observations: [], observationSource: null })}>수동값으로 전환</button>}
        </div>
        {estimate.weatherSchedule.warnings.length > 0 && (
          <div className="weather-warning-list" aria-label="기상자료 경고">
            {estimate.weatherSchedule.warnings.map((warning) => <p key={warning}><b>확인</b>{warning}</p>)}
          </div>
        )}
        <section className="card form-card">
          <SectionTitle number="12" title="착수월과 관측지점" description="최근접 ASOS의 최근 5개 완전연도 같은 달을 비교합니다." />
          <div className="field-grid three-column roomy">
            <TextField label="착수 예정일" type="date" value={project.weather.startDate} onChange={(startDate) => updateSection("weather", { startDate, observations: [], observationSource: null })} />
            <TextField label="최근접 관측지점" value={project.weather.station} onChange={() => undefined} readOnly hint="현장 좌표와 KMA ASOS 97개 지점의 대권거리로 선택" action={<button type="button" onClick={() => tryExternalLookup("weather")} disabled={lookupBusy}>좌표로 찾기</button>} />
            <NumberField label="공휴일·기타 추가 중단" value={project.weather.otherLostDays} suffix="일" onChange={(otherLostDays) => updateSection("weather", { otherLostDays: Math.max(0, otherLostDays) })} hint="주말·기상일과 겹치지 않는 순증분만 입력" />
          </div>
          <div className="field-grid two-column compact manual-weather-fields">
            <NumberField label="수동 중앙 비작업일" value={project.weather.medianLostDays} suffix="일 / 22작업일" onChange={(medianLostDays) => updateSection("weather", { medianLostDays: Math.max(0, medianLostDays) })} hint="API 키가 없거나 조회에 실패할 때 적용" />
            <NumberField label="수동 보수 비작업일" value={project.weather.p80LostDays} suffix="일 / 22작업일" onChange={(p80LostDays) => updateSection("weather", { p80LostDays: Math.max(0, p80LostDays) })} hint="일정 위험 검토용 시나리오" />
          </div>
          <ConsentRow checked={project.weather.externalLookup} onChange={(externalLookup) => updateSection("weather", { externalLookup })} title="기상 관측자료 조회 허용" description="현장 좌표는 로컬 레지스트리와만 비교하고, 관측소 번호와 조회기간만 외부 API로 전송합니다." />
        </section>
        <section className="card form-card">
          <SectionTitle number="13" title="토공사 비작업 기준" description="발굴조사 법정 가산율이 아닌 2026 적정 공사기간 가이드의 참고 템플릿입니다." badge="검토 필요" />
          <div className="threshold-grid">
            <ThresholdField icon="☂" label="일강수량" value={project.weather.rainMm} unit="mm 이상" onChange={(rainMm) => updateSection("weather", { rainMm })} />
            <ThresholdField icon="°" label="체감온도" value={project.weather.feelsLikeC} unit="℃ 이상" onChange={(feelsLikeC) => updateSection("weather", { feelsLikeC })} />
            <ThresholdField icon="–" label="최저기온" value={project.weather.minimumC} unit="℃ 이하" onChange={(minimumC) => updateSection("weather", { minimumC })} />
            <ThresholdField icon="❄" label="신적설" value={project.weather.snowCm} unit="cm 이상" onChange={(snowCm) => updateSection("weather", { snowCm })} />
            <ThresholdField icon="↝" label="최대순간풍속" value={project.weather.gustMs} unit="m/s 이상" onChange={(gustMs) => updateSection("weather", { gustMs })} />
          </div>
          <ConsentRow checked={project.weather.policyConfirmed} onChange={(policyConfirmed) => updateSection("weather", { policyConfirmed })} title="이 현장의 참고 기준으로 적용합니다" description="하루에 여러 기준을 넘더라도 비작업일은 한 번만 셉니다." emphasis />
        </section>
        <section className="card standby-card">
          <div><span className="eyebrow">계약상 대기요율</span><strong>날씨는 체적과 공식 대가를 바꾸지 않습니다.</strong><p>대기요율을 입력한 현장 시나리오 비용과 달력일에만 반영합니다.</p></div>
          <div className="field-grid two-column compact">
            <NumberField label="장비 대기요율" value={project.weather.equipmentStandbyRate * 100} suffix="%" onChange={(value) => updateSection("weather", { equipmentStandbyRate: value / 100 })} />
            <NumberField label="인력 대기요율" value={project.weather.laborStandbyRate * 100} suffix="%" onChange={(value) => updateSection("weather", { laborStandbyRate: value / 100 })} />
          </div>
        </section>
      </div>
    );
  }

  function renderResultStep(): ReactNode {
    const confidence = project.survey.method === "surface" && project.route.confirmed && project.weather.policyConfirmed ? "검토 완료" : "조건부 견적";
    const publicBenchmark = project.publicBenchmarkSnapshot;
    const conditionalInverse = publicBenchmark
      ? estimate.investigation.official.rolePersonDays.map((row) => {
        const label = project.team.roles.find((role) => role.id === row.role)?.label ?? row.role;
        const targetDays = Math.max(0.01, publicBenchmark.registeredDurationDays.p50);
        return `${label} ${Math.max(1, Math.ceil(row.fieldDays / targetDays))}명`;
      }).join(" · ")
      : "";
    return (
      <div className="content-stack result-page">
        <section className="result-hero card">
          <div>
            <span className="eyebrow">{confidence}</span>
            <h2>{project.name}</h2>
            <p>{project.location.address} · {project.investigation.type === "trial" ? "시굴조사" : "정밀발굴조사"} {formatNumber(project.investigation.area, 0)}㎡</p>
            <p className="export-privacy-notice">프로젝트 JSON에는 원본 측점 CSV와 경계 GeoJSON이 포함됩니다. 민감한 현장자료로 관리하세요.</p>
          </div>
          <div className="result-actions">
            <button className="button secondary" type="button" onClick={exportProject}>프로젝트 JSON</button>
            <button className="button secondary" type="button" onClick={exportCsv}>결과 CSV</button>
            <button className="button primary" type="button" onClick={() => window.print()}>인쇄 · PDF</button>
          </div>
        </section>
        <section className="headline-metrics">
          <div className="metric-panel"><span>총 운반량</span><strong>{formatNumber(estimate.looseVolume)}<small>㎥</small></strong><em>자연토 {formatNumber(estimate.naturalVolume)}㎥</em></div>
          <div className="metric-panel"><span>덤프 운반</span><strong>{formatNumber(estimate.totalTrips, 0)}<small>회</small></strong><em>{estimate.haul.fleetSize}대 · 하루 {estimate.tripsPerTruckDay}회/대</em></div>
          <div className="metric-panel featured"><span>순수 현장 작업</span><strong>{estimate.fieldDays}<small>일</small></strong><em>토공 {estimate.earthworkDays}일 + 조사 {estimate.calibratedInvestigationDays}일</em></div>
          <div className="metric-panel"><span>예상 달력일</span><strong>{estimate.medianCalendarDays}<small>일</small></strong><em>80분위 {estimate.p80CalendarDays}일</em></div>
        </section>
        <section className="timeline-card card">
          <div className="timeline-heading"><span><b>예상 일정</b><small>중앙값 기준</small></span><strong>{estimate.medianCalendarDays}일 + 보고서 {estimate.reportDays}일</strong></div>
          <div className="timeline-bars">
            <div style={{ width: `${Math.max(16, (estimate.earthworkDays / (estimate.fieldDays + estimate.reportDays)) * 100)}%` }} className="bar earth"><span>토공</span><b>{estimate.earthworkDays}일</b></div>
            <div style={{ width: `${Math.max(20, (estimate.calibratedInvestigationDays / (estimate.fieldDays + estimate.reportDays)) * 100)}%` }} className="bar dig"><span>현장조사</span><b>{estimate.calibratedInvestigationDays}일</b></div>
            <div style={{ width: `${Math.max(18, ((estimate.weatherSchedule.medianWeatherNonWorkDays + project.weather.otherLostDays) / (estimate.fieldDays + estimate.reportDays)) * 100)}%` }} className="bar wait"><span>중단</span><b>{estimate.weatherSchedule.medianWeatherNonWorkDays + project.weather.otherLostDays}일</b></div>
            <div style={{ flex: 1 }} className="bar report"><span>정리·보고서</span><b>{estimate.reportDays}일</b></div>
          </div>
        </section>

        {publicBenchmark && <section className="public-benchmark-card card">
          <div className="public-benchmark-heading">
            <div>
              <span className="eyebrow">공개 허가자료 · 익명 집계</span>
              <h3>{publicBenchmark.areaBandLabel} · {publicBenchmark.n.toLocaleString("ko-KR")}건</h3>
            </div>
            <span className="confidence-chip">설명통계 · 낮은 신뢰</span>
          </div>
          <div className="public-benchmark-grid">
            <div><span>대장 기재 발굴기간</span><strong>{publicBenchmark.registeredDurationDays.p20} · {publicBenchmark.registeredDurationDays.p50} · {publicBenchmark.registeredDurationDays.p80}<small>일</small></strong><em>20 · 50 · 80분위</em></div>
            <div><span>착수~완료 경과일</span><strong>{publicBenchmark.elapsedCalendarDays.p20} · {publicBenchmark.elapsedCalendarDays.p50} · {publicBenchmark.elapsedCalendarDays.p80}<small>일</small></strong><em>20 · 50 · 80분위</em></div>
            <div><span>현재 공식식 현장일</span><strong>{formatNumber(estimate.investigation.standardFieldDays, 2)}<small>일</small></strong><em>현재 입력조건·팀 배치</em></div>
          </div>
          <p>2021~2025년 국가유산청 발굴허가대장을 식별정보 없이 집계했습니다. 대장 기간은 순수 작업일이 아니며, 현재 결과와의 근접성을 모델 정확도나 실제 팀 구성의 증거로 해석하지 않습니다.</p>
          <p><strong>조건부 역산</strong> · 대장 중앙값 {publicBenchmark.registeredDurationDays.p50}일을 중단 없는 현장 가용일로 가정한 현재 공식 조건의 최소 동시배치 하한: {conditionalInverse}. 실제 투입인원의 복원이 아닙니다.</p>
          <p className="public-benchmark-source">
            <a href={publicBenchmark.sourceUrl} target="_blank" rel="noreferrer">{publicBenchmark.sourceTitle}</a>
            <span>{publicBenchmark.sourceSnapshotDate} 스냅샷 · {publicBenchmark.licenseLabel} · 집계 {publicBenchmark.version}</span>
          </p>
        </section>}

        <div className="ledger-grid">
          <LedgerCard tone="official" eyebrow="LEDGER 01" title="공식 대가기준" subtitle="조사인력·경비·학술료" total={project.investigation.vatIncluded ? estimate.investigation.official.totalIncludingVatKrw.selected : estimate.officialSubtotal} rows={[
            ["직접인건비", estimate.directLabor], ["주휴수당", estimate.weeklyAllowance], ["직접경비", estimate.directExpense], ["제경비", estimate.overhead], ["학술료", estimate.academic], ["VAT 10%", estimate.vat], ["VAT 포함", estimate.investigation.official.totalIncludingVatKrw.selected],
          ]} note={`${estimate.investigation.official.source.noticeNumber} · ${project.rateSetSnapshot.effectiveFrom} 시행 · 고정본`} taxLabel={project.investigation.vatIncluded ? "VAT 포함" : "VAT 별도"} />
          <LedgerCard tone="earth" eyebrow="LEDGER 02" title="표준 토공원가" subtitle="체적·장비·운반" total={estimate.standardEarthwork} rows={[
            ["흐트러진 토량", `${formatNumber(estimate.looseVolume)}㎥`], ["1회 적재량", `${formatNumber(estimate.loadPerTrip, 2)}㎥`], ["운반 횟수", `${estimate.totalTrips}회`], ["병목 공정", estimate.bottleneck],
          ]} note="코어 운반 엔진 · 입력 장비단가 적용" />
          <LedgerCard tone="scenario" eyebrow="LEDGER 03" title="현장 시나리오" subtitle="팀·경로·날씨 반영" total={estimate.fieldScenario} rows={[
            ["순수 현장일", `${estimate.fieldDays}일`], ["달력일 중앙값", `${estimate.medianCalendarDays}일`], ["달력일 80분위", `${estimate.p80CalendarDays}일`], ["팀·개인 보정계수", estimate.calibration.team.applied ? estimate.calibration.combinedFactor.toFixed(2) : "미적용"],
          ]} note="대기요율 포함 · 공식 대가와 별도" />
        </div>

        <section className="card official-range-card">
          <div className="official-range-heading"><div><span className="eyebrow">공식 범위</span><h3>단일가격이 아닌 최저·선택·최고값</h3></div><small>단위: 원 · VAT 10%</small></div>
          <div className="official-range-table" role="table" aria-label="공식 대가 최저 선택 최고 범위">
            <div className="official-range-row header" role="row"><span role="columnheader">항목</span><span role="columnheader">최저</span><span role="columnheader">선택</span><span role="columnheader">최고</span></div>
            {[
              ["직접경비", estimate.investigation.official.directExpenseKrw],
              ["제경비", estimate.investigation.official.overheadKrw],
              ["학술료", estimate.investigation.official.academicFeeKrw],
              ["VAT 별도 소계", estimate.investigation.official.subtotalExcludingVatKrw],
              ["VAT", estimate.investigation.official.vatKrw],
              ["VAT 포함 합계", estimate.investigation.official.totalIncludingVatKrw],
            ].map(([label, range]) => {
              const values = range as { min: number; selected: number; max: number };
              return <div className="official-range-row" role="row" key={label as string}><strong role="cell">{label as string}</strong><span role="cell">{formatNumber(values.min, 0)}</span><span className="selected-value" role="cell">{formatNumber(values.selected, 0)}</span><span role="cell">{formatNumber(values.max, 0)}</span></div>;
            })}
          </div>
        </section>

        <section className="result-detail-grid">
          <div className="card assumptions-card">
            <SectionTitle number="A" title="핵심 산식과 가정" description="결과 파일에도 같은 내용이 보존됩니다." />
            <ul>
              <li><span>토량</span><p>자연토 {formatNumber(estimate.naturalVolume)}㎥ × L {project.soil.swellFactor} = 흐트러진 토량 {formatNumber(estimate.looseVolume)}㎥</p></li>
              <li><span>적재</span><p>중량·용적 제한 중 작은 값 {formatNumber(estimate.loadPerTrip, 2)}㎥/회 적용</p></li>
              <li><span>배차</span><p>{formatNumber(estimate.cycleMinutes, 0)}분/회 × {estimate.haul.fleetSize}대, 총 {estimate.totalTrips}회</p></li>
              <li><span>공기</span><p>토공과 조사 {Math.round(project.investigation.earthworkOverlap * 100)}% 중첩, 기상 중앙값 {estimate.weatherSchedule.medianWeatherNonWorkDays}일</p></li>
            </ul>
          </div>
          <div className="card warnings-card">
            <SectionTitle number="!" title="확인할 사항" description="확정 견적 전에 현장 담당자가 검토하세요." />
            <ul>
              {project.survey.method === "manual" && <li><span>측량</span><p>체적이 수동 입력값입니다. 상·하면 측량자료로 교체하면 신뢰도가 올라갑니다.</p></li>}
              {!project.route.confirmed && <li><span>경로</span><p>대형차 통행과 사토장 운영시간이 아직 확인되지 않았습니다.</p></li>}
              {!project.weather.policyConfirmed && <li><span>날씨</span><p>참고 비작업 기준 적용을 아직 확인하지 않았습니다.</p></li>}
              <li><span>비용</span><p>공식 직접경비와 현장 장비비를 합산할 때 이중계상을 피하세요.</p></li>
            </ul>
          </div>
        </section>

        <section className="sources-card card">
          <span className="eyebrow">적용 출처</span>
          <div>
            <a href="https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=2100000271724&chrClsCd=010201" target="_blank" rel="noreferrer"><b>매장유산 조사용역 대가의 기준</b><small>별표 4·5 · 시행일 확인 필요</small><span>↗</span></a>
            <a href="https://www.codil.or.kr/helpdesk/read.do?bbsId=BBSMSTR_900000000202&nttId=13261" target="_blank" rel="noreferrer"><b>2026 건설공사 표준품셈</b><small>토량환산계수·장비 생산성</small><span>↗</span></a>
            <a href="https://www.codil.or.kr/filebank/files/202605/helpdesk/BBS_202605070900377281.pdf?atchFileId=FILE_000000000011068&fileSn=1" target="_blank" rel="noreferrer"><b>2026 적정 공사기간 가이드라인</b><small>토공사 기상 참고기준</small><span>↗</span></a>
          </div>
          <p>이 계산서는 참고용 추정 결과이며 법적 측량성과, 대형차 운행허가 또는 확정 견적을 대신하지 않습니다.</p>
        </section>
      </div>
    );
  }

  function renderActualStep(): ReactNode {
    const loggedQuantity = project.actual.logs.reduce((sum, log) => sum + log.quantity, 0);
    const actualFactor = project.actual.actualWorkDays / Math.max(1, estimate.investigationDays);
    return (
      <div className="content-stack">
        <section className="actual-intro card">
          <div><span className="eyebrow">완료 후 3분</span><h2>이번 현장의 감을 다음 견적에 남기세요.</h2><p>완료값은 이 기기에만 저장되며 개인 평가나 기관 간 순위에 쓰이지 않습니다.</p></div>
          <label className="complete-toggle"><input type="checkbox" checked={project.actual.completed} onChange={(event) => updateSection("actual", { completed: event.target.checked })} /><span>{project.actual.completed ? "완료 현장" : "진행 중"}</span></label>
        </section>
        <section className="card form-card">
          <SectionTitle number="14" title="완료 요약" description="일지가 없더라도 완료값만으로 팀 보정 사례를 만들 수 있습니다." />
          <div className="field-grid four-column roomy">
            <NumberField label="실제 조사 작업일" value={project.actual.actualWorkDays} suffix="일" onChange={(actualWorkDays) => updateSection("actual", { actualWorkDays })} />
            <NumberField label="실제 달력일" value={project.actual.actualCalendarDays} suffix="일" onChange={(actualCalendarDays) => updateSection("actual", { actualCalendarDays })} />
            <NumberField label="실제 토량" value={project.actual.actualVolume} suffix="㎥" onChange={(actualVolume) => updateSection("actual", { actualVolume })} />
            <NumberField label="실제 운반" value={project.actual.actualTrips} suffix="회" onChange={(actualTrips) => updateSection("actual", { actualTrips })} />
            <NumberField label="기상 중단" value={project.actual.weatherLostDays} suffix="일" onChange={(weatherLostDays) => updateSection("actual", { weatherLostDays })} />
            <NumberField label="기타 중단" value={project.actual.otherLostDays} suffix="일" onChange={(otherLostDays) => updateSection("actual", { otherLostDays })} />
            <NumberField label="사례 품질" value={project.actual.qualityWeight * 100} suffix="%" onChange={(value) => updateSection("actual", { qualityWeight: value / 100 })} />
            <SelectField label="보정 사용" value={project.actual.excluded ? "제외" : "포함"} options={["포함", "제외"]} onChange={(value) => updateSection("actual", { excluded: value === "제외" })} />
            <TextField label="선택적 조사자 별칭" value={project.actual.investigatorAlias} onChange={(investigatorAlias) => updateSection("actual", { investigatorAlias })} />
            <NumberField label="조사자 실제 참여일" value={project.actual.investigatorDays} suffix="일" onChange={(investigatorDays) => updateSection("actual", { investigatorDays })} />
            <NumberField label="실제 총 참여인일" value={project.actual.actualPersonDays} suffix="인일" onChange={(actualPersonDays) => updateSection("actual", { actualPersonDays })} />
            <NumberField label="실제 장비일" value={project.actual.actualEquipmentDays} suffix="장비·일" onChange={(actualEquipmentDays) => updateSection("actual", { actualEquipmentDays })} />
          </div>
          <div className="actual-comparison">
            <div><span>표준 현장일</span><strong>{estimate.investigationDays}일</strong></div><span>→</span><div><span>실제 현장일</span><strong>{project.actual.actualWorkDays}일</strong></div><div className={actualFactor <= 1 ? "faster" : "slower"}><span>사례 계수</span><strong>{actualFactor.toFixed(2)}</strong></div>
          </div>
        </section>
        <section className="card log-card">
          <div className="log-heading"><SectionTitle number="15" title="선택 일지" description={`현재 ${project.actual.logs.length}일 · 작업량 ${formatNumber(loggedQuantity)}㎥`} /><button className="button secondary" type="button" onClick={addDailyLog}>+ 작업일 추가</button></div>
          <div className="daily-log-list">
            {project.actual.logs.map((log, index) => (
              <div className="daily-log-row" key={log.id}>
                <span className="log-day">D{String(index + 1).padStart(2, "0")}</span>
                <label><span>날짜</span><input type="date" value={log.date} onChange={(event) => updateLog(log.id, { date: event.target.value })} /></label>
                <label><span>작업</span><input value={log.workType} onChange={(event) => updateLog(log.id, { workType: event.target.value })} /></label>
                <label><span>작업량 ㎥</span><input type="number" value={log.quantity} onChange={(event) => updateLog(log.id, { quantity: Number(event.target.value) })} /></label>
                <label><span>인원</span><input type="number" value={log.people} onChange={(event) => updateLog(log.id, { people: Number(event.target.value) })} /></label>
                <label><span>장비 h</span><input type="number" value={log.equipmentHours} onChange={(event) => updateLog(log.id, { equipmentHours: Number(event.target.value) })} /></label>
                <label><span>중단</span><input value={log.interruption} onChange={(event) => updateLog(log.id, { interruption: event.target.value })} /></label>
                <button type="button" aria-label={`${index + 1}일차 일지 삭제`} onClick={() => updateSection("actual", { logs: project.actual.logs.filter((item) => item.id !== log.id) })}>×</button>
              </div>
            ))}
          </div>
        </section>
        <section className="calibration-save card">
          <div><span className="eyebrow">다음 견적에 반영</span><strong>{project.team.profileName} · {project.investigation.type === "trial" ? "시굴조사" : "정밀발굴조사"}</strong><p>{project.actual.excluded ? "이 사례는 기록만 하고 자동 보정에서 제외합니다." : `저장하면 이 조사유형의 완료사례가 ${project.team.calibrationSamples.filter((sample) => sample.investigationType === project.investigation.type).length + 1}건이 됩니다.`}</p></div>
          <button className="button primary" type="button" disabled={!project.actual.completed || project.team.calibrationSamples.some((sample) => sample.id === `actual-${project.id}`)} onClick={saveCompletedCase}>{project.team.calibrationSamples.some((sample) => sample.id === `actual-${project.id}`) ? "저장된 완료사례" : project.actual.completed ? "완료사례 저장" : "현장 완료 후 저장"}</button>
        </section>
      </div>
    );
  }
}

function SectionTitle({ number, title, description, badge }: { number: string; title: string; description: string; badge?: string }) {
  return <div className="section-title"><span>{number}</span><div><h2>{title}{badge && <em>{badge}</em>}</h2><p>{description}</p></div></div>;
}

function TextField({ label, value, onChange, hint, action, type = "text", readOnly = false }: { label: string; value: string; onChange: (value: string) => void; hint?: string; action?: ReactNode; type?: string; readOnly?: boolean }) {
  return <label className="field"><span className="field-label">{label}</span><span className={`input-shell ${action ? "has-action" : ""}`}><input type={type} value={value} readOnly={readOnly} onChange={(event) => onChange(event.target.value)} />{action}</span>{hint && <small>{hint}</small>}</label>;
}

function NumberField({ label, value, onChange, suffix, hint, decimals }: { label: string; value: number; onChange: (value: number) => void; suffix?: string; hint?: string; decimals?: number }) {
  const step = decimals === undefined ? 1 : 1 / 10 ** decimals;
  return <label className="field"><span className="field-label">{label}</span><span className={`input-shell ${suffix ? "has-suffix" : ""}`}><input type="number" step={step} value={Number.isFinite(value) ? value : 0} onChange={(event) => onChange(Number(event.target.value))} />{suffix && <b>{suffix}</b>}</span>{hint && <small>{hint}</small>}</label>;
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label className="field"><span className="field-label">{label}</span><span className="input-shell select-shell"><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option}>{option}</option>)}</select><span aria-hidden="true">⌄</span></span></label>;
}

function ConsentRow({ checked, onChange, title, description, emphasis }: { checked: boolean; onChange: (checked: boolean) => void; title: string; description: string; emphasis?: boolean }) {
  return <label className={`consent-row ${emphasis ? "emphasis" : ""}`}><input aria-label={title} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span className="switch" aria-hidden="true"><i /></span><span><strong>{title}</strong><small>{description}</small></span></label>;
}

function FileDrop({ label, fileName, detail, accept, onChange, wide }: { label: string; fileName: string; detail: string; accept: string; onChange: (event: ChangeEvent<HTMLInputElement>) => void; wide?: boolean }) {
  return <label className={`file-drop ${fileName ? "has-file" : ""} ${wide ? "wide" : ""}`}><input type="file" accept={accept} onChange={onChange} /><span className="file-icon" aria-hidden="true">{fileName ? "✓" : "+"}</span><strong>{fileName || label}</strong><small>{detail}</small><em>{fileName ? "교체" : "파일 선택"}</em></label>;
}

function ThresholdField({ icon, label, value, unit, onChange }: { icon: string; label: string; value: number; unit: string; onChange: (value: number) => void }) {
  return <label className="threshold-field"><span aria-hidden="true">{icon}</span><strong>{label}</strong><span className="threshold-input"><input type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} /><small>{unit}</small></span></label>;
}

function Metric({ label, value, unit, accent, large }: { label: string; value: string; unit: string; accent?: boolean; large?: boolean }) {
  return <div className={`metric ${accent ? "accent" : ""} ${large ? "large" : ""}`}><span>{label}</span><strong>{value}<small>{unit}</small></strong></div>;
}

function LedgerCard({ tone, eyebrow, title, subtitle, total, rows, note, taxLabel = "VAT 별도" }: { tone: string; eyebrow: string; title: string; subtitle: string; total: number; rows: Array<[string, number | string]>; note: string; taxLabel?: string }) {
  return <article className={`ledger-card card ${tone}`}><div className="ledger-heading"><span>{eyebrow}</span><h3>{title}</h3><p>{subtitle}</p></div><dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{typeof value === "number" ? formatCurrency(value) : value}</dd></div>)}</dl><div className="ledger-total"><span>예상 합계</span><strong>{formatCurrency(total)}</strong><small>{taxLabel}</small></div><p className="ledger-note">{note}</p></article>;
}
