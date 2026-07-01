/* ======================================================
   Equine Transport UK — Booking Flow (Client)
   Phase 2: Server Pricing
   Phase 3: Discount Engine (voucher codes)
   ====================================================== */

const DEBUG = false;

let IS_STRIPE_RETURN = false;

let STRIPE_FLOW_COMPLETED = false;

let activeSlideshow = null;

let PRESELECTED_VEHICLE = null;

let BLOCK_AUTO_SCROLL = false;

let LOCKED_VEHICLE = false;

let LAST_AVAILABLE_VEHICLES = [];

let AVAILABILITY_FLOW_LOCK = false;

let durationOptionsRunId = 0;
let hoverPreviewTimer = null;

/* ===============================
   Booking cache
================================ */

let BOOKINGS_CACHE = null;

let BOOKINGS_CACHE_AT = 0;
const BOOKINGS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

let BOOKINGS_VERSION = null;

let BOOKING_WATCH_IN_PROGRESS = false;

/* ======================================================
   Booking Step Controller
====================================================== */

let currentStep = 1;

/* ===============================
   Stripe checkout protection
================================ */

let checkoutLock = false;

/* ===============================
   Global performance locks
================================ */

let stripeReturnHandled = false;
let stripeReturnPromise = null;

let bookingsRequestPromise = null;
let calendarRenderPromise = null;
let pendingCalendarRender = false;
let calendarNavLock = false;

let currentDate = new Date();
currentDate.setDate(1);

const BOOKING_BY_SESSION_PROMISES = new Map();

let extrasRequestId = 0;

let IS_RESETTING = false;

const DAILY_AVAILABILITY_CACHE = new Map();
const DAILY_AVAILABILITY_TTL = 60 * 1000;

function goToStep(step) {
  currentStep = step;

  document.querySelectorAll(".booking-step").forEach((el) => {
    el.classList.remove("active");
  });

  const stepEl = document.getElementById(`step-${step}`);
  if (stepEl) stepEl.classList.add("active");

  document.querySelectorAll(".booking-steps .step").forEach((el) => {
    el.classList.remove("active");
  });

  const indicator = document.querySelector(
    `.booking-steps .step[data-step="${step}"]`,
  );
  if (indicator) indicator.classList.add("active");

  /* ===============================
     🔥 MOVE SUMMARY BETWEEN STEPS
  =============================== */

  const summary = document.getElementById("checkout-summary");

  if (summary) {
    let target = null;

    if (step === 3) {
      target = document.querySelector("#step-3 .summary-sticky-wrap");
    }

    if (step === 4) {
      target = document.querySelector("#step-4 #checkout-summary-container");
    }

    if (target && !target.contains(summary)) {
      target.appendChild(summary);
    }
  }

  /* ===============================
     🔥 STEP 3 SYNC (CRITICAL FIX)
  =============================== */

  if (step === 3) {
    const pickupDate = pickupDateInput?.value;
    const vehicleId = selectedAvailability?.vehicle?.id;
    const duration = Number(durationDaysInput?.value || 0);

    /* ===============================
       🔥 DURATION VALIDATION
    =============================== */

    if (pickupDate && vehicleId) {
      setTimeout(() => {
        // 1️⃣ normal availability logic
        updateBookingDurationOptions(pickupDate, vehicleId);

        // 2️⃣ 🔥 FORCE 7.5T RULE (FIXED TARGET)
        const vehicle = vehicles.find((v) => v.id === vehicleId);

        if (vehicle && !is35T(vehicle)) {
          const select = document.getElementById("selected-duration");

          if (select) {
            const half = select.querySelector('option[value="0.5"]');

            if (half) {
              showHalfDayAsUnavailable(half, pickupDate, vehicle);
            }

            if (select.value === "0.5") {
              select.value = "1";
            }
          }
        }
      }, 0);
    }

    /* ===============================
       HALF-DAY SYNC
    =============================== */

    if (pickupDate && vehicleId && duration === 0.5) {
      setTimeout(() => {
        syncBookingPickupTimeOptions(pickupDate, vehicleId);
      }, 0);
    }

    /* ===============================
       EARLY PICKUP SYNC
    =============================== */

    setTimeout(() => {
      updateEarlyPickupAvailability();
    }, 0);
  }

  /* ===============================
     AUTO SCROLL
  =============================== */

  if (step > 1) {
    setTimeout(() => {
      stepEl?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 100);
  }
}

function startBooking(vehicleId) {
  // ✅ Starting from a fleet card must always begin clean.
  // Prevents old date/duration/results/summary carrying over.
  if (typeof resetBookingFlow === "function") {
    resetBookingFlow();
  }

  PRESELECTED_VEHICLE = vehicleId;
  LOCKED_VEHICLE = true;

  const vehicle = vehicles.find((v) => v.id === vehicleId);

  // 🔥 Force duration rules immediately
  updateDurationOptionsForVehicle(vehicle);

  // 🔥 force re-selection (prevents wrong auto check)
  if (durationDaysInput) {
    durationDaysInput.value = "";
  }

  // 🔥 NEW — clear pickup time as well
  if (pickupTimeInput) {
    pickupTimeInput.value = "";
  }

  // 🔥 NEW — clear results (prevents false "not available")
  if (availabilityResults) {
    availabilityResults.innerHTML = "";
  }
  // 🔥 Remove half-day for 7.5T instantly
  enforceVehicleDurationRules(vehicle);

  updateCalendarVehicleLabel();

  selectedAvailability = null;

  if (selectedLorryInput) selectedLorryInput.value = vehicle?.name || "";
  if (selectedBaseInput) selectedBaseInput.value = "";

  const bookingSection = document.getElementById("booking");

  bookingSection?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });

  goToStep(1);

  setTimeout(() => {
    durationDaysInput?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    durationDaysInput?.classList.add("duration-highlight");

    setTimeout(() => {
      durationDaysInput?.classList.remove("duration-highlight");
    }, 1500);
  }, 200);

  // 🔥 Auto re-check availability if already filled
  const pickupDate = pickupDateInput?.value;
  const durationDays = Number(durationDaysInput?.value || 1);

  // ❌ DO NOT auto-submit when vehicle is preselected
  // user must choose duration first
}

/* ======================================================
   Operating Hours
====================================================== */

const OPENING_HOUR = 7;
const CLOSING_HOUR = 19;

// Storage + pricing constants
const STORAGE_BOOKINGS = "equinetransportuk_bookings";
const DARTFORD_CROSSING_PRICE = 4.2;
const EARLY_PICKUP_PRICE = 20;
const CONFIRMATION_FEE_35T = 75;
const CONFIRMATION_FEE_75T = 100;
const SECURITY_DEPOSIT_AMOUNT = 200;

// Time rules
const DEFAULT_PICKUP_TIME = "07:00";
const HALF_DAY_PICKUP_TIMES_35T = ["07:00", "13:00"];
const HALF_DAY_DROPOFF_TIMES_35T = { "07:00": "13:00", "13:00": "19:00" };
const FULL_DAY_DROPOFF_TIME = "19:00";

// Availability cache (quote results)
const AVAILABILITY_CACHE = new Map();
const AVAILABILITY_CACHE_TTL = 60 * 1000; // 60 seconds

/* ===============================
   Vehicle availability cache
================================ */

const VEHICLE_AVAILABILITY_CACHE = new Map();
const VEHICLE_AVAILABILITY_CACHE_TTL = 60 * 1000; // 60 seconds
const VEHICLE_AVAILABILITY_PROMISES = new Map();

/* ===============================
   Instant availability prefetch
================================ */

const RANGE_AVAILABILITY_CACHE = new Map();
const RANGE_AVAILABILITY_TTL = 60 * 1000;

const PREFETCH_WINDOW_DAYS = 0;
const PREFETCH_PROMISES = new Map();

function addDaysToDateStr(dateStr, days) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);

  const year = dt.getFullYear();
  const month = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function buildRangeAvailabilityKey(dateStr, duration, vehicleId = "") {
  return `${dateStr}|${Number(duration)}|${vehicleId || "any"}`;
}

function getRangeAvailabilityFromCache(dateStr, duration, vehicleId = "") {
  const key = buildRangeAvailabilityKey(dateStr, duration, vehicleId);
  const cached = RANGE_AVAILABILITY_CACHE.get(key);

  if (!cached) return null;
  if (Date.now() - cached.ts > RANGE_AVAILABILITY_TTL) {
    RANGE_AVAILABILITY_CACHE.delete(key);
    return null;
  }

  return cached.value;
}

function setRangeAvailabilityCache(dateStr, duration, vehicleId, value) {
  const key = buildRangeAvailabilityKey(dateStr, duration, vehicleId);
  RANGE_AVAILABILITY_CACHE.set(key, {
    value: !!value,
    ts: Date.now(),
  });
}

async function prefetchAvailabilityWindow(startDateStr) {
  if (!startDateStr || IS_STRIPE_RETURN) return;

  const cacheKey = `window:${startDateStr}`;
  if (PREFETCH_PROMISES.has(cacheKey)) {
    return PREFETCH_PROMISES.get(cacheKey);
  }

  const promise = (async () => {
    try {
      const jobs = [];

      for (let offset = 0; offset < PREFETCH_WINDOW_DAYS; offset++) {
        const dateStr = addDaysToDateStr(startDateStr, offset);

        /* ===============================
           MULTI-DAY PREFETCH (FIXED)
        =============================== */

        for (let duration = 1; duration <= 7; duration++) {
          jobs.push(
            getVehicleAvailability(dateStr, duration, null, {
              prefetch: true,
            }).then((vehiclesData) => {
              // ✅ ONLY cache per-vehicle truth
              for (const v of vehiclesData) {
                setRangeAvailabilityCache(
                  dateStr,
                  duration,
                  v.vehicleId,
                  !!v.available,
                );
              }

              // ❌ DO NOT cache "any vehicle" result
              // (this caused impossible durations earlier)
            }),
          );
        }

        /* ===============================
           HALF-DAY PREFETCH
        =============================== */

        jobs.push(
          getVehicleAvailability(dateStr, 0.5, "07:00", { prefetch: true }),
        );

        jobs.push(
          getVehicleAvailability(dateStr, 0.5, "13:00", { prefetch: true }),
        );
      }

      await Promise.allSettled(jobs);
    } catch (err) {
      console.warn("Prefetch window failed:", err);
    }
  })();

  PREFETCH_PROMISES.set(cacheKey, promise);

  try {
    await promise;
  } finally {
    PREFETCH_PROMISES.delete(cacheKey);
  }
}

/* ===============================
   Calendar cache
================================ */

// Duration price tables
const RATE_35T_TOTALS = {
  0.5: 75,
  1: 105,
  2: 200,
  3: 300,
  4: 400,
  5: 500,
  6: 600,
  7: 700,
};

const RATE_75_LIVING_TOTALS = {
  1: 175,
  2: 350,
  3: 525,
  4: 700,
  5: 875,
  6: 1050,
  7: 1225,
};

const DURATION_HOURS_35T = {
  0.5: 6,
  1: 12,
  2: 24,
  3: 36,
  4: 48,
  5: 60,
  6: 72,
  7: 84,
};

const DURATION_HOURS_75T = {
  1: 12,
  2: 24,
  3: 36,
  4: 48,
  5: 60,
  6: 72,
  7: 84,
};

// Stripe / links (fallback)
const STRIPE_PAYMENT_LINK_35T = "";
const STRIPE_PAYMENT_LINK_75T = "";
const OUTSTANDING_PAYMENT_LINK = "";
const DEPOSIT_PAYMENT_LINK = "";
const FORM_LINK_A =
  "https://koosverhagen.github.io/kvwebservices/equinetransportuk/forms/short-form.html";
const FORM_LINK_B =
  "https://koosverhagen.github.io/kvwebservices/equinetransportuk/forms/long-form.html";

const BACKEND_API_BASE =
  location.hostname === "127.0.0.1" || location.hostname === "localhost"
    ? "http://localhost:8787"
    : "https://equine-bookings-api.kverhagen.workers.dev";
// Fleet data
const vehicles = [
  {
    id: "v35-1",
    name: "3.5T Safety Bar Lorry",
    code: "LS23",
    type: "3.5 tonne",
    seats: 3,
    overnight: false,
    dayRate: 105,
    pricingModel: "35_duration_rules",
    summary:
      "Rear-facing 2-horse lorry with externally releasable safety breast bar, tack/changing room, horse/reverse cameras and ventilation.",
    image: "images/lorry-ls23.webp",
  },
  {
    id: "v35-2",
    name: "3.5T Stallion Lorry",
    code: "DL22",
    type: "3.5 tonne",
    horses: 2,
    seats: 3,
    overnight: false,
    dayRate: 105,
    pricingModel: "35_duration_rules",
    summary:
      "Back-facing 2-horse stallion layout with high partitions, no breast bar, horse/reverse cameras, roof vent and windows.",
    image: "images/lorry-DL22.webp",
  },
  {
    id: "v35-3",
    name: "3.5T Breast Bar Lorry",
    code: "CA21",
    type: "3.5 tonne",
    horses: 2,
    seats: 3,
    overnight: false,
    dayRate: 105,
    pricingModel: "35_duration_rules",
    summary:
      "Back-facing 2-horse lorry with adjustable breast bar, tack/changing room, horse/reverse cameras and roof ventilation.",
    image: "images/lorry-ca21.webp",
  },
  {
    id: "v75-1",
    name: "7.5T 3 Horse with Living",
    type: "7.5 tonne",
    horses: 3,
    seats: 3,
    overnight: true,
    dayRate: 175,
    pricingModel: "75_living_rules",
    summary:
      "High-end 3-horse 7.5T with living space, focused on comfort, reliability and practical long-day transport.",
    image: "images/lorry-75-living.webp",
  },
  {
    id: "v75-2",
    name: "7.5T 4 Horses No Living",
    type: "7.5 tonne",
    horses: 4,
    seats: 3,
    overnight: true,
    dayRate: 165,
    pricingModel: "75_no_living_rules",
    summary:
      "Practical 4-horse 7.5T with large tack area, built for functional multi-horse transport without living section.",
    image: "images/lorry-75-noliving.webp",
  },
];

window.vehicles = vehicles;

// DOM
const fleetGrid = document.getElementById("fleet-grid");
const availabilityForm = document.getElementById("availability-form");

const pickupDateInput = document.getElementById("pickup-date");
const pickupTimeInput = document.getElementById("pickup-time");
const durationDaysInput = document.getElementById("duration-days");

const notesInput = document.getElementById("customer-notes");

notesInput?.addEventListener("input", () => {
  updateCheckoutSummary();
});

/* ===============================
   INPUT CHANGE HANDLERS
=============================== */

durationDaysInput?.addEventListener("change", async () => {
  const pickupDate = pickupDateInput?.value;
  if (!pickupDate) return;

  await updateDurationOptions(pickupDate);

  updatePickupTimeVisibility();
  updateEarlyPickupAvailability();

  // 🔥 slight delay prevents double-trigger chain
  setTimeout(() => {
    maybeAutoSubmitAvailability();
  }, 50);
});

pickupTimeInput?.addEventListener("change", async () => {
  const pickupDate = pickupDateInput?.value;
  if (!pickupDate) return;

  /* ===============================
     SYNC UI (NO SIDE EFFECTS)
  =============================== */

  // 🔥 only sync if half-day
  if (Number(durationDaysInput?.value) === 0.5) {
    await syncPickupTimeOptions(pickupDate);
  }

  updateEarlyPickupAvailability();

  /* ===============================
     🔥 SINGLE CONTROLLED TRIGGER
  =============================== */

  setTimeout(() => {
    maybeAutoSubmitAvailability();
  }, 50);
});

const availabilityResults = document.getElementById("availability-results");
const startBookingBtn = document.getElementById("start-booking-btn");

startBookingBtn?.addEventListener("click", () => {
  resetBookingFlow();

  setTimeout(() => {
    document.getElementById("booking")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, 120);
});
const bookingForm = document.getElementById("booking-form");
const selectedLorryInput = document.getElementById("selected-lorry") || {
  value: "",
};
const selectedPickupInput = document.getElementById("selected-pickup");
const selectedDurationInput = document.getElementById("selected-duration");
const selectedBaseInput = document.getElementById("selected-base");

const customerNameInput = document.getElementById("customer-name");
const customerEmailInput = document.getElementById("customer-email");
if (customerEmailInput) {
  // Use text + email keyboard so browsers do not force lowercase display.
  // The pattern keeps normal email validation while preserving capitals as typed.
  customerEmailInput.setAttribute("type", "text");
  customerEmailInput.setAttribute("inputmode", "email");
  customerEmailInput.setAttribute("autocomplete", "email");
  customerEmailInput.setAttribute("autocapitalize", "sentences");
  customerEmailInput.setAttribute("autocorrect", "off");
  customerEmailInput.setAttribute("spellcheck", "false");
  customerEmailInput.setAttribute("pattern", "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");
  customerEmailInput.setAttribute("title", "Please enter a valid email address");
}
const customerMobileInput = document.getElementById("customer-mobile");
const customerAddressInput = document.getElementById("customer-address");
const customerDobInput = document.getElementById("customer-dob");

/* ===============================
   APPLE STYLE DATE PICKER
   Replaces the small native dropdown calendar for booking pickup dates.
   Keeps the real input value as YYYY-MM-DD so existing pricing/availability
   code continues to work unchanged.
================================ */

function formatApplePickerDisplay(value) {
  const date = parseLocalDateValue(value);
  if (!date) return "Choose date";

  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function parseLocalDateValue(value) {
  const parts = String(value || "").split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return null;
  }

  const [year, month, day] = parts;
  if (!year || !month || !day) return null;

  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

function localDateToValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function startOfLocalDay(date) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    0,
    0,
    0,
    0,
  );
}

function addMonthsLocal(date, amount) {
  const output = new Date(date);
  output.setDate(1);
  output.setMonth(output.getMonth() + amount);
  return output;
}

function sameLocalDay(a, b) {
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

let appleDatePickerState = null;

function ensureAppleDatePickerShell() {
  let shell = document.getElementById("apple-date-picker-shell");
  if (shell) return shell;

  shell = document.createElement("div");
  shell.id = "apple-date-picker-shell";
  shell.className = "apple-date-picker-shell hidden";
  shell.innerHTML = `
    <button class="apple-date-picker-backdrop" type="button" aria-label="Close date picker"></button>
    <section class="apple-date-picker-card" role="dialog" aria-modal="true" aria-labelledby="apple-date-picker-title">
      <div class="apple-date-picker-grabber" aria-hidden="true"></div>
      <div class="apple-date-picker-head">
        <div>
          <div class="apple-date-picker-kicker">Choose date</div>
          <h3 id="apple-date-picker-title">Pickup date</h3>
        </div>
        <button class="apple-date-picker-close" type="button" aria-label="Close">×</button>
      </div>

      <div class="apple-date-picker-monthbar">
        <button class="apple-date-picker-nav" type="button" data-apple-date-nav="prev" aria-label="Previous month">‹</button>
        <div class="apple-date-picker-month" aria-live="polite"></div>
        <button class="apple-date-picker-nav" type="button" data-apple-date-nav="next" aria-label="Next month">›</button>
      </div>

      <div class="apple-date-picker-weekdays" aria-hidden="true">
        <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
      </div>

      <div class="apple-date-picker-grid" role="grid"></div>

      <div class="apple-date-picker-actions">
        <button class="apple-date-picker-today" type="button">Today</button>
        <button class="apple-date-picker-done" type="button">Done</button>
      </div>
    </section>
  `;

  document.body.appendChild(shell);

  shell
    .querySelector(".apple-date-picker-backdrop")
    ?.addEventListener("click", closeAppleDatePicker);
  shell
    .querySelector(".apple-date-picker-close")
    ?.addEventListener("click", closeAppleDatePicker);
  shell
    .querySelector(".apple-date-picker-done")
    ?.addEventListener("click", closeAppleDatePicker);

  shell.querySelectorAll("[data-apple-date-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!appleDatePickerState) return;
      const direction = btn.dataset.appleDateNav === "prev" ? -1 : 1;
      appleDatePickerState.viewDate = addMonthsLocal(
        appleDatePickerState.viewDate,
        direction,
      );
      renderAppleDatePicker();
    });
  });

  shell
    .querySelector(".apple-date-picker-today")
    ?.addEventListener("click", () => {
      if (!appleDatePickerState) return;
      const today = startOfLocalDay(new Date());
      const minDate = appleDatePickerState.minDate;
      const maxDate = appleDatePickerState.maxDate;

      if (minDate && today < minDate) return;
      if (maxDate && today > maxDate) return;

      setAppleDatePickerValue(today);
    });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && appleDatePickerState) {
      closeAppleDatePicker();
    }
  });

  return shell;
}

function openAppleDatePicker(input, options = {}) {
  if (!input) return;

  const shell = ensureAppleDatePickerShell();
  const selected = parseLocalDateValue(input.value);
  const today = startOfLocalDay(new Date());

  const minDate = options.minDate || null;
  const maxDate = options.maxDate || null;

  let viewDate = selected || options.initialDate || today;
  if (minDate && viewDate < minDate) viewDate = minDate;
  if (maxDate && viewDate > maxDate) viewDate = maxDate;
  viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);

  appleDatePickerState = {
    input,
    trigger: input.__appleDateTrigger,
    title: options.title || "Choose date",
    selectedDate: selected,
    viewDate,
    minDate,
    maxDate,
  };

  shell.querySelector("#apple-date-picker-title").textContent =
    appleDatePickerState.title;

  renderAppleDatePicker();

  shell.classList.remove("hidden");
  document.body.classList.add("apple-date-picker-open");
}

function closeAppleDatePicker() {
  const shell = document.getElementById("apple-date-picker-shell");
  shell?.classList.add("hidden");
  document.body.classList.remove("apple-date-picker-open");

  const trigger = appleDatePickerState?.trigger;
  appleDatePickerState = null;
  trigger?.focus?.();
}

function renderAppleDatePicker() {
  if (!appleDatePickerState) return;

  const shell = ensureAppleDatePickerShell();
  const grid = shell.querySelector(".apple-date-picker-grid");
  const monthLabel = shell.querySelector(".apple-date-picker-month");
  if (!grid || !monthLabel) return;

  const view = appleDatePickerState.viewDate;
  const selected = appleDatePickerState.selectedDate;
  const today = startOfLocalDay(new Date());
  const minDate = appleDatePickerState.minDate;
  const maxDate = appleDatePickerState.maxDate;

  monthLabel.textContent = view.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });

  const firstOfMonth = new Date(view.getFullYear(), view.getMonth(), 1);
  const firstWeekday = (firstOfMonth.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(
    view.getFullYear(),
    view.getMonth() + 1,
    0,
  ).getDate();

  const cells = [];

  for (let i = 0; i < firstWeekday; i += 1) {
    cells.push('<span class="apple-date-picker-empty" aria-hidden="true"></span>');
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(view.getFullYear(), view.getMonth(), day);
    const disabled = (minDate && date < minDate) || (maxDate && date > maxDate);
    const iso = localDateToValue(date);

    const classes = ["apple-date-picker-day"];
    if (sameLocalDay(date, today)) classes.push("today");
    if (sameLocalDay(date, selected)) classes.push("selected");
    if (disabled) classes.push("disabled");

    cells.push(`
      <button
        class="${classes.join(" ")}"
        type="button"
        data-apple-date="${iso}"
        ${disabled ? "disabled" : ""}
        aria-label="${date.toLocaleDateString("en-GB", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        })}"
      >${day}</button>
    `);
  }

  grid.innerHTML = cells.join("");

  grid.querySelectorAll("[data-apple-date]").forEach((button) => {
    button.addEventListener("click", () => {
      const date = parseLocalDateValue(button.dataset.appleDate);
      if (date) setAppleDatePickerValue(date);
    });
  });
}

function setAppleDatePickerValue(date) {
  if (!appleDatePickerState?.input || !date) return;

  const input = appleDatePickerState.input;
  const previous = input.value;
  const next = localDateToValue(date);

  input.value = next;

  input.dispatchEvent(new Event("input", { bubbles: true }));

  if (previous !== next) {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  appleDatePickerState.selectedDate = date;
  updateAppleDateTrigger(input);
  closeAppleDatePicker();
}

function updateAppleDateTrigger(input) {
  const trigger = input?.__appleDateTrigger;
  if (!input || !trigger) return;

  const text = formatApplePickerDisplay(input.value);
  const hasDate = !!parseLocalDateValue(input.value);

  trigger.querySelector(".apple-date-trigger-text").textContent = text;
  trigger.classList.toggle("empty", !hasDate);
}

function attachAppleDatePicker(input, options = {}) {
  if (!input || input.__appleDatePickerAttached) return;

  input.__appleDatePickerAttached = true;

  const minDate = options.minToday ? startOfLocalDay(new Date()) : null;
  const maxDate = options.maxToday ? startOfLocalDay(new Date()) : null;

  input.classList.add("apple-date-source");
  input.setAttribute("autocomplete", "off");
  input.setAttribute("aria-hidden", "true");
  input.setAttribute("tabindex", "-1");

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "apple-date-trigger empty";
  trigger.setAttribute("aria-label", options.title || "Choose date");
  trigger.innerHTML = `
    <span class="apple-date-trigger-text">Choose date</span>
    <span class="apple-date-trigger-icon" aria-hidden="true">⌄</span>
  `;

  input.insertAdjacentElement("afterend", trigger);
  input.__appleDateTrigger = trigger;

  const valueDescriptor = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  );

  if (valueDescriptor?.get && valueDescriptor?.set) {
    Object.defineProperty(input, "value", {
      configurable: true,
      get() {
        return valueDescriptor.get.call(this);
      },
      set(nextValue) {
        valueDescriptor.set.call(this, nextValue);
        window.requestAnimationFrame(() => updateAppleDateTrigger(this));
      },
    });
  }

  trigger.addEventListener("click", () => {
    openAppleDatePicker(input, {
      title: options.title,
      minDate,
      maxDate,
    });
  });

  input.addEventListener("input", () => updateAppleDateTrigger(input));
  input.addEventListener("change", () => updateAppleDateTrigger(input));

  // Label clicks may still focus the source input; route them to the custom picker.
  input.addEventListener("focus", () => {
    openAppleDatePicker(input, {
      title: options.title,
      minDate,
      maxDate,
    });
  });

  updateAppleDateTrigger(input);
}

function initAppleStyleBookingDatePickers() {
  attachAppleDatePicker(pickupDateInput, {
    title: "Pickup date",
    minToday: true,
  });

  attachAppleDatePicker(selectedPickupInput, {
    title: "Pickup date",
    minToday: true,
  });
}

initAppleStyleBookingDatePickers();


/* ===============================
   CUSTOMER ADDRESS AUTOCOMPLETE
   Uses Worker Maps key endpoint
================================ */

const CUSTOMER_MAPS_KEY_ENDPOINT = `${BACKEND_API_BASE}/api/maps-key`;

let customerAddressAutocompleteStarted = false;
let customerAddressAutocompleteLoading = false;

function initCustomerAddressAutocomplete() {
  if (customerAddressAutocompleteStarted) return;
  if (!customerAddressInput) return;
  if (!window.google?.maps?.places?.Autocomplete) return;

  customerAddressAutocompleteStarted = true;

  const autocomplete = new google.maps.places.Autocomplete(
    customerAddressInput,
    {
      componentRestrictions: { country: "uk" },
      fields: ["formatted_address", "geometry", "name"],
    },
  );

  autocomplete.addListener("place_changed", () => {
    const place = autocomplete.getPlace();

    if (place?.formatted_address) {
      customerAddressInput.value = place.formatted_address;
    }
  });
}

window.__initEquineCustomerAddressAutocomplete =
  initCustomerAddressAutocomplete;

