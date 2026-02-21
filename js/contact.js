document.addEventListener("DOMContentLoaded", () => {
  const year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());

  const toggle = document.querySelector(".menu-toggle");
  const menu = document.querySelector(".menu");

  if (toggle && menu) {
    const closeMenu = () => {
      menu.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    };

    toggle.addEventListener("click", () => {
      const open = menu.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    menu.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", closeMenu);
    });
  }

  const projectForm = document.getElementById("project-form");
  if (!projectForm) return;

  let selectedProjectType = "";

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

  const setProjectTypeVisibility = () => {
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

  const refreshAllOtherWrappers = () => {
    setSelectOtherVisibility("industry", "industry-other-wrapper", "industry-other");
    setSelectOtherVisibility(
      "business-type",
      "business-type-other-wrapper",
      "business-type-other"
    );
    setSelectOtherVisibility("platform", "platform-other-wrapper", "platform-other");
    setSelectOtherVisibility("timeline", "timeline-other-wrapper", "timeline-other");
    setSelectOtherVisibility("budget", "budget-other-wrapper", "budget-other");
    setSelectOtherVisibility(
      "maintenance",
      "maintenance-other-wrapper",
      "maintenance-other"
    );
  };

  projectForm.querySelectorAll(".option-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();

      projectForm
        .querySelectorAll(".option-btn")
        .forEach((button) => button.classList.remove("selected"));

      btn.classList.add("selected");
      selectedProjectType = btn.dataset.value || "";

      const hiddenProject = document.getElementById("hidden-project-type");
      if (hiddenProject) hiddenProject.value = selectedProjectType;

      setProjectTypeVisibility();
      setPlatformVisibility();
      refreshAllOtherWrappers();
    });
  });

  ["industry", "business-type", "platform", "timeline", "budget", "maintenance"]
    .forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("change", refreshAllOtherWrappers);
      el.addEventListener("input", refreshAllOtherWrappers);
    });

  const isVisible = (field) => field instanceof HTMLElement && field.offsetParent !== null;
  const valueOf = (field) => String(field?.value ?? "").trim();

  const validateForm = () => {
    if (!selectedProjectType) {
      alert("Please select an option for project type.");
      return false;
    }

    const projectTypeOther = document.getElementById("project-type-other");
    if (
      selectedProjectType === "Other" &&
      projectTypeOther instanceof HTMLInputElement &&
      valueOf(projectTypeOther).length === 0
    ) {
      alert("Please specify your project type.");
      projectTypeOther.focus();
      return false;
    }

    const requiredFields = projectForm.querySelectorAll(
      "select[required], input[required], textarea[required]"
    );

    for (const field of requiredFields) {
      if (field.disabled || !isVisible(field)) continue;

      if (valueOf(field).length === 0) {
        alert("Please complete all required fields.");
        field.focus();
        return false;
      }

      if (
        field instanceof HTMLInputElement &&
        field.type === "email" &&
        field.validity &&
        field.validity.typeMismatch
      ) {
        alert("Please enter a valid email address.");
        field.focus();
        return false;
      }
    }

    return true;
  };

  const resolveSelectOrOtherValue = (selectId, otherInputId) => {
    const select = document.getElementById(selectId);
    if (!select) return "";

    if (select.value === "Other") {
      const other = document.getElementById(otherInputId);
      return valueOf(other);
    }

    return valueOf(select);
  };

  projectForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!validateForm()) return;

    const hiddenProject = document.getElementById("hidden-project-type");
    const projectTypeOther = document.getElementById("project-type-other");
    if (hiddenProject) {
      hiddenProject.value =
        selectedProjectType === "Other"
          ? valueOf(projectTypeOther)
          : selectedProjectType;
    }

    const hiddenIndustry = document.getElementById("hidden-industry");
    if (hiddenIndustry) {
      hiddenIndustry.value = resolveSelectOrOtherValue("industry", "industry-other");
    }

    const hiddenBusinessType = document.getElementById("hidden-business-type");
    if (hiddenBusinessType) {
      hiddenBusinessType.value = resolveSelectOrOtherValue(
        "business-type",
        "business-type-other"
      );
    }

    const hiddenTimeline = document.getElementById("hidden-timeline");
    if (hiddenTimeline) {
      hiddenTimeline.value = resolveSelectOrOtherValue("timeline", "timeline-other");
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
      hiddenPlatform.value = resolveSelectOrOtherValue("platform", "platform-other");
    }

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

      if (!response.ok) throw new Error("Submission failed");

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

  setProjectTypeVisibility();
  setPlatformVisibility();
  refreshAllOtherWrappers();
});
