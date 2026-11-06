/**
 * Hide contact details in chat until both people tap "share contact". Moving to WhatsApp
 * straight away is how scams and harassment usually start, and it takes people beyond
 * report and block. This is a speed bump, not a guarantee: determined people can spell numbers out.
 */
const PATTERNS: RegExp[] = [
  // Messenger and social links (wa.me, t.me, instagram.com …)
  /\b(?:https?:\/\/)?(?:www\.)?(?:wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|t\.me|telegram\.me|instagram\.com|instagr\.am|snapchat\.com|facebook\.com|fb\.com|m\.me)\/\S*/gi,
  // Emails
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
  // UPI IDs like name@okaxis (no dot after @)
  /\b[A-Z0-9._-]{2,}@(?:ok)?[A-Z]{2,}\b/gi,
  // Phone numbers: 10+ digits, allowing spaces, dashes, dots and a leading +91 or 0.
  // Must run before the handle pattern, or "WhatsApp 98123 45670" loses only its first half.
  /(?:\+|\b)\d(?:[\s.\-()]*\d){9,12}\b/g,
  // "insta: some.handle", "ig @handle", "telegram - handle", "snap: handle"
  /\b(?:insta(?:gram)?|ig|telegram|tg|snap(?:chat)?|whatsapp|wa)\b\s*[:\-–]?\s*@?[A-Z0-9._]{3,}/gi,
  // A bare @handle
  /(?:^|\s)@[A-Z0-9._]{3,}/gi,
];

export const MASK = "[contact hidden]";

export function maskContacts(text: string): { text: string; masked: boolean } {
  let out = text;
  for (const re of PATTERNS) {
    out = out.replace(re, (m) => (/^\s/.test(m) ? ` ${MASK}` : MASK));
  }
  return { text: out, masked: out !== text };
}