async function loadCustomerAddressAutocomplete() {
  if (!customerAddressInput) return;

  const params = new URLSearchParams(window.location.search);
  const isStripeReturnPage =
    params.get("checkout") === "success" ||
    params.has("session_id") ||
    params.has("outstanding");

  // ✅ On Stripe return/confirmation page we do not need address autocomplete.
  if (isStripeReturnPage) return;

  if (window.google?.maps?.places?.Autocomplete) {
    initCustomerAddressAutocomplete();
    return;
  }

  if (customerAddressAutocompleteLoading) return;
  customerAddressAutocompleteLoading = true;

  try {
    const existingScript = document.querySelector(
      'script[data-equine-address-autocomplete="true"]',
    );

    if (existingScript) return;

    const res = await fetch(CUSTOMER_MAPS_KEY_ENDPOINT, {
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`Maps key request failed: ${res.status}`);
    }

    const apiKey = (await res.text()).trim().replace(/^['"]|['"]$/g, "");

    if (!apiKey) {
      throw new Error("Maps API key is empty");
    }

    const script = document.createElement("script");
    script.dataset.equineAddressAutocomplete = "true";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey,
    )}&libraries=places&loading=async&callback=__initEquineCustomerAddressAutocomplete`;
    script.async = true;
    script.defer = true;

    document.head.appendChild(script);
  } catch (err) {
    customerAddressAutocompleteLoading = false;
    console.warn("Address autocomplete unavailable:", err);
  }
}

// Load/retry Google address suggestions when the address field is used.
["focus", "click", "input"].forEach((eventName) => {
  customerAddressInput?.addEventListener(
    eventName,
    () => {
      loadCustomerAddressAutocomplete();
    },
    { passive: true },
  );
});

const hiredWithin3MonthsInput = document.getElementById(
  "hired-within-3-months",
);
const dartfordEnabledInput = document.getElementById("dartford-enabled");
const dartfordCountInput = document.getElementById("dartford-count");
const earlyPickupEnabledInput = document.getElementById("early-pickup-enabled");

const earlyPickupCheckbox = document.getElementById("early-pickup-enabled");
/* ===============================
   🔥 EXTRAS CHANGE → REPRICE
=============================== */

[dartfordEnabledInput, dartfordCountInput, earlyPickupEnabledInput].forEach(
  (input) => {
    input?.addEventListener("change", refreshPricingWithExtras);
  },
);

async function refreshPricingWithExtras() {
  if (!selectedAvailability) return;

  const summary = document.getElementById("checkout-summary");

  // ✨ START loading state
  summary?.classList.add("loading");

  const requestId = ++extrasRequestId;

  AVAILABILITY_CACHE.clear();

  const vehicle = selectedAvailability.vehicle;

  try {
    const updated = await buildAvailability(
      vehicle,
      selectedAvailability.pickupDate,
      selectedAvailability.durationDays,
      selectedAvailability.pickupTime,
      getCurrentDiscountCode(),
    );

    if (requestId !== extrasRequestId) return;

    selectedAvailability = updated;

    updateCheckoutSummary();
  } catch (err) {
    if (requestId === extrasRequestId) {
      console.warn("Pricing update failed:", err);
    }
  } finally {
    // ✨ END loading state
    summary?.classList.remove("loading");
  }
}

const checkoutSummary = document.getElementById("checkout-summary");
const bookingSubmitBtn = document.getElementById("booking-submit");
const bookingSuccess = document.getElementById("booking-success");

const bookingList = document.getElementById("booking-list");
const adminBookings = document.getElementById("admin-bookings");
const refreshAdminBtn = document.getElementById("refresh-admin");
const exportAdminCsvBtn = document.getElementById("export-admin-csv");
const exportAdminPdfBtn = document.getElementById("export-admin-pdf");
const clearAdminBtn = document.getElementById("clear-admin");

const applyDiscountBtn = document.getElementById("apply-discount");
const discountMessage = document.getElementById("discount-message");

let selectedAvailability = null;

/* ===============================
   Required form auto-detection
   Source of truth is the Worker.
   Short form is only shown when the backend finds a previous hire
   for this customer within 90 days of the selected pickup date.
================================ */

const REQUIRED_FORM_STATE = {
  key: "",
  type: "long",
  loading: false,
  checked: false,
  reason: "default",
};

let requiredFormCheckTimer = null;

function normaliseRequiredFormType(value) {
  return String(value || "")
    .trim()
    .toLowerCase() === "short"
    ? "short"
    : "long";
}

function getCurrentRequiredFormType() {
  return normaliseRequiredFormType(
    REQUIRED_FORM_STATE.type || selectedAvailability?.requiredFormType || "long",
  );
}

function getCurrentRequiredFormLabel() {
  if (REQUIRED_FORM_STATE.loading) {
    return "Checking automatically…";
  }

  return getCurrentRequiredFormType() === "short"
    ? "Short Form"
    : "Long Form";
}

function setDetectedRequiredFormType(type, reason = "auto") {
  const normalised = normaliseRequiredFormType(type);

  REQUIRED_FORM_STATE.type = normalised;
  REQUIRED_FORM_STATE.loading = false;
  REQUIRED_FORM_STATE.checked = true;
  REQUIRED_FORM_STATE.reason = reason;

  // Legacy compatibility: older code used this checkbox if present.
  if (hiredWithin3MonthsInput) {
    hiredWithin3MonthsInput.checked = normalised === "short";
  }

  if (selectedAvailability) {
    selectedAvailability.requiredFormType = normalised;
  }

  return normalised;
}

function buildRequiredFormCheckKey() {
  const email = String(customerEmailInput?.value || "")
    .trim()
    .toLowerCase();

  const mobile = String(customerMobileInput?.value || "").trim();

  const pickupDate =
    selectedPickupInput?.value ||
    selectedAvailability?.pickupDate ||
    pickupDateInput?.value ||
    "";

  return `${email}|${mobile}|${pickupDate}`;
}

async function checkRequiredFormRequirement({ force = false } = {}) {
  const email = String(customerEmailInput?.value || "")
    .trim()
    .toLowerCase();

  const mobile = String(customerMobileInput?.value || "").trim();

  const pickupDate =
    selectedPickupInput?.value ||
    selectedAvailability?.pickupDate ||
    pickupDateInput?.value ||
    "";

  const key = buildRequiredFormCheckKey();

  if (!email && !mobile) {
    REQUIRED_FORM_STATE.key = key;
    setDetectedRequiredFormType("long", "missing_customer_contact");
    updateCheckoutSummary();
    return getCurrentRequiredFormType();
  }

  if (!pickupDate) {
    REQUIRED_FORM_STATE.key = key;
    setDetectedRequiredFormType("long", "missing_pickup_date");
    updateCheckoutSummary();
    return getCurrentRequiredFormType();
  }

  if (!force && REQUIRED_FORM_STATE.checked && REQUIRED_FORM_STATE.key === key) {
    return getCurrentRequiredFormType();
  }

  REQUIRED_FORM_STATE.key = key;
  REQUIRED_FORM_STATE.loading = true;
  updateCheckoutSummary();

  try {
    const url = new URL(`${BACKEND_API_BASE}/api/bookings/form-requirement`);
    url.searchParams.set("pickupDate", pickupDate);
    url.searchParams.set("_", String(Date.now()));

    if (email) url.searchParams.set("email", email);
    if (mobile) url.searchParams.set("mobile", mobile);

    const res = await fetch(url.toString());
    const data = await res.json().catch(() => ({}));

    if (!res.ok || data?.ok === false) {
      throw new Error(data?.error || `Form check failed: ${res.status}`);
    }

    const type = setDetectedRequiredFormType(
      data.requiredFormType || data.formType || "long",
      data.reason || "backend",
    );

    updateCheckoutSummary();
    return type;
  } catch (err) {
    console.warn("Required form auto-detection failed:", err);

    // Safe fallback: use the full long form if the check cannot run.
    const type = setDetectedRequiredFormType("long", "fallback_error");
    updateCheckoutSummary();
    return type;
  }
}

function scheduleRequiredFormCheck(delay = 450) {
  clearTimeout(requiredFormCheckTimer);

  requiredFormCheckTimer = setTimeout(() => {
    checkRequiredFormRequirement().catch((err) => {
      console.warn("Required form scheduled check failed:", err);
    });
  }, delay);
}

let BOOKING_WEEKEND_HALF_DAY_NOTICE = false;

/* ===============================
   Next available date button
================================ */

availabilityResults?.addEventListener("click", async (e) => {
  /* ===============================
     NEXT AVAILABLE DATE
  =============================== */

  const nextBtn = e.target.closest(".next-date-btn");
  if (nextBtn) {
    const date = nextBtn.dataset.date;
    if (!date) return;

    // 🔒 prevent double clicks
    if (nextBtn.dataset.loading === "true") return;
    nextBtn.dataset.loading = "true";

    try {
      await selectDate(date);

      // ✅ trigger availability AFTER state is correct
      maybeAutoSubmitAvailability();
    } finally {
      nextBtn.dataset.loading = "false";
    }

    return;
  }

  /* ===============================
     SELECT LORRY
  =============================== */

  const chooseBtn = e.target.closest(".choose-lorry");
  if (chooseBtn) {
    const vehicleId = chooseBtn.dataset.vehicleId;
    if (!vehicleId) return;

    // 🔒 prevent double clicks
    if (chooseBtn.dataset.loading === "true") return;
    chooseBtn.dataset.loading = "true";

    try {
      await selectAvailability(vehicleId);
      goToStep(3);
    } finally {
      chooseBtn.dataset.loading = "false";
    }
  }
});
/* ======================================================
   Helpers
====================================================== */

function ensureDateVisible(dateStr) {
  if (!dateStr) return;

  const [y, m] = dateStr.split("-");

  const current = window.__calendarState.currentDate;

  const currentY = current.getFullYear();
  const currentM = current.getMonth() + 1;

  if (Number(y) !== currentY || Number(m) !== currentM) {
    window.__calendarState.currentDate = new Date(Number(y), Number(m) - 1, 1); // ✅ use setter
  }
}

async function updateBookingDurationOptions(dateStr, vehicleId) {
  const select = document.getElementById("selected-duration");
  if (!select || !dateStr || !vehicleId) return;

  const vehicle = vehicles.find((v) => v.id === vehicleId);
  const hideHalfDay = vehicle
    ? shouldHideHalfDayForDateAndVehicle(dateStr, vehicle)
    : false;

  const options = Array.from(select.options);

  for (const opt of options) {
    const duration = Number(opt.value);
    if (!duration) continue;

    let available = false;

    /* ===============================
       🔥 HARD BLOCK: 7.5T HALF DAY
    =============================== */

    if (hideHalfDay && duration === 0.5) {
      available = false;
    } else if (duration === 0.5) {
      const { amData, pmData } = await getHalfDayAvailability(dateStr);

      const hasAM = amData.some(
        (v) =>
          v.vehicleId === vehicleId &&
          (v.available || v.availableSlots?.includes("am")),
      );

      const hasPM = pmData.some(
        (v) =>
          v.vehicleId === vehicleId &&
          (v.available || v.availableSlots?.includes("pm")),
      );

      available = hasAM || hasPM;
    } else {
      available = await isContinuousRangeAvailable(
        dateStr,
        duration,
        vehicleId,
        null,
      );
    }

    opt.disabled = !available;
    opt.style.color = available ? "" : "#999";

    /* ===============================
       🔥 FORCE HIDE 7.5T HALF DAY
    =============================== */

    if (duration === 0.5) {
      if (hideHalfDay || !available) {
        showHalfDayAsUnavailable(opt, dateStr, vehicle);
      } else {
        showHalfDayAsAvailable(opt);
      }
    }
  }

  /* ===============================
     FIX INVALID SELECTED VALUE
  =============================== */

  const selected = Number(select.value);

  if (selected) {
    const selectedOption = options.find((o) => Number(o.value) === selected);
    if (selectedOption?.disabled) {
      select.value = hideHalfDay ? "1" : "";
    }
  }

  /* ===============================
   🔥 FINAL SAFETY LOCK
   7.5T always blocked.
   3.5T weekend half-day blocked.
=============================== */

  if (hideHalfDay) {
    const half = select.querySelector('option[value="0.5"]');

    if (half) {
      showHalfDayAsUnavailable(half, dateStr, vehicle);
    }

    if (select.value === "0.5") {
      select.value = "1";
    }
  }
}

function applyBookingWeekendHalfDayRule(dateStr, vehicle, showNotice = false) {
  const select = document.getElementById("selected-duration");
  const statusEl = document.getElementById("booking-availability-status");
  const pickupRow = document.getElementById("pickup-time-row");

  if (!select || !dateStr || !vehicle) return false;

  const hideHalfDay = shouldHideHalfDayForDateAndVehicle(dateStr, vehicle);
  const half = select.querySelector('option[value="0.5"]');

  if (!half) return false;

  const wasHalfDay = select.value === "0.5";

  if (hideHalfDay) {
    showHalfDayAsUnavailable(half, dateStr, vehicle);

    if (wasHalfDay) {
      select.value = "1";

      if (is35T(vehicle) && isWeekendDate(dateStr)) {
        BOOKING_WEEKEND_HALF_DAY_NOTICE = true;
      }

      if (pickupRow) {
        pickupRow.style.display = "none";
      }

      if (selectedAvailability) {
        selectedAvailability.durationDays = 1;
        selectedAvailability.pickupTime = DEFAULT_PICKUP_TIME;
      }

      if (statusEl && showNotice) {
        statusEl.textContent = is35T(vehicle)
          ? "No 1/2 day hires are available during weekends. Duration has been changed to 1 day."
          : "No 1/2 day hires are available for 7.5T lorries. Duration has been changed to 1 day.";

        statusEl.className = "availability-status error full";
        statusEl.hidden = false;
      }

      updateHalfDayPickup();
      updateCheckoutSummary();

      return true;
    }

    return false;
  }

  showHalfDayAsAvailable(half);
  BOOKING_WEEKEND_HALF_DAY_NOTICE = false;

  return false;
}

function getWeekendHalfDayNotice(dateStr, vehicle) {
  if (!dateStr || !vehicle) return "";

  if (!shouldHideHalfDayForDateAndVehicle(dateStr, vehicle)) {
    return "";
  }

  if (!is35T(vehicle)) {
    return " No 1/2 day hires are available for 7.5T lorries.";
  }

  return " No 1/2 day hires are available during weekends.";
}

function safeRenderAvailability(html) {
  if (!availabilityResults) return;

  /* ===============================
     🔥 BLOCK DURING STRIPE RETURN
  =============================== */

  if (IS_STRIPE_RETURN) {
    if (window.DEBUG_RENDER) {
      console.log("⛔ UI render blocked (Stripe return)");
    }
    return;
  }

  /* ===============================
     🔥 PREVENT UNNECESSARY RE-RENDER
  =============================== */

  if (availabilityResults.innerHTML === html) {
    return;
  }

  /* ===============================
     ✅ ACTUAL RENDER (FIXED)
  =============================== */

  availabilityResults.innerHTML = html;
}

/* ===============================
   AVAILABILITY AUTO-SUBMIT SCHEDULER
   prevents duplicate requestSubmit() spam
=============================== */

let availabilityAutoSubmitTimer = null;
let lastAvailabilityAutoSubmitKey = "";

function buildAvailabilitySubmitKey() {
  const pickupDate = pickupDateInput?.value || "";
  const duration = String(durationDaysInput?.value || "");
  const pickupTime =
    Number(durationDaysInput?.value || 0) === 0.5
      ? pickupTimeInput?.value || ""
      : "";

  return [pickupDate, duration, pickupTime, PRESELECTED_VEHICLE || ""].join(
    "|",
  );
}

function scheduleAvailabilityAutoSubmit(delay = 120) {
  if (IS_STRIPE_RETURN) return;

  if (!availabilityForm) return;

  const nextKey = buildAvailabilitySubmitKey();

  // nothing meaningful changed
  if (nextKey === lastAvailabilityAutoSubmitKey) {
    return;
  }

  clearTimeout(availabilityAutoSubmitTimer);

  availabilityAutoSubmitTimer = setTimeout(() => {
    const currentKey = buildAvailabilitySubmitKey();

    // state changed again while waiting
    if (currentKey !== nextKey) return;

    lastAvailabilityAutoSubmitKey = currentKey;
    availabilityForm.requestSubmit();
  }, delay);
}

function resetAvailabilityAutoSubmitState() {
  clearTimeout(availabilityAutoSubmitTimer);
  availabilityAutoSubmitTimer = null;
  lastAvailabilityAutoSubmitKey = "";
}

function maybeAutoSubmitAvailability() {
  if (AVAILABILITY_FLOW_LOCK) return;
  if (IS_STRIPE_RETURN || STRIPE_FLOW_COMPLETED) return;
  if (!availabilityForm) return;

  const pickupDate = pickupDateInput?.value;
  const duration = Number(durationDaysInput?.value || 0);
  const pickupTime = pickupTimeInput?.value || "";

  if (!pickupDate || !duration) return;

  // half-day requires time
  if (duration === 0.5 && !pickupTime) return;

  AVAILABILITY_FLOW_LOCK = true;

  try {
    scheduleAvailabilityAutoSubmit(120);
  } finally {
    setTimeout(() => {
      AVAILABILITY_FLOW_LOCK = false;
    }, 150);
  }
}

async function getVehicleAvailability(
  dateStr,
  duration,
  pickupTime = null,
  opts = {},
) {
  const forceFresh = opts?.forceFresh === true;
  const cacheKey = `${dateStr}|${duration}|${pickupTime || "any"}`;

  /* ===============================
     🔥 FORCE-FRESH MODE
     Used before checkout so stale cache cannot allow
     a booking that the server will reject.
  =============================== */

  if (forceFresh) {
    VEHICLE_AVAILABILITY_CACHE.delete(cacheKey);
    VEHICLE_AVAILABILITY_PROMISES.delete(cacheKey);
  }

  /* ===============================
     CACHE HIT
  =============================== */

  if (!forceFresh) {
    const cached = VEHICLE_AVAILABILITY_CACHE.get(cacheKey);

    if (cached && Date.now() - cached.ts < VEHICLE_AVAILABILITY_CACHE_TTL) {
      return cached.value;
    }

    if (VEHICLE_AVAILABILITY_PROMISES.has(cacheKey)) {
      return VEHICLE_AVAILABILITY_PROMISES.get(cacheKey);
    }
  }

  /* ===============================
     FETCH LIVE
  =============================== */

  const promise = (async () => {
    try {
      const url = new URL(`${BACKEND_API_BASE}/api/vehicles/available`);
      url.searchParams.set("date", dateStr);
      url.searchParams.set("duration", duration);
      url.searchParams.set("_", String(Date.now()));

      if (pickupTime) {
        url.searchParams.set("pickupTime", pickupTime);
      }

      const res = await fetch(url, { cache: "no-store" });

      if (!res.ok) {
        throw new Error(`Availability failed: ${res.status}`);
      }

      const data = await res.json();
      const vehicles = data.vehicles || [];

      VEHICLE_AVAILABILITY_CACHE.set(cacheKey, {
        value: vehicles,
        ts: Date.now(),
      });

      return vehicles;
    } catch (err) {
      console.warn("Vehicle availability failed:", err);

      if (!forceFresh) {
        VEHICLE_AVAILABILITY_CACHE.set(cacheKey, {
          value: [],
          ts: Date.now(),
        });
      }

      return [];
    }
  })();

  if (!forceFresh) {
    VEHICLE_AVAILABILITY_PROMISES.set(cacheKey, promise);
  }

  try {
    return await promise;
  } finally {
    VEHICLE_AVAILABILITY_PROMISES.delete(cacheKey);
  }
}

const HALF_DAY_CACHE = new Map();
const HALF_DAY_CACHE_TTL = 60 * 1000; // 60s

function clearAvailabilityCaches() {
  AVAILABILITY_CACHE.clear();
  VEHICLE_AVAILABILITY_CACHE.clear();
  VEHICLE_AVAILABILITY_PROMISES.clear();
  RANGE_AVAILABILITY_CACHE.clear();
  HALF_DAY_CACHE.clear();

  LAST_AVAILABLE_VEHICLES = [];
  window.__lastDurationCheck = "";
}

async function getHalfDayAvailability(dateStr) {
  /* ===============================
     🔥 HARD BLOCK (CRITICAL FIX)
  =============================== */

  if (IS_STRIPE_RETURN) {
    return { amData: [], pmData: [] };
  }

  if (!dateStr) {
    return { amData: [], pmData: [] };
  }

  const now = Date.now();

  /* ===============================
     ✅ CACHE HIT
  =============================== */

  const cached = HALF_DAY_CACHE.get(dateStr);

  if (cached && now - cached.ts < HALF_DAY_CACHE_TTL) {
    return cached.data;
  }

  /* ===============================
     🔄 FETCH (PARALLEL)
  =============================== */

  try {
    const [amData, pmData] = await Promise.all([
      getVehicleAvailability(dateStr, 0.5, "07:00"),
      getVehicleAvailability(dateStr, 0.5, "13:00"),
    ]);

    /* ===============================
       🔥 STOP IF STRIPE STARTED MID-FETCH
    =============================== */

    if (IS_STRIPE_RETURN) {
      return { amData: [], pmData: [] };
    }

    const result = { amData, pmData };

    /* ===============================
       🔥 DO NOT CACHE DURING STRIPE
    =============================== */

    HALF_DAY_CACHE.set(dateStr, {
      data: result,
      ts: now,
    });

    return result;
  } catch (err) {
    console.warn("Half-day availability failed:", err);

    return { amData: [], pmData: [] };
  }
}

function isHalfDayAvailable(dateStr, vehicleId, bookings, pickupTime) {
  const requestedSlot = pickupTime === "13:00" ? "pm" : "am";

  for (const booking of bookings) {
    if (booking.vehicleId !== vehicleId) continue;

    const bookingDates = getDatesBetween(
      new Date(booking.pickupAt),
      new Date(booking.dropoffAt),
    );

    if (!bookingDates.includes(dateStr)) continue;

    const bookedSlot =
      Number(booking.durationDays) === 0.5
        ? booking.pickupTime === "13:00"
          ? "pm"
          : "am"
        : "full";

    if (bookedSlot === "full" || bookedSlot === requestedSlot) {
      return false;
    }
  }

  return true;
}

async function updateDurationOptions(dateStr) {
  if (!durationDaysInput || !dateStr) return;

  const thisRunId = ++durationOptionsRunId;

  const vehicleId =
    PRESELECTED_VEHICLE || selectedAvailability?.vehicle?.id || null;

  const selectedVehicle = vehicleId
    ? vehicles.find((v) => v.id === vehicleId)
    : null;

  const pickupTime = pickupTimeInput?.value || "";

  /* ===============================
     SMART SKIP
  =============================== */

  const cacheKey = `${dateStr}|${vehicleId || "any"}|${pickupTime}`;

  if (cacheKey === window.__lastDurationCheck) return;
  window.__lastDurationCheck = cacheKey;

  const options = Array.from(durationDaysInput.options);

  for (const opt of options) {
    if (thisRunId !== durationOptionsRunId) return;

    const duration = Number(opt.value);
    if (!duration) continue;

    let available = false;

    /* ===============================
       HALF DAY
    =============================== */

    if (duration === 0.5) {
      const hideHalfDay =
        selectedVehicle &&
        shouldHideHalfDayForDateAndVehicle(dateStr, selectedVehicle);

      const weekendWithoutVehicle = !selectedVehicle && isWeekendDate(dateStr);

      if (hideHalfDay || weekendWithoutVehicle) {
        available = false;
      } else {
        const { amData, pmData } = await getHalfDayAvailability(dateStr);

        const filteredAM = (
          vehicleId ? amData.filter((v) => v.vehicleId === vehicleId) : amData
        ).filter((v) => is35T(vehicles.find((x) => x.id === v.vehicleId)));

        const filteredPM = (
          vehicleId ? pmData.filter((v) => v.vehicleId === vehicleId) : pmData
        ).filter((v) => is35T(vehicles.find((x) => x.id === v.vehicleId)));

        const hasAM = filteredAM.some(
          (v) => v.available || v.availableSlots?.includes("am"),
        );

        const hasPM = filteredPM.some(
          (v) => v.available || v.availableSlots?.includes("pm"),
        );

        available = hasAM || hasPM;
      }
    } else {
      /* ===============================
         MULTI-DAY
      =============================== */

      const cached = getRangeAvailabilityFromCache(
        dateStr,
        duration,
        vehicleId,
      );

      if (cached !== null) {
        available = cached;
      } else if (vehicleId) {
        available = await isContinuousRangeAvailable(
          dateStr,
          duration,
          vehicleId,
          null,
        );
      } else {
        let hasValidVehicle = false;

        for (const v of vehicles) {
          const ok = await isContinuousRangeAvailable(
            dateStr,
            duration,
            v.id,
            null,
          );

          if (ok) {
            hasValidVehicle = true;
            break;
          }
        }

        available = hasValidVehicle;
      }
    }

    opt.disabled = !available;
    opt.style.color = available ? "" : "#999";

    if (duration === 0.5) {
      if (available) {
        showHalfDayAsAvailable(opt);
      } else {
        showHalfDayAsUnavailable(opt, dateStr, selectedVehicle);
      }
    }
  }

  /* ===============================
     VALIDATE SELECTED VALUE
  =============================== */

  const selected = Number(durationDaysInput.value);

  if (selected) {
    const selectedOption = options.find((o) => Number(o.value) === selected);
    if (selectedOption?.disabled) {
      durationDaysInput.value = "";
    }
  }

  if (thisRunId !== durationOptionsRunId) return;

  /* ===============================
     HALF-DAY SYNC
  =============================== */

  if (Number(durationDaysInput?.value) === 0.5) {
    await syncPickupTimeOptions(dateStr);
  }
}

async function syncBookingPickupTimeOptions(dateStr, vehicleId) {
  const select = document.getElementById("booking-pickup-time");
  if (!select || !dateStr || !vehicleId) return;

  try {
    const { amData, pmData } = await getHalfDayAvailability(dateStr);

    const amVehicle = amData.find((v) => v.vehicleId === vehicleId);
    const pmVehicle = pmData.find((v) => v.vehicleId === vehicleId);

    const hasAM =
      amVehicle?.available || (amVehicle?.availableSlots || []).includes("am");

    const hasPM =
      pmVehicle?.available || (pmVehicle?.availableSlots || []).includes("pm");

    const morningAvailable = !!hasAM;
    const afternoonAvailable = !!hasPM;

    const morningOption = select.querySelector('option[value="07:00"]');
    const afternoonOption = select.querySelector('option[value="13:00"]');

    if (morningOption) {
      morningOption.disabled = !morningAvailable;
      morningOption.style.color = morningAvailable ? "" : "#999";
    }

    if (afternoonOption) {
      afternoonOption.disabled = !afternoonAvailable;
      afternoonOption.style.color = afternoonAvailable ? "" : "#999";
    }

    // auto-fix selection
    if (select.value === "07:00" && !morningAvailable && afternoonAvailable) {
      select.value = "13:00";
    }

    if (select.value === "13:00" && !afternoonAvailable && morningAvailable) {
      select.value = "07:00";
    }

    if (!morningAvailable && !afternoonAvailable) {
      select.value = "";
    }
  } catch (err) {
    console.warn("Booking pickup sync failed:", err);
  }
}

function getLondonHour(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);

  return Number(parts.find((p) => p.type === "hour")?.value || 0);
}

function getLondonParts(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type)?.value || "";

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

function datePartsFromDateStr(dateStr) {
  const [year, month, day] = String(dateStr).split("-").map(Number);
  if (!year || !month || !day) return null;
  return { year, month, day };
}

function startOfDayFromDateStr(dateStr) {
  const p = datePartsFromDateStr(dateStr);
  if (!p) return new Date(NaN);
  return new Date(p.year, p.month - 1, p.day, 0, 0, 0, 0);
}

function endOfDayFromDateStr(dateStr) {
  const p = datePartsFromDateStr(dateStr);
  if (!p) return new Date(NaN);
  return new Date(p.year, p.month - 1, p.day, 23, 59, 59, 999);
}

/* =================================
   HALF DAY SLOT AVAILABILITY
================================ */

async function getRemainingHalfDaySlots(dateStr) {
  if (!dateStr) {
    return {
      morningAvailable: false,
      afternoonAvailable: false,
    };
  }

  try {
    const { amData, pmData } = await getHalfDayAvailability(dateStr);

    const filteredAM = (
      PRESELECTED_VEHICLE
        ? amData.filter((v) => v.vehicleId === PRESELECTED_VEHICLE)
        : amData
    ).filter((v) => {
      const vehicle = vehicles.find((x) => x.id === v.vehicleId);
      return is35T(vehicle);
    });

    const filteredPM = (
      PRESELECTED_VEHICLE
        ? pmData.filter((v) => v.vehicleId === PRESELECTED_VEHICLE)
        : pmData
    ).filter((v) => {
      const vehicle = vehicles.find((x) => x.id === v.vehicleId);
      return is35T(vehicle);
    });

    const morningAvailable = filteredAM.some(
      (v) =>
        v.available || (v.availableSlots && v.availableSlots.includes("am")),
    );

    const afternoonAvailable = filteredPM.some(
      (v) =>
        v.available || (v.availableSlots && v.availableSlots.includes("pm")),
    );
    return { morningAvailable, afternoonAvailable };
  } catch (err) {
    console.warn("Half-day slot check failed:", err);

    return {
      morningAvailable: false,
      afternoonAvailable: false,
    };
  }
}

function updateEarlyPickupAvailability() {
  const duration = Number(
    selectedDurationInput?.value || durationDaysInput?.value || 1,
  );

  const bookingTime = document.getElementById("booking-pickup-time")?.value;

  const pickupTime =
    bookingTime ||
    pickupTimeInput?.value ||
    selectedAvailability?.pickupTime ||
    "07:00";

  if (DEBUG) {
    console.log("EarlyPickupCheck:", { duration, pickupTime });
  }

  const isMorning = pickupTime === "07:00";

  const canUseEarlyPickup = isMorning;

  if (!earlyPickupCheckbox) return;

  const label = earlyPickupCheckbox.closest("label");
  const textSpan = label?.querySelector("span:last-child");

  if (!canUseEarlyPickup) {
    earlyPickupCheckbox.checked = false;
    earlyPickupCheckbox.disabled = true;

    if (textSpan) {
      textSpan.innerText = "Early pickup only available for morning bookings.";
    }
  } else {
    earlyPickupCheckbox.disabled = false;

    if (textSpan) {
      textSpan.innerText = "Early pickup (+£20)";
    }
  }
}

/* =================================
   DISABLE AM / PM OPTIONS
================================ */

async function syncPickupTimeOptions(dateStr) {
  if (!pickupTimeInput || !durationDaysInput) return;

  /* ===============================
     🔥 NORMALISE DATE (CRITICAL FIX)
  =============================== */

  if (dateStr instanceof Date) {
    const year = dateStr.getFullYear();
    const month = String(dateStr.getMonth() + 1).padStart(2, "0");
    const day = String(dateStr.getDate()).padStart(2, "0");
    dateStr = `${year}-${month}-${day}`;
  }

  const duration = Number(durationDaysInput.value || 0);

  const morningOption = pickupTimeInput.querySelector('option[value="07:00"]');
  const afternoonOption = pickupTimeInput.querySelector(
    'option[value="13:00"]',
  );

  /* ===============================
     AUTO RESOLVE DATE
  =============================== */

  if (!dateStr) {
    dateStr = pickupDateInput?.value;
    if (!dateStr) return;
  }

  /* ===============================
     FULL DAY
  =============================== */

  if (duration !== 0.5) {
    if (morningOption) {
      morningOption.disabled = false;
      morningOption.style.color = "";
    }

    if (afternoonOption) {
      afternoonOption.disabled = true;
      afternoonOption.style.color = "#999";
    }

    // 🔥 ONLY update if needed
    if (pickupTimeInput.value !== "07:00") {
      pickupTimeInput.value = "07:00";
    }

    return;
  }

  /* ===============================
     HALF DAY (MATCH AVAILABILITY)
  =============================== */

  const requestId = Date.now();
  syncPickupTimeOptions._lastRequest = requestId;

  try {
    const { amData, pmData } = await getHalfDayAvailability(dateStr);

    if (syncPickupTimeOptions._lastRequest !== requestId) return;

    const filteredAM = (
      PRESELECTED_VEHICLE
        ? amData.filter((v) => v.vehicleId === PRESELECTED_VEHICLE)
        : amData
    ).filter((v) => {
      const vehicle = vehicles.find((x) => x.id === v.vehicleId);
      return is35T(vehicle);
    });

    const filteredPM = (
      PRESELECTED_VEHICLE
        ? pmData.filter((v) => v.vehicleId === PRESELECTED_VEHICLE)
        : pmData
    ).filter((v) => {
      const vehicle = vehicles.find((x) => x.id === v.vehicleId);
      return is35T(vehicle);
    });

    const morningAvailable = filteredAM.some(
      (v) =>
        v.available || (v.availableSlots && v.availableSlots.includes("am")),
    );

    const afternoonAvailable = filteredPM.some(
      (v) =>
        v.available || (v.availableSlots && v.availableSlots.includes("pm")),
    );

    /* ===============================
       APPLY UI STATE
    =============================== */

    if (morningOption) {
      morningOption.disabled = !morningAvailable;
      morningOption.style.color = morningAvailable ? "" : "#999";
    }

    if (afternoonOption) {
      afternoonOption.disabled = !afternoonAvailable;
      afternoonOption.style.color = afternoonAvailable ? "" : "#999";
    }

    /* ===============================
       🔥 SMART AUTO SELECT (OPTIMISED)
    =============================== */

    const current = pickupTimeInput.value;
    let nextValue = current;

    // ❌ do NOT auto-select if empty
    if (!current) {
      nextValue = "";
    }

    // selected AM but not available → switch
    else if (current === "07:00" && !morningAvailable) {
      nextValue = afternoonAvailable ? "13:00" : "";
    }

    // selected PM but not available → switch
    else if (current === "13:00" && !afternoonAvailable) {
      nextValue = morningAvailable ? "07:00" : "";
    }

    // nothing available
    if (!morningAvailable && !afternoonAvailable) {
      nextValue = "";
    }

    /* ===============================
       🔥 ONLY UPDATE IF CHANGED
    =============================== */

    if (pickupTimeInput.value !== nextValue) {
      // 🔥 prevent side-effects
      pickupTimeInput._silentUpdate = true;

      pickupTimeInput.value = nextValue;

      setTimeout(() => {
        pickupTimeInput._silentUpdate = false;
      }, 0);
    }
    /* ===============================
       🔇 DEBUG LOG (OPTIONAL)
    =============================== */

    if (window.DEBUG_HALF_DAY) {
      console.log("🕐 Half-day sync:", {
        date: dateStr,
        morningAvailable,
        afternoonAvailable,
      });
    }
  } catch (err) {
    console.warn("Pickup time sync failed:", err);

    if (morningOption) morningOption.disabled = true;
    if (afternoonOption) afternoonOption.disabled = true;

    if (pickupTimeInput.value !== "") {
      pickupTimeInput.value = "";
    }
  }
}

function renderBookingConfirmation(booking) {
  const container = document.getElementById("booking-confirmation");
  if (!container) return;

  /* ===============================
     DATE FORMATTER
  =============================== */

  const formatDate = (value) => {
    if (!value) return "—";

    let d;

    if (typeof value === "number") {
      d = new Date(value);
    } else if (typeof value === "string") {
      if (value.includes(" ") && !value.includes("T")) {
        value = value.replace(" ", "T");
      }

      d = new Date(value);
    } else if (value instanceof Date) {
      d = value;
    }

    if (!d || isNaN(d.getTime())) {
      console.warn("Invalid date value:", value);
      return "—";
    }

    return d.toLocaleString("en-GB", {
      timeZone: "Europe/London",
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };

  /* ===============================
     🔥 STATUS LOGIC (NEW)
  =============================== */

  let statusTitle = "Booking confirmed";
  let statusNote = "Your booking has been successfully secured.";

  if (booking.paymentStatus === "deposit_paid") {
    statusTitle = "✅ Deposit secured";
    statusNote = "Your £200 deposit hold has been successfully placed.";
  }

  if (booking.paymentStatus === "fully_paid") {
    statusTitle = "✅ Fully paid";
    statusNote = "Your booking is now fully paid and confirmed.";
  }

  if (booking.paymentStatus === "confirmation_paid") {
    statusTitle = "✅ Booking confirmed";
    statusNote = "Your booking has been successfully secured.";
  }

  /* ===============================
     DISPLAY DATA
  =============================== */

  const vehicleName =
    booking.vehicleSnapshot?.name || booking.vehicleId || "Vehicle";

  const extras = booking.extras || {};

  const priceTotal = booking.hireTotal || 0;
  let paidNow = booking.confirmationFee || 0;

  // 🔥 IF FULLY PAID → EVERYTHING IS PAID
  if (booking.paymentStatus === "fully_paid") {
    paidNow = priceTotal;
  }

  let remaining =
    booking.outstandingAmount || Math.max(priceTotal - paidNow, 0);

  // 🔥 FORCE ZERO IF FULLY PAID
  if (booking.paymentStatus === "fully_paid") {
    remaining = 0;
  }

  // 🔥 FORCE ZERO IF FULLY PAID
  if (booking.paymentStatus === "fully_paid") {
    remaining = 0;
  }

  let extrasHtml = "";

  if (extras) {
    if (extras.earlyPickup) {
      extrasHtml += `
        <div class="payment-row">
          <span>Early pickup</span>
          <span>£20.00</span>
        </div>
      `;
    }

    if (extras.dartford) {
      const count = Number(extras.dartford || 0);
      const total = (count * 4.2).toFixed(2);

      extrasHtml += `
        <div class="payment-row">
          <span>Dartford crossings (${count})</span>
          <span>£${total}</span>
        </div>
      `;
    }

    if (booking.customerNotes) {
      extrasHtml += `
        <div class="payment-row" style="align-items:flex-start;">
          <span>Notes</span>
          <span style="max-width:200px; text-align:right;">
            ${escapeHtml(booking.customerNotes)}
          </span>
        </div>
      `;
    }
  }

  const shortRef = booking.id?.slice(-8);

  const confirmationOutstanding = Number(
    booking.outstandingAmount || booking.outstanding || remaining || 0,
  );

  const confirmationEmailText =
    confirmationOutstanding > 0
      ? "We have emailed your booking confirmation with links to complete your hire form, secure the £200 deposit hold, and pay the outstanding balance."
      : "We have emailed your booking confirmation with links to complete your hire form and secure the £200 deposit hold.";

  /* ===============================
 RENDER
=============================== */
  container.innerHTML = `
  <div class="confirmation-card apple">

    <div class="confirmation-header">
      <h2>${statusTitle}</h2>
      <div class="confirmation-ref">Ref ${shortRef}</div>
    </div>

    <div class="confirmation-note" style="margin-bottom:14px;">
  ${statusNote}
</div>

<div class="confirmation-email-notice">
  <div class="confirmation-email-icon">✉️</div>

  <div>
    <strong>Email sent</strong>
    <p>${confirmationEmailText}</p>
  </div>
</div>

<div class="confirmation-block">
      <div class="label">Vehicle</div>
      <div class="value strong">${vehicleName}</div>
    </div>

    <div class="confirmation-block grid">
      <div>
        <div class="label">Pickup</div>
        <div class="value">${formatDate(booking.pickupAt)}</div>
      </div>
      <div>
        <div class="label">Return</div>
        <div class="value">${formatDate(booking.dropoffAt)}</div>
      </div>
    </div>

    <div class="payment-card">

      ${
        extrasHtml
          ? `
        <div class="payment-row" style="font-weight:600; margin-bottom:6px;">
          Extras
        </div>
        ${extrasHtml}
        <div style="height:1px; background:#e5e7eb; margin:10px 0;"></div>
      `
          : ""
      }

      <div class="payment-row total">
        <span>Total hire</span>
        <span>£${priceTotal.toFixed(2)}</span>
      </div>

      ${
        booking.paymentStatus === "fully_paid"
          ? `
        <!-- ✅ FULLY PAID CLEAN VIEW -->
        <div class="payment-row paid" style="font-weight:600; color:#16a34a;">
          <span>Total paid</span>
          <span>£${priceTotal.toFixed(2)}</span>
        </div>
      `
          : `
        <!-- 💰 NORMAL / DEPOSIT VIEW -->
        <div class="payment-row paid">
          <span>Paid now</span>
          <span>£${paidNow.toFixed(2)}</span>
        </div>

        ${
          remaining > 0
            ? `
          <div class="payment-row remaining">
            <span>Pay on collection</span>
            <span>£${remaining.toFixed(2)}</span>
          </div>
        `
            : ""
        }
      `
      }

    </div>

    <div class="confirmation-trust">
      <div class="trust-item">✔ Booking secured</div>
      <div class="trust-item">✔ No hidden fees</div>
      <div class="trust-item">✔ Email confirmation sent</div>
    </div>

    <div class="confirmation-actions">
      <a href="https://www.equinetransportuk.com/index.html" class="btn">
        Back to homepage
      </a>
    </div>

  </div>
`;
}

function cleanIsoString(value) {
  if (!value || typeof value !== "string") return value;

  // 🔥 FIX DOUBLE TIME (your exact bug)
  if (value.includes("Z") && value.split("T").length > 2) {
    const firstPart = value.split("Z")[0]; // keep valid ISO
    return firstPart + "Z";
  }

  return value;
}

function normaliseBookingDates(booking) {
  if (!booking) return booking;

  return {
    ...booking,
    pickupAt: cleanIsoString(booking.pickupAt),
    dropoffAt: cleanIsoString(booking.dropoffAt),
  };
}

async function handleStripeReturn() {
  IS_STRIPE_RETURN = true;

  const url = new URL(window.location.href);

  const state = url.searchParams.get("checkout");
  const sessionId = url.searchParams.get("session_id");

  // 🔥 NEW
  const bookingId = url.searchParams.get("bookingId");
  const isDeposit = url.searchParams.get("deposit") === "success";
  const isOutstanding = url.searchParams.get("outstanding") === "paid";

  /* ===============================
     EXIT CONDITIONS
  =============================== */

  if (state === "cancelled") {
    alert("Payment cancelled");
    IS_STRIPE_RETURN = false;
    return;
  }

  /* ===============================
     🔥 NEW: DEPOSIT / OUTSTANDING FLOW
  =============================== */

  if (bookingId && (isDeposit || isOutstanding)) {
    console.log("💰 Payment success (non-checkout):", {
      bookingId,
      type: isDeposit ? "deposit" : "outstanding",
    });

    goToStep(5);

    const container = document.getElementById("booking-confirmation");

    if (container) {
      container.innerHTML = `
        <div class="confirmation-card pro">
          <h2>✅ Payment received</h2>
          <div class="confirmation-note">
            Loading your booking…
          </div>
        </div>
      `;
    }

    try {
      let booking = null;

      /* ===============================
     ⚡ FAST LOOKUP (PRIMARY)
  =============================== */

      try {
        const res = await fetch(
          `https://equine-bookings-api.kverhagen.workers.dev/api/bookings/by-session?session_id=${bookingId}`,
        );

        const data = await res.json();

        if (data?.booking) {
          booking = data.booking;
        }
      } catch (e) {
        console.warn("⚠️ by-session lookup failed, fallback to list");
      }

      /* ===============================
     🔁 FALLBACK (LIMITED RANGE)
  =============================== */

      if (!booking) {
        const res = await fetch(
          `https://equine-bookings-api.kverhagen.workers.dev/api/bookings/list?from=2025-01-01&to=2027-12-31`,
        );

        const data = await res.json();

        booking = (data.bookings || []).find((b) => b.id === bookingId);
      }

      if (!booking) {
        throw new Error("Booking not found");
      }

      /* ===============================
   NORMALISE + STATUS (DEPOSIT / OUTSTANDING ONLY)
=============================== */

      booking = normaliseBookingDates(booking);

      // 🔥 ONLY HERE (deposit / outstanding flow)
      booking.paymentStatus = isDeposit
        ? "deposit_paid"
        : isOutstanding
          ? "fully_paid"
          : "confirmation_paid";

      /* ===============================
   RENDER
=============================== */

      renderBookingConfirmation(booking);

      /* ===============================
   CLEAN URL
=============================== */

      window.history.replaceState(
        {},
        "",
        window.location.pathname + "#booking",
      );

      /* ===============================
   REFRESH CACHE
=============================== */

      BOOKINGS_CACHE = null;
      BOOKINGS_CACHE_AT = 0;

      await getBookings(true);

      STRIPE_FLOW_COMPLETED = true;
    } catch (err) {
      console.error("💥 Payment return error:", err);

      if (container) {
        container.innerHTML = `
      <div class="confirmation-card pro">
        <h2>⏳ Payment received</h2>
        <div class="confirmation-note">
          Your booking is being updated.<br>
          Please refresh or check your email.
        </div>
        <button onclick="location.reload()" class="btn primary">
          Refresh
        </button>
      </div>
    `;
      }
    } finally {
      setTimeout(() => {
        IS_STRIPE_RETURN = false;
      }, 1000);
    }

    return;
  }

  /* ===============================
   NORMAL STRIPE CHECKOUT FLOW
=============================== */

  if (state !== "success" || !sessionId) {
    IS_STRIPE_RETURN = false;
    return;
  }

  if (stripeReturnHandled) {
    return stripeReturnPromise;
  }

  stripeReturnHandled = true;

  stripeReturnPromise = (async () => {
    console.log("🚀 handleStripeReturn", { sessionId });

    goToStep(5);

    const container = document.getElementById("booking-confirmation");

    if (container) {
      container.innerHTML = `
      <div class="confirmation-card pro">
        <h2>✅ Payment received</h2>
        <div class="confirmation-note">
          Finalising your booking…
        </div>
      </div>
    `;
    }

    try {
      let booking = await fetchBookingWithRetry(sessionId);

      console.log("⚡ Stripe session result:", booking);

      if (!booking || !booking.pickupAt) {
        console.warn("⚠️ Booking not ready — retrying once");

        await new Promise((r) => setTimeout(r, 500));

        booking = await fetchBookingWithRetry(sessionId, 2);

        if (!booking || !booking.pickupAt) {
          console.warn("⚠️ Booking still not ready after retry");

          if (container) {
            container.innerHTML = `
            <div class="confirmation-card pro">
              <h2>⏳ Payment received</h2>
              <div class="confirmation-note">
                Finalising your booking…<br>
                Please wait a few seconds.
              </div>
            </div>
          `;
          }

          return;
        }
      }

      console.log("✅ FINAL BOOKING:", booking);

      booking = normaliseBookingDates(booking);

      // ❌ NO paymentStatus here (IMPORTANT)

      VEHICLE_AVAILABILITY_CACHE.clear();
      VEHICLE_AVAILABILITY_PROMISES.clear();

      renderBookingConfirmation(booking);

      window.history.replaceState(
        {},
        "",
        window.location.pathname + "#booking",
      );

      BOOKINGS_CACHE = null;
      BOOKINGS_CACHE_AT = 0;

      await getBookings(true);

      console.log("🎉 Stripe return complete");

      STRIPE_FLOW_COMPLETED = true;
    } catch (err) {
      console.error("💥 Stripe return error:", err);

      if (container) {
        container.innerHTML = `
        <div class="confirmation-card pro">
          <h2>⏳ Payment received</h2>
          <div class="confirmation-note">
            Your booking is being finalised.<br>
            Please refresh or check your email.
          </div>
          <button onclick="location.reload()" class="btn primary">
            Refresh
          </button>
        </div>
      `;
      }
    } finally {
      setTimeout(() => {
        IS_STRIPE_RETURN = false;
        console.log("🔓 Stripe lock released");
      }, 1500);
    }
  })();

  return stripeReturnPromise;
}

