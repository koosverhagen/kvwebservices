const fleetGrid = document.getElementById("fleet-grid");
const availabilityForm = document.getElementById("availability-form");
const STORAGE_BOOKINGS = "equinetransportuk_bookings";
const DARTFORD_CROSSING_PRICE = 4.2;
const EARLY_PICKUP_PRICE = 20;
const CONFIRMATION_FEE_35T = 70;
const CONFIRMATION_FEE_75T = 100;
const SECURITY_DEPOSIT_AMOUNT = 200;
const DEFAULT_PICKUP_TIME = "07:00";
const HALF_DAY_PICKUP_TIMES_35T = ["07:00", "13:00"];
const HALF_DAY_DROPOFF_TIMES_35T = {"07:00": "13:00", "13:00": "19:00"};
const FULL_DAY_DROPOFF_TIME = "19:00";

const RATE_35T_TOTALS = {
  "0.5": 70,
  "1": 100,
  "2": 190,
  "3": 285,
  "4": 380,
  "5": 475,
  "6": 570,
  "7": 665
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
  "2": 36,
  "3": 50,
  "4": 96,
  "5": 120,
  "6": 144,
  "7": 168
};

const DURATION_HOURS_75T = {
  "1": 12,
  "2": 36,
  "3": 50,
  "4": 96,
  "5": 120,
  "6": 144,
  "7": 168
};

const STRIPE_PAYMENT_LINK_35T = "";
const STRIPE_PAYMENT_LINK_75T = "";
const OUTSTANDING_PAYMENT_LINK = "";
const DEPOSIT_PAYMENT_LINK = "";
const FORM_LINK_A = "https://www.equinetransportuk.com/shortformsubmit";
const FORM_LINK_B = "https://www.equinetransportuk.com/longformsubmit";
const BACKEND_API_BASE = "";

const vehicles = [
  {
    id: "v35-1",
    name: "3.5T Safety Bar Lorry",
    code: "LS23",
    type: "3.5 tonne",
    horses: 2,
    seats: 3,
    overnight: false,
    dayRate: 100,
    pricingModel: "35_duration_rules",
    summary: "Rear-facing 2-horse lorry with externally releasable safety breast bar, tack/changing room, horse/reverse cameras and ventilation.",
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
    dayRate: 100,
    pricingModel: "35_duration_rules",
    summary: "Back-facing 2-horse stallion layout with high partitions, no breast bar, horse/reverse cameras, roof vent and windows.",
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
    dayRate: 100,
    pricingModel: "35_duration_rules",
    summary: "Back-facing 2-horse lorry with adjustable breast bar, tack/changing room, horse/reverse cameras and roof ventilation.",
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
    summary: "High-end 3-horse 7.5T with living space, focused on comfort, reliability and practical long-day transport.",
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
    summary: "Practical 4-horse 7.5T with large tack area, built for functional multi-horse transport without living section.",
    image: "images/lorry-75-noliving.webp"
  }
];
window.vehicles = vehicles;

const pickupDateInput = document.getElementById("pickup-date");
const pickupTimeInput = document.getElementById("pickup-time");
const availabilityResults = document.getElementById("availability-results");

const bookingForm = document.getElementById("booking-form");
const selectedLorryInput = document.getElementById("selected-lorry");
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

let selectedAvailability = null;


function apiUrl(path) {
  if (!BACKEND_API_BASE) return path;
  return `${BACKEND_API_BASE.replace(/\/$/, "")}${path}`;

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

  try {
    const url = new URL(baseUrl);
    url.searchParams.set("bookingID", bookingId);
    return url.toString();
  } catch {
    const separator = baseUrl.includes("?") ? "&" : "?";
    return `${baseUrl}${separator}bookingID=${encodeURIComponent(bookingId)}`;
  }
}

function getBookings() {
  return JSON.parse(localStorage.getItem(STORAGE_BOOKINGS) || "[]");
}

