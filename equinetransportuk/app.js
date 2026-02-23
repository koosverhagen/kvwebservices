const STORAGE_BOOKINGS = "equinetransportuk_bookings";
const DARTFORD_CROSSING_PRICE = 4.2;
const EARLY_PICKUP_PRICE = 20;
const CONFIRMATION_FEE_35T = 70;
const CONFIRMATION_FEE_75T = 100;
const SECURITY_DEPOSIT_AMOUNT = 200;
const DEFAULT_PICKUP_TIME = "09:00";

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
    name: "3.5T Stallion Layout",
    type: "3.5 tonne",
    seats: 3,
    overnight: false,
    dayRate: 165,
    image: "https://static.wixstatic.com/media/a9ff84_68faf662eaf24511a7711c29c377127a~mv2.webp/v1/fill/w_590,h_716,al_c,q_85,enc_avif,quality_auto/3_5%20Tonne%20Horsebox%20Stallion%20Equine%20Transport%20UK6%20(1)%20(1)%20(1)%20(1)_upscayl_2x_upscayl-lite-4.webp"
  },
  {
    id: "v35-2",
    name: "3.5T Rear-Facing Layout",
    type: "3.5 tonne",
    seats: 3,
    overnight: false,
    dayRate: 175,
    image: "https://static.wixstatic.com/media/a9ff84_a4985901fe1d4fac9683121f46650de1~mv2.webp/v1/fill/w_598,h_404,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/IMG_0968%20(1)%20(1)%20(1)_upscayl_2x_upscayl-lite-4x%20(1)%20(1).webp"
  },
  {
    id: "v35-3",
    name: "3.5T Premium Travel Layout",
    type: "3.5 tonne",
    seats: 3,
    overnight: false,
    dayRate: 185,
    image: "https://static.wixstatic.com/media/a9ff84_873b9f6d7d644b10851d5b664a1afe85~mv2.webp/v1/fill/w_960,h_720,al_c,q_85,enc_avif,quality_auto/7_edited%20(1)%20(1)%20(1)_upscayl_2x_upscayl-lite-4x.webp"
  },
  {
    id: "v75-1",
    name: "7.5T with Living Layout A",
    type: "7.5 tonne",
    seats: 3,
    overnight: true,
    dayRate: 245,
    image: "https://static.wixstatic.com/media/a9ff84_4e06d95c65794b30aca861a5c4827af7~mv2.webp/v1/fill/w_425,h_567,al_c,lg_1,q_80,enc_avif,quality_auto/7_5T%20Horsebox%20with%20living%20Equine%20Transport%20UK%20003%20(1).webp"
  },
  {
    id: "v75-2",
    name: "7.5T with Living Layout B",
    type: "7.5 tonne",
    seats: 3,
    overnight: true,
    dayRate: 260,
    image: "https://static.wixstatic.com/media/a9ff84_82c45cb343c94a279f00d7fbd7af16ab~mv2.webp/v1/fill/w_497,h_432,al_c,lg_1,q_80,enc_avif,quality_auto/7_5T%20Horsebox%20with%20living%20Equine%20Transport%20UK%20008%20(1)%20(1).webp"
  }
];

const fleetGrid = document.getElementById("fleet-grid");
const availabilityForm = document.getElementById("availability-form");
const pickupDateInput = document.getElementById("pickup-date");
const durationDaysInput = document.getElementById("duration-days");
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

document.getElementById("year").textContent = String(new Date().getFullYear());

function apiUrl(path) {
  if (!BACKEND_API_BASE) return path;
  return `${BACKEND_API_BASE.replace(/\/$/, "")}${path}`;
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

function calculateBaseCost(vehicle, durationDays) {
  return vehicle.dayRate * durationDays;
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
    card.innerHTML = `
      <img src="${vehicle.image}" alt="${vehicle.name}">
      <div class="fleet-content">
        <h3>${vehicle.name}</h3>
        <p class="muted">${vehicle.type} · ${vehicle.seats} seats · ${vehicle.overnight ? "living" : "day layout"}</p>
        <p><strong>From £${vehicle.dayRate}</strong> / day</p>
      </div>
    `;
    fleetGrid.appendChild(card);
  });
}

function buildAvailability(vehicle, pickupDate, durationDays) {
  const pickupAt = asDate(pickupDate);
  const dropoffAt = addDays(pickupAt, durationDays);
  return {
    vehicle,
    pickupDate,
    durationDays,
    pickupAt,
    dropoffAt,
    baseCost: calculateBaseCost(vehicle, durationDays)
  };
}

function isVehicleAvailable(vehicleId, pickupDate, durationDays) {
  const candidate = buildAvailability({ id: vehicleId, dayRate: 0 }, pickupDate, durationDays);
  const vehicleBookings = getBookings().filter((booking) => booking.vehicleId === vehicleId && booking.status !== "cancelled");

  return !vehicleBookings.some((booking) => {
    const existingStart = new Date(booking.pickupAt);
    const existingEnd = new Date(booking.dropoffAt);
    return overlaps(candidate.pickupAt, candidate.dropoffAt, existingStart, existingEnd);
  });
}

function getAvailableLorries(pickupDate, durationDays) {
  return vehicles
    .filter((vehicle) => isVehicleAvailable(vehicle.id, pickupDate, durationDays))
    .map((vehicle) => buildAvailability(vehicle, pickupDate, durationDays));
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
            <p class="muted">${formatDateOnly(item.pickupDate)} · ${item.durationDays} day(s)</p>
            <p><strong>Hire from £${item.baseCost.toFixed(2)}</strong></p>
            <p class="muted tiny">Pay now to confirm: £${confirmationFee.toFixed(2)}</p>
          </div>
          <button class="btn choose-lorry" type="button" data-vehicle-id="${item.vehicle.id}">Select</button>
        </article>
      `;
    })
    .join("");

  availabilityResults.innerHTML = html;
}

function updateCheckoutSummary() {
  if (!selectedAvailability) {
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
  const durationDays = Number(durationDaysInput.value);
  const vehicle = vehicles.find((item) => item.id === vehicleId);
  if (!vehicle || !pickupDate || durationDays < 1) return;

  selectedAvailability = buildAvailability(vehicle, pickupDate, durationDays);

  selectedLorryInput.value = vehicle.name;
  selectedPickupInput.value = formatDateOnly(pickupDate);
  selectedDurationInput.value = `${durationDays} day(s)`;
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
          <td>${booking.durationDays} day(s)</td>
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
              <td>${escapeHtml(String(booking.durationDays))}</td>
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
  const durationDays = Number(durationDaysInput.value);

  if (!pickupDate || Number.isNaN(durationDays) || durationDays < 1) {
    availabilityResults.innerHTML = '<p class="empty-note">Enter a valid pickup date and duration.</p>';
    return;
  }

  const availableLorries = getAvailableLorries(pickupDate, durationDays);
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
    selectedAvailability.durationDays
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