async function findNextAvailableDate(startDate, durationDays, pickupTime) {
  for (let i = 1; i <= 14; i++) {
    const testDate = new Date(startDate);
    testDate.setDate(testDate.getDate() + i);

    // ✅ SAFE LOCAL DATE (no timezone bugs)
    const year = testDate.getFullYear();
    const month = String(testDate.getMonth() + 1).padStart(2, "0");
    const day = String(testDate.getDate()).padStart(2, "0");

    const dateString = `${year}-${month}-${day}`;

    const vehiclesToCheck =
      LOCKED_VEHICLE && PRESELECTED_VEHICLE
        ? vehicles.filter((v) => v.id === PRESELECTED_VEHICLE)
        : vehicles;

    /* ===============================
       🔥 NEW: USE BACKEND AVAILABILITY
    =============================== */

    const vehiclesAvailability = await getVehicleAvailability(
      dateString,
      durationDays,
      pickupTime,
    );

    const results = vehiclesToCheck.map((vehicle) => {
      const v = vehiclesAvailability.find((x) => x.vehicleId === vehicle.id);

      if (!v) return false;

      // 🔥 HALF DAY → check slots
      if (Number(durationDays) === 0.5) {
        return v.availableSlots && v.availableSlots.length > 0;
      }

      // 🔥 FULL DAY
      return v.available;
    });

    if (results.some((r) => r)) {
      return testDate;
    }
  }

  return null;
}

function getMaxAvailableDuration(startDate, bookings) {
  let maxDays = 0;

  for (let d = 1; d <= 14; d++) {
    // max hire length

    const end = new Date(startDate);
    end.setDate(end.getDate() + d - 1);

    const possible = vehicles.some((vehicle) => {
      const vehicleBookings = bookings.filter(
        (b) => b.vehicleId === vehicle.id && b.status !== "cancelled",
      );

      const overlap = vehicleBookings.some((booking) => {
        const existingStart = new Date(booking.pickupAt);
        const existingEnd = new Date(booking.dropoffAt);

        return overlaps(startDate, end, existingStart, existingEnd);
      });

      return !overlap;
    });

    if (!possible) break;

    maxDays = d;
  }

  return maxDays;
}

function isMobile() {
  return window.matchMedia("(max-width: 768px)").matches;
}

function goBackToDates() {
  /* go back to Step 1 */

  goToStep(1);

  /* scroll to calendar */

  const calendar = document.getElementById("availability-calendar");

  if (calendar) {
    calendar.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }
}

function resetBookingFlow() {
  console.log("🔄 HARD reset booking flow");

  resetAvailabilityAutoSubmitState();

  IS_RESETTING = true;

  /* ===============================
     CLEAR GLOBAL STATE
  =============================== */

  selectedAvailability = null;

  PRESELECTED_VEHICLE = null;
  LOCKED_VEHICLE = false;
  BLOCK_AUTO_SCROLL = false;

  /* ===============================
     CLEAR DATE STATE (FULL RESET)
  =============================== */

  if (pickupDateInput) pickupDateInput.value = "";
  if (selectedPickupInput) selectedPickupInput.value = "";

  window.SELECTED_DATE = null;

  /* ===============================
     RESET CALENDAR (FINAL FIX)
  =============================== */

  document
    .querySelectorAll(".cal-day")
    .forEach((el) => el.classList.remove("cal-selected", "active"));

  // 🔥 THIS handles month + render (single source of truth)
  resetCalendarToToday();

  /* ===============================
     CLEAR FORM FIELDS
  =============================== */

  if (selectedLorryInput) selectedLorryInput.value = "";
  if (selectedDurationInput) selectedDurationInput.value = "";
  if (selectedBaseInput) selectedBaseInput.value = "";

  if (pickupTimeInput) pickupTimeInput.value = "";
  if (durationDaysInput) durationDaysInput.value = "";

  /* ===============================
     UI RESET
  =============================== */

  const row = document.getElementById("pickup-time-row");
  if (row) row.style.display = "none";

  const group = document.getElementById("pickup-time-group");
  if (group) group.style.display = "none";

  const warningBox = document.getElementById("preselected-warning");
  if (warningBox) {
    warningBox.innerHTML = "";
    warningBox.style.display = "none";
  }

  updateCalendarVehicleLabel();

  /* ===============================
     🔥 DO NOT CLEAR DURING STRIPE RETURN
  =============================== */

  if (!IS_STRIPE_RETURN) {
    if (availabilityResults) {
      availabilityResults.innerHTML = "";
    }

    const confirmation = document.getElementById("booking-confirmation");
    if (confirmation) {
      confirmation.innerHTML = "";
    }
  }

  /* ===============================
     CACHE RESET
  =============================== */

  AVAILABILITY_CACHE.clear();
  VEHICLE_AVAILABILITY_CACHE.clear();
  VEHICLE_AVAILABILITY_PROMISES.clear();

  RANGE_AVAILABILITY_CACHE.clear();
  PREFETCH_PROMISES.clear();

  if (bookingSubmitBtn) bookingSubmitBtn.disabled = true;

  updateCheckoutSummary();

  /* ===============================
     NAVIGATION
  =============================== */

  goToStep(1);

  /* ===============================
     SCROLL TOP
  =============================== */

  requestAnimationFrame(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  /* ===============================
     FINAL STATE
  =============================== */

  IS_RESETTING = false;

  console.log("🔄 Booking reset complete");
}

function resetCalendarToToday() {
  if (!window.renderCalendar || !window.__calendarState) {
    console.warn("⚠️ Calendar not ready");
    return;
  }

  const today = new Date();
  today.setDate(1);

  // 🔥 update shared state
  window.__calendarState.currentDate = today;

  // 🔥 render with correct month
  window.renderCalendar();
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));

    return { response, data };
  } finally {
    clearTimeout(timeout);
  }
}

function apiUrl(path) {
  if (!BACKEND_API_BASE) return path;
  return `${BACKEND_API_BASE.replace(/\/$/, "")}${path}`;
}

function getCurrentDiscountCode() {
  return document.getElementById("discount-code")?.value?.trim() || "";
}

function generateNumericBookingId(existingIds = new Set()) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const suffix = String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
    const candidate = `19${suffix}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `19${String(Date.now()).slice(-6)}`;
}

function buildFormUrl(baseUrl, bookingId) {
  if (!baseUrl) return "";

  const cleanBookingId = String(bookingId || "").trim();
  if (!cleanBookingId) return baseUrl;

  try {
    const url = new URL(baseUrl, window.location.origin);

    // 🔥 production-safe:
    // remove any old/mistaken booking params first
    url.searchParams.delete("id");
    url.searchParams.delete("bookingID");
    url.searchParams.delete("bookingId");

    // ✅ single source of truth
    url.searchParams.set("bookingId", cleanBookingId);

    return url.toString();
  } catch (err) {
    console.warn("buildFormUrl fallback used:", err);

    // fallback for any unusual relative URL parsing issue
    const separator = baseUrl.includes("?") ? "&" : "?";
    return `${baseUrl}${separator}bookingId=${encodeURIComponent(cleanBookingId)}`;
  }
}

function addDays(date, days) {
  const output = new Date(date);
  output.setDate(output.getDate() + days);
  return output;
}

function getDatesBetween(startDate, endDate) {
  const dates = [];

  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);

  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);

  while (current <= end) {
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, "0");
    const day = String(current.getDate()).padStart(2, "0");

    dates.push(`${year}-${month}-${day}`);

    current.setDate(current.getDate() + 1);
  }

  return dates;
}

function showToast(message = "") {
  let toast = document.getElementById("app-toast");

  // create if not exists
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "app-toast";
    document.body.appendChild(toast);
  }

  toast.innerText = message;

  toast.classList.add("visible");

  // auto hide
  setTimeout(() => {
    toast.classList.remove("visible");
  }, 2500);
}

function setButtonBusy(button, busy, busyText = "Please wait...") {
  if (!button) return;

  if (busy) {
    if (!button.dataset.originalText) {
      button.dataset.originalText = button.textContent || "";
    }
    button.disabled = true;
    button.textContent = busyText;
    button.setAttribute("aria-busy", "true");
  } else {
    button.disabled = false;
    button.textContent = button.dataset.originalText || button.textContent;
    button.removeAttribute("aria-busy");
  }
}

function formatDayKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function asDate(dateString, timeString) {
  const [year, month, day] = dateString.split("-").map(Number);
  const [hour, minute] = timeString.split(":").map(Number);

  return new Date(Date.UTC(year, month - 1, day, hour, minute));
}

async function getBookings(force = false) {
  if (!force && bookingsRequestPromise) {
    return bookingsRequestPromise;
  }

  const now = Date.now();

  if (
    !force &&
    BOOKINGS_CACHE &&
    now - BOOKINGS_CACHE_AT < BOOKINGS_CACHE_TTL
  ) {
    return BOOKINGS_CACHE;
  }

  bookingsRequestPromise = (async () => {
    try {
      const from = new Date();
      from.setMonth(from.getMonth() - 2);

      const to = new Date();
      to.setMonth(to.getMonth() + 3);

      const res = await fetch(
        apiUrl(
          `/api/bookings/list?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
        ),
      );

      if (!res.ok) {
        console.warn("⚠️ bookings API error:", res.status);
        return BOOKINGS_CACHE || [];
      }

      const data = await res.json();

      /* ===============================
         🔥 HARD NORMALISATION
      =============================== */

      let bookings = [];

      if (Array.isArray(data)) {
        bookings = data;
      } else if (Array.isArray(data?.bookings)) {
        bookings = data.bookings;
      } else {
        console.warn("⚠️ Invalid bookings response:", data);
        bookings = [];
      }

      BOOKINGS_CACHE = bookings;
      BOOKINGS_CACHE_AT = Date.now();

      if (DEBUG) {
        console.log("📦 bookings loaded:", bookings.length);
      }

      return bookings;
    } catch (err) {
      console.warn("getBookings failed:", err);
      return BOOKINGS_CACHE || [];
    } finally {
      bookingsRequestPromise = null;
    }
  })();

  return bookingsRequestPromise;
}

