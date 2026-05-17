/**
 * Scraper Worker — ดึงผลรางวัลสลากกินแบ่งรัฐบาลไทยจาก sanook.com
 *
 * โหมดทำงาน:
 *   1. Scheduled  : รันทุกวันที่ 2 และ 17 ของเดือน ดึงงวดล่าสุด
 *   2. Backfill   : POST /backfill?years=20  (ต้องแนบ X-Admin-Token)
 *   3. Manual     : POST /fetch?date=YYYY-MM-DD
 */

import { parseSanookDrawPage, listSanookArchiveUrls } from "./parser";
import type { ParsedDraw } from "./parser";
import { backtestDraw, backtestRange } from "./backtest";
import { tuneAll, tunePrize } from "./tune";
import type { PrizeType } from "../../predictor/src/types";

export interface Env {
  DB: D1Database;
  SOURCE_BASE: string;
  USER_AGENT: string;
  BACKFILL_YEARS: string;
  ADMIN_TOKEN?: string;
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduled(env));
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // auth
    const token = req.headers.get("X-Admin-Token");
    if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
      return json({ error: "unauthorized" }, 401);
    }

    if (req.method === "POST" && url.pathname === "/backfill") {
      const years = Number(url.searchParams.get("years") ?? env.BACKFILL_YEARS ?? "20");
      // force=1 → ลบหมายเลขเดิมของทุกงวดก่อนเขียนใหม่ (ใช้หลังแก้ parser bug
      //            เพื่อให้ข้อมูลเก่าที่ผิดถูกเขียนทับทั้งหมด)
      const force = url.searchParams.get("force") === "1";
      const added = await runBackfill(env, years, force);
      return json({ ok: true, added });
    }

    if (req.method === "POST" && url.pathname === "/fetch") {
      const date = url.searchParams.get("date");
      if (!date) return json({ error: "missing ?date=YYYY-MM-DD" }, 400);
      // force=1 → ลบหมายเลขเดิมของงวดนั้นก่อนเขียนใหม่ (ใช้ตอน parser ถูกแก้
      //            แล้วต้องเขียนทับข้อมูลเก่าที่ผิด)
      const force = url.searchParams.get("force") === "1";
      // debug=1 → ไม่เขียน DB, คืน snippet ของ HTML รอบ ๆ คำว่า "งวด" ทุกจุด
      //            ใช้ debug เวลา parser anchor ไม่เจอ heading ที่คาด
      if (url.searchParams.get("debug") === "1") {
        const result = await fetchForDebug(env, date);
        return json(result);
      }
      const result = await fetchAndStoreByDate(env, date, force);
      return json({ ok: true, ...result });
    }

    if (req.method === "GET" && url.pathname === "/status") {
      const row = await env.DB.prepare(
        "SELECT COUNT(*) as total, MAX(draw_date) as latest FROM draws",
      ).first<{ total: number; latest: string }>();
      return json({ ok: true, ...row });
    }

    // Leave-one-out backtest — batch
    // Safe to re-run: skips draws already scored unless ?force=1
    if (req.method === "POST" && url.pathname === "/backtest") {
      const from = url.searchParams.get("from") ?? undefined;
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 100)));
      const force = url.searchParams.get("force") === "1";
      const result = await backtestRange(env.DB, { from, limit, skipExisting: !force });
      return json({ ok: true, ...result });
    }

    // Backtest for a single draw — primarily for post-scrape hook but exposed for debugging
    if (req.method === "POST" && url.pathname === "/backtest/draw") {
      const date = url.searchParams.get("date");
      if (!date) return json({ error: "missing ?date=YYYY-MM-DD" }, 400);
      const inserted = await backtestDraw(env.DB, date);
      return json({ ok: true, date, inserted });
    }

    // Hyperparameter tuner — grid-search per prize type, write best to model_params.
    // ?prize=last_two&eval=30  → tune one prize (fits ~10s)
    // ?eval=30                 → tune all prizes (may take ~30-40s; tight)
    // The workflow loops per-prize for safety.
    if (req.method === "POST" && url.pathname === "/tune") {
      const prize = url.searchParams.get("prize") as PrizeType | null;
      const evalDraws = Math.min(60, Math.max(10, Number(url.searchParams.get("eval") ?? 30)));
      if (prize) {
        const result = await tunePrize(env.DB, prize, evalDraws);
        return json({ ok: true, prize, result });
      }
      const results = await tuneAll(env.DB, evalDraws);
      return json({ ok: true, results });
    }

    return json({ error: "not found" }, 404);
  },
};

