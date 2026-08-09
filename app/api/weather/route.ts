import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function optionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseCompactDate(value: string | undefined): Date | null {
  if (!value || !/^\d{8}$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
    ? parsed
    : null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const stationId = url.searchParams.get("stationId")?.trim();
  const startDate = url.searchParams.get("startDate")?.replaceAll("-", "");
  const endDate = url.searchParams.get("endDate")?.replaceAll("-", "");
  const consent = url.searchParams.get("consent") === "true";
  const key = process.env.DATA_GO_KR_SERVICE_KEY;

  if (!consent) {
    return NextResponse.json({ error: "외부 기상 조회 동의가 필요합니다." }, { status: 400 });
  }
  const start = parseCompactDate(startDate);
  const end = parseCompactDate(endDate);
  if (!stationId || !/^\d{1,5}$/.test(stationId) || !start || !end) {
    return NextResponse.json({ error: "관측소와 조회기간이 필요합니다." }, { status: 400 });
  }
  const rangeDays = (end.getTime() - start.getTime()) / 86_400_000;
  if (!Number.isFinite(rangeDays) || rangeDays < 0 || rangeDays > 370) {
    return NextResponse.json({ error: "기상 조회기간은 0~370일이어야 합니다." }, { status: 400 });
  }
  if (!key) {
    return NextResponse.json(
      { error: "기상청 공공데이터 키가 없어 비작업률을 수동 입력해야 합니다." },
      { status: 503 },
    );
  }

  const endpoint = new URL(
    "https://apis.data.go.kr/1360000/AsosDalyInfoService/getWthrDataList",
  );
  endpoint.search = new URLSearchParams({
    serviceKey: key,
    pageNo: "1",
    numOfRows: "999",
    dataType: "JSON",
    dataCd: "ASOS",
    dateCd: "DAY",
    startDt: startDate!,
    endDt: endDate!,
    stnIds: stationId,
  }).toString();

  try {
    const response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`KMA ${response.status}`);
    const payload = (await response.json()) as {
      response?: { body?: { items?: { item?: Array<Record<string, string>> } } };
    };
    const items = payload.response?.body?.items?.item ?? [];
    return NextResponse.json({
      provider: "기상청 ASOS 일자료",
      stationId,
      referenceOnly: true,
      items: items.filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.tm ?? "")).map((item) => ({
        date: item.tm,
        precipitationMm: optionalNumber(item.sumRn),
        minimumTemperatureC: optionalNumber(item.minTa),
        maximumTemperatureC: optionalNumber(item.maxTa),
        newSnowCm: optionalNumber(item.ddMes),
        maximumGustMs: optionalNumber(item.maxInsWs),
      })),
    });
  } catch {
    return NextResponse.json(
      { error: "기상 자료 조회에 실패했습니다. 월별 비작업률을 직접 입력할 수 있습니다." },
      { status: 502 },
    );
  }
}
