import { OFFICIAL_RATE_SOURCE_2026, RATE_SET_2026 } from "./rates-2026.ts";
import type {
  EquipmentProfile,
  HaulRoute,
  InvestigationEstimateInput,
  RateSourceMetadata,
  SoilBatch,
  TeamProfile,
  TruckProfile,
  WeatherPolicy,
} from "./types.ts";

export const DEFAULT_SOIL_BATCH: SoilBatch = {
  id: "soil-1",
  name: "적치토",
  soilType: "보통토사",
  volumeM3: 1_000,
  state: "natural",
  looseFactorL: 1.25,
  compactionFactorC: .9,
  naturalWetDensityTonnesPerM3: 1.8,
};

export const DEFAULT_TRUCK_PROFILE: TruckProfile = {
  id: "truck-15t",
  name: "15톤 덤프트럭(등록값 확인 필요)",
  payloadTonnes: 15,
  bedVolumeM3: 12,
  weightLoadFactor: 1,
  volumeLoadFactor: 1,
  fleetSize: 3,
  turningSpaceConfirmed: false,
};

export const DEFAULT_EQUIPMENT_PROFILE: EquipmentProfile = {
  id: "excavator-1",
  name: "굴삭기",
  bucketVolumeM3: 1,
  productionM3PerHour: 90,
  efficiency: .75,
};

export const DEFAULT_HAUL_ROUTE: HaulRoute = {
  oneWayDistanceKm: 10,
  loadMinutes: 8,
  siteEntryMinutes: 3,
  coverMinutes: 2,
  washMinutes: 3,
  loadedTravelMinutes: 20,
  dumpMinutes: 5,
  emptyReturnMinutes: 18,
  queueMinutes: 5,
  source: "manual",
  heavyTruckConfirmed: false,
};

export const DEFAULT_TEAM_PROFILE: TeamProfile = {
  id: "team-1",
  name: "기본 조사팀",
  roleCounts: {
    director: 1,
    supervisor: 1,
    researcher: 2,
    assistantResearcher: 2,
    assistant: 2,
    laborer: 4,
  },
};

export const DEFAULT_INVESTIGATION_INPUT: InvestigationEstimateInput = {
  investigationType: "trial",
  areaM2: 1_000,
  conditions: {
    terrain: "flat",
    surveyConditions: "good",
    siteType: "living",
    soilDifficulty: "easy",
    findsLevel: "low",
    featureDensity: "low",
    identificationDifficulty: "easy",
    featureComplexity: "easy",
    layers: 1,
    siteFactorVariant: "low",
  },
  team: DEFAULT_TEAM_PROFILE,
  rateSet: RATE_SET_2026,
  directExpenseMode: "ratio",
  selectedDirectExpenseRatio: 2.1,
  selectedOverheadRatio: 1.05,
  selectedAcademicFeeRatio: .25,
  vatRate: .1,
  earthworkDays: 0,
  overlapRate: 0,
  overlapConfirmed: false,
  productivityFactor: 1,
  reinstatementCostKrw: 0,
  safetyCostKrw: 0,
};

export const WEATHER_GUIDELINE_SOURCE_2026: RateSourceMetadata = {
  id: "molit-construction-duration-guide-2026",
  title: "2026년 적정 공사기간 확보를 위한 가이드라인",
  authority: "국토교통부·한국건설기술연구원",
  noticeNumber: "2026 적정 공사기간 가이드라인",
  publishedOn: "2026-05-07",
  effectiveFrom: "2026-01-01",
  url: "https://www.codil.or.kr/filebank/files/202605/helpdesk/BBS_202605070900377281.pdf?atchFileId=FILE_000000000011068&fileSn=1",
  checksumSha256: "not-bundled-source-document",
  status: "reviewed",
  notes: [
    "토공사 예시 기준이며 매장유산 발굴조사의 법정 공기 가산율이 아니다.",
    "사용자가 현장 적용 전 확인해야 한다.",
  ],
};

export const DEFAULT_WEATHER_POLICY: WeatherPolicy = {
  id: "earthwork-reference-2026",
  name: "토공사 비작업일 참고 템플릿",
  precipitationThresholdMm: 5,
  apparentTemperatureThresholdC: 33,
  minimumTemperatureThresholdC: 0,
  newSnowThresholdCm: 5,
  maxInstantWindThresholdMps: 15,
  workingWeekdays: [1, 2, 3, 4, 5],
  historyYears: 5,
  legalRate: false,
  confirmedByUser: false,
  source: WEATHER_GUIDELINE_SOURCE_2026,
};

export const CORE_DEFAULTS = {
  soilBatch: DEFAULT_SOIL_BATCH,
  truck: DEFAULT_TRUCK_PROFILE,
  equipment: DEFAULT_EQUIPMENT_PROFILE,
  haulRoute: DEFAULT_HAUL_ROUTE,
  team: DEFAULT_TEAM_PROFILE,
  investigation: DEFAULT_INVESTIGATION_INPUT,
  weather: DEFAULT_WEATHER_POLICY,
  rateSet: RATE_SET_2026,
  officialRateSource: OFFICIAL_RATE_SOURCE_2026,
} as const;
