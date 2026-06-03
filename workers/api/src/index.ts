/**
 * API Worker — serve ข้อมูลผลสลากและการทำนาย
 *
 * Endpoints (ทั้งหมดเป็น GET, cache-friendly):
 *   GET /api/draws/latest             → งวดล่าสุดพร้อมเลขรางวัล
 *   GET /api/draws?limit=20&offset=0  → รายการงวดย้อนหลัง
 *   GET /api/draws/:date              → งวดตามวันที่ (ISO YYYY-MM-DD)
 *   GET /api/stats/:prizeType?window=60 → สถิติ (hot/cold/digit freq)
 *   GET /api/predict/:prizeType?topK=10 → การทำนายงวดถัดไป
 *   GET /api/meta                     → ข้อมูลสรุป (total draws, latest, next-draw date)
 */

import { predict } from "../../predictor/src/index";
import { loadModelParams } from "../../predictor/src/loadParams";
import type { HistoricalNumber, PrizeType } from "../../predictor/src/types";

export interface Env {
  DB: D1Database;
  ALLOWED_ORIGIN: string;
  CACHE_TTL: string;
}

const VALID_PRIZES: PrizeType[] = [
  "first",
  "first_near",
  "front_three",
  "last_three",
  "last_two",
];

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === "OPTIONS") return cors(env, new Response(null, { status: 204 }));
    if (req.method !== "GET") return cors(env, json({ error: "method not allowed" }, 405));

    try {
      if (path === "/api/meta") return cors(env, await cached(env, ctx, req, () => getMeta(env)));
      if (path === "/api/draws/latest") return cors(env, await cached(env, ctx, req, () => getLatestDraw(env)));
      if (path === "/api/draws") {
        const limit = clamp(Number(url.searchParams.get("limit") ?? 20), 1, 100);
        const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));
        const yearParam = url.searchParams.get("year");
        const year = yearParam && /^\d{4}$/.test(yearParam) ? yearParam : null;
        return cors(env, await cached(env, ctx, req, () => listDraws(env, limit, offset, year)));
      }
      const drawDateMatch = path.match(/^\/api\/draws\/(\d{4}-\d{2}-\d{2})$/);
      if (drawDateMatch) {
        return cors(env, await cached(env, ctx, req, () => getDrawByDate(env, drawDateMatch[1])));
      }

      const statsMatch = path.match(/^\/api\/stats\/(\w+)$/);
      if (statsMatch) {
        const pt = statsMatch[1] as PrizeType;
        if (!VALID_PRIZES.includes(pt)) return cors(env, json({ error: "invalid prize type" }, 400));
        const windowSize = clamp(Number(url.searchParams.get("window") ?? 60), 6, 500);
        return cors(env, await cached(env, ctx, req, () => getStats(env, pt, windowSize)));
      }

      const predictMatch = path.match(/^\/api\/predict\/(\w+)$/);
      if (predictMatch) {
        const pt = predictMatch[1] as PrizeType;
        if (!VALID_PRIZES.includes(pt)) return cors(env, json({ error: "invalid prize type" }, 400));
        const topK = clamp(Number(url.searchParams.get("topK") ?? 10), 1, 50);
        return cors(env, await cached(env, ctx, req, () => getPrediction(env, pt, topK)));
      }

      if (path === "/api/accuracy") {
        const pt = (url.searchParams.get("prize") ?? "last_two") as PrizeType;
        if (!VALID_PRIZES.includes(pt)) return cors(env, json({ error: "invalid prize type" }, 400));
        const days = clamp(Number(url.searchParams.get("days") ?? 180), 7, 3650);
        // 60s edge TTL — accuracy data changes after manual "Backtest backfill"
        // workflow runs; users expect to see new results promptly without waiting
        // a full hour for the default TTL.
        return cors(env, await cached(env, ctx, req, () => getAccuracy(env, pt, days), 60));
      }

      if (path === "/api/accuracy/summary") {
        // Aggregate verdict across all prizes — for the "signal honesty"
        // banner at the top of /accuracy.html
        return cors(env, await cached(env, ctx, req, () => getAccuracySummary(env), 60));
      }

      if (path === "/api/bias") {
        const pt = (url.searchParams.get("prize") ?? "last_two") as PrizeType;
        if (!VALID_PRIZES.includes(pt)) return cors(env, json({ error: "invalid prize type" }, 400));
        return cors(env, await cached(env, ctx, req, () => getBias(env, pt)));
      }

      return cors(env, json({ error: "not found" }, 404));
    } catch (e) {
      return cors(env, json({ error: (e as Error).message }, 500));
    }
  },
};

