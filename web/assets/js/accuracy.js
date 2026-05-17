import { api } from "./api.js";

const tabs = document.querySelectorAll('[data-el="prize-tabs"] .segment-item');
const listEl = document.querySelector('[data-el="accuracy-list"]');
const coverageEl = document.querySelector('[data-el="coverage"]');
const summaryEl = document.querySelector('[data-el="signal-summary"]');
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
  ensemble: "รวม (Ensemble)",
  frequency: "ความถี่ (Frequency)",
  gap: "ค้างนาน (Gap)",
  markov: "Markov",
  digit_position: "ตามตำแหน่งหลัก",
};

async function load() {
  listEl.innerHTML = '<div class="model-card"><p class="rank-score">กำลังโหลด...</p></div>';
  try {
    const res = await api.accuracy(prize, days);
    coverageEl.textContent = res.totalDraws > 0
      ? `backtest ${res.totalDraws} งวด · space=${res.space.toLocaleString("th-TH")}`
      : "ยังไม่มีข้อมูล backtest";

    if (!res.models?.length) {
      listEl.innerHTML = `
        <div class="model-card">
          <h3>ยังไม่มีข้อมูล</h3>
          <p class="rank-score">ยังไม่ได้รัน backtest สำหรับช่วงเวลานี้ — ลองเพิ่มช่วงเวลาหรือรอให้งวดใหม่ลงทะเบียน</p>
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
  // p-value and lift become noisy below ~20 samples — show "—" instead of a
  // misleading number so the user doesn't read a "win" or "loss" into noise
  const lowN = m.total < 20;
  const liftStr = lowN ? "—" : `${lift >= 0 ? "+" : ""}${lift.toFixed(0)}%`;
  const pStr = lowN ? "—" : (m.pValue < 0.0001 ? "< 0.0001" : m.pValue.toFixed(3));

  card.innerHTML = `
    <h3>${MODEL_LABELS[m.model] ?? m.model}</h3>
    <dl class="stat-pair-grid">
      <div><dt>hit rate</dt><dd class="accuracy-big">${hitPct}%</dd></div>
      <div><dt>baseline (สุ่ม)</dt><dd>${basePct}%</dd></div>
      <div><dt>ตรง / ทั้งหมด</dt><dd>${m.hits} / ${m.total}</dd></div>
      <div><dt>อันดับเฉลี่ย</dt><dd>${meanRank}</dd></div>
      <div><dt>lift vs baseline</dt><dd>${liftStr}</dd></div>
      <div><dt>p-value</dt><dd>${pStr}</dd></div>
    </dl>
    <p class="accuracy-verdict accuracy-verdict--${verdict.tone}">${verdict.text}</p>
    ${renderSparkline(m.series, m.baseline)}
  `;
  return card;
}

function verdictFor(p, hits, total) {
  // Low-N: don't hide the hit rate (the card already shows it). Just label
  // confidence honestly. p-value is meaningless below ~20 samples.
  if (total < 5) {
    return { tone: "neutral", text: `ตัวอย่างน้อยมาก (${total} งวด) — ยังประเมินไม่ได้ ลองเพิ่มช่วงเวลาหรือรัน workflow "Backtest backfill"` };
  }
  if (total < 20) {
    return { tone: "neutral", text: `ตัวอย่างยังน้อย (${total} งวด) — ค่ายังไม่นิ่ง ต้องการอย่างน้อย 20 งวดเพื่อทดสอบนัยสำคัญ` };
  }
  if (p < 0.01) return { tone: "good", text: `ชนะ baseline อย่างมีนัยสำคัญ (p=${p.toFixed(3)})` };
  if (p < 0.05) return { tone: "ok", text: `ชนะ baseline พอประมาณ (p=${p.toFixed(3)})` };
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
    <p class="rank-reason">อัตราชนะเลื่อน (20 งวด) เทียบ baseline</p>
  `;
}

const PRIZE_NAMES = {
  last_two: "เลขท้าย 2 ตัว",
  last_three: "เลขท้าย 3 ตัว",
  front_three: "เลขหน้า 3 ตัว",
  first: "รางวัลที่ 1",
  first_near: "ข้างเคียงที่ 1",
};

async function loadSummary() {
  if (!summaryEl) return;
  try {
    const res = await api.accuracySummary();
    summaryEl.innerHTML = renderSummary(res);
  } catch (e) {
    console.error(e);
    summaryEl.innerHTML = '<div class="model-card"><p class="rank-score">โหลดผลรวมไม่สำเร็จ</p></div>';
  }
}

function renderSummary(res) {
  const overall = res.overall === "signal_found"
    ? { tone: "good", text: "พบสัญญาณ — มีรางวัลที่โมเดลชนะการสุ่มอย่างมีนัยสำคัญ" }
    : { tone: "neutral", text: "ไม่พบสัญญาณ — ทุกโมเดลให้ผลใกล้เคียงการสุ่ม (ตามที่คาดสำหรับลอตเตอรี่ที่เป็นธรรม)" };

  const rows = (res.prizes ?? [])
    .map((p) => {
      const name = PRIZE_NAMES[p.prizeType] ?? p.prizeType;
      if (!p.hasData) {
        return `<tr><th>${name}</th><td colspan="3">ยังไม่มีข้อมูล</td></tr>`;
      }
      const hitPct = (p.bestHitRate * 100).toFixed(p.baseline < 0.01 ? 4 : 2);
      const basePct = (p.baseline * 100).toFixed(p.baseline < 0.01 ? 4 : 2);
      const pStr = p.bestPValue < 0.0001 ? "< 0.0001" : p.bestPValue.toFixed(3);
      const verdict = {
        strong_signal:   { tone: "good", label: "พบสัญญาณชัดเจน" },
        weak_signal:     { tone: "ok", label: "อาจมีสัญญาณ" },
        no_signal:       { tone: "neutral", label: "ไม่พบ" },
        below_baseline:  { tone: "neutral", label: "ต่ำกว่าสุ่ม" },
      }[p.verdict] ?? { tone: "neutral", label: "—" };
      return `
        <tr>
          <th>${name}</th>
          <td><span class="accuracy-verdict accuracy-verdict--${verdict.tone}">${verdict.label}</span></td>
          <td>${hitPct}% / ${basePct}%</td>
          <td>${pStr}</td>
        </tr>`;
    })
    .join("");

  return `
    <div class="model-card">
      <h3>สรุปผล (สัญญาณ vs สุ่ม)</h3>
      <p class="accuracy-verdict accuracy-verdict--${overall.tone}">${overall.text}</p>
      <table class="signal-table">
        <thead>
          <tr><th>รางวัล</th><th>ผลทดสอบ</th><th>โมเดลที่ดีสุด / สุ่ม</th><th>ค่า p</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="rank-reason">${res.disclaimer}</p>
    </div>
  `;
}

loadSummary();
load();
