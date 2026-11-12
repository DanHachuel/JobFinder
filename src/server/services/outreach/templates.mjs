/**
 * JobFinder — message templates.
 *
 * Supports the variables documented in §5.2.1:
 *   {{nome}}      -> profile.firstName (falls back to the full name)
 *   {{empresa}}   -> current company parsed from the headline
 *   {{cargo}}     -> role parsed from the headline
 * Tolerant to spacing: {{ nome }} works too.
 */

export const LINKEDIN_INVITE_LIMIT = 300;
export const SUPPORTED_VARIABLES = ['nome', 'empresa', 'cargo'];

/** Extract the company from a headline like "Tech Recruiter @ Nubank". */
export function headlineToCompany(headline) {
  const text = String(headline ?? '');
  const at = text.match(/@\s*([^|,]+)/);
  if (at) return at[1].trim();
  const em = text.match(/\b(?:na|no|em|at)\s+([A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*)*)/);
  return em ? em[1].trim() : null;
}

/** Extract the role from a headline like "Tech Recruiter | Talent @ Nubank". */
export function headlineToRole(headline) {
  const text = String(headline ?? '');
  const beforePipe = text.split('|')[0];
  const candidate = beforePipe.replace(/@\s*[^|,]+/, '').trim();
  return candidate || null;
}

/** Values used to fill the template for one profile. */
export function templateValues(profile = {}) {
  const fullName = `${profile.firstName ?? ''} ${profile.lastName ?? ''}`.trim();
  return {
    nome: profile.firstName || fullName || 'por aqui',
    empresa: headlineToCompany(profile.headline) ?? 'sua empresa',
    cargo: headlineToRole(profile.headline) ?? 'sua area',
  };
}

/** Render a template with the profile values. Unknown vars stay untouched. */
export function renderTemplate(template, profile) {
  const values = templateValues(profile);
  return String(template ?? '').replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (match, key) => {
    const normalized = key.toLowerCase();
    return SUPPORTED_VARIABLES.includes(normalized) ? values[normalized] : match;
  });
}

/** Preview the message for the UI before sending. */
export function previewMessage(template, profile) {
  return renderTemplate(template, profile);
}

/** Validate + truncate an invitation message (LinkedIn: 300 chars). */
export function sanitizeInvitationMessage(text) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length > LINKEDIN_INVITE_LIMIT) {
    return { text: clean.slice(0, LINKEDIN_INVITE_LIMIT).trimEnd(), truncated: true, limit: LINKEDIN_INVITE_LIMIT };
  }
  return { text: clean, truncated: false, limit: LINKEDIN_INVITE_LIMIT };
}
