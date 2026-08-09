export const PROJECT_SCHEMA_VERSION = "1.0.0" as const;
export const MAX_SURVEY_POINTS = 50_000;

export type ProjectSchemaVersion = typeof PROJECT_SCHEMA_VERSION;
export type SurfaceRole = "top" | "base" | "base_control";
export type HorizontalUnit = "m" | "ft" | "degree";
export type VerticalUnit = "m" | "ft";
export type BoundarySource = "survey" | "cadastral_reference" | "drawn";
export type ConfidenceLevel = "high" | "medium" | "low";
export type DataStatus = "draft" | "reviewed" | "published" | "superseded";
export type InvestigationType = "trial" | "precision";
export type SoilState = "natural" | "loose" | "compacted";

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

export interface SurveyPoint {
  x: number;
  y: number;
  z: number;
  pointId?: string;
}

export interface SurveyCsvColumnMapping {
  x: string;
  y: string;
  z: string;
  pointId?: string;
  surface?: string;
}

export interface SurveySurface {
  id: string;
  name: string;
  role: SurfaceRole;
  points: SurveyPoint[];
  crs: string;
  sourceCrs: string;
  horizontalUnit: "m";
  sourceHorizontalUnit: HorizontalUnit;
  verticalUnit: "m";
  sourceVerticalUnit: VerticalUnit;
  verticalDatum: string;
  accuracyM?: number;
  columnMapping: SurveyCsvColumnMapping;
  transformedFromGeographic: boolean;
}

export interface SurveyCsvOptions {
  id?: string;
  name?: string;
  role: SurfaceRole;
  crs: string;
  horizontalUnit: HorizontalUnit;
  verticalUnit: VerticalUnit;
  verticalDatum: string;
  accuracyM?: number;
  columns?: Partial<SurveyCsvColumnMapping>;
  surfaceValue?: string;
  delimiter?: "," | ";" | "\t";
  maxPoints?: number;
}

export type Position = [number, number];
export type LinearRing = Position[];
export type PolygonCoordinates = LinearRing[];
export type MultiPolygonCoordinates = PolygonCoordinates[];

export interface PolygonGeometry {
  type: "Polygon";
  coordinates: PolygonCoordinates;
}

export interface MultiPolygonGeometry {
  type: "MultiPolygon";
  coordinates: MultiPolygonCoordinates;
}

export type BoundaryGeometry = PolygonGeometry | MultiPolygonGeometry;

export interface Boundary {
  id: string;
  name: string;
  source: BoundarySource;
  geometry: BoundaryGeometry;
  crs: string;
  sourceCrs: string;
  horizontalUnit: "m";
  sourceHorizontalUnit: HorizontalUnit;
  transformedFromGeographic: boolean;
  areaM2: number;
}

export interface BoundaryGeoJsonOptions {
  id?: string;
  name?: string;
  source: BoundarySource;
  crs: string;
  horizontalUnit: HorizontalUnit;
}

export interface ConstantBase {
  kind: "constant";
  elevationM: number;
  verticalDatum: string;
}

export interface ControlPointBase {
  kind: "control_points";
  points: SurveyPoint[];
  crs: string;
  verticalDatum: string;
}

export type VolumeBase = SurveySurface | ConstantBase | ControlPointBase;

export interface VolumeCalculationInput {
  top: SurveySurface;
  base: VolumeBase;
  boundary: Boundary;
  gridCellSizeM?: number;
  coverageThreshold?: number;
  stockpilePositiveOnly?: boolean;
  maxTinPoints?: number;
}

export interface VolumeCalculationResult {
  method: "common_xy_tin" | "deterministic_grid";
  confidence: ConfidenceLevel;
  fillVolumeM3: number;
  cutVolumeM3: number;
  netVolumeM3: number;
  stockpileVolumeM3: number;
  boundaryAreaM2: number;
  topCoverageRatio: number;
  baseCoverageRatio: number;
  gridCellSizeM?: number;
  numericalErrorM3: number;
  processedElementCount: number;
  warnings: string[];
  formula: string;
}

export interface SoilBatch {
  id: string;
  name: string;
  soilType: string;
  volumeM3: number;
  state: SoilState;
  looseFactorL: number;
  compactionFactorC: number;
  naturalWetDensityTonnesPerM3: number;
}

