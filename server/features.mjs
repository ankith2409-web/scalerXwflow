import { createHash, randomUUID } from 'node:crypto';
import { RequestError } from './errors.mjs';

export const attachmentLimit = 256 * 1024;
const uuid = value => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const fail = message => { throw new RequestError(400, message); };
const text = (value, max = 500) => typeof value === 'string' && value.length <= max ? value.trim() : fail('An answer is missing or too long.');
function year(value) {
  if (value === null || value === '') return null;
  if (!Number.isInteger(value) || value < 1900 || value > new Date().getUTCFullYear()) fail('Use a remembered year between 1900 and this year.');
  return value;
}
export function readLocation(value) {
  if (value === null || value === undefined) return null;
  const { lat, lon, radiusMeters } = value;
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180 || ![100, 500, 1000, 5000, 10000].includes(radiusMeters)) fail('Check the coordinates and approximate area.');
  return { lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5, radiusMeters, label: text(value.label ?? '', 200), shared: value.shared === true };
}
export function readFeature(kind, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('Check the additional details.');
  if (kind === 'details') {
    const startYear = year(data.startYear), endYear = year(data.endYear);
    if (startYear !== null && endYear !== null && endYear < startYear) fail('The end year cannot come before the start year.');
    if (!['unknown', 'approximate', 'year'].includes(data.certainty)) fail('Choose how certain the dates are.');
    if (data.certainty === 'unknown' && (startYear !== null || endYear !== null)) fail('Clear the years or choose an approximate period.');
    if (data.ongoing === true && endYear !== null) fail('Clear the end year for an ongoing job.');
    return { startYear, endYear, certainty: data.certainty, ongoing: data.ongoing === true, location: readLocation(data.location) };
  }
  if (kind === 'workplace') {
    const name = text(data.name, 160), locality = text(data.locality, 200);
    if (!name || !locality) fail('A workplace name and locality are required.');
    if (!Array.isArray(data.aliases) || data.aliases.length > 12) fail('Use up to 12 workplace aliases.');
    const aliases = [...new Set(data.aliases.map(value => text(value, 160)).filter(Boolean))];
    if (!['unreviewed', 'reviewed', 'archived'].includes(data.status)) fail('Choose a directory status.');
    const reason = text(data.reason, 500);
    if (data.status !== 'unreviewed' && reason.length < 5) fail('Record the basis for this directory review.');
    return { name, locality, aliases, status: data.status, reason, location: readLocation(data.location) };
  }
  if (kind === 'link') {
    if (data.workplaceId !== null && !uuid(data.workplaceId)) fail('Choose a workplace from the directory.');
    const reason = text(data.reason, 500); if (reason.length < 5) fail('Record why this workplace link is supported.');
    return { workplaceId: data.workplaceId, reason };
  }
  if (kind === 'case') {
    if (!['open', 'paused', 'closed'].includes(data.status)) fail('Choose a case status.');
    const nextAction = text(data.nextAction, 500), assigneeId = text(data.assigneeId, 100), dueDate = text(data.dueDate ?? '', 10);
    if (!nextAction || !assigneeId) fail('Choose a case owner and record the next action.');
    if(!uuid(assigneeId)&&!['local-staff','demo-staff'].includes(assigneeId))fail('Choose an active staff member.');
    if (dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !Number.isFinite(new Date(dueDate).getTime()) || new Date(dueDate).toISOString().slice(0, 10) !== dueDate)) fail('Choose a valid follow-up date.');
    return { status: data.status, nextAction, assigneeId, dueDate };
  }
  fail('This feature is unavailable.');
}
export function readAttachment(data) {
  if (!data || !uuid(data.operation)) fail('Check the attachment action.');
  const filename = text(data.filename, 120).replace(/[\x00-\x1f\\/]/g, '_');
  if (!filename || typeof data.base64 !== 'string' || data.base64.length > Math.ceil(attachmentLimit / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data.base64)) fail('Choose a JPEG, PNG or PDF of up to 256 KB.');
  const bytes = Buffer.from(data.base64, 'base64');
  const valid = data.mime === 'application/pdf' ? bytes.subarray(0, 5).toString() === '%PDF-'
    : data.mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : data.mime === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!valid || bytes.length < 8 || bytes.length > attachmentLimit) fail('The file content does not match a supported JPEG, PNG or PDF.');
  return { filename, mime: data.mime, base64: bytes.toString('base64'), size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), caption: text(data.caption ?? '', 300), shared: data.shared === true, review: 'unreviewed', reviewReason: '' };
}
export function featureRequest(url, method, body = {}) {
  const path = url.pathname;
  const query = text(url.searchParams.get('q') ?? '', 100), page = Number(url.searchParams.get('page') ?? 0);
  if(path==='/api/features/timeline'&&method==='GET')return {action:'timeline',staff:false,input:{}};
  if (!Number.isSafeInteger(page) || page < 0 || page > 100000) fail('Check the requested page.');
  if (path === '/api/features/workplaces') {
    if (method === 'GET') return { action: 'workplaces', staff: true, input: { query, page } };
    if (method === 'POST') return mutation('workplace', body, null, true);
  }
  if (path === '/api/features/cases' && method === 'GET') return { action: 'cases', staff: true, input: { query, page } };
  const match = /^\/api\/features\/history\/([\w-]+)(?:\/(details|link|case|attachments)(?:\/([\w-]+)(\/content)?)?)?$/.exec(path);
  if (!match || !uuid(match[1])) throw new RequestError(404, 'This feature was not found.');
  const historyId = match[1], kind = match[2], id = match[3], staff = url.searchParams.get('view') === 'staff';
  if (!kind && method === 'GET') return { action: 'history', staff, input: { historyId } };
  if (['details','link','case'].includes(kind) && method === 'PATCH') return mutation(kind, body, historyId, kind !== 'details');
  if (kind === 'attachments') {
    if (!id && method === 'POST') return { action: 'upload', staff: false, input: { historyId, id: body.operation, historyVersion: checkedVersion(body.historyVersion, false), data: readAttachment(body) } };
    if (!uuid(id)) fail('Check the attachment.');
    if (match[4] && method === 'GET') return { action: 'download', staff, input: { historyId, id } };
    if (method === 'DELETE') return { action: 'remove', staff: false, input: { historyId, id, version: checkedVersion(body.version, false) } };
    if (method === 'PATCH') {
      const data = staff ? { review: text(body.review, 20), reviewReason: text(body.reviewReason, 500) } : { shared: body.shared === true, caption: text(body.caption ?? '', 300) };
      if (staff && (!['unreviewed','reviewed','needs-clarification'].includes(data.review) || data.reviewReason.length < 5)) fail('Record an attachment review reason.');
      return { action: 'attachment', staff, input: { historyId, id, version: checkedVersion(body.version, false), data } };
    }
  }
  throw new RequestError(405, 'This action is unavailable.');
}
function checkedVersion(value, zero = true) {
  if (!Number.isSafeInteger(value) || value < (zero ? 0 : 1)) fail('Refresh the current record before saving.');
  return value;
}
function mutation(kind, body, historyId, staff) {
  if (kind === 'workplace' && body.id !== undefined && !uuid(body.id)) fail('Check the workplace.');
  return { action: 'save', staff, input: { kind, historyId, id: kind === 'workplace' ? body.id ?? randomUUID() : historyId + ':' + kind, version: checkedVersion(body.version), ...(historyId ? { historyVersion: checkedVersion(body.historyVersion, false) } : {}), data: readFeature(kind, body.data) } };
}
export function featureDownload(result) {
  return { bytes: Buffer.from(result.data.base64, 'base64'), mime: result.data.mime, filename: result.data.filename };
}