function getCalendarBookings(forceRefresh = false) {
  return getBookings(forceRefresh);
}
function saveBookings(bookings) {
  localStorage.setItem(STORAGE_BOOKINGS, JSON.stringify(bookings));
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString("en-GB", {
    timeZone: "Europe/London", // 🔥 FIX
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleTimeString("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDateOnly(value) {
  if (!value) return "—";

  const [year, month, day] = String(value).split("-");
  if (!year || !month || !day) return String(value);

  return `${day}/${month}/${year}`;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function is35T(vehicle) {
  return (
    String(vehicle?.id || "").startsWith("v35") ||
    String(vehicle?.type || "")
      .toLowerCase()
      .includes("3.5")
  );
}

function isWeekendDate(dateStr) {
  if (!dateStr) return false;

  const [year, month, day] = String(dateStr).split("-").map(Number);

  if (!year || !month || !day) return false;

  // Use midday to avoid timezone/date-shift problems
  const date = new Date(year, month - 1, day, 12, 0, 0);

  const weekday = date.getDay();

  return weekday === 0 || weekday === 6; // Sunday or Saturday
}

function shouldHideHalfDayForDateAndVehicle(dateStr, vehicle) {
  // 7.5T: always hide half-day
  if (!is35T(vehicle)) return true;

  // 3.5T: hide half-day only on weekends
  return isWeekendDate(dateStr);
}

function getHalfDayUnavailableText(dateStr, vehicle) {
  if (!vehicle) {
    if (isWeekendDate(dateStr)) {
      return "Not During Weekends";
    }

    return "1/2 day";
  }

  if (!is35T(vehicle)) {
    return "No 1/2 Days";
  }

  if (isWeekendDate(dateStr)) {
    return "Not During Weekends";
  }

  return "1/2 day";
}

function showHalfDayAsUnavailable(option, dateStr, vehicle) {
  if (!option) return;

  if (!option.dataset.originalText) {
    option.dataset.originalText = option.textContent || "1/2 day";
  }

  option.textContent = getHalfDayUnavailableText(dateStr, vehicle);
  option.disabled = true;

  // Important: keep visible on mobile + desktop
  option.hidden = false;
  option.style.display = "";
  option.style.color = "#999";
}

function showHalfDayAsAvailable(option) {
  if (!option) return;

  option.textContent = option.dataset.originalText || "1/2 day";
  option.disabled = false;
  option.hidden = false;
  option.style.display = "";
  option.style.color = "";
}

function enforceVehicleDurationRules(vehicle) {
  if (!durationDaysInput) return;

  const halfDayOption = durationDaysInput.querySelector('option[value="0.5"]');
  if (!halfDayOption) return;

  const pickupDate = pickupDateInput?.value || "";
  const hideHalfDay = shouldHideHalfDayForDateAndVehicle(pickupDate, vehicle);

  if (hideHalfDay) {
    showHalfDayAsUnavailable(halfDayOption, pickupDate, vehicle);

    if (durationDaysInput.value === "0.5") {
      durationDaysInput.value = "";
    }
  } else {
    showHalfDayAsAvailable(halfDayOption);
  }
}

function filterVehiclesForDisplay(vehiclesList) {
  if (!LOCKED_VEHICLE || !PRESELECTED_VEHICLE) {
    return vehiclesList;
  }

  return vehiclesList.filter((v) => v.vehicle.id === PRESELECTED_VEHICLE);
}

function getConfirmationFee(vehicle) {
  const id = String(vehicle?.id || "");

  if (id.startsWith("v35")) return 75;
  if (id.startsWith("v75")) return 100;

  return 75; // fallback
}

function getDurationKey(durationDays) {
  return String(Number(durationDays || 0));
}

function formatDurationLabel(durationDays) {
  const numeric = Number(durationDays || 0);
  if (numeric === 0.5) return "1/2 day";
  if (numeric === 7) return "Week";
  if (numeric === 1) return "1 day";
  return `${numeric} days`;
}

function formatStepSearchDate(value) {
  if (!value) return "—";

  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return value;

  const d = new Date(year, month - 1, day, 12, 0, 0);

  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatPickupTimeLabel(value) {
  if (value === "07:00") return "Morning";
  if (value === "13:00") return "Afternoon";
  return value || "—";
}

function updateAvailabilitySearchSummary(items = []) {
  const box = document.getElementById("availability-search-summary");
  if (!box) return;

  const pickupDate = pickupDateInput?.value || "";
  const durationDays = Number(durationDaysInput?.value || 0);
  const pickupTime = pickupTimeInput?.value || DEFAULT_PICKUP_TIME;

  if (!pickupDate || !durationDays) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }

  const chips = [
    `<span class="search-chip"><strong>Date:</strong> ${escapeHtml(formatStepSearchDate(pickupDate))}</span>`,
    `<span class="search-chip"><strong>Duration:</strong> ${escapeHtml(formatDurationLabel(durationDays))}</span>`,
  ];

  if (durationDays === 0.5) {
    chips.push(
      `<span class="search-chip"><strong>Pickup:</strong> ${escapeHtml(formatPickupTimeLabel(pickupTime))}</span>`,
    );
  }

  if (items.length > 0) {
    chips.push(
      `<span class="search-chip search-chip-accent"><strong>${items.length}</strong> ${items.length === 1 ? "lorry" : "lorries"} available</span>`,
    );
  }

  box.innerHTML = chips.join("");
  box.hidden = false;
}

function scrollStep2IntoView() {
  const step2 = document.getElementById("step-2");
  if (!step2) return;

  setTimeout(() => {
    step2.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, 120);
}

function isWeekendDate(value) {
  if (!value) return false;

  let date;

  if (value instanceof Date) {
    date = value;
  } else {
    const [year, month, day] = String(value).split("-").map(Number);

    if (!year || !month || !day) return false;

    // Use midday to avoid timezone/date-shift problems
    date = new Date(year, month - 1, day, 12, 0, 0);
  }

  if (!date || Number.isNaN(date.getTime())) return false;

  const weekday = date.getDay();

  return weekday === 0 || weekday === 6;
}

function getDurationHours(vehicle, durationDays) {
  const key = getDurationKey(durationDays);
  const map =
    vehicle.pricingModel === "35_duration_rules"
      ? DURATION_HOURS_35T
      : DURATION_HOURS_75T;
  const fallback = Number(durationDays || 1) * 24;
  return map[key] || fallback;
}

function supportsDuration(vehicle, durationDays) {
  const key = getDurationKey(durationDays);
  if (vehicle.pricingModel === "35_duration_rules") {
    return Boolean(DURATION_HOURS_35T[key]);
  }
  return Boolean(DURATION_HOURS_75T[key]);
}

function calculateBaseCost(vehicle, durationDays, pickupDate, pickupTime) {
  const duration = Number(durationDays || 0);
  const durationKey = getDurationKey(duration);
  const startDate = asDate(pickupDate, pickupTime);
  const isWeekendStart = isWeekendDate(startDate);

  if (vehicle.pricingModel === "35_duration_rules") {
    const mapped = RATE_35T_TOTALS[durationKey];
    if (mapped != null) return mapped;
    return 105 * Math.max(1, duration);
  }

  if (vehicle.pricingModel === "75_living_rules") {
    let total =
      RATE_75_LIVING_TOTALS[durationKey] ?? 175 * Math.max(1, duration);
    if (isWeekendStart && duration === 1) total = Math.max(total, 200);
    if (isWeekendStart && duration === 2) total = Math.max(total, 400);
    return total;
  }

  if (vehicle.pricingModel === "75_no_living_rules") {
    let total = 165 * Math.max(1, duration);
    if (isWeekendStart && duration === 1) total = Math.max(total, 175);
    if (isWeekendStart && duration === 2) total = Math.max(total, 350);
    return total;
  }

  return vehicle.dayRate * Math.max(1, duration);
}

function calculateCrossingCharge(crossingsCount) {
  return crossingsCount * DARTFORD_CROSSING_PRICE;
}

function calculateEarlyPickupCharge(enabled) {
  return enabled ? EARLY_PICKUP_PRICE : 0;
}

function getReminderAt(pickupAtIso) {
  const reminderDate = new Date(pickupAtIso);
  reminderDate.setDate(reminderDate.getDate() - 1);
  return reminderDate.toISOString();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getAvailabilityCacheKey(
  vehicleId,
  pickupDate,
  durationDays,
  pickupTime,
  discountCode = "",
) {
  return `${vehicleId}|${pickupDate}|${durationDays}|${pickupTime}|${discountCode}`;
}

/* ======================================================
   Pricing API (server quote with local fallback)
====================================================== */

async function fetchServerQuote(
  vehicle,
  durationDays,
  pickupDate,
  pickupTime,
  discountCode = "",
) {
  // 🔒 Local development safeguard (prevents 405 spam on Live Server)
  if (location.hostname === "127.0.0.1" || location.hostname === "localhost") {
    console.log("Skipping pricing API (localhost dev)");

    const fallbackBase = calculateBaseCost(
      vehicle,
      durationDays,
      pickupDate,
      pickupTime,
    );

    const extras = {
      dartford: dartfordEnabledInput?.checked
        ? Number(dartfordCountInput?.value || 0)
        : 0,

      earlyPickup:
        earlyPickupEnabledInput?.checked && !earlyPickupEnabledInput?.disabled
          ? 1
          : 0,
    };

    console.log("🚚 EXTRAS SENT:", extras);

    const extrasTotal =
      (extras.dartford || 0) * 4.2 + (extras.earlyPickup ? 20 : 0);

    const total = fallbackBase + extrasTotal;

    return {
      baseCost: fallbackBase,
      discountAmount: 0,
      extrasTotal,
      total,
    };
  }

  try {
    /* ===============================
     EXTRAS (🔥 NEW)
  =============================== */

    const extras = {
      dartford: dartfordEnabledInput?.checked
        ? Number(dartfordCountInput?.value || 0)
        : 0,

      earlyPickup:
        earlyPickupEnabledInput?.checked && !earlyPickupEnabledInput?.disabled
          ? 1
          : 0,
    };

    const res = await fetch(apiUrl("/api/pricing/quote"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vehicleId: vehicle.id,
        durationDays,
        pickupDate,
        pickupTime,
        discountCode,
        extras, // 🔥 SEND TO BACKEND
      }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => null);
      const message = errorData?.error || "Pricing API error";
      throw new Error(message);
    }

    const pricing = await res.json();

    return {
      baseCost: Number(pricing.baseCost ?? 0),
      discountAmount: Number(pricing.discountAmount ?? 0),
      discountCode: String(pricing.discountCode || ""),
      extrasTotal: Number(pricing.extrasTotal ?? 0),
      total: Number(pricing.total ?? 0),
    };
  } catch (err) {
    const message = String(err?.message || "");

    if (message.includes("Half-day hire is not available")) {
      throw err;
    }

    console.warn("⚠️ Pricing API failed. Falling back to local pricing.", err);

    const fallbackBase = calculateBaseCost(
      vehicle,
      durationDays,
      pickupDate,
      pickupTime,
    );

    const extras = {
      dartford: dartfordEnabledInput?.checked
        ? Number(dartfordCountInput?.value || 0)
        : 0,

      earlyPickup:
        earlyPickupEnabledInput?.checked && !earlyPickupEnabledInput?.disabled
          ? 1
          : 0,
    };

    const extrasTotal =
      (extras.dartford || 0) * 4.2 + (extras.earlyPickup ? 20 : 0);

    const total = fallbackBase + extrasTotal;

    return {
      baseCost: fallbackBase,
      discountAmount: 0,
      extrasTotal,
      total,
    };
  }
}

async function buildAvailability(
  vehicle,
  pickupDate,
  durationDays,
  pickupTime,
  discountCode = "",
) {
  /* ===============================
   🔥 BLOCK DURING STRIPE RETURN
=============================== */

  const isStripeMode = IS_STRIPE_RETURN;

  /* ===============================
     TIME RULES (FIXED)
  =============================== */

  let actualPickupTime = pickupTime;
  let dropoffTime = FULL_DAY_DROPOFF_TIME;
  let durationHours = getDurationHours(vehicle, durationDays);

  const isHalfDay = is35T(vehicle) && Number(durationDays) === 0.5;

  if (isHalfDay) {
    // 🔥 DO NOT FORCE DEFAULT — respect user or resolved selection
    if (!HALF_DAY_PICKUP_TIMES_35T.includes(actualPickupTime)) {
      actualPickupTime = pickupTime || null;
    }

    // ❌ If still no valid time → STOP (forces user selection)
    if (!actualPickupTime) {
      return null;
    }

    dropoffTime = HALF_DAY_DROPOFF_TIMES_35T[actualPickupTime];
    durationHours = 6;
  } else {
    // full day always morning
    actualPickupTime = DEFAULT_PICKUP_TIME;
    dropoffTime = FULL_DAY_DROPOFF_TIME;
  }

  /* ===============================
     BUILD DATES
  =============================== */

  const pickupAt = asDate(pickupDate, actualPickupTime);

  let dropoffAt;

  if (isHalfDay) {
    dropoffAt = asDate(pickupDate, dropoffTime);
  } else {
    const dropoffDate = addDays(
      pickupAt,
      Math.max(0, Number(durationDays) - 1),
    );

    const year = dropoffDate.getFullYear();
    const month = String(dropoffDate.getMonth() + 1).padStart(2, "0");
    const day = String(dropoffDate.getDate()).padStart(2, "0");

    dropoffAt = asDate(`${year}-${month}-${day}`, dropoffTime);
  }

  /* ===============================
     CACHE KEY
  =============================== */

  const cacheKey = getAvailabilityCacheKey(
    vehicle.id,
    pickupDate,
    durationDays,
    actualPickupTime,
    discountCode || "",
  );

  const cached = AVAILABILITY_CACHE.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < AVAILABILITY_CACHE_TTL) {
    return cached.data;
  }

  /* ===============================
     FETCH PRICING
  =============================== */

  const pricing = await fetchServerQuote(
    vehicle,
    durationDays,
    pickupDate,
    actualPickupTime,
    discountCode,
  );

  /* ===============================
     EXTRAS
  =============================== */

  const extras = {
    dartford: dartfordEnabledInput?.checked
      ? Number(dartfordCountInput?.value || 0)
      : 0,

    earlyPickup:
      earlyPickupEnabledInput?.checked && !earlyPickupEnabledInput?.disabled
        ? 1
        : 0,
  };

  /* ===============================
     BUILD OBJECT
  =============================== */

  const availabilityObject = {
    vehicle,
    pickupDate,
    pickupTime: actualPickupTime,
    durationDays,
    durationHours,
    pickupAt,
    dropoffAt,
    extras,

    // ✅ Only keep voucher code if backend actually applied a discount
    discountCode:
      Number(pricing.discountAmount || 0) > 0
        ? String(pricing.discountCode || discountCode || "")
        : "",

    baseCost: pricing.baseCost,
    discountAmount: pricing.discountAmount,
    extrasTotal: pricing.extrasTotal,
    total: pricing.total,
  };

  /* ===============================
     🔥 FORCE UI SYNC (CRITICAL FIX)
  =============================== */

  /* ===============================
     CACHE STORE
  =============================== */

  AVAILABILITY_CACHE.set(cacheKey, {
    timestamp: Date.now(),
    data: availabilityObject,
  });

  return availabilityObject;
}

/* ======================================================
   Availability checks + rendering
====================================================== */

async function getAvailableLorries(pickupDate, durationDays, pickupTime) {
  // 🔥 HARD FRONTEND BLOCK:
  // No half-day rentals on weekends.
  // 7.5T is never half-day anyway; this also blocks 3.5T Saturday/Sunday.
  if (Number(durationDays) === 0.5 && isWeekendDate(pickupDate)) {
    LAST_AVAILABLE_VEHICLES = [];
    return [];
  }

  let vehiclesToCheck =
    LOCKED_VEHICLE && PRESELECTED_VEHICLE
      ? vehicles.filter((v) => v.id === PRESELECTED_VEHICLE)
      : vehicles;

  if (!vehiclesToCheck.length) {
    vehiclesToCheck = vehicles;
  }

  const isHalfDay = Number(durationDays) === 0.5;

  /* ===============================
     HALF DAY (UNCHANGED)
  =============================== */

  if (isHalfDay) {
    const { amData, pmData } = await getHalfDayAvailability(pickupDate);

    const results = await Promise.all(
      vehiclesToCheck.map(async (vehicle) => {
        if (!is35T(vehicle)) return null;

        const amVehicle = amData.find((v) => v.vehicleId === vehicle.id);
        const pmVehicle = pmData.find((v) => v.vehicleId === vehicle.id);

        const hasAM =
          amVehicle?.available ||
          (amVehicle?.availableSlots || []).includes("am");

        const hasPM =
          pmVehicle?.available ||
          (pmVehicle?.availableSlots || []).includes("pm");

        let resolvedPickupTime = pickupTime;

        if (!pickupTime) {
          if (hasAM && !hasPM) resolvedPickupTime = "07:00";
          else if (!hasAM && hasPM) resolvedPickupTime = "13:00";
          else return null;
        } else {
          if (pickupTime === "07:00" && !hasAM) return null;
          if (pickupTime === "13:00" && !hasPM) return null;
        }

        return await buildAvailability(
          vehicle,
          pickupDate,
          0.5,
          resolvedPickupTime,
        );
      }),
    );

    const filtered = results.filter(Boolean);

    LAST_AVAILABLE_VEHICLES = filtered.map((r) => ({
      vehicleId: r.vehicle.id,
    }));

    return filtered;
  }

  /* ===============================
     FULL DAY (🔥 FIXED)
  =============================== */

  const vehiclesAvailability = await getVehicleAvailability(
    pickupDate,
    durationDays,
    null, // 🔥 KEY FIX
  );

  LAST_AVAILABLE_VEHICLES = vehiclesAvailability;

  const results = await Promise.all(
    vehiclesToCheck.map(async (vehicle) => {
      const apiVehicle = vehiclesAvailability.find(
        (v) => v.vehicleId === vehicle.id,
      );

      if (!apiVehicle?.available) return null;

      return await buildAvailability(
        vehicle,
        pickupDate,
        durationDays,
        DEFAULT_PICKUP_TIME,
      );
    }),
  );

  return results.filter(Boolean);
}
function renderAvailabilityLoading() {
  if (!availabilityResults) return;

  /* ===============================
     🔥 BLOCK DURING STRIPE RETURN
  =============================== */

  if (IS_STRIPE_RETURN) return;

  /* ===============================
     🔥 PREVENT DUPLICATE LOADING
  =============================== */

  if (availabilityResults.querySelector(".loading-note")) return;

  const html = `
    <div class="loading-note">
      <span class="spinner" aria-hidden="true"></span>
      Checking availability…
    </div>
  `;

  /* ===============================
     🔥 PREVENT SAME HTML RE-RENDER
  =============================== */

  if (availabilityResults.innerHTML === html) return;

  /* ===============================
     RENDER (SAFE)
  =============================== */

  safeRenderAvailability(html);
}

function renderAvailabilityError(
  message = "Something went wrong. Please try again.",
) {
  if (!availabilityResults) return;

  /* ===============================
     🔥 BLOCK DURING STRIPE RETURN
  =============================== */

  if (IS_STRIPE_RETURN) return;

  const html = `<p class="empty-note">${escapeHtml(message)}</p>`;

  /* ===============================
     🔥 PREVENT DUPLICATE RENDER
  =============================== */

  if (availabilityResults.innerHTML === html) return;

  /* ===============================
     RENDER (SAFE)
  =============================== */

  safeRenderAvailability(html);
}

async function renderAvailabilityResults(items) {
  /* ===============================
     🔥 BLOCK DURING STRIPE RETURN
  =============================== */

  if (IS_STRIPE_RETURN) {
    console.log("⛔ render blocked (Stripe return)");
    return;
  }

  console.log(
    "render items:",
    items.map((v) => v.vehicle.name),
  );

  items = filterVehiclesForDisplay(items);

  /* ===============================
     INPUT GUARD
  =============================== */

  const pickupDate = pickupDateInput?.value;
  const duration = Number(durationDaysInput?.value);
  const pickupTime = pickupTimeInput?.value;

  if (!pickupDate || !duration) {
    safeRenderAvailability("");
    return;
  }

  /* ===============================
     🔥 HALF DAY GUARD (CRITICAL)
  =============================== */

  if (duration === 0.5 && !pickupTime) {
    safeRenderAvailability("");
    return;
  }

  updateAvailabilitySearchSummary(items);

  const pricePreview = document.getElementById("price-preview");

  /* ===============================
     PRICE PREVIEW
  =============================== */

  if (pricePreview) {
    if (items.length === 1) {
      const price = Number(items[0].total ?? items[0].baseCost ?? 0);

      pricePreview.innerHTML = `
        <div class="price-main">Only one lorry available</div>
        <div class="price-confirm">
          ${escapeHtml(items[0].vehicle.name)} · Estimated hire price £${price.toFixed(2)}
        </div>
      `;

      pricePreview.style.display = "block";
    } else {
      pricePreview.innerHTML = "";
      pricePreview.style.display = "none";
    }
  }

  /* ===============================
     NO VEHICLES
  =============================== */

  if (!items.length) {
    const nextDate = await findNextAvailableDate(
      new Date(pickupDate),
      duration,
      pickupTime || DEFAULT_PICKUP_TIME,
    );

    let suggestionHTML = "";

    if (nextDate) {
      const formatted = nextDate.toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
      });

      const nextValue = nextDate.toISOString().slice(0, 10);

      suggestionHTML = `
        <div class="next-available">
          Next available ${LOCKED_VEHICLE ? "for this lorry" : ""}: 
          <strong>${formatted}</strong><br>

          <button class="btn ghost next-date-btn"
            data-date="${nextValue}">
            Check ${formatted}
          </button>
        </div>
      `;
    }

    safeRenderAvailability(`
      <div class="availability-empty-state">
        <p class="empty-note">
          ${
            LOCKED_VEHICLE
              ? "This lorry is not available on this date."
              : "No lorries available for this date and duration."
          }
        </p>
        ${suggestionHTML}
      </div>
    `);

    setTimeout(() => {
      availabilityResults?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 150);

    return;
  }

  /* ===============================
     AUTO SELECT (SAFE)
  =============================== */

  if (items.length === 1 && LOCKED_VEHICLE && !selectedAvailability) {
    await selectAvailability(items[0].vehicle.id);
    goToStep(3);
    return;
  }

  /* ===============================
     MULTIPLE VEHICLES
  =============================== */

  const html = items
    .map((item) => {
      const vehicle = item.vehicle;
      const confirmationFee = getConfirmationFee(vehicle);
      const displayPrice = Number(item.total ?? item.baseCost ?? 0);

      const durationLabel = formatDurationLabel(item.durationDays);

      const pickupLabel =
        Number(item.durationDays) === 0.5
          ? ` · ${formatPickupTimeLabel(item.pickupTime)}`
          : "";

      return `
      <article class="availability-item">

        <img
          src="${getVehicleMainImage(vehicle)}"
          alt="${escapeHtml(vehicle.name)}"
          class="availability-image"
        >

        <div class="availability-info">

          <h4>${escapeHtml(vehicle.name)}</h4>

          <p class="muted tiny">
            ${vehicle.code ? `${escapeHtml(vehicle.code)} · ` : ""}
            ${escapeHtml(formatDateOnly(item.pickupDate))} ·
            ${escapeHtml(durationLabel)}${escapeHtml(pickupLabel)}
          </p>

          <div class="availability-meta">
            <span class="availability-meta-pill">
              ${escapeHtml(formatDateOnly(item.pickupDate))}
            </span>
            <span class="availability-meta-pill">
              ${escapeHtml(durationLabel)}
            </span>
          </div>

          <div class="availability-price-row">
            <span class="availability-price">
              £${displayPrice.toFixed(2)}
            </span>
            <span class="availability-price-note">
              Pay now £${confirmationFee.toFixed(2)}
            </span>
          </div>

        </div>

        <div class="availability-actions">
          <button
            class="btn choose-lorry"
            type="button"
            data-vehicle-id="${escapeHtml(vehicle.id)}">
            Choose this lorry
          </button>
        </div>

      </article>
    `;
    })
    .join("");

  safeRenderAvailability(html);

  /* ===============================
     AVAILABILITY NOTE
  =============================== */

  availabilityResults.insertAdjacentHTML(
    "afterbegin",
    `<p class="muted">
      ${items.length} lorr${items.length > 1 ? "ies" : "y"} available
    </p>`,
  );

  /* ===============================
     STEP + SCROLL
  =============================== */

  goToStep(2);

  setTimeout(() => {
    document.getElementById("step-2")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, 120);
}

const bookingTimeInput = document.getElementById("booking-pickup-time");

bookingTimeInput?.addEventListener("change", () => {
  updateEarlyPickupAvailability(); // ✅ REQUIRED
});

const bookingConfirmBtn = document.getElementById("booking-confirm-btn");

async function isContinuousRangeAvailable(
  startDateStr,
  durationDays,
  vehicleId,
  pickupTime = null,
) {
  const duration = Number(durationDays);

  if (!startDateStr || !duration || !vehicleId) return false;

  /* ===============================
     HALF DAY (KEEP SLOT LOGIC)
  =============================== */

  if (duration === 0.5) {
    const vehiclesData = await getVehicleAvailability(
      startDateStr,
      0.5,
      pickupTime,
    );
    const match = vehiclesData.find((v) => v.vehicleId === vehicleId);

    if (!match) return false;

    if (pickupTime === "07:00") {
      return !!(match.available || match.availableSlots?.includes("am"));
    }

    if (pickupTime === "13:00") {
      return !!(match.available || match.availableSlots?.includes("pm"));
    }

    return !!match.availableSlots?.length;
  }

  /* ===============================
     🔥 CACHE-FIRST (CRITICAL)
  =============================== */

  const cached = getRangeAvailabilityFromCache(
    startDateStr,
    duration,
    vehicleId,
  );

  if (cached !== null) {
    return cached;
  }

  /* ===============================
     BACKEND CHECK
  =============================== */

  const vehiclesData = await getVehicleAvailability(
    startDateStr,
    duration,
    null,
  );

  const match = vehiclesData.find((v) => v.vehicleId === vehicleId);

  const result = !!match?.available;

  /* ===============================
     🔥 WRITE BACK TO CACHE
  =============================== */

  setRangeAvailabilityCache(startDateStr, duration, vehicleId, result);

  return result;
}

/* ======================================================
   Checkout summary (discount-safe)
====================================================== */

async function updateCheckoutSummary() {
  if (!checkoutSummary) return;

  if (!selectedAvailability) {
    checkoutSummary.textContent = "Select an available lorry to continue.";
    if (bookingSubmitBtn) bookingSubmitBtn.disabled = true;
    return;
  }

  if (bookingSubmitBtn) bookingSubmitBtn.disabled = false;

  const extras = selectedAvailability?.extras || {};

  const dartfordCount = Number(extras.dartford || 0);
  const earlyPickupEnabled = Boolean(extras.earlyPickup);

  const baseCost = Number(selectedAvailability?.baseCost || 0);
  const discountAmount = Number(selectedAvailability?.discountAmount || 0);
  const extrasTotal = Number(selectedAvailability?.extrasTotal || 0);
  const hireTotal = Number(selectedAvailability?.total || 0);

  const vehicleId =
    selectedAvailability?.vehicle?.id ||
    selectedAvailability?.vehicleId ||
    vehicles.find((v) => v.name === selectedAvailability?.vehicle?.name)?.id ||
    "";

  const rawConfirmationFee = String(vehicleId).startsWith("v75")
    ? CONFIRMATION_FEE_75T
    : CONFIRMATION_FEE_35T;

  // ✅ Pay now must never be more than the final discounted hire total
  const confirmationFee = Math.min(rawConfirmationFee, hireTotal);

  const outstandingAmount = Math.max(0, hireTotal - confirmationFee);

  const requiredFormType = getCurrentRequiredFormLabel();

  /* ===============================
     🔥 GET CUSTOMER NOTES
  =============================== */

  const notesInput = document.getElementById("customer-notes");
  const rawNotes = (notesInput?.value || "").trim();
  const customerNotes = rawNotes ? rawNotes.slice(0, 500) : "";

  const notesHtml = customerNotes
    ? `
      <div class="summary-row notes">
        <span>Notes</span>
        <span>${escapeHtml(customerNotes)}</span>
      </div>
    `
    : "";

  /* ===============================
     BUTTON TEXT
  =============================== */

  if (bookingSubmitBtn) {
    bookingSubmitBtn.textContent = `Pay £${confirmationFee.toFixed(2)} to confirm booking`;
  }

  const confirmBtn = document.getElementById("booking-confirm-btn");
  if (confirmBtn) {
    confirmBtn.textContent = `Pay £${confirmationFee.toFixed(2)} to confirm booking`;
  }

  /* ===============================
     RENDER SUMMARY
  =============================== */

  checkoutSummary.innerHTML = `
    <div class="summary-card">
      <div class="summary-vehicle">
        <img
          src="${getVehicleMainImage(selectedAvailability.vehicle)}"
          alt="${escapeHtml(selectedAvailability.vehicle?.name || "Selected lorry")}"
          class="summary-vehicle-image"
        >
        <div>
          <div class="summary-vehicle-name">
            ${escapeHtml(selectedAvailability.vehicle?.name || "Selected lorry")}
          </div>
          <div class="summary-note">
            ${escapeHtml(formatDateOnly(selectedAvailability.pickupDate))} ·
            ${escapeHtml(formatDurationLabel(selectedAvailability.durationDays))}
            ${
              Number(selectedAvailability.durationDays) === 0.5
                ? ` · ${escapeHtml(formatPickupTimeLabel(selectedAvailability.pickupTime))}`
                : ""
            }
          </div>
        </div>
      </div>

      <div class="summary-row">
        <span>Base hire</span>
        <span>£${baseCost.toFixed(2)}</span>
      </div>

      ${
        discountAmount > 0
          ? `
      <div class="summary-row">
        <span>Discount</span>
        <span>-£${discountAmount.toFixed(2)}</span>
      </div>
      `
          : ""
      }

      ${
        earlyPickupEnabled
          ? `
      <div class="summary-row">
        <span>Early pickup</span>
        <span>Included</span>
      </div>
      `
          : ""
      }

      ${
        dartfordCount > 0
          ? `
      <div class="summary-row">
        <span>Dartford crossings (${dartfordCount})</span>
        <span>Included</span>
      </div>
      `
          : ""
      }

      ${
        extrasTotal > 0
          ? `
      <div class="summary-row">
        <span>Extras total</span>
        <span>£${extrasTotal.toFixed(2)}</span>
      </div>
      `
          : ""
      }

      ${notesHtml}

      <div class="summary-row total">
        <span>Total hire</span>
        <span>£${hireTotal.toFixed(2)}</span>
      </div>

      <div class="summary-row pay-now">
        <span>Pay now</span>
        <span>£${confirmationFee.toFixed(2)}</span>
      </div>

      <div class="summary-row outstanding">
        <span>Outstanding later</span>
        <span>£${outstandingAmount.toFixed(2)}</span>
      </div>

      <div class="summary-note">
        Required form: ${escapeHtml(requiredFormType)}
      </div>
    </div>
  `;
}

function updateHalfDayPickup() {
  const duration = Number(
    document.getElementById("selected-duration")?.value || 0,
  );
  const row = document.getElementById("pickup-time-row");

  if (!row) return;

  if (duration === 0.5) {
    row.style.display = "grid";

    /* highlight field so user notices it */

    row.classList.add("duration-highlight");

    setTimeout(() => {
      row.classList.remove("duration-highlight");
    }, 2000);
  } else {
    row.style.display = "none";
  }
}

async function updatePickupTimeVisibility() {
  if (BLOCK_AUTO_SCROLL) return;

  const duration = Number(durationDaysInput?.value || 0);
  const group = document.getElementById("pickup-time-group");

  if (!group || !pickupTimeInput) return;

  if (duration === 0.5) {
    group.style.display = "block";

    // ✅ FORCE manual user choice (prevents auto-submit flow)
    pickupTimeInput.value = "";

    // 🔥 Sync availability (NO await → prevents auto-chain reactions)
    const pickupDate = pickupDateInput?.value;
    if (pickupDate) {
      syncPickupTimeOptions(new Date(`${pickupDate}T00:00:00`));
    }

    setTimeout(() => {
      if (BLOCK_AUTO_SCROLL) return;

      group.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });

      // Highlight effect
      group.classList.add("duration-highlight");

      setTimeout(() => {
        group.classList.remove("duration-highlight");
      }, 2000);

      // Auto focus
      pickupTimeInput.focus();
    }, 150);
  } else {
    group.style.display = "none";

    // ✅ Full-day default (keeps existing behaviour)
    pickupTimeInput.value = "07:00";
  }
}

/* ======================================================
   AUTO AVAILABILITY SEARCH
====================================================== */

function autoCheckAvailability() {
  const pickupDate = pickupDateInput?.value;
  const duration = durationDaysInput?.value;

  if (!pickupDate || !duration) return;

  maybeAutoSubmitAvailability();
}

/* trigger when date changes */

pickupDateInput?.addEventListener("change", async () => {
  const pickupDate = pickupDateInput?.value;

  if (pickupDate) {
    window.__lastDurationCheck = "";

    const vehicleId =
      PRESELECTED_VEHICLE || selectedAvailability?.vehicle?.id || null;

    const vehicle = vehicleId ? vehicles.find((v) => v.id === vehicleId) : null;

    if (vehicle) {
      updateDurationOptionsForVehicle(vehicle);
      enforceVehicleDurationRules(vehicle);
    }

    await updateDurationOptions(pickupDate);

    if (selectedAvailability?.vehicle?.id) {
      await updateBookingDurationOptions(
        pickupDate,
        selectedAvailability.vehicle.id,
      );
    }
  }

  autoCheckAvailability();
});

/* trigger when duration changes */

/* ======================================================
   PREVENT IMPOSSIBLE DURATIONS
====================================================== */

function validateDurationSelection() {
  const duration = Number(durationDaysInput?.value || 0);
  const selectedDate = pickupDateInput?.value;

  if (!selectedDate || !duration) return true;

  if (!selectedAvailability) return true;

  const maxDuration = selectedAvailability.max_duration_days;

  if (maxDuration && duration > maxDuration) {
    alert(
      `This lorry is only available for ${maxDuration} day(s) from the selected date.`,
    );

    durationDaysInput.value = maxDuration;

    updateCheckoutSummary();

    return false;
  }

  return true;
}

/* ======================================================
   Fleet overlay content
====================================================== */

const FLEET_DETAIL_CONTENT = {
  "v35-1": {
    subtitle: "3.5T Safety Bar Lorry · LS23",
    intro:
      "A practical rear-facing 2-horse lorry with an externally releasable safety breast bar, designed for safe and straightforward self-drive hire.",
    highlights: [
      "Externally releasable safety breast bar",
      "Rear-facing 2-horse layout",
      "Horse camera and reversing camera",
      "Tack/changing area",
      "Roof ventilation and windows",
    ],
    bestFor: [
      "Shows, clinics and local trips",
      "Owners wanting a safety-bar layout",
      "Self-drive day hire and half-day hire when available",
    ],
    video: "",
  },

  "v35-2": {
    subtitle: "3.5T Stallion Lorry · DL22",
    intro:
      "A back-facing 2-horse stallion layout with high partitions and no breast bar, ideal for horses that prefer more individual space.",
    highlights: [
      "Stallion-style layout with high partitions",
      "No breast bar",
      "Horse camera and reversing camera",
      "Roof vent and windows",
      "Compact 3.5T self-drive option",
    ],
    bestFor: [
      "Stallions or horses needing extra separation",
      "Nervous travellers",
      "Shows, lessons, clinics and vet visits",
    ],
    video: "",
  },

  "v35-3": {
    subtitle: "3.5T Breast Bar Lorry · CA21",
    intro:
      "A back-facing 2-horse lorry with an adjustable breast bar, tack/changing room and camera system for confident everyday transport.",
    highlights: [
      "Adjustable breast bar",
      "Back-facing 2-horse layout",
      "Horse camera and reversing camera",
      "Tack/changing room",
      "Roof ventilation",
    ],
    bestFor: [
      "Everyday self-drive horsebox hire",
      "Shows, clinics and vet appointments",
      "Owners wanting a traditional breast-bar layout",
    ],
    video: "",
  },

  "v75-1": {
    subtitle: "7.5T 3 Horse with Living",
    intro:
      "A high-end 7.5T lorry for up to 3 horses, with living space for comfort on longer days, shows and overnight trips.",
    highlights: [
      "Carries up to 3 horses",
      "Living area",
      "Comfortable long-day transport",
      "Practical storage",
      "Professional 7.5T layout",
    ],
    bestFor: [
      "Longer show days",
      "Overnight events",
      "Multiple horses with living space required",
    ],
    video: "",
  },

  "v75-2": {
    subtitle: "7.5T 4 Horses No Living",
    intro:
      "A practical 7.5T lorry for up to 4 horses, with a large tack area and a functional layout where horse capacity is the priority.",
    highlights: [
      "Carries up to 4 horses",
      "Large tack/storage area",
      "No living section",
      "Functional multi-horse layout",
      "Ideal for yard or group transport",
    ],
    bestFor: [
      "Multiple horses",
      "Yard trips and group outings",
      "Owners prioritising horse capacity over living space",
    ],
    video: "",
  },
};


function getVehicleImagePrefix(vehicle) {
  const prefixes = {
    "v35-1": "3.5T With Safety Bar (LS23)",
    "v35-2": "3.5 T Stallion (DL22)",
    "v35-3": "3.5 T With Breast Bar (CA21)",
    "v75-1": "7.5 T 3 Horses with Living",
    "v75-2": "7.5 T 4 Horses No Living",
  };

  return prefixes[vehicle?.id] || "";
}

function getFleetImagesForVehicle(vehicle) {
  if (!vehicle) return [];

  const prefix = getVehicleImagePrefix(vehicle);
  let imageFiles = [];

  if (prefix && Array.isArray(window.fleetImages)) {
    imageFiles = window.fleetImages.filter((img) =>
      String(img || "").startsWith(prefix),
    );
  }

  if (!imageFiles.length && vehicle.image) {
    imageFiles = [vehicle.image.replace(/^images\//, "")];
  }

  return imageFiles.map((file) => {
    const value = String(file || "");
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value;
    return value.startsWith("images/") ? value : `images/${value}`;
  }).filter(Boolean);
}

function getVehiclePreviewImage(vehicle) {
  const images = typeof getFleetImagesForVehicle === "function"
    ? getFleetImagesForVehicle(vehicle)
    : [];

  if (images.length) {
    return images[0];
  }

  return vehicle?.image || "";
}


function getFleetDetail(vehicle) {
  const fallbackHorses = vehicle?.horses || (String(vehicle?.id || "").startsWith("v35") ? 2 : "");
  const fallbackSubtitle = [
    vehicle?.type,
    vehicle?.code,
    fallbackHorses ? `${fallbackHorses} horses` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    subtitle: fallbackSubtitle,
    intro: vehicle?.summary || "",
    highlights: [],
    bestFor: [],
    video: "",
    ...(FLEET_DETAIL_CONTENT[vehicle?.id] || {}),
  };
}

function renderFleetList(items) {
  if (!Array.isArray(items) || !items.length) return "";

  return `
    <ul>
      ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
    </ul>
  `;
}

function ensureFleetDetailOverlay() {
  let overlay = document.getElementById("fleet-detail-overlay");

  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "fleet-detail-overlay";
    overlay.className = "fleet-detail-overlay";
    overlay.hidden = true;

    overlay.innerHTML = `
      <div class="fleet-detail-modal" role="dialog" aria-modal="true" aria-labelledby="fleet-detail-title">
        <button class="fleet-detail-close" type="button" data-fleet-overlay-close aria-label="Close lorry details">
          ×
        </button>

        <div class="fleet-detail-body">
          <div class="fleet-detail-media">
            <div class="fleet-detail-main-image"></div>
            <div class="fleet-detail-gallery"></div>
            <div class="fleet-detail-video"></div>
          </div>

          <div class="fleet-detail-copy">
            <p class="kicker">Fleet details</p>
            <h2 id="fleet-detail-title"></h2>
            <p class="fleet-detail-subtitle"></p>
            <p class="fleet-detail-intro"></p>

            <div class="fleet-detail-info-grid">
              <div>
                <h3>Highlights</h3>
                <div class="fleet-detail-highlights"></div>
              </div>

              <div>
                <h3>Best for</h3>
                <div class="fleet-detail-best-for"></div>
              </div>
            </div>

            <div class="fleet-detail-actions">
              <button class="btn fleet-detail-book" type="button">
                Book this lorry
              </button>
              <button class="btn ghost" type="button" data-fleet-overlay-close>
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.addEventListener("click", (event) => {
      if (
        event.target === overlay ||
        event.target.closest("[data-fleet-overlay-close]")
      ) {
        closeFleetDetailOverlay();
      }
    });

    overlay.querySelector(".fleet-detail-book")?.addEventListener("click", () => {
      const vehicleId = overlay.dataset.vehicleId;
      closeFleetDetailOverlay();

      if (vehicleId) {
        startBooking(vehicleId);
      }
    });
  }

  return overlay;
}

function openFleetDetailOverlay(vehicleId) {
  const vehicle = vehicles.find((item) => item.id === vehicleId);
  if (!vehicle) return;

  const detail = getFleetDetail(vehicle);
  const images = getFleetImagesForVehicle(vehicle);
  const mainImage = images[0] || vehicle.image || "";

  const overlay = ensureFleetDetailOverlay();
  overlay.dataset.vehicleId = vehicle.id;

  const title = overlay.querySelector("#fleet-detail-title");
  const subtitle = overlay.querySelector(".fleet-detail-subtitle");
  const intro = overlay.querySelector(".fleet-detail-intro");
  const mainImageWrap = overlay.querySelector(".fleet-detail-main-image");
  const gallery = overlay.querySelector(".fleet-detail-gallery");
  const video = overlay.querySelector(".fleet-detail-video");
  const highlights = overlay.querySelector(".fleet-detail-highlights");
  const bestFor = overlay.querySelector(".fleet-detail-best-for");

  if (title) title.textContent = vehicle.name;
  if (subtitle) subtitle.textContent = detail.subtitle || "";
  if (intro) intro.textContent = detail.intro || vehicle.summary || "";

  if (mainImageWrap) {
    mainImageWrap.innerHTML = mainImage
      ? `<img src="${escapeHtml(mainImage)}" alt="${escapeHtml(vehicle.name)}">`
      : "";
  }

  if (gallery) {
    gallery.innerHTML = images
      .slice(0, 8)
      .map(
        (src) => `
          <button class="fleet-detail-thumb" type="button" aria-label="Show image">
            <img src="${escapeHtml(src)}" alt="${escapeHtml(vehicle.name)}">
          </button>
        `,
      )
      .join("");

    gallery.querySelectorAll(".fleet-detail-thumb").forEach((thumb) => {
      thumb.addEventListener("click", () => {
        const img = thumb.querySelector("img");
        if (!img || !mainImageWrap) return;

        mainImageWrap.innerHTML = `
          <img src="${escapeHtml(img.getAttribute("src"))}" alt="${escapeHtml(vehicle.name)}">
        `;
      });
    });
  }

  if (video) {
    if (detail.video) {
      video.innerHTML = `
        <h3>Video</h3>
        <video controls playsinline preload="metadata" poster="${escapeHtml(mainImage)}">
          <source src="${escapeHtml(detail.video)}" type="video/mp4">
          Your browser does not support video playback.
        </video>
      `;
    } else {
      video.innerHTML = `
        <h3>Video</h3>
        <div class="fleet-detail-video-placeholder">
          Video coming soon.
        </div>
      `;
    }
  }

  if (highlights) {
    highlights.innerHTML = renderFleetList(detail.highlights);
  }

  if (bestFor) {
    bestFor.innerHTML = renderFleetList(detail.bestFor);
  }

  overlay.hidden = false;
  document.body.classList.add("fleet-detail-open");

  setTimeout(() => {
    overlay.querySelector(".fleet-detail-close")?.focus();
  }, 0);
}

function closeFleetDetailOverlay() {
  const overlay = document.getElementById("fleet-detail-overlay");
  if (!overlay) return;

  const activeVideo = overlay.querySelector("video");
  if (activeVideo) {
    activeVideo.pause();
    activeVideo.currentTime = 0;
  }

  overlay.hidden = true;
  document.body.classList.remove("fleet-detail-open");
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeFleetDetailOverlay();
  }
});

function renderFleet() {
  if (!fleetGrid) return;
  fleetGrid.innerHTML = "";

  vehicles.forEach((vehicle) => {
    const card = document.createElement("article");
    card.className = "fleet-card";

    const livingLabel =
      vehicle.pricingModel === "75_no_living_rules"
        ? "no living"
        : vehicle.overnight
          ? "living"
          : "no living";

    const imageFiles = getFleetImagesForVehicle(vehicle);
    const firstImage = imageFiles[0] || vehicle.image || "";
    const horseCount =
      vehicle.horses || (String(vehicle.id || "").startsWith("v35") ? 2 : "");

    const imageWrap = document.createElement("div");
    imageWrap.className = "fleet-image-wrap";

    const img = document.createElement("img");
    img.src = firstImage;
    img.alt = vehicle.name;

    const overlay = document.createElement("div");
    overlay.className = "fleet-overlay";
    overlay.innerHTML = `
      <button class="apple-play-btn fleet-see-more" type="button" data-lorry-id="${escapeHtml(vehicle.id)}">
        <span>See more</span>
      </button>
    `;

    imageWrap.appendChild(img);
    imageWrap.appendChild(overlay);

    const content = document.createElement("div");
    content.className = "fleet-content";
    content.innerHTML = `
      <h3>${escapeHtml(vehicle.name)}</h3>
      <p class="muted">
        ${escapeHtml(vehicle.type)}
        ${vehicle.code ? ` · ${escapeHtml(vehicle.code)}` : ""}
        ${horseCount ? ` · ${escapeHtml(horseCount)} horses` : ""}
        · ${vehicle.seats} seats · ${escapeHtml(livingLabel)}
      </p>
      <p class="muted tiny">${escapeHtml(vehicle.summary)}</p>
      <p><strong>From £${Number(vehicle.dayRate).toFixed(0)}</strong> / day</p>

      <button class="btn fleet-card-book" type="button" data-lorry-id="${escapeHtml(vehicle.id)}">
        Book this Lorry
      </button>
    `;

    card.appendChild(imageWrap);
    card.appendChild(content);

    card.querySelector(".fleet-see-more")?.addEventListener("click", (e) => {
      e.stopPropagation();
      openFleetDetailOverlay(vehicle.id);
    });

    content
      .querySelector(".fleet-card-book")
      ?.addEventListener("click", (e) => {
        e.stopPropagation();
        openFleetDetailOverlay(vehicle.id);
      });

    fleetGrid.appendChild(card);
  });
}

/* ======================================================
   Booking helpers (select from fleet / results)
====================================================== */

async function fetchBookingWithRetry(sessionId, attempts = 5) {
  if (!sessionId) return null;

  if (BOOKING_BY_SESSION_PROMISES.has(sessionId)) {
    return BOOKING_BY_SESSION_PROMISES.get(sessionId);
  }

  const requestPromise = (async () => {
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await fetch(
          apiUrl(
            `/api/bookings/by-session?session_id=${encodeURIComponent(sessionId)}`,
          ),
        );

        if (res.ok) {
          const data = await res.json();

          console.log(`🔁 Retry ${i + 1}/${attempts}`, data);

          if (data?.booking?.pickupAt) {
            return data.booking;
          }
        }
      } catch (err) {
        console.warn(`Retry attempt ${i + 1} failed`, err);
      }

      /* ===============================
         🔥 IMPROVED BACKOFF
      =============================== */

      if (i < attempts - 1) {
        const delay = Math.min(300 + i * 400, 2500);

        console.log(`⏳ waiting ${delay}ms before retry`);

        await new Promise((r) => setTimeout(r, delay));
      }
    }

    return null;
  })();

  BOOKING_BY_SESSION_PROMISES.set(sessionId, requestPromise);

  try {
    return await requestPromise;
  } finally {
    BOOKING_BY_SESSION_PROMISES.delete(sessionId);
  }
}

function getVehicleMainImage(vehicle) {
  if (!vehicle) return "";

  const map = {
    "v35-1": "images/3.5T With Safety Bar (LS23)1.webp",
    "v35-2": "images/3.5 T Stallion (DL22)1.webp",
    "v35-3": "images/3.5 T With Breast Bar (CA21)1.webp",
    "v75-1": "images/7.5 T 3 Horses with Living1.webp",
    "v75-2": "images/7.5 T 4 Horses No Living1.webp",
  };

  return map[vehicle.id] || "";
}

function changeLorry() {
  goToStep(2);

  const pickupDate = pickupDateInput?.value;
  const duration = durationDaysInput?.value;

  if (!pickupDate || !duration) {
    availabilityResults.innerHTML = "Select a date and duration first.";
    return;
  }

  availabilityResults.innerHTML = "Checking availability...";

  setTimeout(() => {
    availabilityForm?.dispatchEvent(new Event("submit", { cancelable: true }));
  }, 150);
}

function updateDurationOptionsForVehicle(vehicle) {
  const durationSelect = document.getElementById("duration-days");
  if (!durationSelect) return;

  const halfDayOption = durationSelect.querySelector('option[value="0.5"]');
  if (!halfDayOption) return;

  const pickupDate = pickupDateInput?.value || "";
  const hideHalfDay = shouldHideHalfDayForDateAndVehicle(pickupDate, vehicle);

  if (hideHalfDay) {
    showHalfDayAsUnavailable(halfDayOption, pickupDate, vehicle);

    if (durationSelect.value === "0.5") {
      durationSelect.value = "";
    }
  } else {
    showHalfDayAsAvailable(halfDayOption);
  }
}

function updateCalendarVehicleLabel() {
  const label = document.getElementById("calendar-vehicle-label");
  if (!label) return;

  if (!PRESELECTED_VEHICLE) {
    label.classList.add("hidden");
    label.textContent = "";
    return;
  }

  const vehicle = vehicles.find((v) => v.id === PRESELECTED_VEHICLE);

  label.textContent = `Booking: ${vehicle?.name || "Selected vehicle"}`;
  label.classList.remove("hidden");
}

function populateBookingDurationSelect(vehicle) {
  const select = selectedDurationInput;
  if (!(select instanceof HTMLSelectElement)) return;

  const currentVal = select.value;
  let hasCurrentVal = false;

  Array.from(select.options).forEach((opt) => {
    const isValid = !vehicle || supportsDuration(vehicle, Number(opt.value));
    opt.disabled = !isValid;
    opt.hidden = !isValid;
    if (opt.value === currentVal && isValid) hasCurrentVal = true;
  });

  if (!hasCurrentVal) {
    const firstValid = Array.from(select.options).find((opt) => !opt.disabled);
    if (firstValid) select.value = firstValid.value;
  }
}

async function bookFromVehicle(vehicleId) {
  const vehicle = vehicles.find((v) => v.id === vehicleId);
  if (!vehicle) return;

  /* remember selected vehicle */
  PRESELECTED_VEHICLE = vehicleId;

  const today = new Date().toISOString().slice(0, 10);
  const defaultDate = pickupDateInput?.value || today;

  if (selectedLorryInput) selectedLorryInput.value = vehicle.name;
  if (selectedPickupInput) selectedPickupInput.value = defaultDate;

  if (selectedDurationInput) {
    populateBookingDurationSelect(vehicle);
    if (supportsDuration(vehicle, 1)) selectedDurationInput.value = "1";
  }

  const durationDays = Number(selectedDurationInput?.value) || 1;
  const pickupTime = DEFAULT_PICKUP_TIME;
  const code = getCurrentDiscountCode();

  selectedAvailability = await buildAvailability(
    vehicle,
    defaultDate,
    durationDays,
    pickupTime,
    code,
  );

  if (selectedBaseInput) {
    selectedBaseInput.value = `£${Number(selectedAvailability.baseCost ?? 0).toFixed(2)}`;
  }

  /* skip vehicle selection step */
  goToStep(3);

  await checkBookingFormAvailability();

  const bookingSection = document.querySelector("#booking");
  bookingSection?.scrollIntoView({ behavior: "smooth", block: "start" });

  setTimeout(() => selectedPickupInput?.focus(), 600);
}

async function selectAvailability(vehicleId) {
  const pickupDate = pickupDateInput?.value;
  let pickupTime = pickupTimeInput?.value || null;
  const durationDays = Number(durationDaysInput?.value);

  const vehicle = vehicles.find((item) => item.id === vehicleId);

  if (
    !vehicle ||
    !pickupDate ||
    durationDays <= 0 ||
    !supportsDuration(vehicle, durationDays)
  ) {
    return;
  }

  /* ===============================
     PICKUP TIME RULES
  =============================== */

  if (is35T(vehicle) && durationDays === 0.5) {
    if (!HALF_DAY_PICKUP_TIMES_35T.includes(pickupTime)) {
      pickupTime = null;
    }

    if (!pickupTime) {
      console.log("⛔ waiting for valid pickup time");
      return;
    }
  } else {
    pickupTime = DEFAULT_PICKUP_TIME;
  }

  /* ===============================
   FINAL SAFETY CHECK
=============================== */

  const check = await getVehicleAvailability(
    pickupDate,
    durationDays,
    durationDays === 0.5 ? pickupTime : null,
    { forceFresh: true },
  );

  // 🔥 KEEP GLOBAL STATE IN SYNC
  LAST_AVAILABLE_VEHICLES = check;

  if (!check || !check.length) {
    console.warn("⚠️ No availability response");
    return;
  }

  const apiVehicle = check.find((v) => v.vehicleId === vehicleId);

  const valid =
    durationDays === 0.5
      ? Array.isArray(apiVehicle?.availableSlots) &&
        apiVehicle.availableSlots.length > 0
      : !!apiVehicle?.available;

  if (!valid) {
    console.warn("❌ Invalid duration (selectAvailability)");

    safeRenderAvailability(`
    <div class="empty-note">
      ❌ This lorry is not available for that duration.<br>
      Please select a shorter hire period.
    </div>
  `);

    // 🔥 HARD RESET (CRITICAL)
    selectedAvailability = null;
    window.pendingBooking = null;

    if (durationDaysInput) durationDaysInput.value = "";
    if (selectedDurationInput) selectedDurationInput.value = "";
    if (selectedBaseInput) selectedBaseInput.value = "";

    if (bookingSubmitBtn) bookingSubmitBtn.disabled = true;

    updateCheckoutSummary();

    return;
  }

  /* ===============================
     BUILD AVAILABILITY
  =============================== */

  const code = getCurrentDiscountCode();

  selectedAvailability = await buildAvailability(
    vehicle,
    pickupDate,
    durationDays,
    pickupTime,
    code,
  );

  if (!selectedAvailability) return;

  if (selectedLorryInput) selectedLorryInput.value = vehicle.name;
  if (selectedPickupInput) selectedPickupInput.value = pickupDate;

  populateBookingDurationSelect(vehicle);

  if (selectedDurationInput) {
    selectedDurationInput.value = String(durationDays);
  }

  updateHalfDayPickup();

  const bookingTimeInput = document.getElementById("booking-pickup-time");
  if (bookingTimeInput && durationDays === 0.5) {
    bookingTimeInput.value = pickupTime;
  }

  if (durationDays === 0.5) {
    await syncBookingPickupTimeOptions(pickupDate, vehicle.id);
  }

  updateEarlyPickupAvailability();

  if (selectedBaseInput) {
    selectedBaseInput.value = `£${Number(selectedAvailability.baseCost ?? 0).toFixed(2)}`;
  }

  const statusEl = document.getElementById("booking-availability-status");
  if (statusEl) statusEl.hidden = true;
  if (bookingSuccess) bookingSuccess.hidden = true;

  updateCheckoutSummary();

  checkoutSummary?.scrollIntoView({
    behavior: "smooth",
    block: "nearest",
  });
}

async function checkBookingFormAvailability() {
  if (!selectedAvailability || !selectedPickupInput || !selectedDurationInput)
    return;

  const statusEl = document.getElementById("booking-availability-status");

  const vehicle = selectedAvailability.vehicle;
  const pickupDate = selectedPickupInput.value;
  let durationDays = Number(selectedDurationInput.value);

  const weekendHalfDayWasBlocked = applyBookingWeekendHalfDayRule(
    pickupDate,
    vehicle,
    false,
  );

  if (weekendHalfDayWasBlocked) {
    durationDays = Number(selectedDurationInput.value);
  }

  if (!pickupDate || !durationDays || durationDays <= 0) {
    if (statusEl) {
      statusEl.textContent = "Please select a valid date and duration.";
      statusEl.className = "availability-status error full";
      statusEl.hidden = false;
    }
    if (bookingSubmitBtn) bookingSubmitBtn.disabled = true;
    return;
  }

  if (!supportsDuration(vehicle, durationDays)) {
    if (statusEl) {
      statusEl.textContent = `${vehicle.name} does not support this duration.`;
      statusEl.className = "availability-status error full";
      statusEl.hidden = false;
    }
    if (bookingSubmitBtn) bookingSubmitBtn.disabled = true;
    return;
  }

  /* ===============================
     🔥 FIXED PICKUP TIME PRIORITY
  =============================== */

  const bookingTime = document.getElementById("booking-pickup-time")?.value;

  const bookingPickupTime =
    bookingTime || selectedAvailability.pickupTime || DEFAULT_PICKUP_TIME;

  const pickupTime =
    is35T(vehicle) && durationDays === 0.5
      ? bookingPickupTime
      : DEFAULT_PICKUP_TIME;

  /* ===============================
     AVAILABILITY CHECK
  =============================== */

  const vehiclesAvailability = await getVehicleAvailability(
    pickupDate,
    durationDays,
    pickupTime,
  );

  // 🔥 ADD THIS HERE ONLY
  LAST_AVAILABLE_VEHICLES = vehiclesAvailability;

  const v = vehiclesAvailability.find((x) => x.vehicleId === vehicle.id);

  let available = false;

  if (durationDays === 0.5) {
    available = Array.isArray(v?.availableSlots) && v.availableSlots.length > 0;
  } else {
    available = !!v?.available;
  }

  if (available) {
    /* ===============================
       REBUILD AVAILABILITY (KEEP DISCOUNT)
    =============================== */

    const code = getCurrentDiscountCode();

    selectedAvailability = await buildAvailability(
      vehicle,
      pickupDate,
      durationDays,
      pickupTime,
      code,
    );

    if (selectedBaseInput) {
      selectedBaseInput.value = `£${Number(selectedAvailability.baseCost ?? 0).toFixed(2)}`;
    }

    if (statusEl) {
      const weekendNotice = getWeekendHalfDayNotice(pickupDate, vehicle);

      if (BOOKING_WEEKEND_HALF_DAY_NOTICE) {
        statusEl.textContent =
          "No 1/2 day hires are available during weekends. Duration has been changed to 1 day.";
        statusEl.className = "availability-status error full";
      } else {
        statusEl.textContent = `${vehicle.name} is available for the selected date and duration.${weekendNotice}`;
        statusEl.className = "availability-status ok full";
      }

      statusEl.hidden = false;
    }

    if (bookingSubmitBtn) bookingSubmitBtn.disabled = false;

    updateCheckoutSummary();
    scheduleRequiredFormCheck(250);

    /* ===============================
       🔥 CRITICAL FIX
       Sync early pickup AFTER recalculation
    =============================== */

    updateEarlyPickupAvailability();
  } else {
    if (statusEl) {
      statusEl.textContent =
        durationDays === 0.5 && isWeekendDate(pickupDate)
          ? "No 1/2 day hires are available during weekends. Please choose 1 day or longer."
          : `${vehicle.name} is not available for the selected date and duration. Please choose different dates.`;
      statusEl.className = "availability-status error full";
      statusEl.hidden = false;
    }

    if (bookingSubmitBtn) bookingSubmitBtn.disabled = true;

    /* also keep UI consistent */
    updateEarlyPickupAvailability();
  }
}

/* ======================================================
   Voucher apply button
====================================================== */

if (applyDiscountBtn) {
  applyDiscountBtn.addEventListener("click", async () => {
    if (!selectedAvailability) return;

    const code = getCurrentDiscountCode();
    if (!code) {
      if (discountMessage) {
        discountMessage.hidden = false;
        discountMessage.textContent = "Please enter a voucher code.";
        discountMessage.className = "voucher-message error tiny";
      }
      return;
    }

    applyDiscountBtn.disabled = true;
    applyDiscountBtn.textContent = "Applying…";

    try {
      const updated = await buildAvailability(
        selectedAvailability.vehicle,
        selectedAvailability.pickupDate,
        selectedAvailability.durationDays,
        selectedAvailability.pickupTime,
        code,
      );

      selectedAvailability = updated;
      updateCheckoutSummary();

      if (discountMessage) {
        discountMessage.hidden = false;
        if (Number(updated.discountAmount) > 0) {
          discountMessage.textContent = "Voucher applied ✓";
          discountMessage.className = "voucher-message ok tiny";
        } else {
          discountMessage.textContent =
            "Voucher not valid — booking will continue at normal price.";
          discountMessage.className = "voucher-message muted tiny";
        }
      }
    } catch (err) {
      if (discountMessage) {
        discountMessage.hidden = false;
        discountMessage.textContent =
          err?.message || "Invalid or expired voucher.";
        discountMessage.className = "voucher-message error tiny";
      }
    } finally {
      applyDiscountBtn.disabled = false;
      applyDiscountBtn.textContent = "Apply";
    }
  });
}

/* ======================================================
   Booking + Admin rendering
====================================================== */

async function renderBookings() {
  if (!bookingList) return;

  const bookings = (await getBookings()).sort(
    (a, b) => new Date(a.pickupAt) - new Date(b.pickupAt),
  );
  if (!bookings.length) {
    bookingList.innerHTML =
      '<div class="booking-item muted">No bookings yet. Your first booking will appear here.</div>';
    return;
  }

  bookingList.innerHTML = bookings
    .map((booking) => {
      const vehicle = vehicles.find((item) => item.id === booking.vehicleId);

      const extras = booking.extras || {};

      let notesLine = "";

      if (booking.customerNotes) {
        notesLine = `
    <div class="admin-notes">
      Notes: ${escapeHtml(booking.customerNotes)}
    </div>
  `;
      }

      const earlyPickup = !!extras.earlyPickup;
      const dartfordCount = Number(extras.dartford || 0);

      let extrasLine = "";

      if (earlyPickup || dartfordCount > 0) {
        const parts = [];

        if (earlyPickup) {
          parts.push("Early pickup (£20)");
        }

        if (dartfordCount > 0) {
          parts.push(
            `Dartford x${dartfordCount} (£${(dartfordCount * 4.2).toFixed(2)})`,
          );
        }

        extrasLine = `
        <span class="muted">Extras: ${parts.join(" · ")}</span><br>
      `;
      }

      /* ===============================
       CARD
    =============================== */

      return `
  <article class="booking-item">
    <strong>${escapeHtml(vehicle?.name || booking.vehicleId)}</strong><br>

    ${escapeHtml(formatDateOnly(booking.pickupAt.slice(0, 10)))} ·
    ${escapeHtml(formatTime(booking.pickupAt))} → ${escapeHtml(formatTime(booking.dropoffAt))}<br>

    <span class="muted">
      Duration: ${escapeHtml(formatDurationLabel(booking.durationDays))}
    </span><br>

    ${escapeHtml(booking.customerName)} · ${escapeHtml(booking.customerEmail)}<br>

    <span class="muted">Status: ${escapeHtml(booking.status)}</span><br>

    ${extrasLine}

    ${notesLine}   <!-- 🔥 THIS IS THE FIX -->

    <span class="muted">
      Paid now: £${Number(booking.confirmationFee).toFixed(2)} · 
      Outstanding: £${Number(booking.outstandingAmount).toFixed(2)}
    </span><br>

    <span class="muted">
      Total hire: £${Number(booking.hireTotal).toFixed(2)}
    </span>
  </article>
`;
    })
    .join("");
}

async function renderAdminBookings() {
  if (!adminBookings) return;

  const bookings = (await getBookings()).sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  );

  if (!bookings.length) {
    adminBookings.innerHTML =
      '<p class="empty-note">No bookings saved yet.</p>';
    return;
  }

  const rows = bookings
    .map((booking) => {
      const vehicle = vehicles.find((item) => item.id === booking.vehicleId);

      const notes = booking.customerNotes || "";

      const isImportant = /urgent|call|late|asap/i.test(notes);

      return `
        <tr>
          <td>${escapeHtml(vehicle?.name || booking.vehicleId)}</td>
          <td>${escapeHtml(booking.customerName)}</td>
          <td>${escapeHtml(booking.customerEmail)}</td>
          <td>${escapeHtml(booking.customerMobile)}</td>

          <td>
            ${escapeHtml(formatDateOnly(booking.pickupAt.slice(0, 10)))}<br>
            <span class="muted">
              ${escapeHtml(formatTime(booking.pickupAt))} →
              ${escapeHtml(formatTime(booking.dropoffAt))}
            </span>
          </td>

          <td>${escapeHtml(formatDurationLabel(booking.durationDays))}</td>

          <td>
            ${
              booking.extras?.earlyPickup
                ? `£${EARLY_PICKUP_PRICE.toFixed(2)}`
                : "—"
            }
          </td>

          <td>
            ${
              booking.extras?.dartford
                ? `${booking.extras.dartford} (£${(
                    booking.extras.dartford * DARTFORD_CROSSING_PRICE
                  ).toFixed(2)})`
                : "—"
            }
          </td>

          <td>£${Number(booking.extrasTotal || 0).toFixed(2)}</td>

          <!-- ✅ NOTES COLUMN WITH HIGHLIGHT -->
          <td
            class="${isImportant ? "notes-important" : ""}"
            title="${escapeHtml(notes)}"
          >
            ${
              notes
                ? escapeHtml(notes.slice(0, 40)) +
                  (notes.length > 40 ? "…" : "")
                : "—"
            }
          </td>

          <td>£${Number(booking.confirmationFee).toFixed(2)}</td>
          <td>£${Number(booking.outstandingAmount).toFixed(2)}</td>

          <td>${booking.requiredFormType === "short" ? "Short" : "Long"}</td>

          <td>
            ${
              booking.requiredFormLink
                ? `<a href="${escapeHtml(
                    booking.requiredFormLink,
                  )}" target="_blank" rel="noopener">Open form</a>`
                : "—"
            }
          </td>

          <td>${escapeHtml(booking.status)}</td>
          <td>${escapeHtml(formatDateTime(booking.reminderAt))}</td>
        </tr>
      `;
    })
    .join("");

  adminBookings.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>Vehicle</th>
          <th>Name</th>
          <th>Email</th>
          <th>Mobile</th>
          <th>Pickup</th>
          <th>Duration</th>
          <th>Early Pickup</th>
          <th>Dartford</th>
          <th>Extras Total</th>
          <th>Notes</th>
          <th>Paid Now</th>
          <th>Outstanding</th>
          <th>Required Form</th>
          <th>Form Link</th>
          <th>Status</th>
          <th>Reminder</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function csvEscape(value) {
  const normalized = String(value ?? "");
  if (/[",\n]/.test(normalized)) return `"${normalized.replace(/"/g, '""')}"`;
  return normalized;
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function exportAdminCsv() {
  const bookings = (await getBookings()).sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
  );

  const lines = [
    "Booking ID,Vehicle,Customer Name,Email,Mobile,Address,DOB,Pickup,Drop-off,Duration Days,Early Pickup,Dartford Crossings,Hire Total,Paid Now,Outstanding,Deposit,Required Form,Required Form Link,Status,Reminder At,Created",
  ];

  if (!bookings.length) {
    lines.push("No bookings saved,,,,,,,,,,,,,,,,,,,");
  } else {
    bookings.forEach((booking) => {
      const vehicle = vehicles.find((item) => item.id === booking.vehicleId);

      lines.push(
        [
          booking.id,
          vehicle?.name || booking.vehicleId,
          booking.customerName,
          booking.customerEmail,
          booking.customerMobile,
          booking.customerAddress,
          booking.customerDob,

          // 🔥 FIXED DATE + TIME FORMAT
          `${formatDateOnly(booking.pickupAt.slice(0, 10))} (${formatTime(booking.pickupAt)} → ${formatTime(booking.dropoffAt)})`,

          booking.durationDays,

          // 🔥 FIXED EXTRAS SOURCE
          booking.extras?.earlyPickup ? "Yes" : "No",
          booking.extras?.dartford || 0,

          `£${Number(booking.hireTotal).toFixed(2)}`,
          `£${Number(booking.confirmationFee).toFixed(2)}`,
          `£${Number(booking.outstandingAmount).toFixed(2)}`,
          `£${Number(booking.depositAmount).toFixed(2)}`,

          booking.requiredFormType === "short" ? "Short" : "Long",
          booking.requiredFormLink,
          booking.status,

          formatDateTime(booking.reminderAt),
          formatDateTime(booking.createdAt),
        ]
          .map(csvEscape)
          .join(","),
      );
    });
  }

  const stamp = new Date().toISOString().slice(0, 10);

  downloadFile(
    lines.join("\n"),
    `equine-bookings-${stamp}.csv`,
    "text/csv;charset=utf-8",
  );
}

async function exportAdminPdf() {
  const bookings = (await getBookings()).sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
  );

  const stamp = new Date().toISOString().slice(0, 10);

  const rows = bookings.length
    ? bookings
        .map((booking) => {
          const vehicle = vehicles.find(
            (item) => item.id === booking.vehicleId,
          );

          const earlyPickup = booking.extras?.earlyPickup;
          const dartford = Number(booking.extras?.dartford || 0);

          return `
            <tr>
              <td>${escapeHtml(vehicle?.name || booking.vehicleId)}</td>
              <td>${escapeHtml(booking.customerName)}</td>
              <td>${escapeHtml(booking.customerEmail)}</td>

              <td>
                ${escapeHtml(formatDateOnly(booking.pickupAt.slice(0, 10)))}<br>
                ${escapeHtml(formatTime(booking.pickupAt))} →
                ${escapeHtml(formatTime(booking.dropoffAt))}
              </td>

              <td>${escapeHtml(formatDurationLabel(booking.durationDays))}</td>

              <td>
                ${earlyPickup ? `£${EARLY_PICKUP_PRICE.toFixed(2)}` : "—"}
              </td>

              <td>
                ${
                  dartford > 0
                    ? `${dartford} (£${(
                        dartford * DARTFORD_CROSSING_PRICE
                      ).toFixed(2)})`
                    : "—"
                }
              </td>

              <td>£${Number(booking.extrasTotal || 0).toFixed(2)}</td>

              <!-- ✅ NOTES -->
              <td>
                ${
                  booking.customerNotes
                    ? escapeHtml(booking.customerNotes)
                    : "—"
                }
              </td>

              <td>£${Number(booking.confirmationFee).toFixed(2)}</td>
              <td>£${Number(booking.outstandingAmount).toFixed(2)}</td>

              <td>${escapeHtml(booking.status)}</td>
            </tr>
          `;
        })
        .join("")
    : "<tr><td colspan='12'>No bookings saved.</td></tr>";

  const reportHtml = `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>Equine Booking Export ${stamp}</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            margin: 24px;
            color: #111827;
          }
          h1 { margin: 0 0 8px; }
          .meta { margin-bottom: 16px; color: #4b5563; }

          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 11px;
          }

          th, td {
            border: 1px solid #d1d5db;
            padding: 6px;
            text-align: left;
            vertical-align: top;
          }

          th {
            background: #f3f4f6;
          }
        </style>
      </head>
      <body>
        <h1>Equine Transport UK Booking Export</h1>
        <div class="meta">
          Generated: ${escapeHtml(new Date().toLocaleString())}
        </div>

        <table>
          <thead>
            <tr>
              <th>Vehicle</th>
              <th>Name</th>
              <th>Email</th>
              <th>Pickup</th>
              <th>Duration</th>
              <th>Early</th>
              <th>Dartford</th>
              <th>Extras</th>
              <th>Notes</th>
              <th>Paid</th>
              <th>Outstanding</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </body>
    </html>
  `;

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Please allow pop-ups to export PDF.");
    return;
  }

  printWindow.document.open();
  printWindow.document.write(reportHtml);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

async function createStripeCheckoutSession(booking) {
  if (checkoutLock) return null;
  checkoutLock = true;

  setButtonBusy(bookingSubmitBtn, true, "Starting secure checkout...");

  try {
    /* ===============================
       HARD FRONTEND REVALIDATION
    =============================== */

    if (!selectedAvailability) {
      alert("Please select a valid date and duration before continuing.");
      return null;
    }

    const vehicle = selectedAvailability.vehicle;
    const pickupDate = selectedAvailability.pickupDate;
    const durationDays = Number(selectedAvailability.durationDays);

    const pickupTime =
      durationDays === 0.5
        ? selectedAvailability.pickupTime || pickupTimeInput?.value || null
        : DEFAULT_PICKUP_TIME;

    if (!vehicle || !pickupDate || !durationDays) {
      alert("Booking data is incomplete. Please re-check availability.");
      return null;
    }

    const liveAvailability = await getVehicleAvailability(
      pickupDate,
      durationDays,
      durationDays === 0.5 ? pickupTime : null,
      { forceFresh: true },
    );

    const apiVehicle = liveAvailability.find((v) => v.vehicleId === vehicle.id);

    const stillAvailable =
      durationDays === 0.5
        ? Array.isArray(apiVehicle?.availableSlots) &&
          apiVehicle.availableSlots.length > 0
        : !!apiVehicle?.available;

    if (!stillAvailable) {
      alert("This lorry is no longer available for the selected duration.");

      clearAvailabilityCaches();

      selectedAvailability = null;
      window.pendingBooking = null;

      if (durationDaysInput) durationDaysInput.value = "";
      if (selectedDurationInput) selectedDurationInput.value = "";
      if (selectedBaseInput) selectedBaseInput.value = "";

      updateCheckoutSummary();
      resetAvailabilityAutoSubmitState();
      window.__lastDurationCheck = "";
      goToStep(2);

      if (pickupDate) {
        await updateDurationOptions(pickupDate);
        maybeAutoSubmitAvailability();
      }

      return null;
    }

    /* ===============================
       EXTRAS
    =============================== */

    const dartfordCount = Number(dartfordCountInput?.value || 0);
    const dartfordEnabled = dartfordEnabledInput?.checked === true;
    const earlyPickupChecked = earlyPickupEnabledInput?.checked === true;

    const extras = {
      dartford: dartfordEnabled ? dartfordCount : 0,
      earlyPickup: earlyPickupChecked ? 1 : 0,
    };

    console.log("🚀 SENDING EXTRAS (FINAL):", extras);

    /* ===============================
   REQUEST (FIXED — NAME INCLUDED)
=============================== */

    const notesInput = document.getElementById("customer-notes");
    const rawNotes = (notesInput?.value || "").trim();

    const customerNotes = rawNotes ? rawNotes.slice(0, 500) : null;

    /* ===============================
   🔥 DEBUG (REMOVE LATER)
=============================== */
    console.log("🧪 SENDING NAME:", customerNameInput?.value);

    const requiredFormType = await checkRequiredFormRequirement({ force: true });
    booking.requiredFormType = requiredFormType;
    booking.requiredFormLink =
      requiredFormType === "short" ? booking.formLinkA : booking.formLinkB;
    booking.hiredWithinLast3Months = requiredFormType === "short";

    const { response, data } = await fetchJsonWithTimeout(
      apiUrl("/api/bookings/create-checkout-session"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({
          vehicleId: vehicle.id,
          vehicleName: vehicle.name,

          pickupDate: booking.pickupAt,
          pickupTime: booking.pickupTime,
          durationDays: booking.durationDays,

          // 🔥 CRITICAL FIX (THIS WAS MISSING)
          customerName: (customerNameInput?.value || "").trim(),

          customerEmail: booking.customerEmail,
          customerMobile: booking.customerMobile,
          customerAddress: booking.customerAddress,

          requiredFormType: booking.requiredFormType,

          bookingId: booking.id,
          confirmationFee: booking.confirmationFee,

          // ✅ Only send a voucher that was actually applied to the quote.
          // Invalid text typed in the box must not block checkout.
          discountCode:
            booking.discountCode || selectedAvailability.discountCode || "",

          extras,

          // ✅ only include if exists
          ...(customerNotes ? { customerNotes } : {}),
        }),
      },
      15000,
    );

    if (!response.ok) {
      if (response.status === 409) {
        alert(
          data?.error || "This lorry is no longer available for those dates.",
        );

        clearAvailabilityCaches();

        selectedAvailability = null;
        window.pendingBooking = null;

        if (durationDaysInput) durationDaysInput.value = "";
        if (selectedDurationInput) selectedDurationInput.value = "";
        if (selectedBaseInput) selectedBaseInput.value = "";

        updateCheckoutSummary();
        goToStep(2);

        if (pickupDate) {
          await updateDurationOptions(pickupDate);
          maybeAutoSubmitAvailability();
        }

        return null;
      }

      if (response.status === 500 && data?.error === "Stripe not configured") {
        alert("Stripe checkout is not configured yet.");
        return null;
      }

      throw new Error(data?.error || "Stripe session creation failed");
    }

    if (data?.url) {
      return data.url;
    }

    throw new Error("Stripe session URL missing");
  } catch (error) {
    console.warn("Stripe session error:", error);
    alert(error?.message || "Could not start checkout. Please try again.");
    return null;
  } finally {
    setTimeout(() => {
      checkoutLock = false;
      setButtonBusy(bookingSubmitBtn, false);
    }, 800);
  }
}

function resetBookingCustomerFields() {
  /* ===============================
     CLEAR CUSTOMER FIELDS
  =============================== */

  if (customerNameInput) customerNameInput.value = "";
  if (customerEmailInput) customerEmailInput.value = "";
  if (customerMobileInput) customerMobileInput.value = "";
  if (customerAddressInput) customerAddressInput.value = "";
  if (customerDobInput) customerDobInput.value = "";

  /* ===============================
     RESET EXTRAS
  =============================== */

  if (hiredWithin3MonthsInput) hiredWithin3MonthsInput.checked = false;

  REQUIRED_FORM_STATE.key = "";
  REQUIRED_FORM_STATE.type = "long";
  REQUIRED_FORM_STATE.loading = false;
  REQUIRED_FORM_STATE.checked = false;
  REQUIRED_FORM_STATE.reason = "reset";
  clearTimeout(requiredFormCheckTimer);

  if (dartfordEnabledInput) dartfordEnabledInput.checked = false;

  if (dartfordCountInput) {
    dartfordCountInput.value = "1";
    dartfordCountInput.disabled = true;
  }

  if (earlyPickupEnabledInput) earlyPickupEnabledInput.checked = false;

  const discountCodeInput = document.getElementById("discount-code");
  if (discountCodeInput) discountCodeInput.value = "";

  if (discountMessage) {
    discountMessage.hidden = true;
    discountMessage.textContent = "";
    discountMessage.className = "voucher-message muted tiny";
  }

  /* ===============================
   🔥 RESET AVAILABILITY STATE (CRITICAL)
=============================== */

  selectedAvailability = null;

  /* ===============================
     🔥 RESET AUTO-SUBMIT STATE
  =============================== */

  resetAvailabilityAutoSubmitState();

  window.__lastDurationCheck = "";

  /* ===============================
     🔥 RE-SYNC UI LOGIC
  =============================== */

  updateEarlyPickupAvailability();

  /* ===============================
     UPDATE SUMMARY
  =============================== */

  updateCheckoutSummary();
}

async function fetchStripeSession(sessionId) {
  try {
    const { response: res, data } = await fetchJsonWithTimeout(
      apiUrl(
        `/api/bookings/by-session?session_id=${encodeURIComponent(sessionId)}`,
      ),
      {},
      12000,
    );

    if (!res.ok) return null;
    /* ===============================
       ✅ CASE 1 — REAL BOOKING (KV)
    =============================== */

    if (data?.found && data.booking) {
      return data.booking;
    }

    /* ===============================
       ⚡ CASE 2 — FALLBACK (Stripe metadata)
    =============================== */

    if (data?.session?.metadata) {
      console.log("⚡ Using Stripe metadata fallback");

      const m = data.session.metadata;

      /* 🔥 SAFE PARSE EXTRAS */
      let extras = {};
      try {
        extras = JSON.parse(m.extrasJson || "{}");
      } catch {
        console.warn("⚠️ extrasJson parse failed");
        extras = {};
      }

      /* 🔥 SAFE DATE BUILD */
      const pickupDate = m.pickupDate || "";
      const pickupTime = m.pickupTime || "07:00";

      const pickupAt = pickupDate ? `${pickupDate}T${pickupTime}:00` : null;

      const dropoffAt = pickupDate ? `${pickupDate}T19:00:00` : null;

      return {
        id: m.bookingId || sessionId,

        vehicleId: m.vehicleId,

        vehicleSnapshot: {
          name: m.vehicleName,
        },

        pickupAt,
        dropoffAt,

        durationDays: Number(m.durationDays || 1),

        baseCost: Number(m.baseCost || 0),
        extrasTotal: Number(m.extrasTotal || 0),
        hireTotal: Number(m.totalHire || 0),

        confirmationFee: Number(m.confirmationFee || 0),
        outstandingAmount: Number(m.outstandingAmount || 0),

        extras,
      };
    }

    return null;
  } catch (err) {
    console.warn("fetchStripeSession failed:", err);
    return null;
  }
}

/* ======================================================
   Events
====================================================== */

document.addEventListener("DOMContentLoaded", async () => {
  await handleStripeReturn();

  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* ======================================================
   RETURNING CUSTOMER AUTO LOOKUP (FIXED + EARLY CREATE)
====================================================== */

  if (customerEmailInput) {
    let lookupInFlight = false; // 🔒 prevent spam calls

    function clearReturningCustomerBadge() {
      const badge = document.getElementById("returning-customer-badge");

      window.RETURNING_CUSTOMER = false;

      if (badge) {
        badge.textContent = "";
        badge.classList.add("hidden");
      }
    }

    customerEmailInput.addEventListener("change", async () => {
      const typedEmail = String(customerEmailInput.value || "").trim();
      const lookupEmail = typedEmail.toLowerCase();
      const typedMobile = String(customerMobileInput?.value || "").trim();

      // Keep the visible field exactly as typed apart from accidental spaces.
      if (customerEmailInput.value !== typedEmail) {
        customerEmailInput.value = typedEmail;
      }

      clearReturningCustomerBadge();

      if (!typedEmail || lookupInFlight) return;

      lookupInFlight = true;

      try {
        const params = new URLSearchParams();
        params.set("email", lookupEmail);

        // Only include mobile when something real is typed.
        // Sending an empty mobile made the backend match old customers with blank mobile fields.
        if (typedMobile) {
          params.set("mobile", typedMobile);
        }

        const res = await fetch(apiUrl(`/api/customers/lookup?${params}`));

        const data = await res.json();

        console.log("Customer lookup response:", data);

        const badge = document.getElementById("returning-customer-badge");

        const returnedEmail = String(data?.customer?.email || "")
          .trim()
          .toLowerCase();
        const returnedMobile = String(data?.customer?.mobile || "").trim();

        const emailMatches = !!lookupEmail && returnedEmail === lookupEmail;
        const mobileMatches = !!typedMobile && returnedMobile === typedMobile;

        if (data.found && data.customer && !emailMatches && !mobileMatches) {
          console.warn("Ignoring customer lookup mismatch:", {
            typedEmail,
            typedMobile,
            returnedEmail: data.customer.email,
            returnedMobile: data.customer.mobile,
          });

          data.found = false;
          data.customer = null;
        }

        /* ===============================
         NOT FOUND → CREATE CUSTOMER EARLY
      =============================== */

        if (!data.found) {
          console.log("🆕 New customer detected");

          const earlyAddress = (customerAddressInput?.value || "").trim();

          // Address is now required by the backend.
          // If the customer has not entered it yet, do not create early.
          // The booking checkout/webhook will create/update the customer later.
          if (earlyAddress) {
            try {
              await fetch(apiUrl(`/api/customers`), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  full_name: customerNameInput?.value || "",
                  email: typedEmail,
                  mobile: typedMobile,
                  address: earlyAddress,
                }),
              });
            } catch (err) {
              console.warn("⚠️ Failed to create customer early:", err);
            }
          } else {
            console.log(
              "ℹ️ Skipping early customer create until address is entered",
            );
          }

          clearReturningCustomerBadge();
          return;
        }

        /* ===============================
         FOUND → RETURNING CUSTOMER
      =============================== */

        console.log("Returning customer detected:", data.customer);

        if (badge) {
          const hires = Number(data.customer.hire_count || 0);

          badge.textContent =
            hires > 0
              ? `✔ Returning customer — ${hires} previous hire${hires > 1 ? "s" : ""}`
              : `✔ Returning customer`;

          badge.classList.remove("hidden");
        }

        /* ===============================
   AUTO-FILL (FIXED)
=============================== */

        if (data.found && data.customer) {
          console.log("👤 Returning customer detected:", data.customer);

          if (customerNameInput && !customerNameInput.value) {
            const name = (data.customer.full_name || "").trim();

            // 🔥 IGNORE PLACEHOLDER / BAD DATA
            if (name && name.toLowerCase() !== "test" && name.length > 2) {
              customerNameInput.value = name;
            } else {
              console.warn("⚠️ Ignoring invalid stored name:", name);
            }
          }

          if (customerMobileInput && !customerMobileInput.value) {
            customerMobileInput.value = data.customer.mobile || "";
          }

          window.RETURNING_CUSTOMER = true;
        }
      } catch (err) {
        console.warn("Customer lookup failed:", err);
        clearReturningCustomerBadge();
      } finally {
        lookupInFlight = false;
      }
    });
  }

  /* Step 1 logic */
  syncPickupTimeOptions();
  updatePickupTimeVisibility();

  updateEarlyPickupAvailability();

  if (pickupTimeInput) {
    pickupTimeInput.addEventListener("change", async () => {
      /* ===============================
       🔥 PREVENT INTERNAL LOOP
    =============================== */
      if (pickupTimeInput._silentUpdate) return;

      const date = pickupDateInput?.value;
      if (!date) return;

      /* ===============================
       🔥 UPDATE DURATIONS
    =============================== */

      await updateDurationOptions(date);

      /* ===============================
       🔥 AUTO PICKUP TIME (SAFE)
    =============================== */

      if (Number(durationDaysInput?.value) === 0.5) {
        const { morningAvailable, afternoonAvailable } =
          await getRemainingHalfDaySlots(date);

        let nextValue = pickupTimeInput.value;

        if (morningAvailable && !afternoonAvailable) {
          nextValue = "07:00";
        } else if (!morningAvailable && afternoonAvailable) {
          nextValue = "13:00";
        }

        // 🔥 silent update (prevents loop)
        if (pickupTimeInput.value !== nextValue) {
          pickupTimeInput._silentUpdate = true;
          pickupTimeInput.value = nextValue;

          setTimeout(() => {
            pickupTimeInput._silentUpdate = false;
          }, 0);
        }
      }

      /* ===============================
       SYNC UI (NO SIDE EFFECTS)
    =============================== */

      await syncPickupTimeOptions(date);

      updateEarlyPickupAvailability();

      /* ===============================
       🔥 SINGLE CONTROLLED TRIGGER
    =============================== */

      maybeAutoSubmitAvailability();
    });
  }

  /* Step 3 logic (use existing global selectedDurationInput) */

  if (selectedDurationInput) {
    selectedDurationInput.addEventListener("change", async () => {
      updateHalfDayPickup();

      const vehicle = selectedAvailability?.vehicle;
      const date = selectedPickupInput?.value;

      if (vehicle && date) {
        await syncBookingPickupTimeOptions(date, vehicle.id);
      }
    });
  }

  updateHalfDayPickup();

  /* ======================================================
   SMART SUMMARY AUTO-UPDATE
====================================================== */

  function initSmartSummaryUpdates() {
    const triggers = [
      pickupDateInput,
      durationDaysInput,
      pickupTimeInput,
      selectedLorryInput,
      dartfordEnabledInput,
      dartfordCountInput,
      earlyPickupEnabledInput,
      document.getElementById("discount-code"),
    ];
    triggers.forEach((el) => {
      if (!el) return;

      el.addEventListener("change", () => {
        try {
          updateCheckoutSummary();
        } catch (e) {
          console.warn("Summary update failed:", e);
        }
      });
    });
  }
});

