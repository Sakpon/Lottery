import { api, formatThaiDate, PRIZE_LABELS } from "./api.js";

const tabs = document.querySelectorAll('[data-el="prize-tabs"] .segment-item');
const ensembleList = document.querySelector('[data-el="ensemble-list"]');
const breakdownEl = document.querySelector('[data-el="model-breakdown"]');
const targetEl = document.querySelector('[data-el="target-date"]');

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
  ensembleList.innerHTML = '<li class="rank-skeleton">กำลังคำนวณ...</li>';
  breakdownEl.innerHTML = "";
  try {
    const res = await api.predict(prize, 10);
    targetEl.textContent = formatThaiDate(res.targetDate);

    if (!res.ensemble?.length) {
      ensembleList.innerHTML = `<li class="rank-skeleton">${res.warning || "ไม่มีข้อมูลเพียงพอ"}</li>`;
      return;
    }

    ensembleList.innerHTML = "";
    res.ensemble.forEach((p) => ensembleList.appendChild(renderRank(p)));

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

function renderRank(p) {
  const li = document.createElement("li");
  li.className = "rank-item";
  li.style.setProperty("--score", p.score.toFixed(2));
  li.innerHTML = `
    <div class="rank-head">
      <span class="rank-badge">${p.rank}</span>
      <span class="rank-score">คะแนน ${(p.score * 100).toFixed(0)}%</span>
    </div>
    <p class="rank-number">${p.number}</p>
    ${p.reason ? `<p class="rank-reason">${p.reason}</p>` : ""}
  `;
  return li;
}

function modelLabel(name) {
  return {
    frequency: "ความถี่ (Frequency)",
    gap: "ค้างนาน (Gap)",
    markov: "Markov",
    digit_position: "ตามตำแหน่งหลัก",
  }[name] || name;
}

load();
