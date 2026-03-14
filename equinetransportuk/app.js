/* ======================================================
   Equine Transport UK — Booking Flow (Client)
   Phase 2: Server Pricing
   Phase 3: Discount Engine (voucher codes)
   ====================================================== */

let activeSlideshow = null;

let PRESELECTED_VEHICLE = null;



/* ===============================
   Booking cache
================================ */

let BOOKINGS_CACHE = null;
let BOOKINGS_CACHE_AT = 0;
const BOOKINGS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

let BOOKINGS_VERSION = null;

/* ======================================================
   Booking Step Controller
====================================================== */

let currentStep = 1;

/* ===============================
   Stripe checkout protection
================================ */

let checkoutLock = false;




function goToStep(step) {

  currentStep = step;

  document.querySelectorAll(".booking-step").forEach(el=>{
    el.classList.remove("active");
  });

  const stepEl = document.getElementById(`step-${step}`);
  if(stepEl) stepEl.classList.add("active");

  document.querySelectorAll(".booking-steps .step").forEach(el=>{
    el.classList.remove("active");
  });

  const indicator = document.querySelector(`.booking-steps .step[data-step="${step}"]`);
  if(indicator) indicator.classList.add("active");

  setTimeout(()=>{
  stepEl?.scrollIntoView({
    behavior:"smooth",
    block:"start"
  });
},100);

}

function startBooking(vehicleId) {

  PRESELECTED_VEHICLE = vehicleId;

  const vehicle = vehicles.find(v => v.id === vehicleId);
  updateDurationOptionsForVehicle(vehicle);

  updateCalendarVehicleLabel();

  selectedAvailability = null;

  if (selectedLorryInput) selectedLorryInput.value = "";
  if (selectedBaseInput) selectedBaseInput.value = "";

  const bookingSection = document.getElementById("booking");

  if (bookingSection) {
    bookingSection.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }

  goToStep(1);

/* refresh calendar immediately */

// renderCalendar();   // disabled

  /* auto trigger availability search if date already selected */

  const pickupDate = pickupDateInput?.value;
  const durationDays = Number(durationDaysInput?.value || 1);
  const pickupTime = pickupTimeInput?.value || DEFAULT_PICKUP_TIME;

  if (pickupDate && durationDays > 0) {

    setTimeout(() => {

      availabilityForm?.requestSubmit();

    }, 300);

  }

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
   Calendar cache
================================ */

const CALENDAR_CACHE = new Map();

// Duration price tables
const RATE_35T_TOTALS = {
  "0.5": 75,
  "1": 105,
  "2": 200,
  "3": 300,
  "4": 400,
  "5": 500,
  "6": 600,
  "7": 700
};

const RATE_75_LIVING_TOTALS = {
  "1": 175,
  "2": 350,
  "3": 525,
  "4": 700,
  "5": 875,
  "6": 1050,
  "7": 1225
};

const DURATION_HOURS_35T = {
  "0.5": 6,
  "1": 12,
  "2": 24,
  "3": 36,
  "4": 48,
  "5": 60,
  "6": 72,
  "7": 84
};

const DURATION_HOURS_75T = {
  "1": 12,
  "2": 24,
  "3": 36,
  "4": 48,
  "5": 60,
  "6": 72,
  "7": 84
};

// Stripe / links (fallback)
const STRIPE_PAYMENT_LINK_35T = "";
const STRIPE_PAYMENT_LINK_75T = "";
const OUTSTANDING_PAYMENT_LINK = "";
const DEPOSIT_PAYMENT_LINK = "";
const FORM_LINK_A = "https://koosverhagen.github.io/kvwebservices/equinetransportuk/forms/short-form.html";
const FORM_LINK_B = "https://koosverhagen.github.io/kvwebservices/equinetransportuk/forms/long-form.html";

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
    image: "images/lorry-ls23.webp"
  },
  {
    id: "v35-2",
    name: "3.5T Stallion Lorry",
    code: "MM68",
    type: "3.5 tonne",
    horses: 2,
    seats: 3,
    overnight: false,
    dayRate: 105,
    pricingModel: "35_duration_rules",
    summary:
      "Back-facing 2-horse stallion layout with high partitions, no breast bar, horse/reverse cameras, roof vent and windows.",
    image: "images/lorry-mm68.webp"
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
    image: "images/lorry-ca21.webp"
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
    image: "images/lorry-75-living.webp"
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
    image: "images/lorry-75-noliving.webp"
  }
];

window.vehicles = vehicles;

// DOM
const fleetGrid = document.getElementById("fleet-grid");
const availabilityForm = document.getElementById("availability-form");

const pickupDateInput = document.getElementById("pickup-date");
const pickupTimeInput = document.getElementById("pickup-time");
const durationDaysInput = document.getElementById("duration-days");
/* =====================================
   FIX: PRESELECTED VEHICLE AVAILABILITY
   ===================================== */

durationDaysInput?.addEventListener("change", () => {

  updatePickupTimeVisibility();
  syncPickupTimeOptions();

});
const availabilityResults = document.getElementById("availability-results");

const bookingForm = document.getElementById("booking-form");
const selectedLorryInput = document.getElementById("selected-lorry") || { value: "" };
const selectedPickupInput = document.getElementById("selected-pickup");
const selectedDurationInput = document.getElementById("selected-duration");
const selectedBaseInput = document.getElementById("selected-base");

const customerNameInput = document.getElementById("customer-name");
const customerEmailInput = document.getElementById("customer-email");
const customerMobileInput = document.getElementById("customer-mobile");
const customerAddressInput = document.getElementById("customer-address");
const customerDobInput = document.getElementById("customer-dob");

const hiredWithin3MonthsInput = document.getElementById("hired-within-3-months");
const dartfordEnabledInput = document.getElementById("dartford-enabled");
const dartfordCountInput = document.getElementById("dartford-count");
const earlyPickupEnabledInput = document.getElementById("early-pickup-enabled");

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

/* ======================================================
   Helpers
====================================================== */

function goBackToDates() {

  /* go back to Step 1 */

  goToStep(1);

  /* scroll to calendar */

  const calendar = document.getElementById("availability-calendar");

  if (calendar) {

    calendar.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });

  }

}

function changeLorry(){

  goToStep(2);

  if (availabilityResults) {
    availabilityResults.innerHTML = "Checking availability...";
  }

  setTimeout(()=>{
    availabilityForm?.requestSubmit();
  },100);

}

function resetBookingFlow() {

  /* clear availability + booking selection */

  selectedAvailability = null;

  /* clear form fields */

  if (selectedLorryInput) selectedLorryInput.value = "";
  if (selectedPickupInput) selectedPickupInput.value = "";
  if (selectedDurationInput) selectedDurationInput.value = "1";
  if (selectedBaseInput) selectedBaseInput.value = "";

  if (pickupDateInput) pickupDateInput.value = "";
  if (pickupTimeInput) pickupTimeInput.value = "";

  /* hide pickup time rows */

  const row = document.getElementById("pickup-time-row");
  if (row) row.style.display = "none";

  const group = document.getElementById("pickup-time-group");
  if (group) group.style.display = "none";

  /* clear availability results */

  if (availabilityResults) availabilityResults.innerHTML = "";

  /* clear caches */

  AVAILABILITY_CACHE.clear();
  BOOKINGS_CACHE = null;

  /* disable booking button */

  if (bookingSubmitBtn) bookingSubmitBtn.disabled = true;

  /* update summary */

  updateCheckoutSummary();

  /* go back to step 1 */

  goToStep(1);

  /* scroll to top */

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });

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
  return `${baseUrl}?id=${encodeURIComponent(bookingId)}`;
}

function addDays(date, days) {
  const output = new Date(date);
  output.setDate(output.getDate() + days);
  return output;
}

function asDate(dateString, timeString) {
  return new Date(`${dateString}T${timeString}:00`);
}

async function getBookings(forceRefresh = false) {

  const now = Date.now();

  if (!forceRefresh && BOOKINGS_CACHE && (now - BOOKINGS_CACHE_AT) < BOOKINGS_CACHE_TTL) {
    return BOOKINGS_CACHE;
  }

  try {

    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59).toISOString();

    const res = await fetch(
      `${apiUrl("/api/bookings/list")}?from=${encodeURIComponent(firstDay)}&to=${encodeURIComponent(lastDay)}`
    );

    if (!res.ok) {
  console.warn("Booking API returned", res.status);
  throw new Error("Booking API unavailable");
}
    const data = await res.json();

    BOOKINGS_CACHE = data.bookings || [];
    BOOKINGS_CACHE_AT = now;

    return BOOKINGS_CACHE;

  } catch (err) {

    console.warn("⚠️ Booking API unavailable, fallback to local storage");

    try {
      BOOKINGS_CACHE = JSON.parse(localStorage.getItem(STORAGE_BOOKINGS) || "[]");
      BOOKINGS_CACHE_AT = now;
      return BOOKINGS_CACHE;
    } catch {
      return [];
    }

  }
}

