/// <reference lib="webworker" />

import { calculateVolume, parseBoundaryGeoJson, parseSurveyCsv } from "@/packages/core/src";
import type {
  BoundaryGeoJsonOptions,
  SurveyCsvOptions,
  VolumeCalculationInput,
} from "@/packages/core/src";

type VolumeWorkerRequest = {
  topCsv: string;
  baseCsv: string;
  boundaryGeoJson: string;
  topOptions: SurveyCsvOptions;
  baseOptions: SurveyCsvOptions;
  boundaryOptions: BoundaryGeoJsonOptions;
  baseMode: "surface" | "control" | "constant";
  constantElevationM?: number;
  calculationOptions?: Pick<VolumeCalculationInput, "gridCellSizeM" | "coverageThreshold" | "stockpilePositiveOnly">;
};

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (event: MessageEvent<VolumeWorkerRequest>) => {
  try {
    self.postMessage({ type: "progress", progress: 0.1, message: "상부면을 읽는 중" });
    const top = parseSurveyCsv(event.data.topCsv, event.data.topOptions);
    self.postMessage({ type: "progress", progress: 0.3, message: "기준면을 읽는 중" });
    const parsedBase = event.data.baseMode === "constant"
      ? null
      : parseSurveyCsv(event.data.baseCsv, event.data.baseOptions);
    const base = event.data.baseMode === "constant"
      ? {
          kind: "constant" as const,
          elevationM: event.data.constantElevationM ?? 0,
          verticalDatum: event.data.topOptions.verticalDatum,
        }
      : event.data.baseMode === "control"
        ? {
            kind: "control_points" as const,
            points: parsedBase!.points,
            crs: parsedBase!.crs,
            verticalDatum: parsedBase!.verticalDatum,
          }
        : parsedBase!;
    self.postMessage({ type: "progress", progress: 0.5, message: "경계를 확인하는 중" });
    const boundary = parseBoundaryGeoJson(event.data.boundaryGeoJson, event.data.boundaryOptions);
    self.postMessage({ type: "progress", progress: 0.65, message: "공통 표면을 계산하는 중" });
    const result = calculateVolume({ top, base, boundary, ...event.data.calculationOptions });
    self.postMessage({ type: "complete", result, pointCounts: { top: top.points.length, base: parsedBase?.points.length ?? 0 } });
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : "체적 계산에 실패했습니다." });
  }
};

export {};