// ───────────────────────── handlers ─────────────────────────
async function getMeta(env: Env): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS total, MAX(draw_date) AS latest, MIN(draw_date) AS earliest FROM draws`,
  ).first<{ total: number; latest: string; earliest: string }>();
  return json({
    total: row?.total ?? 0,
    latest: row?.latest ?? null,
    earliest: row?.earliest ?? null,
    nextDraw: computeNextDrawDate(),
  });
}

async function getLatestDraw(env: Env): Promise<Response> {
  const draw = await env.DB.prepare(
    `SELECT * FROM draws ORDER BY draw_date DESC LIMIT 1`,
  ).first<DrawRow>();
  if (!draw) return json({ error: "no data yet" }, 404);
  const nums = await fetchNumbers(env, [draw.id]);
  return json(serializeDraw(draw, nums.get(draw.id) ?? []));
}

async function listDraws(env: Env, limit: number, offset: number, year: string | null = null): Promise<Response> {
  const draws = year
    ? await env.DB.prepare(
        `SELECT * FROM draws WHERE draw_date >= ? AND draw_date < ? ORDER BY draw_date DESC LIMIT ? OFFSET ?`,
      ).bind(`${year}-01-01`, `${Number(year) + 1}-01-01`, limit, offset).all<DrawRow>()
    : await env.DB.prepare(
        `SELECT * FROM draws ORDER BY draw_date DESC LIMIT ? OFFSET ?`,
      ).bind(limit, offset).all<DrawRow>();
  const list = draws.results ?? [];
  const nums = await fetchNumbers(env, list.map((d) => d.id));
  return json({
    draws: list.map((d) => serializeDraw(d, nums.get(d.id) ?? [])),
    limit, offset, year,
  });
}

async function getDrawByDate(env: Env, date: string): Promise<Response> {
  const draw = await env.DB.prepare(`SELECT * FROM draws WHERE draw_date = ?`)
    .bind(date)
    .first<DrawRow>();
  if (!draw) return json({ error: "not found" }, 404);
  const nums = await fetchNumbers(env, [draw.id]);
  return json(serializeDraw(draw, nums.get(draw.id) ?? []));
}

async function getStats(env: Env, prizeType: PrizeType, windowSize: number): Promise<Response> {
  const cacheKey = `stats:${prizeType}:${windowSize}`;
  const cached = await readCache(env, cacheKey);
  if (cached) return json(cached);

  const rows = await env.DB.prepare(
    `SELECT d.draw_date, n.number, n.position
       FROM numbers n JOIN draws d ON d.id = n.draw_id
      WHERE n.prize_type = ?
      ORDER BY d.draw_date DESC
      LIMIT ?`,
  ).bind(prizeType, windowSize).all<{ draw_date: string; number: string; position: number }>();

  const freq = new Map<string, number>();
  const lastSeen = new Map<string, string>();
  for (const r of rows.results ?? []) {
    freq.set(r.number, (freq.get(r.number) ?? 0) + 1);
    if (!lastSeen.has(r.number)) lastSeen.set(r.number, r.draw_date);
  }
  const hot = Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([number, count]) => ({ number, count, lastSeen: lastSeen.get(number) }));

  // cold: เลขที่ไม่ปรากฏเลยในช่วง window
  const digits = (rows.results ?? [])[0]?.number.length ?? 2;
  const universe: string[] = [];
  const max = Math.pow(10, digits);
  for (let i = 0; i < max; i++) universe.push(String(i).padStart(digits, "0"));
  const cold = universe.filter((n) => !freq.has(n)).slice(0, 20);

  // digit-position frequency
  const posCounts: number[][] = Array.from({ length: digits }, () => Array(10).fill(0));
  for (const r of rows.results ?? []) {
    for (let p = 0; p < digits; p++) {
      const d = Number(r.number[p]);
      if (!isNaN(d)) posCounts[p][d]++;
    }
  }

  const payload = {
    prizeType,
    windowSize,
    totalDraws: rows.results?.length ?? 0,
    hot,
    cold,
    digitPositionFrequency: posCounts,
  };
  await writeCache(env, cacheKey, payload);
  return json(payload);
}

async function getPrediction(env: Env, prizeType: PrizeType, topK: number): Promise<Response> {
  const cacheKey = `predict:${prizeType}:${topK}`;
  const cached = await readCache(env, cacheKey);
  if (cached) return json(cached);

  const rows = await env.DB.prepare(
    `SELECT d.draw_date, n.number, n.position, n.prize_type
       FROM numbers n JOIN draws d ON d.id = n.draw_id
      WHERE n.prize_type = ?
      ORDER BY d.draw_date DESC
      LIMIT 2500`,
  ).bind(prizeType).all<{ draw_date: string; number: string; position: number; prize_type: PrizeType }>();

  const history: HistoricalNumber[] = (rows.results ?? []).map((r) => ({
    drawDate: r.draw_date,
    number: r.number,
    position: r.position,
    prizeType: r.prize_type,
  }));

  if (history.length < 10) {
    return json({
      prizeType,
      targetDate: computeNextDrawDate(),
      warning: "ข้อมูลน้อยเกินไปสำหรับการทำนาย (ต้องการอย่างน้อย 10 งวด)",
      models: {}, ensemble: [],
    });
  }

  // Pull tuned params if present (auto-tuner workflow writes these);
  // predict() falls back to DEFAULT_PARAMS for any missing field.
  const tunedParams = await loadModelParams(env.DB, prizeType);
  const tuneInfo = await env.DB.prepare(
    "SELECT best_score, n_eval_draws, tuned_at FROM model_params WHERE prize_type = ?",
  ).bind(prizeType).first<{ best_score: number; n_eval_draws: number; tuned_at: string }>();
  const { models, ensemble: combined } = predict(history, prizeType, topK, tunedParams);
  const payload = {
    prizeType,
    targetDate: computeNextDrawDate(),
    dataPoints: history.length,
    disclaimer: "การทำนายเป็นเพียงการวิเคราะห์ทางสถิติ ไม่รับประกันผล — โปรดเล่นอย่างมีสติ",
    tuning: tuneInfo
      ? { score: tuneInfo.best_score, evalDraws: tuneInfo.n_eval_draws, tunedAt: tuneInfo.tuned_at }
      : null,
    models,
    ensemble: combined,
  };
  await writeCache(env, cacheKey, payload);
  return json(payload);
}

async function getAccuracy(env: Env, prizeType: PrizeType, days: number): Promise<Response> {
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const rows = await env.DB.prepare(
    `SELECT draw_date, model, hit_rank, top_k
       FROM backtest_results
      WHERE prize_type = ? AND draw_date >= ?
      ORDER BY draw_date ASC`,
  ).bind(prizeType, cutoff).all<{ draw_date: string; model: string; hit_rank: number | null; top_k: number }>();

  const list = rows.results ?? [];
  const byModel = new Map<string, { draw_date: string; hit_rank: number | null; top_k: number }[]>();
  for (const r of list) {
    if (!byModel.has(r.model)) byModel.set(r.model, []);
    byModel.get(r.model)!.push(r);
  }

  const space = prizeSpaceSize(prizeType);
  const models = Array.from(byModel.entries()).map(([model, rs]) => {
    const total = rs.length;
    const hits = rs.filter((r) => r.hit_rank != null).length;
    const topK = rs[0]?.top_k ?? 10;
    const baseline = topK / space;
    const hitRate = total > 0 ? hits / total : 0;
    const meanRank = hits > 0
      ? rs.filter((r) => r.hit_rank != null).reduce((s, r) => s + (r.hit_rank ?? 0), 0) / hits
      : null;
    const pValue = binomialUpperTailPValue(hits, total, baseline);
    const series = rs.map((r) => ({ date: r.draw_date, hit: r.hit_rank != null ? 1 : 0 }));
    return { model, total, hits, hitRate, baseline, meanRank, pValue, topK, series };
  });

  // Sort so ensemble lands first if present
  models.sort((a, b) => {
    if (a.model === "ensemble") return -1;
    if (b.model === "ensemble") return 1;
    return a.model.localeCompare(b.model);
  });

  const totalDraws = new Set(list.map((r) => r.draw_date)).size;
  return json({
    prizeType,
    days,
    space,
    totalDraws,
    models,
    disclaimer: "ความแม่นทางสถิติ — ค่า p-value วัดว่าผลต่างกับ baseline มีนัยสำคัญหรือไม่",
  });
}

/**
 * Cross-prize verdict — for each prize type, find the best-performing model
 * across all historical backtests and report whether its lift over baseline
 * is statistically distinguishable from random.
 *
 * Used by /accuracy.html's "พบสัญญาณ" banner at the top of the page.
 */
async function getAccuracySummary(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT prize_type, model,
            COUNT(*) AS total,
            SUM(CASE WHEN hit_rank IS NOT NULL THEN 1 ELSE 0 END) AS hits,
            MAX(top_k) AS top_k
       FROM backtest_results
      GROUP BY prize_type, model`,
  ).all<{ prize_type: PrizeType; model: string; total: number; hits: number; top_k: number }>();

  const list = rows.results ?? [];
  const byPrize = new Map<PrizeType, typeof list>();
  for (const r of list) {
    if (!byPrize.has(r.prize_type)) byPrize.set(r.prize_type, []);
    byPrize.get(r.prize_type)!.push(r);
  }

  // For each prize, pick the model with the lowest p-value (most likely real signal)
  const prizes = VALID_PRIZES.map((prize) => {
    const rs = byPrize.get(prize) ?? [];
    if (!rs.length) {
      return {
        prizeType: prize, hasData: false, totalDraws: 0, bestModel: null,
        bestHitRate: null, baseline: prizeSpaceSize(prize) > 0 ? 10 / prizeSpaceSize(prize) : 0,
        bestPValue: null, verdict: "no_data" as const, models: [],
      };
    }
    const space = prizeSpaceSize(prize);
    const scored = rs.map((r) => {
      const baseline = r.top_k / space;
      const hitRate = r.total > 0 ? r.hits / r.total : 0;
      const pValue = binomialUpperTailPValue(r.hits, r.total, baseline);
      return { ...r, baseline, hitRate, pValue };
    });
    // Rank by performance: highest hit rate first. Every model for a given prize
    // is backtested on the same set of draws, so N is equal across models and the
    // hit rate is a fair head-to-head; tie-break by the more significant p-value.
    scored.sort((a, b) => b.hitRate - a.hitRate || a.pValue - b.pValue);
    const best = scored[0];
    const bestHit = best.hitRate;
    // A model is "close to best" if it captures most of the leader's edge — within
    // 10% (relative) of the top hit rate, and still actually doing something.
    const models = scored.map((m, i) => ({
      model: m.model,
      hitRate: m.hitRate,
      baseline: m.baseline,
      lift: m.baseline > 0 ? (m.hitRate - m.baseline) / m.baseline : 0,
      pValue: m.pValue,
      total: m.total,
      rank: i + 1,
      isBest: i === 0,
      closeToBest: i > 0 && bestHit > 0 && m.hitRate >= 0.9 * bestHit,
    }));
    const verdict: "no_signal" | "weak_signal" | "strong_signal" | "below_baseline" =
      best.hitRate < best.baseline ? "below_baseline"
      : best.pValue < 0.01 ? "strong_signal"
      : best.pValue < 0.05 ? "weak_signal"
      : "no_signal";
    return {
      prizeType: prize,
      hasData: true,
      totalDraws: best.total,
      bestModel: best.model,
      bestHitRate: best.hitRate,
      baseline: best.baseline,
      bestPValue: best.pValue,
      verdict,
      models,
    };
  });

  // Overall = "พบสัญญาณ" only if any prize has p < 0.05 with hit_rate > baseline
  const overall = prizes.some((p) => p.verdict === "strong_signal" || p.verdict === "weak_signal")
    ? "signal_found"
    : "no_signal_found";

  return json({
    overall,
    prizes,
    disclaimer: "การออกรางวัลสลากกินแบ่งเป็นการสุ่ม — ไม่มีโมเดลใดสามารถทำนายล่วงหน้าได้แม่นกว่าการสุ่มในระยะยาว ค่าเหล่านี้แสดงเพื่อความโปร่งใส",
  });
}

