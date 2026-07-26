const form = document.querySelector('#query-form');
const airportInput = document.querySelector('#airport');
const dateInput = document.querySelector('#date');
const startCutoffInput = document.querySelector('#start-cutoff');
const cutoffInput = document.querySelector('#cutoff');
const searchButton = document.querySelector('#search-button');
const resultTitle = document.querySelector('#result-title');
const status = document.querySelector('#status');
const rows = document.querySelector('#flight-rows');
const source = document.querySelector('#source');
const textFilter = document.querySelector('#text-filter');
const includeRegions = document.querySelector('#include-regions');

let allFlights = [];

dateInput.value = localIsoDate(new Date());

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const airport = airportInput.value.trim().toUpperCase();
  airportInput.value = airport;
  const query = new URLSearchParams({
    airport,
    date: dateInput.value,
    startCutoff: startCutoffInput.value,
    cutoff: cutoffInput.value,
  });

  setLoading(true);
  try {
    const response = await fetch(`/api/flights?${query}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || '查询失败。');

    allFlights = payload.flights.filter((flight) => flight.countryCode !== 'CN' && flight.countryCode !== 'UNKNOWN');
    resultTitle.textContent = `${airport} 国际/地区出港计划`;
    const unresolved = payload.unresolvedDestinations || [];
    const startLimit = payload.startCutoff ? `已排除 ${payload.date} ${String(payload.startCutoff).padStart(2, '0')}:00 前起飞的航班；` : '';
    const nextLimit = payload.cutoff ? `已纳入 ${payload.nextDate} ${String(payload.cutoff).padStart(2, '0')}:00 前起飞的航班；` : '';
    status.textContent = `${startLimit}${nextLimit}已排除航班号以 CA、MU、CZ 开头的记录、共享航班和货运航空航班。共核对 ${payload.queriedPageCount} 个 FlightStats 时间段，起飞日期按 ${payload.timeZone} 时区判断。${unresolved.length ? `有 ${unresolved.length} 个目的地未识别，未纳入国际结果：${unresolved.join('、')}。` : ''}`;
    textFilter.disabled = false;
    includeRegions.disabled = false;
    source.replaceChildren(document.createTextNode(`数据获取于 ${new Date(payload.fetchedAt).toLocaleString('zh-CN')}。计划数据来源：`));
    payload.sourceUrls.forEach((url, index) => {
      if (index > 0) source.append('、');
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = `FlightStats 页面 ${index + 1}`;
      source.append(link);
    });
    source.append('。目的地国家/地区由本地机场对照表判定。');
    render();
  } catch (error) {
    allFlights = [];
    rows.innerHTML = '<tr><td colspan="7" class="empty">查询失败</td></tr>';
    status.textContent = error.message;
    source.textContent = '';
  } finally {
    setLoading(false);
  }
});

textFilter.addEventListener('input', render);
includeRegions.addEventListener('change', render);

function render() {
  const term = textFilter.value.trim().toLowerCase();
  const showRegions = includeRegions.checked;
  const flights = allFlights.filter((flight) => {
    const isRegion = ['HK', 'MO', 'TW'].includes(flight.countryCode);
    const text = [flight.flight, flight.airline, flight.operatedBy, flight.destination, flight.destinationCity, flight.country].join(' ').toLowerCase();
    return (showRegions || !isRegion) && (!term || text.includes(term));
  });

  if (flights.length === 0) {
    rows.innerHTML = '<tr><td colspan="7" class="empty">没有符合当前筛选条件的航班</td></tr>';
    return;
  }

  rows.replaceChildren(...flights.map((flight) => {
    const row = document.createElement('tr');
    if (flight.date !== dateInput.value) row.classList.add('next-day');
    row.innerHTML = `
      <td>${escapeHtml(flight.date)}</td>
      <td>${escapeHtml(flight.departureTime)}</td>
      <td class="flight-code">${escapeHtml(flight.flight)}</td>
      <td>${escapeHtml(flight.airline)}${flight.operatedBy ? `<span>${escapeHtml(flight.operatedBy)}</span>` : ''}</td>
      <td><strong>${escapeHtml(flight.destination)}</strong><span>${escapeHtml(flight.destinationCity)}</span></td>
      <td><span class="country-code">${escapeHtml(flight.countryCode)}</span>${escapeHtml(flight.country)}</td>
      <td>${escapeHtml(flight.arrivalTime)}</td>`;
    return row;
  }));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[character]));
}

function setLoading(loading) {
  searchButton.disabled = loading;
  searchButton.textContent = loading ? '正在读取 FlightStats...' : '查询航班';
  if (loading) {
    status.textContent = '正在读取当天与次日航班计划，请稍候。';
    rows.innerHTML = '<tr><td colspan="7" class="empty">正在查询</td></tr>';
  }
}

function localIsoDate(date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}