function getCalendarBookings() {
  return getBookings(true);
}
function saveBookings(bookings) {
  localStorage.setItem(STORAGE_BOOKINGS, JSON.stringify(bookings));
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function formatDateOnly(value) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString();
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function is35T(vehicle) {
  return String(vehicle?.type || "").toLowerCase().includes("3.5");
}

function getConfirmationFee(vehicle) {
  return is35T(vehicle) ? CONFIRMATION_FEE_35T : CONFIRMATION_FEE_75T;
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

function isWeekendDate(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function getDurationHours(vehicle, durationDays) {
  const key = getDurationKey(durationDays);
  const map = vehicle.pricingModel === "35_duration_rules" ? DURATION_HOURS_35T : DURATION_HOURS_75T;
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
    let total = RATE_75_LIVING_TOTALS[durationKey] ?? (175 * Math.max(1, duration));
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

function calculateHireTotal(baseCost, crossingsCount, earlyPickupEnabled) {
  return baseCost + calculateCrossingCharge(crossingsCount) + calculateEarlyPickupCharge(earlyPickupEnabled);
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

function getAvailabilityCacheKey(vehicleId, pickupDate, durationDays, pickupTime, discountCode = "") {
  return `${vehicleId}|${pickupDate}|${durationDays}|${pickupTime}|${discountCode}`;
}

/* ======================================================
   Pickup time locking (½ day only)
====================================================== */

function syncPickupTimeOptions() {
  if (!durationDaysInput || !pickupTimeInput) return;

  const duration = Number(durationDaysInput.value);

  const existingPmOption = Array.from(pickupTimeInput.options)
    .find(opt => opt.value === "13:00");

  if (duration === 0.5) {
    if (!existingPmOption) {
  const pmOption = document.createElement("option");
  pmOption.value = "13:00";
  pmOption.textContent = "13:00 — Afternoon";
  pickupTimeInput.appendChild(pmOption);
}
  } else {
    // Remove PM option entirely for all other durations
    if (existingPmOption) {
      pickupTimeInput.removeChild(existingPmOption);
    }

    // Force 07:00 if needed
    pickupTimeInput.value = "07:00";
  }
}

/* ======================================================
   Pricing API (server quote with local fallback)
====================================================== */

async function fetchServerQuote(vehicle, durationDays, pickupDate, pickupTime, discountCode = "") {

  // 🔒 Local development safeguard (prevents 405 spam on Live Server)
  if (location.hostname === "127.0.0.1" || location.hostname === "localhost") {
    console.log("Skipping pricing API (localhost dev)");

    const fallbackBase = calculateBaseCost(vehicle, durationDays, pickupDate, pickupTime);

    return {
      baseCost: fallbackBase,
      discountAmount: 0,
      discountedTotal: fallbackBase
    };
  }

  try {
    const res = await fetch(apiUrl("/api/pricing/quote"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vehicleId: vehicle.id,
        durationDays,
        pickupDate,
        pickupTime,
        discountCode
      })
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
      discountedTotal: Number(pricing.discountedTotal ?? pricing.baseCost ?? 0)
    };
  } catch (err) {
    console.warn("⚠️ Pricing API failed. Falling back to local pricing.", err);

    const fallbackBase = calculateBaseCost(vehicle, durationDays, pickupDate, pickupTime);

    return {
      baseCost: fallbackBase,
      discountAmount: 0,
      discountedTotal: fallbackBase
    };
  }
}

async function buildAvailability(vehicle, pickupDate, durationDays, pickupTime, discountCode = "") {

  // time rules
  let actualPickupTime = pickupTime;
  let dropoffTime = FULL_DAY_DROPOFF_TIME;
  let durationHours = getDurationHours(vehicle, durationDays);

  if (is35T(vehicle) && Number(durationDays) === 0.5) {

    if (!HALF_DAY_PICKUP_TIMES_35T.includes(pickupTime)) {
      actualPickupTime = HALF_DAY_PICKUP_TIMES_35T[0];
    }

    dropoffTime = HALF_DAY_DROPOFF_TIMES_35T[actualPickupTime];
    durationHours = 6;

  } else {

    actualPickupTime = DEFAULT_PICKUP_TIME;
    dropoffTime = FULL_DAY_DROPOFF_TIME;

  }

  const pickupAt = asDate(pickupDate, actualPickupTime);

  let dropoffAt;

  if (is35T(vehicle) && Number(durationDays) === 0.5) {

    dropoffAt = asDate(pickupDate, dropoffTime);

  } else {

    const dropoffDate = addDays(pickupAt, Math.max(0, Number(durationDays) - 1));
    dropoffAt = asDate(dropoffDate.toISOString().slice(0, 10), dropoffTime);

  }


  // quote cache (includes discount code)
  const cacheKey = getAvailabilityCacheKey(
    vehicle.id,
    pickupDate,
    durationDays,
    actualPickupTime,
    discountCode || ""
  );

  const cached = AVAILABILITY_CACHE.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < AVAILABILITY_CACHE_TTL) {
    return cached.data;
  }


  // fetch pricing from server
  const pricing = await fetchServerQuote(
    vehicle,
    durationDays,
    pickupDate,
    actualPickupTime,
    discountCode
  );


  const availabilityObject = {

    vehicle,
    pickupDate,
    pickupTime: actualPickupTime,
    durationDays,
    durationHours,
    pickupAt,
    dropoffAt,

    baseCost: pricing.baseCost,
    discountAmount: pricing.discountAmount,
    discountedTotal: pricing.discountedTotal

  };


  /* =====================================================
     UPDATE CHECKOUT SUMMARY UI
     ===================================================== */

  try {

    const deposit = vehicle.deposit || 75; // fallback

    updateCheckoutSummary({

      base: pricing.baseCost,

      voucher_discount: pricing.discountAmount,

      total: pricing.discountedTotal,

      deposit_due: deposit,

      remaining: Math.max(0, pricing.discountedTotal - deposit)

    });

  } catch (e) {

    console.warn("Summary UI not ready yet");

  }


  AVAILABILITY_CACHE.set(cacheKey, {
    timestamp: Date.now(),
    data: availabilityObject
  });


  return availabilityObject;
}

/* ======================================================
   Availability checks + rendering
====================================================== */

async function isVehicleAvailable(vehicleId, pickupDate, durationDays, pickupTime = DEFAULT_PICKUP_TIME) {
  const vehicle = vehicles.find((item) => item.id === vehicleId);
  if (!vehicle) return false;
  if (!supportsDuration(vehicle, durationDays)) return false;

  // discount does not affect availability, but buildAvailability needs it for times too.
  const candidate = await buildAvailability(vehicle, pickupDate, durationDays, pickupTime, "");

  const vehicleBookings = (await getBookings()).filter(
    (booking) => booking.vehicleId === vehicleId && booking.status !== "cancelled"
  );

  return !vehicleBookings.some((booking) => {
    const existingStart = new Date(booking.pickupAt);
    const existingEnd = new Date(booking.dropoffAt);
    return overlaps(candidate.pickupAt, candidate.dropoffAt, existingStart, existingEnd);
  });
}

async function getAvailableLorries(pickupDate, durationDays, pickupTime) {

  const results = [];

  /* -----------------------------
     PRESELECTED VEHICLE MODE
  ----------------------------- */

  if (PRESELECTED_VEHICLE) {

    const vehicle = vehicles.find(v => v.id === PRESELECTED_VEHICLE);

    if (!vehicle) return [];

    const available = await isVehicleAvailable(
  vehicle.id,
  pickupDate,
  durationDays,
  pickupTime
);

if (available) {

  const availability = await buildAvailability(
    vehicle,
    pickupDate,
    durationDays,
    pickupTime
  );

  results.push(availability);
}

    return results;
  }

  /* -----------------------------
     NORMAL MODE
  ----------------------------- */

  for (const vehicle of vehicles) {

    const available = await isVehicleAvailable(
  vehicle.id,
  pickupDate,
  durationDays,
  pickupTime
);

if (available) {

  const availability = await buildAvailability(
    vehicle,
    pickupDate,
    durationDays,
    pickupTime
  );

  results.push(availability);

}

  }

  return results;
}
function renderAvailabilityLoading() {
  if (!availabilityResults) return;
  availabilityResults.innerHTML = `
    <div class="loading-note">
      <span class="spinner" aria-hidden="true"></span>
      Checking availability…
    </div>
  `;
}

function renderAvailabilityError(message = "Something went wrong. Please try again.") {
  if (!availabilityResults) return;
  availabilityResults.innerHTML = `<p class="empty-note">${escapeHtml(message)}</p>`;
}

async function renderAvailabilityResults(items) {

  if (!pickupDateInput?.value || !durationDaysInput?.value) {
    if (availabilityResults) availabilityResults.innerHTML = "";
    return;
  }

  if (PRESELECTED_VEHICLE) {

    const filtered = items.filter(
      item => item.vehicle.id === PRESELECTED_VEHICLE
    );

    if (!filtered.length) {
      availabilityResults.innerHTML =
        '<p class="empty-note">Sorry, this lorry is not available for the selected date.</p>';
      PRESELECTED_VEHICLE = null;
      return;
    }

    const matched = filtered[0];

await selectAvailability(matched.vehicle.id);

/* ensure Step 3 shows selected vehicle */

if (selectedLorryInput) {
  selectedLorryInput.value = matched.vehicle.name;
}

PRESELECTED_VEHICLE = null;

goToStep(3);

return;
  }

  /* ---------------------------------
     NORMAL FLOW
  ---------------------------------- */

  if (!items.length) {

    availabilityResults.innerHTML =
      '<p class="empty-note">No lorries available for this date and duration.</p>';

    return;

  }

  /* If only one vehicle available skip Step 2 */

  if (items.length === 1) {

    selectAvailability(items[0]);

    goToStep(3);

    return;

  }

  /* Multiple vehicles → show selection */

  const html = items.map((item) => {

    const confirmationFee = getConfirmationFee(item.vehicle);
    const displayPrice = Number(item.discountedTotal ?? item.baseCost ?? 0);

    return `
      <article class="availability-item">
        <div>
          <h4>${escapeHtml(item.vehicle.name)}</h4>

          <p class="muted">
            ${item.vehicle.code ? `${escapeHtml(item.vehicle.code)} · ` : ""}
            ${escapeHtml(formatDateOnly(item.pickupDate))} ${escapeHtml(item.pickupTime)} ·
            ${escapeHtml(formatDurationLabel(item.durationDays))}
          </p>

          <div class="price">£${displayPrice.toFixed(2)}</div>

          <p class="muted tiny">
            Pay now to confirm: £${confirmationFee.toFixed(2)}
          </p>
        </div>

        <button
          class="btn choose-lorry"
          type="button"
          data-vehicle-id="${escapeHtml(item.vehicle.id)}">
          Select
        </button>
      </article>
    `;

  }).join("");

  availabilityResults.innerHTML = html;

  availabilityResults.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });

  goToStep(2);

}
availabilityResults.addEventListener("click", async (e)=>{

  const btn = e.target.closest(".choose-lorry");
  if(!btn) return;

  const vehicleId = btn.dataset.vehicleId;

  await selectAvailability(vehicleId);

  goToStep(3);

});



const bookingConfirmBtn = document.getElementById("booking-confirm-btn");



/* ======================================================
   Checkout summary (discount-safe)
====================================================== */

function updateCheckoutSummary() {
  if (!checkoutSummary) return;

  if (!selectedAvailability) {
    checkoutSummary.textContent = "Select an available lorry to continue.";
    if (bookingSubmitBtn) bookingSubmitBtn.disabled = true;
    return;
  }

  if (bookingSubmitBtn) bookingSubmitBtn.disabled = false;

  const dartfordEnabled = dartfordEnabledInput?.checked || false;
  const crossingsCount = dartfordEnabled ? Math.max(1, Number(dartfordCountInput?.value || 1)) : 0;
  const earlyPickupEnabled = earlyPickupEnabledInput?.checked || false;

  const crossingCharge = calculateCrossingCharge(crossingsCount);
  const earlyPickupCharge = calculateEarlyPickupCharge(earlyPickupEnabled);

  const baseCost = Number(selectedAvailability.baseCost || 0);
  const discountAmount = Number(selectedAvailability.discountAmount || 0);
  const discountedBase = Math.max(0, baseCost - discountAmount);

  const hireTotal = calculateHireTotal(discountedBase, crossingsCount, earlyPickupEnabled);

  const confirmationFee = getConfirmationFee(selectedAvailability.vehicle);

  if (bookingSubmitBtn) {
    bookingSubmitBtn.textContent = `Pay £${confirmationFee.toFixed(2)} to confirm booking`;
  }

  const outstandingAmount = Math.max(0, hireTotal - confirmationFee);
  const requiredFormType = hiredWithin3MonthsInput?.checked ? "Short Form" : "Long Form";

  const crossingLabel =
    crossingsCount === 1 ? "Dartford crossing" : "Dartford crossings";

  checkoutSummary.innerHTML = `
    <div class="summary-card">
      <div class="summary-vehicle">

  <img 
    src="${selectedAvailability.vehicle.image}" 
    alt="${escapeHtml(selectedAvailability.vehicle.name)}"
    class="summary-vehicle-image"
  >

  <h4>${escapeHtml(selectedAvailability.vehicle.name)}</h4>

</div>

      ${selectedAvailability.pickupAt ? `
<div class="summary-row muted">
  <span>Hire period</span>
  <strong>
    ${new Date(selectedAvailability.pickupAt).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    })}
    →
    ${new Date(selectedAvailability.dropoffAt).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    })}
  </strong>