// ───────────────────────── scheduled ─────────────────────────
async function runScheduled(env: Env): Promise<void> {
  try {
    // ดึง 2 งวดล่าสุดเพื่อความแน่ใจ (เผื่องวดก่อนหน้ายังขาด)
    const urls = await listSanookArchiveUrls(env.SOURCE_BASE, env.USER_AGENT, 2);
    let added = 0;
    const touchedDates: string[] = [];
    for (const u of urls) {
      const html = await fetchHtml(u, env.USER_AGENT);
      const parsed = parseSanookDrawPage(html, u);
      if (parsed) {
        const n = await upsertDraw(env.DB, parsed);
        added += n;
        if (n > 0) touchedDates.push(parsed.drawDate);
      }
    }
    await logScrape(env.DB, "scheduled", "ok", added, null);

    // Post-scrape: backtest any genuinely-new draws so /accuracy stays fresh
    for (const date of touchedDates) {
      try {
        await backtestDraw(env.DB, date);
      } catch (e) {
        await logScrape(env.DB, "backtest", "error", 0, `${date}: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    await logScrape(env.DB, "scheduled", "error", 0, (e as Error).message);
  }
}

// ───────────────────────── backfill ──────────────────────────
async function runBackfill(env: Env, years: number, force = false): Promise<number> {
  // งวดที่ 1 และ 16 ของแต่ละเดือน ย้อนหลัง N ปี = ประมาณ N*24 งวด
  const dates = enumerateDrawDates(years);
  let added = 0;
  let errors = 0;
  let consecutiveErrors = 0;
  let nullParses = 0;

  for (const date of dates) {
    try {
      const { added: n } = await fetchAndStoreByDate(env, date, force);
      added += n;
      if (n === 0) nullParses += 1;
      consecutiveErrors = 0;
      // throttle: ให้เกียรติ host เป็นคนดี
      await sleep(800 + Math.random() * 400);
    } catch (e) {
      errors += 1;
      consecutiveErrors += 1;
      await logScrape(env.DB, "backfill", "error", 0, `${date}: ${(e as Error).message}`);
      // safety: ถ้าเจอ error ติด ๆ กันเยอะ ๆ อาจโดน block — หยุด
      if (consecutiveErrors > 30) break;
    }
  }
  await logScrape(
    env.DB,
    "backfill",
    "ok",
    added,
    `years=${years} tried=${dates.length} added=${added} nullParses=${nullParses} errors=${errors}`,
  );
  return added;
}

// ───────────────────────── debug ─────────────────────────────
// คืน snippet รอบ ๆ คำว่า "งวด" ทุกตำแหน่งในหน้าผลสลาก (ทั้งก่อน/หลัง normalize)
// ใช้ดูว่าข้อความ heading จริงบนหน้า sanook เขียนอย่างไร เพื่อปรับ anchor ใน parser
async function fetchForDebug(env: Env, isoDate: string): Promise<unknown> {
  const sanookPath = isoToSanookPath(isoDate);
  const url = `${env.SOURCE_BASE}/check/${sanookPath}/`;
  const html = await fetchHtml(url, env.USER_AGENT);

  // normalize แบบเดียวกับ parser (strip script/style/tags, decode entities)
  const normalized = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ");

  const headings: string[] = [];
  const re = /งวด[^\n<]{0,80}/g;
  for (const m of normalized.matchAll(re)) {
    headings.push(m[0].trim().slice(0, 120));
    if (headings.length >= 15) break;
  }

  const titleMatch = html.match(/<title[^>]*>([^<]{0,200})<\/title>/i);

  return {
    ok: true,
    url,
    httpBytes: html.length,
    title: titleMatch?.[1]?.trim().slice(0, 200) ?? null,
    headings,
    // ส่ง normalize ส่วนต้น ๆ กลับมาดูก็ได้ ตัดให้พอสำหรับตรวจ
    normalizedHead: normalized.slice(0, 1500),
  };
}

// ───────────────────────── fetch by date ─────────────────────
interface FetchResult {
  added: number;
  parsed: string[];
  url: string;
  /** Diagnostic: only set when parser returned null. Helps pinpoint whether
   *  sanook served an unrecognised page format vs. a redirect/error stub. */
  debug?: { httpBytes: number; titleSnippet: string };
}

async function fetchAndStoreByDate(
  env: Env,
  isoDate: string,
  force = false,
): Promise<FetchResult> {
  // URL format: /lotto/check/DDMMYYYY/  where YYYY = พ.ศ. (Buddhist year, +543)
  const sanookPath = isoToSanookPath(isoDate);
  const url = `${env.SOURCE_BASE}/check/${sanookPath}/`;
  const html = await fetchHtml(url, env.USER_AGENT);
  const parsed = parseSanookDrawPage(html, url);
  if (!parsed) {
    const titleMatch = html.match(/<title[^>]*>([^<]{0,200})<\/title>/i);
    return {
      added: 0,
      parsed: [],
      url,
      debug: {
        httpBytes: html.length,
        titleSnippet: (titleMatch?.[1] ?? "(no <title>)").trim().slice(0, 200),
      },
    };
  }
  const added = await upsertDraw(env.DB, parsed, force);
  return {
    added,
    parsed: parsed.numbers.map((n) => `${n.prizeType}[${n.position}]=${n.number}`),
    url,
  };
}

// ───────────────────────── storage ───────────────────────────
async function upsertDraw(db: D1Database, p: ParsedDraw, force = false): Promise<number> {
  const existing = await db
    .prepare("SELECT id FROM draws WHERE draw_date = ?")
    .bind(p.drawDate)
    .first<{ id: number }>();

  let drawId: number;
  let isNew = false;
  if (existing) {
    drawId = existing.id;
  } else {
    const res = await db
      .prepare(
        "INSERT INTO draws (draw_date, draw_date_th, source, source_url) VALUES (?, ?, 'sanook', ?)",
      )
      .bind(p.drawDate, p.drawDateTh, p.sourceUrl)
      .run();
    const id = res.meta.last_row_id;
    if (!id) return 0;
    drawId = Number(id);
    isNew = true;
  }

  // เขียนตัวเลขเสมอ — INSERT OR IGNORE จะข้ามเฉพาะ (draw_id, prize_type, position) ที่ซ้ำ
  // ทำให้การ re-scrape หลังแก้ parser เติมเลขที่ขาดได้
  // force=true → ลบหมายเลขเดิมทั้งหมดของงวดนี้ก่อน เพื่อให้เขียนทับเลขเก่าที่ผิด
  if (force) {
    await db.prepare("DELETE FROM numbers WHERE draw_id = ?").bind(drawId).run();
  }
  const stmts: D1PreparedStatement[] = [];
  for (const n of p.numbers) {
    stmts.push(
      db
        .prepare(
          "INSERT OR IGNORE INTO numbers (draw_id, prize_type, number, position) VALUES (?, ?, ?, ?)",
        )
        .bind(drawId, n.prizeType, n.number, n.position),
    );
  }
  if (stmts.length) await db.batch(stmts);
  await db.prepare("DELETE FROM stats_cache").run();
  return isNew ? 1 : 0;
}

async function logScrape(
  db: D1Database,
  source: string,
  status: string,
  added: number,
  msg: string | null,
): Promise<void> {
  await db
    .prepare("INSERT INTO scrape_log (source, status, draws_added, message) VALUES (?, ?, ?, ?)")
    .bind(source, status, added, msg)
    .run();
}

// ───────────────────────── helpers ───────────────────────────
async function fetchHtml(url: string, ua: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": ua,
      "Accept-Language": "th-TH,th;q=0.9",
      Accept: "text/html",
    },
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  return await res.text();
}

function enumerateDrawDates(years: number): string[] {
  const dates: string[] = [];
  const today = new Date();
  // เริ่มจากงวดล่าสุดถอยหลัง
  for (let y = 0; y <= years; y++) {
    const year = today.getUTCFullYear() - y;
    for (let m = 12; m >= 1; m--) {
      for (const d of [16, 1]) {
        const iso = `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const dt = new Date(iso + "T00:00:00Z");
        if (dt > today) continue;
        dates.push(iso);
      }
    }
  }
  return dates;
}

function isoToSanookPath(iso: string): string {
  // YYYY-MM-DD (AD) → DDMM(YYYY+543)
  const [y, m, d] = iso.split("-").map(Number);
  const beYear = y + 543;
  return `${String(d).padStart(2, "0")}${String(m).padStart(2, "0")}${beYear}`;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
