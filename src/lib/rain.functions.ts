import { createServerFn } from "@tanstack/react-start";
import { auStations } from "@/data/au-stations";
import { gaugeHourly, localHourKey, median, parseTrace, round1, scoreRain, shiftHourKey, stampToLocal } from "@/lib/rain-score";
import { SOURCES, type FutureHour, type GaugeInfo, type PastHour, type RainReport, type SourceId, type SourceScore, type WeatherWarning } from "@/lib/rain-types";

const USER_AGENT = "Rainline/1.0 (rainfall comparison; contact aora)";
const GAUGE_RADIUS_KM = 90;
const GAUGE_TRIES = 4;

type HourlyBlock = Record<string, Array<number | null> | string[]>;

function asNumbers(block: HourlyBlock, key: string): Array<number | null> {
  const value = block[key];
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (typeof entry !== "number" || !Number.isFinite(entry)) return null;
    return entry;
  });
}

async function readJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Weather feed returned ${response.status}`);
  }
  return response.json();
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function productPrefix(region: string, lat: number, lon: number): string {
  const known: Record<string, string> = {
    VIC: "IDV",
    NSW: "IDN",
    ACT: "IDN",
    QLD: "IDQ",
    SA: "IDS",
    TAS: "IDT",
    WA: "IDW",
    NT: "IDD",
  };
  if (known[region]) return known[region];
  if (lon < 129) return "IDW";
  if (lat > -26 && lon < 138) return "IDD";
  if (lon < 141) return "IDS";
  if (lat < -39.2 && lon < 149) return "IDT";
  if (lat > -29 && lon >= 138) return "IDQ";
  if (lat > -34) return "IDN";
  return "IDV";
}

type BomObs = { stamp: string; trace: string; name: string };

async function fetchBom(wmo: string, prefix: string): Promise<BomObs[] | null> {
  const url = `https://www.bom.gov.au/fwo/${prefix}60801/${prefix}60801.${wmo}.json`;
  try {
    const payload = (await readJson(url)) as {
      observations?: {
        data?: Array<{ local_date_time_full?: string; rain_trace?: string; name?: string }>;
      };
    };
    const data = payload.observations?.data ?? [];
    const rows = data
      .map((row) => ({
        stamp: row.local_date_time_full ?? "",
        trace: row.rain_trace ?? "",
        name: row.name ?? "Bureau station",
      }))
      .filter((row) => /^\d{14}$/.test(row.stamp));
    return rows.length > 0 ? rows : null;
  } catch {
    return null;
  }
}

async function findGauge(
  lat: number,
  lon: number,
  nowKey: string,
  pointElevation: number | null,
): Promise<{ info: GaugeInfo; hourly: Map<string, number> } | null> {
  const nearby = auStations
    .map((station) => ({ station, distanceKm: haversine(lat, lon, station.a, station.o) }))
    .filter((row) => row.distanceKm <= GAUGE_RADIUS_KM)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, GAUGE_TRIES);

  if (nearby.length === 0) return null;

  const fetched = await Promise.all(
    nearby.map(async (row) => {
      const prefix = productPrefix(row.station.r, row.station.a, row.station.o);
      const obs = await fetchBom(row.station.w, prefix);
      return { ...row, obs };
    }),
  );

  const freshCutoff = shiftHourKey(nowKey, -3);
  const usable = fetched
    .filter((row) => row.obs && row.obs.length >= 20)
    .map((row) => {
      const obs = row.obs as BomObs[];
      const newest = stampToLocal(obs[0].stamp) ?? "";
      const hourly = gaugeHourly(obs);
      const elevation = row.station.e;
      const elevPenalty = elevation == null || pointElevation == null ? 0 : Math.abs(elevation - pointElevation) / 50;
      return { ...row, obs, newest, hourly, elevation, cost: row.distanceKm + elevPenalty };
    })
    .filter((row) => row.newest >= freshCutoff && row.hourly.size >= 12)
    .sort((a, b) => a.cost - b.cost);

  const best = usable[0];
  if (!best) return null;
  const latest = best.obs[0];
  return {
    hourly: best.hourly,
    info: {
      name: latest.name || best.station.n,
      distanceKm: Math.round(best.distanceKm),
      wmo: best.station.w,
      since9amMm: parseTrace(latest.trace),
      observedAt: stampToLocal(latest.stamp) ?? nowKey,
      hoursCovered: best.hourly.size,
      elevationM: best.elevation,
    },
  };
}

function seriesAt(block: HourlyBlock, key: string, indexes: number[]): Array<number | null> {
  const values = asNumbers(block, key);
  return indexes.map((index) => values[index] ?? null);
}

