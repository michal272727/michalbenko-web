const nodemailer = require('nodemailer');

const BUDGET_LABELS = {
  'do-500': 'do 500 €',
  '500-1500': '500 € – 1 500 €',
  '1500-5000': '1 500 € – 5 000 €',
  'nad-5000': 'nad 5 000 €',
  'este-nemam': 'zatiaľ nemá Google Ads'
};

const TO_EMAIL = 'michalbenko3@gmail.com';

function clean(v) {
  return typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').trim() : '';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  let data = req.body;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch (e) { data = {}; }
  }
  data = data || {};

  // Honeypot — skryté pole "website", ktoré reálny návštevník nikdy nevyplní.
  // Ak je vyplnené, ide o bota: potichu predstierame úspech a nič neposielame.
  if (clean(data.website)) {
    res.status(200).json({ ok: true });
    return;
  }

  const name = clean(data.name).slice(0, 200);
  const company = clean(data.company).slice(0, 200);
  const email = clean(data.email).slice(0, 200);
  const phone = clean(data.phone).slice(0, 100);
  const site = clean(data.site).slice(0, 200);
  const budget = clean(data.budget).slice(0, 50);

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!name || !emailOk || !site || !budget) {
    res.status(400).json({ ok: false, error: 'invalid_input' });
    return;
  }

  const budgetLabel = BUDGET_LABELS[budget] || budget;
  const subject = 'Žiadosť o audit Google Ads účtu' + (company ? ' — ' + company : '');
  const text =
    'Meno: ' + name + '\n' +
    'Firma: ' + (company || '-') + '\n' +
    'E-mail: ' + email + '\n' +
    'Telefón: ' + (phone || '-') + '\n' +
    'Web: ' + site + '\n' +
    'Mesačný rozpočet: ' + budgetLabel + '\n';

  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;

  if (!gmailUser || !gmailPass) {
    console.error('audit-submit: missing GMAIL_USER / GMAIL_APP_PASSWORD env vars');
    res.status(500).json({ ok: false, error: 'not_configured' });
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: gmailUser, pass: gmailPass }
    });

    await transporter.sendMail({
      from: '"Michal Benko web" <' + gmailUser + '>',
      to: TO_EMAIL,
      replyTo: email,
      subject: subject,
      text: text
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('audit-submit send error', err);
    res.status(500).json({ ok: false, error: 'send_failed' });
  }
};
