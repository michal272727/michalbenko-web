const nodemailer = require('nodemailer');
let tx = null;
function transport() {
  if (tx) return tx;
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error('mail_not_configured');
  tx = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
  return tx;
}
function from(name) { return '"' + String(name || 'Cenová ponuka').replace(/["<>]/g, '') + '" <' + process.env.GMAIL_USER + '>'; }
module.exports = { transport, from };