function saveBookings(items) {
  localStorage.setItem(STORAGE_BOOKINGS, JSON.stringify(items));
}

function asDate(date, time = DEFAULT_PICKUP_TIME) {
  return new Date(`${date}T${time}:00`);
}

function addDays(date, days) {
  const output = new Date(date);
  output.setDate(output.getDate() + days);
  return output;
}

function addHours(date, hours) {
  const output = new Date(date);
  output.setHours(output.getHours() + hours);
  return output;
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
  return vehicle.type.toLowerCase().includes("3.5");
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
    return 100 * Math.max(1, duration);
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

function renderFleet() {
  fleetGrid.innerHTML = "";
  vehicles.forEach((vehicle) => {
    const card = document.createElement("article");
    card.className = "fleet-card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `View details for ${vehicle.name}`);
    // Fix label for 'no living' for 7.5T 4 Horses No Living
    const livingLabel = (vehicle.pricingModel === "75_no_living_rules") ? "no living" : (vehicle.overnight ? "living" : "no living");
    // Find all images for this lorry
    const code = vehicle.code || vehicle.name.match(/\(([^)]+)\)/)?.[1] || "";
    const baseName = vehicle.name.replace(/[^\w]+/g, " ").trim();
    const imageFiles = window.fleetImages?.filter(img => {
      return (code && img.startsWith(code)) || img.toLowerCase().includes(baseName.toLowerCase().replace(/ /g, ""));
    }) || [vehicle.image.replace("images/", "")];
    // Slideshow markup
    const slideshowId = `slideshow-${vehicle.id}`;
    const slideshow = `
      <div class="fleet-slideshow" id="${slideshowId}">
        <button class="fleet-slide-prev" aria-label="Previous image">&#8592;</button>
        <div class="fleet-slide-img-wrap">
          <img src="images/${imageFiles[0]}" alt="${vehicle.name}" class="fleet-slide-img">
        </div>
        <button class="fleet-slide-next" aria-label="Next image">&#8594;</button>
      </div>
    `;
    card.innerHTML = `
      ${slideshow}
      <div class="fleet-content">
        <h3>${vehicle.name}</h3>
        <p class="muted">${vehicle.type}${vehicle.code ? ` · ${vehicle.code}` : ""} · ${vehicle.horses || "—"} horse${vehicle.horses === 1 ? "" : "s"} · ${vehicle.seats} seats · ${livingLabel}</p>
        <p class="muted tiny">${vehicle.summary || ""}</p>
        <p><strong>From £${vehicle.dayRate}</strong> / day</p>
        ${vehicle.pricingModel === "35_duration_rules" ? '<p class="muted tiny">1/2 day £70 · 1 day £100 · 2 days £190 · 3 days £285 · 4 days £380 · 5 days £475 · 6 days £570 · week £665</p>' : ''}
        ${vehicle.pricingModel === "75_living_rules" ? '<p class="muted tiny">1 day £175 · 2 days £350 · 3 days £525 · 4 days £700 · 5 days £875 · 6 days £1050 · week £1225</p>' : ''}
        ${vehicle.pricingModel === "75_no_living_rules" ? '<p class="muted tiny">Default £165/day · weekend uplift: 1 day £175, 2 days £350</p>' : ''}
        <button class="btn fleet-card-book" data-lorry-id="${vehicle.id}">Book this Lorry</button>
      </div>
    `;
    // Slideshow logic
    setTimeout(() => {
      const slideImgs = imageFiles;
      let idx = 0;
      const wrap = document.getElementById(slideshowId);
      if (!wrap) return;
      const imgEl = wrap.querySelector('.fleet-slide-img');
      const prevBtn = wrap.querySelector('.fleet-slide-prev');
      const nextBtn = wrap.querySelector('.fleet-slide-next');
      function updateImg() {
        imgEl.src = `images/${slideImgs[idx]}`;
      }
      prevBtn.onclick = (e) => { e.stopPropagation(); idx = (idx - 1 + slideImgs.length) % slideImgs.length; updateImg(); };
      nextBtn.onclick = (e) => { e.stopPropagation(); idx = (idx + 1) % slideImgs.length; updateImg(); };
    }, 0);
    // No modal logic: only slideshow and booking button are interactive
    // Book button logic
    card.querySelector('.fleet-card-book').addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById("selected-lorry").value = vehicle.name;
      window.location.hash = "#booking";
    });
    fleetGrid.appendChild(card);
  });
}