function plainText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<li>/gi, "\n• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/&#39;|'/g, "'")
    .replace(/"/g, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fetchWarnings(lat: number, lon: number): Promise<WeatherWarning[]> {
  const area = `${lon.toFixed(2)},${lat.toFixed(2)}`;
  const list = (await readJson(
    `https://api.bom.gov.au/apikey/v1/warnings/list?area_type=coordinate&area_code=${encodeURIComponent(area)}`,
  )) as { warnings?: Array<{ id?: string }> };
  const ids = (list.warnings ?? [])
    .map((item) => item.id)
    .filter((id): id is string => typeof id === "string" && /^[A-Z0-9]{4,16}$/.test(id))
    .slice(0, 6);
  const details = await Promise.all(
    ids.map(async (id) => {
      try {
        const payload = (await readJson(`https://api.bom.gov.au/apikey/v1/warnings/warning/${id}`)) as {
          warning?: {
            title?: string;
            sub_title?: string;
            issued_at?: string;
            advice?: string;
            info?: Array<{ summary?: string }>;
          };
        };
        const warning = payload.warning;
        if (!warning) return null;
        const title = plainText(warning.title);
        if (!title || /^cancellation\b/i.test(title)) return null;
        const detailsText = (warning.info ?? [])
          .map((item) => plainText(item.summary))
          .filter(Boolean)
          .join("\n\n");
        return {
          id,
          title,
          area: plainText(warning.sub_title),
          issued: plainText(warning.issued_at),
          details: detailsText,
          advice: plainText(warning.advice),
        };
      } catch {
        return null;
      }
    }),
  );
  return details.filter((item): item is WeatherWarning => item != null);
}

