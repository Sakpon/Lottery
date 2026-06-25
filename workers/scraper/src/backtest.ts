/**
 * Leave-one-out backtest — สำหรับแต่ละงวดที่มีในฐานข้อมูล
 * รันโมเดลทั้งหมดโดยใช้เฉพาะข้อมูลก่อนหน้างวดนั้น แล้วบันทึกว่าเลขจริงที่ออก
 * อยู่อันดับเท่าไหร่ใน top-K ของแต่ละโมเดล
 *
 * ใช้เพื่อประเมินความแม่นเมื่อเทียบกับ baseline (สุ่ม) — ดูหน้า /accuracy
 */

import { predict } from "../../predictor/src/index";
import type { HistoricalNumber, Prediction, PrizeType } from "../../predictor/src/types";

const PRIZE_TYPES: PrizeType[] = ["first", "front_three", "last_three", "last_two"];
const MIN_HISTORY = 30;      // งวดก่อนหน้าต่ำสุดที่จะทำ backtest
const TOP_K = 10;

interface NumberRow {
  draw_date: string;
  prize_type: PrizeType;
  position: number;
  number: string;
}

interface BacktestRow {
  draw_date: string;
  prize_type: string;
  position: number;
  model: string;
  actual_number: string;
  top_k: number;
  hit_rank: number | null;
  actual_score: number;
}

/** รัน backtest สำหรับงวดเดียว — ใช้หลัง scrape งวดใหม่เสร็จ */
export async function backtestDraw(db: D1Database, drawDate: string): Promise<number> {
  const all = await loadAllNumbers(db);
  const before = all.filter((n) => n.draw_date < drawDate);
  const target = all.filter((n) => n.draw_date === drawDate);
  if (before.length < MIN_HISTORY || target.length === 0) return 0;
  return await writeResults(db, scoreDraw(drawDate, before, target));
}

/** รัน backtest ย้อนหลังเป็น batch — รองรับ pagination ด้วย `from`/`limit` */
export async function backtestRange(
  db: D1Database,
  opts: { from?: string; limit?: number; skipExisting?: boolean } = {},
): Promise<{ processed: number; inserted: number; dates: string[] }> {
  const { from, limit = 100, skipExisting = true } = opts;
  const all = await loadAllNumbers(db);
  const allDates = Array.from(new Set(all.map((n) => n.draw_date))).sort(); // asc
  const existing = skipExisting ? await loadExistingBacktestDates(db) : new Set<string>();

  const candidates = allDates.filter((d, idx) => idx >= MIN_HISTORY && (!from || d >= from) && !existing.has(d));
  const batch = candidates.slice(0, limit);
  const rows: BacktestRow[] = [];
  for (const date of batch) {
    const before = all.filter((n) => n.draw_date < date);
    const target = all.filter((n) => n.draw_date === date);
    rows.push(...scoreDraw(date, before, target));
  }
  const inserted = await writeResults(db, rows);
  return { processed: batch.length, inserted, dates: batch };
}

function scoreDraw(
  drawDate: string,
  before: NumberRow[],
  target: NumberRow[],
): BacktestRow[] {
  const rows: BacktestRow[] = [];
  for (const prize of PRIZE_TYPES) {
    const history: HistoricalNumber[] = before
      .filter((n) => n.prize_type === prize)
      .map((n) => ({
        drawDate: n.draw_date,
        prizeType: prize,
        number: n.number,
        position: n.position,
      }));
    if (history.length < MIN_HISTORY) continue;

    const actuals = target.filter((n) => n.prize_type === prize);
    if (actuals.length === 0) continue; // บางงวด/prize อาจไม่มีข้อมูล (เช่น front_three ก่อนปี 2558)

    const { models, ensemble } = predict(history, prize, TOP_K);
    const series: Record<string, Prediction[]> = { ...models, ensemble };

    for (const actual of actuals) {
      for (const [modelName, preds] of Object.entries(series)) {
        if (!preds.length) continue; // โมเดลไม่ได้ใช้กับ prize นี้
        const idx = preds.findIndex((p) => p.number === actual.number);
        rows.push({
          draw_date: drawDate,
          prize_type: prize,
          position: actual.position,
          model: modelName,
          actual_number: actual.number,
          top_k: TOP_K,
          hit_rank: idx >= 0 ? idx + 1 : null,
          actual_score: idx >= 0 ? preds[idx].score : 0,
        });
      }
    }
  }
  return rows;
}

async function loadAllNumbers(db: D1Database): Promise<NumberRow[]> {
  // โหลดครั้งเดียวสำหรับ batch ทั้งหมด — เร็วกว่า query ต่อ draw มาก
  const res = await db
    .prepare(
      `SELECT d.draw_date, n.prize_type, n.position, n.number
         FROM numbers n JOIN draws d ON d.id = n.draw_id
        ORDER BY d.draw_date ASC, n.prize_type, n.position`,
    )
    .all<NumberRow>();
  return res.results ?? [];
}

async function loadExistingBacktestDates(db: D1Database): Promise<Set<string>> {
  const res = await db
    .prepare("SELECT DISTINCT draw_date FROM backtest_results")
    .all<{ draw_date: string }>();
  return new Set((res.results ?? []).map((r) => r.draw_date));
}

async function writeResults(db: D1Database, rows: BacktestRow[]): Promise<number> {
  if (!rows.length) return 0;
  // batch ในชุด ~50 แถว (D1 batch limit ~100 statements)
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    const stmts = chunk.map((r) =>
      db
        .prepare(
          `INSERT INTO backtest_results
             (draw_date, prize_type, position, model, actual_number, top_k, hit_rank, actual_score)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(draw_date, prize_type, position, model) DO UPDATE SET
             hit_rank = excluded.hit_rank,
             actual_score = excluded.actual_score,
             top_k = excluded.top_k,
             created_at = datetime('now')`,
        )
        .bind(
          r.draw_date, r.prize_type, r.position, r.model,
          r.actual_number, r.top_k, r.hit_rank, r.actual_score,
        ),
    );
    await db.batch(stmts);
    inserted += chunk.length;
  }
  return inserted;
}
