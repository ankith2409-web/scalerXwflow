import { RequestError } from './errors.mjs';

export function captureFormat(type, buffer) {
  const prefix = buffer.subarray(0, 4);
  if (type === 'audio/webm' && prefix.equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'webm';
  if (type === 'audio/ogg' && prefix.toString() === 'OggS') return 'ogg';
  if (type === 'audio/mp4' && buffer.subarray(4, 8).toString() === 'ftyp') return 'm4a';
  throw new RequestError(415, 'This recording format is unsupported. Try typing your answer.');
}

export async function transcribe({ key, buffer, type, extension }) {
  const data = new FormData();
  data.set('file', new Blob([buffer], { type }), 'answer.' + extension);
  data.set('model', 'saaras:v4');
  data.set('mode', 'codemix');
  data.set('language_code', 'unknown');

  let response;
  try {
    response = await fetch('https://api.sarvam.ai/speech-to-text', {
      method: 'POST', headers: { 'api-subscription-key': key }, body: data,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new RequestError(503, 'Voice service is unavailable. Try again or type your answer.');
  }

  if (!response.ok) {
    if (response.status === 400 || response.status === 413 || response.status === 422) {
      throw new RequestError(422, 'This clip could not be transcribed. Try a short answer or type it.');
    }
    throw new RequestError(503, 'Voice service is unavailable. Try again or type your answer.');
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw new RequestError(503, 'Voice service is unavailable. Try again or type your answer.');
  }
  const transcript = typeof result?.transcript === 'string' ? result.transcript.trim() : '';
  if (!transcript) throw new RequestError(422, 'No answer was heard. Try just the missing detail.');
  if (transcript.length > 500) throw new RequestError(422, 'Please record a shorter answer.');
  return transcript;
}
