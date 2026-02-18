document.addEventListener("DOMContentLoaded", function () {

  const toggle = document.querySelector(".menu-toggle");
  const menu = document.querySelector(".menu");

  if (toggle && menu) {

    toggle.addEventListener("click", () => {
      const open = menu.classList.toggle("open");
      document.body.classList.toggle("menu-open", open);
      toggle.setAttribute("aria-expanded", open);
    });

    document.addEventListener("click", (e) => {
      if (!menu.contains(e.target) && !toggle.contains(e.target)) {
        menu.classList.remove("open");
        document.body.classList.remove("menu-open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });

    menu.querySelectorAll("a").forEach(link => {
      link.addEventListener("click", () => {
        menu.classList.remove("open");
        document.body.classList.remove("menu-open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

});
