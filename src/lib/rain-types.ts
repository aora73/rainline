export const SOURCES = [
  {
    id: "ecmwf_ifs",
    short: "ECMWF",
    name: "ECMWF IFS",
    agency: "European Centre for Medium-Range Weather Forecasts",
  },
  {
    id: "gfs_seamless",
    short: "GFS",
    name: "NOAA GFS",
    agency: "US National Weather Service",
  },
  {
    id: "icon_seamless",
    short: "ICON",
    name: "DWD ICON",
    agency: "German Weather Service",
  },
  {
    id: "ukmo_seamless",
    short: "UKMO",
    name: "UK Met Office",
    agency: "Met Office",
  },
  {
    id: "gem_seamless",
    short: "GEM",
    name: "ECCC GEM",
    agency: "Environment and Climate Change Canada",
  },
] as const;

export type SourceId = (typeof SOURCES)[number]["id"];

export type FutureHour = {
  time: string;
  rain: Record<SourceId, number | null>;
  chance: Record<SourceId, number | null>;
};

export type PastHour = {
  time: string;
  called: Record<SourceId, number | null>;
  actual: number | null;
};

export type SourceScore = {
  id: SourceId;
  score: number | null;
  volumeScore: number | null;
  timingScore: number | null;
  eventScore: number | null;
  forecastMm: number | null;
  actualMm: number | null;
  biasMm: number | null;
  wetHits: number;
  wetObserved: number;
  falseAlarms: number;
  hours: number;
  total48Mm: number | null;
  peakChance: number | null;
};

export type GaugeInfo = {
  name: string;
  distanceKm: number;
  wmo: string;
  since9amMm: number | null;
  observedAt: string;
  hoursCovered: number;
  elevationM: number | null;
};

export type RainReport = {
  latitude: number;
  longitude: number;
  elevation: number | null;
  timezone: string;
  nowKey: string;
  future: FutureHour[];
  past: PastHour[];
  sources: SourceScore[];
  reference: "gauge" | "consensus";
  referenceNote: string;
  gauge: GaugeInfo | null;
};
