import { RequestError } from './errors.mjs';

export const accountFields = ['place', 'task', 'period', 'landmark', 'alias'];
export const emptyAccount = () => Object.fromEntries(accountFields.map(key => [key, null]));
export const interfaceLanguages = ['en', 'hi', 'kn'];
// Legacy permissions named OpenAI. A different provider needs a fresh opt-in.
export const hasAIConsent = (allowed, consentProvider, provider) => allowed === true &&
  (consentProvider === undefined ? 'openai' : consentProvider) === provider;

export function readFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestError(400, 'Check the work details.');
  return Object.fromEntries(accountFields.map(key => {
    const text = value[key];
    if (text !== null && (typeof text !== 'string' || !text.trim() || text.length > 500)) throw new RequestError(400, 'An answer is blank or too long.');
    return [key, typeof text === 'string' ? text.trim() : null];
  }));
}

export function readPermissions(value) {
  if (!value || typeof value.matching !== 'boolean' || typeof value.outreach !== 'boolean') throw new RequestError(400, 'Review both sharing choices before saving.');
  return { matching: value.matching, outreach: value.outreach };
}

export function readSource(value) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.text !== 'string' || value.text.length > 12000 ||
      !['wispr-dictation', 'wispr-notetaker', 'typed', 'example'].includes(value.kind)) throw new RequestError(400, 'Check the original account. It must be at most 12,000 characters.');
  const meetingId = value.meetingId ?? null;
  if (meetingId !== null && (typeof meetingId !== 'string' || meetingId.length > 200)) throw new RequestError(400, 'Check the meeting reference.');
  if (value.aiProvider !== undefined && value.aiProvider !== null && !['gemini', 'openai'].includes(value.aiProvider)) throw new RequestError(400, 'Check the AI permission.');
  return { text: value.text, kind: value.kind, meetingId,
    ...(value.aiProvider !== undefined ? { aiProvider: value.aiProvider } : {}),
    aiAllowed: value.aiAllowed === true,
    analysis: ['model', 'rules', 'manual'].includes(value.analysis) ? value.analysis : 'manual',
    language: typeof value.language === 'string' && /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(value.language) ? value.language : null };
}

export function readDraft(value) {
  if (!value || typeof value !== 'object' || !interfaceLanguages.includes(value.language) || !['capture', 'review'].includes(value.page) || !['story', 'guided'].includes(value.mode)) throw new RequestError(400, 'Check the draft.');
  const source = readSource(value.source);
  if (!source) throw new RequestError(400, 'The draft needs an original account.');
  return { language: value.language, page: value.page, mode: value.mode, source,
    fields: readFields(value.fields), evidence: readFields(value.evidence), permissions: readPermissions(value.permissions),
    step: Number.isInteger(value.step) && value.step >= 0 && value.step < 5 ? value.step : 0 };
}

export function validateEvidence(evidence, source) {
  if (source && Object.values(evidence).some(text => text && !source.text.includes(text))) throw new RequestError(400, 'A source excerpt is not present in the original account. Review the details again.');
}
