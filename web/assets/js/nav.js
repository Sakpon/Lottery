// Mobile nav toggle
const toggle = document.querySelector(".nav-toggle");
const nav = document.getElementById("primary-nav");

function closeNav() {
  if (!nav?.classList.contains("open")) return;
  nav.classList.remove("open");
  toggle?.setAttribute("aria-expanded", "false");
  toggle?.setAttribute("aria-label", "เปิดเมนู");
}

if (toggle && nav) {
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "ปิดเมนู" : "เปิดเมนู");
  });

  // Close on link click (mobile)
  nav.querySelectorAll("a").forEach((a) =>
    a.addEventListener("click", () => {
      if (window.innerWidth < 720) closeNav();
    }),
  );

  // Close on outside tap
  document.addEventListener("click", (e) => {
    if (!nav.classList.contains("open")) return;
    if (nav.contains(e.target) || toggle.contains(e.target)) return;
    closeNav();
  });

  // Close on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeNav();
  });

  // Close when resizing to desktop (avoids stuck-open state after rotation)
  window.addEventListener("resize", () => {
    if (window.innerWidth >= 720) closeNav();
  });
}
