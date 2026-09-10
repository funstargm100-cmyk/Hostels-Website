require('dotenv').config();
const nodemailer = require('nodemailer');
const port = parseInt(process.env.EMAIL_PORT, 10);
const t = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port,
  secure: port === 465,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});
t.sendMail({
  from: `"Hostels Platform" <${process.env.EMAIL_USER}>`,
  to: process.env.EMAIL_USER,
  subject: 'SMTP test — Roomy',
  html: '<p>If you got this, OTP emails will work.</p>'
}).then(i => console.log('SEND OK — id', i.messageId))
  .catch(e => { console.log('SEND FAILED:', e.code, e.response || e.message); process.exit(1); });
