const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS ||
      process.env.EMAIL_USER === 'your@email.com' || process.env.EMAIL_PASS === 'your_email_app_password') {
    console.error('EMAIL CONFIG ERROR: EMAIL_USER / EMAIL_PASS are not configured. ' +
      'Set real SMTP credentials in .env (for Gmail: EMAIL_USER=<gmail address>, EMAIL_PASS=<16-char app password from https://myaccount.google.com/apppasswords>).');
    return null;
  }
  const port = parseInt(process.env.EMAIL_PORT || '587', 10);
  transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
  });
  return transporter;
}

async function sendEmail(to, subject, html) {
  const tx = getTransporter();
  if (!tx) return false;
  try {
    const info = await tx.sendMail({
      from: `"Hostels Platform" <${process.env.EMAIL_USER}>`, to, subject, html
    });
    console.log(`Email sent to ${to} (${subject}) — id ${info.messageId}`);
    return true;
  } catch (err) {
    console.error('EMAIL SEND FAILED:', to, '—', err.code || '', err.response || err.message);
    return false;
  }
}

const templates = {
  otp: (otp) => `<p>Your verification code is: <strong>${otp}</strong>. Expires in 10 minutes.</p>`,
  adApproved: (title) => `<p>Your listing "<strong>${title}</strong>" has been approved and is now live!</p>`,
  adRejected: (title, reason) => `<p>Your listing "<strong>${title}</strong>" was rejected. Reason: ${reason}</p>`,
  adUnavailable: (title) => `<p>Your listing "<strong>${title}</strong>" has been temporarily marked as unavailable by our team. It is no longer visible to seekers. Contact support if you believe this is a mistake.</p>`,
  adReactivated: (title) => `<p>Good news! Your listing "<strong>${title}</strong>" has been reactivated and is live again.</p>`,
  adDeleted: (title) => `<p>Your listing "<strong>${title}</strong>" has been permanently removed from the platform by our moderation team. Contact support if you believe this was done in error.</p>`,
  interestReceived: (listing) => `<p>Someone is interested in your listing "<strong>${listing}</strong>". We'll be in touch.</p>`,
  requestUpdate: (status) => `<p>Your contact request status has been updated to: <strong>${status}</strong>.</p>`,
  payoutConfirmed: (amount) => `<p>Your payout of <strong>GHS ${amount}</strong> has been processed.</p>`,
  resetPassword: (link) => `<p>We received a request to reset your Roomy password.</p><p><a href="${link}">Click here to choose a new password</a>. This link expires in 1 hour.</p><p>If you didn't request this, you can safely ignore this email — your password won't change.</p>`
};

module.exports = { sendEmail, templates };
