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
  } catch (e) {
    console.error(e);
    showError();
  }
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
