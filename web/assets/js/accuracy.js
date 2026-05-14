import { api } from "./api.js";

const tabs = document.querySelectorAll('[data-el="prize-tabs"] .segment-item');
const listEl = document.querySelector('[data-el="accuracy-list"]');
const coverageEl = document.querySelector('[data-el="coverage"]');
const daysSel = document.getElementById("days-filter");

let prize = new URLSearchParams(location.search).get("prize") || "last_two";
let days = Number(daysSel.value);

function activateTab(t) {
  tabs.forEach((x) => x.classList.remove("active"));
  t.classList.add("active");
  t.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
}

tabs.forEach((t) => {
  if (t.dataset.prize === prize) activateTab(t);
  t.addEventListener("click", () => {
    activateTab(t);
    prize = t.dataset.prize;
    load();
  });
});

daysSel.addEventListener("change", () => {
  days = Number(daysSel.value);
  load();
});

const MODEL_LABELS = {
  ensemble: "รวมโมเดล",
  frequency: "ความถี่",
  gap: "ค้างนาน",
  markov: "มาร์คอฟ",
  digit_position: "ตามตำแหน่งหลัก",
};

async function load() {
  listEl.innerHTML = '<div class="model-card"><p class="rank-score">กำลังโหลด...</p></div>';
  try {
    const res = await api.accuracy(prize, days);
    coverageEl.textContent = res.totalDraws > 0
      ? `ทดสอบย้อนหลัง ${res.totalDraws} งวด · ครอบคลุม ${res.space.toLocaleString("th-TH")} เลข`
      : "ยังไม่มีข้อมูลการทดสอบ";

    if (!res.models?.length) {
      listEl.innerHTML = `
        <div class="model-card">
          <h3>ยังไม่มีข้อมูล</h3>
          <p class="rank-score">ยังไม่ได้ทดสอบย้อนหลังในช่วงเวลานี้ — ลองเพิ่มช่วงเวลาหรือรอให้งวดใหม่ลงทะเบียน</p>
        </div>`;
      return;
    }

    listEl.innerHTML = "";
    res.models.forEach((m) => listEl.appendChild(renderModelCard(m)));
  } catch (e) {
    console.error(e);
    listEl.innerHTML = '<div class="model-card"><p class="rank-score">โหลดไม่สำเร็จ</p></div>';
  }
}

function renderModelCard(m) {
  const card = document.createElement("div");
  card.className = "model-card accuracy-card";
  const hitPct = (m.hitRate * 100).toFixed(1);
  const basePct = (m.baseline * 100).toFixed(m.baseline < 0.01 ? 4 : 1);
  const lift = m.baseline > 0 ? ((m.hitRate - m.baseline) / m.baseline) * 100 : 0;
  const verdict = verdictFor(m.pValue, m.hits, m.total);
  const meanRank = m.meanRank != null ? m.meanRank.toFixed(1) : "—";

  card.innerHTML = `
    <h3>${MODEL_LABELS[m.model] ?? m.model}</h3>
    <dl class="stat-pair-grid">
      <div><dt>อัตราติด</dt><dd class="accuracy-big">${hitPct}%</dd></div>
      <div><dt>อัตราสุ่ม</dt><dd>${basePct}%</dd></div>
      <div><dt>ตรง / ทั้งหมด</dt><dd>${m.hits} / ${m.total}</dd></div>
      <div><dt>อันดับเฉลี่ย</dt><dd>${meanRank}</dd></div>
      <div><dt>ดีกว่าการสุ่ม</dt><dd>${lift >= 0 ? "+" : ""}${lift.toFixed(0)}%</dd></div>
      <div><dt>ค่า p</dt><dd>${m.pValue < 0.0001 ? "< 0.0001" : m.pValue.toFixed(3)}</dd></div>
    </dl>
    <p class="accuracy-verdict accuracy-verdict--${verdict.tone}">${verdict.text}</p>
    ${renderSparkline(m.series, m.baseline)}
  `;
  return card;
}

function verdictFor(p, hits, total) {
  if (total < 20) return { tone: "neutral", text: "ข้อมูลยังน้อยเกินไปที่จะบอกได้" };
  if (p < 0.01) return { tone: "good", text: `ชนะการสุ่มอย่างมีนัยสำคัญ (p=${p.toFixed(3)})` };
  if (p < 0.05) return { tone: "ok", text: `ชนะการสุ่มเล็กน้อย (p=${p.toFixed(3)})` };
  if (hits === 0) return { tone: "neutral", text: "ไม่เคยเดาถูกในช่วงนี้" };
  return { tone: "neutral", text: "แยกจากการสุ่มไม่ออก" };
}

function renderSparkline(series, baseline) {
  if (!series || series.length < 2) return "";
  // Rolling hit rate over last 20 draws
  const win = 20;
  const rolling = [];
  let sum = 0;
  for (let i = 0; i < series.length; i++) {
    sum += series[i].hit;
    if (i >= win) sum -= series[i - win].hit;
    if (i >= win - 1) rolling.push(sum / Math.min(win, i + 1));
  }
  if (!rolling.length) return "";
  const w = 240, h = 40;
  const max = Math.max(baseline, ...rolling, 0.05);
  const scale = (v) => h - (v / max) * h;
  const step = w / Math.max(1, rolling.length - 1);
  const path = rolling.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${scale(v).toFixed(1)}`).join(" ");
  const baseY = scale(baseline).toFixed(1);
  return `
    <svg class="accuracy-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" x2="${w}" y1="${baseY}" y2="${baseY}" class="spark-baseline"/>
      <path d="${path}" class="spark-line"/>
    </svg>
    <p class="rank-reason">อัตราชนะเลื่อน (20 งวด) เทียบกับการสุ่ม</p>
  `;
}

load();
