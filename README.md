# Rainline

Hour-by-hour rain from six forecast models, scored against the nearest rain gauge.

- **Live app:** https://rain-forecast.grok.me/
- Part of the [Australian Offroad Academy](https://github.com/aora73/aora-shelf) collection.

Pick a place in Australia. Rainline shows the next 48 hours from ECMWF IFS, ECMWF AIFS, GFS, ICON, UKMO and GEM, then checks what each source called for the last day against the gauge (or the model consensus when no gauge is close enough). AIFS has rainfall totals only.

## Run locally

```bash
npm install
npm run dev
```

The dev server uses Open-Meteo for forecasts and the Open-Meteo historical API for gauge checks. No API key is required.