export interface SoilVolumeResult {
  naturalVolumeM3: number;
  looseVolumeM3: number;
  compactedVolumeM3: number;
  massTonnes: number;
  naturalDensityTonnesPerM3: number;
  looseDensityTonnesPerM3: number;
  compactedDensityTonnesPerM3: number;
  massConservationErrorTonnes: number;
  formulas: string[];
}

export interface TruckProfile {
  id: string;
  name: string;
  payloadTonnes: number;
  curbWeightTonnes?: number;
  bedVolumeM3: number;
  weightLoadFactor: number;
  volumeLoadFactor: number;
  fleetSize: number;
  standardDailyRateKrw?: number;
  actualDailyRateKrw?: number;
  grossWeightLimitTonnes?: number;
  axleLoadLimitTonnes?: number;
  widthM?: number;
  heightM?: number;
  turningSpaceConfirmed?: boolean;
}

export interface EquipmentProfile {
  id: string;
  name: string;
  bucketVolumeM3?: number;
  productionM3PerHour: number;
  efficiency: number;
  standardDailyRateKrw?: number;
  actualDailyRateKrw?: number;
}

export interface HaulRoute {
  oneWayDistanceKm: number;
  loadMinutes: number;
  siteEntryMinutes: number;
  coverMinutes: number;
  washMinutes: number;
  loadedTravelMinutes: number;
  dumpMinutes: number;
  emptyReturnMinutes: number;
  queueMinutes: number;
  disposalSiteOpenMinutesPerDay?: number;
  source: "manual" | "kakao_car_reference";
  heavyTruckConfirmed: boolean;
}

export interface HaulCalculationInput {
  looseVolumeM3: number;
  looseDensityTonnesPerM3: number;
  truck: TruckProfile;
  route: HaulRoute;
  equipment?: EquipmentProfile;
  workMinutesPerDay: number;
  operatingEfficiency: number;
  fleetSize?: number;
  targetDays?: number;
}

export interface HaulCalculationResult {
  massLimitedLoadM3: number;
  volumeLimitedLoadM3: number;
  loadPerTripM3: number;
  limitingConstraint: "mass" | "volume";
  totalLoadedTrips: number;
  cycleMinutes: number;
  tripsPerTruckDay: number;
  fleetSize: number;
  requiredFleetForTarget?: number;
  vehicleFleetCapacityM3PerDay: number;
  equipmentCapacityM3PerDay?: number;
  effectiveCapacityM3PerDay: number;
  vehicleOnlyDays: number;
  estimatedDays: number;
  bottleneck: "vehicles" | "equipment" | "balanced";
  lastTripLoadM3: number;
  lastTripLoadRatio: number;
  totalDistanceKm: number;
  standardCostKrw: number;
  scenarioCostKrw: number;
  warnings: string[];
  formulas: string[];
}

export type InvestigatorRole =
  | "director"
  | "supervisor"
  | "researcher"
  | "assistantResearcher"
  | "assistant";
export type WorkforceRole = InvestigatorRole | "laborer";
export type InvestigationStage =
  | "preparation"
  | "topsoilRemoval"
  | "featureExposure"
  | "featureExcavation"
  | "recording"
  | "closeout";

export interface RateSourceMetadata {
  id: string;
  title: string;
  authority: string;
  noticeNumber: string;
  publishedOn: string;
  effectiveFrom: string;
  effectiveTo?: string;
  url: string;
  checksumSha256: string;
  status: DataStatus;
  notes: string[];
}

export interface RateSet {
  id: string;
  label: string;
  effectiveFrom: string;
  effectiveTo?: string;
  currency: "KRW";
  unit: "person_day";
  region: "KR";
  vatIncluded: false;
  status: DataStatus;
  investigatorDailyRatesKrw: Record<InvestigatorRole, number>;
  laborerDailyRateKrw: number;
  directExpenseRatios: Record<InvestigationType, { min: number; max: number }>;
  overheadRatio: { min: number; max: number };
  academicFeeRatio: { min: number; max: number };
  sources: RateSourceMetadata[];
}

export interface TeamProfile {
  id: string;
  name: string;
  roleCounts: Record<WorkforceRole, number>;
}

