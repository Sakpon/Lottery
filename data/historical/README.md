# Historical lottery draws — import format

`draws.json` in this directory is the dataset currently staged for import. Run the
**Import historical draws** workflow to load it into D1.

## Source

The current `draws.json` was generated from [**vicha-w/thai-lotto-archive**](https://github.com/vicha-w/thai-lotto-archive) (461 draws, 2006-12-30 → 2026-04-16) via `scripts/convert-vicha-archive.mjs`.

The source repo has no explicit license, but lottery draw numbers are factual records and not subject to copyright. Attribution retained in `source_url` on each row.

To regenerate with a newer snapshot:

```bash
git clone --depth=1 https://github.com/vicha-w/thai-lotto-archive /tmp/lotto-archive
node scripts/convert-vicha-archive.mjs /tmp/lotto-archive/lottonumbers > data/historical/draws.json
```

## JSON format (if you want to roll your own)

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
- Thai lottery's prize structure changed in Aug 2015. Pre-2016 draws have **4** `lastThree`
  numbers and no `frontThree`. From 2016 onwards: 2 `frontThree` + 2 `lastThree`. The
  importer stores whatever you give it at positions 0..N-1.
- Draws already in D1 with the same `drawDate` are **not overwritten** by default.
  Run the workflow with `replace: true` to overwrite number rows (the draw row itself
  is never deleted).
- Imported draws are stored with `source = 'imported'` so they can be distinguished
  from scraper-sourced rows.

## Expected size

Thai lottery draws on the 1st and 16th of each month → 24/year. Over 20 years that's
roughly 480 entries. The importer batches 50 entries per `wrangler d1 execute` call.