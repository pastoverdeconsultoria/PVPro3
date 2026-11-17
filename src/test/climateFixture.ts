import type { ClimateApi, ClimateSeries } from '../lib/climate/openMeteo';
import { addDays, diffDays, type IsoDate } from '../lib/lots/dates';

/** Chuva de cada mês num ano "médio" do clima inventado (mm), janeiro primeiro. */
export const BASE_RAIN = [120, 110, 120, 80, 30, 6, 3, 6, 15, 60, 130, 150];

/**
 * Clima inventado e determinístico, parecido com o do sudoeste da Bahia: chuva
 * de novembro a março, seca de junho a setembro. Cada ano tem um fator diferente
 * (o ano N chove `0,6 + 0,1 × (N mod 9)` vezes a base), para os cenários seco,
 * normal e chuvoso caírem em anos distintos. Chove a cada três dias.
 * Usado nos testes e na demonstração. Não é dado real.
 */
export function syntheticClimate(today: IsoDate, lat = -14.86, lon = -40.84): ClimateSeries {
  const start = addDays(today, -365 * 10 - 3);
  const n = diffDays(start, today) + 1 + 7;
  const tmax: number[] = [];
  const tmin: number[] = [];
  const rain: number[] = [];
  for (let i = 0; i < n; i++) {
    const date = addDays(start, i);
    const year = Number(date.slice(0, 4));
    const month = Number(date.slice(5, 7)) - 1;
    const day = Number(date.slice(8, 10));
    const cool = month >= 4 && month <= 7;
    tmax.push(cool ? 26 : 31);
    tmin.push(cool ? 15 : 20);
    const factor = 0.6 + 0.1 * (year % 9);
    rain.push(day % 3 === 1 ? Math.round(((BASE_RAIN[month] * factor) / 10) * 10) / 10 : 0);
  }
  return { lat, lon, start, tmax, tmin, rain, forecastFrom: addDays(today, 1), fetchedAt: `${today}T12:00:00.000Z` };
}

/** Fonte de clima de mentira: devolve o clima inventado e conta as chamadas. */
export function fakeClimateApi(): ClimateApi & { calls: number; fail: boolean } {
  const api = {
    calls: 0,
    fail: false,
    async fetch(lat: number, lon: number, today: IsoDate) {
      api.calls += 1;
      if (api.fail) throw new Error('sem sinal');
      return syntheticClimate(today, Math.round(lat * 100) / 100, Math.round(lon * 100) / 100);
    },
  };
  return api;
}
