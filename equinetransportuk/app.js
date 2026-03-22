/* ======================================================
   Equine Transport UK — Booking Flow (Client)
   Phase 2: Server Pricing
   Phase 3: Discount Engine (voucher codes)
   ====================================================== */

let activeSlideshow = null;

let PRESELECTED_VEHICLE = null;

let BLOCK_AUTO_SCROLL = false;

let LOCKED_VEHICLE = false;



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

/* ===============================
   Global performance locks
================================ */

let stripeReturnHandled = false;
let stripeReturnPromise = null;

let bookingsRequestPromise = null;
let calendarRenderPromise = null;

const BOOKING_BY_SESSION_PROMISES = new Map();


let extrasRequestId = 0;




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

// Only auto scroll for steps AFTER step 1
if (step > 1) {
  setTimeout(()=>{
    stepEl?.scrollIntoView({
      behavior:"smooth",
      block:"start"
    });
  },100);
}

}

function startBooking(vehicleId) {

  PRESELECTED_VEHICLE = vehicleId;
  LOCKED_VEHICLE = true; // ✅ NEW

  const vehicle = vehicles.find(v => v.id === vehicleId);

  // 🔥 Force duration rules immediately
  updateDurationOptionsForVehicle(vehicle);

  // 🔥 Remove half-day for 7.5T instantly
  enforceVehicleDurationRules(vehicle);

  updateCalendarVehicleLabel();

  selectedAvailability = null;

  if (selectedLorryInput) selectedLorryInput.value = vehicle?.name || "";
  if (selectedBaseInput) selectedBaseInput.value = "";

  const bookingSection = document.getElementById("booking");

  bookingSection?.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });

  goToStep(1);

  // 🔥 Auto re-check availability if already filled
  const pickupDate = pickupDateInput?.value;
  const durationDays = Number(durationDaysInput?.value || 1);

  if (pickupDate && durationDays > 0) {
    setTimeout(() => availabilityForm?.requestSubmit(), 300);
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
/* ===============================
   INPUT CHANGE HANDLERS
=============================== */

/* When duration changes */
durationDaysInput?.addEventListener("change", () => {
  updatePickupTimeVisibility?.();
  syncPickupTimeOptions?.();
  updateEarlyPickupAvailability();   // ✅ HERE
});

/* When pickup time changes (IMPORTANT FIX) */
pickupTimeInput?.addEventListener("change", async () => {

  const pickupDate = pickupDateInput?.value;
  if (!pickupDate) return;

  await updateDurationOptions(
    new Date(`${pickupDate}T00:00:00`)
  );

  // ✅ ADD THIS
  updateEarlyPickupAvailability();

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

const earlyPickupCheckbox = document.getElementById("early-pickup-enabled");
/* ===============================
   🔥 EXTRAS CHANGE → REPRICE
=============================== */

[dartfordEnabledInput, dartfordCountInput, earlyPickupEnabledInput]
  .forEach(input => {
    input?.addEventListener("change", refreshPricingWithExtras);
  });

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
      getCurrentDiscountCode()
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
      const selectedDate = new Date(`${date}T00:00:00`);
      if (Number.isNaN(selectedDate.getTime())) return;

      // ✅ SINGLE SOURCE OF TRUTH
      await selectDate(selectedDate);

      // ✅ trigger availability AFTER state is correct
      availabilityForm?.requestSubmit();

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
 
async function syncBookingPickupTimeOptions(dateObj, vehicleId) {

  const select = document.getElementById("booking-pickup-time");
  if (!select || !dateObj || !vehicleId) return;

  const bookings = BOOKINGS_CACHE || await getBookings(false);

  let morningAvailable = false;
  let afternoonAvailable = false;

  const vehicleBookings = bookings.filter(
    b => b.vehicleId === vehicleId && b.status !== "cancelled"
  );

  const dayStart = new Date(dateObj);
  dayStart.setHours(0,0,0,0);

  const dayEnd = new Date(dateObj);
  dayEnd.setHours(23,59,59,999);

  let morningBooked = false;
  let afternoonBooked = false;

  vehicleBookings.forEach(b => {

    const start = new Date(b.pickupAt);
    const end = new Date(b.dropoffAt);

    if (start <= dayEnd && end >= dayStart) {

      const startHour = getLondonHour(start);
      const endHour = getLondonHour(end);

      if (startHour < 13) morningBooked = true;
      if (endHour > 13) afternoonBooked = true;

    }

  });

  morningAvailable = !morningBooked;
  afternoonAvailable = !afternoonBooked;

  const morningOption = select.querySelector('option[value="07:00"]');
  const afternoonOption = select.querySelector('option[value="13:00"]');

  if (morningOption) morningOption.disabled = !morningAvailable;
  if (afternoonOption) afternoonOption.disabled = !afternoonAvailable;

  /* auto-fix selection */

  if (select.value === "07:00" && !morningAvailable && afternoonAvailable) {
    select.value = "13:00";
  }

  if (select.value === "13:00" && !afternoonAvailable && morningAvailable) {
    select.value = "07:00";
  }

  if (!morningAvailable && !afternoonAvailable) {
    select.value = "";
  }

}


function getRemainingSlots(dateObj, bookings){

  let remainingSlots = 0;

  vehicles
    .filter(v => !PRESELECTED_VEHICLE || v.id === PRESELECTED_VEHICLE)
    .forEach(vehicle => {

      const vehicleBookings = bookings.filter(
        b => b.vehicleId === vehicle.id && b.status !== "cancelled"
      );

      const dayStart = new Date(dateObj);
      dayStart.setHours(0,0,0,0);

      const dayEnd = new Date(dateObj);
      dayEnd.setHours(23,59,59,999);

      let morningBooked = false;
      let afternoonBooked = false;

      vehicleBookings.forEach(b => {

        const start = new Date(b.pickupAt);
        const end = new Date(b.dropoffAt);

        if(start <= dayEnd && end >= dayStart){

          const startHour = getLondonHour(start);
          const endHour = getLondonHour(end);

          if (startHour < 13) morningBooked = true;
          if (endHour > 13) afternoonBooked = true;

        }

      });

      if(!morningBooked) remainingSlots++;
      if(!afternoonBooked) remainingSlots++;

    });

  return remainingSlots;
}

function getAvailableVehicleCount(dayDate, bookings){

  let count = 0;

  for(const vehicle of vehicles){

    const vehicleBookings = bookings.filter(
      b => b.vehicleId === vehicle.id && b.status !== "cancelled"
    );

    const hasOverlap = vehicleBookings.some(b => {

  const start = new Date(b.pickupAt);
  const end = new Date(b.dropoffAt);

  const dayStart = new Date(dayDate);
  dayStart.setHours(0,0,0,0);

  const dayEnd = new Date(dayDate);
  dayEnd.setHours(23,59,59,999);

  return start <= dayEnd && end >= dayStart;

});

    if(!hasOverlap) count++;

  }

  return count;

}

function getLondonHour(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    hour12: false
  }).formatToParts(date);

  return Number(parts.find(p => p.type === "hour")?.value || 0);
}

function getLondonParts(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);

  const get = (type) => parts.find(p => p.type === type)?.value || "";

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute"))
  };
}

/* =================================
   HALF DAY SLOT AVAILABILITY
================================ */

function getRemainingHalfDaySlots(dateObj, bookings) {

  let morningAvailable = false;
  let afternoonAvailable = false;

  vehicles
    .filter(vehicle => {
      if (PRESELECTED_VEHICLE && vehicle.id !== PRESELECTED_VEHICLE) return false;
      return is35T(vehicle); // ✅ only 3.5T can offer half-day
    })
    .forEach(vehicle => {

      const vehicleBookings = bookings.filter(
        b => b.vehicleId === vehicle.id && b.status !== "cancelled"
      );

      const dayStart = new Date(dateObj);
      dayStart.setHours(0, 0, 0, 0);

      const dayEnd = new Date(dateObj);
      dayEnd.setHours(23, 59, 59, 999);

      let morningBooked = false;
      let afternoonBooked = false;

      vehicleBookings.forEach(b => {
        const start = new Date(b.pickupAt);
        const end = new Date(b.dropoffAt);

        if (start <= dayEnd && end >= dayStart) {
          const startHour = getLondonParts(start).hour;
          const endHour = getLondonParts(end).hour;

          if (startHour <= 12) morningBooked = true;
          if (endHour >= 13) afternoonBooked = true;
        }
      });

      if (!morningBooked) morningAvailable = true;
      if (!afternoonBooked) afternoonAvailable = true;
    });

  return { morningAvailable, afternoonAvailable };
}

