import type {
  HaulCalculationInput,
  HaulCalculationResult,
  SoilBatch,
  SoilVolumeResult,
} from "./types.ts";
import { assertValid, finitePositive, ratio } from "./validation.ts";

export function convertSoilVolume(batch: SoilBatch): SoilVolumeResult {
  finitePositive(batch.volumeM3, "volumeM3", true);
  finitePositive(batch.looseFactorL, "looseFactorL");
  finitePositive(batch.compactionFactorC, "compactionFactorC");
  finitePositive(batch.naturalWetDensityTonnesPerM3, "naturalWetDensityTonnesPerM3");
  const naturalVolumeM3 = batch.state === "natural"
    ? batch.volumeM3
    : batch.state === "loose"
      ? batch.volumeM3 / batch.looseFactorL
      : batch.volumeM3 / batch.compactionFactorC;
  const looseVolumeM3 = naturalVolumeM3 * batch.looseFactorL;
  const compactedVolumeM3 = naturalVolumeM3 * batch.compactionFactorC;
  const massTonnes = naturalVolumeM3 * batch.naturalWetDensityTonnesPerM3;
  const looseDensityTonnesPerM3 = massTonnes / looseVolumeM3;
  const compactedDensityTonnesPerM3 = massTonnes / compactedVolumeM3;
  const massFromLoose = looseVolumeM3 * looseDensityTonnesPerM3;
  const massFromCompacted = compactedVolumeM3 * compactedDensityTonnesPerM3;
  return {
    naturalVolumeM3,
    looseVolumeM3,
    compactedVolumeM3,
    massTonnes,
    naturalDensityTonnesPerM3: batch.naturalWetDensityTonnesPerM3,
    looseDensityTonnesPerM3,
    compactedDensityTonnesPerM3,
    massConservationErrorTonnes: Math.max(
      Math.abs(massTonnes - massFromLoose),
      Math.abs(massTonnes - massFromCompacted),
    ),
    formulas: [
      "L = 흐트러진 체적 / 자연상태 체적",
      "C = 다짐 체적 / 자연상태 체적",
      "질량 = 자연상태 체적 × 자연상태 습윤밀도 (모든 상태에서 보존)",
    ],
  };
}

function validateHaulInput(input: HaulCalculationInput): void {
  finitePositive(input.looseVolumeM3, "looseVolumeM3", true);
  finitePositive(input.looseDensityTonnesPerM3, "looseDensityTonnesPerM3");
  finitePositive(input.truck.payloadTonnes, "truck.payloadTonnes");
  finitePositive(input.truck.bedVolumeM3, "truck.bedVolumeM3");
  ratio(input.truck.weightLoadFactor, "truck.weightLoadFactor", false);
  ratio(input.truck.volumeLoadFactor, "truck.volumeLoadFactor", false);
  finitePositive(input.workMinutesPerDay, "workMinutesPerDay");
  ratio(input.operatingEfficiency, "operatingEfficiency", false);
  finitePositive(input.route.oneWayDistanceKm, "route.oneWayDistanceKm", true);
  [
    "loadMinutes",
    "siteEntryMinutes",
    "coverMinutes",
    "washMinutes",
    "loadedTravelMinutes",
    "dumpMinutes",
    "emptyReturnMinutes",
    "queueMinutes",
  ].forEach((key) => finitePositive(input.route[key as keyof typeof input.route] as number, `route.${key}`, true));
  const fleetSize = input.fleetSize ?? input.truck.fleetSize;
  assertValid(Number.isInteger(fleetSize) && fleetSize > 0, "fleetSize", "invalid_fleet", "차량대수는 1 이상의 정수여야 합니다.");
  if (input.targetDays !== undefined) {
    assertValid(Number.isInteger(input.targetDays) && input.targetDays > 0, "targetDays", "invalid_days", "목표일수는 1 이상의 정수여야 합니다.");
  }
  if (input.equipment) {
    finitePositive(input.equipment.productionM3PerHour, "equipment.productionM3PerHour");
    ratio(input.equipment.efficiency, "equipment.efficiency", false);
  }
}