/* ===============================
   Availability submit (OPTIMISED)
=============================== */

let availabilitySubmitTimeout = null;
let availabilityRequestId = 0;

if (availabilityForm) {
  availabilityForm.addEventListener("submit", (event) => {
    event.preventDefault();

    // 🔁 debounce (prevents spam)
    clearTimeout(availabilitySubmitTimeout);

    availabilitySubmitTimeout = setTimeout(async () => {
      const requestId = ++availabilityRequestId;

      /* ===============================
         VALIDATION
      =============================== */

      if (!validateDurationSelection()) return;

      const pickupDate = pickupDateInput?.value;
      const durationDays = Number(durationDaysInput?.value);
      const pickupTime = pickupTimeInput?.value;

      if (!pickupDate || Number.isNaN(durationDays) || durationDays <= 0) {
        safeRenderAvailability(
          '<p class="empty-note">Enter a valid pickup date and duration.</p>',
        );
        return;
      }

      /* ===============================
         HALF DAY VALIDATION
      =============================== */

      if (durationDays === 0.5 && !pickupTime) {
        const group = document.getElementById("pickup-time-group");

        group?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });

        group?.classList.add("duration-highlight");

        setTimeout(() => {
          group?.classList.remove("duration-highlight");
        }, 2000);

        pickupTimeInput?.focus();

        let note = group.querySelector(".field-error");

        if (!note) {
          note = document.createElement("div");
          note.className = "field-error";
          note.textContent = "Please choose a pickup time for half-day hire.";

          group.appendChild(note);
          setTimeout(() => note.remove(), 3000);
        }

        return;
      }

      const finalPickupTime = durationDays === 0.5 ? pickupTime : null;

      const submitBtn = availabilityForm.querySelector(
        'button[type="submit"], input[type="submit"]',
      );

      setButtonBusy(submitBtn, true, "Checking availability...");

      renderAvailabilityLoading();
      try {
        /* ===============================
   🔥 BLOCK DURING STRIPE RETURN
=============================== */

        if (IS_STRIPE_RETURN || STRIPE_FLOW_COMPLETED) {
          console.log("⛔ Skipping availability (Stripe flow)");
          return;
        }

        const availableLorries = await getAvailableLorries(
          pickupDate,
          durationDays,
          finalPickupTime,
        );

        /* ===============================
   🔥 POST-AWAIT GUARD (CRITICAL)
=============================== */

        if (IS_STRIPE_RETURN || STRIPE_FLOW_COMPLETED) {
          console.log("⛔ Ignoring result (Stripe flow changed)");
          return;
        }

        if (DEBUG) {
          console.log("🎯 FINAL UI DATA:", availableLorries);
        }

        /* ===============================
           CANCEL OUTDATED RESPONSE
        =============================== */

        if (requestId !== availabilityRequestId) {
          console.log("⚠️ Discarding outdated availability response");
          return;
        }

        renderAvailabilityResults(availableLorries);
      } catch (err) {
        if (requestId !== availabilityRequestId) return;

        console.warn("Availability search failed:", err);

        safeRenderAvailability(`
    <div class="availability-error">
      Couldn’t check availability right now.

      <div style="margin-top:10px;">
        <button type="button" class="btn retry-availability-btn">
          Try again
        </button>
      </div>
    </div>
  `);

        document
          .querySelector(".retry-availability-btn")
          ?.addEventListener("click", () => {
            maybeAutoSubmitAvailability();
          });
      } finally {
        if (requestId === availabilityRequestId) {
          setButtonBusy(submitBtn, false);
        }
      }
    }, 120);
  });
}

