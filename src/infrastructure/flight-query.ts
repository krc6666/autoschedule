const FLIGHT_QUERY_ENDPOINT = "https://flight-query-tool.vercel.app/api/flights";

export interface OnlineFlight {
  key: string;
  date: string;
  flightNo: string;
  departureTime: string;
  destination: string;
  destinationCity: string;
  country: string;
  countryCode: string;
}

export interface OnlineFlightQueryResult {
  date: string;
  nextDate: string;
  fetchedAt: string;
  sourceUrls: string[];
  flights: OnlineFlight[];
}

interface QueryFlightPayload {
  date?: unknown;
  flight?: unknown;
  departureTime?: unknown;
  destination?: unknown;
  destinationCity?: unknown;
  country?: unknown;
  countryCode?: unknown;
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseFlight(value: unknown): OnlineFlight | null {
  if (!value || typeof value !== "object") return null;
  const flight = value as QueryFlightPayload;
  const date = requiredString(flight.date);
  const flightNo = requiredString(flight.flight)?.toUpperCase() ?? null;
  const departureTime = requiredString(flight.departureTime);
  const destination = requiredString(flight.destination);
  const destinationCity = requiredString(flight.destinationCity);
  const country = requiredString(flight.country);
  const countryCode = requiredString(flight.countryCode)?.toUpperCase() ?? null;
  if (!date || !flightNo || !departureTime || !destination || !destinationCity || !country || !countryCode) return null;
  return {
    key: `${date}|${departureTime}|${flightNo}|${destination}`,
    date,
    flightNo,
    departureTime,
    destination,
    destinationCity,
    country,
    countryCode
  };
}

export async function queryInternationalFlights(
  date: string,
  fetcher: typeof fetch = fetch
): Promise<OnlineFlightQueryResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("请选择有效的航班查询日期。");
  const query = new URLSearchParams({ airport: "WUH", date, startCutoff: "6", cutoff: "6" });
  const response = await fetcher(`${FLIGHT_QUERY_ENDPOINT}?${query}`, { headers: { Accept: "application/json" } });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("航班查询接口返回格式异常。");
  }
  if (!response.ok) {
    const message = payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
      ? (payload as { error: string }).error
      : `航班查询失败（${response.status}）。`;
    throw new Error(message);
  }
  if (!payload || typeof payload !== "object") throw new Error("航班查询接口返回格式异常。");
  const record = payload as Record<string, unknown>;
  const responseDate = requiredString(record.date);
  const nextDate = requiredString(record.nextDate);
  const fetchedAt = requiredString(record.fetchedAt);
  if (!responseDate || !nextDate || !fetchedAt || !Array.isArray(record.flights) || !Array.isArray(record.sourceUrls)) {
    throw new Error("航班查询接口返回格式异常。");
  }
  const flights = record.flights
    .map(parseFlight)
    .filter((flight): flight is OnlineFlight => Boolean(flight))
    .filter((flight) => flight.countryCode !== "CN" && flight.countryCode !== "UNKNOWN");
  return {
    date: responseDate,
    nextDate,
    fetchedAt,
    sourceUrls: record.sourceUrls.filter((url): url is string => typeof url === "string"),
    flights
  };
}
