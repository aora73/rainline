import type { ErrorComponentProps } from "@tanstack/react-router";
import { createFileRoute } from "@tanstack/react-router";
import { RainPage } from "@/components/rain-page";
import { compareRain } from "@/lib/rain.functions";

const DEFAULT_LAT = -37.052;
const DEFAULT_LON = 146.088;

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export const Route = createFileRoute("/")({
  validateSearch: (search) => {
    const lat = num(search.lat);
    const lon = num(search.lon);
    const q = typeof search.q === "string" ? search.q.slice(0, 80) : undefined;
    const hasPair = lat != null && lon != null && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
    return {
      lat: hasPair ? lat : undefined,
      lon: hasPair ? lon : undefined,
      q: hasPair ? q : undefined,
    };
  },
  loaderDeps: ({ search }) => ({ lat: search.lat, lon: search.lon }),
  loader: ({ deps }) =>
    compareRain({
      data: {
        latitude: deps.lat ?? DEFAULT_LAT,
        longitude: deps.lon ?? DEFAULT_LON,
      },
    }),
  staleTime: 10 * 60 * 1000,
  component: Home,
  errorComponent: RainError,
});

function Home() {
  const report = Route.useLoaderData();
  const search = Route.useSearch();
  const place = {
    lat: search.lat ?? DEFAULT_LAT,
    lon: search.lon ?? DEFAULT_LON,
    q: search.q ?? (search.lat == null ? "Mansfield, Victoria" : undefined),
  };
  return <RainPage report={report} place={place} />;
}

function RainError({ error, reset }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : "The forecast feed did not respond.";
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6">
      <img src="/aora-logo.png" alt="Australian Offroad Academy" className="h-12 w-auto bg-white" />
      <p className="mt-4 text-sm text-muted">Rainline</p>
      <h1 className="mt-2 font-display text-4xl text-fg">The forecasts didn’t load</h1>
      <p className="mt-3 text-sm text-muted">{message}</p>
      <button type="button" onClick={reset} className="mt-6 min-h-11 w-fit rounded-full bg-fg px-4 text-sm text-bg">
        Try again
      </button>
    </main>
  );
}
