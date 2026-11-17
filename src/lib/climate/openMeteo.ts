import { addDays, diffDays, type IsoDate } from '../lots/dates';

// Clima pelo centroide da fazenda, do Open-Meteo: histórico ERA5 (arquivo) mais
// os últimos dias e a previsão. Não depende de pluviômetro nem de chave de acesso.
// A chuva daqui é ESTIMADA; a chuva real registrada no app tem prioridade no dia.

/** Série diária contínua a partir de `start`. Posição i é o dia `start + i`. Null: sem dado. */
export interface ClimateSeries {
  /** Coordenadas usadas na consulta, já arredondadas. */
  lat: number;
  lon: number;
  start: IsoDate;
  tmax: (number | null)[];
  tmin: (number | null)[];
  rain: (number | null)[];
  /** Primeiro dia que é previsão (depois de hoje). */
  forecastFrom: IsoDate;
  fetchedAt: string;
}

export interface DayWeather {
  tmax: number;
  tmin: number;
  rain: number;
}

export interface ClimateApi {
  fetch(lat: number, lon: number, today: IsoDate): Promise<ClimateSeries>;
}

/** Anos de histórico buscados: base dos cenários de chuva e da "normal". */
export const HISTORY_YEARS = 10;
const TIMEOUT_MS = 20_000;
const DAILY = 'temperature_2m_max,temperature_2m_min,precipitation_sum';

/**
 * A grade do ERA5 tem ~25 km, então duas casas decimais (~1 km) bastam. Também
 * evita mandar para um serviço de fora a posição exata da fazenda.
 */
export const roundCoord = (v: number) => Math.round(v * 100) / 100;

/** Dia da série, ou null se faltar temperatura. Chuva ausente conta como zero. */
export function dayAt(series: ClimateSeries, date: IsoDate): DayWeather | null {
  const i = diffDays(series.start, date);
  if (i < 0 || i >= series.tmax.length) return null;
  const tmax = series.tmax[i];
  const tmin = series.tmin[i];
  if (tmax == null || tmin == null) return null;
  return { tmax, tmin, rain: series.rain[i] ?? 0 };
}

export const seriesEnd = (series: ClimateSeries): IsoDate => addDays(series.start, series.tmax.length - 1);

interface Daily {
  time: string[];
  temperature_2m_max: (number | null)[];
  temperature_2m_min: (number | null)[];
  precipitation_sum: (number | null)[];
}

async function getDaily(url: string, fetchImpl: typeof fetch): Promise<Daily> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Open-Meteo respondeu ${res.status}`);
    const json = (await res.json()) as { daily?: Daily };
    if (!json.daily?.time?.length) throw new Error('Resposta do clima sem dados.');
    return json.daily;
  } finally {
    clearTimeout(timer);
  }
}

/** Junta arquivo e previsão numa série contínua. Onde os dois têm o dia, vale o mais recente (previsão). */
export function mergeDaily(lat: number, lon: number, today: IsoDate, parts: Daily[], fetchedAt: string): ClimateSeries {
  const first = parts.map((p) => p.time[0]).sort()[0];
  const last = parts.map((p) => p.time[p.time.length - 1]).sort().pop()!;
  const n = diffDays(first, last) + 1;
  const series: ClimateSeries = {
    lat,
    lon,
    start: first,
    tmax: new Array<number | null>(n).fill(null),
    tmin: new Array<number | null>(n).fill(null),
    rain: new Array<number | null>(n).fill(null),
    forecastFrom: addDays(today, 1),
    fetchedAt,
  };
  for (const p of parts) {
    p.time.forEach((date, k) => {
      const i = diffDays(first, date);
      if (p.temperature_2m_max[k] != null) series.tmax[i] = p.temperature_2m_max[k];
      if (p.temperature_2m_min[k] != null) series.tmin[i] = p.temperature_2m_min[k];
      if (p.precipitation_sum[k] != null) series.rain[i] = p.precipitation_sum[k];
    });
  }
  return series;
}

export function createOpenMeteoApi(fetchImpl: typeof fetch = (...a) => fetch(...a)): ClimateApi {
  return {
    async fetch(latRaw, lonRaw, today) {
      const lat = roundCoord(latRaw);
      const lon = roundCoord(lonRaw);
      const where = `latitude=${lat}&longitude=${lon}&daily=${DAILY}&timezone=auto`;
      // O arquivo ERA5 chega com alguns dias de atraso; a outra consulta cobre os últimos 92 dias e a previsão.
      const archive = `https://archive-api.open-meteo.com/v1/archive?${where}&start_date=${addDays(today, -365 * HISTORY_YEARS - 3)}&end_date=${addDays(today, -6)}`;
      const recent = `https://api.open-meteo.com/v1/forecast?${where}&past_days=92&forecast_days=8`;
      const [a, r] = await Promise.all([getDaily(archive, fetchImpl), getDaily(recent, fetchImpl)]);
      return mergeDaily(lat, lon, today, [a, r], new Date().toISOString());
    },
  };
}

const cacheKey = (lat: number, lon: number) => `pvpro3:clima:${roundCoord(lat)},${roundCoord(lon)}`;

/** Cópia do clima no aparelho: abre sem sinal e evita baixar dez anos a cada visita. */
export const climateCache = {
  load(lat: number, lon: number): ClimateSeries | null {
    try {
      const raw = localStorage.getItem(cacheKey(lat, lon));
      return raw ? (JSON.parse(raw) as ClimateSeries) : null;
    } catch {
      return null;
    }
  },
  save(series: ClimateSeries): void {
    try {
      localStorage.setItem(cacheKey(series.lat, series.lon), JSON.stringify(series));
    } catch {
      /* sem espaço: segue sem cópia */
    }
  },
};
