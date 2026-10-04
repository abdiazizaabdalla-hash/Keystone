import sanitizeHtml from 'sanitize-html';

// Sanitizes an inbound email's raw HTML body before it's ever sent to a
// browser. This matters more than a typical "escape user input" pass:
// the inbound address (see src/app/api/email/inbound/route.ts) is an
// open, unauthenticated catch-all -- anyone who sees or guesses
// deal-<token>@<domain> can send it mail, so the HTML being sanitized
// here is fully attacker-controlled, not just untrusted-but-known.
//
// Two deliberate choices beyond sanitize-html's own defaults (which
// already strip <script>/<style>/<iframe> tags and on* handlers):
//   1. No "color"/"background*" style property survives, on any tag.
//      Emails routinely hardcode black-on-white text via inline style --
//      left alone that renders as black-on-near-black in this app's
//      dark theme. allowedStyles below only lists layout-ish properties,
//      so color/background are silently dropped, not merely escaped --
//      every email ends up inheriting .email-body's own color
//      (globals.css) and stays readable regardless of what the
//      original message set.
//   2. No "data:" scheme anywhere. Closes the (rare) data-URI exploit
//      surface and the far more common case of a signature image
//      rendering as base64 noise -- a normal http(s) image still loads.
const SAFE_VALUE = /^[\w\s.,%#()-]*$/;

const ALLOWED_STYLES = {
  '*': {
    'font-weight': [SAFE_VALUE],
    'font-style': [SAFE_VALUE],
    'text-align': [SAFE_VALUE],
    'text-decoration': [SAFE_VALUE],
    padding: [SAFE_VALUE],
    'padding-top': [SAFE_VALUE],
    'padding-right': [SAFE_VALUE],
    'padding-bottom': [SAFE_VALUE],
    'padding-left': [SAFE_VALUE],
    margin: [SAFE_VALUE],
    'margin-top': [SAFE_VALUE],
    'margin-right': [SAFE_VALUE],
    'margin-bottom': [SAFE_VALUE],
    'margin-left': [SAFE_VALUE],
    'border-collapse': [SAFE_VALUE],
    width: [SAFE_VALUE],
    'max-width': [SAFE_VALUE],
  },
};

export function sanitizeEmailHtml(rawHtml: string): string {
  return sanitizeHtml(rawHtml, {
    allowedTags: [
      'p', 'br', 'div', 'span', 'a', 'b', 'strong', 'i', 'em', 'u', 's',
      'ul', 'ol', 'li', 'blockquote', 'hr',
      'table', 'thead', 'tbody', 'tr', 'td', 'th',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img', 'pre', 'code',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'style', 'target', 'rel'],
      img: ['src', 'alt', 'width', 'height', 'style'],
      td: ['colspan', 'rowspan', 'style'],
      th: ['colspan', 'rowspan', 'style'],
      '*': ['style'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https'] },
    allowedStyles: ALLOWED_STYLES,
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }),
    },
  });
}
