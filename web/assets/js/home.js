import { api, formatThaiDate, formatCountdown } from "./api.js";

async function render() {
  try {
    const [meta, latest] = await Promise.all([api.meta(), api.latest()]);

    // Hero — latest draw
    const dateEl = document.querySelector('[data-el="latest-date"]');
    if (dateEl) dateEl.textContent = `งวดวันที่ ${latest.dateTh || formatThaiDate(latest.date)}`;

    setPrize("first", latest.prizes.first);
    setPrize("frontThree", (latest.prizes.frontThree || []).join("  ·  "));
    setPrize("lastThree", (latest.prizes.lastThree || []).join("  ·  "));
    setPrize("lastTwo", latest.prizes.lastTwo);

    const src = document.querySelector('[data-el="source-note"]');
    if (src && latest.sourceUrl) {
      src.innerHTML = `แหล่งข้อมูล: <a href="${latest.sourceUrl}" rel="noopener">sanook.com</a>`;
    }

    // Next draw
    const next = meta.nextDraw;
    const nextEl = document.querySelector('[data-el="next-draw-date"]');
    const countEl = document.querySelector('[data-el="countdown"]');
    if (nextEl) nextEl.textContent = formatThaiDate(next);
    if (countEl) {
      countEl.textContent = formatCountdown(next);
      setInterval(() => { countEl.textContent = formatCountdown(next); }, 60_000);
    }

    // Meta stats
    setText('[data-el="meta-total"]', meta.total?.toLocaleString("th-TH") ?? "—");
    setText('[data-el="meta-earliest"]', formatThaiDate(meta.earliest));
    setText('[data-el="meta-latest"]', formatThaiDate(meta.latest));

    // Recommended first-prize picks — non-blocking; hero stays responsive if this fails
    renderRecommendedFirst();
  } catch (e) {
    console.error(e);
    showError();
  }
}

async function renderRecommendedFirst() {
  const el = document.querySelector('[data-el="recommend-first"]');
  if (!el) return;
  try {
    const res = await api.predict("first", 3);
    if (!res.ensemble?.length) {
      el.innerHTML = `<li class="rank-skeleton">${res.warning || "ข้อมูลยังไม่เพียงพอ"}</li>`;
      return;
    }
    el.innerHTML = "";
    res.ensemble.forEach((p) => el.appendChild(renderRecommendItem(p)));
  } catch (e) {
    console.error(e);
    el.innerHTML = '<li class="rank-skeleton">โหลดเลขแนะนำไม่สำเร็จ</li>';
  }
}

function renderRecommendItem(p) {
  const li = document.createElement("li");
  li.className = "rank-item";
  li.style.setProperty("--score", (p.score ?? 0).toFixed(2));
  li.innerHTML = `
    <div style="display:flex;align-items:center;gap:.5rem">
      <span class="rank-badge">${p.rank}</span>
      <span class="rank-score">คะแนน ${((p.score ?? 0) * 100).toFixed(0)}%</span>
    </div>
    <p class="rank-number">${p.number}</p>
    ${p.reason ? `<p class="rank-reason">${p.reason}</p>` : ""}
  `;
  return li;
}

function setPrize(key, value) {
  const el = document.querySelector(`[data-prize="${key}"]`);
  if (!el) return;
  if (value === null || value === undefined || value === "") {
    el.textContent = key === "first" ? "— — — — — —" : "— — —";
  } else {
    el.textContent = value;
  }
}

function setText(sel, value) {
  const el = document.querySelector(sel);
  if (el) el.textContent = value ?? "—";
}

function showError() {
  const dateEl = document.querySelector('[data-el="latest-date"]');
  if (dateEl) dateEl.textContent = "ไม่สามารถโหลดข้อมูลได้";
}

render();
