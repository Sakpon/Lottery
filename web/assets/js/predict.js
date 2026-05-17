import { api, formatThaiDate, PRIZE_LABELS } from "./api.js";

const tabs = document.querySelectorAll('[data-el="prize-tabs"] .segment-item');
const modelTabs = document.querySelectorAll('[data-el="model-tabs"] .segment-item');
const ensembleList = document.querySelector('[data-el="ensemble-list"]');
const breakdownEl = document.querySelector('[data-el="model-breakdown"]');
const targetEl = document.querySelector('[data-el="target-date"]');
const tuningEl = document.querySelector('[data-el="tuning-info"]');
const titleEl = document.querySelector('[data-el="ranked-title"]');

const params = new URLSearchParams(location.search);
let prize = params.get("prize") || "last_two";
let selectedModel = params.get("model") || "ensemble";

// Cache the last API response so switching models doesn't re-fetch
let lastRes = null;

function activateInGroup(group, t) {
  group.forEach((x) => x.classList.remove("active"));
  t.classList.add("active");
  t.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
}

tabs.forEach((t) => {
  if (t.dataset.prize === prize) activateInGroup(tabs, t);
  t.addEventListener("click", () => {
    activateInGroup(tabs, t);
    prize = t.dataset.prize;
    load();
  });
});

modelTabs.forEach((t) => {
  if (t.dataset.model === selectedModel) activateInGroup(modelTabs, t);
  t.addEventListener("click", () => {
    activateInGroup(modelTabs, t);
    selectedModel = t.dataset.model;
    if (lastRes) renderSelectedModel(lastRes);
  });
});

async function load() {
  ensembleList.innerHTML = '<li class="rank-skeleton">กำลังคำนวณ...</li>';
  breakdownEl.innerHTML = "";
  try {
    const res = await api.predict(prize, 10);
    lastRes = res;
    targetEl.textContent = formatThaiDate(res.targetDate);

    if (tuningEl) {
      if (res.tuning) {
        const pct = (res.tuning.score * 100).toFixed(1);
        const when = formatThaiDate(res.tuning.tunedAt.slice(0, 10));
        tuningEl.textContent = `🎛️ ปรับพารามิเตอร์อัตโนมัติ — hit@10 = ${pct}% (ประเมิน ${res.tuning.evalDraws} งวด, ปรับเมื่อ ${when})`;
        tuningEl.hidden = false;
      } else {
        tuningEl.hidden = true;
      }
    }

    renderSelectedModel(res);

    breakdownEl.innerHTML = "";
    Object.entries(res.models || {}).forEach(([name, preds]) => {
      if (!preds.length) return;
      const card = document.createElement("div");
      card.className = "model-card";
      card.innerHTML = `
        <h3>${modelLabel(name)}</h3>
        <ul class="model-nums">
          ${preds.slice(0, 10).map((p) => `<li class="model-num">${p.number}</li>`).join("")}
        </ul>`;
      breakdownEl.appendChild(card);
    });
  } catch (e) {
    console.error(e);
    ensembleList.innerHTML = '<li class="rank-skeleton">โหลดไม่สำเร็จ</li>';
  }
}

function renderSelectedModel(res) {
  const preds = selectedModel === "ensemble"
    ? (res.ensemble ?? [])
    : (res.models?.[selectedModel] ?? []);

  if (titleEl) {
    titleEl.textContent = selectedModel === "ensemble"
      ? "อันดับรวมจากทุกโมเดล"
      : `อันดับจากโมเดล${modelLabel(selectedModel)}`;
  }

  if (!preds.length) {
    const reason = res.warning
      ? res.warning
      : (selectedModel !== "ensemble"
          ? `โมเดล${modelLabel(selectedModel)}ไม่รองรับ${PRIZE_LABELS[prize] ?? "รางวัลนี้"} หรือไม่มีข้อมูลพอ`
          : "ไม่มีข้อมูลเพียงพอ");
    ensembleList.innerHTML = `<li class="rank-skeleton">${reason}</li>`;
    return;
  }

  ensembleList.innerHTML = "";
  preds.forEach((p) => ensembleList.appendChild(renderRank(p)));
}

function renderRank(p) {
  const li = document.createElement("li");
  li.className = "rank-item";
  li.style.setProperty("--score", (p.score ?? 0).toFixed(2));
  li.innerHTML = `
    <div class="rank-head">
      <span class="rank-badge">${p.rank}</span>
      <span class="rank-score">คะแนน ${((p.score ?? 0) * 100).toFixed(0)}%</span>
    </div>
    <p class="rank-number">${p.number}</p>
    ${p.reason ? `<p class="rank-reason">${p.reason}</p>` : ""}
  `;
  return li;
}

function modelLabel(name) {
  return {
    ensemble: "รวมโมเดล",
    frequency: "ความถี่",
    gap: "ค้างนาน",
    markov: "มาร์คอฟ",
    digit_position: "ตามตำแหน่งหลัก",
  }[name] || name;
}

load();