export const compareRain = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Missing location");
    const { latitude, longitude } = input as { latitude?: unknown; longitude?: unknown };
    if (typeof latitude !== "number" || typeof longitude !== "number" || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error("Missing location");
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      throw new Error("That location is out of range");
    }
    return { latitude, longitude };
  })
  .handler(async ({ data }): Promise<RainReport> => {
    const warningsPromise = fetchWarnings(data.latitude, data.longitude).catch(() => [] as WeatherWarning[]);
    const url = new URL("https://previous-runs-api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", data.latitude.toFixed(4));
    url.searchParams.set("longitude", data.longitude.toFixed(4));
    url.searchParams.set("hourly", "precipitation,precipitation_probability,precipitation_previous_day1");
    url.searchParams.set("models", SOURCES.map((source) => source.id).join(","));
    url.searchParams.set("past_days", "2");
    url.searchParams.set("forecast_days", "3");
    url.searchParams.set("timezone", "auto");

    const payload = (await readJson(url.toString())) as {
      error?: boolean;
      reason?: string;
      elevation?: number;
      timezone?: string;
      hourly?: HourlyBlock;
    };
    if (payload.error || !payload.hourly || !Array.isArray(payload.hourly.time)) {
      throw new Error(payload.reason || "The forecast feed did not return hourly rain");
    }

    const timezone = payload.timezone || "UTC";
    const nowKey = localHourKey(timezone);
    const times = payload.hourly.time as string[];
    const pastTimes = times.filter((time) => time <= nowKey).slice(-24);
    const futureStart = times.findIndex((time) => time > nowKey);
    const futureTimes = futureStart === -1 ? [] : times.slice(futureStart, futureStart + 48);
    if (futureTimes.length < 24) {
      throw new Error("The forecast feed did not cover the next 48 hours");
    }

    const indexOf = new Map(times.map((time, index) => [time, index]));
    const pastIdx = pastTimes.map((time) => indexOf.get(time) ?? -1);
    const futureIdx = futureTimes.map((time) => indexOf.get(time) ?? -1);

    const gauge = await findGauge(data.latitude, data.longitude, nowKey, typeof payload.elevation === "number" ? payload.elevation : null).catch(() => null);

    const latestPast: Record<SourceId, Array<number | null>> = {
      ecmwf_ifs: [],
      gfs_seamless: [],
      icon_seamless: [],
      ukmo_seamless: [],
      gem_seamless: [],
    };
    const calledPast: Record<SourceId, Array<number | null>> = { ...latestPast };
    const futureRain: Record<SourceId, Array<number | null>> = { ...latestPast };
    const futureChance: Record<SourceId, Array<number | null>> = { ...latestPast };

    for (const source of SOURCES) {
      latestPast[source.id] = seriesAt(payload.hourly, `precipitation_${source.id}`, pastIdx);
      calledPast[source.id] = seriesAt(payload.hourly, `precipitation_previous_day1_${source.id}`, pastIdx);
      futureRain[source.id] = seriesAt(payload.hourly, `precipitation_${source.id}`, futureIdx);
      futureChance[source.id] = seriesAt(payload.hourly, `precipitation_probability_${source.id}`, futureIdx);
    }

    const consensus = pastTimes.map((_, hour) => {
      const votes: number[] = [];
      for (const source of SOURCES) {
        const value = latestPast[source.id][hour];
        if (value != null) votes.push(value);
      }
      const mid = median(votes);
      return mid == null ? null : round1(mid);
    });

    const gaugeValues = pastTimes.map((time) => {
      const value = gauge?.hourly.get(time);
      return value == null ? null : value;
    });
    const gaugeHours = gaugeValues.filter((value) => value != null).length;
    const useGauge = gauge != null && gaugeHours >= 18;

    const actualSeries = useGauge ? gaugeValues : consensus;
    const reference = useGauge ? "gauge" : "consensus";

    const past: PastHour[] = pastTimes.map((time, hour) => ({
      time,
      called: {
        ecmwf_ifs: calledPast.ecmwf_ifs[hour],
        gfs_seamless: calledPast.gfs_seamless[hour],
        icon_seamless: calledPast.icon_seamless[hour],
        ukmo_seamless: calledPast.ukmo_seamless[hour],
        gem_seamless: calledPast.gem_seamless[hour],
      },
      actual: actualSeries[hour],
    }));

    const future: FutureHour[] = futureTimes.map((time, hour) => ({
      time,
      rain: {
        ecmwf_ifs: futureRain.ecmwf_ifs[hour],
        gfs_seamless: futureRain.gfs_seamless[hour],
        icon_seamless: futureRain.icon_seamless[hour],
        ukmo_seamless: futureRain.ukmo_seamless[hour],
        gem_seamless: futureRain.gem_seamless[hour],
      },
      chance: {
        ecmwf_ifs: futureChance.ecmwf_ifs[hour],
        gfs_seamless: futureChance.gfs_seamless[hour],
        icon_seamless: futureChance.icon_seamless[hour],
        ukmo_seamless: futureChance.ukmo_seamless[hour],
        gem_seamless: futureChance.gem_seamless[hour],
      },
    }));

    const sources: SourceScore[] = SOURCES.map((source) => {
      const scored = scoreRain(
        past.map((hour) => hour.called[source.id]),
        past.map((hour) => hour.actual),
      );
      const rains = future.map((hour) => hour.rain[source.id]);
      const chances = future.map((hour) => hour.chance[source.id]).filter((value): value is number => value != null);
      const present = rains.filter((value): value is number => value != null);
      return {
        id: source.id,
        score: scored?.score ?? null,
        volumeScore: scored?.volumeScore ?? null,
        timingScore: scored?.timingScore ?? null,
        eventScore: scored?.eventScore ?? null,
        forecastMm: scored?.forecastMm ?? null,
        actualMm: scored?.actualMm ?? null,
        biasMm: scored?.biasMm ?? null,
        wetHits: scored?.wetHits ?? 0,
        wetObserved: scored?.wetObserved ?? 0,
        falseAlarms: scored?.falseAlarms ?? 0,
        hours: scored?.hours ?? 0,
        total48Mm: present.length >= rains.length * 0.75 ? round1(present.reduce((sum, value) => sum + value, 0)) : null,
        peakChance: chances.length > 0 ? Math.round(Math.max(...chances)) : null,
      };
    });

    let referenceNote: string;
    if (useGauge && gauge) {
      const higher =
        gauge.info.elevationM != null && typeof payload.elevation === "number"
          ? Math.round(gauge.info.elevationM - payload.elevation)
          : null;
      const elevNote =
        higher != null && Math.abs(higher) >= 250
          ? ` The gauge is about ${Math.abs(higher)} m ${higher > 0 ? "higher" : "lower"} than this point.`
          : "";
      const distanceNote = ` It is ${gauge.info.distanceKm} km away.${elevNote}`;
      referenceNote = `Actual rain is reconstructed from the Bureau of Meteorology gauge at ${gauge.info.name}.${distanceNote} Scores use completed hours only, compared with what each source forecast about 24 hours earlier. Rain since 9am can be a little higher because it includes the hour still in progress.`;
    } else if (gauge) {
      referenceNote = `${gauge.info.name} is the nearest public gauge, but its recent trace is too patchy to score against. Actual is the median of the five models' latest analyses for hours already passed — not a rain gauge.`;
    } else {
      referenceNote =
        "No Bureau automatic gauge within 90 km published a fresh rain trace. Actual is the median of the five models' latest analyses for hours already passed — not a rain gauge. Scores show who was closest to that consensus.";
    }

    return {
      latitude: data.latitude,
      longitude: data.longitude,
      elevation: typeof payload.elevation === "number" ? Math.round(payload.elevation) : null,
      timezone,
      nowKey,
      future,
      past,
      sources,
      reference,
      referenceNote,
      gauge: gauge?.info ?? null,
      warnings: await warningsPromise,
    };
  });
