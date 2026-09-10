/**
 * Weather from Open-Meteo. No API key, no account, no rate limit worth worrying
 * about — which is why it's here rather than a "real" weather provider.
 */

export interface Forecast {
  now: { tempF: number; code: number; description: string };
  today: { highF: number; lowF: number; precipChance: number; description: string };
  /** Next block of hours with meaningful rain, if any. */
  rain: { startsHour: number; chance: number } | null;
}

/** WMO weather codes → words. */
const CODES: Record<number, string> = {
  0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "overcast",
  45: "fog", 48: "freezing fog", 51: "light drizzle", 53: "drizzle",
  55: "heavy drizzle", 61: "light rain", 63: "rain", 65: "heavy rain",
  66: "freezing rain", 67: "heavy freezing rain", 71: "light snow",
  73: "snow", 75: "heavy snow", 77: "snow grains", 80: "rain showers",
  81: "heavy showers", 82: "violent showers", 85: "snow showers",
  86: "heavy snow showers", 95: "thunderstorms", 96: "thunderstorms with hail",
  99: "severe thunderstorms",
};

export const describe = (code: number) => CODES[code] ?? "unsettled";

let cache: { at: number; key: string; data: Forecast } | null = null;

export async function getForecast(lat: number, lon: number, timezone: string): Promise<Forecast | null> {
  const key = `${lat},${lon}`;
  if (cache && cache.key === key && Date.now() - cache.at < 30 * 60 * 1000) return cache.data;

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,weather_code` +
    `&hourly=precipitation_probability,weather_code` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code` +
    `&temperature_unit=fahrenheit&timezone=${encodeURIComponent(timezone)}&forecast_days=1`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const json = await res.json();

    const hourlyChance: number[] = json.hourly?.precipitation_probability ?? [];
    let rain: Forecast["rain"] = null;
    const nowHour = new Date().getHours();
    for (let h = nowHour; h < Math.min(hourlyChance.length, 24); h++) {
      if (hourlyChance[h] >= 50) {
        rain = { startsHour: h, chance: hourlyChance[h] };
        break;
      }
    }

    const data: Forecast = {
      now: {
        tempF: Math.round(json.current?.temperature_2m ?? 0),
        code: json.current?.weather_code ?? 0,
        description: describe(json.current?.weather_code ?? 0),
      },
      today: {
        highF: Math.round(json.daily?.temperature_2m_max?.[0] ?? 0),
        lowF: Math.round(json.daily?.temperature_2m_min?.[0] ?? 0),
        precipChance: json.daily?.precipitation_probability_max?.[0] ?? 0,
        description: describe(json.daily?.weather_code?.[0] ?? 0),
      },
      rain,
    };

    cache = { at: Date.now(), key, data };
    return data;
  } catch {
    return null;
  }
}

/** "6 PM" from an hour number, for readable copy. */
export function hourLabel(hour: number): string {
  const h = hour % 24;
  if (h === 0) return "midnight";
  if (h === 12) return "noon";
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}
