/**
 * API client — รองรับทั้ง production (ตั้ง window.__API_BASE__)
 * และ local dev (fallback ไป /api)
 */

const BASE =
  (typeof window !== "undefined" && window.__API_BASE__) ||
  "/api";

async function request(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

export const api = {
  meta: () => request("/meta"),
  latest: () => request("/draws/latest"),
  list: (limit = 20, offset = 0) => request(`/draws?limit=${limit}&offset=${offset}`),
  draw: (isoDate) => request(`/draws/${isoDate}`),
  stats: (prizeType, windowSize = 60) => request(`/stats/${prizeType}?window=${windowSize}`),
  predict: (prizeType, topK = 10) => request(`/predict/${prizeType}?topK=${topK}`),
};

export function formatThaiDate(iso) {
  if (!iso) return "—";
  const months = [
    "มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
    "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม",
  ];
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${months[m - 1]} ${y + 543}`;
}

export function formatCountdown(targetIso) {
  const now = new Date();
  const target = new Date(targetIso + "T14:00:00+07:00"); // ออก 14:00 เวลาไทย
  const diff = target - now;
  if (diff <= 0) return "กำลังออก...";
  const days = Math.floor(diff / 86400_000);
  const hours = Math.floor((diff % 86400_000) / 3600_000);
  const mins = Math.floor((diff % 3600_000) / 60_000);
  if (days > 0) return `เหลือ ${days} วัน ${hours} ชม.`;
  if (hours > 0) return `เหลือ ${hours} ชม. ${mins} นาที`;
  return `เหลือ ${mins} นาที`;
}

export const PRIZE_LABELS = {
  first: "รางวัลที่ 1",
  first_near: "รางวัลข้างเคียงที่ 1",
  front_three: "เลขหน้า 3 ตัว",
  last_three: "เลขท้าย 3 ตัว",
  last_two: "เลขท้าย 2 ตัว",
};
