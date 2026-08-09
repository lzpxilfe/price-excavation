import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const longitude = Number(url.searchParams.get("longitude"));
  const latitude = Number(url.searchParams.get("latitude"));
  const consent = url.searchParams.get("consent") === "true";
  const key = process.env.VWORLD_API_KEY;

  if (!consent) {
    return NextResponse.json({ error: "외부 필지 조회 동의가 필요합니다." }, { status: 400 });
  }
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || longitude < 122 || longitude > 132 || latitude < 30 || latitude > 44) {
    return NextResponse.json({ error: "대한민국 인근의 유효한 경위도가 필요합니다." }, { status: 400 });
  }
  if (!key) {
    return NextResponse.json({ error: "VWorld API 키가 설정되지 않았습니다." }, { status: 503 });
  }

  const endpoint = new URL("https://api.vworld.kr/req/data");
  endpoint.search = new URLSearchParams({
    service: "data",
    request: "GetFeature",
    data: "LP_PA_CBND_BUBUN",
    key,
    format: "json",
    errorformat: "json",
    crs: "EPSG:4326",
    geomFilter: `POINT(${longitude} ${latitude})`,
    geometry: "true",
    attribute: "true",
    size: "10",
  }).toString();

  try {
    const response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`VWorld ${response.status}`);
    const payload = await response.json();
    return NextResponse.json({
      provider: "VWorld 연속지적도",
      referenceOnly: true,
      notice: "조회용 도면정보이며 측량성과 또는 법적 경계가 아닙니다.",
      data: payload,
    });
  } catch {
    return NextResponse.json(
      { error: "필지 조회에 실패했습니다. GeoJSON 가져오기 또는 지도 그리기를 사용해 주세요." },
      { status: 502 },
    );
  }
}
