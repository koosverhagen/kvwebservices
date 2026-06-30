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


/* =========================
   ABBIE AT HEART CASE STUDY OVERLAY
========================= */
document.addEventListener("DOMContentLoaded", () => {
  const artistCaseUrl = "artist-store/index.html";
  const overlayCacheVersion = "36";
  let overlay = null;
  let lastFocusedElement = null;

  const isModifiedClick = (event) => (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );

  const isArtistCaseLink = (link) => {
    const href = link.getAttribute("href") || "";
    return href === artistCaseUrl || href.endsWith("/artist-store/index.html");
  };

  const withOverlayCacheBust = (url) => {
    try {
      const parsed = new URL(url, window.location.href);
      parsed.searchParams.set("kvOverlay", overlayCacheVersion);

      const relativePath = parsed.pathname.replace(/^\//, "");
      return `${relativePath}${parsed.search}${parsed.hash}`;
    } catch (error) {
      const joiner = url.includes("?") ? "&" : "?";
      return `${url}${joiner}kvOverlay=${overlayCacheVersion}`;
    }
  };

  const createOverlay = () => {
    const wrapper = document.createElement("div");
    wrapper.className = "case-overlay";
    wrapper.hidden = true;
    wrapper.setAttribute("role", "dialog");
    wrapper.setAttribute("aria-modal", "true");
    wrapper.setAttribute("aria-labelledby", "case-overlay-title");

    wrapper.innerHTML = `
      <div class="case-overlay__backdrop" data-case-overlay-close></div>
      <div class="case-overlay__panel">
        <div class="case-overlay__header">
          <h2 class="case-overlay__title" id="case-overlay-title">Abbie at Heart | Equine Art</h2>
          <div class="case-overlay__header-actions">
            <a class="case-overlay__external-link" href="${artistCaseUrl}" data-case-overlay-ignore>Open full page</a>
            <button class="case-overlay__close" type="button" aria-label="Close case study" data-case-overlay-close>&times;</button>
          </div>
        </div>
        <div class="case-overlay__frame-wrap">
          <iframe class="case-overlay__frame" title="Abbie at Heart | Equine Art case study" loading="lazy"></iframe>
        </div>
      </div>
    `;

    document.body.appendChild(wrapper);

    wrapper.querySelectorAll("[data-case-overlay-close]").forEach((el) => {
      el.addEventListener("click", closeOverlay);
    });

    return wrapper;
  };

  const getOverlay = () => {
    if (!overlay) overlay = createOverlay();
    return overlay;
  };

  const normaliseText = (value) => String(value || "").replace(/\s+/g, " ").trim();

  const findTextMatch = (root, selector, pattern) => {
    return Array.from(root.querySelectorAll(selector)).find((el) => {
      return pattern.test(normaliseText(el.textContent));
    });
  };

  const isFrameElement = (doc, el) => {
    if (!el) return false;
    const win = doc.defaultView || doc.parentWindow;
    if (win && win.HTMLElement) return el instanceof win.HTMLElement;
    return el.nodeType === 1;
  };

  const getMenuButton = (doc) => {
    return (
      doc.querySelector(".abbie-menu-toggle") ||
      doc.querySelector("button.menu-toggle") ||
      doc.querySelector(".menu-toggle") ||
      doc.querySelector("button[aria-controls='abbie-menu']") ||
      doc.querySelector("button[aria-controls='site-menu']") ||
      findTextMatch(doc, "button, [role='button']", /menu/i)
    );
  };

  const applyArtistFramePolish = (frame) => {
    if (!(frame instanceof HTMLIFrameElement)) return;

    try {
      const doc = frame.contentDocument || frame.contentWindow?.document;
      if (!doc || !doc.documentElement || !doc.body) return;

      doc.body.classList.add("kv-embedded-in-case-overlay");

      if (!doc.getElementById("kv-overlay-abbie-menu-polish")) {
        const style = doc.createElement("style");
        style.id = "kv-overlay-abbie-menu-polish";
        style.textContent = `
          body.kv-embedded-in-case-overlay .kv-overlay-abbie-back-link {
            display: none !important;
          }

          body.kv-embedded-in-case-overlay .header-links {
            display: flex !important;
            align-items: center !important;
            justify-content: flex-end !important;
            gap: 14px !important;
          }

          body.kv-embedded-in-case-overlay .kv-overlay-abbie-menu-wrap {
            display: flex !important;
            flex-direction: column !important;
            align-items: flex-end !important;
            justify-content: flex-start !important;
            gap: 6px !important;
            margin-left: auto !important;
            position: relative !important;
            width: max-content !important;
            max-width: 100% !important;
          }

          body.kv-embedded-in-case-overlay .kv-overlay-abbie-menu-label {
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            min-height: 22px !important;
            padding: 3px 9px !important;
            border: 1px solid rgba(37, 99, 235, 0.24) !important;
            border-radius: 999px !important;
            background: rgba(37, 99, 235, 0.06) !important;
            color: #2563eb !important;
            font-size: 11px !important;
            line-height: 1.2 !important;
            font-weight: 800 !important;
            letter-spacing: 0.08em !important;
            text-transform: uppercase !important;
            margin: 0 !important;
            pointer-events: none !important;
            white-space: nowrap !important;
          }

          body.kv-embedded-in-case-overlay .kv-overlay-abbie-menu-toggle {
            margin: 0 !important;
            border-color: rgba(37, 99, 235, 0.35) !important;
            background: #ffffff !important;
            color: #0f172a !important;
            box-shadow: 0 4px 14px rgba(15, 23, 42, 0.06) !important;
          }

          body.kv-embedded-in-case-overlay .kv-overlay-abbie-menu-panel {
            right: 0 !important;
            left: auto !important;
            top: calc(100% + 8px) !important;
          }

          @media (max-width: 720px) {
            body.kv-embedded-in-case-overlay .header-links {
              align-items: stretch !important;
            }

            body.kv-embedded-in-case-overlay .kv-overlay-abbie-menu-wrap {
              align-items: stretch !important;
              width: 100% !important;
            }
          }
        `;
        doc.head.appendChild(style);
      }

      const backLink =
        doc.querySelector(".kv-home-link") ||
        findTextMatch(doc, "a, button", /kv\s*web\s*services/i);

      if (isFrameElement(doc, backLink)) {
        backLink.classList.add("kv-overlay-abbie-back-link");
        backLink.setAttribute("aria-hidden", "true");
        backLink.setAttribute("tabindex", "-1");
        backLink.style.setProperty("display", "none", "important");
      }

      const menuButton = getMenuButton(doc);
      if (!isFrameElement(doc, menuButton)) return;

      menuButton.classList.add("kv-overlay-abbie-menu-toggle");
      menuButton.setAttribute("aria-label", "Open Abbie at Heart website menu");
      menuButton.setAttribute("title", "Abbie at Heart website menu");
      menuButton.textContent = "☰ Abbie Menu";

      const controlledMenuId = menuButton.getAttribute("aria-controls");
      const controlledMenu = controlledMenuId ? doc.getElementById(controlledMenuId) : null;
      if (isFrameElement(doc, controlledMenu)) {
        controlledMenu.classList.add("kv-overlay-abbie-menu-panel");
      }

      let menuWrap = menuButton.closest(".kv-overlay-abbie-menu-wrap");
      if (!isFrameElement(doc, menuWrap)) {
        menuWrap = doc.createElement("div");
        menuWrap.className = "kv-overlay-abbie-menu-wrap";

        const originalParent = menuButton.parentElement;
        if (originalParent) {
          originalParent.insertBefore(menuWrap, menuButton);
          menuWrap.appendChild(menuButton);

          if (isFrameElement(doc, controlledMenu) && controlledMenu.parentElement === originalParent) {
            menuWrap.appendChild(controlledMenu);
          }
        }
      }

      if (!isFrameElement(doc, menuWrap)) return;

      menuWrap.style.setProperty("display", "flex", "important");
      menuWrap.style.setProperty("flex-direction", "column", "important");
      menuWrap.style.setProperty("align-items", "flex-end", "important");
      menuWrap.style.setProperty("gap", "6px", "important");
      menuWrap.style.setProperty("margin-left", "auto", "important");

      if (!menuWrap.querySelector(".kv-overlay-abbie-menu-label")) {
        const label = doc.createElement("span");
        label.className = "kv-overlay-abbie-menu-label";
        label.textContent = "Abbie website menu";
        menuWrap.insertBefore(label, menuButton);
      }
    } catch (error) {
      // If the iframe ever becomes cross-origin, the overlay still works normally.
    }
  };

  const runArtistFramePolish = (frame) => {
    applyArtistFramePolish(frame);
    window.setTimeout(() => applyArtistFramePolish(frame), 80);
    window.setTimeout(() => applyArtistFramePolish(frame), 250);
    window.setTimeout(() => applyArtistFramePolish(frame), 700);

    let attempts = 0;
    const interval = window.setInterval(() => {
      attempts += 1;
      applyArtistFramePolish(frame);
      if (attempts >= 12) window.clearInterval(interval);
    }, 300);
  };

  const bindFramePolish = (frame) => {
    if (!(frame instanceof HTMLIFrameElement)) return;
    if (frame.dataset.kvAbbiePolishBound === "true") return;

    frame.dataset.kvAbbiePolishBound = "true";
    frame.addEventListener("load", () => runArtistFramePolish(frame));
  };

  const openOverlay = (url = artistCaseUrl) => {
    const modal = getOverlay();
    const frame = modal.querySelector(".case-overlay__frame");
    const externalLink = modal.querySelector(".case-overlay__external-link");

    lastFocusedElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    if (frame instanceof HTMLIFrameElement) {
      bindFramePolish(frame);
      const iframeUrl = withOverlayCacheBust(url);

      if (frame.getAttribute("src") !== iframeUrl) {
        frame.setAttribute("src", iframeUrl);
      } else {
        runArtistFramePolish(frame);
      }
    }

    if (externalLink instanceof HTMLAnchorElement) {
      externalLink.href = url;
    }

    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("case-overlay-open");

    const closeButton = modal.querySelector(".case-overlay__close");
    if (closeButton instanceof HTMLButtonElement) {
      closeButton.focus({ preventScroll: true });
    }
  };

  function closeOverlay() {
    if (!overlay) return;
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("case-overlay-open");

    if (lastFocusedElement) {
      lastFocusedElement.focus({ preventScroll: true });
      lastFocusedElement = null;
    }
  }

  document.addEventListener("click", (event) => {
    if (isModifiedClick(event)) return;
    const target = event.target;
    if (!(target instanceof Element)) return;

    const ignoredLink = target.closest("[data-case-overlay-ignore]");
    if (ignoredLink) return;

    const link = target.closest("a[href]");
    if (!(link instanceof HTMLAnchorElement)) return;
    if (!isArtistCaseLink(link)) return;

    event.preventDefault();
    openOverlay(link.getAttribute("href") || artistCaseUrl);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && overlay && !overlay.hidden) {
      closeOverlay();
    }
  });
});
