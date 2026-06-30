document.addEventListener("DOMContentLoaded", () => {
  /* =========================
     MOBILE MENU
  ========================= */
  const year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());

  const toggle = document.querySelector(".menu-toggle");
  const menu = document.querySelector(".menu");

  if (toggle && menu) {
    toggle.textContent = "☰ Menu";

    const currentPath = window.location.pathname.split("/").pop() || "contact.html";
    menu.querySelectorAll("a").forEach((link) => {
      const href = link.getAttribute("href") || "";
      if (href === currentPath) {
        link.setAttribute("aria-current", "page");
      }
    });

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

    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (menu.classList.contains("open")) closeMenu();
      else openMenu();
    });

    document.addEventListener("click", (event) => {
      if (!menu.classList.contains("open")) return;
      if (!menu.contains(event.target) && !toggle.contains(event.target)) {
        closeMenu();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenu();
    });

    menu.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", closeMenu);
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 930) closeMenu();
    });
  }

  /* =========================
     CONTACT FUNNEL
  ========================= */
  const projectForm = document.getElementById("project-form");
  if (!projectForm) return;

  const steps = Array.from(projectForm.querySelectorAll(".form-step"));
  const nextButtons = Array.from(projectForm.querySelectorAll(".next-btn"));
  const backButtons = Array.from(projectForm.querySelectorAll(".back-btn"));
  const optionButtons = Array.from(projectForm.querySelectorAll(".option-btn"));
  const progressBar = projectForm.closest(".contact-card")?.querySelector(".progress-bar") || null;

  let currentStep = 0;
  let selectedProjectType = "";

  const getValue = (field) => String(field?.value ?? "").trim();

  const showOrHideWrapper = (shouldShow, wrapperId, inputId) => {
    const wrapper = document.getElementById(wrapperId);
    const input = document.getElementById(inputId);
    if (!wrapper || !input) return;

    wrapper.classList.toggle("is-visible", shouldShow);
    wrapper.style.display = shouldShow ? "" : "none";
    input.disabled = !shouldShow;
    input.required = shouldShow;

    if (!shouldShow) {
      input.value = "";
    }
  };

  const setProjectTypeOtherVisibility = () => {
    showOrHideWrapper(
      selectedProjectType === "Other",
      "project-type-other-wrapper",
      "project-type-other"
    );
  };

  const setPlatformVisibility = () => {
    const platformWrapper = document.getElementById("platform-wrapper");
    const platformSelect = document.getElementById("platform");
    if (!platformWrapper || !platformSelect) return;

    const shouldShow = selectedProjectType === "Website Update";
    platformWrapper.classList.toggle("is-visible", shouldShow);
    platformWrapper.style.display = shouldShow ? "" : "none";
    platformSelect.disabled = !shouldShow;
    platformSelect.required = shouldShow;

    if (!shouldShow) {
      platformSelect.selectedIndex = 0;
    }

    setSelectOtherVisibility("platform", "platform-other-wrapper", "platform-other");
  };

  const setSelectOtherVisibility = (selectId, wrapperId, inputId) => {
    const select = document.getElementById(selectId);
    if (!select) return;

    showOrHideWrapper(
      select.value === "Other" && !select.disabled,
      wrapperId,
      inputId
    );
  };

  const refreshConditionalFields = () => {
    setProjectTypeOtherVisibility();
    setPlatformVisibility();
    setSelectOtherVisibility("business-type", "business-type-other-wrapper", "business-type-other");
    setSelectOtherVisibility("industry", "industry-other-wrapper", "industry-other");
    setSelectOtherVisibility("timeline", "timeline-other-wrapper", "timeline-other");
    setSelectOtherVisibility("budget", "budget-other-wrapper", "budget-other");
    setSelectOtherVisibility("maintenance", "maintenance-other-wrapper", "maintenance-other");
  };

  const isFieldVisible = (field) => {
    if (!(field instanceof HTMLElement)) return false;
    if (field.disabled) return false;
    return field.offsetParent !== null;
  };

  const fieldMessages = {
    "business-type": "Please choose a business type.",
    industry: "Please choose an industry.",
    "industry-other": "Please specify your industry.",
    "project-type-other": "Please specify your project type.",
    "business-type-other": "Please specify your business type.",
    "platform-other": "Please specify your platform.",
    "timeline-other": "Please specify your timeline.",
    "budget-other": "Please specify your budget range.",
    "maintenance-other": "Please specify your maintenance preference.",
    platform: "Please choose your current platform.",
    timeline: "Please choose a timeline.",
    budget: "Please choose a budget range.",
    maintenance: "Please choose an option for ongoing maintenance.",
    name: "Please enter your name.",
    email: "Please enter a valid email address.",
  };

  const getFieldMessage = (field) =>
    fieldMessages[field?.id] || "Please complete this field.";

  const validateField = (field) => {
    if (!field || field.disabled) return true;

    if (getValue(field).length === 0) {
      alert(getFieldMessage(field));
      field.focus();
      return false;
    }

    if (
      field instanceof HTMLInputElement &&
      field.type === "email" &&
      field.validity &&
      field.validity.typeMismatch
    ) {
      alert(getFieldMessage(field));
      field.focus();
      return false;
    }

    return true;
  };

  const validateProjectType = () => {
    if (!selectedProjectType) {
      alert("Please select an option to continue.");
      return false;
    }

    if (selectedProjectType === "Other") {
      return validateField(document.getElementById("project-type-other"));
    }

    return true;
  };

  const validateStep = (stepIndex) => {
    if (stepIndex === 0) return validateProjectType();

    const step = steps[stepIndex];
    if (!step) return true;

    const requiredFields = Array.from(
      step.querySelectorAll("select[required], input[required], textarea[required]")
    );

    for (const field of requiredFields) {
      if (isFieldVisible(field) && !validateField(field)) {
        return false;
      }
    }

    return true;
  };

  const validateAll = () => {
    refreshConditionalFields();

    if (!validateProjectType()) return false;

    for (let index = 1; index < steps.length; index += 1) {
      const requiredFields = Array.from(
        steps[index].querySelectorAll("select[required], input[required], textarea[required]")
      );

      for (const field of requiredFields) {
        if (!field.disabled && !validateField(field)) {
          return false;
        }
      }
    }

    return true;
  };

  const updateStep = () => {
    steps.forEach((step, index) => {
      step.classList.toggle("active", index === currentStep);
    });

    if (progressBar && steps.length) {
      progressBar.style.width = `${((currentStep + 1) / steps.length) * 100}%`;
    }

    backButtons.forEach((button) => {
      const onFirstStep = currentStep === 0;
      button.disabled = onFirstStep;
      button.setAttribute("aria-disabled", onFirstStep ? "true" : "false");
      button.style.visibility = onFirstStep ? "hidden" : "visible";
      if (onFirstStep) button.setAttribute("tabindex", "-1");
      else button.removeAttribute("tabindex");
    });

    refreshConditionalFields();
  };

  const resolveSelectOrOtherValue = (selectId, otherInputId) => {
    const select = document.getElementById(selectId);
    if (!select || select.disabled) return "";

    if (select.value === "Other") {
      const other = document.getElementById(otherInputId);
      return getValue(other);
    }

    return getValue(select);
  };

  const populateHiddenFields = () => {
    const hiddenProject = document.getElementById("hidden-project-type");
    const projectTypeOther = document.getElementById("project-type-other");

    if (hiddenProject) {
      hiddenProject.value =
        selectedProjectType === "Other" ? getValue(projectTypeOther) : selectedProjectType;
    }

    const hiddenBusinessType = document.getElementById("hidden-business-type");
    if (hiddenBusinessType) {
      hiddenBusinessType.value = resolveSelectOrOtherValue(
        "business-type",
        "business-type-other"
      );
    }

    const hiddenIndustry = document.getElementById("hidden-industry");
    if (hiddenIndustry) {
      hiddenIndustry.value = resolveSelectOrOtherValue(
        "industry",
        "industry-other"
      );
    }

    const hiddenTimeline = document.getElementById("hidden-timeline");
    if (hiddenTimeline) {
      hiddenTimeline.value = resolveSelectOrOtherValue(
        "timeline",
        "timeline-other"
      );
    }

    const hiddenBudget = document.getElementById("hidden-budget");
    if (hiddenBudget) {
      hiddenBudget.value = resolveSelectOrOtherValue("budget", "budget-other");
    }

    const hiddenMaintenance = document.getElementById("hidden-maintenance");
    if (hiddenMaintenance) {
      hiddenMaintenance.value = resolveSelectOrOtherValue(
        "maintenance",
        "maintenance-other"
      );
    }

    const hiddenPlatform = document.getElementById("hidden-platform");
    if (hiddenPlatform) {
      hiddenPlatform.value = resolveSelectOrOtherValue(
        "platform",
        "platform-other"
      );
    }
  };

  optionButtons.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();

      optionButtons.forEach((btn) => {
        btn.classList.remove("selected");
        btn.setAttribute("aria-pressed", "false");
      });

      button.classList.add("selected");
      button.setAttribute("aria-pressed", "true");

      selectedProjectType = button.dataset.value || "";
      populateHiddenFields();
      refreshConditionalFields();
    });
  });

  ["business-type", "industry", "platform", "timeline", "budget", "maintenance"].forEach((id) => {
    const element = document.getElementById(id);
    if (!element) return;

    element.addEventListener("change", () => {
      refreshConditionalFields();
      populateHiddenFields();
    });

    element.addEventListener("input", () => {
      refreshConditionalFields();
      populateHiddenFields();
    });
  });

  nextButtons.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();

      if (!validateStep(currentStep)) return;

      if (currentStep < steps.length - 1) {
        currentStep += 1;
        updateStep();
      }
    });
  });

  backButtons.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();

      if (currentStep > 0) {
        currentStep -= 1;
        updateStep();
      }
    });
  });

  projectForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!validateAll()) return;

    populateHiddenFields();

    const submitButton = projectForm.querySelector(".submit-btn");
    if (submitButton instanceof HTMLButtonElement) {
      submitButton.disabled = true;
      submitButton.textContent = "Sending...";
    }

    try {
      const response = await fetch(projectForm.action, {
        method: "POST",
        body: new FormData(projectForm),
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error("Submission failed");
      }

      window.location.href = "thank-you.html";
    } catch (error) {
      alert(
        "Something went wrong while sending your message. Please try again or email info@kvwebservices.co.uk."
      );

      if (submitButton instanceof HTMLButtonElement) {
        submitButton.disabled = false;
        submitButton.textContent = "Start My Project";
      }
    }
  });

  updateStep();
  populateHiddenFields();
});