function syncExtrasUI() {
  if (!dartfordCountInput || !dartfordEnabledInput) return;

  dartfordCountInput.disabled = !dartfordEnabledInput.checked;

  if (!dartfordEnabledInput.checked) {
    dartfordCountInput.value = "1";
  }

  // 🔥 ALWAYS sync early pickup as well
  updateEarlyPickupAvailability();
}

/* ===============================
   EXTRAS EVENTS (CLEAN - NO DUPES)
=============================== */

dartfordEnabledInput?.addEventListener("change", () => {
  syncExtrasUI();
  refreshPricingWithExtras();
});

dartfordCountInput?.addEventListener("input", refreshPricingWithExtras);

earlyPickupEnabledInput?.addEventListener("change", () => {
  refreshPricingWithExtras();
  updateEarlyPickupAvailability(); // ✅ ensure UI stays correct
});

[customerEmailInput, customerMobileInput].forEach((input) => {
  input?.addEventListener("input", () => scheduleRequiredFormCheck(650));
  input?.addEventListener("blur", () => scheduleRequiredFormCheck(80));
});

hiredWithin3MonthsInput?.addEventListener("change", () => {
  setDetectedRequiredFormType(
    hiredWithin3MonthsInput.checked ? "short" : "long",
    "manual_legacy_checkbox",
  );
  updateCheckoutSummary();
});

