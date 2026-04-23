# Historical lottery draws — import format

Drop a JSON file here (default: `draws.json`) then run the **Import historical draws**
workflow. Each entry represents one draw. All prize fields are optional — include
whatever your source provides.

```json
[
  {
    "drawDate":   "2006-01-16",
    "drawDateTh": "16 มกราคม 2549",
    "sourceUrl":  "https://…",
    "first":      "123456",
    "firstNear":  ["123455", "123457"],
    "frontThree": ["123", "456"],
    "lastThree":  ["789", "012"],
    "lastTwo":    "34"
  }
]
```

## Field notes

- `drawDate` is ISO (Gregorian year), e.g. `2006-01-16` — not Buddhist year.
- `drawDateTh` is the Thai display form with BE year, e.g. `16 มกราคม 2549`.
- Draws already in D1 with the same `drawDate` are **not overwritten** by default.
  Run the workflow with `replace: true` if you want to overwrite number rows for
  the matched draws (the draw row itself is never deleted, just its numbers).
- Imported draws are stored with `source = 'imported'` so they can be distinguished
  from scraper-sourced rows.

## Expected size

Thai lottery draws on the 1st and 16th of each month → 24/year. Over 20 years that's
roughly 480 entries. The importer batches 50 entries per `wrangler d1 execute` call,
so ~10 batches for a full 20-year dataset.

## Sources you can point the importer at

This pipeline expects JSON in the format above. Convert from whatever CSV / API your
source provides before committing. A few places the community has published this data:

- GitHub repos (search "thai lottery history json")
- `lottery-api-thailand` and similar npm packages
- GLO (the official issuer) — requires scraping, ~20 years back
