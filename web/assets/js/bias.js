import { api } from "./api.js";

const tabs = document.querySelectorAll('[data-el="prize-tabs"] .segment-item');
const gridEl = document.querySelector('[data-el="bias-grid"]');
const coverageEl = document.querySelector('[data-el="coverage"]');

let prize = new URLSearchParams(location.search).get("prize") || "last_two";

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

async function load() {
  gridEl.innerHTML = '<div class="model-card"><p class="rank-score">กำลังโหลด...</p></div>';
  try {
    const res = await api.bias(prize);
    coverageEl.textContent = res.totalSamples > 0
      ? `วิเคราะห์ ${res.totalSamples.toLocaleString("th-TH")} งวด · ${res.digits} หลัก · เกณฑ์ Bonferroni p<${res.bonferroniAlpha.toFixed(4)}`
      : "ยังไม่มีข้อมูล";

    if (!res.positions?.length) {
      gridEl.innerHTML = `<div class="model-card"><p class="rank-score">ยังไม่มีข้อมูลพอที่จะทดสอบ</p></div>`;
      return;
    }

    gridEl.innerHTML = "";
    const wrapper = document.createElement("div");
    wrapper.className = "model-grid";
    res.positions.forEach((p) => wrapper.appendChild(renderPosition(p, res.bonferroniAlpha)));
    gridEl.appendChild(wrapper);
  } catch (e) {
    console.error(e);
    gridEl.innerHTML = '<div class="model-card"><p class="rank-score">โหลดไม่สำเร็จ</p></div>';
  }
}

function renderPosition(p, bonferroniAlpha) {
  const card = document.createElement("div");
  card.className = "model-card";
  const verdict = verdictFor(p.pValue, bonferroniAlpha);
  card.innerHTML = `
    <h3>หลักที่ ${p.position + 1}</h3>
    <dl class="stat-pair-grid">
      <div><dt>จำนวนตัวอย่าง</dt><dd>${p.n.toLocaleString("th-TH")}</dd></div>
      <div><dt>คาดหวังต่อเลข</dt><dd>${p.expectedPerDigit.toFixed(1)}</dd></div>
      <div><dt>chi-square (df=9)</dt><dd class="accuracy-big">${p.chiSquare.toFixed(2)}</dd></div>
      <div><dt>ค่า p</dt><dd>${formatP(p.pValue)}</dd></div>
    </dl>
    <p class="accuracy-verdict accuracy-verdict--${verdict.tone}">${verdict.text}</p>
    ${renderDigitBars(p.digitCounts, p.expectedPerDigit)}
  `;
  return card;
}

function verdictFor(pValue, bonferroniAlpha) {
  if (pValue < bonferroniAlpha) {
    return { tone: "good", text: `มีหลักฐานเอนเอียง (p<${bonferroniAlpha.toFixed(4)} แม้ปรับ Bonferroni)` };
  }
  if (pValue < 0.05) {
    return { tone: "ok", text: `เอนเอียงเล็กน้อย (p=${pValue.toFixed(3)}) — อาจเป็นการสุ่มล้วน` };
  }
  return { tone: "neutral", text: `เที่ยงตรงตามสถิติ (p=${pValue.toFixed(3)})` };
}

function formatP(p) {
  if (p < 0.0001) return "< 0.0001";
  if (p < 0.001) return p.toExponential(2);
  return p.toFixed(3);
}

// Mini bar chart — each digit 0..9 as a vertical bar, height ∝ count
// dashed line at expected count = baseline reference
function renderDigitBars(counts, expected) {
  const w = 220, h = 80, pad = 14;
  const max = Math.max(expected * 1.4, ...counts);
  const barW = (w - pad * 2) / 10;
  const baseY = h - pad;
  const scale = (v) => (v / max) * (h - pad * 2);
  const bars = counts.map((c, d) => {
    const x = pad + d * barW;
    const bh = scale(c);
    const y = baseY - bh;
    // Highlight bars that deviate >2σ from expected (rough heuristic)
    const dev = Math.abs(c - expected) / Math.sqrt(expected || 1);
    const cls = dev > 2 ? "spark-bar spark-bar--hot" : "spark-bar";
    return `<rect class="${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(barW - 1).toFixed(1)}" height="${bh.toFixed(1)}"/>
            <text class="spark-label" x="${(x + barW / 2).toFixed(1)}" y="${(h - 2).toFixed(1)}" text-anchor="middle">${d}</text>`;
  }).join("");
  const expectY = baseY - scale(expected);
  return `
    <svg class="accuracy-spark bias-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <line x1="${pad}" x2="${w - pad}" y1="${expectY.toFixed(1)}" y2="${expectY.toFixed(1)}" class="spark-baseline"/>
      ${bars}
    </svg>
    <p class="rank-reason">ความถี่ของเลข 0–9 ในหลักนี้ (เส้นประ = ค่าคาดหวังหากสุ่มเที่ยงตรง)</p>
  `;
}

load();
