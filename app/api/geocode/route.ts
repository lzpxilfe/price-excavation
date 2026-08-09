import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type VWorldItem = {
  id?: string;
  title?: string;
  address?: { road?: string; parcel?: string };
  point?: { x?: string; y?: string };
};

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > 4_096) {
    return NextResponse.json({ error: "주소 요청이 너무 큽니다." }, { status: 413 });
  }
  const body = (await request.json().catch(() => null)) as { query?: string; consent?: boolean } | null;
  const query = body?.query?.trim();
  const consent = body?.consent === true;
  const key = process.env.VWORLD_API_KEY;

  if (!consent) {
    return NextResponse.json(
      { error: "외부 주소 조회 동의가 필요합니다." },
      { status: 400 },
    );
  }
  if (!query || query.length < 2 || query.length > 200) {
    return NextResponse.json({ error: "주소를 2~200자로 입력해 주세요." }, { status: 400 });
  }
  if (!key) {
    return NextResponse.json(
      { error: "VWorld API 키가 없어 수동 위치 입력을 사용해야 합니다." },
      { status: 503 },
    );
  }

  const endpoint = new URL("https://api.vworld.kr/req/search");
  endpoint.search = new URLSearchParams({
    service: "search",
    request: "search",
    version: "2.0",
    size: "8",
    page: "1",
    query,
    type: "address",
    category: "road",
    format: "json",
    errorformat: "json",
    key,
  }).toString();

  try {
    const response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`VWorld ${response.status}`);
    const payload = (await response.json()) as {
      response?: { status?: string; result?: { items?: VWorldItem[] } };
    };
    const items = payload.response?.result?.items ?? [];
    return NextResponse.json({
      provider: "VWorld",
      items: items.map((item) => ({
        id: item.id ?? crypto.randomUUID(),
        title: item.title ?? item.address?.road ?? item.address?.parcel ?? query,
        roadAddress: item.address?.road ?? "",
        parcelAddress: item.address?.parcel ?? "",
        longitude: Number(item.point?.x),
        latitude: Number(item.point?.y),
      })).filter((item) => Number.isFinite(item.longitude) && Number.isFinite(item.latitude)),
    });
  } catch {
    return NextResponse.json(
      { error: "주소 조회에 실패했습니다. 수동 좌표 입력을 사용할 수 있습니다." },
      { status: 502 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ error: "주소 조회는 POST만 지원합니다." }, { status: 405 });
}
