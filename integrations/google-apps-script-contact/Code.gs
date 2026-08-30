const BUSINESS_EMAIL = 'info@kvwebservices.co.uk';
const BUSINESS_NAME = 'KV Web Services';
const TIME_ZONE = 'Europe/London';

function doGet() {
  return jsonResponse_({ ok: true, service: `${BUSINESS_NAME} website enquiries` });
}

function doPost(event) {
  try {
    const parameters = event && event.parameter ? event.parameter : {};
    const expectedSecret = PropertiesService.getScriptProperties().getProperty('FORM_SECRET');

    if (!expectedSecret || !safeEqual_(parameters.secret || '', expectedSecret)) {
      return jsonResponse_({ ok: false, error: 'unauthorised' });
    }

    const enquiry = {
      name: clean_(parameters.name, 120),
      email: clean_(parameters.email, 254),
      phone: clean_(parameters.phone, 40),
      details: clean_(parameters.details, 8000),
    };

    if (!enquiry.name || !validEmail_(enquiry.email) || !enquiry.details) {
      return jsonResponse_({ ok: false, error: 'invalid' });
    }

    const subject = `${BUSINESS_NAME} website enquiry — ${enquiry.name}`;
    const body = [
      `New ${BUSINESS_NAME} website enquiry`,
      '',
      `Name: ${enquiry.name}`,
      `Email: ${enquiry.email}`,
      `Phone: ${enquiry.phone || 'Not supplied'}`,
      '',
      'Enquiry details',
      enquiry.details,
      '',
      `Submitted: ${Utilities.formatDate(new Date(), TIME_ZONE, 'd MMMM yyyy, HH:mm')}`,
    ].join('\n');

    MailApp.sendEmail({
      to: BUSINESS_EMAIL,
      subject: subject,
      body: body,
      name: `${BUSINESS_NAME} website`,
      replyTo: enquiry.email,
    });

    return jsonResponse_({ ok: true });
  } catch (error) {
    console.error(error);
    return jsonResponse_({ ok: false, error: 'delivery_failed' });
  }
}

function clean_(value, maxLength) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, maxLength);
}

function validEmail_(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function safeEqual_(left, right) {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

function jsonResponse_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