/* ===============================
   BOOKING SELECTION EVENTS
=============================== */

selectedPickupInput?.addEventListener("change", async () => {
  const pickupDate = selectedPickupInput?.value;
  const vehicle = selectedAvailability?.vehicle;

  if (pickupDate && vehicle?.id) {
    // IMPORTANT: run this BEFORE updateBookingDurationOptions(),
    // otherwise the old half-day value is silently changed before we can show the warning.
    const blockedHalfDay = applyBookingWeekendHalfDayRule(
      pickupDate,
      vehicle,
      true,
    );

    await updateBookingDurationOptions(pickupDate, vehicle.id);

    // Re-apply after the async option check, so the 1/2 day option stays hidden.
    applyBookingWeekendHalfDayRule(pickupDate, vehicle, blockedHalfDay);

    updateHalfDayPickup();
  }

  await checkBookingFormAvailability();
  await checkRequiredFormRequirement({ force: true });

  updateEarlyPickupAvailability();
});

selectedDurationInput?.addEventListener("change", async () => {
  const pickupDate = selectedPickupInput?.value;
  const vehicle = selectedAvailability?.vehicle;

  if (pickupDate && vehicle?.id) {
    const blockedHalfDay = applyBookingWeekendHalfDayRule(
      pickupDate,
      vehicle,
      true,
    );

    await updateBookingDurationOptions(pickupDate, vehicle.id);

    applyBookingWeekendHalfDayRule(pickupDate, vehicle, blockedHalfDay);

    updateHalfDayPickup();
  }

  await checkBookingFormAvailability();
  scheduleRequiredFormCheck(250);

  updateEarlyPickupAvailability();
});

/* ===============================
   INIT
=============================== */

syncExtrasUI();

/* ======================================================
   BOOKING SUBMIT
====================================================== */

if (bookingForm) {
  bookingForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!selectedAvailability) {
      alert("Please select a lorry from the availability results first.");
      return;
    }

    const customerEmail = String(customerEmailInput?.value || "").trim();

    if (customerEmailInput && customerEmailInput.value !== customerEmail) {
      customerEmailInput.value = customerEmail;
    }

    const emailLooksValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customerEmail);

    if (!emailLooksValid) {
      alert("Please enter a valid email address before continuing.");

      customerEmailInput?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });

      customerEmailInput?.focus();

      return;
    }

    const customerAddress = (customerAddressInput?.value || "").trim();

    if (!customerAddress) {
      alert("Please enter your address before continuing.");

      customerAddressInput?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });

      customerAddressInput?.focus();

      return;
    }

    /* ===============================
       SAFE VEHICLE ID (🔥 KEY FIX)
    =============================== */

    const vehicleId =
      selectedAvailability.vehicle?.id || selectedAvailability.vehicleId;

    /* ===============================
       PICKUP TIME
    =============================== */

    const bookingPickupTime =
      document.getElementById("booking-pickup-time")?.value || "07:00";

    const vehiclesAvailability = await getVehicleAvailability(
      selectedAvailability.pickupDate,
      selectedAvailability.durationDays,
      bookingPickupTime,
    );

    const v = vehiclesAvailability.find((x) => x.vehicleId === vehicleId);

    let stillAvailable = false;

    if (selectedAvailability.durationDays === 0.5) {
      stillAvailable = v?.availableSlots?.length > 0;
    } else {
      stillAvailable = !!v?.available;
    }

    if (!stillAvailable) {
      alert(
        "That lorry is no longer available for the selected dates. Please search again.",
      );
      return;
    }

    /* ===============================
       EXTRAS
    =============================== */

    const dartfordCrossings = dartfordEnabledInput?.checked
      ? Number(dartfordCountInput?.value || 0)
      : 0;

    const earlyPickup = earlyPickupEnabledInput?.checked || false;

    const baseCost = Number(selectedAvailability.baseCost || 0);
    const discountAmount = Number(selectedAvailability.discountAmount || 0);

    const hireTotal = Number(selectedAvailability.total || 0);

    /* ===============================
       BOOKING ID
    =============================== */

    const existingIds = new Set((await getBookings()).map((b) => String(b.id)));
    const bookingId = generateNumericBookingId(existingIds);

    /* ===============================
       FORMS
    =============================== */

    const requiredFormType = await checkRequiredFormRequirement({ force: true });
    const hiredWithinLast3Months = requiredFormType === "short";

    const shortFormLink = buildFormUrl(FORM_LINK_A, bookingId);
    const longFormLink = buildFormUrl(FORM_LINK_B, bookingId);
    const requiredFormLink =
      requiredFormType === "short" ? shortFormLink : longFormLink;

    /* ===============================
       PICKUP / DROPOFF TIMES
    =============================== */

    let pickupAt = new Date(selectedAvailability.pickupDate);
    let dropoffAt = new Date(selectedAvailability.pickupDate);

    if (selectedAvailability.durationDays === 0.5) {
      const [h, m] = (bookingPickupTime || "07:00").split(":");

      pickupAt.setHours(Number(h), Number(m), 0, 0);

      if (bookingPickupTime === "13:00") {
        dropoffAt.setHours(19, 0, 0, 0);
      } else {
        dropoffAt.setHours(13, 0, 0, 0);
      }
    } else {
      // full day(s)
      pickupAt.setHours(7, 0, 0, 0);

      dropoffAt = new Date(pickupAt);
      dropoffAt.setDate(
        dropoffAt.getDate() + Number(selectedAvailability.durationDays),
      );
      dropoffAt.setHours(7, 0, 0, 0);
    }

    /* ===============================
   PAYMENT SPLIT
   Pay now must never exceed discounted total hire
=============================== */

    const rawConfirmationFee = getConfirmationFeeFromId(vehicleId);
    const confirmationFee = Math.min(rawConfirmationFee, hireTotal);
    const outstandingAmount = Math.max(0, hireTotal - confirmationFee);

    /* ===============================
   BOOKING OBJECT
=============================== */

    const booking = {
      id: bookingId,

      vehicleId: vehicleId,

      vehicleSnapshot: {
        id: vehicleId,
        name: selectedAvailability.vehicle?.name || "",
        type: selectedAvailability.vehicle?.type || "",
      },

      pickupAt: pickupAt.toISOString(),
      dropoffAt: dropoffAt.toISOString(),

      durationDays: selectedAvailability.durationDays,
      durationHours: selectedAvailability.durationHours,
      pickupTime: bookingPickupTime,
      customerName: (customerNameInput?.value || "").trim(),
      customerEmail,
      customerMobile: customerMobileInput?.value || "",
      customerAddress,
      customerDob: customerDobInput?.value || "",

      /* 🔥 CLEAN EXTRAS (single source of truth) */
      extras: {
        dartford: dartfordCrossings,
        earlyPickup: earlyPickup ? 1 : 0,
      },

      /* 🔥 SERVER-DRIVEN TOTALS */
      baseCost,
      discountAmount,
      discountCode:
        selectedAvailability.discountCode || getCurrentDiscountCode(),
      extrasTotal: Number(selectedAvailability.extrasTotal || 0),
      hireTotal,
      confirmationFee,
      outstandingAmount,

      depositAmount: SECURITY_DEPOSIT_AMOUNT,

      status: "pending_confirmation_payment",

      reminderAt: getReminderAt(pickupAt.toISOString()),

      outstandingPaymentLink: OUTSTANDING_PAYMENT_LINK,
      depositLink: DEPOSIT_PAYMENT_LINK,

      formLinkA: shortFormLink,
      formLinkB: longFormLink,
      requiredFormType,
      requiredFormLink,
      hiredWithinLast3Months,

      createdAt: new Date().toISOString(),
    };

    /* ===============================
       STORE + REFRESH
    =============================== */

    const bookings = await getBookings();
    bookings.push(booking);
    saveBookings(bookings);

    BOOKINGS_CACHE = null;
    AVAILABILITY_CACHE.clear();

    await getBookings(true);
    renderBookings();
    renderAdminBookings();

    /* ===============================
       MOVE TO STEP 4
    =============================== */

    window.pendingBooking = booking;
    goToStep(4);
  });
}

/* ======================================================
   CONFIRM BUTTON → STRIPE
====================================================== */

const confirmBtn = document.getElementById("booking-confirm-btn");

if (confirmBtn) {
  confirmBtn.addEventListener("click", async () => {
    const booking = window.pendingBooking;

    if (!booking) {
      alert("Booking information missing.");
      return;
    }

    /* ===============================
       🔥 FORCE REVALIDATION (FINAL FIX)
    =============================== */

    const vehicleId = booking.vehicleId;
    const pickupDate = booking.pickupAt.slice(0, 10);
    const duration = Number(booking.durationDays);

    const stillValid = await isContinuousRangeAvailable(
      pickupDate,
      duration,
      vehicleId,
      null,
    );

    if (!stillValid) {
      alert("This lorry is no longer available for that duration.");

      selectedAvailability = null;
      window.pendingBooking = null;

      if (durationDaysInput) durationDaysInput.value = "";
      if (selectedDurationInput) selectedDurationInput.value = "";

      updateCheckoutSummary();
      goToStep(2);

      await updateDurationOptions(pickupDate);
      maybeAutoSubmitAvailability();

      return;
    }

    const checkoutUrl = await createStripeCheckoutSession(booking);

    if (!checkoutUrl) return;

    resetBookingCustomerFields();

    window.location.href = checkoutUrl;
  });
}

/* ======================================================
   HELPER (ADD ONCE!)
====================================================== */

function getConfirmationFeeFromId(vehicleId) {
  const id = String(vehicleId || "").toLowerCase();

  console.log("💰 fee check for:", id);

  if (id.startsWith("v75")) return 100;
  if (id.startsWith("v35")) return 75;

  console.log("⚠️ fallback fee used");
  return 75;
}

// Admin buttons
refreshAdminBtn?.addEventListener("click", renderAdminBookings);
exportAdminCsvBtn?.addEventListener("click", exportAdminCsv);
exportAdminPdfBtn?.addEventListener("click", exportAdminPdf);

clearAdminBtn?.addEventListener("click", async () => {
  if (!confirm("Clear all saved demo bookings?")) return;

  try {
    await fetch(apiUrl("/api/bookings/clear"), {
      method: "POST",
    });
  } catch (err) {
    console.warn("Backend clear failed, falling back to local storage");

    localStorage.removeItem(STORAGE_BOOKINGS);
  }

  BOOKINGS_CACHE = null;
  selectedAvailability = null;

  await getBookings(true);

  renderBookings();
  renderAdminBookings();
  updateCheckoutSummary();
});
// Expose images for slideshow matching your filenames
window.fleetImages = window.fleetImages || [
  "3.5 T Stallion (DL22)1.webp",
  "3.5 T Stallion (DL22)2.webp",
  "3.5 T Stallion (DL22)3.webp",
  "3.5 T Stallion (DL22)4.webp",
  "3.5 T Stallion (DL22)5.webp",
  "3.5 T With Breast Bar (CA21)1.webp",
  "3.5 T With Breast Bar (CA21)2.webp",
  "3.5 T With Breast Bar (CA21)3.webp",
  "3.5 T With Breast Bar (CA21)4.webp",
  "3.5 T With Breast Bar (CA21)5.webp",
  "3.5 T With Breast Bar (CA21)6.webp",
  "3.5T With Safety Bar (LS23)1.webp",
  "3.5T With Safety Bar (LS23)2.webp",
  "3.5T With Safety Bar (LS23)3.webp",
  "3.5T With Safety Bar (LS23)4.webp",
  "3.5T With Safety Bar (LS23)5.webp",
  "3.5T With Safety Bar (LS23)6.webp",
  "3.5T With Safety Bar (LS23)7.webp",
  "3.5T With Safety Bar (LS23)8.webp",
  "3.5T With Safety Bar (LS23)9.webp",
  "3.5T With Safety Bar (LS23)10.webp",
  "7.5 T 3 Horses with Living1.webp",
  "7.5 T 3 Horses with Living2.webp",
  "7.5 T 3 Horses with Living3.webp",
  "7.5 T 3 Horses with Living4.webp",
  "7.5 T 3 Horses with Living5.webp",
  "7.5 T 3 Horses with Living6.webp",
  "7.5 T 4 Horses No Living1.webp",
  "7.5 T 4 Horses No Living2.webp",
  "7.5 T 4 Horses No Living3.webp",
  "7.5 T 4 Horses No Living4.webp",
];

// Initial render
(async () => {
  if (bookingSubmitBtn) bookingSubmitBtn.disabled = true;

  renderFleet();

  await getBookings(true);

  renderBookings();
  renderAdminBookings();

  updateCheckoutSummary();
})();

/* ======================================================
   LIVE BOOKING UPDATE WATCHER
====================================================== */

let bookingVersion = 0;

/* ======================================================
   Calendar Preview Helpers
====================================================== */

const vehiclePreview = document.getElementById("vehicle-preview");
let vehiclePreviewHideTimer = null;

function cancelVehiclePreviewHide() {
  clearTimeout(vehiclePreviewHideTimer);
  vehiclePreviewHideTimer = null;
}

function scheduleVehiclePreviewHide(delay = 180) {
  cancelVehiclePreviewHide();

  vehiclePreviewHideTimer = setTimeout(() => {
    clearPreview();
  }, delay);
}

vehiclePreview?.addEventListener("mouseenter", () => {
  cancelVehiclePreviewHide();
});

vehiclePreview?.addEventListener("mouseleave", () => {
  scheduleVehiclePreviewHide(120);
});

vehiclePreview?.addEventListener("mousedown", () => {
  cancelVehiclePreviewHide();
});

function clearPreview() {
  cancelVehiclePreviewHide();

  document
    .querySelectorAll(".cal-preview")
    .forEach((el) => el.classList.remove("cal-preview"));

  if (vehiclePreview) {
    vehiclePreview.classList.add("hidden");
  }
}

function previewRental(startDate) {
  const duration = Number(document.getElementById("duration-days")?.value || 1);

  const end = new Date(startDate);
  end.setDate(end.getDate() + duration - 1);

  const cells = document.querySelectorAll("#cal-grid .cal-day");

  cells.forEach((cell) => {
    const day = Number(cell.textContent);
    if (!day) return;

    const cellDate = new Date(
      startDate.getFullYear(),
      startDate.getMonth(),
      day,
    );

    if (cellDate >= startDate && cellDate <= end) {
      cell.classList.add("cal-preview");
    }
  });
}

function movePreview(e) {
  if (!vehiclePreview) return;

  vehiclePreview.style.left = e.pageX + "px";
  vehiclePreview.style.top = e.pageY + "px";
}

