"use client";

import { useEffect, useRef } from "react";
import Feature, { type FeatureLike } from "ol/Feature";
import GeoJSON from "ol/format/GeoJSON";
import Map from "ol/Map";
import View from "ol/View";
import Point from "ol/geom/Point";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import { fromLonLat } from "ol/proj";
import OSM from "ol/source/OSM";
import VectorSource from "ol/source/Vector";
import { Circle as CircleStyle, Fill, Stroke, Style } from "ol/style";

interface ProjectMapProps {
  latitude: number;
  longitude: number;
  areaM2: number;
  parcelReferenceGeoJson: string;
  allowExternalMap: boolean;
}

function makeFeatures(longitude: number, latitude: number, parcelReferenceGeoJson: string) {
  const [centerX, centerY] = fromLonLat([longitude, latitude]);
  const marker = new Feature({ kind: "marker", geometry: new Point([centerX, centerY]) });
  if (!parcelReferenceGeoJson) return [marker];
  try {
    const geometry = JSON.parse(parcelReferenceGeoJson) as unknown;
    const [parcel] = new GeoJSON().readFeatures(
      { type: "Feature", properties: {}, geometry },
      { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" },
    );
    if (!parcel) return [marker];
    parcel.set("kind", "parcel");
    return [parcel, marker];
  } catch {
    return [marker];
  }
}

const featureStyle = (feature: FeatureLike) => {
  const kind = feature.get("kind") as string;
  if (kind === "parcel") {
    return new Style({
      fill: new Fill({ color: "rgba(216, 106, 50, 0.19)" }),
      stroke: new Stroke({ color: "#d86a32", width: 2.5, lineDash: [7, 4] }),
    });
  }
  if (kind === "marker") {
    return new Style({
      image: new CircleStyle({
        radius: 8,
        fill: new Fill({ color: "#d86a32" }),
        stroke: new Stroke({ color: "#173d3b", width: 5 }),
      }),
    });
  }
  return undefined;
};

export default function ProjectMap({ latitude, longitude, areaM2, parcelReferenceGeoJson, allowExternalMap }: ProjectMapProps) {
  const targetRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const sourceRef = useRef(new VectorSource());
  const baseLayerRef = useRef<TileLayer<OSM> | null>(null);

  useEffect(() => {
    if (!targetRef.current || mapRef.current) return;
    const baseLayer = new TileLayer<OSM>();
    baseLayerRef.current = baseLayer;
    mapRef.current = new Map({
      target: targetRef.current,
      layers: [baseLayer, new VectorLayer({ source: sourceRef.current, style: featureStyle })],
      view: new View({ center: [0, 0], zoom: 18.2, minZoom: 15, maxZoom: 21 }),
      controls: [],
    });
    return () => {
      mapRef.current?.setTarget(undefined);
      mapRef.current = null;
      baseLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    baseLayerRef.current?.setSource(
      allowExternalMap
        ? new OSM({
            attributions: "© OpenStreetMap contributors",
            maxZoom: 19,
          })
        : null,
    );
  }, [allowExternalMap]);

  useEffect(() => {
    const center = fromLonLat([longitude, latitude]);
    sourceRef.current.clear();
    const features = makeFeatures(longitude, latitude, parcelReferenceGeoJson);
    sourceRef.current.addFeatures(features);
    const parcel = features.find((feature) => feature.get("kind") === "parcel");
    if (parcel?.getGeometry()) {
      mapRef.current?.getView().fit(parcel.getGeometry()!.getExtent(), {
        padding: [52, 52, 52, 52],
        maxZoom: 19,
        duration: 280,
      });
    } else {
      mapRef.current?.getView().animate({ center, zoom: 18.2, duration: 280 });
    }
  }, [latitude, longitude, parcelReferenceGeoJson]);

  return (
    <div className="openlayers-shell">
      <div ref={targetRef} className="openlayers-map" role="img" aria-label={parcelReferenceGeoJson ? "입력 좌표와 VWorld 연속지적도 참고경계" : "입력 좌표 개략 위치"} />
      <div className="map-grid-overlay" aria-hidden="true" />
      <div className="parcel-map-label"><span>{parcelReferenceGeoJson ? "VWorld 참고경계" : "입력 좌표 표시"}</span><b>조사면적 {areaM2.toLocaleString("ko-KR")}㎡</b></div>
      <div className="map-scale">50 m</div>
      <div className="map-coordinates">{latitude.toFixed(4)}, {longitude.toFixed(4)}</div>
    </div>
  );
}
