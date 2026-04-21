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
      const added = await runBackfill(env, years);
      return json({ ok: true, added });
    }

    if (req.method === "POST" && url.pathname === "/fetch") {
      const date = url.searchParams.get("date");
      if (!date) return json({ error: "missing ?date=YYYY-MM-DD" }, 400);
      const added = await fetchAndStoreByDate(env, date);
      return json({ ok: true, added });
    }

    if (req.method === "GET" && url.pathname === "/status") {
      const row = await env.DB.prepare(
        "SELECT COUNT(*) as total, MAX(draw_date) as latest FROM draws",
      ).first<{ total: number; latest: string }>();
      return json({ ok: true, ...row });
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
    for (const u of urls) {
      const html = await fetchHtml(u, env.USER_AGENT);
      const parsed = parseSanookDrawPage(html, u);
      if (parsed) {
        const n = await upsertDraw(env.DB, parsed);
        added += n;
      }
    }
    await logScrape(env.DB, "scheduled", "ok", added, null);
  } catch (e) {
    await logScrape(env.DB, "scheduled", "error", 0, (e as Error).message);
  }
}

// ───────────────────────── backfill ──────────────────────────
async function runBackfill(env: Env, years: number): Promise<number> {
  // งวดที่ 1 และ 16 ของแต่ละเดือน ย้อนหลัง N ปี = ประมาณ N*24 งวด
  const dates = enumerateDrawDates(years);
  let added = 0;
  let errors = 0;

  for (const date of dates) {
    try {
      const n = await fetchAndStoreByDate(env, date);
      added += n;
      // throttle: ให้เกียรติ host เป็นคนดี
      await sleep(800 + Math.random() * 400);
    } catch (e) {
      errors += 1;
      // เงียบ ๆ ต่อไป เก็บ log ไว้
      await logScrape(env.DB, "backfill", "error", 0, `${date}: ${(e as Error).message}`);
      if (errors > 20) break; // safety
    }
  }
  await logScrape(env.DB, "backfill", "ok", added, `years=${years} errors=${errors}`);
  return added;
}

// ───────────────────────── fetch by date ─────────────────────
async function fetchAndStoreByDate(env: Env, isoDate: string): Promise<number> {
  // URL format: /lotto/check/DDMMYYYY/  where YYYY = พ.ศ. (Buddhist year, +543)
  const sanookPath = isoToSanookPath(isoDate);
  const url = `${env.SOURCE_BASE}/check/${sanookPath}/`;
  const html = await fetchHtml(url, env.USER_AGENT);
  const parsed = parseSanookDrawPage(html, url);
  if (!parsed) return 0;
  return upsertDraw(env.DB, parsed);
}

// ───────────────────────── storage ───────────────────────────
async function upsertDraw(db: D1Database, p: ParsedDraw): Promise<number> {
  // skip หากมีอยู่แล้ว
  const existing = await db
    .prepare("SELECT id FROM draws WHERE draw_date = ?")
    .bind(p.drawDate)
    .first<{ id: number }>();
  if (existing) return 0;

  const res = await db
    .prepare(
      "INSERT INTO draws (draw_date, draw_date_th, source, source_url) VALUES (?, ?, 'sanook', ?)",
    )
    .bind(p.drawDate, p.drawDateTh, p.sourceUrl)
    .run();

  const drawId = res.meta.last_row_id;
  if (!drawId) return 0;

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
  // เคลียร์แคชสถิติ
  await db.prepare("DELETE FROM stats_cache").run();
  return 1;
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