// --- Fleet Modal Logic ---


// Expose images for modal gallery
window.fleetImages = [
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

function buildAvailability(vehicle, pickupDate, durationDays, pickupTime) {
  let actualPickupTime = pickupTime;
  let dropoffTime = FULL_DAY_DROPOFF_TIME;
  let durationHours = getDurationHours(vehicle, durationDays);
  // 1/2 day logic for 3.5T only
  if (is35T(vehicle) && Number(durationDays) === 0.5) {
    // If pickupTime not specified or invalid, default to 07:00
    if (!HALF_DAY_PICKUP_TIMES_35T.includes(pickupTime)) {
      actualPickupTime = HALF_DAY_PICKUP_TIMES_35T[0];
    }
    dropoffTime = HALF_DAY_DROPOFF_TIMES_35T[actualPickupTime];
    durationHours = 6; // 6 hours for half day
  } else {
    // For 1 day or more, always 07:00 pickup, 19:00 drop-off
    actualPickupTime = DEFAULT_PICKUP_TIME;
    dropoffTime = FULL_DAY_DROPOFF_TIME;
    // durationHours already set by getDurationHours
  }
  const pickupAt = asDate(pickupDate, actualPickupTime);
  // Drop-off is always same day for 1/2 day, else pickup + duration or set to 19:00
  let dropoffAt;
  if (is35T(vehicle) && Number(durationDays) === 0.5) {
    dropoffAt = asDate(pickupDate, dropoffTime);
  } else {
    // For 1 day or more, drop-off is pickupDate at 19:00 plus (durationDays-1) days
    const dropoffDate = addDays(pickupAt, Math.max(0, Number(durationDays) - 1));
    dropoffAt = asDate(dropoffDate.toISOString().slice(0,10), dropoffTime);
  }
  return {
    vehicle,
    pickupDate,
    pickupTime: actualPickupTime,
    durationDays,
    durationHours,
    pickupAt,
    dropoffAt,
    baseCost: calculateBaseCost(vehicle, durationDays, pickupDate, actualPickupTime)
  };
}

function isVehicleAvailable(vehicleId, pickupDate, durationDays, pickupTime = DEFAULT_PICKUP_TIME) {
  const vehicle = vehicles.find((item) => item.id === vehicleId);
  if (!vehicle) return false;
  if (!supportsDuration(vehicle, durationDays)) return false;

  const candidate = buildAvailability(vehicle, pickupDate, durationDays, pickupTime);
  const vehicleBookings = getBookings().filter((booking) => booking.vehicleId === vehicleId && booking.status !== "cancelled");

  return !vehicleBookings.some((booking) => {
    const existingStart = new Date(booking.pickupAt);
    const existingEnd = new Date(booking.dropoffAt);
    return overlaps(candidate.pickupAt, candidate.dropoffAt, existingStart, existingEnd);
  });
}

function getAvailableLorries(pickupDate, durationDays, pickupTime = DEFAULT_PICKUP_TIME) {
  return vehicles
    .filter((vehicle) => supportsDuration(vehicle, durationDays))
    .filter((vehicle) => isVehicleAvailable(vehicle.id, pickupDate, durationDays, pickupTime))
    .map((vehicle) => buildAvailability(vehicle, pickupDate, durationDays, pickupTime));
}

function renderAvailabilityResults(items) {
  if (!pickupDateInput.value || !durationDaysInput.value) {
    availabilityResults.innerHTML = "";
    return;
  }

  if (!items.length) {
    availabilityResults.innerHTML = '<p class="empty-note">No lorries available for this date and duration.</p>';
    return;
  }

  const html = items
    .map((item) => {
      const confirmationFee = getConfirmationFee(item.vehicle);
      return `
        <article class="availability-item">
          <div>
            <h4>${item.vehicle.name}</h4>
            <p class="muted">${item.vehicle.code ? `${item.vehicle.code} · ` : ""}${formatDateOnly(item.pickupDate)} ${item.pickupTime} · ${formatDurationLabel(item.durationDays)}</p>
            <p><strong>Hire from £${item.baseCost.toFixed(2)}</strong></p>
            <p class="muted tiny">Pay now to confirm: £${confirmationFee.toFixed(2)}</p>
          </div>
          <button class="btn choose-lorry" type="button" data-vehicle-id="${item.vehicle.id}">Select</button>
        </article>
      `;
    })
    .join("");

      card.addEventListener("click", (e) => {
        if (e.target.closest('.fleet-card-book') || e.target.closest('.fleet-slide-prev') || e.target.closest('.fleet-slide-next')) return;
        openFleetModal(vehicle.id);
      });
      card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { openFleetModal(vehicle.id); }});
    checkoutSummary.textContent = "Select an available lorry to continue.";
    bookingSubmitBtn.disabled = true;
    return;
  }

  bookingSubmitBtn.disabled = false;

  const dartfordEnabled = dartfordEnabledInput.checked;
  const crossingsCount = dartfordEnabled ? Math.max(1, Number(dartfordCountInput.value || 1)) : 0;
  const earlyPickupEnabled = earlyPickupEnabledInput.checked;
  const crossingCharge = calculateCrossingCharge(crossingsCount);
  const earlyPickupCharge = calculateEarlyPickupCharge(earlyPickupEnabled);
  const hireTotal = calculateHireTotal(selectedAvailability.baseCost, crossingsCount, earlyPickupEnabled);
  const confirmationFee = getConfirmationFee(selectedAvailability.vehicle);
  const outstandingAmount = Math.max(0, hireTotal - confirmationFee);
  const requiredFormType = hiredWithin3MonthsInput.checked ? "Short Form" : "Long Form";

  checkoutSummary.innerHTML = `
    ${selectedAvailability.vehicle.name}<br>
    Base hire: £${selectedAvailability.baseCost.toFixed(2)}<br>
    Dartford crossings: £${crossingCharge.toFixed(2)}${dartfordEnabled ? ` (${crossingsCount} crossing${crossingsCount === 1 ? "" : "s"})` : ""}<br>
    Early pickup: £${earlyPickupCharge.toFixed(2)}${earlyPickupEnabled ? " (evening before)" : ""}<br>
    <strong>Hire total: £${hireTotal.toFixed(2)}</strong><br>
    Pay now to confirm: £${confirmationFee.toFixed(2)} · Outstanding later: £${outstandingAmount.toFixed(2)}<br>
    Required hire form: ${requiredFormType}<br>
    Security deposit link (day before): £${SECURITY_DEPOSIT_AMOUNT.toFixed(2)}
  `;
}

