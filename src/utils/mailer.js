const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

async function sendEmail(to, subject, html) {
  try {
    await transporter.sendMail({ from: `"Hostels Platform" <${process.env.EMAIL_USER}>`, to, subject, html });
  } catch (err) {
    console.error('Email error:', err.message);
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
  payoutConfirmed: (amount) => `<p>Your payout of <strong>GHS ${amount}</strong> has been processed.</p>`
};

module.exports = { sendEmail, templates };
