import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MAX_ZOOM = 19;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const z = Number(url.searchParams.get("z"));
  const x = Number(url.searchParams.get("x"));
  const y = Number(url.searchParams.get("y"));
  const consent = url.searchParams.get("consent") === "true";
  const key = process.env.VWORLD_API_KEY;
  const tileCount = 2 ** z;

  if (!consent) return new NextResponse(null, { status: 204 });
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y) || z < 0 || z > MAX_ZOOM || x < 0 || x >= tileCount || y < 0 || y >= tileCount) {
    return NextResponse.json({ error: "유효하지 않은 지도 타일 요청입니다." }, { status: 400 });
  }
  if (!key) return NextResponse.json({ error: "VWorld API 키가 설정되지 않았습니다." }, { status: 503 });

  try {
    const response = await fetch(`https://api.vworld.kr/req/wmts/1.0.0/${key}/Base/${z}/${y}/${x}.png`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok || !response.body) throw new Error(`VWorld ${response.status}`);
    return new NextResponse(response.body, {
      headers: {
        "Content-Type": response.headers.get("content-type") ?? "image/png",
        "Cache-Control": "public, max-age=86400, s-maxage=604800",
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
