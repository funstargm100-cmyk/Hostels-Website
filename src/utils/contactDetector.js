// Detects phone numbers, emails, social handles, and contact-soliciting phrases
const PHONE_REGEX = /(\+?[\d\s\-().]{7,15})/g;
const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/gi;
const SOCIAL_REGEX = /\b(whatsapp|telegram|instagram|facebook|twitter|snapchat|tiktok|wechat|signal)\b/gi;
const HANDLE_REGEX = /@[a-zA-Z0-9_.]{3,}/g;
const CONTACT_PHRASES = /\b(call me|text me|add me|message me|reach me|contact me|dm me|ping me|hit me up|my number|my phone|my email|my whatsapp)\b/gi;

function detectContactInfo(text) {
  if (!text) return { hasViolation: false, matches: [] };
  const matches = [];
  const phones = text.match(PHONE_REGEX) || [];
  const emails = text.match(EMAIL_REGEX) || [];
  const socials = text.match(SOCIAL_REGEX) || [];
  const handles = text.match(HANDLE_REGEX) || [];
  const phrases = text.match(CONTACT_PHRASES) || [];

  if (phones.length) matches.push(...phones.map(m => ({ type: 'phone', value: m.trim() })));
  if (emails.length) matches.push(...emails.map(m => ({ type: 'email', value: m })));
  if (socials.length) matches.push(...socials.map(m => ({ type: 'social', value: m })));
  if (handles.length) matches.push(...handles.map(m => ({ type: 'handle', value: m })));
  if (phrases.length) matches.push(...phrases.map(m => ({ type: 'phrase', value: m })));

  return { hasViolation: matches.length > 0, matches };
}

function validateAdContent(title, description) {
  const titleCheck = detectContactInfo(title);
  const descCheck = detectContactInfo(description);
  const allMatches = [...titleCheck.matches, ...descCheck.matches];
  return {
    isClean: allMatches.length === 0,
    violations: allMatches
  };
}

module.exports = { detectContactInfo, validateAdContent };
