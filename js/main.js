document.addEventListener("DOMContentLoaded", () => {
  /* =========================
     MOBILE MENU
  ========================= */
  const toggle = document.querySelector(".menu-toggle");
  const menu = document.querySelector(".menu");

  if (toggle && menu) {
    toggle.textContent = "☰ Menu";

    const currentPath = window.location.pathname.split("/").pop() || "index.html";
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

    window.addEventListener("resize", () => {
      if (window.innerWidth > 930 && isOpen()) {
        closeMenu();
      }
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
    const isStableContactMode = document.body.classList.contains("contact-stable");

    if (isStableContactMode) {
      let selectedProjectType = "";

      const showOrHideWrapper = (shouldShow, wrapperId, inputId) => {
        const wrapper = document.getElementById(wrapperId);
        const input = document.getElementById(inputId);
        if (!wrapper || !input) return;

        wrapper.classList.toggle("is-visible", shouldShow);
        wrapper.style.display = shouldShow ? "" : "none";
        input.disabled = !shouldShow;
        input.required = shouldShow;
        if (!shouldShow) input.value = "";
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

      const setAllOtherVisibility = () => {
        setSelectOtherVisibility(
          "industry",
          "industry-other-wrapper",
          "industry-other"
        );
        setSelectOtherVisibility(
          "business-type",
          "business-type-other-wrapper",
          "business-type-other"
        );
        setSelectOtherVisibility(
          "platform",
          "platform-other-wrapper",
          "platform-other"
        );
        setSelectOtherVisibility(
          "timeline",
          "timeline-other-wrapper",
          "timeline-other"
        );
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
            .forEach((b) => b.classList.remove("selected"));
          btn.classList.add("selected");
          selectedProjectType = btn.dataset.value || "";
          setProjectTypeVisibility();
          setPlatformVisibility();
          setAllOtherVisibility();
        });
      });

      ["industry", "business-type", "platform", "timeline", "budget", "maintenance"]
        .forEach((id) => {
          const el = document.getElementById(id);
          if (!el) return;
          el.addEventListener("change", setAllOtherVisibility);
          el.addEventListener("input", setAllOtherVisibility);
        });

      const isFieldVisible = (field) => {
        if (!(field instanceof HTMLElement)) return false;
        return field.offsetParent !== null;
      };

      const getValue = (field) => String(field.value ?? "").trim();

      const validateStableForm = () => {
        if (!selectedProjectType) {
          alert("Please select an option for project type.");
          return false;
        }

        const requiredFields = projectForm.querySelectorAll(
          "select[required], input[required], textarea[required]"
        );

        for (const field of requiredFields) {
          if (field.disabled || !isFieldVisible(field)) continue;
          if (getValue(field).length === 0) {
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
          return other ? getValue(other) : "";
        }
        return getValue(select);
      };

      projectForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        if (!validateStableForm()) return;

        const hiddenProject = document.getElementById("hidden-project-type");
        const projectTypeOther = document.getElementById("project-type-other");
        if (hiddenProject) {
          hiddenProject.value =
            selectedProjectType === "Other" && projectTypeOther
              ? getValue(projectTypeOther)
              : selectedProjectType;
        }

        const hiddenIndustry = document.getElementById("hidden-industry");
        if (hiddenIndustry) {
          hiddenIndustry.value = resolveSelectOrOtherValue(
            "industry",
            "industry-other"
          );
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
      setAllOtherVisibility();
      return;
    }

    try {
    const steps = projectForm.querySelectorAll(".form-step");
    const nextButtons = projectForm.querySelectorAll(".next-btn");
    const backButtons = projectForm.querySelectorAll(".back-btn");
    const progressBar =
      projectForm.closest(".contact-card")?.querySelector(".progress-bar") ||
      null;

    let currentStep = 0;
    let selectedProjectType = "";
    const isChromium = /Chrome|CriOS/i.test(navigator.userAgent);
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

    const updateStep = () => {
      if (document.body.classList.contains("chrome-safe-funnel")) {
        return;
      }

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

    const enableChromeSafeMode = () => {
      document.body.classList.add("chrome-safe-funnel");

      const progress = projectForm
        .closest(".contact-card")
        ?.querySelector(".funnel-progress");
      if (progress instanceof HTMLElement) {
        progress.style.display = "none";
      }

      steps.forEach((step) => {
        step.classList.add("active");
      });

      projectForm
        .querySelectorAll('.step-actions button[type="button"]')
        .forEach((btn) => {
          if (btn instanceof HTMLElement) {
            btn.style.display = "none";
          }
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
          platformSelect.selectedIndex = 0;
        }
      }

      setPlatformOtherVisibility();
    };

    const toggleOtherWrapper = ({
      shouldShow,
      wrapperId,
      inputId,
      keepValueWhenHidden = false,
    }) => {
      const wrapper = document.getElementById(wrapperId);
      const input = document.getElementById(inputId);
      if (!wrapper || !input) return;

      wrapper.classList.toggle("is-visible", shouldShow);
      wrapper.style.display = shouldShow ? "" : "none";

      input.disabled = !shouldShow;
      input.required = shouldShow;
      if (!shouldShow) {
        if (!keepValueWhenHidden) {
          input.value = "";
        }
      }
    };

    const setProjectTypeOtherVisibility = () => {
      toggleOtherWrapper({
        shouldShow: selectedProjectType === "Other",
        wrapperId: "project-type-other-wrapper",
        inputId: "project-type-other",
      });
    };

    const setSelectOtherVisibility = (selectId, wrapperId, inputId) => {
      const select = document.getElementById(selectId);
      if (!select) return;

      toggleOtherWrapper({
        shouldShow: select.value === "Other" && !select.disabled,
        wrapperId,
        inputId,
      });
    };

    const setIndustryOtherVisibility = () => {
      setSelectOtherVisibility(
        "industry",
        "industry-other-wrapper",
        "industry-other"
      );
    };

    const setBusinessTypeOtherVisibility = () => {
      setSelectOtherVisibility(
        "business-type",
        "business-type-other-wrapper",
        "business-type-other"
      );
    };

    const setPlatformOtherVisibility = () => {
      setSelectOtherVisibility(
        "platform",
        "platform-other-wrapper",
        "platform-other"
      );
    };

    const setTimelineOtherVisibility = () => {
      setSelectOtherVisibility(
        "timeline",
        "timeline-other-wrapper",
        "timeline-other"
      );
    };

    const setBudgetOtherVisibility = () => {
      setSelectOtherVisibility("budget", "budget-other-wrapper", "budget-other");
    };

    const setMaintenanceOtherVisibility = () => {
      setSelectOtherVisibility(
        "maintenance",
        "maintenance-other-wrapper",
        "maintenance-other"
      );
    };

    const getFieldMessage = (field) => {
      if (!field) return;
      return fieldMessages[field.id] || "Please complete this field.";
    };

    const validateField = (field) => {
      if (!field || field.disabled) return true;

      const value = String(field.value ?? "").trim();
      if (value.length === 0) {
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

    const validateCurrentStep = () => {
      const currentStepEl = steps[currentStep];
      if (!currentStepEl) return true;

      const requiredFields = currentStepEl.querySelectorAll(
        "select[required], input[required], textarea[required]"
      );

      for (const field of requiredFields) {
        if (!validateField(field)) {
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
        setProjectTypeOtherVisibility();
      });
    });

    const industrySelect = document.getElementById("industry");
    if (industrySelect) {
      industrySelect.addEventListener("change", () => {
        setIndustryOtherVisibility();
      });
      industrySelect.addEventListener("input", () => {
        setIndustryOtherVisibility();
      });
    }

    const addOtherSelectListeners = (selectId, handler) => {
      const select = document.getElementById(selectId);
      if (!select) return;
      select.addEventListener("change", handler);
      select.addEventListener("input", handler);
    };

    addOtherSelectListeners("business-type", setBusinessTypeOtherVisibility);
    addOtherSelectListeners("platform", setPlatformOtherVisibility);
    addOtherSelectListeners("timeline", setTimelineOtherVisibility);
    addOtherSelectListeners("budget", setBudgetOtherVisibility);
    addOtherSelectListeners("maintenance", setMaintenanceOtherVisibility);

    if (isChromium) {
      enableChromeSafeMode();
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

        if (currentStep === 0 && selectedProjectType === "Other") {
          const projectTypeOther = document.getElementById("project-type-other");
          if (!validateField(projectTypeOther)) {
            return;
          }
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

    // On submit, copy visible fields into hidden fields, then submit via fetch
    projectForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      if (!validateCurrentStep()) {
        return;
      }

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

      const resolveSelectOrOtherValue = (selectId, otherInputId) => {
        const select = document.getElementById(selectId);
        if (!select) return "";

        if (select.value === "Other" && otherInputId) {
          const otherInput = document.getElementById(otherInputId);
          if (!otherInput) return "";
          return String(otherInput.value ?? "").trim();
        }

        return String(select.value ?? "").trim();
      };

      const hiddenProject = document.getElementById("hidden-project-type");
      const projectTypeOther = document.getElementById("project-type-other");
      if (hiddenProject) {
        if (selectedProjectType === "Other" && projectTypeOther) {
          hiddenProject.value = String(projectTypeOther.value ?? "").trim();
        } else {
          hiddenProject.value = selectedProjectType;
        }
      }

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

      const hiddenBusinessType = document.getElementById("hidden-business-type");
      if (hiddenBusinessType) {
        hiddenBusinessType.value = resolveSelectOrOtherValue(
          "business-type",
          "business-type-other"
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

      const submitButton = projectForm.querySelector(".submit-btn");
      if (submitButton instanceof HTMLButtonElement) {
        submitButton.disabled = true;
        submitButton.textContent = "Sending...";
      }

      try {
        const response = await fetch(projectForm.action, {
          method: "POST",
          body: new FormData(projectForm),
          headers: {
            Accept: "application/json",
          },
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

    // Initialize
    updateStep();
    setPlatformVisibility();
    setProjectTypeOtherVisibility();
    setIndustryOtherVisibility();
    setBusinessTypeOtherVisibility();
    setPlatformOtherVisibility();
    setTimelineOtherVisibility();
    setBudgetOtherVisibility();
    setMaintenanceOtherVisibility();
    } catch (error) {
      console.error("Funnel setup failed, using fallback submit flow.", error);

      projectForm.addEventListener("submit", async (e) => {
        e.preventDefault();

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
        } catch (submitError) {
          alert(
            "Something went wrong while sending your message. Please try again or email info@kvwebservices.co.uk."
          );

          if (submitButton instanceof HTMLButtonElement) {
            submitButton.disabled = false;
            submitButton.textContent = "Start My Project";
          }
        }
      });
    }
  }
});
