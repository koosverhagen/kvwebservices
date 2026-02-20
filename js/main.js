document.addEventListener("DOMContentLoaded", () => {
  /* =========================
     MOBILE MENU
  ========================= */
  const toggle = document.querySelector(".menu-toggle");
  const menu = document.querySelector(".menu");

  if (toggle && menu) {
    const closeMenu = () => {
      menu.classList.remove("open");
      document.body.classList.remove("menu-open");
      toggle.setAttribute("aria-expanded", "false");
    };

    const openMenu = () => {
      menu.classList.add("open");
      document.body.classList.add("menu-open");
      toggle.setAttribute("aria-expanded", "true");
    };

    const isOpen = () => menu.classList.contains("open");

    toggle.addEventListener("click", (e) => {
      // Prevent any accidental bubbling quirks
      e.stopPropagation();
      if (isOpen()) closeMenu();
      else openMenu();
    });

    // Close when clicking outside (only if open)
    document.addEventListener("click", (e) => {
      if (!isOpen()) return;
      const target = e.target;
      if (!(target instanceof Node)) return;

      if (!menu.contains(target) && !toggle.contains(target)) {
        closeMenu();
      }
    });

    // Close when clicking a menu link
    menu.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        if (isOpen()) closeMenu();
      });
    });

    // Close on Escape (accessibility)
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen()) closeMenu();
    });
  }

  /* =========================
     FAQ ACCORDION
  ========================= */
  const faqQuestions = document.querySelectorAll(".faq-question");

  if (faqQuestions.length) {
    faqQuestions.forEach((button) => {
      button.addEventListener("click", () => {
        const item = button.closest(".faq-item");
        if (!item) return;

        // Close all other items
        document.querySelectorAll(".faq-item").forEach((i) => {
          if (i !== item) i.classList.remove("active");
        });

        // Toggle current
        item.classList.toggle("active");
      });
    });
  }

  /* =========================
     PROJECT FUNNEL
  ========================= */
  const projectForm = document.getElementById("project-form");

  if (projectForm) {
    const steps = projectForm.querySelectorAll(".form-step");
    const nextButtons = projectForm.querySelectorAll(".next-btn");
    const backButtons = projectForm.querySelectorAll(".back-btn");
    const progressBar =
      projectForm.closest(".contact-card")?.querySelector(".progress-bar") ||
      null;

    let currentStep = 0;
    let selectedProjectType = "";
    const fieldMessages = {
      "business-type": "Please choose a business type.",
      industry: "Please choose an industry.",
      "industry-other": "Please specify your industry.",
      platform: "Please choose your current platform.",
      timeline: "Please choose a timeline.",
      budget: "Please choose a budget range.",
      maintenance: "Please choose an option for ongoing maintenance.",
      name: "Please enter your name.",
      email: "Please enter a valid email address.",
    };

    const updateStep = () => {
      steps.forEach((step, index) => {
        step.classList.toggle("active", index === currentStep);
      });

      if (progressBar && steps.length) {
        progressBar.style.width = `${((currentStep + 1) / steps.length) * 100}%`;
      }

      backButtons.forEach((btn) => {
        btn.style.visibility = currentStep === 0 ? "hidden" : "visible";
      });
    };

    const setPlatformVisibility = () => {
      const platformWrapper = document.getElementById("platform-wrapper");
      const platformSelect = document.getElementById("platform");
      if (!platformWrapper) return;

      const shouldShow = selectedProjectType === "Website Update";
      platformWrapper.classList.toggle("is-visible", shouldShow);
      platformWrapper.style.display = shouldShow ? "" : "none";

      if (platformSelect) {
        platformSelect.disabled = !shouldShow;
        platformSelect.required = shouldShow;
        if (!shouldShow) {
          platformSelect.setCustomValidity("");
          platformSelect.selectedIndex = 0;
        }
      }
    };

    const setIndustryOtherVisibility = () => {
      const industrySelect = document.getElementById("industry");
      const otherWrapper = document.getElementById("industry-other-wrapper");
      const otherInput = document.getElementById("industry-other");
      if (!industrySelect || !otherWrapper || !otherInput) return;

      const shouldShow = industrySelect.value === "Other";
      otherWrapper.classList.toggle("is-visible", shouldShow);
      otherWrapper.style.display = shouldShow ? "" : "none";

      otherInput.disabled = !shouldShow;
      otherInput.required = shouldShow;
      if (!shouldShow) {
        otherInput.value = "";
        otherInput.setCustomValidity("");
      }
    };

    const clearFieldError = (field) => {
      if (!field) return;
      field.setCustomValidity("");
    };

    const setFieldError = (field) => {
      if (!field) return;
      const message = fieldMessages[field.id] || "Please complete this field.";
      field.setCustomValidity(message);
    };

    const validateCurrentStep = () => {
      const currentStepEl = steps[currentStep];
      if (!currentStepEl) return true;

      const requiredFields = currentStepEl.querySelectorAll(
        "select[required], input[required], textarea[required]"
      );

      for (const field of requiredFields) {
        if (field.disabled) continue;

        clearFieldError(field);

        if (!field.checkValidity()) {
          setFieldError(field);
          field.reportValidity();
          clearFieldError(field);
          return false;
        }
      }

      return true;
    };

    // Option buttons (project type)
    projectForm.querySelectorAll(".option-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        // Prevent accidental form submission if these are buttons without type="button"
        e.preventDefault();

        projectForm
          .querySelectorAll(".option-btn")
          .forEach((b) => b.classList.remove("selected"));

        btn.classList.add("selected");

        selectedProjectType = btn.dataset.value || "";

        const hiddenProject = document.getElementById("hidden-project-type");
        if (hiddenProject) hiddenProject.value = selectedProjectType;

        setPlatformVisibility();
      });
    });

    projectForm
      .querySelectorAll("select, input, textarea")
      .forEach((field) => {
        field.addEventListener("change", () => clearFieldError(field));
        field.addEventListener("input", () => clearFieldError(field));
      });

    const industrySelect = document.getElementById("industry");
    if (industrySelect) {
      industrySelect.addEventListener("change", () => {
        setIndustryOtherVisibility();
      });
    }

    // Next
    nextButtons.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        // Prevent submit if the button is accidentally type="submit"
        e.preventDefault();

        // Step 1 validation
        if (currentStep === 0 && !selectedProjectType) {
          alert("Please select an option to continue.");
          return;
        }

        if (currentStep > 0 && !validateCurrentStep()) {
          return;
        }

        if (currentStep < steps.length - 1) {
          currentStep += 1;
          updateStep();
        }
      });
    });

    // Back
    backButtons.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();

        if (currentStep > 0) {
          currentStep -= 1;
          updateStep();
        }
      });
    });

    // On submit, copy visible fields into hidden fields
    projectForm.addEventListener("submit", () => {
      const pairs = [
        ["business-type", "hidden-business-type"],
        ["industry", "hidden-industry"],
        ["timeline", "hidden-timeline"],
        ["budget", "hidden-budget"],
        ["maintenance", "hidden-maintenance"],
        ["platform", "hidden-platform"],
      ];

      const fd = new FormData(projectForm);

      pairs.forEach(([visibleNameOrId, hiddenId]) => {
        const hidden = document.getElementById(hiddenId);
        if (!hidden) return;

        // Prefer getting by "name" via FormData; fallback to ID lookup
        const byName = fd.get(visibleNameOrId);
        if (byName !== null) {
          hidden.value = String(byName);
          return;
        }

        const visibleEl = document.getElementById(visibleNameOrId);
        if (visibleEl && "value" in visibleEl) {
          hidden.value = String(visibleEl.value ?? "");
        }
      });

      const industryVisible = document.getElementById("industry");
      const industryOther = document.getElementById("industry-other");
      const hiddenIndustry = document.getElementById("hidden-industry");

      if (hiddenIndustry && industryVisible) {
        if (industryVisible.value === "Other" && industryOther) {
          hiddenIndustry.value = String(industryOther.value ?? "").trim();
        } else {
          hiddenIndustry.value = String(industryVisible.value ?? "");
        }
      }
    });

    // Initialize
    updateStep();
    setPlatformVisibility();
    setIndustryOtherVisibility();
  }
});
