import { api, formatThaiDate } from "./api.js";

const listEl = document.querySelector('[data-el="draw-list"]');
const yearSel = document.getElementById("year-filter");
const moreBtn = document.querySelector('[data-el="load-more"]');

let offset = 0;
const PAGE = 30;
let currentYear = "";

async function loadPage(reset = false) {
  if (reset) {
    offset = 0;
    listEl.innerHTML = '<li class="draw-skeleton">กำลังโหลด...</li>';
  }
  try {
    const { draws } = await api.list(PAGE, offset, currentYear);

    if (reset) listEl.innerHTML = "";
    if (draws.length === 0 && offset === 0) {
      listEl.innerHTML = '<li class="draw-skeleton">ยังไม่มีข้อมูล</li>';
      moreBtn.hidden = true;
      return;
    }
    draws.forEach((d) => listEl.appendChild(renderCard(d)));
    offset += PAGE;
    moreBtn.hidden = draws.length < PAGE;
  } catch (e) {
    console.error(e);
    listEl.innerHTML = '<li class="draw-skeleton">โหลดข้อมูลไม่สำเร็จ</li>';
  }
}

function renderCard(d) {
  const li = document.createElement("li");
  li.className = "draw-card";
  const firstNear = (d.prizes.firstNear || []).join(" · ");
  const frontThree = (d.prizes.frontThree || []).join(" · ");
  const lastThree = (d.prizes.lastThree || []).join(" · ");
  li.innerHTML = `
    <time datetime="${d.date}">${d.dateTh || formatThaiDate(d.date)}</time>
    <div class="draw-row"><span class="draw-row-label">รางวัลที่ 1</span><span class="draw-row-value">${d.prizes.first || "—"}</span></div>
    <div class="draw-row"><span class="draw-row-label">ข้างเคียง</span><span class="draw-row-value">${firstNear || "—"}</span></div>
    <div class="draw-row"><span class="draw-row-label">หน้า 3 ตัว</span><span class="draw-row-value">${frontThree || "—"}</span></div>
    <div class="draw-row"><span class="draw-row-label">ท้าย 3 ตัว</span><span class="draw-row-value">${lastThree || "—"}</span></div>
    <div class="draw-row"><span class="draw-row-label">ท้าย 2 ตัว</span><span class="draw-row-value">${d.prizes.lastTwo || "—"}</span></div>
  `;
  return li;
}

async function populateYears() {
  try {
    const meta = await api.meta();
    const earliest = meta.earliest ? Number(meta.earliest.slice(0, 4)) : new Date().getUTCFullYear();
    const latest = meta.latest ? Number(meta.latest.slice(0, 4)) : new Date().getUTCFullYear();
    for (let y = latest; y >= earliest; y--) {
      const opt = document.createElement("option");
      opt.value = String(y);
      opt.textContent = `${y + 543}`;
      yearSel.appendChild(opt);
    }
  } catch { /* เงียบ */ }
}

yearSel.addEventListener("change", (e) => {
  currentYear = e.target.value;
  loadPage(true);
});
moreBtn.addEventListener("click", () => loadPage(false));

populateYears();
loadPage(true);
