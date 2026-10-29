// /api/reply-demo — live demo of instant lead replies (michalbenko.sk/en)
// type "demo":     visitor plays their own customer -> gets (1) the instant reply their customer would get
//                  and (2) the owner alert they would get; Michal gets a lead notification
// type "interest": firm wants the system -> notification to Michal + confirmation to the prospect
// Env: GMAIL_USER, GMAIL_APP_PASSWORD (same as /api/audit-submit), optional REPLY_DEMO_HOOK (e.g. Zapier webhook -> Google Sheet)
const { transport } = require('./_lib/mail.js');

const TO_EMAIL = 'michalbenko3@gmail.com';
const SITE = 'https://michalbenko.sk/en/';

const TRADES = {
  kitchens: 'Kitchens',
  windows: 'Windows & doors',
  bathrooms: 'Bathrooms',
  solar: 'Solar & heat pumps',
  landscaping: 'Landscaping',
  other: 'Home improvement'
};
const VOLUMES = ['under 20', '20-50', '50-150', '150+'];

// best-effort abuse protection (per function instance)
const hits = new Map();
function limited(k, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(k) || []).filter(t => now - t < windowMs);
  arr.push(now); hits.set(k, arr);
  return arr.length > max;
}
function clean(v, max) { return typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').replace(/[<>]/g, '').trim().slice(0, max || 200) : ''; }
function cleanMsg(v, max) { return typeof v === 'string' ? v.replace(/[<>]/g, '').replace(/\r/g, '').trim().slice(0, max || 1000) : ''; }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const first = n => String(n).split(/\s+/)[0] || n;

function sender(name) { return '"' + String(name).replace(/["<>]/g, '') + '" <' + process.env.GMAIL_USER + '>'; }

function shell(inner, note) {
  return '<div style="font-family:Arial,Helvetica,sans-serif;background:#F7F1E6;padding:24px 12px">' +
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #DED0B0;padding:26px 24px;color:#0E1A30;font-size:15px;line-height:1.55">' +
    inner + '</div>' +
    (note ? '<p style="max-width:560px;margin:14px auto 0;font-size:12px;color:#6B7489;line-height:1.5">' + note + '</p>' : '') +
    '</div>';
}

function customerReply(d) {
  const trade = TRADES[d.trade];
  const html = shell(
    '<p style="margin:0 0 14px">Hi ' + esc(first(d.name)) + ',</p>' +
    '<p style="margin:0 0 14px">Thanks for getting in touch with <b>' + esc(d.biz) + '</b>. We\'ve got your enquiry and it\'s with the team now.</p>' +
    '<p style="margin:0 0 14px">Here\'s what happens next:</p>' +
    '<ol style="margin:0 0 14px;padding-left:20px"><li>We\'ll review your request today.</li><li>We\'ll call or email you within one working day to arrange a quote.</li></ol>' +
    '<div style="background:#F4EFE4;padding:12px 14px;margin:0 0 14px;font-size:14px"><b>Your message:</b><br>' + esc(d.msg).replace(/\n/g, '<br>') + '</div>' +
    '<p style="margin:0 0 14px">If it\'s urgent, just reply to this email.</p>' +
    '<p style="margin:0">Kind regards,<br>The ' + esc(d.biz) + ' team</p>',
    'Demo by <a href="' + SITE + '" style="color:#2F6FED">michalbenko.sk</a>: this is the automatic reply your customers would receive, written in your name and tone. ' +
    'In the live setup it comes from your own business email.'
  );
  const text = 'Hi ' + first(d.name) + ',\n\nThanks for getting in touch with ' + d.biz + '. We\'ve got your enquiry and it\'s with the team now.\n\n' +
    '1. We\'ll review your request today.\n2. We\'ll call or email you within one working day to arrange a quote.\n\nYour message:\n' + d.msg +
    '\n\nIf it\'s urgent, just reply to this email.\n\nKind regards,\nThe ' + d.biz + ' team\n\n--\nDemo by michalbenko.sk/en (' + trade + ')';
  return { subject: 'Thanks for your enquiry, ' + first(d.name) + ' – ' + d.biz, html, text };
}

function ownerAlert(d, secs) {
  const rows = [['Name', d.name], ['Email', d.email], ['Phone', d.phone || '–'], ['Service', TRADES[d.trade]], ['Received', new Date().toUTCString()]];
  const html = shell(
    '<p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#1E8E5A"><b>New enquiry · already answered</b></p>' +
    '<h2 style="margin:0 0 14px;font-size:20px">' + esc(d.name) + ' wants a quote</h2>' +
    '<table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 14px">' +
    rows.map(r => '<tr><td style="padding:7px 0;border-bottom:1px solid #F0E8D6;color:#6B7489;width:110px">' + r[0] + '</td><td style="padding:7px 0;border-bottom:1px solid #F0E8D6">' + esc(r[1]) + '</td></tr>').join('') +
    '</table>' +
    '<div style="background:#F4EFE4;padding:12px 14px;margin:0 0 16px;font-size:14px">' + esc(d.msg).replace(/\n/g, '<br>') + '</div>' +
    '<p style="margin:0 0 16px;font-size:14px">✓ Customer got your reply in ' + secs + ' s<br><span style="color:#6B7489">In your live setup also: logged to your Google Sheet, follow-up email after 24 h if they go quiet.</span></p>' +
    '<a href="mailto:' + encodeURIComponent(d.email) + '" style="display:inline-block;background:#2F6FED;color:#ffffff;text-decoration:none;padding:12px 20px;font-weight:bold;font-size:14px">Reply to ' + esc(first(d.name)) + '</a>',
    'Demo by <a href="' + SITE + '" style="color:#2F6FED">michalbenko.sk</a>: this is the alert you would get. In the live setup it can also come as an SMS.'
  );
  const text = 'NEW ENQUIRY (already answered in ' + secs + ' s)\n\n' + rows.map(r => r[0] + ': ' + r[1]).join('\n') + '\n\n' + d.msg + '\n\n--\nDemo by michalbenko.sk/en';
  return { subject: 'New enquiry: ' + d.name + ' (' + TRADES[d.trade] + ')', html, text };
}

async function hook(payload) {
  const url = process.env.REPLY_DEMO_HOOK;
  if (!url) return;
  try { await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); }
  catch (e) { console.error('reply-demo hook failed', e && e.message); }
}

module.exports = async function handler(req, res) {
  const t0 = Date.now();
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'method_not_allowed' }); return; }

  let data = req.body;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { data = {}; } }
  data = data || {};

  // honeypot: bots fill the hidden "website" field -> pretend success
  if (clean(data.website)) { res.status(200).json({ ok: true, secs: 3 }); return; }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'na';
  const type = data.type === 'interest' ? 'interest' : 'demo';
  if (limited(ip + '|' + type, type === 'demo' ? 4 : 6, 3600e3)) { res.status(429).json({ ok: false, error: 'rate_limited' }); return; }

  const name = clean(data.name, 120);
  const email = clean(data.email, 160).toLowerCase();
  if (!name || !emailOk(email) || data.consent !== true) { res.status(400).json({ ok: false, error: 'invalid_input' }); return; }
  if (limited('e|' + type + '|' + email, 2, 3600e3)) { res.status(429).json({ ok: false, error: 'rate_limited' }); return; }

  let tx;
  try { tx = transport(); } catch (e) { console.error('reply-demo: mail not configured'); res.status(500).json({ ok: false, error: 'not_configured' }); return; }

  try {
    if (type === 'demo') {
      const d = {
        name, email,
        phone: clean(data.phone, 40),
        biz: clean(data.biz, 80) || 'Your Business',
        trade: TRADES[data.trade] ? data.trade : 'other',
        msg: cleanMsg(data.msg, 800) || 'Hi, I\'d like a quote please.'
      };
      const reply = customerReply(d);
      await tx.sendMail({ from: sender(d.biz + ' (demo)'), to: email, replyTo: TO_EMAIL, subject: reply.subject, html: reply.html, text: reply.text });
      const secs = Math.max(1, Math.round((Date.now() - t0) / 1000));
      const alert = ownerAlert(d, secs);
      await tx.sendMail({ from: sender('Lead alert (demo)'), to: email, replyTo: TO_EMAIL, subject: alert.subject, html: alert.html, text: alert.text });
      await tx.sendMail({
        from: sender('michalbenko.sk/en'), to: TO_EMAIL, replyTo: email,
        subject: '[EN demo] ' + d.name + ' · ' + d.biz + ' · ' + TRADES[d.trade],
        text: 'Someone tried the 10-second reply demo.\n\nName: ' + d.name + '\nEmail: ' + d.email + '\nPhone: ' + (d.phone || '-') + '\nBusiness: ' + d.biz + '\nTrade: ' + TRADES[d.trade] + '\nReply time: ' + secs + ' s\n\nMessage:\n' + d.msg
      });
      await hook({ type: 'demo', at: new Date().toISOString(), name: d.name, email: d.email, phone: d.phone, biz: d.biz, trade: TRADES[d.trade], secs, utm: clean(data.utm, 300) });
      res.status(200).json({ ok: true, secs });
      return;
    }

    // interest
    const i = {
      name, email,
      company: clean(data.company, 120),
      site: clean(data.site, 160),
      volume: VOLUMES.indexOf(data.volume) >= 0 ? data.volume : '',
      form: clean(data.form, 80),
      note: cleanMsg(data.note, 600)
    };
    if (!i.company || !i.site) { res.status(400).json({ ok: false, error: 'invalid_input' }); return; }
    await tx.sendMail({
      from: sender('michalbenko.sk/en'), to: TO_EMAIL, replyTo: email,
      subject: '[EN lead] ' + i.company + ' wants 10-Second Reply (' + (i.volume || '?') + ' enquiries/mo)',
      text: 'Name: ' + i.name + '\nEmail: ' + i.email + '\nCompany: ' + i.company + '\nWebsite: ' + i.site + '\nEnquiries/month: ' + (i.volume || '-') + '\nForm tool: ' + (i.form || '-') + '\n\nNote:\n' + (i.note || '-')
    });
    await tx.sendMail({
      from: sender('Michal Benko'), to: email, replyTo: TO_EMAIL,
      subject: 'Got it – next steps for ' + i.company,
      html: shell(
        '<p style="margin:0 0 14px">Hi ' + esc(first(i.name)) + ',</p>' +
        '<p style="margin:0 0 14px">Thanks, I\'ve got your request for <b>' + esc(i.company) + '</b>. I\'ll check how enquiries reach you on <b>' + esc(i.site) + '</b> and email you a short setup plan within one working day.</p>' +
        '<p style="margin:0 0 14px">No calls needed. If anything is unclear, just reply to this email.</p>' +
        '<p style="margin:0">Michal Benko<br><span style="color:#6B7489;font-size:13px">Lead automation · michalbenko.sk · based in Slovakia (EU)</span></p>'
      ),
      text: 'Hi ' + first(i.name) + ',\n\nThanks, I\'ve got your request for ' + i.company + '. I\'ll check how enquiries reach you on ' + i.site + ' and email you a short setup plan within one working day.\n\nNo calls needed. If anything is unclear, just reply to this email.\n\nMichal Benko\nmichalbenko.sk'
    });
    await hook({ type: 'interest', at: new Date().toISOString(), ...i });
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('reply-demo send error', err && err.message);
    res.status(500).json({ ok: false, error: 'send_failed' });
  }
};