function prizeSpaceSize(prize: PrizeType): number {
  switch (prize) {
    case "first": case "first_near": return 1_000_000;
    case "front_three": case "last_three": return 1000;
    case "last_two": return 100;
  }
}

/**
 * Binomial upper-tail probability: P(X >= observed) given n trials and base prob p.
 * Uses the regularized incomplete beta function via a log-domain summation to
 * stay stable for large n (a few hundred draws).
 */
function binomialUpperTailPValue(observed: number, n: number, p: number): number {
  if (n <= 0 || observed <= 0) return 1;
  if (p <= 0) return observed > 0 ? 0 : 1;
  if (p >= 1) return observed >= n ? 1 : 0;
  const logP = Math.log(p);
  const log1mP = Math.log(1 - p);
  let sum = 0;
  for (let k = observed; k <= n; k++) {
    sum += Math.exp(logChoose(n, k) + k * logP + (n - k) * log1mP);
  }
  return Math.min(1, sum);
}

const logFactCache: number[] = [0, 0];
function logFactorial(n: number): number {
  for (let i = logFactCache.length; i <= n; i++) {
    logFactCache[i] = logFactCache[i - 1] + Math.log(i);
  }
  return logFactCache[n];
}
function logChoose(n: number, k: number): number {
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

// ───────────────────────── bias ─────────────────────────
// สำหรับแต่ละ "หลัก" (digit position) นับว่าเลข 0..9 ปรากฏกี่ครั้ง แล้วทำ
// chi-square goodness-of-fit เทียบกับ uniform (คาดหวังเท่ากันทุกหลัก = N/10)
//
// Caveat ทางสถิติ: 461 งวด × 6 หลัก = 2766 จุดข้อมูล แม้แต่ chi-square ที่ p<0.05
// ก็อาจเป็นเพียง sampling variance — multiple testing เป็นปัญหาจริงเมื่อทดสอบ
// หลายหลักพร้อมกัน เราจึงรายงานทั้ง raw p และ Bonferroni-adjusted threshold
async function getBias(env: Env, prizeType: PrizeType): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT n.number, n.position FROM numbers n WHERE n.prize_type = ?`,
  ).bind(prizeType).all<{ number: string; position: number }>();

  const list = rows.results ?? [];
  if (!list.length) {
    // Keep the response shape stable so the client never trips over a missing
    // field (e.g. bonferroniAlpha) when there is no data yet.
    return json({ prizeType, totalSamples: 0, digits: 0, positions: [], bonferroniAlpha: 0.05 });
  }

  // Derive digit-width from the most common number length rather than trusting
  // an arbitrary first row — a single malformed entry must not skew the whole
  // analysis (or, worse, leave a tested position with zero samples).
  const digits = mode(list.map((r) => r.number.length));
  // counts[pos][digit] = freq across all draws at that digit-position
  const counts: number[][] = Array.from({ length: digits }, () => Array(10).fill(0));
  let total = 0;
  for (const r of list) {
    if (r.number.length !== digits) continue;
    for (let p = 0; p < digits; p++) {
      const d = Number(r.number[p]);
      if (!isNaN(d)) counts[p][d]++;
    }
    total++;
  }

  const positions = counts.map((row, pos) => {
    const n = row.reduce((a, b) => a + b, 0);
    const expected = n / 10;
    // chi-square goodness-of-fit, df=9. Guard expected === 0 (a position with no
    // samples): dividing by it yields NaN, which JSON.stringify emits as null and
    // crashes the client's `.toFixed`. Treat "no data" as "no evidence of bias".
    let chiSq = 0;
    if (expected > 0) {
      for (let d = 0; d < 10; d++) {
        const diff = row[d] - expected;
        chiSq += (diff * diff) / expected;
      }
    }
    const pValue = chiSquarePValueDf9(chiSq);
    return {
      position: pos,
      digitCounts: row,
      n,
      expectedPerDigit: expected,
      chiSquare: chiSq,
      pValue,
    };
  });

  // Bonferroni-adjust the alpha=0.05 threshold by number of positions tested
  const bonferroniAlpha = 0.05 / digits;

  return json({
    prizeType,
    digits,
    totalSamples: total,
    positions,
    bonferroniAlpha,
    df: 9,
    chiSquareCrit95: 16.92,  // df=9
    chiSquareCrit99: 21.67,
  });
}

// Most frequently occurring value — used to pick the dominant digit-width when
// the data may contain the odd malformed entry.
function mode(values: number[]): number {
  const freq = new Map<number, number>();
  let best = values[0];
  let bestCount = 0;
  for (const v of values) {
    const c = (freq.get(v) ?? 0) + 1;
    freq.set(v, c);
    if (c > bestCount) { best = v; bestCount = c; }
  }
  return best;
}

// Survival of chi-square distribution with df=9 — approximated via series
// (df=9 is what we always use here; one-off so no need for a generic gammainc)
function chiSquarePValueDf9(x: number): number {
  if (x <= 0) return 1;
  // For df=9, P(X > x) = e^(-x/2) * Σ_{k=0..4} (x/2)^k / k!  + tail correction
  // df=9 is odd; closed form uses erfc(√(x/2)) plus polynomial.
  // We use Wilson–Hilferty approximation: ((x/df)^(1/3) - (1 - 2/(9df))) / √(2/(9df)) ~ N(0,1)
  const df = 9;
  const t = Math.pow(x / df, 1 / 3);
  const mean = 1 - 2 / (9 * df);
  const sd = Math.sqrt(2 / (9 * df));
  const z = (t - mean) / sd;
  // standard normal survival function
  return 0.5 * erfc(z / Math.SQRT2);
}

function erfc(x: number): number {
  // Abramowitz & Stegun 7.1.26 — max error ~1.5e-7
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return sign === 1 ? 1 - y : 1 + y;
}

// ───────────────────────── helpers ─────────────────────────
interface DrawRow {
  id: number;
  draw_date: string;
  draw_date_th: string;
  source: string;
  source_url: string;
  scraped_at: string;
  verified: number;
}

async function fetchNumbers(env: Env, drawIds: number[]): Promise<Map<number, NumberRow[]>> {
  const map = new Map<number, NumberRow[]>();
  if (!drawIds.length) return map;
  const placeholders = drawIds.map(() => "?").join(",");
  const res = await env.DB.prepare(
    `SELECT draw_id, prize_type, number, position FROM numbers WHERE draw_id IN (${placeholders})`,
  ).bind(...drawIds).all<NumberRow & { draw_id: number }>();
  for (const r of res.results ?? []) {
    if (!map.has(r.draw_id)) map.set(r.draw_id, []);
    map.get(r.draw_id)!.push({ prize_type: r.prize_type, number: r.number, position: r.position });
  }
  return map;
}

interface NumberRow { prize_type: string; number: string; position: number; }

function serializeDraw(d: DrawRow, nums: NumberRow[]) {
  const groups: Record<string, string[]> = {};
  for (const n of nums) {
    groups[n.prize_type] ??= [];
    groups[n.prize_type][n.position] = n.number;
  }
  return {
    date: d.draw_date,
    dateTh: d.draw_date_th,
    sourceUrl: d.source_url,
    verified: !!d.verified,
    prizes: {
      first: groups.first?.[0] ?? null,
      firstNear: (groups.first_near ?? []).filter(Boolean),
      frontThree: (groups.front_three ?? []).filter(Boolean),
      lastThree: (groups.last_three ?? []).filter(Boolean),
      lastTwo: groups.last_two?.[0] ?? null,
    },
  };
}

function computeNextDrawDate(): string {
  // งวดออกทุกวันที่ 1 และ 16 ของเดือน
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  let target: Date;
  if (d < 1) target = new Date(Date.UTC(y, m, 1));
  else if (d < 16) target = new Date(Date.UTC(y, m, 16));
  else target = new Date(Date.UTC(y, m + 1, 1));
  return target.toISOString().slice(0, 10);
}

async function readCache(env: Env, key: string): Promise<unknown | null> {
  const ttl = Number(env.CACHE_TTL ?? "3600");
  const row = await env.DB.prepare(
    `SELECT value_json, updated_at FROM stats_cache WHERE key = ?`,
  ).bind(key).first<{ value_json: string; updated_at: string }>();
  if (!row) return null;
  const updated = new Date(row.updated_at + "Z").getTime();
  if (Date.now() - updated > ttl * 1000) return null;
  try { return JSON.parse(row.value_json); } catch { return null; }
}

async function writeCache(env: Env, key: string, value: unknown): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO stats_cache (key, value_json, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
  ).bind(key, JSON.stringify(value)).run();
}

async function cached(
  env: Env,
  ctx: ExecutionContext,
  req: Request,
  handler: () => Promise<Response>,
  ttlOverride?: number,
): Promise<Response> {
  const cache = caches.default;
  const cacheKey = new Request(req.url, { method: "GET" });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  const res = await handler();
  const fresh = new Response(res.body, res);
  const ttl = ttlOverride ?? Number(env.CACHE_TTL ?? 3600);
  fresh.headers.set("Cache-Control", `public, max-age=${ttl}`);
  ctx.waitUntil(cache.put(cacheKey, fresh.clone()));
  return fresh;
}

function cors(env: Env, res: Response): Response {
  const h = new Headers(res.headers);
  h.set("Access-Control-Allow-Origin", env.ALLOWED_ORIGIN ?? "*");
  h.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  h.set("Access-Control-Allow-Headers", "content-type");
  return new Response(res.body, { status: res.status, headers: h });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function clamp(n: number, min: number, max: number): number {
  if (isNaN(n)) return min;
  return Math.min(Math.max(n, min), max);
}