</div>
` : ""}

${selectedAvailability.durationDays ? `
<div class="summary-row muted">
  <span>Duration</span>
  <strong>
    ${Number(selectedAvailability.durationDays) === 0.5
      ? "½ day"
      : Number(selectedAvailability.durationDays) === 1
      ? "1 day"
      : selectedAvailability.durationDays + " days"}
  </strong>
</div>
` : ""}

      <div class="summary-row">
        <span>Base hire</span>
        <strong>£${baseCost.toFixed(2)}</strong>
      </div>

      ${
        discountAmount > 0
          ? `
        <div class="summary-row discount">
          <span>Discount</span>
          <strong>-£${discountAmount.toFixed(2)}</strong>
        </div>
        `
          : ""
      }

      ${
        crossingsCount > 0
          ? `
        <div class="summary-row">
          <span>${crossingLabel} (${crossingsCount})</span>
          <strong>£${crossingCharge.toFixed(2)}</strong>
        </div>
        `
          : ""
      }

      ${
        earlyPickupEnabled
          ? `
        <div class="summary-row">
          <span>Early pickup</span>
          <strong>£${earlyPickupCharge.toFixed(2)}</strong>
        </div>
        `
          : ""
      }

      <hr>

      <div class="summary-row total">
        <span>Total hire</span>
        <strong>£${hireTotal.toFixed(2)}</strong>
      </div>

      <div class="summary-row pay-now">
        <span>Pay now (confirmation)</span>
        <strong>£${confirmationFee.toFixed(2)}</strong>
      </div>

      <div class="summary-row outstanding">
        <span>Remaining balance</span>
        <strong>£${outstandingAmount.toFixed(2)}</strong>
      </div>

      <div class="summary-note">
        Security deposit £${SECURITY_DEPOSIT_AMOUNT.toFixed(2)} — card hold the day before collection.
      </div>

      <div class="summary-note">
        Required form: <strong>${escapeHtml(requiredFormType)}</strong>
      </div>
    </div>
  `;
}

function updateHalfDayPickup() {

  const duration = Number(document.getElementById("selected-duration")?.value || 0);
  const row = document.getElementById("pickup-time-row");

  if (!row) return;

  if (duration === 0.5) {

    row.style.display = "grid";

    /* highlight field so user notices it */

    row.classList.add("duration-highlight");

    setTimeout(()=>{
      row.classList.remove("duration-highlight");
    },2000);

  } else {

    row.style.display = "none";

  }

}