export interface InvestigatorProfile {
  id: string;
  alias: string;
  teamId: string;
  enabled: boolean;
}

export type PrecisionSiteType =
  | "living"
  | "production"
  | "architecture"
  | "fortress"
  | "paleolithic"
  | "tomb_stone"
  | "tomb_pit"
  | "cultivation"
  | "other";

export interface InvestigationConditions {
  terrain: "mountain" | "flat";
  surveyConditions: "poor" | "good";
  siteType: PrecisionSiteType;
  soilDifficulty: "difficult" | "easy";
  findsLevel: "high" | "medium" | "low";
  featureDensity: "high" | "medium" | "low";
  identificationDifficulty: "difficult" | "easy";
  featureComplexity: "difficult" | "easy";
  layers: 1 | 2 | 3;
  siteFactorVariant: "high" | "low";
}

export interface InvestigationEstimateInput {
  investigationType: InvestigationType;
  areaM2: number;
  conditions: InvestigationConditions;
  team: TeamProfile;
  rateSet?: RateSet;
  directExpenseMode: "ratio" | "itemized";
  selectedDirectExpenseRatio?: number;
  itemizedDirectExpenseKrw?: number;
  selectedOverheadRatio?: number;
  selectedAcademicFeeRatio?: number;
  vatRate?: number;
  earthworkDays?: number;
  overlapRate?: number;
  overlapConfirmed?: boolean;
  productivityFactor?: number;
  reinstatementCostKrw?: number;
  safetyCostKrw?: number;
}

export interface RolePersonDays {
  role: WorkforceRole;
  fieldDays: number;
  fieldWeeklyHolidayDays: number;
  reportDays: number;
  reportWeeklyHolidayDays: number;
  dailyRateKrw: number;
  fieldCostKrw: number;
  reportCostKrw: number;
  totalCostKrw: number;
}

export interface CostRange {
  min: number;
  selected: number;
  max: number;
}

export interface OfficialCostLedger {
  directLaborKrw: number;
  laborerReferenceCostKrw: number;
  directExpenseKrw: CostRange;
  overheadKrw: CostRange;
  academicFeeKrw: CostRange;
  subtotalExcludingVatKrw: CostRange;
  vatKrw: CostRange;
  totalIncludingVatKrw: CostRange;
  reinstatementCostKrw: number;
  safetyCostKrw: number;
  rolePersonDays: RolePersonDays[];
  formulas: string[];
  warnings: string[];
  source: RateSourceMetadata;
}

export interface InvestigationEstimateResult {
  investigationType: InvestigationType;
  areaM2: number;
  official: OfficialCostLedger;
  standardFieldDays: number;
  personalizedFieldDays: number;
  reportWorkDays: number;
  earthworkDays: number;
  combinedOnSiteDays: number;
  confidence: ConfidenceLevel;
  warnings: string[];
}

export interface WeatherPolicy {
  id: string;
  name: string;
  precipitationThresholdMm?: number;
  apparentTemperatureThresholdC?: number;
  minimumTemperatureThresholdC?: number;
  newSnowThresholdCm?: number;
  maxInstantWindThresholdMps?: number;
  workingWeekdays: number[];
  historyYears: number;
  legalRate: false;
  confirmedByUser: boolean;
  source: RateSourceMetadata;
}

export interface WeatherObservation {
  date: string;
  precipitationMm?: number;
  apparentTemperatureMaxC?: number;
  minimumTemperatureC?: number;
  newSnowCm?: number;
  maxInstantWindMps?: number;
}

export interface WeatherCalculationInput {
  startDate: string;
  fieldWorkDays: number;
  observations?: WeatherObservation[];
  policy: WeatherPolicy;
  holidayDates?: string[];
  otherNonWorkDates?: string[];
  manualWeatherNonWorkRate?: number;
  standbyCostKrwPerWeatherDay?: number;
  asOfDate?: string;
}

export interface WeatherYearScenario {
  sourceYear: number;
  calendarDays: number;
  workDays: number;
  weekendDays: number;
  holidayDays: number;
  weatherNonWorkDays: number;
  otherNonWorkDays: number;
  weatherDates: string[];
  weatherReasonCounts: Record<string, number>;
  observationCoverageRatio: number;
}

