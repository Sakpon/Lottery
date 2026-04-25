import { api } from "./api.js";

const tabs = document.querySelectorAll('[data-el="prize-tabs"] .segment-item');
const hotEl = document.querySelector('[data-el="hot-list"]');
const coldEl = document.querySelector('[data-el="cold-list"]');
const heatEl = document.querySelector('[data-el="digit-heatmap"]');
const winInput = document.getElementById("window-size");
const winOut = document.getElementById("window-size-out");

let prize = new URLSearchParams(location.search).get("prize") || "last_two";
let windowSize = 60;

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

winInput.addEventListener("input", (e) => {
  windowSize = Number(e.target.value);
  winOut.value = String(windowSize);
});
winInput.addEventListener("change", () => load());

async function load() {
  hotEl.innerHTML = '<li class="skeleton-chip"></li>'.repeat(8);
  coldEl.innerHTML = '<li class="skeleton-chip"></li>'.repeat(8);
  heatEl.innerHTML = "";
  try {
    const s = await api.stats(prize, windowSize);
    hotEl.innerHTML = "";
    (s.hot || []).forEach((h) => {
      const li = document.createElement("li");
      li.className = "chip chip--hot";
      li.innerHTML = `<span class="chip-num">${h.number}</span><span class="chip-count">${h.count} ครั้ง</span>`;
      hotEl.appendChild(li);
    });
    coldEl.innerHTML = "";
    (s.cold || []).forEach((n) => {
      const li = document.createElement("li");
      li.className = "chip chip--cold";
      li.innerHTML = `<span class="chip-num">${n}</span><span class="chip-count">ไม่ออก</span>`;
      coldEl.appendChild(li);
    });
    renderHeatmap(s.digitPositionFrequency || []);
  } catch (e) {
    console.error(e);
    hotEl.innerHTML = '<li class="skeleton-chip">โหลดไม่สำเร็จ</li>';
  }
}

function renderHeatmap(matrix) {
  heatEl.innerHTML = "";
  if (!matrix.length) return;
  // header row
  const header = document.createElement("div");
  header.className = "heatmap-row";
  header.innerHTML = '<div class="heatmap-label">ตำแหน่ง</div>' +
    Array.from({ length: 10 }, (_, d) => `<div class="heatmap-label">${d}</div>`).join("");
  heatEl.appendChild(header);

  matrix.forEach((row, idx) => {
    const r = document.createElement("div");
    r.className = "heatmap-row";
    const max = Math.max(...row, 1);
    const label = `<div class="heatmap-label">หลักที่ ${idx + 1}</div>`;
    const cells = row.map((c) => {
      const alpha = (c / max).toFixed(2);
      return `<div class="heatmap-cell" style="background:rgba(139,21,56,${alpha});color:${alpha>0.5?'#FDF6E3':'var(--color-text)'}">${c}</div>`;
    }).join("");
    r.innerHTML = label + cells;
    heatEl.appendChild(r);
  });
}

load();
