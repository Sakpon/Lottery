-- ข้อมูลตัวอย่าง (สำหรับการทดสอบท้องถิ่นก่อน backfill จริง)
-- หมายเหตุ: หมายเลขด้านล่างเป็นตัวอย่าง ไม่ใช่ผลออกรางวัลจริง
INSERT OR IGNORE INTO draws (draw_date, draw_date_th, source_url) VALUES
  ('2026-04-16', '16 เมษายน 2569', 'https://news.sanook.com/lotto/check/16042569/'),
  ('2026-04-01', '1 เมษายน 2569',  'https://news.sanook.com/lotto/check/01042569/'),
  ('2026-03-16', '16 มีนาคม 2569', 'https://news.sanook.com/lotto/check/16032569/');
