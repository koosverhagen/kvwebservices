document.addEventListener("DOMContentLoaded", function () {

  const toggle = document.querySelector(".menu-toggle");
  const menu = document.querySelector(".menu");

  /* =========================
     MOBILE MENU
  ========================= */

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

  /* =========================
     CLICK-TO-LOAD VIDEO
  ========================= */

  document.addEventListener("click", function (e) {
    const placeholder = e.target.closest(".video-placeholder");
    if (!placeholder) return;

    const videoID = placeholder.getAttribute("data-video");

    placeholder.innerHTML = `
      <iframe
        width="100%"
        height="100%"
        src="https://www.youtube-nocookie.com/embed/${videoID}?autoplay=1&modestbranding=1&rel=0"
        frameborder="0"
        allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen>
      </iframe>
    `;
  });

});