export interface WeatherScheduleResult {
  mode: "historical" | "manual_rate";
  scenarios: WeatherYearScenario[];
  medianCalendarDays: number;
  p80CalendarDays: number;
  medianWeatherNonWorkDays: number;
  p80WeatherNonWorkDays: number;
  medianFinishDate: string;
  p80FinishDate: string;
  standbyCostKrw: { median: number; p80: number };
  warnings: string[];
  policySource: RateSourceMetadata;
}

export interface DailyLog {
  date: string;
  completedAreaM2?: number;
  movedVolumeM3?: number;
  teamHours?: number;
  equipmentHours?: number;
  loadedTrips?: number;
  weatherStopped: boolean;
  otherStopReason?: string;
}

export interface ActualProject {
  id: string;
  name: string;
  investigationType: InvestigationType;
  completedAt: string;
  teamId: string;
  investigatorIds?: string[];
  areaM2: number;
  volumeM3?: number;
  featureDensity?: number;
  soilType?: string;
  standardFieldDays: number;
  actualFieldDays: number;
  rolePersonDays?: Partial<Record<WorkforceRole, number>>;
  equipmentDays?: number;
  loadedTrips?: number;
  weatherStoppedDays?: number;
  otherStoppedDays?: number;
  qualityWeight?: number;
  excluded?: boolean;
  logs?: DailyLog[];
}

export interface CalibrationFactorResult {
  applied: boolean;
  factor: number;
  sampleCount: number;
  includedProjectIds: string[];
  excludedProjectIds: string[];
  effectiveWeight: number;
  distribution?: { p20: number; median: number; p80: number };
}

export interface CalibrationSnapshot {
  id: string;
  createdAt: string;
  investigationType: InvestigationType;
  teamId: string;
  investigatorId?: string;
  team: CalibrationFactorResult;
  personal?: CalibrationFactorResult;
  combinedFactor: number;
  priorWeight: number;
  recencyHalfLifeDays: number;
  method: "quality_recency_weighted_geometric_mean";
  warnings: string[];
}

export interface CalibrationInput {
  actualProjects: ActualProject[];
  investigationType: InvestigationType;
  teamId: string;
  investigatorId?: string;
  asOfDate?: string;
  priorWeight?: number;
  recencyHalfLifeDays?: number;
  minSamples?: number;
  distributionMinSamples?: number;
  id?: string;
}

export interface EstimateResult {
  calculatedAt: string;
  official: OfficialCostLedger;
  standardEarthwork: HaulCalculationResult | null;
  fieldScenario: {
    investigation: InvestigationEstimateResult;
    weather: WeatherScheduleResult | null;
    calibration: CalibrationSnapshot | null;
    scenarioCostKrw: number;
  };
  assumptions: string[];
  warnings: string[];
  sourceSnapshot: RateSet;
}

export interface ExcavationProject {
  schemaVersion: ProjectSchemaVersion;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  locale: "ko-KR";
  currency: "KRW";
  location: {
    address: string;
    latitude?: number;
    longitude?: number;
    externalLookupEnabled: boolean;
  };
  survey: {
    surfaces: SurveySurface[];
    boundary: Boundary | null;
    gridCellSizeM?: number;
  };
  soilBatches: SoilBatch[];
  trucks: TruckProfile[];
  equipment: EquipmentProfile[];
  route: HaulRoute;
  investigation: InvestigationEstimateInput;
  weatherPolicy: WeatherPolicy;
  weatherStartDate: string;
  actualProjects: ActualProject[];
  investigators: InvestigatorProfile[];
  calibrations: CalibrationSnapshot[];
  rateSetSnapshot: RateSet;
  estimate: EstimateResult | null;
  notices: string[];
}

export interface PexcSurveyFileBundle {
  topCsv: string;
  baseCsv: string;
  boundaryGeoJson: string;
}

/** Versioned exchange envelope. The web UI uses its migration-safe draft as TProject. */
export interface PexcProjectFile<TProject = ExcavationProject> {
  format: "price-excavation-project";
  schemaVersion: ProjectSchemaVersion;
  exportedAt: string;
  project: TProject;
  surveyFiles: PexcSurveyFileBundle;
  estimate: EstimateResult;
  notices: string[];
}
