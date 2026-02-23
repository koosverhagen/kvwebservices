const STORAGE_BOOKINGS = "equinetransportuk_bookings";
const STORAGE_RESPONSIBILITY = "equinetransportuk_responsibility";
const STORAGE_LICENCE_CHECK = "equinetransportuk_licence_check";

const pickupTimes = [
  "06:00",
  "07:00",
  "08:00",
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
  "18:00",
  "19:00",
  "20:00"
];

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
const vehicleSelect = document.getElementById("vehicle");
const pickupTimeSelect = document.getElementById("pickup-time");
const dropoffTimeSelect = document.getElementById("dropoff-time");
const quoteBox = document.getElementById("quote-box");
const bookingForm = document.getElementById("booking-form");
const responsibilityForm = document.getElementById("responsibility-form");
const responsibilitySuccess = document.getElementById("responsibility-success");
const licenceForm = document.getElementById("licence-form");
const licenceSuccess = document.getElementById("licence-success");
const bookingList = document.getElementById("booking-list");
const adminResponsibility = document.getElementById("admin-responsibility");
const adminLicence = document.getElementById("admin-licence");
const adminBookings = document.getElementById("admin-bookings");
const refreshAdminBtn = document.getElementById("refresh-admin");
const exportAdminCsvBtn = document.getElementById("export-admin-csv");
const exportAdminPdfBtn = document.getElementById("export-admin-pdf");
const clearAdminBtn = document.getElementById("clear-admin");

document.getElementById("year").textContent = new Date().getFullYear();

function getBookings() {
  return JSON.parse(localStorage.getItem(STORAGE_BOOKINGS) || "[]");
}

function saveBookings(items) {
  localStorage.setItem(STORAGE_BOOKINGS, JSON.stringify(items));
}

function getResponsibility() {
  return JSON.parse(localStorage.getItem(STORAGE_RESPONSIBILITY) || "null");
}

function saveResponsibility(data) {
  localStorage.setItem(STORAGE_RESPONSIBILITY, JSON.stringify(data));
}

function getLicenceCheck() {
  return JSON.parse(localStorage.getItem(STORAGE_LICENCE_CHECK) || "null");
}

function saveLicenceCheck(data) {
  localStorage.setItem(STORAGE_LICENCE_CHECK, JSON.stringify(data));
}

function asDate(date, time) {
  return new Date(`${date}T${time}:00`);
}

function hoursBetween(start, end) {
  return (end.getTime() - start.getTime()) / (1000 * 60 * 60);
}

