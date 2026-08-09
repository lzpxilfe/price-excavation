import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Coordinate = { longitude: number; latitude: number };

function validCoordinate(value: Coordinate) {
  return (
    Number.isFinite(value.longitude) &&
    Number.isFinite(value.latitude) &&
    Math.abs(value.longitude) <= 180 &&
    Math.abs(value.latitude) <= 90
  );
}

export async function POST(request: Request) {
  const key = process.env.KAKAO_MOBILITY_REST_KEY;
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > 4_096) {
    return NextResponse.json({ error: "경로 요청이 너무 큽니다." }, { status: 413 });
  }
  const body = (await request.json().catch(() => null)) as
    | { consent?: boolean; origin?: Coordinate; destination?: Coordinate }
    | null;

  if (!body?.consent) {
    return NextResponse.json({ error: "외부 경로 조회 동의가 필요합니다." }, { status: 400 });
  }
  if (!body.origin || !body.destination || !validCoordinate(body.origin) || !validCoordinate(body.destination)) {
    return NextResponse.json({ error: "유효한 출발지와 도착지가 필요합니다." }, { status: 400 });
  }
  if (!key) {
    return NextResponse.json(
      { error: "Kakao Mobility 키가 없어 거리와 시간을 수동 입력해야 합니다." },
      { status: 503 },
    );
  }

  const endpoint = new URL("https://apis-navi.kakaomobility.com/v1/directions");
  endpoint.search = new URLSearchParams({
    origin: `${body.origin.longitude},${body.origin.latitude}`,
    destination: `${body.destination.longitude},${body.destination.latitude}`,
    priority: "RECOMMEND",
    summary: "true",
  }).toString();

  try {
    const response = await fetch(endpoint, {
      headers: { Authorization: `KakaoAK ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Kakao ${response.status}`);
    const payload = (await response.json()) as {
      routes?: Array<{ result_code?: number; summary?: { distance?: number; duration?: number } }>;
    };
    const summary = payload.routes?.[0]?.summary;
    if (!summary) throw new Error("missing route");
    return NextResponse.json({
      provider: "Kakao Mobility 자동차 길찾기",
      passengerCarRoute: true,
      requiresFieldConfirmation: true,
      distanceKm: (summary.distance ?? 0) / 1000,
      durationMinutes: (summary.duration ?? 0) / 60,
      notice: "승용차 경로 초깃값입니다. 대형차 통행조건과 현장 진입을 반드시 확인하세요.",
    });
  } catch {
    return NextResponse.json(
      { error: "경로 조회에 실패했습니다. 확인한 편도거리와 시간을 직접 입력해 주세요." },
      { status: 502 },
    );
  }
}
