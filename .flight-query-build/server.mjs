import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 4178);
const regionNames = new Intl.DisplayNames(['zh-CN'], { type: 'region' });
const airportDirectory = await loadAirportDirectory();
const dateFormatters = new Map();
const excludedFlightPrefixes = ['CA', 'MU', 'CZ'];
const cargoCarrierCodes = new Set(['5X', '5Y', '8Y', 'CK', 'CV', 'FX', 'GI', 'K4', 'LD', 'MB', 'O3', 'PO', 'RH', 'RU', 'Y8', 'YG']);
const cargoAirlineNamePattern = /\b(cargo|freighter|postal)\b|\b(dhl air|sf airlines|longhao|yto)\b/i;

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  try {
    if (url.pathname === '/api/flights') {
      await handleFlights(url, response);
      return;
    }

    const requestedPath = url.pathname === '/' ? '/public/index.html' : `/public${url.pathname}`;
    const filePath = normalize(join(root, requestedPath));
    if (!filePath.startsWith(normalize(join(root, 'public')))) {
      sendJson(response, 403, { error: '非法文件路径。' });
      return;
    }

    const file = await readFile(filePath);
    response.writeHead(200, { 'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream' });
    response.end(file);
  } catch (error) {
    if (url.pathname.startsWith('/api/')) {
      sendJson(response, 500, { error: error.message || '查询失败。' });
    } else {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('文件不存在。');
    }
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`航班查询工具已启动：http://127.0.0.1:${port}`);
});

