/**
 * Hyperparameter tuner — leave-one-out grid search over a small set of
 * (frequency.windowSize, frequency.halfLife, digitPosition.windowSize)
 * combinations per prize type. The combo with the best hit@10 on the last
 * `evalDraws` draws is written to the `model_params` table; predict() picks
 * it up on the next request.
 *
 * Designed to fit under a Worker's 30 s CPU budget per /tune call: at most
 * ~3,000 predict() invocations per prize type with the default grid + 30
 * eval draws. Bigger sweeps should be sliced via the workflow's loop.
 */

import { predict } from "../../predictor/src/index";
import type { HistoricalNumber, PrizeType, PredictParams } from "../../predictor/src/types";

const TOP_K = 10;
const PRIZE_TYPES: PrizeType[] = ["first", "front_three", "last_three", "last_two"];

interface NumberRow {
  draw_date: string;
  prize_type: PrizeType;
  position: number;
  number: string;
}

interface GridPoint {
  params: PredictParams;
  label: string;
}

/** Build a compact grid — kept small to fit CPU budget. */
function buildGrid(prize: PrizeType): GridPoint[] {
  const grid: GridPoint[] = [];
  const freqWins = [30, 60, 120];
  const halfLives = [15, 30, 60];
  // digit_position is only used for non-last_two prizes — vary its window too
  const dpWins = prize === "last_two" ? [120] : [60, 120, 240];

  for (const fw of freqWins) {
    for (const hl of halfLives) {
      for (const dp of dpWins) {
        grid.push({
          params: {
            frequency: { windowSize: fw, halfLife: hl },
            digitPosition: { windowSize: dp },
          },
          label: `freq(${fw},${hl})${prize === "last_two" ? "" : ` dp(${dp})`}`,
        });
      }
    }
  }
  return grid;
}

interface TuneResult {
  prizeType: PrizeType;
  best: { params: PredictParams; score: number; label: string };
  triedCombos: number;
  evalDraws: number;
  topCombos: { label: string; score: number }[];
}

export async function tunePrize(
  db: D1Database,
  prize: PrizeType,
  evalDraws = 30,
): Promise<TuneResult | null> {
  const all = await loadAllForPrize(db, prize);
  if (all.length < 60) return null; // need enough history + eval set
  // Group rows into draws — each draw may have 1 or 2 actuals depending on prize
  const drawDates = Array.from(new Set(all.map((r) => r.draw_date))).sort(); // asc
  if (drawDates.length < evalDraws + 30) return null;

  // Last `evalDraws` draws form the eval set; everything before is training
  const evalDates = drawDates.slice(-evalDraws);
  const grid = buildGrid(prize);

  const scored: { label: string; params: PredictParams; score: number }[] = [];
  for (const point of grid) {
    let hits = 0;
    let total = 0;
    for (const date of evalDates) {
      const history = toHistory(all.filter((r) => r.draw_date < date), prize);
      if (history.length < 30) continue;
      const actuals = all.filter((r) => r.draw_date === date);
      if (!actuals.length) continue;

      const { ensemble } = predict(history, prize, TOP_K, point.params);
      for (const actual of actuals) {
        total++;
        if (ensemble.some((p) => p.number === actual.number)) hits++;
      }
    }
    const score = total > 0 ? hits / total : 0;
    scored.push({ label: point.label, params: point.params, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  await db
    .prepare(
      `INSERT INTO model_params (prize_type, params_json, best_score, n_combos, n_eval_draws, tuned_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(prize_type) DO UPDATE SET
         params_json = excluded.params_json,
         best_score = excluded.best_score,
         n_combos = excluded.n_combos,
         n_eval_draws = excluded.n_eval_draws,
         tuned_at = excluded.tuned_at`,
    )
    .bind(prize, JSON.stringify(best.params), best.score, grid.length, evalDates.length)
    .run();

  return {
    prizeType: prize,
    best: { params: best.params, score: best.score, label: best.label },
    triedCombos: grid.length,
    evalDraws: evalDates.length,
    topCombos: scored.slice(0, 5).map(({ label, score }) => ({ label, score })),
  };
}

export async function tuneAll(
  db: D1Database,
  evalDraws = 30,
): Promise<TuneResult[]> {
  const results: TuneResult[] = [];
  for (const prize of PRIZE_TYPES) {
    const r = await tunePrize(db, prize, evalDraws);
    if (r) results.push(r);
  }
  return results;
}

async function loadAllForPrize(db: D1Database, prize: PrizeType): Promise<NumberRow[]> {
  const res = await db
    .prepare(
      `SELECT d.draw_date, n.prize_type, n.position, n.number
         FROM numbers n JOIN draws d ON d.id = n.draw_id
        WHERE n.prize_type = ?
        ORDER BY d.draw_date ASC, n.position`,
    )
    .bind(prize)
    .all<NumberRow>();
  return res.results ?? [];
}

function toHistory(rows: NumberRow[], prize: PrizeType): HistoricalNumber[] {
  return rows.map((r) => ({
    drawDate: r.draw_date,
    prizeType: prize,
    number: r.number,
    position: r.position,
  }));
}
