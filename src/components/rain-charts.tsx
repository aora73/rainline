import { type ReactNode, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { hourLabel } from "@/lib/rain-score";
import { SOURCES, type FutureHour, type PastHour, type SourceId } from "@/lib/rain-types";

const SERIES_COLOR: Record<SourceId, string> = {
  ecmwf_ifs: "var(--color-series-ecmwf)",
  gfs_seamless: "var(--color-series-gfs)",
  icon_seamless: "var(--color-series-icon)",
  ukmo_seamless: "var(--color-series-ukmo)",
  gem_seamless: "var(--color-series-gem)",
};

const HOURS_IN_VIEW = 12;
const AXIS_HEIGHT = 28;

type Mode = "hourly" | "chance" | "total";
type ChartRow = Record<string, string | number | null>;

function Tip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | null; color?: string }>;
  label?: string;
  unit: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="panel px-3 py-2 text-sm">
      <p className="mb-1 text-muted">{label}</p>
      <ul className="space-y-0.5">
        {payload.map((item) => (
          <li key={item.name} className="flex justify-between gap-4 tabular-nums" style={{ color: item.color }}>
            <span>{item.name}</span>
            <span>
              {item.value == null || Number.isNaN(item.value) ? "—" : `${Number(item.value).toFixed(unit === "%" ? 0 : 1)}${unit === "%" ? "%" : " mm"}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function domainTop(rows: ChartRow[], keys: string[], chance: boolean): number {
  if (chance) return 100;
  let max = 0;
  for (const row of rows) {
    for (const key of keys) {
      const value = row[key];
      if (typeof value === "number" && value > max) max = value;
    }
  }
  if (max <= 0) return 1;
  const padded = max * 1.1;
  return padded <= 2 ? Math.ceil(padded * 10) / 10 : Math.ceil(padded);
}

function ScrollPlot({
  data,
  domain,
  unit,
  axisKey,
  heightClass,
  children,
}: {
  data: ChartRow[];
  domain: [number, number];
  unit: string;
  axisKey: string;
  heightClass: string;
  children: ReactNode;
}) {
  const span = Math.max(data.length / HOURS_IN_VIEW, 1);
  const tick = { fill: "var(--color-muted)", fontSize: 12 };
  return (
    <div className={`flex ${heightClass}`}>
      <div className="w-11 shrink-0" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
            <YAxis
              width={40}
              domain={domain}
              tick={tick}
              axisLine={false}
              tickLine={false}
              unit={unit === "%" ? "%" : ""}
            />
            <XAxis dataKey="label" tick={false} height={AXIS_HEIGHT} axisLine={false} tickLine={false} />
            <Line dataKey={axisKey} stroke="transparent" dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div
        className="hour-scroll min-w-0 flex-1"
        tabIndex={0}
        role="region"
        aria-label="Chart of 12 hours. Scroll sideways for later hours."
      >
        <div style={{ width: `${span * 100}%`, height: "100%" }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--color-line)" vertical={false} />
              <XAxis
                dataKey="label"
                interval={1}
                height={AXIS_HEIGHT}
                tick={tick}
                axisLine={false}
                tickLine={false}
              />
              <YAxis hide width={0} domain={domain} />
              <Tooltip content={<Tip unit={unit} />} />
              {children}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

export function OutlookChart({
  hours,
  scores,
}: {
  hours: FutureHour[];
  scores: Array<{ id: SourceId; score: number | null }>;
}) {
  const [mode, setMode] = useState<Mode>("hourly");
  const [hidden, setHidden] = useState<SourceId[]>([]);

  const best = useMemo(() => {
    const order = new Map(SOURCES.map((source, index) => [source.id, index]));
    return [...scores]
      .sort((a, b) => {
        const gap = (b.score ?? -1) - (a.score ?? -1);
        if (gap !== 0) return gap;
        return (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
      })
      .slice(0, 2)
      .map((source) => source.id);
  }, [scores]);

  const data = useMemo(() => {
    const running: Record<SourceId, number> = {
      ecmwf_ifs: 0,
      gfs_seamless: 0,
      icon_seamless: 0,
      ukmo_seamless: 0,
      gem_seamless: 0,
    };
    return hours.map((hour, index) => {
      const prevDay = index > 0 ? hours[index - 1].time.slice(0, 10) : "";
      const row: ChartRow = {
        label: hourLabel(hour.time, hour.time.slice(0, 10) !== prevDay),
      };
      for (const source of SOURCES) {
        const rain = hour.rain[source.id];
        if (rain != null) running[source.id] += rain;
        if (mode === "chance") row[source.id] = hour.chance[source.id];
        else if (mode === "total") row[source.id] = rain == null ? null : Math.round(running[source.id] * 10) / 10;
        else row[source.id] = rain;
      }
      return row;
    });
  }, [hours, mode]);

  const unit = mode === "chance" ? "%" : "mm";
  const visible = SOURCES.filter((source) => !hidden.includes(source.id));
  const showingBest =
    best.length === 2 &&
    visible.length === 2 &&
    best.every((id) => visible.some((source) => source.id === id));
  const domain: [number, number] = [0, domainTop(data, visible.map((source) => source.id), mode === "chance")];
  const modes: Array<{ id: Mode; label: string }> = [
    { id: "hourly", label: "Hourly" },
    { id: "chance", label: "Chance" },
    { id: "total", label: "Running total" },
  ];

  return (
    <section className="panel p-4 md:p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-display text-2xl text-fg">Next 48 hours</h2>
          <p className="mt-1 text-sm text-muted">
            {mode === "chance"
              ? "Chance of more than 0.1 mm in the hour."
              : mode === "total"
                ? "Rainfall adding up from this hour forward."
                : "Millimetres expected in each hour."}{" "}
            Swipe sideways — 12 hours at a time.
          </p>
        </div>
        <div className="flex rounded-full bg-bg p-1" role="tablist" aria-label="Chart mode">
          {modes.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={mode === item.id}
              onClick={() => setMode(item.id)}
              className={
                "min-h-11 rounded-full px-3 text-sm " +
                (mode === item.id ? "bg-fg text-bg" : "text-muted")
              }
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <ScrollPlot data={data} domain={domain} unit={unit} axisKey={SOURCES[0].id} heightClass="h-64 md:h-72">
        {visible.map((source) => (
          <Line
            key={source.id}
            type="monotone"
            dataKey={source.id}
            name={source.short}
            stroke={SERIES_COLOR[source.id]}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </ScrollPlot>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={showingBest}
          onClick={() =>
            setHidden(showingBest ? [] : SOURCES.map((source) => source.id).filter((id) => !best.includes(id)))
          }
          className={
            "min-h-11 rounded-full px-3 text-sm " + (showingBest ? "bg-fg text-bg" : "bg-bg text-fg")
          }
        >
          Top two
        </button>
        {SOURCES.map((source) => {
          const off = hidden.includes(source.id);
          return (
            <button
              key={source.id}
              type="button"
              aria-pressed={!off}
              onClick={() =>
                setHidden((current) =>
                  current.includes(source.id) ? current.filter((id) => id !== source.id) : [...current, source.id],
                )
              }
              className={"min-h-11 rounded-full px-3 text-sm " + (off ? "text-faint" : "text-fg")}
            >
              <span
                className="mr-2 inline-block size-2.5 rounded-full"
                style={{ background: off ? "var(--color-line)" : SERIES_COLOR[source.id] }}
              />
              {source.short}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function HindcastChart({ hours, reference }: { hours: PastHour[]; reference: "gauge" | "consensus" }) {
  const data: ChartRow[] = hours.map((hour, index) => {
    const prevDay = index > 0 ? hours[index - 1].time.slice(0, 10) : "";
    const row: ChartRow = {
      label: hourLabel(hour.time, hour.time.slice(0, 10) !== prevDay),
      actual: hour.actual,
    };
    for (const source of SOURCES) row[source.id] = hour.called[source.id];
    return row;
  });
  const domain: [number, number] = [0, domainTop(data, ["actual", ...SOURCES.map((source) => source.id)], false)];

  return (
    <section className="panel p-4 md:p-5">
      <h2 className="font-display text-2xl text-fg">Last 24 hours</h2>
      <p className="mt-1 text-sm text-muted">
        What each source forecast about a day earlier, against{" "}
        {reference === "gauge" ? "the gauge" : "the model consensus"}. Swipe sideways — 12 hours at a time.
      </p>
      <div className="mt-4">
        <ScrollPlot data={data} domain={domain} unit="mm" axisKey="actual" heightClass="h-56 md:h-64">
          <Line
            type="monotone"
            dataKey="actual"
            name={reference === "gauge" ? "Gauge" : "Consensus"}
            stroke="var(--color-series-actual)"
            strokeWidth={2.75}
            dot={false}
            isAnimationActive={false}
          />
          {SOURCES.map((source) => (
            <Line
              key={source.id}
              type="monotone"
              dataKey={source.id}
              name={source.short}
              stroke={SERIES_COLOR[source.id]}
              strokeWidth={1.75}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </ScrollPlot>
      </div>
    </section>
  );
}