async function handleFlights(url, response) {
  const airport = (url.searchParams.get('airport') || '').trim().toUpperCase();
  const date = url.searchParams.get('date') || '';
  const startCutoff = Number(url.searchParams.get('startCutoff') || 0);
  const cutoff = Number(url.searchParams.get('cutoff') || 0);

  if (!/^[A-Z]{3}$/.test(airport)) {
    sendJson(response, 400, { error: '机场代码必须是 3 位 IATA 代码，例如 WUH。' });
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00`).valueOf())) {
    sendJson(response, 400, { error: '请选择有效日期。' });
    return;
  }
  if (!Number.isInteger(startCutoff) || startCutoff < 0 || startCutoff > 12) {
    sendJson(response, 400, { error: '当日凌晨排除时间必须在 00:00 到 12:00 之间。' });
    return;
  }
  if (!Number.isInteger(cutoff) || cutoff < 0 || cutoff > 12) {
    sendJson(response, 400, { error: '次日凌晨截止时间必须在 00:00 到 12:00 之间。' });
    return;
  }

  const timeZone = airportDirectory.get(airport)?.timeZone;
  if (!timeZone) {
    sendJson(response, 400, { error: `未找到 ${airport} 的机场时区，暂时无法准确判断跨日航班。` });
    return;
  }

  const previousDate = shiftIsoDate(date, -1);
  const nextDate = shiftIsoDate(date, 1);
  const sourcePlan = [
    { date: previousDate, hours: [23] },
    { date, hours: [6, 12, 18, 23] },
  ];

  if (cutoff > 5) sourcePlan.push({ date: nextDate, hours: [6] });

  const batches = await Promise.all(sourcePlan.flatMap(({ date: sourceDate, hours }) => (
    hours.map((hour) => fetchFlightStats(airport, sourceDate, hour, timeZone))
  )));
  const flights = batches
    .flatMap((batch) => batch.flights.map((flight) => ({ ...flight, sourceUrl: batch.sourceUrl })))
    .filter((flight) => (
      (flight.date === date && flight.departureMinutes >= startCutoff * 60)
      || (flight.date === nextDate && flight.departureMinutes < cutoff * 60)
    ))
    .filter((flight) => !excludedFlightPrefixes.some((prefix) => flight.flight.startsWith(prefix)))
    .filter((flight) => !flight.operatedBy)
    .filter((flight) => !isCargoFlight(flight))
    .map((flight) => ({ ...flight, ...resolveAirportCountry(flight.destination) }));

  const deduped = [...new Map(flights.map((flight) => [
    `${flight.date}|${flight.departureTime}|${flight.flight}|${flight.destination}`,
    flight,
  ])).values()];

  sendJson(response, 200, {
    airport,
    date,
    nextDate,
    startCutoff,
    cutoff,
    excludedFlightPrefixes,
    timeZone,
    fetchedAt: new Date().toISOString(),
    sourceUrls: sourcePlan.map(({ date: sourceDate }) => baseFlightStatsUrl(airport, sourceDate)),
    queriedPageCount: batches.length,
    unresolvedDestinations: [...new Set(deduped
      .filter((flight) => flight.countryCode === 'UNKNOWN')
      .map((flight) => flight.destination))].sort(),
    flights: deduped.sort((left, right) => `${left.date}${left.departureTime}`.localeCompare(`${right.date}${right.departureTime}`)),
  });
}

async function fetchFlightStats(airport, sourceDate, hour, timeZone) {
  const sourceUrl = `${baseFlightStatsUrl(airport, sourceDate)}&hour=${hour}`;
  const source = await fetch(sourceUrl, {
    headers: { 'User-Agent': 'FlightQueryTool/1.0 (+local-use)' },
  });

  if (!source.ok) {
    throw new Error(`FlightStats 返回 ${source.status}，请稍后重试。`);
  }

  const html = await source.text();
  const rows = [...html.matchAll(/\{"sortTime":"(?<sort>[^"]+)","departureTime":\{"timeAMPM":"(?<departureAmPm>[^"]+)","time24":"(?<departureTime>[^"]+)"\},"arrivalTime":\{"timeAMPM":"(?<arrivalAmPm>[^"]+)","time24":"(?<arrivalTime>[^"]+)"\},"carrier":\{"fs":"(?<carrier>[^"]+)","name":"(?<airline>[^"]+)","flightNumber":"(?<number>[^"]+)"\},"operatedBy":(?<operatedBy>null|"[^"]*"),"url":"[^"]+","airport":\{"fs":"(?<destination>[^"]+)","city":"(?<city>[^"]+)"\}/g)];

  const flights = rows
    .map((match) => match.groups)
    .map((row) => ({
      date: dateInTimeZone(row.sort, timeZone),
      flight: `${row.carrier}${row.number}`,
      carrierCode: row.carrier,
      airline: row.airline,
      operatedBy: row.operatedBy === 'null' ? '' : row.operatedBy,
      departureTime: row.departureTime,
      departureMinutes: timeToMinutes(row.departureTime),
      arrivalTime: row.arrivalTime,
      destination: row.destination,
      destinationCity: row.city,
    }));

  return { sourceUrl, flights };
}

function isCargoFlight(flight) {
  return cargoCarrierCodes.has(flight.carrierCode) || cargoAirlineNamePattern.test(flight.airline);
}

function baseFlightStatsUrl(airport, date) {
  const [year, month, day] = date.split('-');
  return `https://www.flightstats.com/v2/flight-tracker/departures/${airport}?year=${year}&month=${Number(month)}&date=${Number(day)}`;
}

function timeToMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function shiftIsoDate(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function resolveAirportCountry(iata) {
  const country = airportDirectory.get(iata)?.country;
  return {
    country: country?.name || '未识别',
    countryCode: country?.code || 'UNKNOWN',
  };
}

function dateInTimeZone(timestamp, timeZone) {
  let formatter = dateFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    dateFormatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function loadAirportDirectory() {
  const airports = new Map();

  const csv = await readFile(join(root, 'data', 'airports.csv'), 'utf8');
  const [header, ...rows] = csv.split(/\r?\n/).filter(Boolean);
  const headerColumns = parseCsvLine(header);
  const iataIndex = headerColumns.indexOf('iata_code');
  const countryIndex = headerColumns.indexOf('iso_country');

  for (const row of rows) {
    const columns = parseCsvLine(row);
    const iata = columns[iataIndex]?.trim().toUpperCase();
    const countryCode = columns[countryIndex]?.trim().toUpperCase();
    if (!iata || !countryCode) continue;
    airports.set(iata, { country: countryFromCode(countryCode) });
  }

  const raw = await readFile(join(root, 'data', 'airports.dat'), 'utf8');

  for (const line of raw.split(/\r?\n/)) {
    const columns = parseCsvLine(line);
    const iata = columns[4];
    const countryName = columns[3];
    if (!iata || iata === '\\N' || !countryName) continue;
    const existing = airports.get(iata) || { country: normaliseCountry(countryName) };
    const timeZone = columns[11];
    airports.set(iata, {
      ...existing,
      timeZone: timeZone && timeZone !== '\\N' ? timeZone : existing.timeZone,
    });
  }

  return airports;
}

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      values.push(value);
      value = '';
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

function normaliseCountry(countryName) {
  const overrides = {
    China: { code: 'CN', name: '中国大陆' },
    'Hong Kong': { code: 'HK', name: '香港' },
    Macau: { code: 'MO', name: '澳门' },
    Taiwan: { code: 'TW', name: '台湾' },
  };
  return overrides[countryName] || { code: countryName.toUpperCase(), name: countryName };
}

function countryFromCode(code) {
  const overrides = {
    CN: '中国大陆',
    HK: '香港',
    MO: '澳门',
    TW: '台湾',
  };
  return { code, name: overrides[code] || regionNames.of(code) || code };
}

function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}
