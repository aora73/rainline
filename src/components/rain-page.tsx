import { useEffect, useId, useState } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { LocateFixed, RefreshCw, Search } from "lucide-react";
import { HindcastChart, OutlookChart } from "@/components/rain-charts";
import { formatCoord, formatMm, scoreLabel } from "@/lib/rain-score";
import { SOURCES, type RainReport, type SourceId } from "@/lib/rain-types";

type Hit = {
  id: number;
  name: string;
  admin1?: string;
  country: string;
  country_code: string;
  latitude: number;
  longitude: number;
};

type Place = { lat: number; lon: number; q?: string };

const RECENT_KEY = "rainline-recent";

function placeLabel(hit: Hit): string {
  const region = hit.admin1 && hit.admin1 !== hit.name ? hit.admin1 : hit.country;
  return `${hit.name}, ${region}`;
}

function biasText(bias: number | null): string {
  if (bias == null) return "No 24h overlap";
  if (Math.abs(bias) < 0.05) return "Matched the 24h total";
  if (bias > 0) return `${bias.toFixed(1)} mm more than fell`;
  return `${Math.abs(bias).toFixed(1)} mm less than fell`;
}

export function RainPage({ report, place }: { report: RainReport; place: Place }) {
  const navigate = useNavigate();
  const router = useRouter();
  const listId = useId();
  const [text, setText] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [geoNote, setGeoNote] = useState("");
  const [recent, setRecent] = useState<Array<{ q: string; lat: number; lon: number }>>([]);

  const title = place.q || "Mansfield, Victoria";
  const totals = report.sources.map((source) => source.total48Mm).filter((value): value is number => value != null);
  const low = totals.length ? Math.min(...totals) : null;
  const high = totals.length ? Math.max(...totals) : null;
  const ranked = [...report.sources].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]") as Array<{ q: string; lat: number; lon: number }>;
      if (Array.isArray(stored)) setRecent(stored.slice(0, 4));
    } catch {
      setRecent([]);
    }
  }, [place.lat, place.lon]);

  useEffect(() => {
    if (place.q && place.q !== "Mansfield, Victoria") {
      try {
        const stored = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]") as Array<{ q: string; lat: number; lon: number }>;
        const next = [
          { q: place.q, lat: place.lat, lon: place.lon },
          ...stored.filter((item) => item.q !== place.q),
        ].slice(0, 4);
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        /* ignore private-mode storage failures */
      }
    }
  }, [place.lat, place.lon, place.q]);

  useEffect(() => {
    const query = text.trim();
    if (query.length < 2) {
      setHits([]);
      return;
    }
    const coord = query.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (coord) {
      setHits([
        {
          id: -1,
          name: "Coordinates",
          country: "",
          country_code: "",
          latitude: Number(coord[1]),
          longitude: Number(coord[2]),
        },
      ]);
      setOpen(true);
      return;
    }
    const handle = window.setTimeout(() => {
      void (async () => {
        try {
          const [local, world] = await Promise.all([
            fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=en&format=json&countryCode=AU`),
            fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=en&format=json`),
          ]);
          const localJson = (await local.json()) as { results?: Hit[] };
          const worldJson = (await world.json()) as { results?: Hit[] };
          const seen = new Set<string>();
          const merged: Hit[] = [];
          for (const hit of [...(localJson.results ?? []), ...(worldJson.results ?? [])]) {
            const key = `${hit.latitude.toFixed(2)},${hit.longitude.toFixed(2)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(hit);
          }
          setHits(merged.slice(0, 6));
          setOpen(true);
        } catch {
          setHits([]);
        }
      })();
    }, 250);
    return () => window.clearTimeout(handle);
  }, [text]);

  function go(lat: number, lon: number, q: string) {
    setOpen(false);
    setText("");
    setGeoNote("");
    void navigate({ to: "/", search: { lat, lon, q } });
  }

  function useLocation() {
    if (!navigator.geolocation) {
      setGeoNote("This browser has no location service. Search for a place instead.");
      return;
    }
    setGeoNote("Finding you…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGeoNote("");
        go(position.coords.latitude, position.coords.longitude, "Your location");
      },
      () => setGeoNote("Location was blocked. Search for a town, or paste coordinates."),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  }

  const byId = Object.fromEntries(SOURCES.map((source) => [source.id, source])) as Record<
    SourceId,
    (typeof SOURCES)[number]
  >;

  return (
    <div className="min-h-screen">
      <div className="bg-[#001830] text-[#f6f3ec]">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 md:px-8">
          <a href="https://aora73.github.io/AORA-Apps/shelf/" className="flex min-w-0 items-center gap-3">
            <img src="/aora-logo.png" alt="Australian Offroad Academy" className="h-10 w-auto shrink-0 bg-white" />
            <span className="truncate text-sm font-semibold">Rainline</span>
          </a>
          <a
            href="https://aoraradar.grok.me/"
            className="inline-flex min-h-11 shrink-0 items-center text-sm font-semibold text-[#f2c14e]"
          >
            AORA Radar
          </a>
        </div>
      </div>
      <div aria-hidden="true">
        <div className="h-1 bg-[#d04828]" />
        <div className="h-1.5 bg-[#f6f3ec]" />
      </div>
      <main className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium tracking-wide text-muted">Rainline</p>
          <h1 className="mt-1 font-display text-4xl text-fg md:text-5xl">{title}</h1>
          <p className="mt-2 text-sm text-muted">
            {formatCoord(report.latitude, report.longitude)}
            {report.elevation != null ? ` · ${report.elevation} m` : ""}
            {report.gauge ? ` · Gauge ${report.gauge.name}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={useLocation} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-fg px-4 text-sm text-bg">
            <LocateFixed className="size-4" aria-hidden="true" />
            Use my location
          </button>
          <button
            type="button"
            aria-label="Refresh forecasts"
            onClick={() => void router.invalidate()}
            className="inline-flex size-11 items-center justify-center rounded-full bg-surface text-fg shadow-card"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="relative mt-5">
        <label className="field flex min-h-12 items-center gap-2 px-4" htmlFor="place-search">
          <Search className="size-4 text-muted" aria-hidden="true" />
          <input
            id="place-search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              window.setTimeout(() => setOpen(false), 180);
            }}
            placeholder="Town, park, or lat, lon"
            className="w-full bg-transparent text-base text-fg outline-none placeholder:text-faint"
            autoComplete="off"
            role="combobox"
            aria-expanded={open && (hits.length > 0 || recent.length > 0)}
            aria-controls={listId}
          />
        </label>
        {open && (hits.length > 0 || (text.trim().length < 2 && recent.length > 0)) ? (
          <ul id={listId} className="panel absolute z-10 mt-2 w-full overflow-hidden p-1">
            {hits.length > 0
              ? hits.map((hit) => (
                  <li key={`${hit.id}-${hit.latitude}`}>
                    <button
                      type="button"
                      className="min-h-11 w-full rounded-xl px-3 text-left text-sm hover:bg-bg"
                      onClick={() => go(hit.latitude, hit.longitude, hit.id === -1 ? "Coordinates" : placeLabel(hit))}
                    >
                      {hit.id === -1 ? `${hit.latitude}, ${hit.longitude}` : placeLabel(hit)}
                    </button>
                  </li>
                ))
              : recent.map((item) => (
                  <li key={item.q}>
                    <button
                      type="button"
                      className="min-h-11 w-full rounded-xl px-3 text-left text-sm hover:bg-bg"
                      onClick={() => go(item.lat, item.lon, item.q)}
                    >
                      {item.q}
                    </button>
                  </li>
                ))}
          </ul>
        ) : null}
        {geoNote ? <p className="mt-2 text-sm text-muted">{geoNote}</p> : null}
      </div>

      <p className="mt-6 max-w-2xl font-display text-2xl text-fg md:text-3xl">
        {low == null || high == null
          ? "The next 48 hours are incomplete for at least one source."
          : low < 1 && high < 1
            ? "All five sources keep the next 48 hours under 1 mm."
            : `Next 48 hours: ${low.toFixed(1)}–${high.toFixed(1)} mm, depending on the source.`}
      </p>

      <div className="mt-5">
        <OutlookChart
          hours={report.future}
          scores={report.sources.map((source) => ({ id: source.id, score: source.score }))}
        />
      </div>

      <section className="mt-6">
        <h2 className="font-display text-2xl text-fg">Reliability, last 24 hours</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">{report.referenceNote}</p>
        {report.gauge ? (
          <p className="mt-2 text-sm text-muted">
            {report.gauge.name} rain since 9am: {formatMm(report.gauge.since9amMm)}. Latest reading{" "}
            {report.gauge.observedAt.replace("T", " ")}.
          </p>
        ) : null}
        <ol className="mt-4 grid gap-3 md:grid-cols-2">
          {ranked.map((source) => {
            const meta = byId[source.id];
            return (
              <li key={source.id} className="panel p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-medium text-fg">{meta.name}</h3>
                    <p className="text-sm text-muted">{meta.agency}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-display text-3xl tabular-nums text-fg">{source.score ?? "—"}</p>
                    <p className="text-sm text-muted">{scoreLabel(source.score)}</p>
                  </div>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line">
                  <div className="h-full rounded-full bg-gold" style={{ width: `${source.score ?? 0}%` }} />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-muted">Next 48h</dt>
                    <dd className="tabular-nums text-fg">{formatMm(source.total48Mm)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Peak chance</dt>
                    <dd className="tabular-nums text-fg">{source.peakChance == null ? "—" : `${source.peakChance}%`}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Called, last 24h</dt>
                    <dd className="tabular-nums text-fg">{formatMm(source.forecastMm)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Fell</dt>
                    <dd className="tabular-nums text-fg">{formatMm(source.actualMm)}</dd>
                  </div>
                </dl>
                <p className="mt-2 text-sm text-muted">
                  {biasText(source.biasMm)}
                  {source.wetObserved > 0 ? ` · ${source.wetHits}/${source.wetObserved} wet hours caught` : ""}
                  {source.falseAlarms > 0 ? ` · ${source.falseAlarms} false alarms` : ""}
                </p>
              </li>
            );
          })}
        </ol>
      </section>

      <div className="mt-6">
        <HindcastChart hours={report.past} reference={report.reference} />
      </div>

      <footer className="mt-8 max-w-2xl space-y-2 text-sm text-muted">
        <p>
          Score is 45% how close the 24-hour total was, 35% how many hours were within half the gauge amount (or both
          dry), and 20% whether wet hours were caught without false alarms. A wet hour is 0.2 mm or more.
        </p>
        <p>
          Forecasts: ECMWF IFS, NOAA GFS, DWD ICON, UK Met Office and ECCC GEM, via Open-Meteo previous model runs.
          Bureau ACCESS-G is not publishing on that open feed. Gauge traces © Bureau of Meteorology.
        </p>
        <p>
          An{" "}
          <a className="font-medium text-fg underline" href="https://aora73.github.io/AORA-Apps/shelf/">
            Australian Offroad Academy
          </a>{" "}
          app. Live weather radar is on{" "}
          <a className="font-medium text-fg underline" href="https://aoraradar.grok.me/">
            AORA Radar
          </a>
          .
        </p>
      </footer>
    </main>
    </div>
  );
}