export function calculateHaul(input: HaulCalculationInput): HaulCalculationResult {
  validateHaulInput(input);
  const massLimitedLoadM3 = input.truck.payloadTonnes * input.truck.weightLoadFactor / input.looseDensityTonnesPerM3;
  const volumeLimitedLoadM3 = input.truck.bedVolumeM3 * input.truck.volumeLoadFactor;
  const loadPerTripM3 = Math.min(massLimitedLoadM3, volumeLimitedLoadM3);
  const limitingConstraint = massLimitedLoadM3 <= volumeLimitedLoadM3 ? "mass" : "volume";
  const totalLoadedTrips = input.looseVolumeM3 === 0 ? 0 : Math.ceil(input.looseVolumeM3 / loadPerTripM3);
  const cycleMinutes =
    input.route.loadMinutes +
    input.route.siteEntryMinutes +
    input.route.coverMinutes +
    input.route.washMinutes +
    input.route.loadedTravelMinutes +
    input.route.dumpMinutes +
    input.route.emptyReturnMinutes +
    input.route.queueMinutes;
  finitePositive(cycleMinutes, "route.cycleMinutes");
  const openMinutes = input.route.disposalSiteOpenMinutesPerDay === undefined
    ? input.workMinutesPerDay
    : Math.min(input.workMinutesPerDay, input.route.disposalSiteOpenMinutesPerDay);
  finitePositive(openMinutes, "route.disposalSiteOpenMinutesPerDay");
  const tripsPerTruckDay = Math.floor(openMinutes * input.operatingEfficiency / cycleMinutes);
  assertValid(tripsPerTruckDay >= 1, "route", "cycle_exceeds_workday", "입력한 작업시간과 효율로는 차량이 하루 1회도 운행할 수 없습니다.");
  const fleetSize = input.fleetSize ?? input.truck.fleetSize;
  const requiredFleetForTarget = input.targetDays === undefined
    ? undefined
    : Math.max(1, Math.ceil(totalLoadedTrips / (tripsPerTruckDay * input.targetDays)));
  const vehicleFleetCapacityM3PerDay = tripsPerTruckDay * fleetSize * loadPerTripM3;
  const equipmentCapacityM3PerDay = input.equipment
    ? input.equipment.productionM3PerHour * input.equipment.efficiency * input.workMinutesPerDay / 60
    : undefined;
  const effectiveCapacityM3PerDay = equipmentCapacityM3PerDay === undefined
    ? vehicleFleetCapacityM3PerDay
    : Math.min(vehicleFleetCapacityM3PerDay, equipmentCapacityM3PerDay);
  const vehicleOnlyDays = totalLoadedTrips === 0 ? 0 : Math.ceil(totalLoadedTrips / (tripsPerTruckDay * fleetSize));
  const estimatedDays = input.looseVolumeM3 === 0 ? 0 : Math.ceil(input.looseVolumeM3 / effectiveCapacityM3PerDay);
  const bottleneck: HaulCalculationResult["bottleneck"] = equipmentCapacityM3PerDay === undefined
    ? "vehicles"
    : Math.abs(vehicleFleetCapacityM3PerDay - equipmentCapacityM3PerDay) / Math.max(vehicleFleetCapacityM3PerDay, equipmentCapacityM3PerDay) <= .01
      ? "balanced"
      : vehicleFleetCapacityM3PerDay < equipmentCapacityM3PerDay
        ? "vehicles"
        : "equipment";
  const lastTripLoadM3 = totalLoadedTrips === 0
    ? 0
    : input.looseVolumeM3 - loadPerTripM3 * (totalLoadedTrips - 1);
  const standardTruckCost = (input.truck.standardDailyRateKrw ?? 0) * fleetSize * estimatedDays;
  const standardEquipmentCost = (input.equipment?.standardDailyRateKrw ?? 0) * estimatedDays;
  const scenarioTruckRate = input.truck.actualDailyRateKrw ?? input.truck.standardDailyRateKrw ?? 0;
  const scenarioEquipmentRate = input.equipment?.actualDailyRateKrw ?? input.equipment?.standardDailyRateKrw ?? 0;
  const warnings: string[] = [];
  if (!input.route.heavyTruckConfirmed) {
    warnings.push("도로폭·경사·포장·중량제한·현장 진입·사토장 운영시간을 실무자가 확인해야 합니다.");
  }
  if (input.route.source === "kakao_car_reference") {
    warnings.push("Kakao 자동차 길찾기는 승용차 기준 참고값이며 대형차 전용 경로나 운행허가 판단이 아닙니다.");
  }
  if (!input.truck.turningSpaceConfirmed) warnings.push("현장 및 사토장의 회차공간을 확인하지 않았습니다.");
  if (
    input.truck.grossWeightLimitTonnes !== undefined &&
    input.truck.curbWeightTonnes !== undefined &&
    input.truck.curbWeightTonnes + input.truck.payloadTonnes * input.truck.weightLoadFactor > input.truck.grossWeightLimitTonnes
  ) {
    warnings.push("입력 적재중량과 공차중량의 합이 입력 총중량 한도를 넘습니다. 예비 경고이며 운행허가 판단이 아닙니다.");
  }
  if (requiredFleetForTarget !== undefined && equipmentCapacityM3PerDay !== undefined) {
    const targetEquipmentCapacity = equipmentCapacityM3PerDay * (input.targetDays as number);
    if (targetEquipmentCapacity + 1e-9 < input.looseVolumeM3) {
      warnings.push("차량을 늘려도 입력 굴삭기 생산성으로는 목표일수를 달성할 수 없습니다.");
    }
  }
  return {
    massLimitedLoadM3,
    volumeLimitedLoadM3,
    loadPerTripM3,
    limitingConstraint,
    totalLoadedTrips,
    cycleMinutes,
    tripsPerTruckDay,
    fleetSize,
    ...(requiredFleetForTarget !== undefined ? { requiredFleetForTarget } : {}),
    vehicleFleetCapacityM3PerDay,
    ...(equipmentCapacityM3PerDay !== undefined ? { equipmentCapacityM3PerDay } : {}),
    effectiveCapacityM3PerDay,
    vehicleOnlyDays,
    estimatedDays,
    bottleneck,
    lastTripLoadM3,
    lastTripLoadRatio: totalLoadedTrips === 0 ? 0 : lastTripLoadM3 / loadPerTripM3,
    totalDistanceKm: totalLoadedTrips * input.route.oneWayDistanceKm * 2,
    standardCostKrw: Math.round(standardTruckCost + standardEquipmentCost),
    scenarioCostKrw: Math.round((scenarioTruckRate * fleetSize + scenarioEquipmentRate) * estimatedDays),
    warnings,
    formulas: [
      "q_mass = 유효적재중량 × 중량적재율 / 흐트러진토 밀도",
      "q_volume = 적재함용적 × 용적적재율",
      "q_trip = min(q_mass, q_volume)",
      "총 적재운행 = ceil(흐트러진체적 / q_trip)",
      "일일 회전수 = floor(작업분 × 효율 / 사이클분)",
    ],
  };
}
