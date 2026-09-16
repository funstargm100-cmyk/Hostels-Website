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

// Public site origin for building absolute links inside emails. Prefers the
// configured BASE_URL; falls back to the request origin when available so links
// still resolve correctly in local/dev environments.
function siteBase(req) {
  const fromEnv = process.env.BASE_URL && process.env.BASE_URL.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  if (req && req.get) return `${req.protocol}://${req.get('host')}`.replace(/\/+$/, '');
  return 'http://localhost:3000';
}

// Build an absolute URL for a site path.
function link(pathname, req) {
  const base = siteBase(req);
  const p = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${base}${p}`;
}

async function sendEmail(to, subject, html) {
  const tx = getTransporter();
  if (!tx) return false;
  try {
    const info = await tx.sendMail({
      from: `"Rentel" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html,
      // A plain-text fallback improves deliverability and covers clients that
      // refuse HTML (some corporate inboxes). Derived from the HTML below.
      text: htmlToText(html)
    });
    console.log(`Email sent to ${to} (${subject}) — id ${info.messageId}`);
    return true;
  } catch (err) {
    console.error('EMAIL SEND FAILED:', to, '—', err.code || '', err.response || err.message);
    return false;
  }
}

// ─── Plain-text fallback ────────────────────
// Crude but dependency-free HTML→text: strips tags, keeps link hrefs visible,
// and collapses whitespace so the text part reads as a tidy email.
function htmlToText(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h1|h2|h3|tr|table)>/gi, '\n')
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
      const text = label.replace(/<[^>]+>/g, '').trim();
      return text && text !== href ? `${text} (${href})` : href;
    })
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n').map(l => l.trim()).join('\n')
    .trim();
}

// Human-readable labels for rental statuses (shared by email + in-app copy).
const REQUEST_STATUS_LABEL = {
  received: 'Pending',
  in_progress: 'Processing',
  connected: 'Ready to move in',
  closed: 'Completed'
};

// Single source of truth for user-facing wording. Each entry returns { title, message }.
// Email templates below AND in-app notifications (utils/notify.js) both read from here
// so the language a user sees in their inbox matches what they see on the dashboard.
const copy = {
  adApproved: (title) => ({
    title: 'Your room was approved',
    message: `"${title}" has been approved and is now live.`
  }),
  adRejected: (title, reason) => ({
    title: 'Your room was not approved',
    message: `"${title}" was rejected. Reason: ${reason || 'Policy violation'}.`
  }),
  adUnavailable: (title) => ({
    title: 'Your room was marked unavailable',
    message: `"${title}" has been temporarily marked as unavailable by our team and is no longer visible to seekers. Contact support if you believe this is a mistake.`
  }),
  adReactivated: (title) => ({
    title: 'Your room is live again',
    message: `Good news! "${title}" has been reactivated and is visible to seekers again.`
  }),
  adDeleted: (title) => ({
    title: 'Your room was removed',
    message: `"${title}" has been permanently removed from the platform by our moderation team. Contact support if you believe this was done in error.`
  }),
  interestReceived: (listing) => ({
    title: 'Someone wants to rent your room',
    message: `Someone requested to rent "${listing}". We'll be in touch to connect you.`
  }),
  requestCancelled: (listing) => ({
    title: 'A renter cancelled their request',
    message: `A renter withdrew their interest in "${listing}".`
  }),
  requestRemoved: (listing) => ({
    title: 'Your rental request was removed',
    message: `Your rental request for "${listing}" was removed by our team. Contact support if you believe this was a mistake.`
  }),
  requestUpdate: (status, listing) => ({
    title: status === 'received' ? 'We received your rental request' : `Your rental is now ${REQUEST_STATUS_LABEL[status] || status}`,
    message: listing
      ? `Your rental for "${listing}" is now ${REQUEST_STATUS_LABEL[status] || status}.`
      : `Your rental is now ${REQUEST_STATUS_LABEL[status] || status}.`
  }),
  newRoomFromFollowed: (owner, title) => ({
    title: `New room from ${owner}`,
    message: `${owner} posted a new room: "${title}".`
  }),
  payoutConfirmed: (amount) => ({
    title: 'Your payout was processed',
    message: `Your payout of GHS ${amount} has been processed.`
  })
};