function updateEarlyPickupAvailability() {

  const duration = Number(
    selectedDurationInput?.value ||
    durationDaysInput?.value ||
    1
  );

  const bookingTime = document.getElementById("booking-pickup-time")?.value;

  const pickupTime =
    bookingTime ||
    pickupTimeInput?.value ||
    selectedAvailability?.pickupTime ||
    "07:00";

  console.log("EarlyPickupCheck:", { duration, pickupTime });

  const isMorning = pickupTime === "07:00";

  const canUseEarlyPickup = isMorning;

  if (!earlyPickupCheckbox) return;

  const label = earlyPickupCheckbox.closest("label");
  const textSpan = label?.querySelector("span:last-child");

  if (!canUseEarlyPickup) {

    earlyPickupCheckbox.checked = false;
    earlyPickupCheckbox.disabled = true;

    if (textSpan) {
      textSpan.innerText =
        "Early pickup only available for morning bookings.";
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

async function syncPickupTimeOptions(startDate) {
  if (!pickupTimeInput || !durationDaysInput) return;

  const duration = Number(durationDaysInput.value || 0);

  const existingPmOption = Array.from(pickupTimeInput.options)
    .find(opt => opt.value === "13:00");

 if (duration !== 0.5) {

  const morningOption = pickupTimeInput.querySelector('option[value="07:00"]');
  const afternoonOption = pickupTimeInput.querySelector('option[value="13:00"]');

  if (morningOption) morningOption.disabled = false;

  /* 🔥 FIX: always disable afternoon for multi-day */
  if (afternoonOption) afternoonOption.disabled = true;

  pickupTimeInput.value = "07:00";

  return;
}

 if (!startDate) return;

const bookings = BOOKINGS_CACHE || await getBookings(false);

/* ===============================
   🔥 HALF-DAY AVAILABILITY (3.5T ONLY)
=============================== */

const { morningAvailable, afternoonAvailable } =
  getRemainingHalfDaySlots(startDate, bookings);

const morningOption = pickupTimeInput.querySelector('option[value="07:00"]');
const afternoonOption = pickupTimeInput.querySelector('option[value="13:00"]');

/* ===============================
   APPLY DISABLED STATES
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
   AUTO-FIX SELECTED VALUE
=============================== */

const current = pickupTimeInput.value;

if (current === "07:00" && !morningAvailable) {
  if (afternoonAvailable) {
    pickupTimeInput.value = "13:00";
  } else {
    pickupTimeInput.value = "";
  }
}

else if (current === "13:00" && !afternoonAvailable) {
  if (morningAvailable) {
    pickupTimeInput.value = "07:00";
  } else {
    pickupTimeInput.value = "";
  }
}

/* ===============================
   NOTHING AVAILABLE
=============================== */

if (!morningAvailable && !afternoonAvailable) {
  pickupTimeInput.value = "";
}

/* ===============================
   DEBUG (optional but useful)
=============================== */

console.log("🕐 Half-day availability:", {
  date: startDate,
  morningAvailable,
  afternoonAvailable
});
}

function renderBookingConfirmation(booking) {

  const container = document.getElementById("booking-confirmation");
  if (!container) return;

  const formatDate = (iso) => {
    const d = new Date(iso);
    return d.toLocaleString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  const vehicleName =
    booking.vehicleSnapshot?.name ||
    booking.vehicleId ||
    "Vehicle";

  const extras = booking.extras || {};

  // 🔥 PRICE DATA (fallback safe)
const priceBase = booking.baseCost || 0;
const priceExtras = booking.extrasTotal || 0;
const priceTotal = booking.hireTotal || 0;
const paidNow = booking.confirmationFee || 0;
const outstanding = booking.outstandingAmount || Math.max(priceTotal - paidNow, 0);

  // 🔥 Extras display
  const extrasRows = Object.entries(extras)
    .filter(([_, v]) => v)
    .map(([key]) => {
      if (key === "earlyPickup") return "Early pickup";
      if (key === "dartford") return "Dartford crossing";
      return key;
    });

  const shortRef = booking.id?.slice(-10); // nicer ref

  container.innerHTML = `
    <div class="confirmation-card pro">

      <div class="confirmation-header">
        <h2>🎉 Booking Confirmed</h2>
        <div class="confirmation-ref">Ref: ${shortRef}</div>
      </div>

      <!-- VEHICLE -->
      <div class="confirmation-section">
        <div class="label">Vehicle</div>
        <div class="value strong">${vehicleName}</div>
      </div>

      <!-- TIMES -->
      <div class="confirmation-section grid">
        <div>
          <div class="label">Pickup</div>
          <div class="value">${formatDate(booking.pickupAt)}</div>
        </div>
        <div>
          <div class="label">Return</div>
          <div class="value">${formatDate(booking.dropoffAt)}</div>
        </div>
      </div>

      <!-- EXTRAS -->
      ${
        extrasRows.length
          ? `
        <div class="confirmation-section">
          <div class="label">Extras</div>
          <div class="value">${extrasRows.join(", ")}</div>
        </div>
      `
          : ""
      }

      <!-- PRICE BREAKDOWN -->
      <div class="confirmation-section price-box">

        <div class="price-row">
          <span>Hire</span>
          <span>£${priceBase.toFixed(2)}</span>
        </div>

        ${
          priceExtras > 0
            ? `
          <div class="price-row">
            <span>Extras</span>
            <span>£${priceExtras.toFixed(2)}</span>
          </div>
        `
            : ""
        }

        <div class="price-row total">
          <span>Total</span>
          <span>£${priceTotal.toFixed(2)}</span>
        </div>

        <div class="price-row paid">
          <span>Paid now</span>
          <span>£${paidNow.toFixed(2)}</span>
        </div>

        ${
          outstanding > 0
            ? `
          <div class="price-row outstanding">
            <span>Outstanding</span>
            <span>£${outstanding.toFixed(2)}</span>
          </div>
        `
            : ""
        }

      </div>

      <!-- STATUS -->
      <div class="confirmation-status">
        ✅ Payment received
      </div>

      <!-- INFO -->
      <div class="confirmation-footer">
        <p>A confirmation email has been sent.</p>
        <p class="muted">Please bring your driving licence on collection.</p>
      </div>

      <button 
       class="btn primary"
       onclick="window.location.href='https://kvwebservices.co.uk/equinetransportuk/index.html'">
       Back to homepage
     </button>

    </div>
  `;
}


async function handleStripeReturn() {
  const url = new URL(window.location.href);

  const state = url.searchParams.get("checkout");
  const sessionId = url.searchParams.get("session_id");

  if (state === "cancelled") {
    alert("Payment cancelled");
    return;
  }

  if (state !== "success" || !sessionId) return;

  if (stripeReturnHandled) {
    return stripeReturnPromise;
  }

  stripeReturnHandled = true;

  stripeReturnPromise = (async () => {
    console.log("🚀 handleStripeReturn running", { sessionId });

    goToStep(5);

    const container = document.getElementById("booking-confirmation");

    if (container) {
      container.innerHTML = `
        <div class="confirmation-card">
          <h2>✅ Payment received</h2>
          <p>Finalising your booking...</p>
          <p class="muted">This usually takes a few seconds</p>
        </div>
      `;
    }

    try {
      const booking = await fetchBookingWithRetry(sessionId);
      console.log("CONFIRM BOOKING:", booking);

      if (!booking || !booking.pickupAt) {
        console.warn("⚠️ Booking not ready after retries");

        if (container) {
          container.innerHTML = `
            <div class="confirmation-card">
              <h2>⏳ Payment received</h2>
              <p>Your booking is still being finalised.</p>
              <p class="muted">
                Please refresh in a few seconds or check your email.
              </p>
              <button onclick="location.reload()" class="btn">
                Refresh
              </button>
            </div>
          `;
        }

        return;
      }

      console.log("🧪 BOOKING EXTRAS:", booking.extras);

      renderBookingConfirmation(booking);

      window.history.replaceState({}, "", window.location.pathname + "#booking");

      console.log("✅ Stripe return handled successfully");

      BOOKINGS_CACHE = null;
      BOOKINGS_CACHE_AT = 0;
      await getBookings(true);

    } catch (err) {
      console.warn("Final fallback:", err);

      if (container) {
        container.innerHTML = `
          <div class="confirmation-card">
            <h2>⏳ Payment received</h2>
            <p>Your booking is being finalised.</p>
            <p class="muted">
              This can take a few seconds.<br>
              Please refresh this page or check your email for confirmation.
            </p>
            <button onclick="location.reload()" class="btn">
              Refresh
            </button>
          </div>
        `;
      }
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

    const vehiclesToCheck = LOCKED_VEHICLE && PRESELECTED_VEHICLE
      ? vehicles.filter(v => v.id === PRESELECTED_VEHICLE)
      : vehicles;

    // 🚀 PARALLEL CHECK (faster)
    const checks = vehiclesToCheck.map(vehicle =>
      isVehicleAvailable(
        vehicle.id,
        dateString,
        durationDays,
        pickupTime
      )
    );

    const results = await Promise.all(checks);

    if (results.some(r => r)) {
      return testDate;
    }

  }

  return null;
}



function getMaxAvailableDuration(startDate, bookings) {

  let maxDays = 0;

  for (let d = 1; d <= 14; d++) { // max hire length

    const end = new Date(startDate);
    end.setDate(end.getDate() + d - 1);

    const possible = vehicles.some(vehicle => {

      const vehicleBookings = bookings.filter(
        b => b.vehicleId === vehicle.id && b.status !== "cancelled"
      );

      const overlap = vehicleBookings.some(booking => {

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
      block: "start"
    });

  }

}


function resetBookingFlow() {

  console.log("🔄 Reset booking flow");

  /* ===============================
     CLEAR STATE
  =============================== */

  selectedAvailability = null;

  /* clear form fields */
  if (selectedLorryInput) selectedLorryInput.value = "";
  if (selectedPickupInput) selectedPickupInput.value = "";
  if (selectedDurationInput) selectedDurationInput.value = "1";
  if (selectedBaseInput) selectedBaseInput.value = "";

  if (pickupDateInput) pickupDateInput.value = "";
  if (pickupTimeInput) pickupTimeInput.value = "";

  /* ===============================
     UI RESET
  =============================== */

  const row = document.getElementById("pickup-time-row");
  if (row) row.style.display = "none";

  const group = document.getElementById("pickup-time-group");
  if (group) group.style.display = "none";

  if (availabilityResults) availabilityResults.innerHTML = "";

  const confirmation = document.getElementById("booking-confirmation");
  if (confirmation) confirmation.innerHTML = "";

  /* ===============================
     CACHE STRATEGY (IMPORTANT)
  =============================== */

  // ✅ keep bookings cache (BIG performance win)
  // BOOKINGS_CACHE = null; ❌ REMOVE THIS

  // ✅ only clear availability (this is user-specific)
  AVAILABILITY_CACHE.clear();

  /* ===============================
     BUTTON + SUMMARY
  =============================== */

  if (bookingSubmitBtn) bookingSubmitBtn.disabled = true;

  updateCheckoutSummary();

  /* ===============================
     NAVIGATION
  =============================== */

  goToStep(1);

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });

  /* ===============================
     CALENDAR RENDER (SAFE)
  =============================== */

  if (typeof renderCalendar === "function") {
    // no force refresh → uses cached bookings + render lock
    renderCalendar();
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
  return `${baseUrl}?id=${encodeURIComponent(bookingId)}`;
}

function addDays(date, days) {
  const output = new Date(date);
  output.setDate(output.getDate() + days);
  return output;
}

function asDate(dateString, timeString) {
  const [year, month, day] = dateString.split("-").map(Number);
  const [hour, minute] = timeString.split(":").map(Number);

  return new Date(Date.UTC(year, month - 1, day, hour, minute));
}

async function getBookings(forceRefresh = false) {
  const now = Date.now();

  if (!forceRefresh && BOOKINGS_CACHE && (now - BOOKINGS_CACHE_AT) < BOOKINGS_CACHE_TTL) {
    return BOOKINGS_CACHE;
  }

  if (bookingsRequestPromise) {
    return bookingsRequestPromise;
  }

  bookingsRequestPromise = (async () => {
    try {
      const firstDay = new Date();
      firstDay.setMonth(firstDay.getMonth() - 2);
      firstDay.setDate(1);
      firstDay.setHours(0, 0, 0, 0);

      const lastDay = new Date();
      lastDay.setMonth(lastDay.getMonth() + 3);
      lastDay.setDate(0);
      lastDay.setHours(23, 59, 59, 999);

      const res = await fetch(
        `${apiUrl("/api/bookings/list")}?from=${encodeURIComponent(firstDay.toISOString())}&to=${encodeURIComponent(lastDay.toISOString())}`
      );

      if (!res.ok) {
        console.warn("Booking API returned", res.status);
        throw new Error("Booking API unavailable");
      }

      const data = await res.json();

      BOOKINGS_CACHE = Array.isArray(data.bookings) ? data.bookings : [];
      BOOKINGS_CACHE_AT = Date.now();

      return BOOKINGS_CACHE;

    } catch (err) {
      console.warn("⚠️ Booking API unavailable, fallback to local storage", err);

      try {
        BOOKINGS_CACHE = JSON.parse(localStorage.getItem(STORAGE_BOOKINGS) || "[]");
        BOOKINGS_CACHE_AT = Date.now();
        return BOOKINGS_CACHE;
      } catch {
        BOOKINGS_CACHE = [];
        BOOKINGS_CACHE_AT = Date.now();
        return BOOKINGS_CACHE;
      }
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
    hour12: false
  });
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleTimeString("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}



function formatDateOnly(value) {
  if (!value) return "—";

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleDateString("en-GB", {
    timeZone: "Europe/London", // 🔥 CRITICAL FIX
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function is35T(vehicle) {
  return (
    String(vehicle?.id || "").startsWith("v35") ||
    String(vehicle?.type || "").toLowerCase().includes("3.5")
  );
}

function enforceVehicleDurationRules(vehicle) {

  if (!durationDaysInput) return;

  const halfDayOption = durationDaysInput.querySelector('option[value="0.5"]');
  if (!halfDayOption) return;

  if (!is35T(vehicle)) {
    halfDayOption.disabled = true;
    halfDayOption.hidden = true;

    if (durationDaysInput.value === "0.5") {
      durationDaysInput.value = "1";
    }
  } else {
    halfDayOption.disabled = false;
    halfDayOption.hidden = false;
  }

}

function filterVehiclesForDisplay(vehiclesList) {

  if (!LOCKED_VEHICLE || !PRESELECTED_VEHICLE) {
    return vehiclesList;
  }

  return vehiclesList.filter(v => v.vehicle.id === PRESELECTED_VEHICLE);
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
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;

  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric"
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
    `<span class="search-chip"><strong>Duration:</strong> ${escapeHtml(formatDurationLabel(durationDays))}</span>`
  ];

  if (durationDays === 0.5) {
    chips.push(
      `<span class="search-chip"><strong>Pickup:</strong> ${escapeHtml(formatPickupTimeLabel(pickupTime))}</span>`
    );
  }

  if (items.length > 0) {
    chips.push(
      `<span class="search-chip search-chip-accent"><strong>${items.length}</strong> ${items.length === 1 ? "lorry" : "lorries"} available</span>`
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
      block: "start"
    });
  }, 120);
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
   Pricing API (server quote with local fallback)
====================================================== */

async function fetchServerQuote(vehicle, durationDays, pickupDate, pickupTime, discountCode = "") {

  // 🔒 Local development safeguard (prevents 405 spam on Live Server)
if (location.hostname === "127.0.0.1" || location.hostname === "localhost") {
  console.log("Skipping pricing API (localhost dev)");

  const fallbackBase = calculateBaseCost(vehicle, durationDays, pickupDate, pickupTime);

  const extras = {
  dartford: dartfordEnabledInput?.checked
    ? Number(dartfordCountInput?.value || 0)
    : 0,

  earlyPickup:
    earlyPickupEnabledInput?.checked &&
    !earlyPickupEnabledInput?.disabled
      ? 1
      : 0
};

  console.log("🚚 EXTRAS SENT:", extras);

  const extrasTotal =
    (extras.dartford || 0) * 4.2 +
    (extras.earlyPickup ? 20 : 0);

  const total = fallbackBase + extrasTotal;

  return {
    baseCost: fallbackBase,
    discountAmount: 0,
    extrasTotal,
    total
  };



}

try {

  /* ===============================
     EXTRAS (🔥 NEW)
  =============================== */

console.log("EARLY PICKUP ELEMENT:", earlyPickupEnabledInput);
console.log("EARLY PICKUP CHECKED:", earlyPickupEnabledInput?.checked);
console.log("EARLY PICKUP DISABLED:", earlyPickupEnabledInput?.disabled);

  const extras = {
  dartford: dartfordEnabledInput?.checked
    ? Number(dartfordCountInput?.value || 0)
    : 0,

  earlyPickup:
    earlyPickupEnabledInput?.checked &&
    !earlyPickupEnabledInput?.disabled
      ? 1
      : 0
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
      extras // 🔥 SEND TO BACKEND
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
  extrasTotal: Number(pricing.extrasTotal ?? 0),
  total: Number(pricing.total ?? 0)
};

} catch (err) {

  console.warn("⚠️ Pricing API failed. Falling back to local pricing.", err);

  const fallbackBase = calculateBaseCost(vehicle, durationDays, pickupDate, pickupTime);

  const extras = {
  dartford: dartfordEnabledInput?.checked
    ? Number(dartfordCountInput?.value || 0)
    : 0,

  earlyPickup:
    earlyPickupEnabledInput?.checked &&
    !earlyPickupEnabledInput?.disabled
      ? 1
      : 0
};

  const extrasTotal =
    (extras.dartford || 0) * 4.2 +
    (extras.earlyPickup ? 20 : 0);

  const total = fallbackBase + extrasTotal;

  return {
    baseCost: fallbackBase,
    discountAmount: 0,
    extrasTotal,
    total
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
    const year = dropoffDate.getFullYear();
const month = String(dropoffDate.getMonth() + 1).padStart(2, "0");
const day = String(dropoffDate.getDate()).padStart(2, "0");

dropoffAt = asDate(`${year}-${month}-${day}`, dropoffTime);

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
    extrasTotal: pricing.extrasTotal,
    total: pricing.total

  };


  /* =====================================================
     UPDATE CHECKOUT SUMMARY UI
     ===================================================== */


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

  const candidate = await buildAvailability(vehicle, pickupDate, durationDays, pickupTime, "");

  const vehicleBookings = (await getBookings()).filter(
    (booking) => booking.vehicleId === vehicleId && booking.status !== "cancelled"
  );

  return !vehicleBookings.some((booking) => {

    const existingStart = new Date(booking.pickupAt);
    const existingEnd = new Date(booking.dropoffAt);

    /* ======================================
       HALF-DAY BUSINESS RULES
       morning and afternoon on same day
       should be allowed together
    ====================================== */
    if (Number(durationDays) === 0.5) {

      const requestedSlot = pickupTime === "13:00" ? "pm" : "am";
      const existingDuration = Number(booking.durationDays || 1);
      const existingDate = booking.pickupAt?.slice(0, 10);
      const sameDate = existingDate === pickupDate;

      /* another half-day booking on same date */
      if (existingDuration === 0.5 && sameDate) {

        const existingSlot =
          (booking.pickupTime === "13:00") ? "pm" : "am";

        /* same slot = blocked, opposite slot = allowed */
        return existingSlot === requestedSlot;

      }

      /* full-day or multi-day bookings still block normally */
      return overlaps(candidate.pickupAt, candidate.dropoffAt, existingStart, existingEnd);
    }

    /* ======================================
       NORMAL FULL-DAY / MULTI-DAY OVERLAP
    ====================================== */
    return overlaps(candidate.pickupAt, candidate.dropoffAt, existingStart, existingEnd);

  });
}

async function getAvailableLorries(pickupDate, durationDays, pickupTime) {
  const vehiclesToCheck =
    LOCKED_VEHICLE && PRESELECTED_VEHICLE
      ? vehicles.filter(v => v.id === PRESELECTED_VEHICLE)
      : vehicles;

  const results = await Promise.all(
    vehiclesToCheck.map(async (vehicle) => {
      const available = await isVehicleAvailable(
        vehicle.id,
        pickupDate,
        durationDays,
        pickupTime
      );

      if (!available) return null;

      return buildAvailability(
        vehicle,
        pickupDate,
        durationDays,
        pickupTime
      );
    })
  );

  return results.filter(Boolean);
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


  console.log("render items:", items.map(v => v.vehicle.name));

  items = filterVehiclesForDisplay(items);

  if (!pickupDateInput?.value || !durationDaysInput?.value) {
    availabilityResults.innerHTML = "";
    return;
  }

  updateAvailabilitySearchSummary(items);

  const pricePreview = document.getElementById("price-preview");

  /* ===============================
     PRICE PREVIEW (HEADER)
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

  const pickupDate = pickupDateInput.value;
  const duration = Number(durationDaysInput.value);
  const pickupTime = pickupTimeInput?.value || DEFAULT_PICKUP_TIME;

  const nextDate = await findNextAvailableDate(
    new Date(pickupDate),
    duration,
    pickupTime
  );

  let suggestionHTML = "";

  if (nextDate) {

    const formatted = nextDate.toLocaleDateString(undefined, {
      day: "numeric",
      month: "long"
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

  availabilityResults.innerHTML = `
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
  `;

;

  setTimeout(() => {
    availabilityResults?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }, 150);

  return;
}
  

  /* ===============================
     ONLY ONE VEHICLE → SKIP
  =============================== */

  if (items.length === 1 && LOCKED_VEHICLE) {

  await selectAvailability(items[0].vehicle.id);
  goToStep(3);
  return;
}

  /* ===============================
     MULTIPLE VEHICLES → STEP 2
  =============================== */

  const html = items.map((item) => {

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

  }).join("");

  availabilityResults.innerHTML = html;

  /* ===============================
     AVAILABILITY NOTE / URGENCY
  =============================== */

  let availabilityNote = `
    <p class="muted">
      ${items.length} lorr${items.length > 1 ? "ies" : "y"} available
    </p>
  `;

  availabilityResults.insertAdjacentHTML(
    "afterbegin",
    availabilityNote
  );

  /* ===============================
     STEP CONTROL + SCROLL
  =============================== */

  goToStep(2);

  setTimeout(() => {
    document.getElementById("step-2")?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }, 120);

}


const bookingTimeInput = document.getElementById("booking-pickup-time");

bookingTimeInput?.addEventListener("change", () => {
  updateEarlyPickupAvailability(); // ✅ REQUIRED
});

const bookingConfirmBtn = document.getElementById("booking-confirm-btn");



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

  const vehicleId =
    selectedAvailability.vehicle?.id ||
    selectedAvailability.vehicleId ||
    vehicles.find(v => v.name === selectedAvailability.vehicle?.name)?.id ||
    "";

  const confirmationFee = vehicleId.startsWith("v75") ? 100 : 75;

  const baseCost = Number(selectedAvailability.baseCost || 0);
  const discountAmount = Number(selectedAvailability.discountAmount || 0);
  const extrasTotal = Number(selectedAvailability.extrasTotal || 0);
  const hireTotal = Number(selectedAvailability.total || 0);
  const outstandingAmount = Math.max(0, hireTotal - confirmationFee);

  const dartfordEnabled = Boolean(dartfordEnabledInput?.checked);
  const dartfordCount = dartfordEnabled
    ? Number(dartfordCountInput?.value || 0)
    : 0;

  const earlyPickupEnabled = Boolean(earlyPickupEnabledInput?.checked);

  const dartfordCharge = dartfordCount * 4.2;
  const earlyPickupCharge = earlyPickupEnabled ? 20 : 0;

  const requiredFormType = hiredWithin3MonthsInput?.checked ? "Short Form" : "Long Form";

  if (bookingSubmitBtn) {
    bookingSubmitBtn.textContent = `Pay £${confirmationFee.toFixed(2)} to confirm booking`;
  }

  const confirmBtn = document.getElementById("booking-confirm-btn");
  if (confirmBtn) {
    confirmBtn.textContent = `Pay £${confirmationFee.toFixed(2)} to confirm booking`;
  }

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
            ${Number(selectedAvailability.durationDays) === 0.5
              ? ` · ${escapeHtml(formatPickupTimeLabel(selectedAvailability.pickupTime))}`
              : ""}
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
        earlyPickupCharge > 0
          ? `
      <div class="summary-row">
        <span>Early pickup</span>
        <span>£${earlyPickupCharge.toFixed(2)}</span>
      </div>
      `
          : ""
      }

      ${
        dartfordCharge > 0
          ? `
      <div class="summary-row">
        <span>Dartford crossings (${dartfordCount})</span>
        <span>£${dartfordCharge.toFixed(2)}</span>
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

  if (BLOCK_AUTO_SCROLL) return;

  const duration = Number(durationDaysInput?.value || 0);
  const group = document.getElementById("pickup-time-group");

  if (!group || !pickupTimeInput) return;

  if (duration === 0.5) {

    group.style.display = "block";
    pickupTimeInput.value = "";

    // Scroll to field
    setTimeout(() => {

      if (BLOCK_AUTO_SCROLL) return; // 👈 ADD THIS

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
   AUTO AVAILABILITY SEARCH
====================================================== */

function autoCheckAvailability() {

  const pickupDate = pickupDateInput?.value;
  const duration = durationDaysInput?.value;

  if (!pickupDate || !duration) return;

  availabilityForm?.requestSubmit();

}

/* trigger when date changes */

pickupDateInput?.addEventListener("change", () => {
  autoCheckAvailability();
});

/* trigger when duration changes */

durationDaysInput?.addEventListener("change", async () => {

  /* ===============================
     🔥 FIX: recalc valid durations
  =============================== */

  const pickupDate = pickupDateInput?.value;

  if (pickupDate) {
    await updateDurationOptions(
      new Date(`${pickupDate}T00:00:00`)
    );
  }

  /* ===============================
     Existing logic
  =============================== */

  updatePickupTimeVisibility();

  const selectedDate = pickupDate
    ? new Date(`${pickupDate}T00:00:00`)
    : null;

  await syncPickupTimeOptions(selectedDate);

  /* ===============================
     Instant price preview
  =============================== */

  const duration = Number(durationDaysInput?.value || 0);

  if (pickupDate && duration) {

    const vehicle = vehicles[0];

    const preview = await buildAvailability(
      vehicle,
      pickupDate,
      duration,
      pickupTimeInput?.value || "07:00"
    );

    const previewBox = document.getElementById("price-preview");

    if (previewBox) {
      previewBox.innerHTML = `
        <div class="quote">
          Estimated hire price: <strong>£${preview.total.toFixed(2)}</strong>
        </div>
      `;
    }

  }

  /* ===============================
     Auto check availability
  =============================== */

  autoCheckAvailability();

});

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

function getVehicleImagePrefix(vehicle){

  const name = vehicle.name.toLowerCase();

  if(name.includes("stallion")) return "3.5 T Stallion (MM68)";
  if(name.includes("safety")) return "3.5T With Safety Bar (LS23)";
  if(name.includes("breast")) return "3.5 T With Breast Bar (CA21)";
  if(name.includes("3 horse")) return "7.5 T 3 Horses with Living";
  if(name.includes("4 horse")) return "7.5 T 4 Horses No Living";

  return null;
}

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

    /* ===============================
       Find images for this vehicle
    =============================== */

    const prefix = getVehicleImagePrefix(vehicle);

    let imageFiles = [];

    if(prefix && window.fleetImages){

      imageFiles = window.fleetImages.filter(img =>
        img.startsWith(prefix)
      );

    }

    if (!imageFiles.length)
      imageFiles = [vehicle.image.replace(/^images\//, "")];

    imageFiles = imageFiles.map((f) =>
      f.startsWith("images/") ? f : "images/" + f
    );

    /* ===============================
       Image wrap
    =============================== */

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

    /* ===============================
       Slideshow logic
    =============================== */

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

    /* ===============================
       Card content
    =============================== */

    const content = document.createElement("div");
    content.className = "fleet-content";
    content.innerHTML = `
      <h3>${escapeHtml(vehicle.name)}</h3>
      <p class="muted">
        ${escapeHtml(vehicle.type)}
        ${vehicle.code ? ` · ${escapeHtml(vehicle.code)}` : ""}
        · ${vehicle.horses} horses · ${vehicle.seats} seats · ${escapeHtml(livingLabel)}
      </p>
      <p class="muted tiny">${escapeHtml(vehicle.summary)}</p>
      <p><strong>From £${Number(vehicle.dayRate).toFixed(0)}</strong> / day</p>

      <button class="btn fleet-card-book" type="button" data-lorry-id="${vehicle.id}">
        Book this Lorry
      </button>
    `;

    card.appendChild(imageWrap);
    card.appendChild(content);

    /* ===============================
       Booking button
    =============================== */

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

async function fetchBookingWithRetry(sessionId, attempts = 12) {
  if (!sessionId) return null;

  if (BOOKING_BY_SESSION_PROMISES.has(sessionId)) {
    return BOOKING_BY_SESSION_PROMISES.get(sessionId);
  }

  const requestPromise = (async () => {
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await fetch(
          apiUrl(`/api/bookings/by-session?session_id=${encodeURIComponent(sessionId)}`)
        );

        if (!res.ok) {
          console.warn(`Booking by session failed (${res.status})`);
        } else {
          const data = await res.json();

          console.log(`🔁 Retry attempt ${i + 1}`, data);

          if (data?.found && data.booking?.pickupAt) {
            return data.booking;
          }
        }
      } catch (err) {
        console.warn(`Retry attempt ${i + 1} failed`, err);
      }

      if (i < attempts - 1) {
        await new Promise(r => setTimeout(r, 1200)); // 🔥 increased delay
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

function getVehicleMainImage(vehicle){

  if(!vehicle) return "";

  const map = {
    "v35-1": "images/3.5T With Safety Bar (LS23)1.webp",
    "v35-2": "images/3.5 T Stallion (MM68)1.webp",
    "v35-3": "images/3.5 T With Breast Bar (CA21)1.webp",
    "v75-1": "images/7.5 T 3 Horses with Living1.webp",
    "v75-2": "images/7.5 T 4 Horses No Living1.webp"
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

  updateEarlyPickupAvailability(); // ✅ ADD THIS
}

  /* update base price */

  if (selectedBaseInput) {
    selectedBaseInput.value = `£${Number(selectedAvailability.baseCost ?? 0).toFixed(2)}`;
  }

  const statusEl = document.getElementById("booking-availability-status");

  if (statusEl) statusEl.hidden = true;

  if (bookingSuccess) bookingSuccess.hidden = true;

  updateCheckoutSummary();

  await syncBookingPickupTimeOptions(
  new Date(pickupDate),
  vehicle.id
);

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

  /* ===============================
     🔥 FIXED PICKUP TIME PRIORITY
  =============================== */

  const bookingTime = document.getElementById("booking-pickup-time")?.value;

  const bookingPickupTime =
    bookingTime ||
    selectedAvailability.pickupTime ||
    DEFAULT_PICKUP_TIME;

  const pickupTime =
    is35T(vehicle) && durationDays === 0.5
      ? bookingPickupTime
      : DEFAULT_PICKUP_TIME;

  /* ===============================
     AVAILABILITY CHECK
  =============================== */

  const available = await isVehicleAvailable(
    vehicle.id,
    pickupDate,
    durationDays,
    pickupTime
  );

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
      code
    );

    if (selectedBaseInput) {
      selectedBaseInput.value = `£${Number(selectedAvailability.baseCost ?? 0).toFixed(2)}`;
    }

    if (statusEl) {
      statusEl.textContent = `${vehicle.name} is available for the selected date and duration.`;
      statusEl.className = "availability-status ok full";
      statusEl.hidden = false;
    }

    if (bookingSubmitBtn) bookingSubmitBtn.disabled = false;

    updateCheckoutSummary();

    /* ===============================
       🔥 CRITICAL FIX
       Sync early pickup AFTER recalculation
    =============================== */

    updateEarlyPickupAvailability();

  } else {

    if (statusEl) {
      statusEl.textContent = `${vehicle.name} is not available for the selected date and duration. Please choose different dates.`;
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

    const extras = booking.extras || {};

    const earlyPickup = !!extras.earlyPickup;
    const dartfordCount = Number(extras.dartford || 0);

    let extrasLine = "";

    if (earlyPickup || dartfordCount > 0) {

      const parts = [];

      if (earlyPickup) {
        parts.push("Early pickup (£20)");
      }

      if (dartfordCount > 0) {
        parts.push(`Dartford x${dartfordCount} (£${(dartfordCount * 4.2).toFixed(2)})`);
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
        ${escapeHtml(formatDateOnly(booking.pickupAt.slice(0, 10)))} · ${escapeHtml(formatTime(booking.pickupAt))} → ${escapeHtml(formatTime(booking.dropoffAt))}<br>

        <span class="muted">
          Duration: ${escapeHtml(formatDurationLabel(booking.durationDays))}
        </span><br>

        ${escapeHtml(booking.customerName)} · ${escapeHtml(booking.customerEmail)}<br>

        <span class="muted">Status: ${escapeHtml(booking.status)}</span><br>

        ${extrasLine}

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
          <td>
  ${escapeHtml(formatDateOnly(booking.pickupAt.slice(0, 10)))}<br>
  <span class="muted">${escapeHtml(formatTime(booking.pickupAt))} → ${escapeHtml(formatTime(booking.dropoffAt))}</span>
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
      ? `${booking.extras.dartford} (£${(booking.extras.dartford * DARTFORD_CROSSING_PRICE).toFixed(2)})`
      : "—"
  }
</td>

<td>
  £${Number(booking.extrasTotal || 0).toFixed(2)}
</td>
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
          <th>Early Pickup</th>
          <th>Dartford</th>
          <th>Extras Total</th>
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
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
  );

  const lines = [
    "Booking ID,Vehicle,Customer Name,Email,Mobile,Address,DOB,Pickup,Drop-off,Duration Days,Early Pickup,Dartford Crossings,Hire Total,Paid Now,Outstanding,Deposit,Required Form,Required Form Link,Status,Reminder At,Created"
  ];

  if (!bookings.length) {
    lines.push("No bookings saved,,,,,,,,,,,,,,,,,,,");
  } else {
    bookings.forEach((booking) => {
      const vehicle = vehicles.find(
        (item) => item.id === booking.vehicleId
      );

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
          formatDateTime(booking.createdAt)
        ]
          .map(csvEscape)
          .join(",")
      );
    });
  }

  const stamp = new Date().toISOString().slice(0, 10);

  downloadFile(
    lines.join("\n"),
    `equine-bookings-${stamp}.csv`,
    "text/csv;charset=utf-8"
  );
}

async function exportAdminPdf() {
  const bookings = (await getBookings()).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const stamp = new Date().toISOString().slice(0, 10);

  const rows = bookings
  .map((booking) => {
    const vehicle = vehicles.find((item) => item.id === booking.vehicleId);

    const earlyPickup = booking.extras?.earlyPickup;
    const dartford = Number(booking.extras?.dartford || 0);

    return `
      <tr>
        <td>${escapeHtml(vehicle?.name || booking.vehicleId)}</td>
        <td>${escapeHtml(booking.customerName)}</td>
        <td>${escapeHtml(booking.customerEmail)}</td>
        <td>${escapeHtml(booking.customerMobile)}</td>
        <td>
  ${escapeHtml(formatDateOnly(booking.pickupAt.slice(0, 10)))}<br>
  ${escapeHtml(formatTime(booking.pickupAt))} → ${escapeHtml(formatTime(booking.dropoffAt))}
</td>
        <td>${escapeHtml(formatDurationLabel(booking.durationDays))}</td>

        <!-- Early Pickup -->
        <td>
          ${earlyPickup ? `£${EARLY_PICKUP_PRICE.toFixed(2)}` : "—"}
        </td>

        <!-- Dartford -->
        <td>
          ${
            dartford > 0
              ? `${dartford} (£${(dartford * DARTFORD_CROSSING_PRICE).toFixed(2)})`
              : "—"
          }
        </td>

        <!-- Extras Total -->
        <td>
          £${Number(booking.extrasTotal || 0).toFixed(2)}
        </td>

        <td>£${Number(booking.confirmationFee).toFixed(2)}</td>
        <td>£${Number(booking.outstandingAmount).toFixed(2)}</td>

        <td>${booking.requiredFormType === "short" ? "Short" : "Long"}</td>

        <td>
          ${
            booking.requiredFormLink
              ? `<a href="${escapeHtml(booking.requiredFormLink)}" target="_blank" rel="noopener">Open</a>`
              : "—"
          }
        </td>

        <td>${escapeHtml(booking.status)}</td>
        <td>${escapeHtml(formatDateTime(booking.reminderAt))}</td>
      </tr>
    `;
  })
  .join("");
    "<tr><td colspan='9'>No bookings saved.</td></tr>";

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

    /* ===============================
       EXTRAS (🔥 FIXED + BULLETPROOF)
    =============================== */

    const dartfordCountInput = document.getElementById("dartford-count");
    const dartfordEnabledInput = document.getElementById("dartford-enabled");
    const earlyPickupEnabledInput = document.getElementById("early-pickup-enabled");

    const dartfordCount = Number(dartfordCountInput?.value || 0);
    const dartfordEnabled = dartfordEnabledInput?.checked === true;

    const earlyPickupChecked = earlyPickupEnabledInput?.checked === true;

    const extras = {
      dartford: dartfordEnabled ? dartfordCount : 0,
      earlyPickup: earlyPickupChecked ? 1 : 0
    };

    console.log("🚀 SENDING EXTRAS (FINAL):", extras);

    /* ===============================
       REQUEST
    =============================== */

    const response = await fetch(
      apiUrl("/api/bookings/create-checkout-session"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({

          /* core booking */
          vehicleId: booking.vehicleId,
          vehicleName: booking.vehicleSnapshot?.name,

          pickupDate: booking.pickupAt,
          pickupTime: booking.pickupTime,

          durationDays: booking.durationDays,

          /* customer */
          customerEmail: booking.customerEmail,
          bookingId: booking.id,

          /* pricing (display only, backend recalculates anyway) */
          confirmationFee: booking.confirmationFee,

          /* 🔥 NEW — extras */
          extras

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

document.addEventListener("DOMContentLoaded", async () => {

    await handleStripeReturn();

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

  updateEarlyPickupAvailability();

  /* Step 3 logic (use existing global selectedDurationInput) */

  if (selectedDurationInput) {

    selectedDurationInput.addEventListener("change", async () => {

  updateHalfDayPickup();

  const vehicle = selectedAvailability?.vehicle;
  const date = selectedPickupInput?.value;

  if (vehicle && date) {
    await syncBookingPickupTimeOptions(new Date(date), vehicle.id);
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
  dartfordEnabledInput,
  dartfordCountInput,
  earlyPickupEnabledInput,
  document.getElementById("discount-code")
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
        availabilityResults.innerHTML =
          '<p class="empty-note">Enter a valid pickup date and duration.</p>';
        return;
      }

      /* ===============================
         HALF DAY VALIDATION
      =============================== */

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

      const finalPickupTime =
        durationDays === 0.5
          ? pickupTime
          : DEFAULT_PICKUP_TIME;

      const submitBtn = availabilityForm.querySelector(
        'button[type="submit"], input[type="submit"]'
      );

      if (submitBtn) submitBtn.disabled = true;

      renderAvailabilityLoading();

      try {

        /* ===============================
           VEHICLES TO CHECK
        =============================== */

        const vehiclesToCheck =
          LOCKED_VEHICLE && PRESELECTED_VEHICLE
            ? vehicles.filter(v => v.id === PRESELECTED_VEHICLE)
            : vehicles;

        /* ===============================
           🚀 PARALLEL AVAILABILITY
        =============================== */

        const results = await Promise.all(
          vehiclesToCheck.map(async (vehicle) => {

            const available = await isVehicleAvailable(
              vehicle.id,
              pickupDate,
              durationDays,
              finalPickupTime
            );

            if (!available) return null;

            return buildAvailability(
              vehicle,
              pickupDate,
              durationDays,
              finalPickupTime
            );
          })
        );

        /* ===============================
           CANCEL OUTDATED RESPONSE
        =============================== */

        if (requestId !== availabilityRequestId) {
          console.log("⚠️ Discarding outdated availability response");
          return;
        }

        const availableLorries = results.filter(Boolean);

        renderAvailabilityResults(availableLorries);

      } catch (err) {

        if (requestId !== availabilityRequestId) return;

        console.warn("Availability search failed:", err);

        renderAvailabilityError(
          "Couldn’t check availability right now. Please try again."
        );

      } finally {

        if (requestId === availabilityRequestId && submitBtn) {
          submitBtn.disabled = false;
        }

      }

    }, 120); // 👈 debounce delay (perfect UX balance)

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

hiredWithin3MonthsInput?.addEventListener("change", updateCheckoutSummary);

/* ===============================
   BOOKING SELECTION EVENTS
=============================== */

selectedPickupInput?.addEventListener("change", async () => {
  await checkBookingFormAvailability();
  updateEarlyPickupAvailability(); // ✅ ADD
});

selectedDurationInput?.addEventListener("change", async () => {
  await checkBookingFormAvailability();
  updateEarlyPickupAvailability(); // ✅ KEEP
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

    /* ===============================
       SAFE VEHICLE ID (🔥 KEY FIX)
    =============================== */

    const vehicleId =
      selectedAvailability.vehicle?.id ||
      selectedAvailability.vehicleId;

    /* ===============================
       PICKUP TIME
    =============================== */

    const bookingPickupTime =
      document.getElementById("booking-pickup-time")?.value || "07:00";

    const stillAvailable = await isVehicleAvailable(
      vehicleId,
      selectedAvailability.pickupDate,
      selectedAvailability.durationDays,
      bookingPickupTime
    );

    if (!stillAvailable) {
      alert("That lorry is no longer available for the selected dates. Please search again.");
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
       CONFIRMATION FEE (🔥 FIXED)
    =============================== */

    let confirmationFee = 75;

if (vehicleId && vehicleId.startsWith("v75")) {
  confirmationFee = 100;

  console.log("💰 SUMMARY confirmationFee:", confirmationFee);
}
    const outstandingAmount = Math.max(0, hireTotal - confirmationFee);

    /* ===============================
       BOOKING ID
    =============================== */

    const existingIds = new Set((await getBookings()).map(b => String(b.id)));
    const bookingId = generateNumericBookingId(existingIds);

    /* ===============================
       FORMS
    =============================== */

    const hiredWithinLast3Months = hiredWithin3MonthsInput?.checked || false;
    const requiredFormType = hiredWithinLast3Months ? "short" : "long";

    const shortFormLink = buildFormUrl(FORM_LINK_A, bookingId);
    const longFormLink = buildFormUrl(FORM_LINK_B, bookingId);
    const requiredFormLink =
      requiredFormType === "short" ? shortFormLink : longFormLink;

    /* ===============================
       PICKUP / DROPOFF TIMES
    =============================== */

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

    /* ===============================
   BOOKING OBJECT
=============================== */

const booking = {
  id: bookingId,

  vehicleId: vehicleId,

  vehicleSnapshot: {
    id: vehicleId,
    name: selectedAvailability.vehicle?.name || "",
    type: selectedAvailability.vehicle?.type || ""
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

  /* 🔥 CLEAN EXTRAS (single source of truth) */
  extras: {
    dartford: dartfordCrossings,
    earlyPickup: earlyPickup ? 1 : 0
  },

  /* 🔥 SERVER-DRIVEN TOTALS */
  baseCost,
  discountAmount,
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

  createdAt: new Date().toISOString()
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

    const checkoutUrl = await createStripeCheckoutSession(booking);

    if (!checkoutUrl) {
      alert("Stripe checkout link is not configured yet.");
      return;
    }

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

  /* ======================================================
     AVAILABLE VEHICLES (½ day aware)
  ====================================================== */

  const availability = vehicles.map(vehicle => {

    const vehicleBookings = booked.filter(
      b => b.vehicleId === vehicle.id
    );

    let morningBooked = false;
    let afternoonBooked = false;

    vehicleBookings.forEach(b => {

      const startHour = getLondonParts(new Date(b.pickupAt)).hour;
      const endHour = getLondonParts(new Date(b.dropoffAt)).hour;

      if (startHour <= 7 && endHour >= 13) morningBooked = true;
      if (startHour <= 13 && endHour >= 19) afternoonBooked = true;

    });

    return {
      vehicle,
      morningAvailable: !morningBooked,
      afternoonAvailable: !afternoonBooked
    };

  });

  const availableVehicles = availability.filter(
    a => a.morningAvailable || a.afternoonAvailable
  );

  if (!availableVehicles.length) {

    html += `<div class="muted tiny">Fully booked</div>`;

  } else {

    html += `<div class="muted tiny">Available vehicles (${availableVehicles.length})</div>`;

    availableVehicles.forEach(a => {

      const vehicle = a.vehicle;
      const img = getVehicleMainImage(vehicle);

      let slotText = "";

      if (a.morningAvailable && a.afternoonAvailable) {
        slotText = "Full day available";
      } else if (a.morningAvailable) {
        slotText = "Morning available";
      } else if (a.afternoonAvailable) {
        slotText = "Afternoon available";
      }

      html += `
        <div class="preview-item preview-select"
     data-vehicle-id="${vehicle.id}"
     data-slot="${slotText}">

          ${img ? `<img src="${img}" class="preview-img">` : ""}

          <div class="preview-text">
            <strong>${vehicle.name}</strong><br>
            <span class="muted tiny">${slotText}</span>
          </div>

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

    /* make preview vehicles selectable */

panel.querySelectorAll(".preview-select").forEach(el => {

  el.addEventListener("click", async () => {

    const vehicleId = el.dataset.vehicleId;
    const slot = (el.dataset.slot || "").toLowerCase();

    const vehicle = vehicles.find(v => v.id === vehicleId);
    if (!vehicle) return;

    /* lock selected vehicle */
    PRESELECTED_VEHICLE = vehicleId;
    LOCKED_VEHICLE = true;

    updateCalendarVehicleLabel();

    /* set selected date */
    if (pickupDateInput) {
      const year = dateStart.getFullYear();
      const month = String(dateStart.getMonth() + 1).padStart(2, "0");
      const day = String(dateStart.getDate()).padStart(2, "0");
      pickupDateInput.value = `${year}-${month}-${day}`;
    }

    /* keep vehicle visible in UI */
    if (selectedLorryInput) selectedLorryInput.value = vehicle.name;
    if (selectedBaseInput) selectedBaseInput.value = "";

    /* clear previously selected availability */
    selectedAvailability = null;

    /* enforce vehicle duration rules */
    updateDurationOptionsForVehicle(vehicle);
    enforceVehicleDurationRules(vehicle);

    /* IMPORTANT:
       go back to duration step instead of jumping to details
    */
    if (durationDaysInput) {
      if (slot.includes("morning") || slot.includes("afternoon")) {
        durationDaysInput.value = "0.5";
        pickupTimeInput.value = slot.includes("afternoon") ? "13:00" : "07:00";
      } else {
        durationDaysInput.value = "";
        pickupTimeInput.value = "07:00";
      }
    }

    await syncPickupTimeOptions(dateStart);
    updatePickupTimeVisibility();
    updateCheckoutSummary();

    panel.classList.add("hidden");

    goToStep(1);

    setTimeout(() => {
      durationDaysInput?.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
      durationDaysInput?.classList.add("duration-highlight");
      setTimeout(() => {
        durationDaysInput?.classList.remove("duration-highlight");
      }, 1800);
    }, 150);

  });

});

    return;

  }

  /* DESKTOP VERSION */

  const vehiclePreview = document.getElementById("vehicle-preview");
  if (!vehiclePreview) return;

  vehiclePreview.innerHTML = html;
  vehiclePreview.classList.remove("hidden");

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

const startHour = getLondonParts(start).hour;
const endHour = getLondonParts(end).hour;

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

  // prevent duplicate renders (you already planned this)
  if (calendarRenderPromise) {
    return calendarRenderPromise;
  }

  calendarRenderPromise = (async () => {
    try {
      await renderCalendarInternal();
    } catch (err) {
      console.error("Calendar render failed:", err);
    } finally {
      calendarRenderPromise = null;
    }
  })();

  return calendarRenderPromise;
}

 async function renderCalendarInternal() {

/* ===============================
   LOAD BOOKINGS (DEDUPED + CACHED)
=============================== */

// ✅ this now benefits from in-flight dedupe in getBookings()
const bookings = BOOKINGS_CACHE || await getBookings(false);

console.log("Calendar bookings:", bookings);

/* ===============================
   CALENDAR HEADER
=============================== */

const year = currentDate.getFullYear();
const month = currentDate.getMonth();

const monthNames = [
"January","February","March","April","May","June",
"July","August","September","October","November","December"
];

calTitle.textContent = `${monthNames[month]} ${year}`;

calGrid.innerHTML = "";

/* ===============================
   SELECTED DATE RESTORE
=============================== */

const selectedDateValue = pickupDateInput?.value;
let selectedTimestamp = null;

if (selectedDateValue) {
  const selectedDate = new Date(selectedDateValue);
  selectedDate.setHours(0,0,0,0);
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
today.setHours(0,0,0,0);

/* ===============================
   DAY LOOP
=============================== */

for (let day = 1; day <= lastDay.getDate(); day++) {

  const dayDate = new Date(year, month, day);
  dayDate.setHours(0,0,0,0);

  const dayEl = document.createElement("div");
  dayEl.className = "cal-day";
  dayEl.textContent = day;

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

  /* ===============================
     LAST VEHICLE LABEL
  =============================== */

  const remainingSlots = getRemainingSlots(dayDate, bookings);

  if (remainingSlots === 1){

    dayEl.classList.add("cal-last");

    const label = document.createElement("div");
    label.className = "cal-last-label";

    if (window.innerWidth < 768) {
      label.innerHTML = "1<br>Left!";
    } else {
      label.textContent = "1 Slot Left!";
    }

    dayEl.appendChild(label);
  }

  /* ===============================
     STATUS COLOURING
  =============================== */

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

  dayEl.addEventListener("touchend", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    await selectDate(dayDate);

    clearPreview();
    previewRental(dayDate);

    await showVehiclePreview(dayDate, e);
  });

  /* ===============================
     CLICK SELECTION
  =============================== */

  if (validStart || PRESELECTED_VEHICLE) {

    dayEl.addEventListener("click", async (e) => {

      if (isMobile()) {
        clearPreview();
        previewRental(dayDate);
        await showVehiclePreview(dayDate, e);
        return;
      }

      clearPreview();
      await selectDate(dayDate);

    });

  }

  calGrid.appendChild(dayEl);
}

/* ===============================
   UNLOCK (legacy flag kept)
=============================== */

calGrid.dataset.rendering = "false";

}

/* ======================================================
   Select date
====================================================== */

async function selectDate(dayDate) {

  const warningBox = document.getElementById("preselected-warning");
if (warningBox) {
  warningBox.innerHTML = "";
  warningBox.style.display = "none";
}

  BLOCK_AUTO_SCROLL = false;

  const pickupInput = document.getElementById("pickup-date");
  const durationInput = document.getElementById("duration-days");

  if (!pickupInput || !durationInput) return;

  const year = dayDate.getFullYear();
  const month = String(dayDate.getMonth() + 1).padStart(2, "0");
  const day = String(dayDate.getDate()).padStart(2, "0");

  pickupInput.value = `${year}-${month}-${day}`;

/*******************************
  PRESELECTED LORRY CHECK (EARLY)
********************************/

/*******************************
  PRESELECTED LORRY CHECK (EARLY)
********************************/

if (PRESELECTED_VEHICLE) {

  const bookings = BOOKINGS_CACHE || await getBookings(false);

  const vehicleBookings = bookings.filter(
    b => b.vehicleId === PRESELECTED_VEHICLE && b.status !== "cancelled"
  );

  const dayStart = new Date(dayDate);
  dayStart.setHours(0,0,0,0);

  const dayEnd = new Date(dayDate);
  dayEnd.setHours(23,59,59,999);

  const isBlocked = vehicleBookings.some(b => {
    const start = new Date(b.pickupAt);
    const end = new Date(b.dropoffAt);
    return start <= dayEnd && end >= dayStart;
  });

  if (isBlocked && warningBox) {

    BLOCK_AUTO_SCROLL = true;

    const vehicle = vehicles.find(v => v.id === PRESELECTED_VEHICLE);

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

    // 👇 stay on calendar
    goToStep(1);

    setTimeout(() => {
      warningBox.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
    }, 60);

    // ✅ Pick another date → KEEP LOCK
    warningBox.querySelector(".change-date-btn")?.addEventListener("click", () => {

      BLOCK_AUTO_SCROLL = false;
      LOCKED_VEHICLE = true;

      document.getElementById("availability-calendar")?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });

    });

    // ✅ Pick another lorry → RESET HERE ONLY
    warningBox.querySelector(".change-lorry-btn")?.addEventListener("click", () => {

      BLOCK_AUTO_SCROLL = false;

      LOCKED_VEHICLE = false;
      PRESELECTED_VEHICLE = null;

      availabilityForm?.requestSubmit();
      goToStep(2);

    });

    return; // 🚨 HARD STOP
  }
}

await updateDurationOptions(dayDate);
await syncPickupTimeOptions(dayDate);

if (LOCKED_VEHICLE && PRESELECTED_VEHICLE) {
  const vehicle = vehicles.find(v => v.id === PRESELECTED_VEHICLE);

  updateDurationOptionsForVehicle(vehicle);
  enforceVehicleDurationRules(vehicle);
}

  /* reset duration */

  durationInput.value = "";

  /* clear vehicle availability results */

  if (availabilityResults) {
    availabilityResults.innerHTML = "";
  }

  /* reset selected vehicle */

  selectedAvailability = null;

/* 🔒 KEEP LOCKED VEHICLE IN UI */
if (!LOCKED_VEHICLE) {
  if (selectedLorryInput) selectedLorryInput.value = "";
}
  if (selectedBaseInput) selectedBaseInput.value = "";

  /* disable booking button again */

  if (bookingSubmitBtn) bookingSubmitBtn.disabled = true;

  /* refresh checkout summary */

  updateCheckoutSummary();

  /* =====================================
     Highlight selected calendar day
  ===================================== */

  document.querySelectorAll(".cal-selected")
    .forEach(el => el.classList.remove("cal-selected"));

  const calGrid = document.getElementById("cal-grid");

  Array.from(calGrid.children).forEach(cell => {
    if (Number(cell.textContent) === dayDate.getDate()) {
      cell.classList.add("cal-selected");
    }
  });

  /* =====================================
     Scroll to duration selector
  ===================================== */

 setTimeout(() => {

  if (BLOCK_AUTO_SCROLL) return; // 👈 ADD THIS LINE

  if (!isMobile()) {

    const y =
      durationInput.getBoundingClientRect().top +
      window.pageYOffset -
      120;

    window.scrollTo({
      top: y,
      behavior: "smooth"
    });

  }

  /* highlight duration */

  durationInput.classList.add("duration-highlight");

  durationInput.addEventListener("change", () => {
    durationInput.classList.remove("duration-highlight");
  }, { once: true });

}, 200);

}



async function updateDurationOptions(startDate) {

  const durationInput = document.getElementById("duration-days");
  if (!durationInput || !startDate) return;

  const dateString = startDate.toISOString().slice(0, 10);

  const currentPickupTime =
    pickupTimeInput?.value ||
    DEFAULT_PICKUP_TIME;

  const remainingSlots = getRemainingSlots(
    startDate,
    BOOKINGS_CACHE || await getBookings(false)
  );

  const options = Array.from(durationInput.options);

  for (const opt of options) {
    const days = Number(opt.value);
    if (!days) continue;

    let testPickupTime = DEFAULT_PICKUP_TIME;

    if (days === 0.5) {
      testPickupTime = currentPickupTime || DEFAULT_PICKUP_TIME;
    }

    const available = await getAvailableLorries(
      dateString,
      days,
      testPickupTime
    );

    let disabled = available.length === 0;

    /* extra rule:
       if calendar says only 1 slot left,
       only allow 1/2 day and 1 day
    */
    if (remainingSlots === 1 && days > 1) {
      disabled = true;
    }

    opt.disabled = disabled;
  }

  /* keep current selection valid */
  const selectedOption = durationInput.options[durationInput.selectedIndex];
  if (selectedOption?.disabled) {
    durationInput.value = "";
  }
}

/* 🔥 expose globally */
window.updateDurationOptions = updateDurationOptions;

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

      const startHour = getLondonParts(start).hour;
      const endHour = getLondonParts(end).hour;

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