function scrollToMobileAvailableLorries() {
  if (!isMobile()) return;

  const target =
    document.getElementById("mobile-preview") ||
    document.getElementById("availability-results");

  if (!target) return;

  setTimeout(() => {
    target.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, 350);
}

async function getLiveDayVehicleAvailability(dateKey) {
  const [fullDay, morning, afternoon] = await Promise.all([
    getVehicleAvailability(dateKey, 1, null, { forceFresh: true }),
    getVehicleAvailability(dateKey, 0.5, "07:00", { forceFresh: true }),
    getVehicleAvailability(dateKey, 0.5, "13:00", { forceFresh: true }),
  ]);

  const map = new Map();

  vehicles.forEach((vehicle) => {
    const full = fullDay.find((v) => v.vehicleId === vehicle.id);
    const am = morning.find((v) => v.vehicleId === vehicle.id);
    const pm = afternoon.find((v) => v.vehicleId === vehicle.id);

    map.set(vehicle.id, {
      vehicle,
      fullDayAvailable: !!full?.available,
      morningAvailable:
        is35T(vehicle) &&
        !!am?.available &&
        Array.isArray(am?.availableSlots) &&
        am.availableSlots.includes("am"),
      afternoonAvailable:
        is35T(vehicle) &&
        !!pm?.available &&
        Array.isArray(pm?.availableSlots) &&
        pm.availableSlots.includes("pm"),
    });
  });

  return map;
}

function renderUnavailablePreviewMessage(dateLabel, vehicleName = "") {
  return `
    <strong>${dateLabel}</strong><br>
    <div
      style="
        margin-top: 10px;
        padding: 10px 12px;
        border-radius: 12px;
        background: #fee2e2;
        border: 1px solid #fecaca;
        color: #991b1b;
        font-weight: 800;
        line-height: 1.35;
      "
    >
      ${vehicleName ? `${vehicleName} is not available on this date.` : "No lorries are available on this date."}
    </div>
  `;
}

async function showVehiclePreview(date, event) {
  const mobilePanel = document.getElementById("mobile-preview");
  const desktopPanel = document.getElementById("vehicle-preview");

  if (mobilePanel) mobilePanel.classList.add("hidden");
  if (desktopPanel) desktopPanel.classList.add("hidden");

  const dateStart = new Date(date);
  dateStart.setHours(0, 0, 0, 0);

  const dateKey = formatDayKey(dateStart);
  const dateLabel = dateStart.toDateString();

  let html = `<strong>${dateLabel}</strong><br>`;

  let liveMap;

  try {
    liveMap = await getLiveDayVehicleAvailability(dateKey);
  } catch (err) {
    console.warn("Live preview availability failed:", err);

    html += `
      <div class="muted tiny" style="margin-top: 8px">
        Checking live availability failed. Please click Check availability.
      </div>
    `;
  }

  if (liveMap) {
    const rows = [];

    vehicles
      .filter(
        (vehicle) => !PRESELECTED_VEHICLE || vehicle.id === PRESELECTED_VEHICLE,
      )
      .forEach((vehicle) => {
        const live = liveMap.get(vehicle.id);

        if (!live) return;

        let slotText = "";

        if (live.fullDayAvailable) {
          slotText = "Full day available";
        } else if (is35T(vehicle)) {
          const parts = [];

          if (live.morningAvailable) parts.push("Morning ½ day");
          if (live.afternoonAvailable) parts.push("Afternoon ½ day");

          slotText = parts.join(" / ");
        }

        if (!slotText) return;

        const img = getVehiclePreviewImage(vehicle);

        rows.push(`
          <button class="preview-item preview-select"
            type="button"
            data-vehicle-id="${vehicle.id}"
            data-slot="${slotText}"
            data-date="${dateKey}"
            aria-label="Select ${escapeHtml(vehicle.name)} for ${escapeHtml(dateLabel)}">

            ${img ? `<img src="${img}" class="preview-img" alt="">` : ""}

            <span class="preview-text">
              <strong>${vehicle.name}</strong><br>
              <span class="muted tiny">${slotText}</span>
            </span>
            <span class="preview-action" aria-hidden="true">Select</span>
          </button>
        `);
      });

    if (!rows.length) {
      const vehicleName = PRESELECTED_VEHICLE
        ? vehicles.find((v) => v.id === PRESELECTED_VEHICLE)?.name || ""
        : "";

      html = renderUnavailablePreviewMessage(dateLabel, vehicleName);
    } else {
      html += rows.join("");
    }
  }

  function bindPreviewClicks(panel) {
    panel.querySelectorAll(".preview-select").forEach((el) => {
      el.addEventListener("click", async () => {
        if (el.dataset.selecting === "true") return;

        const vehicleId = el.dataset.vehicleId;
        const slot = (el.dataset.slot || "").toLowerCase();
        const selectedDateKey = el.dataset.date || dateKey;

        const vehicle = vehicles.find((v) => v.id === vehicleId);
        if (!vehicle) return;

        el.dataset.selecting = "true";
        el.classList.add("selecting");
        cancelVehiclePreviewHide();

        try {
          PRESELECTED_VEHICLE = vehicleId;
          LOCKED_VEHICLE = true;

          updateCalendarVehicleLabel();

          if (pickupDateInput) {
            pickupDateInput.value = selectedDateKey;
            pickupDateInput.dispatchEvent(new Event("input", { bubbles: true }));
            pickupDateInput.dispatchEvent(new Event("change", { bubbles: true }));
          }

          if (selectedLorryInput) selectedLorryInput.value = vehicle.name;
          if (selectedBaseInput) selectedBaseInput.value = "";

          selectedAvailability = null;

          updateDurationOptionsForVehicle(vehicle);
          enforceVehicleDurationRules(vehicle);

          if (durationDaysInput) {
            if (!is35T(vehicle)) {
              durationDaysInput.value = "1";
              if (pickupTimeInput) pickupTimeInput.value = "07:00";
            } else if (slot.includes("morning") || slot.includes("afternoon")) {
              durationDaysInput.value = "0.5";
              if (pickupTimeInput) {
                pickupTimeInput.value = slot.includes("afternoon")
                  ? "13:00"
                  : "07:00";
              }
            } else {
              durationDaysInput.value = "1";
              if (pickupTimeInput) pickupTimeInput.value = "07:00";
            }

            durationDaysInput.dispatchEvent(new Event("change", { bubbles: true }));
          }

          await syncPickupTimeOptions(selectedDateKey);
          updatePickupTimeVisibility();
          updateCheckoutSummary();

          await selectAvailability(vehicleId);

          if (selectedAvailability) {
            clearPreview();
            goToStep(3);

            setTimeout(() => {
              document.getElementById("step-3")?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              });
            }, 120);
          }
        } finally {
          el.dataset.selecting = "false";
          el.classList.remove("selecting");
        }
      });
    });
  }

  if (isMobile()) {
    const panel = mobilePanel;
    if (!panel) return;

    panel.dataset.date = dateKey;
    panel.innerHTML = html;
    panel.classList.remove("hidden");

    bindPreviewClicks(panel);

    return;
  }

  const panel = desktopPanel;
  if (!panel) return;

  panel.innerHTML = html;
  panel.classList.remove("hidden");

  bindPreviewClicks(panel);

  if (event) movePreview(event);
}

/* ======================================================
   Phase 4 — Calendar Module (Render Only)
====================================================== */

(function () {
  const calGrid = document.getElementById("cal-grid");
  const calTitle = document.getElementById("cal-title");
  const calWrap = document.getElementById("availability-calendar");

  if (!calGrid || !calTitle || !calWrap) return;

  // use global currentDate (do NOT redeclare)

  /* ===============================
   🔥 EXPOSE CALENDAR STATE (NEW)
=============================== */

  window.__calendarState = {
    get currentDate() {
      return new Date(currentDate);
    },
    set currentDate(val) {
      if (!val) return;

      const d = new Date(val);
      if (isNaN(d.getTime())) return; // guard invalid dates

      d.setDate(1);
      currentDate = d;
    },
  };
  /* ===============================
   🔥 EXPOSE MONTH SETTER (UPDATED)
=============================== */

  window.setCalendarMonth = function (date) {
    window.__calendarState.currentDate = date; // ✅ USE SETTER

    if (typeof renderCalendar === "function") {
      renderCalendar();
    }
  };

  /* ======================================================
     Check availability for a specific calendar day
  ====================================================== */

  function checkDayLocalAvailability(dateObj, bookings) {
    let availableVehicles = 0;

    vehicles
      .filter((v) => !PRESELECTED_VEHICLE || v.id === PRESELECTED_VEHICLE)
      .forEach((vehicle) => {
        const vehicleBookings = bookings.filter(
          (b) => b.vehicleId === vehicle.id && b.status !== "cancelled",
        );

        const pickupAt = new Date(dateObj);
        pickupAt.setHours(0, 0, 0, 0);

        const dropoffAt = new Date(dateObj);
        dropoffAt.setHours(23, 59, 59, 999);

        const overlapsExisting = vehicleBookings.some((booking) => {
          const existingStart = new Date(booking.pickupAt);
          const existingEnd = new Date(booking.dropoffAt);

          return overlaps(pickupAt, dropoffAt, existingStart, existingEnd);
        });

        if (!overlapsExisting) {
          availableVehicles++;
        }
      });

    const totalVehicles = PRESELECTED_VEHICLE ? 1 : vehicles.length;

    /* ===============================
   SIMPLIFIED AVAILABILITY (FINAL)
=============================== */

    if (availableVehicles === 0) {
      return "unavailable";
    }

    return "available";
  }

  /* ======================================================
     Check if rental can start
  ====================================================== */

  function canStartRental(startDate, bookings) {
    const durationInput = document.getElementById("duration-days");
    const durationDays = Number(durationInput?.value || 1);

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + durationDays - 1);

    /* check vehicle by vehicle */

    return vehicles.some((vehicle) => {
      const vehicleBookings = bookings.filter(
        (b) => b.vehicleId === vehicle.id && b.status !== "cancelled",
      );

      const overlapsExisting = vehicleBookings.some((booking) => {
        const existingStart = new Date(booking.pickupAt);
        const existingEnd = new Date(booking.dropoffAt);

        return overlaps(startDate, endDate, existingStart, existingEnd);
      });

      /* vehicle available */

      return !overlapsExisting;
    });
  }
  /* ======================================================
   Render Booking Bars (multi-day visual)
====================================================== */

  function renderBookingBars(year, month, bookings) {
    const cells = Array.from(document.querySelectorAll("#cal-grid .cal-day"));

    bookings.forEach((booking) => {
      const start = new Date(booking.pickupAt);
      const end = new Date(booking.dropoffAt);

      if (start.getFullYear() !== year || start.getMonth() !== month) return;

      const day = start.getDate();
      const cell = cells.find((c) => Number(c.textContent) === day);

      if (!cell) return;
      cell.classList.add("cal-booked");

      const startHour = getLondonParts(start).hour;
      const endHour = getLondonParts(end).hour;

      cell.classList.remove(
        "cal-booking-morning",
        "cal-booking-afternoon",
        "cal-booking-full",
      );

      if (startHour === 7 && endHour === 13) {
        cell.classList.add("cal-booking-morning");
      } else if (startHour === 13 && endHour === 19) {
        cell.classList.add("cal-booking-afternoon");
      } else {
        cell.classList.add("cal-booking-full");
      }
    });
  }

  async function renderCalendar() {
    window.renderCalendar = renderCalendar;

    // if a render is already running, queue one more pass
    if (calendarRenderPromise) {
      pendingCalendarRender = true;
      return calendarRenderPromise;
    }

    calendarRenderPromise = (async () => {
      try {
        do {
          pendingCalendarRender = false;
          await renderCalendarInternal();
        } while (pendingCalendarRender);

        /* ===============================
         PREFETCH CURRENT VISIBLE MONTH
      =============================== */

        try {
          const visibleMonthStart = new Date(currentDate);
          visibleMonthStart.setDate(1);

          const year = visibleMonthStart.getFullYear();
          const month = String(visibleMonthStart.getMonth() + 1).padStart(
            2,
            "0",
          );
          const day = "01";

          const monthStartStr = `${year}-${month}-${day}`;

          prefetchAvailabilityWindow(monthStartStr);
        } catch (err) {
          console.warn("Calendar month prefetch failed:", err);
        }
      } catch (err) {
        console.error("Calendar render failed:", err);
      } finally {
        calendarRenderPromise = null;

        // ✅ ALWAYS UNLOCK (CRITICAL FIX)
        const calWrap = document.getElementById("availability-calendar");
        const calGrid = document.getElementById("cal-grid");

        if (calWrap) calWrap.dataset.rendering = "false";
        if (calGrid) calGrid.dataset.rendering = "false";
      }
    })();

    return calendarRenderPromise;
  }

  async function renderCalendarInternal() {
    ensureDateVisible(window.SELECTED_DATE);

    calGrid.dataset.rendering = "true";
    calWrap.dataset.rendering = "true";

    // 🔥 CRITICAL FIX — CLEAR GRID BEFORE RENDER
    calGrid.innerHTML = "";

    /* ===============================
   LOAD BOOKINGS — NON-BLOCKING
   Render calendar immediately, refresh markings after bookings load.
=============================== */

    const bookings = BOOKINGS_CACHE || [];

    if (!BOOKINGS_CACHE && !window.__calendarBookingsLoading) {
      window.__calendarBookingsLoading = true;

      getBookings(false)
        .then(() => {
          window.__calendarBookingsLoading = false;
          renderCalendar();
        })
        .catch((err) => {
          window.__calendarBookingsLoading = false;
          console.warn("Calendar bookings background load failed:", err);
        });
    }

    if (DEBUG) {
      console.log("Calendar bookings:", bookings);
    }

    /* ===============================
   CALENDAR HEADER
=============================== */

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const monthNames = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];

    calTitle.textContent = `${monthNames[month]} ${year}`;

    const fragment = document.createDocumentFragment();

    /* ===============================
   SELECTED DATE RESTORE
=============================== */

    const selectedDateValue = window.SELECTED_DATE;
    let selectedTimestamp = null;

    if (selectedDateValue) {
      const selectedDate = new Date(selectedDateValue);
      selectedDate.setHours(0, 0, 0, 0);
      selectedTimestamp = selectedDate.getTime();
    }

    /* ===============================
   MONTH SETUP
=============================== */

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    let startOffset = firstDay.getDay();
    startOffset = startOffset === 0 ? 6 : startOffset - 1;

    for (let i = 0; i < startOffset; i++) {
      calGrid.appendChild(document.createElement("div"));
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    /* ===============================
   DAY LOOP
=============================== */

    for (let day = 1; day <= lastDay.getDate(); day++) {
      const dayDate = new Date(year, month, day);
      dayDate.setHours(0, 0, 0, 0);

      const dayEl = document.createElement("div");
      dayEl.className = "cal-day";
      dayEl.textContent = day;

      // 🔥 REQUIRED for prefetch
      dayEl.dataset.date = formatDayKey(dayDate);

      /* ===============================
     RESTORE SELECTED DATE
  =============================== */

      if (selectedTimestamp && dayDate.getTime() === selectedTimestamp) {
        dayEl.classList.add("cal-selected");
      }

      /* today marker */

      if (dayDate.getTime() === today.getTime()) {
        dayEl.classList.add("cal-today");
      }

      /* weekend shading */

      const weekday = dayDate.getDay();
      if (weekday === 0 || weekday === 6) {
        dayEl.classList.add("cal-weekend");
      }

      /* ===============================
     PAST DATES
  =============================== */

      if (dayDate < today) {
        dayEl.classList.add("cal-unavailable", "cal-past");
        fragment.appendChild(dayEl);
        continue;
      }

      /* ===============================
     AVAILABILITY CHECK
  =============================== */

      // remove unused dayKey

      let status = checkDayLocalAvailability(dayDate, bookings);
      let validStart = canStartRental(dayDate, bookings);

      /*
  Important:
  The local calendar colouring is only a quick visual guide.
  Live server availability is checked on hover/click via /api/vehicles/available,
  because admin blocks and reservations are server-side.
*/
      if (PRESELECTED_VEHICLE) {
        status = "available";
        validStart = true;
      }

      // Per-lorry calendar lines removed.
      // Availability is now shown only in the live preview popup/panel.

      /* ===============================
     STATUS COLOURING
  =============================== */

      if (status === "available") {
        dayEl.classList.add("cal-available");
      } else {
        dayEl.classList.add("cal-unavailable");
      }

      if (!validStart) {
        dayEl.classList.remove("cal-available");
        dayEl.classList.add("cal-unavailable", "cal-no-start");
      }

      /* ===============================
     🔥 TOUCHSTART PREFETCH (NEW)
  =============================== */

      dayEl.addEventListener(
        "touchstart",
        () => {
          if (IS_RESETTING) return;

          const dateStr = dayEl.dataset.date;
          if (!dateStr) return;

          // Prefetch this date + next 2 days
          prefetchAvailabilityWindow(dateStr);
          prefetchAvailabilityWindow(addDaysToDateStr(dateStr, 1));
          prefetchAvailabilityWindow(addDaysToDateStr(dateStr, 2));
        },
        { passive: true },
      );

      /* ===============================
     PREVIEW + HOVER PREFETCH
  =============================== */

      dayEl.addEventListener("mouseenter", (e) => {
        if (IS_RESETTING) return;

        cancelVehiclePreviewHide();

        const dateStr = dayEl.dataset.date;

        if (dateStr) {
          prefetchAvailabilityWindow(dateStr);
        }

        clearTimeout(hoverPreviewTimer);

        hoverPreviewTimer = setTimeout(() => {
          clearPreview();
          previewRental(dayDate);

          const desktopPanel = document.getElementById("vehicle-preview");
          if (desktopPanel && !isMobile()) {
            desktopPanel.innerHTML = `<strong>Checking live availability…</strong>`;
            desktopPanel.classList.remove("hidden");
            movePreview(e);
          }

          showVehiclePreview(dayDate, e);
        }, 60);
      });

      if (!isMobile()) {
        dayEl.addEventListener("mousemove", movePreview);
      }

      dayEl.addEventListener("mouseleave", (event) => {
        clearTimeout(hoverPreviewTimer);

        if (
          !isMobile() &&
          vehiclePreview &&
          event.relatedTarget instanceof Node &&
          vehiclePreview.contains(event.relatedTarget)
        ) {
          cancelVehiclePreviewHide();
          return;
        }

        scheduleVehiclePreviewHide(180);
      });

      /* ===============================
     SINGLE DAY SELECTION HANDLER
  =============================== */

      if (validStart || PRESELECTED_VEHICLE) {
        let selecting = false;

        const handleDaySelect = async (e) => {
          // 🔥 HARD GUARDS (VERY IMPORTANT)
          if (selecting) return;
          if (IS_RESETTING) return;
          if (calGrid.dataset.rendering === "true") return;
          if (calWrap.dataset.rendering === "true") return; // 👈 ADD HERE

          selecting = true;

          try {
            const dateStr = dayEl.dataset.date;
            if (!dateStr) return;

            prefetchAvailabilityWindow(dateStr);
            prefetchAvailabilityWindow(addDaysToDateStr(dateStr, 1));

            clearPreview();

            await selectDate(dateStr);

            if (isMobile()) {
              previewRental(dayDate);
              await showVehiclePreview(dayDate, e);
              scrollToMobileAvailableLorries();
            }
          } finally {
            selecting = false;
          }
        };

        dayEl.addEventListener("click", handleDaySelect);
      }

      fragment.appendChild(dayEl);
    }

    /* ===============================
   UNLOCK
=============================== */

    calGrid.appendChild(fragment);

    restoreSelectedDate();
  }

  function showPreselectedUnavailableWarning(message) {
    const warningBox = document.getElementById("preselected-warning");

    if (!warningBox) {
      alert(message);
      return;
    }

    warningBox.innerHTML = `
    <div
      style="
        margin-top: 12px;
        padding: 12px 14px;
        border-radius: 14px;
        background: #fee2e2;
        border: 1px solid #fecaca;
        color: #991b1b;
        font-weight: 800;
        line-height: 1.35;
      "
    >
      ${message}
    </div>
  `;

    warningBox.style.display = "block";

    warningBox.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }

  /* ======================================================
   Select date
====================================================== */

  async function selectDate(dateStr) {
    /* ===============================
     🔥 BLOCK DURING RESET (CRITICAL)
  =============================== */

    if (IS_RESETTING) {
      console.log("⛔ blocked during reset");
      return;
    }

    const warningBox = document.getElementById("preselected-warning");
    if (warningBox) {
      warningBox.innerHTML = "";
      warningBox.style.display = "none";
    }

    BLOCK_AUTO_SCROLL = false;

    /* ===============================
   🔒 PRESELECTED LORRY LIVE CHECK
   If customer clicked “Book this lorry”, do not let them
   continue into confusing greyed-out duration state.
=============================== */

    if (PRESELECTED_VEHICLE) {
      const vehicle = vehicles.find((v) => v.id === PRESELECTED_VEHICLE);
      const liveMap = await getLiveDayVehicleAvailability(dateStr);
      const live = liveMap.get(PRESELECTED_VEHICLE);

      const hasAnyAvailability =
        !!live?.fullDayAvailable ||
        !!live?.morningAvailable ||
        !!live?.afternoonAvailable;

      if (!hasAnyAvailability) {
        selectedAvailability = null;

        if (durationDaysInput) durationDaysInput.value = "";
        if (pickupTimeInput) pickupTimeInput.value = "";
        if (selectedDurationInput) selectedDurationInput.value = "";
        if (selectedBaseInput) selectedBaseInput.value = "";

        updateCheckoutSummary();
        resetAvailabilityAutoSubmitState();

        showPreselectedUnavailableWarning(
          `${vehicle?.name || "This lorry"} is not available on ${dateStr}. Please choose another date or clear the selected lorry.`,
        );

        return;
      }
    }

    const pickupInput = document.getElementById("pickup-date");
    const durationInput = document.getElementById("duration-days");
    const pickupTimeInput = document.getElementById("pickup-time");

    if (!pickupInput || !durationInput || !dateStr) return;

    /* ===============================
     🔥 PREVENT GHOST RE-SELECTION
  =============================== */

    if (
      window.SELECTED_DATE === dateStr &&
      pickupInput.value === dateStr &&
      !PRESELECTED_VEHICLE
    ) {
      console.log("⛔ Same date already selected — skip");
      return;
    }
    pickupInput.value = dateStr;
    window.SELECTED_DATE = dateStr;

    resetAvailabilityAutoSubmitState();
    window.__lastDurationCheck = "";

    const dayDate = new Date(`${dateStr}T12:00:00`);

    /* ===============================
     RESET STATE EARLY
  =============================== */

    selectedAvailability = null;

    if (availabilityResults) {
      availabilityResults.innerHTML = "";
    }

    if (!LOCKED_VEHICLE) {
      if (selectedLorryInput) selectedLorryInput.value = "";
    }

    if (selectedBaseInput) selectedBaseInput.value = "";

    if (bookingSubmitBtn) bookingSubmitBtn.disabled = true;

    durationInput.value = "";

    if (pickupTimeInput) {
      pickupTimeInput.value = "";
    }

    updateCheckoutSummary();

    /* ===============================
     PRESELECTED LORRY CHECK
  =============================== */

    if (PRESELECTED_VEHICLE) {
      const bookings = BOOKINGS_CACHE || (await getBookings(false));

      const vehicleBookings = bookings.filter(
        (b) => b.vehicleId === PRESELECTED_VEHICLE && b.status !== "cancelled",
      );

      const dayStart = new Date(dayDate);
      dayStart.setHours(0, 0, 0, 0);

      const dayEnd = new Date(dayDate);
      dayEnd.setHours(23, 59, 59, 999);

      let morningBlocked = false;
      let afternoonBlocked = false;

      vehicleBookings.forEach((b) => {
        const start = new Date(b.pickupAt);
        const end = new Date(b.dropoffAt);

        if (start <= dayEnd && end >= dayStart) {
          const startHour = getLondonHour(start);
          const endHour = getLondonHour(end);

          if (Number(b.durationDays) === 0.5) {
            if (b.pickupTime === "07:00") morningBlocked = true;
            if (b.pickupTime === "13:00") afternoonBlocked = true;
          } else {
            if (startHour < 13) morningBlocked = true;
            if (endHour > 13) afternoonBlocked = true;
          }
        }
      });

      const isBlocked = morningBlocked && afternoonBlocked;

      if (isBlocked && warningBox) {
        BLOCK_AUTO_SCROLL = true;

        const vehicle = vehicles.find((v) => v.id === PRESELECTED_VEHICLE);

        warningBox.innerHTML = `
        <div class="availability-warning">
          Sorry, <strong>${escapeHtml(vehicle?.name)}</strong>
          is not available on this date.

          <div class="warning-actions">
            <button class="btn ghost change-date-btn">
              Pick another date
            </button>

            <button class="btn primary change-lorry-btn">
              Pick another lorry
            </button>
          </div>
        </div>
      `;

        warningBox.style.display = "block";

        goToStep(1);

        setTimeout(() => {
          warningBox.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }, 60);

        warningBox
          .querySelector(".change-date-btn")
          ?.addEventListener("click", () => {
            BLOCK_AUTO_SCROLL = false;
            LOCKED_VEHICLE = true;

            document.getElementById("availability-calendar")?.scrollIntoView({
              behavior: "smooth",
              block: "start",
            });
          });

        warningBox
          .querySelector(".change-lorry-btn")
          ?.addEventListener("click", () => {
            BLOCK_AUTO_SCROLL = false;
            LOCKED_VEHICLE = false;
            PRESELECTED_VEHICLE = null;

            goToStep(2);
          });

        return;
      }
    }

    await updateDurationOptions(dateStr);
    // 🔥 prevent duplicate chain triggers
    window.__lastDurationCheck = null;
    await syncPickupTimeOptions(dateStr);

    // ===============================
    // 🔥 PREDICTIVE PREFETCH (UPGRADED)
    // ===============================

    prefetchAvailabilityWindow(dateStr);

    for (let i = 1; i <= 3; i++) {
      prefetchAvailabilityWindow(addDaysToDateStr(dateStr, i));
    }
    /* ===============================
     AUTO PICKUP TIME
  =============================== */

    if (Number(durationInput.value) === 0.5) {
      const { morningAvailable, afternoonAvailable } =
        await getRemainingHalfDaySlots(dateStr);

      if (morningAvailable && !afternoonAvailable) {
        pickupTimeInput.value = "07:00";
      } else if (!morningAvailable && afternoonAvailable) {
        pickupTimeInput.value = "13:00";
      }
    }

    /* ===============================
     VEHICLE LOCK RULES
  =============================== */

    if (LOCKED_VEHICLE && PRESELECTED_VEHICLE) {
      const vehicle = vehicles.find((v) => v.id === PRESELECTED_VEHICLE);

      updateDurationOptionsForVehicle(vehicle);
      enforceVehicleDurationRules(vehicle);
    }

    /* ===============================
     🔥 CALENDAR HIGHLIGHT (SAFE)
  =============================== */

    document
      .querySelectorAll(".cal-day.cal-selected")
      .forEach((el) => el.classList.remove("cal-selected"));

    document.querySelectorAll(".cal-day").forEach((el) => {
      if (el.dataset.date === dateStr) {
        el.classList.add("cal-selected");
      }
    });

    /* ===============================
     SCROLL
  =============================== */

    setTimeout(() => {
      if (BLOCK_AUTO_SCROLL) return;

      if (!isMobile()) {
        const y =
          durationInput.getBoundingClientRect().top + window.pageYOffset - 120;

        window.scrollTo({
          top: y,
          behavior: "smooth",
        });
      }

      durationInput.classList.add("duration-highlight");

      durationInput.addEventListener(
        "change",
        () => {
          durationInput.classList.remove("duration-highlight");
        },
        { once: true },
      );
    }, 200);
  }

  /* 🔥 expose globally */
  window.updateDurationOptions = updateDurationOptions;

  function onCalendarDayClick(date) {
    pickupDateInput.value = date;

    updateCheckoutSummary();

    const durationGroup = document.getElementById("duration-group");

    if (durationGroup) {
      durationGroup.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }

  /* ======================================================
   Month Navigation
====================================================== */

  async function changeMonth(direction) {
    if (calendarNavLock) return;
    calendarNavLock = true;

    try {
      const nextDate = new Date(currentDate);
      nextDate.setMonth(nextDate.getMonth() + direction);

      window.__calendarState.currentDate = nextDate; // ✅ USE SETTER

      await renderCalendar();
    } finally {
      calendarNavLock = false;
    }
  }

  calWrap.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-cal-nav]");
    if (!nav) return;

    e.preventDefault();
    e.stopPropagation();

    const direction = nav.dataset.calNav === "next" ? 1 : -1;
    changeMonth(direction);
  });

  /* ======================================================
   Live Booking Updates
====================================================== */

  async function watchBookingUpdates() {
    // 🚫 prevent overlapping calls
    if (BOOKING_WATCH_IN_PROGRESS) return;

    BOOKING_WATCH_IN_PROGRESS = true;

    try {
      const controller = new AbortController();

      // ⏱ timeout safety (5s)
      const timeout = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(`${BACKEND_API_BASE}/api/bookings/version`, {
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        console.warn("Booking watcher HTTP error:", res.status);
        return;
      }

      let data;

      try {
        data = await res.json();
      } catch {
        console.warn("Booking watcher JSON parse failed");
        return;
      }

      if (!data?.version) return;

      // 🧠 first run → just store
      if (BOOKINGS_VERSION === null) {
        BOOKINGS_VERSION = data.version;
        return;
      }

      // ⚡ no change → do nothing
      if (data.version === BOOKINGS_VERSION) return;

      console.log("🔄 New booking detected → refreshing UI");

      BOOKINGS_VERSION = data.version;

      // 🔥 clear cache
      BOOKINGS_CACHE = null;

      // 🔁 refetch bookings (deduped)
      await getBookings(true);

      // 🎯 render once (clean)
      renderBookings?.();
      renderAdminBookings?.();
      renderCalendar?.();
    } catch (err) {
      if (err.name === "AbortError") {
        console.warn("Booking watcher timeout");
      } else {
        console.warn("Booking watcher failed:", err);
      }
    } finally {
      BOOKING_WATCH_IN_PROGRESS = false;
    }
  }

  function renderAvailabilityDots(dayEl, bookings, dayDate) {
    // Removed deliberately.
    // The public calendar should not expose per-lorry availability lines.
    // Live availability is shown through showVehiclePreview().
    return;
  }

  function restoreSelectedDate() {
    if (!window.SELECTED_DATE) return;

    const el = document.querySelector(
      `.cal-day[data-date="${window.SELECTED_DATE}"]`,
    );

    if (el) {
      el.classList.add("cal-selected");
    }
  }

  /* ======================================================
   Initial render
====================================================== */

  renderCalendar();

  const durationInput = document.getElementById("duration-days");

  if (durationInput) {
    durationInput.addEventListener("change", () => {
      renderCalendar();

      const pickupInput = document.getElementById("pickup-date");

      /* only run search if date already selected */

      if (pickupInput?.value) {
        // 🔥 USE SAFE SUBMIT (NOT direct submit)
        maybeAutoSubmitAvailability();
      }
    });
  }
  //* start live booking watcher */

  watchBookingUpdates(); // run once immediately
  setInterval(watchBookingUpdates, 10000); // every 10 seconds
})();
