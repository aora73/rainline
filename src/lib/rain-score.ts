import type { SourceId } from "@/lib/rain-types";

export const WET_MM = 0.2;
const MIN_HOURS = 18;

export type ScoreParts = {
  score: number;
  volumeScore: number;
  timingScore: number;
  eventScore: number;
  forecastMm: number;
  actualMm: number;
  biasMm: number;
  wetHits: number;
  wetObserved: number;
  falseAlarms: number;
  hours: number;
};

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

export function scoreRain(forecast: Array<number | null>, actual: Array<number | null>): ScoreParts | null {
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < forecast.length; i++) {
    const f = forecast[i];
    const a = actual[i];
    if (f == null || a == null || Number.isNaN(f) || Number.isNaN(a)) continue;
    pairs.push([Math.max(0, f), Math.max(0, a)]);
  }
  if (pairs.length < MIN_HOURS) return null;

  let sumF = 0;
  let sumA = 0;
  let close = 0;
  let hits = 0;
  let misses = 0;
  let falseAlarms = 0;

  for (const [f, a] of pairs) {
    sumF += f;
    sumA += a;
    const fWet = f >= WET_MM;
    const aWet = a >= WET_MM;
    if (fWet && aWet) hits += 1;
    else if (!fWet && aWet) misses += 1;
    else if (fWet && !aWet) falseAlarms += 1;
    const tolerance = Math.max(0.3, a * 0.5);
    if (Math.abs(f - a) <= tolerance || (!fWet && !aWet)) close += 1;
  }

  const bothQuiet = sumF < 0.3 && sumA < 0.3;
  const volumeScore = bothQuiet
    ? 100
    : Math.round(100 * (1 - Math.min(1, Math.abs(sumF - sumA) / Math.max(sumF, sumA, 1))));
  const timingScore = Math.round((100 * close) / pairs.length);
  const eventDenom = hits + misses + falseAlarms;
  const eventScore = eventDenom === 0 ? 100 : Math.round((100 * hits) / eventDenom);
  const score = Math.round(volumeScore * 0.45 + timingScore * 0.35 + eventScore * 0.2);

  return {
    score,
    volumeScore,
    timingScore,
    eventScore,
    forecastMm: round1(sumF),
    actualMm: round1(sumA),
    biasMm: round1(sumF - sumA),
    wetHits: hits,
    wetObserved: hits + misses,
    falseAlarms,
    hours: pairs.length,
  };
}

export function scoreLabel(score: number | null): string {
  if (score == null) return "No score";
  if (score >= 80) return "Strong";
  if (score >= 65) return "Fair";
  if (score >= 45) return "Mixed";
  return "Weak";
}

export function localHourKey(timeZone: string, date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  let hour = pick("hour");
  if (hour === "24") hour = "00";
  return `${pick("year")}-${pick("month")}-${pick("day")}T${hour}:00`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function shiftHourKey(key: string, hours: number): string {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  const d = Number(key.slice(8, 10));
  const hh = Number(key.slice(11, 13));
  const next = new Date(Date.UTC(y, m - 1, d, hh) + hours * 3_600_000);
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}T${pad(next.getUTCHours())}:00`;
}

export function parseTrace(value: string | undefined): number | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function stampToLocal(stamp: string): string | null {
  if (!/^\d{14}$/.test(stamp)) return null;
  return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8, 10)}:${stamp.slice(10, 12)}`;
}

export function hourEndingKey(stamp: string): string | null {
  if (!/^\d{14}$/.test(stamp)) return null;
  const y = Number(stamp.slice(0, 4));
  const m = Number(stamp.slice(4, 6));
  const d = Number(stamp.slice(6, 8));
  const hh = Number(stamp.slice(8, 10));
  const mm = Number(stamp.slice(10, 12));
  if (mm === 0) return `${y}-${pad(m)}-${pad(d)}T${pad(hh)}:00`;
  const next = new Date(Date.UTC(y, m - 1, d, hh + 1));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}T${pad(next.getUTCHours())}:00`;
}

function stampHoursApart(earlier: string, later: string): number {
  const ey = Number(earlier.slice(0, 4));
  const em = Number(earlier.slice(4, 6));
  const ed = Number(earlier.slice(6, 8));
  const ehh = Number(earlier.slice(8, 10));
  const emm = Number(earlier.slice(10, 12));
  const ly = Number(later.slice(0, 4));
  const lm = Number(later.slice(4, 6));
  const ld = Number(later.slice(6, 8));
  const lhh = Number(later.slice(8, 10));
  const lmm = Number(later.slice(10, 12));
  const a = Date.UTC(ey, em - 1, ed, ehh, emm);
  const b = Date.UTC(ly, lm - 1, ld, lhh, lmm);
  return (b - a) / 3_600_000;
}

export function gaugeHourly(obs: Array<{ stamp: string; trace: string }>): Map<string, number> {
  const rows = obs
    .map((row) => ({
      stamp: row.stamp,
      trace: parseTrace(row.trace),
      end: hourEndingKey(row.stamp),
    }))
    .filter((row): row is { stamp: string; trace: number; end: string } => row.trace != null && row.end != null)
    .sort((a, b) => a.stamp.localeCompare(b.stamp));

  const buckets = new Map<string, number>();
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    const gap = stampHoursApart(prev.stamp, cur.stamp);
    if (gap <= 0 || gap > 3) continue;
    let delta = cur.trace - prev.trace;
    if (delta < -0.05) delta = cur.trace;
    if (delta < 0) delta = 0;
    buckets.set(cur.end, round1((buckets.get(cur.end) ?? 0) + delta));
  }
  return buckets;
}

export function emptyBySource(): Record<SourceId, number | null> {
  return {
    ecmwf_ifs: null,
    ecmwf_aifs025_single: null,
    gfs_seamless: null,
    icon_seamless: null,
    ukmo_seamless: null,
    gem_seamless: null,
  };
}

export function weekdayShort(time: string): string {
  const y = Number(time.slice(0, 4));
  const m = Number(time.slice(5, 7));
  const d = Number(time.slice(8, 10));
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? "";
}

export function hourLabel(time: string, withDay: boolean): string {
  const hour = Number(time.slice(11, 13));
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const suffix = hour < 12 ? "am" : "pm";
  if (!withDay) return `${h12}${suffix}`;
  return `${weekdayShort(time)} ${h12}${suffix}`;
}

export function formatCoord(lat: number, lon: number): string {
  const ns = lat < 0 ? "S" : "N";
  const ew = lon < 0 ? "W" : "E";
  return `${Math.abs(lat).toFixed(2)}°${ns}, ${Math.abs(lon).toFixed(2)}°${ew}`;
}

export function formatMm(value: number | null): string {
  if (value == null) return "—";
  return `${value.toFixed(1)} mm`;
}
