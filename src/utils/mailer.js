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

// Human-readable labels for contact-request statuses (shared by email + in-app copy).
const REQUEST_STATUS_LABEL = {
  received: 'Received',
  in_progress: 'In progress',
  connected: 'Connected',
  closed: 'Closed'
};

// Single source of truth for user-facing wording. Each entry returns { title, message }.
// Email templates below AND in-app notifications (utils/notify.js) both read from here
// so the language a user sees in their inbox matches what they see on the dashboard.
const copy = {
  adApproved: (title) => ({
    title: 'Your listing was approved',
    message: `"${title}" has been approved and is now live.`
  }),
  adRejected: (title, reason) => ({
    title: 'Your listing was not approved',
    message: `"${title}" was rejected. Reason: ${reason || 'Policy violation'}.`
  }),
  adUnavailable: (title) => ({
    title: 'Your listing was marked unavailable',
    message: `"${title}" has been temporarily marked as unavailable by our team and is no longer visible to seekers. Contact support if you believe this is a mistake.`
  }),
  adReactivated: (title) => ({
    title: 'Your listing is live again',
    message: `Good news! "${title}" has been reactivated and is visible to seekers again.`
  }),
  adDeleted: (title) => ({
    title: 'Your listing was removed',
    message: `"${title}" has been permanently removed from the platform by our moderation team. Contact support if you believe this was done in error.`
  }),
  interestReceived: (listing) => ({
    title: 'Someone is interested in your listing',
    message: `Someone showed interest in "${listing}". We'll be in touch to connect you.`
  }),
  requestUpdate: (status, listing) => ({
    title: status === 'received' ? 'We received your request' : `Your request was marked ${REQUEST_STATUS_LABEL[status] || status}`,
    message: listing
      ? `Your request for "${listing}" is now ${REQUEST_STATUS_LABEL[status] || status}.`
      : `Your contact request is now ${REQUEST_STATUS_LABEL[status] || status}.`
  }),
  payoutConfirmed: (amount) => ({
    title: 'Your payout was processed',
    message: `Your payout of GHS ${amount} has been processed.`
  })
};

const wrap = ({ title, message }) => `<p><strong>${title}</strong></p><p>${message}</p>`;

const templates = {
  otp: (otp) => `<p>Your verification code is: <strong>${otp}</strong>. Expires in 10 minutes.</p>`,
  adApproved: (title) => wrap(copy.adApproved(title)),
  adRejected: (title, reason) => wrap(copy.adRejected(title, reason)),
  adUnavailable: (title) => wrap(copy.adUnavailable(title)),
  adReactivated: (title) => wrap(copy.adReactivated(title)),
  adDeleted: (title) => wrap(copy.adDeleted(title)),
  interestReceived: (listing) => wrap(copy.interestReceived(listing)),
  requestUpdate: (status, listing) => wrap(copy.requestUpdate(status, listing)),
  payoutConfirmed: (amount) => wrap(copy.payoutConfirmed(amount)),
  resetPassword: (link) => `<p>We received a request to reset your Roomy password.</p><p><a href="${link}">Click here to choose a new password</a>. This link expires in 1 hour.</p><p>If you didn't request this, you can safely ignore this email — your password won't change.</p>`
};

module.exports = { sendEmail, templates, copy, REQUEST_STATUS_LABEL };