function selectAvailability(vehicleId) {
  const pickupDate = pickupDateInput.value;
  let pickupTime = pickupTimeInput.value;
  const durationDays = Number(durationDaysInput.value);
  const vehicle = vehicles.find((item) => item.id === vehicleId);
  if (!vehicle || !pickupDate || durationDays <= 0 || !supportsDuration(vehicle, durationDays)) return;

  // For 1/2 day 3.5T, restrict pickupTime to allowed slots
  if (is35T(vehicle) && durationDays === 0.5) {
    if (!HALF_DAY_PICKUP_TIMES_35T.includes(pickupTime)) {
      pickupTime = HALF_DAY_PICKUP_TIMES_35T[0];
    }
  } else {
    pickupTime = DEFAULT_PICKUP_TIME;
  }

  selectedAvailability = buildAvailability(vehicle, pickupDate, durationDays, pickupTime);

  selectedLorryInput.value = vehicle.name;
  selectedPickupInput.value = `${formatDateOnly(pickupDate)} ${selectedAvailability.pickupTime}`;
  selectedDurationInput.value = formatDurationLabel(durationDays);
  selectedBaseInput.value = `£${selectedAvailability.baseCost.toFixed(2)}`;

  bookingSuccess.hidden = true;
  updateCheckoutSummary();
}

