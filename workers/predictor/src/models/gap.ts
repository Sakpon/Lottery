import type { HistoricalNumber, Prediction } from "../types";

/**
 * โมเดล Gap Analysis — หาเลขที่ "ค้างนาน" (ไม่ออกมาหลายงวด)
 * แนวคิด: หากเลขไม่ออกมา > ค่าเฉลี่ย gap ของมัน → โอกาสจะออกเพิ่มขึ้น (gambler's view)
 * หมายเหตุ: ในความเป็นจริง การสุ่มไม่มีหน่วยความจำ แต่เราจัดให้เป็นอีกมุมมอง
 *
 * ขอบเขต: ทำงานเฉพาะกับเลขที่ "เคยปรากฏใน history" เพราะ gap signal สมเหตุสมผล
 * ก็ต่อเมื่อเรามีจุดเริ่มนับ — ถ้าเลขไม่เคยออกเลย เราไม่มีข้อมูลพอจะบอกว่าจะออกเมื่อไร
 * (เคสที่ history เล็กมาก เลขส่วนใหญ่จะตกในประเภทนี้และเคยถูกตีรวมเป็น gap=∞ เท่ากันหมด
 *  ทำให้ output ของ model เป็นแค่ noise)
 */
export function gapModel(
  history: HistoricalNumber[],
  opts: { topK?: number } = {},
): Prediction[] {
  const topK = opts.topK ?? 10;

  const sorted = [...history].sort((a, b) => (a.drawDate < b.drawDate ? 1 : -1));
  if (sorted.length === 0) return [];

  // ดึงเลขที่ "เคยปรากฏ" พร้อม index ของการเห็นล่าสุด (0 = งวดล่าสุด)
  const lastSeenIdx = new Map<string, number>();
  sorted.forEach((n, i) => {
    if (!lastSeenIdx.has(n.number)) lastSeenIdx.set(n.number, i);
  });
  if (lastSeenIdx.size === 0) return [];

  const scored = Array.from(lastSeenIdx.entries()).map(([number, gap]) => ({
    number,
    gap,
  }));

  scored.sort((a, b) => b.gap - a.gap);
  const top = scored.slice(0, topK);
  const maxGap = top[0]?.gap || 1;

  return top.map((t, i) => ({
    number: t.number,
    score: Math.min(1, t.gap / maxGap),
    rank: i + 1,
    model: "gap",
    reason: `ไม่ออก ${t.gap} งวด`,
  }));
}
