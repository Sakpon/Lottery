// Mobile nav toggle
const toggle = document.querySelector(".nav-toggle");
const nav = document.getElementById("primary-nav");

if (toggle && nav) {
  toggle.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "ปิดเมนู" : "เปิดเมนู");
  });

  // close on link click (mobile)
  nav.querySelectorAll("a").forEach((a) =>
    a.addEventListener("click", () => {
      if (window.innerWidth < 720) {
        nav.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      }
    }),
  );
}