function renderBookings() {
  const bookings = getBookings().sort((a, b) => new Date(a.pickupAt) - new Date(b.pickupAt));

  if (!bookings.length) {
    bookingList.innerHTML = '<div class="booking-item muted">No bookings yet. Your first booking will appear here.</div>';
    return;
  }

  bookingList.innerHTML = bookings
    .map((booking) => {
      const vehicle = vehicles.find((item) => item.id === booking.vehicleId);
      return `
        <article class="booking-item">
          <strong>${vehicle?.name || booking.vehicleId}</strong><br>
          ${formatDateTime(booking.pickupAt)} → ${formatDateTime(booking.dropoffAt)}<br>
          <span class="muted">Duration: ${formatDurationLabel(booking.durationDays)}</span><br>
          ${booking.customerName} · ${booking.customerEmail}<br>
          <span class="muted">Status: ${booking.status}</span><br>
          <span class="muted">Paid now: £${booking.confirmationFee.toFixed(2)} · Outstanding: £${booking.outstandingAmount.toFixed(2)}</span><br>
          <span class="muted">Total hire: £${booking.hireTotal.toFixed(2)}</span>
        </article>
      `;
    })
    .join("");
}

function renderAdminBookings() {
  const bookings = getBookings().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (!bookings.length) {
    adminBookings.innerHTML = '<p class="empty-note">No bookings saved yet.</p>';
    return;
  }

  const rows = bookings
    .map((booking) => {
      const vehicle = vehicles.find((item) => item.id === booking.vehicleId);
      return `
        <tr>
          <td>${vehicle?.name || booking.vehicleId}</td>
          <td>${booking.customerName}</td>
          <td>${booking.customerEmail}</td>
          <td>${booking.customerMobile}</td>
          <td>${formatDateTime(booking.pickupAt)}</td>
          <td>${formatDurationLabel(booking.durationDays)}</td>
          <td>${booking.earlyPickup ? "Yes" : "No"}</td>
          <td>${booking.dartfordCrossings}</td>
          <td>£${booking.confirmationFee.toFixed(2)}</td>
          <td>£${booking.outstandingAmount.toFixed(2)}</td>
          <td>${booking.requiredFormType === "short" ? "Short" : "Long"}</td>
          <td>${booking.requiredFormLink ? `<a href="${escapeHtml(booking.requiredFormLink)}" target="_blank" rel="noopener">Open form</a>` : "—"}</td>
          <td>${booking.status}</td>
          <td>${formatDateTime(booking.reminderAt)}</td>
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
  if (/[",\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
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

function exportAdminCsv() {
  const bookings = getBookings().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const lines = [
    "Booking ID,Vehicle,Customer Name,Email,Mobile,Address,DOB,Pickup,Drop-off,Duration Days,Early Pickup,Dartford Crossings,Hire Total,Paid Now,Outstanding,Deposit,Required Form,Required Form Link,Status,Reminder At,Outstanding Link,Deposit Link,Form A,Form B,Created"
  ];

  if (!bookings.length) {
    lines.push("No bookings saved,,,,,,,,,,,,,,,,,,,,,,");
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
          `£${booking.hireTotal.toFixed(2)}`,
          `£${booking.confirmationFee.toFixed(2)}`,
          `£${booking.outstandingAmount.toFixed(2)}`,
          `£${booking.depositAmount.toFixed(2)}`,
          booking.requiredFormType === "short" ? "Short" : "Long",
          booking.requiredFormLink,
          booking.status,
          formatDateTime(booking.reminderAt),
          booking.outstandingPaymentLink,
          booking.depositLink,
          booking.formLinkA,
          booking.formLinkB,
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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function exportAdminPdf() {
  const bookings = getBookings().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
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
              <td>${escapeHtml(`£${booking.confirmationFee.toFixed(2)}`)}</td>
              <td>${escapeHtml(`£${booking.outstandingAmount.toFixed(2)}`)}</td>
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

async function notifyBackend(booking, phase) {
  try {
    await fetch(apiUrl("/api/bookings/automation"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phase, booking })
    });
  } catch (error) {
    console.warn("Automation endpoint unavailable.", error);
  }
}

async function createStripeCheckoutSession(booking) {
  try {
    const response = await fetch(apiUrl("/api/bookings/create-checkout-session"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ booking })
    });

    if (response.ok) {
      const data = await response.json();
      if (data?.checkoutUrl) return data.checkoutUrl;
    }
  } catch (error) {
    console.warn("Stripe session endpoint unavailable.", error);
  }

  return is35T(booking.vehicleSnapshot) ? STRIPE_PAYMENT_LINK_35T : STRIPE_PAYMENT_LINK_75T;
}

function resetBookingCustomerFields() {
  customerNameInput.value = "";
  customerEmailInput.value = "";
  customerMobileInput.value = "";
  customerAddressInput.value = "";
  customerDobInput.value = "";
  hiredWithin3MonthsInput.checked = false;
  dartfordEnabledInput.checked = false;
  dartfordCountInput.value = "1";
  dartfordCountInput.disabled = true;
  earlyPickupEnabledInput.checked = false;
  updateCheckoutSummary();
}

availabilityForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const pickupDate = pickupDateInput.value;
  const pickupTime = pickupTimeInput.value || DEFAULT_PICKUP_TIME;
  const durationDays = Number(durationDaysInput.value);

  if (!pickupDate || Number.isNaN(durationDays) || durationDays <= 0) {
    availabilityResults.innerHTML = '<p class="empty-note">Enter a valid pickup date and duration.</p>';
    return;
  }

  const availableLorries = getAvailableLorries(pickupDate, durationDays, pickupTime);
  renderAvailabilityResults(availableLorries);
});

availabilityResults.addEventListener("click", (event) => {
  const button = event.target.closest(".choose-lorry");
  if (!button) return;
  selectAvailability(button.dataset.vehicleId);
});

dartfordEnabledInput.addEventListener("change", () => {
  dartfordCountInput.disabled = !dartfordEnabledInput.checked;
  updateCheckoutSummary();
});

dartfordCountInput.addEventListener("input", updateCheckoutSummary);
earlyPickupEnabledInput.addEventListener("change", updateCheckoutSummary);
hiredWithin3MonthsInput.addEventListener("change", updateCheckoutSummary);

bookingForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!selectedAvailability) {
    alert("Please select a lorry from the availability results first.");
    return;
  }

  const stillAvailable = isVehicleAvailable(
    selectedAvailability.vehicle.id,
    selectedAvailability.pickupDate,
    selectedAvailability.durationDays,
    selectedAvailability.pickupTime
  );

  if (!stillAvailable) {
    alert("That lorry is no longer available for the selected dates. Please search again.");
    return;
  }

  const dartfordCrossings = dartfordEnabledInput.checked ? Math.max(1, Number(dartfordCountInput.value || 1)) : 0;
  const earlyPickup = earlyPickupEnabledInput.checked;
  const crossingCharge = calculateCrossingCharge(dartfordCrossings);
  const earlyPickupCharge = calculateEarlyPickupCharge(earlyPickup);
  const hireTotal = calculateHireTotal(selectedAvailability.baseCost, dartfordCrossings, earlyPickup);
  const confirmationFee = getConfirmationFee(selectedAvailability.vehicle);
  const outstandingAmount = Math.max(0, hireTotal - confirmationFee);
  const hiredWithinLast3Months = hiredWithin3MonthsInput.checked;
  const requiredFormType = hiredWithinLast3Months ? "short" : "long";

  const existingIds = new Set(getBookings().map((item) => String(item.id)));
  const bookingId = generateNumericBookingId(existingIds);
  const shortFormLink = buildFormUrl(FORM_LINK_A, bookingId);
  const longFormLink = buildFormUrl(FORM_LINK_B, bookingId);
  const requiredFormLink = requiredFormType === "short" ? shortFormLink : longFormLink;

  const booking = {
    id: bookingId,
    vehicleId: selectedAvailability.vehicle.id,
    vehicleSnapshot: {
      id: selectedAvailability.vehicle.id,
      name: selectedAvailability.vehicle.name,
      type: selectedAvailability.vehicle.type
    },
    pickupAt: selectedAvailability.pickupAt.toISOString(),
    dropoffAt: selectedAvailability.dropoffAt.toISOString(),
    durationDays: selectedAvailability.durationDays,
    durationHours: selectedAvailability.durationHours,
    pickupTime: selectedAvailability.pickupTime,
    customerName: customerNameInput.value,
    customerEmail: customerEmailInput.value,
    customerMobile: customerMobileInput.value,
    customerAddress: customerAddressInput.value,
    customerDob: customerDobInput.value,
    dartfordCrossings,
    crossingCharge,
    earlyPickup,
    earlyPickupCharge,
    hireTotal,
    confirmationFee,
    outstandingAmount,
    depositAmount: SECURITY_DEPOSIT_AMOUNT,
    status: "pending_confirmation_payment",
    reminderAt: getReminderAt(selectedAvailability.pickupAt.toISOString()),
    outstandingPaymentLink: OUTSTANDING_PAYMENT_LINK,
    depositLink: DEPOSIT_PAYMENT_LINK,
    formLinkA: shortFormLink,
    formLinkB: longFormLink,
    requiredFormType,
    requiredFormLink,
    hiredWithinLast3Months,
    createdAt: new Date().toISOString()
  };

  const bookings = getBookings();
  bookings.push(booking);
  saveBookings(bookings);

  renderBookings();
  renderAdminBookings();

  await notifyBackend(booking, "booking_created");

  const checkoutUrl = await createStripeCheckoutSession(booking);
  if (!checkoutUrl) {
    alert("Stripe checkout link is not configured yet. Add your Stripe links or backend session endpoint in app.js.");
    return;
  }

  bookingSuccess.hidden = false;
  setTimeout(() => {
    bookingSuccess.hidden = true;
  }, 2500);

  resetBookingCustomerFields();
  window.location.href = checkoutUrl;
});

refreshAdminBtn.addEventListener("click", renderAdminBookings);
exportAdminCsvBtn.addEventListener("click", exportAdminCsv);
exportAdminPdfBtn.addEventListener("click", exportAdminPdf);

clearAdminBtn.addEventListener("click", () => {
  if (!confirm("Clear all saved demo bookings?")) return;
  localStorage.removeItem(STORAGE_BOOKINGS);
  selectedAvailability = null;
  selectedLorryInput.value = "";
  selectedPickupInput.value = "";
  selectedDurationInput.value = "";
  selectedBaseInput.value = "";
  renderBookings();
  renderAdminBookings();
  updateCheckoutSummary();
});

bookingSubmitBtn.disabled = true;
renderFleet();
renderBookings();
renderAdminBookings();
updateCheckoutSummary();
