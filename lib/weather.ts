import type { Point } from "./geo";

// Daily forecasts from Open-Meteo (free, no API key). Next caches each
// location's answer for three hours, so page views don't each call out.

export const FORECAST_DAYS = 10;

/** sunrise/sunset are local wall-clock "HH:MM" at the place. */
export type DayWeather = { code: number; max: number; min: number; rain: number | null; sunrise: string; sunset: string };

export async function forecast(p: Point): Promise<{ timezone: string; days: Record<string, DayWeather> } | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${p.lat.toFixed(3)}&longitude=${p.lng.toFixed(3)}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset` +
    `&temperature_unit=fahrenheit&timezone=auto&forecast_days=${FORECAST_DAYS}`;
  try {
    const res = await fetch(url, { next: { revalidate: 10800 }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const d = (await res.json()) as {
      timezone: string;
      daily: {
        time: string[];
        weather_code: number[];
        temperature_2m_max: number[];
        temperature_2m_min: number[];
        precipitation_probability_max: (number | null)[];
        sunrise: string[];
        sunset: string[];
      };
    };
    const days: Record<string, DayWeather> = {};
    d.daily.time.forEach((t, i) => {
      days[t] = {
        code: d.daily.weather_code[i],
        max: Math.round(d.daily.temperature_2m_max[i]),
        min: Math.round(d.daily.temperature_2m_min[i]),
        rain: d.daily.precipitation_probability_max[i],
        sunrise: d.daily.sunrise[i]?.slice(11, 16) ?? "",
        sunset: d.daily.sunset[i]?.slice(11, 16) ?? "",
      };
    });
    return { timezone: d.timezone, days };
  } catch {
    return null;
  }
}
