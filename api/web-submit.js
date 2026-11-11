const nodemailer = require('nodemailer');

const BUDGET_LABELS = {
  'do-500': 'do 500 €',
  '500-1000': '500 – 1 000 €',
  '1000-2000': '1 000 – 2 000 €',
  'nad-2000': 'nad 2 000 €',
  'neviem': 'zatiaľ nevie'
};

const TO_EMAIL = 'michalbenko3@gmail.com';

function clean(v, max) {
  return typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').trim().slice(0, max || 300) : '';
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

  // Honeypot: skryté pole, ktoré reálny návštevník nevyplní.
  if (clean(data.website)) {
    res.status(200).json({ ok: true });
    return;
  }

  const name = clean(data.name, 200);
  const email = clean(data.email, 200);
  const company = clean(data.company, 200);
  const current = clean(data.current, 300);
  const reference = clean(data.reference, 600);
  const budget = clean(data.budget, 50);
  const note = typeof data.note === 'string' ? data.note.trim().slice(0, 2000) : '';

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!name || !emailOk || !reference || !budget || data.consent !== true) {
    res.status(400).json({ ok: false, error: 'invalid_input' });
    return;
  }

  const subject = 'Dopyt na web' + (company ? ' — ' + company : ' — ' + name);
  const text =
    'Meno: ' + name + '\n' +
    'E-mail: ' + email + '\n' +
    'Firma: ' + (company || '-') + '\n' +
    'Súčasný web: ' + (current || '-') + '\n' +
    'Web, ktorý sa mu páči: ' + reference + '\n' +
    'Rozpočet: ' + (BUDGET_LABELS[budget] || budget) + '\n' +
    'Poznámka: ' + (note || '-') + '\n\n' +
    'Zdroj: michalbenko.sk/weby\n';

  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPass) {
    console.error('web-submit: missing GMAIL_USER / GMAIL_APP_PASSWORD env vars');
    res.status(500).json({ ok: false, error: 'not_configured' });
    return;
  }

  try {
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: gmailUser, pass: gmailPass } });
    await transporter.sendMail({
      from: '"Michal Benko web" <' + gmailUser + '>',
      to: TO_EMAIL,
      replyTo: email,
      subject: subject,
      text: text
    });
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('web-submit send error', err);
    res.status(500).json({ ok: false, error: 'send_failed' });
  }
};