// ─── Shared, branded HTML email layout ──────
// One wrapper for every transactional email so the inbox experience is
// consistent: an ink wordmark header, a white content card, a single primary
// call-to-action, and a quiet footer. Table-based and inline-styled for the
// widest client support (Gmail, Outlook, Apple Mail, mobile).
function layout({ heading, preheader = '', body = '', action = null, footnote = '' }) {
  const brand = '#B07D2B';       // Rentel gold
  const ink = '#1C1C1E';
  const muted = '#6B7280';
  const border = '#E7E3D8';
  const pageBg = '#F6F4EE';

  const button = action && action.url
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 6px">
         <tr><td align="center" bgcolor="${brand}" style="border-radius:10px">
           <a href="${action.url}" target="_blank"
              style="display:inline-block;padding:13px 30px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px">
             ${action.label || 'Open Rentel'}
           </a>
         </td></tr>
       </table>`
    : '';

  const fallbackLink = action && action.url
    ? `<p style="margin:14px 0 0;font-size:12px;line-height:1.6;color:${muted};font-family:Arial,Helvetica,sans-serif">
         Button not working? Paste this link into your browser:<br>
         <a href="${action.url}" target="_blank" style="color:${brand};word-break:break-all;text-decoration:none">${action.url}</a>
       </p>`
    : '';

  const footnoteBlock = footnote
    ? `<p style="margin:20px 0 0;font-size:13px;line-height:1.65;color:${muted};font-family:Arial,Helvetica,sans-serif">${footnote}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>Rentel</title>
</head>
<body style="margin:0;padding:0;background:${pageBg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${pageBg}">
${preheader}
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${pageBg};padding:28px 12px">
 <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
      <!-- Header -->
      <tr><td align="center" style="padding:8px 0 22px">
        <span style="font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:800;letter-spacing:-.5px;color:${ink}">Rentel<span style="color:${brand}">.</span></span>
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:${muted};margin-top:4px">Rooms &amp; Hostels</div>
      </td></tr>
      <!-- Card -->
      <tr><td style="background:#ffffff;border:1px solid ${border};border-radius:16px;padding:34px 32px">
        <h1 style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:20px;line-height:1.35;font-weight:700;color:${ink}">${heading}</h1>
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:#33383f">
          ${body}
        </div>
        ${button}
        ${fallbackLink}
        ${footnoteBlock}
      </td></tr>
      <!-- Footer -->
      <tr><td align="center" style="padding:22px 8px 8px">
        <p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:${muted}">
          You're receiving this email because you have a Rentel account.
        </p>
        <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:${muted}">
          &copy; ${new Date().getFullYear()} Rentel. All rights reserved. &nbsp;·&nbsp;
          <a href="${link('/about')}" target="_blank" style="color:${brand};text-decoration:none">Help &amp; safety</a>
        </p>
      </td></tr>
    </table>
 </td></tr>
</table>
</body>
</html>`;
}

// ─── Email templates ─────────────────────────
// Each template returns a full, branded HTML email. `ctx` carries optional
// context (listing uuid, request uuid, status, req) used to build a relevant
// deep-link so the reader can act in one tap.
const templates = {
  otp: (otp) => layout({
    heading: 'Verify your email address',
    preheader: `Your Rentel verification code is ${otp}. It expires in 10 minutes.`,
    body: `
      <p style="margin:0 0 6px">Welcome to Rentel — you're one step away from getting started. Use the verification code below to confirm your email address:</p>
      <div style="margin:20px 0;text-align:center">
        <span style="display:inline-block;font-family:'Courier New',monospace;font-size:34px;font-weight:700;letter-spacing:10px;color:#1C1C1E;background:#F6F4EE;border:1px dashed #E7E3D8;border-radius:12px;padding:14px 22px 14px 30px">${otp}</span>
      </div>
      <p style="margin:0">Enter this code on the verification screen to activate your account. For your security, the code expires in <strong>10 minutes</strong>.</p>`,
    footnote: `Didn't create a Rentel account? You can safely ignore this email — no account will be activated without this code.`
  }),

  resetPassword: (resetLink) => layout({
    heading: 'Reset your password',
    preheader: 'Choose a new Rentel password — this link expires in 1 hour.',
    body: `
      <p style="margin:0 0 12px">We received a request to reset the password for your Rentel account. Click the button below to choose a new one. For your security, this link is valid for <strong>1 hour</strong> and can only be used once.</p>`,
    action: { label: 'Choose a new password', url: resetLink },
    footnote: `If you didn't request a password reset, you can safely ignore this email — your password will not change.`
  }),

  adApproved: (title, ctx = {}) => layout({
    heading: 'Your room is now live 🎉',
    preheader: `"${title}" passed review and is visible to seekers.`,
    body: `
      <p style="margin:0 0 12px">Great news — your listing <strong>"${title}"</strong> has been reviewed and approved. It is now live on Rentel and visible to seekers browsing rooms.</p>
      <p style="margin:0">What you can do next:</p>
      <ul style="margin:8px 0 0;padding-left:20px">
        <li style="margin-bottom:6px">Share your listing to reach more seekers.</li>
        <li style="margin-bottom:6px">Keep your price and availability up to date.</li>
        <li>Respond quickly to interest — faster replies convert better.</li>
      </ul>`,
    action: ctx.uuid
      ? { label: 'View your live listing', url: link(`/listing?id=${ctx.uuid}`, ctx.req) }
      : { label: 'Go to your listings', url: link('/dashboard#listings', ctx.req) }
  }),

  adRejected: (title, reason, ctx = {}) => layout({
    heading: 'Your listing needs some changes',
    preheader: `"${title}" was not approved. See the reason and how to fix it.`,
    body: `
      <p style="margin:0 0 12px">Thanks for submitting <strong>"${title}"</strong>. After a review, we were unable to approve it in its current form.</p>
      <div style="margin:0 0 14px;padding:12px 14px;background:#FDF1EF;border:1px solid #F3D3CC;border-radius:10px;color:#8a2b1a">
        <strong>Reason:</strong> ${reason || 'Policy violation'}
      </div>
      <p style="margin:0">You can edit your listing to address this and resubmit — most listings are approved on the next review. If you believe this decision was a mistake, reply to this email and our team will take another look.</p>`,
    action: { label: 'Edit your listing', url: link('/dashboard#listings', ctx.req) }
  }),

  adUnavailable: (title, ctx = {}) => layout({
    heading: 'Your room is temporarily unavailable',
    preheader: `"${title}" has been paused and is hidden from seekers.`,
    body: `
      <p style="margin:0 0 12px">Our team has temporarily marked <strong>"${title}"</strong> as unavailable. While in this state it is hidden from seekers browsing Rentel.</p>
      <p style="margin:0">This is usually a short-term measure while we review a report or confirm details. You don't need to do anything right now — if it was a mistake on our part, reply to this email and we'll restore your listing promptly. You can also reactivate it yourself from your dashboard at any time.</p>`,
    action: { label: 'Manage your listings', url: link('/dashboard#listings', ctx.req) }
  }),

  adReactivated: (title, ctx = {}) => layout({
    heading: 'Your room is live again',
    preheader: `"${title}" is back and visible to seekers.`,
    body: `
      <p style="margin:0 0 12px">Good news — <strong>"${title}"</strong> has been reactivated. It is once again visible to seekers browsing rooms on Rentel, and anyone who follows you will be notified.</p>
      <p style="margin:0">No further action is needed. Keep your photos and details fresh to attract more interest.</p>`,
    action: ctx.uuid
      ? { label: 'View your listing', url: link(`/listing?id=${ctx.uuid}`, ctx.req) }
      : { label: 'Go to your listings', url: link('/dashboard#listings', ctx.req) }
  }),

  adDeleted: (title, ctx = {}) => layout({
    heading: 'Your room has been removed',
    preheader: `"${title}" was permanently removed from Rentel.`,
    body: `
      <p style="margin:0 0 12px">Following a review, <strong>"${title}"</strong> has been permanently removed from the platform by our moderation team, in line with our listing policies.</p>
      <p style="margin:0">If you believe this was done in error, please reply to this email and our team will investigate. If you'd like to list again in future, make sure your listings follow our guidelines — you're welcome to post a new room at any time.</p>`,
    action: { label: 'Post a new room', url: link('/post-ad', ctx.req) }
  }),

  interestReceived: (listing, ctx = {}) => layout({
    heading: 'Someone wants to rent your room',
    preheader: `A renter just requested "${listing}".`,
    body: `
      <p style="margin:0 0 12px">Good news — a renter has requested to rent <strong>"${listing}"</strong>. Their details have been shared with our team, who will connect you shortly.</p>
      <p style="margin:0">To make the most of this lead:</p>
      <ul style="margin:8px 0 0;padding-left:20px">
        <li style="margin-bottom:6px">Reply promptly — renters often contact several rooms at once.</li>
        <li style="margin-bottom:6px">Have your viewing times and key details ready.</li>
        <li>Keep the listing accurate so there are no surprises on the day.</li>
      </ul>`,
    action: { label: 'Open your dashboard', url: link('/dashboard#listings', ctx.req) }
  }),

  requestRemoved: (listing, ctx = {}) => layout({
    heading: 'Your rental request was removed',
    body: `Your rental request for <strong>${listing}</strong> was removed by our team. Contact support if you believe this was a mistake.`,
    ...ctx
  }),

  requestCancelled: (listing, ctx = {}) => layout({
    heading: 'A renter cancelled their request',
    preheader: `A renter withdrew their request for "${listing}".`,
    body: `
      <p style="margin:0 0 12px">A renter who had requested <strong>"${listing}"</strong> has cancelled their request. This is normal in the room-hunting process — renters often pursue several options at once.</p>
      <p style="margin:0">No action is needed from you. Your listing remains live and visible to other renters, so you can expect new interest to come in.</p>`,
    action: { label: 'Go to your listings', url: link('/dashboard#listings', ctx.req) }
  }),

  requestUpdate: (status, listing, ctx = {}) => {
    const label = REQUEST_STATUS_LABEL[status] || status;
    const statusCopy = {
      received: 'We\u2019ve received your rental request and passed it to the room owner. They\u2019ll get back to you with next steps — there\u2019s nothing you need to do right now.',
      in_progress: 'The owner is reviewing your rental request and will be in touch soon. Keep an eye on your email and dashboard for updates.',
      connected: 'You\u2019ve been connected with the room owner and are ready to move in. They should reach out to arrange a viewing or answer your questions — feel free to follow up if you don\u2019t hear back shortly.',
      closed: 'This rental has now been completed. If you\u2019re still looking, you can browse more rooms and request another rental at any time.'
    }[status] || `Your rental is now ${label}.`;
    return layout({
      heading: status === 'received' ? 'We\u2019ve received your rental request' : `Your rental is now ${label}`,
      preheader: listing
        ? `Update on your rental for "${listing}" — now ${label}.`
        : `Your rental is now ${label}.`,
      body: `
        ${listing ? `<p style="margin:0 0 12px;padding:12px 14px;background:#F6F4EE;border:1px solid #E7E3D8;border-radius:10px"><strong>${listing}</strong></p>` : ''}
        <div style="margin:0 0 12px">
          <span style="display:inline-block;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#B07D2B;background:#FBF4E6;border-radius:999px;padding:4px 12px">${label}</span>
        </div>
        <p style="margin:0 0 12px">${statusCopy}</p>
        <p style="margin:0">You can track this rental any time from your dashboard.</p>`,
      action: { label: 'View your rental', url: link('/dashboard#requests', ctx.req) }
    });
  },

  newRoomFromFollowed: (owner, title, ctx = {}) => layout({
    heading: `New room from ${owner}`,
    preheader: `${owner} just posted "${title}" on Rentel.`,
    body: `
      <p style="margin:0 0 12px"><strong>${owner}</strong>, a landlord you follow, has just listed a new room: <strong>"${title}"</strong>.</p>
      <p style="margin:0">You're seeing this early because you follow them — new listings from people you follow often get the most attention in their first days. Take a look before it's gone.</p>`,
    action: ctx.uuid
      ? { label: 'View this room', url: link(`/listing?id=${ctx.uuid}`, ctx.req) }
      : { label: 'Browse rooms', url: link('/listings', ctx.req) }
  }),

  payoutConfirmed: (amount, ctx = {}) => layout({
    heading: 'Your payout has been processed',
    preheader: `A payout of GHS ${amount} has been processed to your account.`,
    body: `
      <p style="margin:0 0 12px">Your withdrawal of <strong>GHS ${amount}</strong> has been processed successfully.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 12px;border:1px solid #E7E3D8;border-radius:10px">
        <tr><td style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#6B7280">Amount</td>
            <td style="padding:14px 16px;text-align:right;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;color:#1C1C1E">GHS ${amount}</td></tr>
        <tr><td style="padding:0 16px 14px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#6B7280">Status</td>
            <td style="padding:0 16px 14px;text-align:right;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#1f7a4d">Processed</td></tr>
      </table>
      <p style="margin:0">Depending on your bank or mobile money provider, funds can take a short while to appear. If it hasn't arrived within a few business days, reply to this email and we'll look into it.</p>`,
    action: { label: 'View your dashboard', url: link('/dashboard', ctx.req) }
  })
};

module.exports = { sendEmail, templates, copy, layout, link, siteBase, REQUEST_STATUS_LABEL };
