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

  /* =========================
     FAQ ACCORDION
  ========================= */

  document.querySelectorAll(".faq-question").forEach(button => {
    button.addEventListener("click", () => {

      const item = button.parentElement;

      document.querySelectorAll(".faq-item").forEach(i => {
        if (i !== item) i.classList.remove("active");
      });

      item.classList.toggle("active");

    });
  });

 /* =========================
   PROJECT FUNNEL
========================= */

const projectForm = document.getElementById("project-form");

if (projectForm) {

 const steps = projectForm.querySelectorAll(".form-step");
const nextButtons = projectForm.querySelectorAll(".next-btn");
  const progressBar = projectForm.closest(".contact-card")?.querySelector(".progress-bar");

  let currentStep = 0;
  let selectedProjectType = "";

  const updateStep = () => {
    steps.forEach((step, index) => {
      step.classList.remove("active");
      if (index === currentStep) {
        step.classList.add("active");
      }
    });

    if (progressBar) {
      progressBar.style.width =
        ((currentStep + 1) / steps.length) * 100 + "%";
    }
  };
projectForm.querySelectorAll(".option-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    projectForm.querySelectorAll(".option-btn")
      .forEach(b => b.classList.remove("selected"));

    btn.classList.add("selected");

    selectedProjectType = btn.dataset.value;

    const hiddenProject = document.getElementById("hidden-project-type");
    if (hiddenProject) hiddenProject.value = selectedProjectType;

    const platformWrapper = document.getElementById("platform-wrapper");

    if (selectedProjectType === "Website Update") {
      if (platformWrapper) platformWrapper.style.display = "block";
    } else {
      if (platformWrapper) platformWrapper.style.display = "none";
    }
  });
});


  nextButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      if (currentStep < steps.length - 1) {
        currentStep++;
        updateStep();
      }
    });
  });

  const backButtons = projectForm.querySelectorAll(".back-btn");

backButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    if (currentStep > 0) {
      currentStep--;
      updateStep();
    }
  });
});

  projectForm.addEventListener("submit", function () {

    const setHidden = (id, hiddenId) => {
      const field = document.getElementById(id);
      const hidden = document.getElementById(hiddenId);
      if (field && hidden) hidden.value = field.value;
    };

    setHidden("business-type", "hidden-business-type");
    setHidden("industry", "hidden-industry");
    setHidden("timeline", "hidden-timeline");
    setHidden("budget", "hidden-budget");
    setHidden("maintenance", "hidden-maintenance");
    setHidden("platform", "hidden-platform");

  });

  updateStep(); // ensure step 1 active on load
}

