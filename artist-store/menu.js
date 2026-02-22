(function initAbbieMenu() {
  const nav = document.querySelector(".abbie-nav");
  const toggle = document.querySelector(".abbie-menu-toggle");
  const menu = document.querySelector(".abbie-menu");

  if (!nav || !toggle || !menu) return;

  function closeMenu() {
    nav.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
  }

  function openMenu() {
    nav.classList.add("open");
    toggle.setAttribute("aria-expanded", "true");
  }

  const currentPath = window.location.pathname.split("/").pop() || "index.html";
  menu.querySelectorAll("a").forEach((link) => {
    const href = link.getAttribute("href") || "";
    if (href === currentPath) {
      link.setAttribute("aria-current", "page");
    }
  });

  toggle.addEventListener("click", () => {
    if (nav.classList.contains("open")) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  menu.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", closeMenu);
  });

  document.addEventListener("click", (event) => {
    if (!nav.contains(event.target)) {
      closeMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMenu();
    }
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 640) {
      closeMenu();
    }
  });
})();