function calcQuote(vehicleId, pickupDate, pickupTime, dropoffDate, dropoffTime) {
  if (!vehicleId || !pickupDate || !pickupTime || !dropoffDate || !dropoffTime) {
    return null;
  }

  const vehicle = vehicles.find((v) => v.id === vehicleId);
  if (!vehicle) return null;

  const start = asDate(pickupDate, pickupTime);
  const end = asDate(dropoffDate, dropoffTime);
  const hrs = hoursBetween(start, end);

  if (hrs <= 0) return null;

  const billableDays = Math.ceil(hrs / 24);
  const base = billableDays * vehicle.dayRate;
  const serviceFee = 12;
  const total = base + serviceFee;

  return {
    vehicle,
    hrs,
    billableDays,
    base,
    serviceFee,
    total
  };
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function isAvailable(vehicleId, pickupDate, pickupTime, dropoffDate, dropoffTime) {
  const start = asDate(pickupDate, pickupTime);
  const end = asDate(dropoffDate, dropoffTime);

  const bookings = getBookings().filter((b) => b.vehicleId === vehicleId);
  return !bookings.some((b) => {
    const bStart = new Date(b.pickupAt);
    const bEnd = new Date(b.dropoffAt);
    return overlaps(start, end, bStart, bEnd);
  });
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

function fillSelects() {
  vehicles.forEach((vehicle) => {
    const option = document.createElement("option");
    option.value = vehicle.id;
    option.textContent = `${vehicle.name} (£${vehicle.dayRate}/day)`;
    vehicleSelect.appendChild(option);
  });

  pickupTimes.forEach((time) => {
    const startOpt = document.createElement("option");
    startOpt.value = time;
    startOpt.textContent = time;
    pickupTimeSelect.appendChild(startOpt);

    const endOpt = document.createElement("option");
    endOpt.value = time;
    endOpt.textContent = time;
    dropoffTimeSelect.appendChild(endOpt);
  });
}

function refreshQuote() {
  const quote = calcQuote(
    vehicleSelect.value,
    document.getElementById("pickup-date").value,
    pickupTimeSelect.value,
    document.getElementById("dropoff-date").value,
    dropoffTimeSelect.value
  );

  if (!quote) {
    quoteBox.textContent = "Choose dates to calculate quote.";
    return;
  }

  const available = isAvailable(
    quote.vehicle.id,
    document.getElementById("pickup-date").value,
    pickupTimeSelect.value,
    document.getElementById("dropoff-date").value,
    dropoffTimeSelect.value
  );

  quoteBox.innerHTML = `
    ${available ? "✅" : "⚠️"} ${quote.vehicle.name}<br>
    ${quote.billableDays} day(s), ${quote.hrs.toFixed(1)} hrs<br>
    Hire: £${quote.base.toFixed(2)} · Service fee: £${quote.serviceFee.toFixed(2)}<br>
    <strong>Total estimate: £${quote.total.toFixed(2)}</strong>${available ? "" : "<br>Selected times overlap an existing booking."}
  `;
}

function renderBookings() {
  const bookings = getBookings().sort((a, b) => new Date(a.pickupAt) - new Date(b.pickupAt));
  bookingList.innerHTML = "";

  if (!bookings.length) {
    bookingList.innerHTML = '<div class="booking-item muted">No bookings yet. Your first confirmed request will appear here.</div>';
    return;
  }

  bookings.forEach((booking) => {
    const vehicle = vehicles.find((item) => item.id === booking.vehicleId);
    const card = document.createElement("article");
    card.className = "booking-item";
    card.innerHTML = `
      <strong>${vehicle?.name || booking.vehicleId}</strong><br>
      ${new Date(booking.pickupAt).toLocaleString()} → ${new Date(booking.dropoffAt).toLocaleString()}<br>
      ${booking.driverName} · ${booking.driverEmail}<br>
      <span class="muted">Est. £${booking.total.toFixed(2)}</span>
    `;
    bookingList.appendChild(card);
  });
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function csvEscape(value) {
  const normalized = String(value ?? "");
  if (/[",\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

function getExportPayload() {
  const responsibility = getResponsibility();
  const licence = getLicenceCheck();
  const bookings = getBookings().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return { responsibility, licence, bookings };
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
  const { responsibility, licence, bookings } = getExportPayload();
  const lines = [];

  lines.push("Section,Field,Value");
  if (responsibility) {
    lines.push(`Responsibility,Name,${csvEscape(responsibility.name)}`);
    lines.push(`Responsibility,Email,${csvEscape(responsibility.email)}`);
    lines.push(`Responsibility,Address,${csvEscape(responsibility.address)}`);
    lines.push(`Responsibility,Accepted,${csvEscape(responsibility.accepted ? "Yes" : "No")}`);
    lines.push(`Responsibility,Submitted,${csvEscape(formatDate(responsibility.createdAt))}`);
  } else {
    lines.push("Responsibility,Status,No form saved");
  }

  if (licence) {
    lines.push(`Licence,Name,${csvEscape(licence.name)}`);
    lines.push(`Licence,DOB,${csvEscape(licence.dob)}`);
    lines.push(`Licence,Licence Number,${csvEscape(licence.number)}`);
    lines.push(`Licence,Check Code,${csvEscape(licence.checkCode)}`);
    lines.push(`Licence,Code Expiry,${csvEscape(licence.expiry)}`);
    lines.push(`Licence,Phone,${csvEscape(licence.phone)}`);
    lines.push(`Licence,Consent,${csvEscape(licence.consent ? "Yes" : "No")}`);
    lines.push(`Licence,Submitted,${csvEscape(formatDate(licence.createdAt))}`);
  } else {
    lines.push("Licence,Status,No form saved");
  }

  lines.push("");
  lines.push("Booking ID,Vehicle,Driver,Email,Phone,Pickup,Drop-off,Total,Created,Notes");

  if (!bookings.length) {
    lines.push("No bookings saved,,,,,,,,,");
  } else {
    bookings.forEach((booking) => {
      const vehicle = vehicles.find((item) => item.id === booking.vehicleId);
      lines.push(
        [
          booking.id,
          vehicle?.name || booking.vehicleId,
          booking.driverName,
          booking.driverEmail,
          booking.driverPhone,
          formatDate(booking.pickupAt),
          formatDate(booking.dropoffAt),
          `£${Number(booking.total || 0).toFixed(2)}`,
          formatDate(booking.createdAt),
          booking.notes || ""
        ]
          .map(csvEscape)
          .join(",")
      );
    });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  downloadFile(lines.join("\n"), `equine-admin-export-${stamp}.csv`, "text/csv;charset=utf-8");
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
  const { responsibility, licence, bookings } = getExportPayload();
  const stamp = new Date().toISOString().slice(0, 10);

  const responsibilityRows = responsibility
    ? `
      <tr><th>Name</th><td>${escapeHtml(responsibility.name)}</td></tr>
      <tr><th>Email</th><td>${escapeHtml(responsibility.email)}</td></tr>
      <tr><th>Address</th><td>${escapeHtml(responsibility.address)}</td></tr>
      <tr><th>Accepted</th><td>${escapeHtml(responsibility.accepted ? "Yes" : "No")}</td></tr>
      <tr><th>Submitted</th><td>${escapeHtml(formatDate(responsibility.createdAt))}</td></tr>
    `
    : "<tr><td colspan='2'>No responsibility form saved.</td></tr>";

  const licenceRows = licence
    ? `
      <tr><th>Name</th><td>${escapeHtml(licence.name)}</td></tr>
      <tr><th>DOB</th><td>${escapeHtml(licence.dob)}</td></tr>
      <tr><th>Licence no.</th><td>${escapeHtml(licence.number)}</td></tr>
      <tr><th>Check code</th><td>${escapeHtml(licence.checkCode)}</td></tr>
      <tr><th>Code expiry</th><td>${escapeHtml(licence.expiry)}</td></tr>
      <tr><th>Phone</th><td>${escapeHtml(licence.phone)}</td></tr>
      <tr><th>Consent</th><td>${escapeHtml(licence.consent ? "Yes" : "No")}</td></tr>
      <tr><th>Submitted</th><td>${escapeHtml(formatDate(licence.createdAt))}</td></tr>
    `
    : "<tr><td colspan='2'>No licence check form saved.</td></tr>";

  const bookingRows = bookings.length
    ? bookings
        .map((booking) => {
          const vehicle = vehicles.find((item) => item.id === booking.vehicleId);
          return `
            <tr>
              <td>${escapeHtml(vehicle?.name || booking.vehicleId)}</td>
              <td>${escapeHtml(booking.driverName || "—")}</td>
              <td>${escapeHtml(formatDate(booking.pickupAt))}</td>
              <td>${escapeHtml(formatDate(booking.dropoffAt))}</td>
              <td>${escapeHtml(`£${Number(booking.total || 0).toFixed(2)}`)}</td>
              <td>${escapeHtml(formatDate(booking.createdAt))}</td>
            </tr>
          `;
        })
        .join("")
    : "<tr><td colspan='6'>No bookings saved.</td></tr>";

  const reportHtml = `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>Equine Admin Export ${stamp}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 24px; color: #111827; }
          h1, h2 { margin: 0 0 10px; }
          section { margin-bottom: 20px; }
          .meta { margin-bottom: 20px; color: #4b5563; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { border: 1px solid #d1d5db; padding: 7px; text-align: left; vertical-align: top; }
          th { background: #f3f4f6; width: 180px; }
          .bookings th { width: auto; }
        </style>
      </head>
      <body>
        <h1>Equine Transport UK Admin Export</h1>
        <div class="meta">Generated: ${escapeHtml(new Date().toLocaleString())}</div>

        <section>
          <h2>Responsibility Agreement</h2>
          <table>${responsibilityRows}</table>
        </section>

        <section>
          <h2>Driving Licence Check</h2>
          <table>${licenceRows}</table>
        </section>

        <section>
          <h2>Booking Register</h2>
          <table class="bookings">
            <thead>
              <tr>
                <th>Vehicle</th>
                <th>Driver</th>
                <th>Pickup</th>
                <th>Drop-off</th>
                <th>Total</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>${bookingRows}</tbody>
          </table>
        </section>
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

function renderAdminResponsibility() {
  const item = getResponsibility();
  if (!item) {
    adminResponsibility.innerHTML = '<p class="empty-note">No responsibility form saved yet.</p>';
    return;
  }

  adminResponsibility.innerHTML = `
    <table class="admin-table">
      <tbody>
        <tr><th>Name</th><td>${item.name || "—"}</td></tr>
        <tr><th>Email</th><td>${item.email || "—"}</td></tr>
        <tr><th>Address</th><td>${item.address || "—"}</td></tr>
        <tr><th>Accepted</th><td>${item.accepted ? "Yes" : "No"}</td></tr>
        <tr><th>Submitted</th><td>${formatDate(item.createdAt)}</td></tr>
      </tbody>
    </table>
  `;
}

function renderAdminLicence() {
  const item = getLicenceCheck();
  if (!item) {
    adminLicence.innerHTML = '<p class="empty-note">No licence check form saved yet.</p>';
    return;
  }

  adminLicence.innerHTML = `
    <table class="admin-table">
      <tbody>
        <tr><th>Name</th><td>${item.name || "—"}</td></tr>
        <tr><th>DOB</th><td>${item.dob || "—"}</td></tr>
        <tr><th>Licence no.</th><td>${item.number || "—"}</td></tr>
        <tr><th>Check code</th><td>${item.checkCode || "—"}</td></tr>
        <tr><th>Code expiry</th><td>${item.expiry || "—"}</td></tr>
        <tr><th>Consent</th><td>${item.consent ? "Yes" : "No"}</td></tr>
        <tr><th>Submitted</th><td>${formatDate(item.createdAt)}</td></tr>
      </tbody>
    </table>
  `;
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
          <td>${booking.driverName || "—"}</td>
          <td>${formatDate(booking.pickupAt)}</td>
          <td>${formatDate(booking.dropoffAt)}</td>
          <td>£${Number(booking.total || 0).toFixed(2)}</td>
          <td>${formatDate(booking.createdAt)}</td>
        </tr>
      `;
    })
    .join("");

  adminBookings.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>Vehicle</th>
          <th>Driver</th>
          <th>Pickup</th>
          <th>Drop-off</th>
          <th>Total</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderAdminReview() {
  renderAdminResponsibility();
  renderAdminLicence();
  renderAdminBookings();
}

bookingForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const responsibility = getResponsibility();
  const licenceCheck = getLicenceCheck();

  if (!responsibility) {
    alert("Please complete the Responsibility Agreement form before booking.");
    return;
  }

  if (!licenceCheck) {
    alert("Please complete the Driving Licence Check form before booking.");
    return;
  }

  if (new Date(licenceCheck.expiry) < new Date()) {
    alert("The licence check code is expired. Please submit a valid check code before booking.");
    return;
  }

  const quote = calcQuote(
    vehicleSelect.value,
    document.getElementById("pickup-date").value,
    pickupTimeSelect.value,
    document.getElementById("dropoff-date").value,
    dropoffTimeSelect.value
  );

  if (!quote) {
    alert("Please select valid pickup and drop-off dates/times.");
    return;
  }

  const available = isAvailable(
    quote.vehicle.id,
    document.getElementById("pickup-date").value,
    pickupTimeSelect.value,
    document.getElementById("dropoff-date").value,
    dropoffTimeSelect.value
  );

  if (!available) {
    alert("This vehicle is already booked in that time range. Please choose a different slot.");
    return;
  }

  const booking = {
    id: crypto.randomUUID(),
    vehicleId: quote.vehicle.id,
    pickupAt: asDate(document.getElementById("pickup-date").value, pickupTimeSelect.value).toISOString(),
    dropoffAt: asDate(document.getElementById("dropoff-date").value, dropoffTimeSelect.value).toISOString(),
    driverName: document.getElementById("driver-name").value,
    driverEmail: document.getElementById("driver-email").value,
    driverPhone: document.getElementById("driver-phone").value,
    notes: document.getElementById("booking-notes").value,
    total: quote.total,
    createdAt: new Date().toISOString()
  };

  const bookings = getBookings();
  bookings.push(booking);
  saveBookings(bookings);
  renderBookings();
  renderAdminReview();
  bookingForm.reset();
  quoteBox.textContent = "Booking request saved. You can now submit another request.";
});

responsibilityForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const agreement = {
    name: document.getElementById("responsibility-name").value,
    email: document.getElementById("responsibility-email").value,
    address: document.getElementById("responsibility-address").value,
    accepted: document.getElementById("responsibility-confirm").checked,
    createdAt: new Date().toISOString()
  };

  saveResponsibility(agreement);

  responsibilitySuccess.hidden = false;
  setTimeout(() => (responsibilitySuccess.hidden = true), 2800);
  renderAdminReview();
});

licenceForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const licence = {
    name: document.getElementById("licence-name").value,
    dob: document.getElementById("licence-dob").value,
    number: document.getElementById("licence-number").value,
    checkCode: document.getElementById("licence-check-code").value,
    expiry: document.getElementById("licence-expiry").value,
    phone: document.getElementById("licence-phone").value,
    consent: document.getElementById("licence-consent").checked,
    createdAt: new Date().toISOString()
  };

  saveLicenceCheck(licence);

  licenceSuccess.hidden = false;
  setTimeout(() => (licenceSuccess.hidden = true), 2800);
  renderAdminReview();
});

refreshAdminBtn.addEventListener("click", renderAdminReview);
exportAdminCsvBtn.addEventListener("click", exportAdminCsv);
exportAdminPdfBtn.addEventListener("click", exportAdminPdf);

clearAdminBtn.addEventListener("click", () => {
  if (!confirm("Clear all saved demo bookings and compliance forms?")) return;
  localStorage.removeItem(STORAGE_BOOKINGS);
  localStorage.removeItem(STORAGE_RESPONSIBILITY);
  localStorage.removeItem(STORAGE_LICENCE_CHECK);
  renderBookings();
  renderAdminReview();
});

[
  vehicleSelect,
  document.getElementById("pickup-date"),
  pickupTimeSelect,
  document.getElementById("dropoff-date"),
  dropoffTimeSelect
].forEach((el) => el.addEventListener("change", refreshQuote));

renderFleet();
fillSelects();
renderBookings();
renderAdminReview();
refreshQuote();
