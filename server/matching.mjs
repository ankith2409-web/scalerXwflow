import { createHash } from 'node:crypto';
import { hasAIConsent } from './account.mjs';
const cache = new Map();
const digest = value => createHash('sha256').update(value).digest('hex');
export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length || !a.every(Number.isFinite) || !b.every(Number.isFinite)) return null;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? Math.max(-1, Math.min(1, dot / Math.sqrt(aa * bb))) : null;
}
// Bounded optional ranking. Permissions and explicit place conflicts remain deterministic.
export async function semanticScores(records, { key = '', model = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small', fetcher = fetch, now = Date.now() } = {}) {
  const scores = new Map();
  if (!key) return scores;
  for (const [id, item] of cache) if (item.expires <= now) cache.delete(id);
  const eligible = records.filter(r => r.matching && hasAIConsent(r.source?.aiAllowed, r.source?.aiProvider, 'openai')).slice(0, 40);
  const items = eligible.map(record => {
    const text = Object.entries(record.fields).map(([field, value]) => field + ': ' + (value ?? '')).join('\n');
    return { record, text, hash: digest(key + model + text) };
  });
  if (items.length < 2) return scores;
  const missing = [...new Map(items.filter(item => !cache.has(item.hash)).map(item => [item.hash, item])).values()];
  try {
    if (missing.length) {
      const response = await fetcher('https://api.openai.com/v1/embeddings', {
        method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000),
        body: JSON.stringify({ model, dimensions: 256, input: missing.map(item => item.text), encoding_format: 'float' }),
      });
      if (!response.ok) return scores;
      const result = await response.json();
      if (!Array.isArray(result.data) || result.data.length !== missing.length) return scores;
      for (let i = 0; i < missing.length; i++) {
        const vector = result.data.find(item => item.index === i)?.embedding;
        if (!Array.isArray(vector) || vector.length !== 256 || !vector.every(Number.isFinite)) return scores;
      }
      for (let i = 0; i < missing.length; i++) cache.set(missing[i].hash, { vector: result.data.find(item => item.index === i).embedding, expires: now + 600000 });
      while (cache.size > 500) cache.delete(cache.keys().next().value);
    }
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j]; if (a.record.worker === b.record.worker) continue;
      const score = cosine(cache.get(a.hash)?.vector, cache.get(b.hash)?.vector);
      if (score !== null) scores.set(a.record.id + ':' + b.record.id, score);
    }
  } catch { /* Model failure must not block staff review. */ }
  return scores;
}
