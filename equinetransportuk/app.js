const STORAGE_BOOKINGS = "equinetransportuk_bookings";
const DARTFORD_CROSSING_PRICE = 4.2;
const DEFAULT_PICKUP_TIME = "09:00";

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
const dartfordEnabledInput = document.getElementById("dartford-enabled");
const dartfordCountInput = document.getElementById("dartford-count");
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

function calculateBaseCost(vehicle, durationDays) {
  return vehicle.dayRate * durationDays;
}

function calculateCrossingCharge(crossingsCount) {
  return crossingsCount * DARTFORD_CROSSING_PRICE;
}

function calculateTotalCost(baseCost, crossingsCount) {
  return baseCost + calculateCrossingCharge(crossingsCount);
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
  const vehicleBookings = getBookings().filter((booking) => booking.vehicleId === vehicleId);

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
      return `
        <article class="availability-item">
          <div>
            <h4>${item.vehicle.name}</h4>
            <p class="muted">${formatDateOnly(item.pickupDate)} · ${item.durationDays} day(s)</p>
            <p><strong>£${item.baseCost.toFixed(2)}</strong></p>
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
  const crossingCharge = calculateCrossingCharge(crossingsCount);
  const total = calculateTotalCost(selectedAvailability.baseCost, crossingsCount);

  checkoutSummary.innerHTML = `
    ${selectedAvailability.vehicle.name}<br>
    Base hire: £${selectedAvailability.baseCost.toFixed(2)}<br>
    Dartford crossings: £${crossingCharge.toFixed(2)}${dartfordEnabled ? ` (${crossingsCount} crossing${crossingsCount === 1 ? "" : "s"})` : ""}<br>
    <strong>Total to checkout: £${total.toFixed(2)}</strong>
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
          <span class="muted">Dartford: ${booking.dartfordCrossings} crossing${booking.dartfordCrossings === 1 ? "" : "s"} (£${booking.crossingCharge.toFixed(2)})</span><br>
          <span class="muted">Total: £${booking.total.toFixed(2)}</span>
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
          <td>${booking.dartfordCrossings}</td>
          <td>£${booking.total.toFixed(2)}</td>
          <td>${formatDateTime(booking.createdAt)}</td>
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
          <th>Crossings</th>
          <th>Total</th>
          <th>Created</th>
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
    "Booking ID,Vehicle,Customer Name,Email,Mobile,Address,DOB,Pickup,Drop-off,Duration Days,Dartford Crossings,Crossing Charge,Total,Created"
  ];

  if (!bookings.length) {
    lines.push("No bookings saved,,,,,,,,,,,,,");
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
          booking.dartfordCrossings,
          `£${booking.crossingCharge.toFixed(2)}`,
          `£${booking.total.toFixed(2)}`,
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
              <td>${escapeHtml(booking.customerMobile)}</td>
              <td>${escapeHtml(formatDateTime(booking.pickupAt))}</td>
              <td>${escapeHtml(String(booking.durationDays))}</td>
              <td>${escapeHtml(String(booking.dartfordCrossings))}</td>
              <td>${escapeHtml(`£${booking.total.toFixed(2)}`)}</td>
            </tr>
          `;
        })
        .join("")
    : "<tr><td colspan='8'>No bookings saved.</td></tr>";

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
              <th>Mobile</th>
              <th>Pickup</th>
              <th>Duration</th>
              <th>Crossings</th>
              <th>Total</th>
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

bookingForm.addEventListener("submit", (event) => {
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
  const crossingCharge = calculateCrossingCharge(dartfordCrossings);
  const total = calculateTotalCost(selectedAvailability.baseCost, dartfordCrossings);

  const booking = {
    id: crypto.randomUUID(),
    vehicleId: selectedAvailability.vehicle.id,
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
    total,
    createdAt: new Date().toISOString()
  };

  const bookings = getBookings();
  bookings.push(booking);
  saveBookings(bookings);

  renderBookings();
  renderAdminBookings();

  bookingSuccess.hidden = false;
  setTimeout(() => {
    bookingSuccess.hidden = true;
  }, 2500);

  customerNameInput.value = "";
  customerEmailInput.value = "";
  customerMobileInput.value = "";
  customerAddressInput.value = "";
  customerDobInput.value = "";
  dartfordEnabledInput.checked = false;
  dartfordCountInput.value = "1";
  dartfordCountInput.disabled = true;
  updateCheckoutSummary();
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