function updatePickupTimeVisibility() {

  const duration = Number(durationDaysInput?.value || 0);
  const group = document.getElementById("pickup-time-group");

  if (!group || !pickupTimeInput) return;

  if (duration === 0.5) {

    group.style.display = "block";
    pickupTimeInput.value = "";

    // Scroll to field
    setTimeout(() => {

      group.scrollIntoView({
        behavior: "smooth",
        block: "center"
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
    pickupTimeInput.value = "07:00";

  }

}

/* ======================================================
   PREVENT IMPOSSIBLE DURATIONS
====================================================== */

function validateDurationSelection(){

  const duration = Number(durationDaysInput?.value || 0);
  const selectedDate = pickupDateInput?.value;

  if(!selectedDate || !duration) return true;

  if(!selectedAvailability) return true;

  const maxDuration = selectedAvailability.max_duration_days;

  if(maxDuration && duration > maxDuration){

    alert(`This lorry is only available for ${maxDuration} day(s) from the selected date.`);

    durationDaysInput.value = maxDuration;

    updateCheckoutSummary();

    return false;

  }

  return true;

}

/* ======================================================
   Fleet rendering
====================================================== */

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

    // Find images
    const code = vehicle.code || "";
    const baseName = vehicle.name.replace(/[^\w]+/g, "").toLowerCase();

    let imageFiles =
      window.fleetImages?.filter((img) => {
        return (
          (code && img.includes(code)) ||
          img.replace(/[^\w]+/g, "").toLowerCase().includes(baseName)
        );
      }) || [];

    if (!imageFiles.length)
      imageFiles = [vehicle.image.replace(/^images\//, "")];

    imageFiles = imageFiles.map((f) =>
      f.startsWith("images/") ? f : "images/" + f
    );

    // Image wrap
    const imageWrap = document.createElement("div");
    imageWrap.className = "fleet-image-wrap";

    const img = document.createElement("img");
    img.src = imageFiles[0];
    img.dataset.images = JSON.stringify(imageFiles);

    const overlay = document.createElement("div");
    overlay.className = "fleet-overlay";
    overlay.innerHTML = `
      <button class="apple-play-btn" type="button">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 5v14l11-7z"></path>
        </svg>
        <span>See More</span>
      </button>
    `;

    imageWrap.appendChild(img);
    imageWrap.appendChild(overlay);

    // Slideshow logic (one at a time)
    let currentIndex = 0;
    let playing = false;
    let interval = null;
    const images = imageFiles;

    function startSlideshow() {
      if (images.length <= 1) return;

      playing = true;
      overlay.classList.add("playing");

      const btn = overlay.querySelector(".apple-play-btn");
      if (btn) {
        btn.style.opacity = "0";
        btn.style.pointerEvents = "none";
      }

      interval = setInterval(() => {
        currentIndex = (currentIndex + 1) % images.length;
        img.style.opacity = "0";

        setTimeout(() => {
          img.src = images[currentIndex];
          img.style.opacity = "1";
        }, 200);
      }, 2500);

      activeSlideshow = stopSlideshow;
    }

    function stopSlideshow() {
      if (interval) clearInterval(interval);

      playing = false;
      currentIndex = 0;
      img.src = images[0];

      overlay.classList.remove("playing");

      const btn = overlay.querySelector(".apple-play-btn");
      if (btn) {
        btn.style.opacity = "1";
        btn.style.pointerEvents = "auto";
      }

      if (activeSlideshow === stopSlideshow) activeSlideshow = null;
    }

    overlay.addEventListener("click", (e) => {
      e.stopPropagation();

      if (activeSlideshow && activeSlideshow !== stopSlideshow)
        activeSlideshow();

      if (!playing) startSlideshow();
      else stopSlideshow();
    });

    // Content
    const content = document.createElement("div");
    content.className = "fleet-content";
    content.innerHTML = `
      <h3>${escapeHtml(vehicle.name)}</h3>
      <p class="muted">
        ${escapeHtml(vehicle.type)}
        ${vehicle.code ? ` · ${escapeHtml(vehicle.code)}` : ""}
        · ${vehicle.horses} horses · ${vehicle.seats} seats · ${escapeHtml(
      livingLabel
    )}
      </p>
      <p class="muted tiny">${escapeHtml(vehicle.summary)}</p>
      <p><strong>From £${Number(vehicle.dayRate).toFixed(0)}</strong> / day</p>

      <button class="btn fleet-card-book" type="button" data-lorry-id="${
        vehicle.id
      }">
        Book this Lorry
      </button>
    `;

    card.appendChild(imageWrap);
    card.appendChild(content);

    // Booking button
    content
      .querySelector(".fleet-card-book")
      ?.addEventListener("click", (e) => {
        e.stopPropagation();
        startBooking(vehicle.id);
      });

    fleetGrid.appendChild(card);
  });
}

/* ======================================================
   Booking helpers (select from fleet / results)
====================================================== */

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

  if (is35T(vehicle)) {

    // allow half day
    halfDayOption.style.display = "block";

  } else {

    // remove half day for 7.5T
    halfDayOption.style.display = "none";

    if (durationSelect.value === "0.5") {
      durationSelect.value = "1";
    }

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

  const vehicle = vehicles.find(v => v.id === PRESELECTED_VEHICLE);

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
    code
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
  let pickupTime = pickupTimeInput?.value || DEFAULT_PICKUP_TIME;
  const durationDays = Number(durationDaysInput?.value);

  const vehicle = vehicles.find((item) => item.id === vehicleId);

  if (!vehicle || !pickupDate || durationDays <= 0 || !supportsDuration(vehicle, durationDays)) return;

  /* enforce correct pickup time rules */

  if (is35T(vehicle) && durationDays === 0.5) {

    if (!HALF_DAY_PICKUP_TIMES_35T.includes(pickupTime)) {
      pickupTime = HALF_DAY_PICKUP_TIMES_35T[0];
    }

  } else {

    pickupTime = DEFAULT_PICKUP_TIME;

  }

  const code = getCurrentDiscountCode();

  selectedAvailability = await buildAvailability(
    vehicle,
    pickupDate,
    durationDays,
    pickupTime,
    code
  );

  /* populate Step 3 form */

  if (selectedLorryInput) selectedLorryInput.value = vehicle.name;

  if (selectedPickupInput) selectedPickupInput.value = pickupDate;

  populateBookingDurationSelect(vehicle);

  if (selectedDurationInput) {
    selectedDurationInput.value = String(durationDays);
  }

  /* show pickup time selector if ½ day */

  updateHalfDayPickup();

  /* sync pickup time into Step 3 selector */

  const bookingTimeInput = document.getElementById("booking-pickup-time");

  if (bookingTimeInput && durationDays === 0.5) {
    bookingTimeInput.value = pickupTime;
  }

  /* update base price */

  if (selectedBaseInput) {
    selectedBaseInput.value = `£${Number(selectedAvailability.baseCost ?? 0).toFixed(2)}`;
  }

  const statusEl = document.getElementById("booking-availability-status");

  if (statusEl) statusEl.hidden = true;

  if (bookingSuccess) bookingSuccess.hidden = true;

  updateCheckoutSummary();

  checkoutSummary?.scrollIntoView({
  behavior: "smooth",
  block: "nearest"
});

}

async function checkBookingFormAvailability() {
  if (!selectedAvailability || !selectedPickupInput || !selectedDurationInput) return;

  const statusEl = document.getElementById("booking-availability-status");

  const vehicle = selectedAvailability.vehicle;
  const pickupDate = selectedPickupInput.value;
  const durationDays = Number(selectedDurationInput.value);

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

  const bookingPickupTime =
  document.getElementById("booking-pickup-time")?.value ||
  selectedAvailability.pickupTime ||
  DEFAULT_PICKUP_TIME;

const pickupTime =
  is35T(vehicle) && durationDays === 0.5
    ? bookingPickupTime
    : DEFAULT_PICKUP_TIME;

  const available = await isVehicleAvailable(vehicle.id, pickupDate, durationDays, pickupTime);

  if (available) {
    // ✅ Keep discount when rebuilding availability
    const code = getCurrentDiscountCode();

    selectedAvailability = await buildAvailability(vehicle, pickupDate, durationDays, pickupTime, code);

    if (selectedBaseInput) selectedBaseInput.value = `£${Number(selectedAvailability.baseCost ?? 0).toFixed(2)}`;

    if (statusEl) {
      statusEl.textContent = `${vehicle.name} is available for the selected date and duration.`;
      statusEl.className = "availability-status ok full";
      statusEl.hidden = false;
    }

    if (bookingSubmitBtn) bookingSubmitBtn.disabled = false;
    updateCheckoutSummary();
  } else {
    if (statusEl) {
      statusEl.textContent = `${vehicle.name} is not available for the selected date and duration. Please choose different dates.`;
      statusEl.className = "availability-status error full";
      statusEl.hidden = false;
    }
    if (bookingSubmitBtn) bookingSubmitBtn.disabled = true;
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
        code
      );

      selectedAvailability = updated;
      updateCheckoutSummary();

      if (discountMessage) {
        discountMessage.hidden = false;
        if (Number(updated.discountAmount) > 0) {
          discountMessage.textContent = "Voucher applied ✓";
          discountMessage.className = "voucher-message ok tiny";
        } else {
          discountMessage.textContent = "Code valid but no discount applied.";
          discountMessage.className = "voucher-message muted tiny";
        }
      }
    } catch (err) {
      if (discountMessage) {
        discountMessage.hidden = false;
        discountMessage.textContent = err?.message || "Invalid or expired voucher.";
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

  const bookings = (await getBookings()).sort((a, b) => new Date(a.pickupAt) - new Date(b.pickupAt));
  if (!bookings.length) {
    bookingList.innerHTML = '<div class="booking-item muted">No bookings yet. Your first booking will appear here.</div>';
    return;
  }

  bookingList.innerHTML = bookings
    .map((booking) => {
      const vehicle = vehicles.find((item) => item.id === booking.vehicleId);
      return `
        <article class="booking-item">
          <strong>${escapeHtml(vehicle?.name || booking.vehicleId)}</strong><br>
          ${escapeHtml(formatDateTime(booking.pickupAt))} → ${escapeHtml(formatDateTime(booking.dropoffAt))}<br>
          <span class="muted">Duration: ${escapeHtml(formatDurationLabel(booking.durationDays))}</span><br>
          ${escapeHtml(booking.customerName)} · ${escapeHtml(booking.customerEmail)}<br>
          <span class="muted">Status: ${escapeHtml(booking.status)}</span><br>
          <span class="muted">Paid now: £${Number(booking.confirmationFee).toFixed(2)} · Outstanding: £${Number(
        booking.outstandingAmount
      ).toFixed(2)}</span><br>
          <span class="muted">Total hire: £${Number(booking.hireTotal).toFixed(2)}</span>
        </article>
      `;
    })
    .join("");
}

async function renderAdminBookings() {
  if (!adminBookings) return;

  const bookings = (await getBookings()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (!bookings.length) {
    adminBookings.innerHTML = '<p class="empty-note">No bookings saved yet.</p>';
    return;
  }

  const rows = bookings
    .map((booking) => {
      const vehicle = vehicles.find((item) => item.id === booking.vehicleId);
      return `
        <tr>
          <td>${escapeHtml(vehicle?.name || booking.vehicleId)}</td>
          <td>${escapeHtml(booking.customerName)}</td>
          <td>${escapeHtml(booking.customerEmail)}</td>
          <td>${escapeHtml(booking.customerMobile)}</td>
          <td>${escapeHtml(formatDateTime(booking.pickupAt))}</td>
          <td>${escapeHtml(formatDurationLabel(booking.durationDays))}</td>
          <td>${booking.earlyPickup ? "Yes" : "No"}</td>
          <td>${Number(booking.dartfordCrossings || 0)}</td>
          <td>£${Number(booking.confirmationFee).toFixed(2)}</td>
          <td>£${Number(booking.outstandingAmount).toFixed(2)}</td>
          <td>${booking.requiredFormType === "short" ? "Short" : "Long"}</td>
          <td>${
            booking.requiredFormLink
              ? `<a href="${escapeHtml(booking.requiredFormLink)}" target="_blank" rel="noopener">Open form</a>`
              : "—"
          }</td>
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
          <th>Early</th>
          <th>Crossings</th>
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
  const bookings = (await getBookings()).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const lines = [
    "Booking ID,Vehicle,Customer Name,Email,Mobile,Address,DOB,Pickup,Drop-off,Duration Days,Early Pickup,Dartford Crossings,Hire Total,Paid Now,Outstanding,Deposit,Required Form,Required Form Link,Status,Reminder At,Created"
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
          formatDateTime(booking.pickupAt),
          formatDateTime(booking.dropoffAt),
          booking.durationDays,
          booking.earlyPickup ? "Yes" : "No",
          booking.dartfordCrossings,
          `£${Number(booking.hireTotal).toFixed(2)}`,
          `£${Number(booking.confirmationFee).toFixed(2)}`,
          `£${Number(booking.outstandingAmount).toFixed(2)}`,
          `£${Number(booking.depositAmount).toFixed(2)}`,
          booking.requiredFormType === "short" ? "Short" : "Long",
          booking.requiredFormLink,
          booking.status,
          formatDateTime(booking.reminderAt),
          formatDateTime(booking.createdAt)
        ]
          .map(csvEscape)
          .join(",")
      );
    });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  downloadFile(lines.join("\n"), `equine-bookings-${stamp}.csv`, "text/csv;charset=utf-8");
}

async function exportAdminPdf() {
  const bookings = (await getBookings()).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const stamp = new Date().toISOString().slice(0, 10);

  const rows = bookings.length
    ? bookings
        .map((booking) => {
          const vehicle = vehicles.find((item) => item.id === booking.vehicleId);
          return `
            <tr>
              <td>${escapeHtml(vehicle?.name || booking.vehicleId)}</td>
              <td>${escapeHtml(booking.customerName)}</td>
              <td>${escapeHtml(booking.customerEmail)}</td>
              <td>${escapeHtml(formatDateTime(booking.pickupAt))}</td>
              <td>${escapeHtml(formatDurationLabel(booking.durationDays))}</td>
              <td>${escapeHtml(booking.earlyPickup ? "Yes" : "No")}</td>
              <td>${escapeHtml(`£${Number(booking.confirmationFee).toFixed(2)}`)}</td>
              <td>${escapeHtml(`£${Number(booking.outstandingAmount).toFixed(2)}`)}</td>
              <td>${escapeHtml(booking.status)}</td>
            </tr>
          `;
        })
        .join("")
    : "<tr><td colspan='9'>No bookings saved.</td></tr>";

  const reportHtml = `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>Equine Booking Export ${stamp}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 24px; color: #111827; }
          h1 { margin: 0 0 8px; }
          .meta { margin-bottom: 16px; color: #4b5563; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { border: 1px solid #d1d5db; padding: 7px; text-align: left; vertical-align: top; }
          th { background: #f3f4f6; }
        </style>
      </head>
      <body>
        <h1>Equine Transport UK Booking Export</h1>
        <div class="meta">Generated: ${escapeHtml(new Date().toLocaleString())}</div>
        <table>
          <thead>
            <tr>
              <th>Vehicle</th>
              <th>Name</th>
              <th>Email</th>
              <th>Pickup</th>
              <th>Duration</th>
              <th>Early</th>
              <th>Paid Now</th>
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

  /* prevent double Stripe session creation */
  if (checkoutLock) return null;
  checkoutLock = true;

  try {

    const response = await fetch(
      apiUrl("/api/bookings/create-checkout-session"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({
          vehicleId: booking.vehicleId,
          vehicleName: booking.vehicleSnapshot?.name,

          pickupDate: booking.pickupAt,
          pickupTime: booking.pickupTime,

          durationDays: booking.durationDays,

          customerEmail: booking.customerEmail,
          bookingId: booking.id
        })
      }
    );

    if (!response.ok) {
      throw new Error("Stripe session creation failed");
    }

    const data = await response.json();

    if (data.url) {
      return data.url;
    }

  } catch (error) {

    console.warn("Stripe session endpoint unavailable.", error);

  } finally {

    /* release checkout lock after short delay */
    setTimeout(() => {
      checkoutLock = false;
    }, 2000);

  }

  return null;

}

function resetBookingCustomerFields() {
  if (customerNameInput) customerNameInput.value = "";
  if (customerEmailInput) customerEmailInput.value = "";
  if (customerMobileInput) customerMobileInput.value = "";
  if (customerAddressInput) customerAddressInput.value = "";
  if (customerDobInput) customerDobInput.value = "";

  if (hiredWithin3MonthsInput) hiredWithin3MonthsInput.checked = false;
  if (dartfordEnabledInput) dartfordEnabledInput.checked = false;
  if (dartfordCountInput) {
    dartfordCountInput.value = "1";
    dartfordCountInput.disabled = true;
  }
  if (earlyPickupEnabledInput) earlyPickupEnabledInput.checked = false;

  updateCheckoutSummary();
}

/* ======================================================
   Events
====================================================== */

document.addEventListener("DOMContentLoaded", () => {

  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* ======================================================
   RETURNING CUSTOMER AUTO LOOKUP
====================================================== */

if (customerEmailInput) {

  customerEmailInput.addEventListener("change", async () => {

    const email = customerEmailInput.value.trim().toLowerCase();
    if (!email) return;

    try {

      const res = await fetch(
        apiUrl(`/api/customers/lookup?email=${encodeURIComponent(email)}`)
      );

      const data = await res.json();

      console.log("Customer lookup response:", data);

     if (!data.found) {

  window.RETURNING_CUSTOMER = false;

  const badge = document.getElementById("returning-customer-badge");
  if (badge) badge.classList.add("hidden");

  return;

}

      console.log("Returning customer detected:", data.customer);
      const badge = document.getElementById("returning-customer-badge");

if (badge) {

  const hires = Number(data.customer.hire_count || 0);

  badge.textContent =
    hires > 0
      ? `✔ Returning customer — ${hires} previous hire${hires > 1 ? "s" : ""}`
      : `✔ Returning customer`;

  badge.classList.remove("hidden");

}

      if (customerNameInput && !customerNameInput.value) {
        customerNameInput.value = data.customer.full_name || "";
      }

      if (customerMobileInput && !customerMobileInput.value) {
        customerMobileInput.value = data.customer.mobile || "";
      }

      window.RETURNING_CUSTOMER = true;

    } catch (err) {

      console.warn("Customer lookup failed:", err);

    }

  });

}

  /* Step 1 logic */
  syncPickupTimeOptions();
  updatePickupTimeVisibility();

  /* Step 3 logic (use existing global selectedDurationInput) */

  if (selectedDurationInput) {

    selectedDurationInput.addEventListener("change", () => {

      updateHalfDayPickup();

      /* ensure booking pickup time stays valid */
      const bookingTimeInput = document.getElementById("booking-pickup-time");

      if (bookingTimeInput && Number(selectedDurationInput.value) !== 0.5) {
        bookingTimeInput.value = "07:00";
      }

    });

  }

  updateHalfDayPickup();

  /* ======================================================
   SMART SUMMARY AUTO-UPDATE
====================================================== */

function initSmartSummaryUpdates(){

  const triggers = [
    pickupDateInput,
    durationDaysInput,
    pickupTimeInput,
    selectedLorryInput,
    dartfordCrossingInput,
    earlyPickupInput,
    voucherInput
  ];

  triggers.forEach(el=>{
    if(!el) return;

    el.addEventListener("change", ()=>{
      try{
        updateCheckoutSummary();
      }catch(e){
        console.warn("Summary update failed:", e);
      }
    });

  });

}

});


pickupTimeInput?.addEventListener("change", () => {

  // no automatic availability search
  // user must press "Check availability"

});

if (availabilityForm) {
  availabilityForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    /* prevent impossible duration selections */
    if (!validateDurationSelection()) return;

    const pickupDate = pickupDateInput?.value;
    const durationDays = Number(durationDaysInput?.value);
    const pickupTime = pickupTimeInput?.value;

    if (!pickupDate || Number.isNaN(durationDays) || durationDays <= 0) {
      if (availabilityResults) {
        availabilityResults.innerHTML =
          '<p class="empty-note">Enter a valid pickup date and duration.</p>';
      }
      return;
    }

    /* IMPORTANT: half day must select time first */

    if (durationDays === 0.5 && !pickupTime) {

      const group = document.getElementById("pickup-time-group");

      group?.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });

      group?.classList.add("duration-highlight");

      setTimeout(() => {
        group?.classList.remove("duration-highlight");
      }, 2000);

      pickupTimeInput?.focus();

      /* show small message */

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

    let finalPickupTime = DEFAULT_PICKUP_TIME;

    if (durationDays === 0.5) {

      if (!pickupTime) return;   // prevent search

      finalPickupTime = pickupTime;

    }

    const submitBtn = availabilityForm.querySelector(
      'button[type="submit"], input[type="submit"]'
    );

    if (submitBtn) submitBtn.disabled = true;

    renderAvailabilityLoading();

    try {

      const availableLorries = await getAvailableLorries(
        pickupDate,
        durationDays,
        finalPickupTime
      );

      renderAvailabilityResults(availableLorries);

    } catch (err) {

      console.warn("Availability search failed:", err);
      renderAvailabilityError(
        "Couldn’t check availability right now. Please try again."
      );

    } finally {

      if (submitBtn) submitBtn.disabled = false;

    }

  });
}



// Extras
dartfordEnabledInput?.addEventListener("change", () => {
  if (dartfordCountInput) dartfordCountInput.disabled = !dartfordEnabledInput.checked;
  updateCheckoutSummary();
});
dartfordCountInput?.addEventListener("input", updateCheckoutSummary);
earlyPickupEnabledInput?.addEventListener("change", updateCheckoutSummary);
hiredWithin3MonthsInput?.addEventListener("change", updateCheckoutSummary);

// booking selection changes
selectedPickupInput?.addEventListener("change", checkBookingFormAvailability);
selectedDurationInput?.addEventListener("change", checkBookingFormAvailability);

// Booking form submit (demo flow: store booking, then redirect to checkout)
if (bookingForm) {
  bookingForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!selectedAvailability) {
      alert("Please select a lorry from the availability results first.");
      return;
    }

    /* get pickup time (½ day selector) */

    const bookingPickupTime =
      document.getElementById("booking-pickup-time")?.value || "07:00";

    const stillAvailable = await isVehicleAvailable(
      selectedAvailability.vehicle.id,
      selectedAvailability.pickupDate,
      selectedAvailability.durationDays,
      bookingPickupTime
    );

    if (!stillAvailable) {
      alert("That lorry is no longer available for the selected dates. Please search again.");
      return;
    }

    const dartfordCrossings = dartfordEnabledInput?.checked
      ? Math.max(1, Number(dartfordCountInput?.value || 1))
      : 0;

    const earlyPickup = earlyPickupEnabledInput?.checked || false;

    const baseCost = Number(selectedAvailability.baseCost || 0);
    const discountAmount = Number(selectedAvailability.discountAmount || 0);
    const discountedBase = Math.max(0, baseCost - discountAmount);

    const hireTotal = calculateHireTotal(discountedBase, dartfordCrossings, earlyPickup);

    const confirmationFee = getConfirmationFee(selectedAvailability.vehicle);
    const outstandingAmount = Math.max(0, hireTotal - confirmationFee);

    const hiredWithinLast3Months = hiredWithin3MonthsInput?.checked || false;
    const requiredFormType = hiredWithinLast3Months ? "short" : "long";

    const existingIds = new Set((await getBookings()).map((item) => String(item.id)));
    const bookingId = generateNumericBookingId(existingIds);

    const shortFormLink = buildFormUrl(FORM_LINK_A, bookingId);
    const longFormLink = buildFormUrl(FORM_LINK_B, bookingId);
    const requiredFormLink = requiredFormType === "short" ? shortFormLink : longFormLink;

    /* build pickup / dropoff times */

    let pickupAt = new Date(selectedAvailability.pickupAt);
    let dropoffAt = new Date(selectedAvailability.dropoffAt);

    if (selectedAvailability.durationDays === 0.5) {

      const [h, m] = bookingPickupTime.split(":");

      pickupAt.setHours(Number(h), Number(m), 0, 0);

      dropoffAt = new Date(pickupAt);

      if (bookingPickupTime === "07:00") {
        dropoffAt.setHours(13, 0, 0, 0);
      } else {
        dropoffAt.setHours(19, 0, 0, 0);
      }

    }

    const booking = {
      id: bookingId,

      vehicleId: selectedAvailability.vehicle.id,

      vehicleSnapshot: {
        id: selectedAvailability.vehicle.id,
        name: selectedAvailability.vehicle.name,
        type: selectedAvailability.vehicle.type
      },

      pickupAt: pickupAt.toISOString(),
      dropoffAt: dropoffAt.toISOString(),

      durationDays: selectedAvailability.durationDays,
      durationHours: selectedAvailability.durationHours,

      pickupTime: bookingPickupTime,

      customerName: customerNameInput?.value || "",
      customerEmail: customerEmailInput?.value || "",
      customerMobile: customerMobileInput?.value || "",
      customerAddress: customerAddressInput?.value || "",
      customerDob: customerDobInput?.value || "",

      dartfordCrossings,
      crossingCharge: calculateCrossingCharge(dartfordCrossings),

      earlyPickup,
      earlyPickupCharge: calculateEarlyPickupCharge(earlyPickup),

      baseCost,
      discountAmount,
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

      createdAt: new Date().toISOString()
    };

    const bookings = await getBookings();
    bookings.push(booking);
    saveBookings(bookings);

    BOOKINGS_CACHE = null;
    AVAILABILITY_CACHE.clear();

    await getBookings(true);
    renderBookings();
    renderAdminBookings();

    // store booking temporarily for Step 4
window.pendingBooking = booking;

// move to review step
goToStep(4);
  });
}

const confirmBtn = document.getElementById("booking-confirm-btn");

if (confirmBtn) {
  confirmBtn.addEventListener("click", async () => {

    const booking = window.pendingBooking;

    if (!booking) {
      alert("Booking information missing.");
      return;
    }

    const checkoutUrl = await createStripeCheckoutSession(booking);

    if (!checkoutUrl) {
      alert("Stripe checkout link is not configured yet.");
      return;
    }

    resetBookingCustomerFields();

    window.location.href = checkoutUrl;

  });
}

// Admin buttons
refreshAdminBtn?.addEventListener("click", renderAdminBookings);
exportAdminCsvBtn?.addEventListener("click", exportAdminCsv);
exportAdminPdfBtn?.addEventListener("click", exportAdminPdf);

clearAdminBtn?.addEventListener("click", async () => {

  if (!confirm("Clear all saved demo bookings?")) return;

  try {

    await fetch(apiUrl("/api/bookings/clear"), {
      method: "POST"
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
  "3.5 T Stallion (MM68)1.webp",
  "3.5 T Stallion (MM68)2.webp",
  "3.5 T Stallion (MM68)3.webp",
  "3.5 T Stallion (MM68)4.webp",
  "3.5 T Stallion (MM68)5.webp",
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
  "7.5 T 4 Horses No Living4.webp"
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

function clearPreview() {

  document
    .querySelectorAll(".cal-preview")
    .forEach(el => el.classList.remove("cal-preview"));

  if (vehiclePreview) {
    vehiclePreview.classList.add("hidden");
  }

}

function previewRental(startDate) {

  const duration = Number(document.getElementById("duration-days")?.value || 1);

  const end = new Date(startDate);
  end.setDate(end.getDate() + duration - 1);

  const cells = document.querySelectorAll("#cal-grid .cal-day");

  cells.forEach(cell => {

    const day = Number(cell.textContent);
    if (!day) return;

    const cellDate = new Date(
      startDate.getFullYear(),
      startDate.getMonth(),
      day
    );

    if (cellDate >= startDate && cellDate <= end) {
      cell.classList.add("cal-preview");
    }

  });

}

function movePreview(e){

  if (!vehiclePreview) return;

  vehiclePreview.style.left = e.pageX + "px";
  vehiclePreview.style.top = e.pageY + "px";

}

async function showVehiclePreview(date, event) {

  const bookings = BOOKINGS_CACHE || await getBookings(false);

  const dateStart = new Date(date);
  dateStart.setHours(0,0,0,0);

  const dateEnd = new Date(dateStart);
  dateEnd.setDate(dateEnd.getDate() + 1);

  const booked = bookings.filter(b => {

    const start = new Date(b.pickupAt);
    const end = new Date(b.dropoffAt);

    return start < dateEnd && end > dateStart;

  });

  /* build preview html FIRST */

  let html = `<strong>${dateStart.toDateString()}</strong><br>`;

/* availability status */

if (!booked.length) {

  html += `<div class="preview-status preview-status-good">Available</div>`;

} else if (booked.length < vehicles.length) {

  html += `<div class="preview-status preview-status-low">Limited availability</div>`;

} else {

  html += `<div class="preview-status preview-status-none">Not available</div>`;

}

/* booked vehicles list */

if (!booked.length) {

  html += `<span class="muted">All vehicles available</span>`;

} else {

  booked.forEach(b => {

    const vehicle = vehicles.find(v => v.id === b.vehicleId);

    html += `
  <div class="preview-item">
  <strong>${vehicle ? vehicle.name : "Vehicle"}</strong><br>
  <span class="muted tiny">
    ${new Date(b.pickupAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC"
    })}
    →
    ${new Date(b.dropoffAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC"
    })}
  </span>
</div>
    `;

  });

}

  /* MOBILE VERSION */

  if (window.innerWidth < 768) {

    const panel = document.getElementById("mobile-preview");
    if (!panel) return;

    panel.innerHTML = html;
    panel.classList.remove("hidden");

    return;

  }

  /* DESKTOP VERSION */

  const vehiclePreview = document.getElementById("vehicle-preview");
  if (!vehiclePreview) return;

  vehiclePreview.innerHTML = html;
  vehiclePreview.classList.remove("hidden");

  if (event) movePreview(event);

}

function isMobile() {
  return window.innerWidth < 768;
}

/* ======================================================
   Phase 4 — Calendar Module (Render Only)
====================================================== */

(function () {

  const calGrid = document.getElementById("cal-grid");
  const calTitle = document.getElementById("cal-title");
  const calWrap = document.getElementById("availability-calendar");

  if (!calGrid || !calTitle || !calWrap) return;

  let currentDate = new Date();
  currentDate.setDate(1);

  /* ======================================================
     Check availability for a specific calendar day
  ====================================================== */
 
  function checkDayLocalAvailability(dateObj, bookings) {
    let availableVehicles = 0;

    vehicles
  .filter(v => !PRESELECTED_VEHICLE || v.id === PRESELECTED_VEHICLE)
  .forEach(vehicle => {

      const vehicleBookings = bookings.filter(
        b => b.vehicleId === vehicle.id && b.status !== "cancelled"
      );

      const pickupAt = new Date(dateObj);
      pickupAt.setHours(0,0,0,0);

      const dropoffAt = new Date(dateObj);
      dropoffAt.setHours(23,59,59,999);

      const overlapsExisting = vehicleBookings.some(booking => {

        const existingStart = new Date(booking.pickupAt);
        const existingEnd = new Date(booking.dropoffAt);

        return overlaps(pickupAt, dropoffAt, existingStart, existingEnd);

      });

      if (!overlapsExisting) {
        availableVehicles++;
      }

    });

    

    const totalVehicles = PRESELECTED_VEHICLE ? 1 : vehicles.length;

if (availableVehicles === 0) return "unavailable";
if (availableVehicles < totalVehicles) return "limited";
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

  return vehicles.some(vehicle => {

    const vehicleBookings = bookings.filter(
      b => b.vehicleId === vehicle.id && b.status !== "cancelled"
    );

    const overlapsExisting = vehicleBookings.some(booking => {

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

  bookings.forEach(booking => {

    const start = new Date(booking.pickupAt);
    const end = new Date(booking.dropoffAt);

    if (
      start.getFullYear() !== year ||
      start.getMonth() !== month
    ) return;

    const day = start.getDate();
    const cell = cells.find(c => Number(c.textContent) === day);

    if (!cell) return;
    cell.classList.add("cal-booked");

    const startHour = start.getUTCHours();
const endHour = end.getUTCHours();

    cell.classList.remove(
      "cal-booking-morning",
      "cal-booking-afternoon",
      "cal-booking-full"
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

/* load bookings (use cache if already available) */
const bookings = BOOKINGS_CACHE || await getBookings(false);

const year = currentDate.getFullYear();
const month = currentDate.getMonth();

const monthNames = [
"January","February","March","April","May","June",
"July","August","September","October","November","December"
];

calTitle.textContent = `${monthNames[month]} ${year}`;

calGrid.innerHTML = "";

const firstDay = new Date(year, month, 1);
const lastDay = new Date(year, month + 1, 0);

let startOffset = firstDay.getDay();
startOffset = startOffset === 0 ? 6 : startOffset - 1;

for (let i = 0; i < startOffset; i++) {
calGrid.appendChild(document.createElement("div"));
}

const today = new Date();
today.setHours(0,0,0,0);

for (let day = 1; day <= lastDay.getDate(); day++) {

const dayDate = new Date(year, month, day);
dayDate.setHours(0,0,0,0);

const dayEl = document.createElement("div");
dayEl.className = "cal-day";
dayEl.textContent = day;

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

  dayEl.classList.add("cal-unavailable","cal-past");
  calGrid.appendChild(dayEl);
  continue;

}

/* ===============================
   AVAILABILITY CHECK
=============================== */

const status = checkDayLocalAvailability(dayDate, bookings);
const validStart = canStartRental(dayDate, bookings);

renderAvailabilityDots(dayEl, bookings, dayDate);

if (status === "available") {
  dayEl.classList.add("cal-available");
}
else if (status === "limited") {
  dayEl.classList.add("cal-limited");
}
else {
  dayEl.classList.add("cal-unavailable");
}

if (!validStart) {

  dayEl.classList.remove("cal-available","cal-limited");
  dayEl.classList.add("cal-unavailable","cal-no-start");

}

/* ===============================
   PREVIEW EVENTS
=============================== */

dayEl.addEventListener("mouseenter", (e) => {

  clearPreview();
  previewRental(dayDate);
  showVehiclePreview(dayDate, e);

});

if (!isMobile()) {
  dayEl.addEventListener("mousemove", movePreview);
}

dayEl.addEventListener("mouseleave", clearPreview);

dayEl.addEventListener("touchend", (e) => {

  e.stopPropagation();

  clearPreview();
  previewRental(dayDate);
  showVehiclePreview(dayDate);

});

/* ===============================
   CLICK SELECTION
=============================== */

if (validStart) {

  dayEl.addEventListener("click", () => {

    clearPreview();
    selectDate(dayDate);

  });

}

calGrid.appendChild(dayEl);


}

//renderBookingBars(year, month, bookings);

/* unlock rendering */
calGrid.dataset.rendering = "false";

}


  /* ======================================================
     Select date
  ====================================================== */

 function selectDate(dayDate) {

  const pickupInput = document.getElementById("pickup-date");
  const durationInput = document.getElementById("duration-days");

  if (!pickupInput || !durationInput) return;

  const year = dayDate.getFullYear();
  const month = String(dayDate.getMonth() + 1).padStart(2, "0");
  const day = String(dayDate.getDate()).padStart(2, "0");

  pickupInput.value = `${year}-${month}-${day}`;

  /* reset duration */

  durationInput.value = "";

  /* clear vehicle availability results */

  if (availabilityResults) {
    availabilityResults.innerHTML = "";
  }

  /* reset selected vehicle */

  selectedAvailability = null;

  if (selectedLorryInput) selectedLorryInput.value = "";
  if (selectedBaseInput) selectedBaseInput.value = "";

  /* disable booking button again */

  if (bookingSubmitBtn) bookingSubmitBtn.disabled = true;

  /* refresh checkout summary */

  updateCheckoutSummary();

  /* highlight selected calendar day */

  document.querySelectorAll(".cal-selected")
    .forEach(el => el.classList.remove("cal-selected"));

  const calGrid = document.getElementById("cal-grid");

  Array.from(calGrid.children).forEach(cell => {
    if (Number(cell.textContent) === dayDate.getDate()) {
      cell.classList.add("cal-selected");
    }
  });

  /* scroll to duration selector */

  setTimeout(() => {

    const y =
      durationInput.getBoundingClientRect().top +
      window.pageYOffset -
      120;

    window.scrollTo({
      top: y,
      behavior: "smooth"
    });

    /* highlight duration input */

    durationInput.classList.add("duration-highlight");

    setTimeout(() => {
      durationInput.classList.remove("duration-highlight");
    }, 2000);

  }, 200);

}

function onCalendarDayClick(date){

  pickupDateInput.value = date;

  updateCheckoutSummary();

  const durationGroup = document.getElementById("duration-group");

  if(durationGroup){
    durationGroup.scrollIntoView({
      behavior:"smooth",
      block:"center"
    });
  }

}

/* ======================================================
   Month Navigation
====================================================== */

async function changeMonth(direction) {

  currentDate.setMonth(currentDate.getMonth() + direction);
  await renderCalendar();

}

calWrap.addEventListener("click", (e) => {

  const nav = e.target.closest("[data-cal-nav]");
  if (!nav) return;

  const direction = nav.dataset.calNav === "next" ? 1 : -1;
  changeMonth(direction);

});

/* ======================================================
   Live Booking Updates
====================================================== */

async function watchBookingUpdates() {

  try {

    const res = await fetch(
      "https://equine-bookings-api.kverhagen.workers.dev/api/bookings/version"
    );

    const data = await res.json();

    if (BOOKINGS_VERSION === null) {
      BOOKINGS_VERSION = data.version;
      return;
    }

    if (data.version !== BOOKINGS_VERSION) {

      console.log("New booking detected — refreshing calendar");

      BOOKINGS_VERSION = data.version;

      BOOKINGS_CACHE = null;

      await getBookings(true);

      renderBookings();
      renderAdminBookings();

      if (typeof renderCalendar === "function") {
        renderCalendar();
      }

    }

  } catch (err) {

    console.warn("Booking watcher failed", err);

  }

}

function renderAvailabilityDots(dayEl, bookings, dayDate) {

  const wrap = document.createElement("div");
  wrap.className = "cal-lines";

  vehicles.forEach(vehicle => {

    const line = document.createElement("div");
    line.className = "cal-line";

    const dayStart = new Date(dayDate);
    dayStart.setHours(0, 0, 0, 0);

    const dayEnd = new Date(dayDate);
    dayEnd.setHours(23, 59, 59, 999);

    const vehicleBookings = bookings.filter(b => {
      if (b.vehicleId !== vehicle.id) return false;
      if (b.status === "cancelled") return false;

      const start = new Date(b.pickupAt);
      const end = new Date(b.dropoffAt);

      return start <= dayEnd && end >= dayStart;
    });

    let hasMorning = false;
    let hasAfternoon = false;
    let hasFullDay = false;

    vehicleBookings.forEach(b => {
      const start = new Date(b.pickupAt);
      const end = new Date(b.dropoffAt);

      const sameDay =
        start.getFullYear() === dayDate.getFullYear() &&
        start.getMonth() === dayDate.getMonth() &&
        start.getDate() === dayDate.getDate() &&
        end.getFullYear() === dayDate.getFullYear() &&
        end.getMonth() === dayDate.getMonth() &&
        end.getDate() === dayDate.getDate();

      const startHour = start.getUTCHours();
const endHour = end.getUTCHours();

      if (sameDay && startHour === 7 && endHour === 13) {
        hasMorning = true;
      } else if (sameDay && startHour === 13 && endHour === 19) {
        hasAfternoon = true;
      } else {
        hasFullDay = true;
      }
    });

 if (hasMorning && hasAfternoon) {
  line.classList.add("booked-am", "booked-pm");
}
else if (hasMorning) {
  line.classList.add("booked-am");
}
else if (hasAfternoon) {
  line.classList.add("booked-pm");
}
else if (hasFullDay) {
  line.classList.add("booked-full");
}

    wrap.appendChild(line);

  });

  dayEl.appendChild(wrap);

}

function updateCheckoutSummary(pricing) {

  const lines = document.getElementById("summary-lines");
  const totalEl = document.getElementById("summary-total");
  const dueEl = document.getElementById("summary-due");
  const remainingEl = document.getElementById("summary-remaining");

  if (!lines || !totalEl || !dueEl || !remainingEl) return;

  /* --------------------------------
     MODE 1: Pricing preview
  -------------------------------- */

  if (pricing) {

    lines.innerHTML = "";

    function row(label, value) {
      const div = document.createElement("div");
      div.className = "summary-row";
      div.innerHTML = `<span>${label}</span><span>£${value}</span>`;
      lines.appendChild(div);
    }

    if (pricing.base) {
      row("Base hire", pricing.base);
    }

    if (pricing.voucher_discount) {
      row("Voucher discount", "-" + pricing.voucher_discount);
    }

    totalEl.innerText = "£" + (pricing.total ?? 0);
    dueEl.innerText = "£" + (pricing.deposit_due ?? 0);
    remainingEl.innerText = "£" + (pricing.remaining ?? 0);

    return;
  }

  /* --------------------------------
     MODE 2: Booking summary
  -------------------------------- */

  if (!selectedAvailability) {
    lines.innerHTML = "<div class='summary-row muted'>Select a lorry to continue</div>";
    return;
  }

  const vehicle = selectedAvailability.vehicle;
  const baseCost = Number(selectedAvailability.baseCost || 0);
  const discountAmount = Number(selectedAvailability.discountAmount || 0);

  const confirmationFee = getConfirmationFee(vehicle);
  const total = baseCost - discountAmount;
  const remaining = Math.max(0, total - confirmationFee);

  lines.innerHTML = `
    <div class="summary-row">
      <span>${vehicle.name}</span>
      <span>£${baseCost.toFixed(2)}</span>
    </div>

    ${
      discountAmount > 0
        ? `<div class="summary-row discount">
            <span>Discount</span>
            <span>-£${discountAmount.toFixed(2)}</span>
          </div>`
        : ""
    }
  `;

  totalEl.innerText = "£" + total.toFixed(2);
  dueEl.innerText = "£" + confirmationFee.toFixed(2);
  remainingEl.innerText = "£" + remaining.toFixed(2);

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

    const form = document.getElementById("availability-form");

    if (form) {
      form.requestSubmit();
    }

  }

});

}

//* start live booking watcher */

//watchBookingUpdates();
//setInterval(watchBookingUpdates, 30000);

})();

