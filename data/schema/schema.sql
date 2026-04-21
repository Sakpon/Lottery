-- ───────────────────────────────────────────────────────────────────────────
-- Thailand Lottery Platform — Cloudflare D1 Schema
-- ───────────────────────────────────────────────────────────────────────────
-- งวดการออกรางวัล (หนึ่งแถวต่อการออกรางวัลหนึ่งงวด)
CREATE TABLE IF NOT EXISTS draws (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  draw_date       TEXT    NOT NULL UNIQUE,           -- ISO 8601 YYYY-MM-DD
  draw_date_th    TEXT    NOT NULL,                  -- "1 เมษายน 2569" (พ.ศ.)
  source          TEXT    NOT NULL DEFAULT 'sanook', -- แหล่งข้อมูล
  source_url      TEXT,
  scraped_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  verified        INTEGER NOT NULL DEFAULT 0         -- 1 = ตรวจสอบกับ glo แล้ว
);

CREATE INDEX IF NOT EXISTS idx_draws_date ON draws(draw_date DESC);

-- หมายเลขรางวัลที่ออกในแต่ละงวด
-- prize_type:
--   first          = รางวัลที่ 1 (6 หลัก, หนึ่งเลข)
--   first_near     = รางวัลข้างเคียงรางวัลที่ 1 (6 หลัก, สองเลข)
--   front_three    = เลขหน้า 3 ตัว (3 หลัก, สองเลข)
--   last_three     = เลขท้าย 3 ตัว (3 หลัก, สองเลข)
--   last_two       = เลขท้าย 2 ตัว (2 หลัก, หนึ่งเลข)
CREATE TABLE IF NOT EXISTS numbers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  draw_id     INTEGER NOT NULL REFERENCES draws(id) ON DELETE CASCADE,
  prize_type  TEXT    NOT NULL,
  number      TEXT    NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,  -- 0, 1 สำหรับรางวัลที่มีหลายเลข
  UNIQUE(draw_id, prize_type, position)
);

CREATE INDEX IF NOT EXISTS idx_numbers_type_number ON numbers(prize_type, number);
CREATE INDEX IF NOT EXISTS idx_numbers_draw        ON numbers(draw_id);

-- แคชสถิติ (รีเฟรชทุกครั้งที่มีข้อมูลงวดใหม่)
CREATE TABLE IF NOT EXISTS stats_cache (
  key         TEXT    PRIMARY KEY,
  value_json  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- การทำนายที่บันทึกไว้ (เก็บย้อนหลังเพื่อประเมินความแม่น)
CREATE TABLE IF NOT EXISTS predictions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  target_date  TEXT    NOT NULL,              -- วันที่ทำนายสำหรับ
  model        TEXT    NOT NULL,              -- 'frequency' | 'gap' | 'markov' | 'ensemble'
  prize_type   TEXT    NOT NULL,
  number       TEXT    NOT NULL,
  score        REAL    NOT NULL,              -- 0..1 confidence
  rank         INTEGER NOT NULL,              -- 1..N ลำดับความน่าจะออก
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(target_date, model, prize_type, number)
);

CREATE INDEX IF NOT EXISTS idx_predictions_target ON predictions(target_date, prize_type, model);

-- log การ scrape แต่ละครั้ง (debug / monitoring)
CREATE TABLE IF NOT EXISTS scrape_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  source      TEXT    NOT NULL,
  status      TEXT    NOT NULL,               -- 'ok' | 'error' | 'skip'
  draws_added INTEGER NOT NULL DEFAULT 0,
  message     TEXT
);
