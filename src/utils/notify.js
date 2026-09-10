const db = require('./db');
const { copy } = require('./mailer');

// Insert an in-app notification for a user. The copy is looked up from the same
// `copy` map the email templates use, so in-app and email wording never drift.
//   key  — a key of `copy` (e.g. 'adApproved', 'requestUpdate', 'interestReceived')
//   args — positional args for that copy fn (e.g. [title], [status, listing])
//   opts.link — optional dashboard URL to deep-link to
async function notify(userId, key, args = [], opts = {}) {
  if (!userId) return;
  const fn = copy[key];
  if (!fn) { console.error('notify: unknown copy key', key); return; }
  const { title, message } = fn(...args);
  try {
    await db.query(
      'INSERT INTO notifications (user_id, type, title, message, link) VALUES ($1,$2,$3,$4,$5)',
      [userId, key, title, message, opts.link || null]
    );
  } catch (err) {
    // A failed notification must never break the underlying action.
    console.error('NOTIFY INSERT FAILED:', key, '—', err.message);
  }
}

module.exports = { notify };
