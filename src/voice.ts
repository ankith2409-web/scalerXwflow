import { useEffect, useState } from 'react';

export class ApiError extends Error {
  constructor(public status: number, public detail: string) { super(String(status)); }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (new URLSearchParams(location.search).get('demo') === '1' && path.startsWith('/api/')) path = '/api/demo/' + path.slice(5);
  const send = async () => {
    const timeout = AbortSignal.timeout(/\/(extract|translate)$/.test(path) ? 30_000 : 20_000);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    const response = await fetch(path, { ...init, cache: 'no-store', signal });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({})) as { error?: string };
      throw new ApiError(response.status, detail.error ?? 'The action could not be completed.');
    }
    return response.json() as Promise<T>;
  };
  // Serialize mutations across tabs, including isolated demo cookie updates.
  if (location.protocol === 'https:' && init.method && init.method !== 'GET' && navigator.locks) {
    return navigator.locks.request('workecho-session-write', send);
  }
  return send();
}

export const jsonPost = (value: unknown): RequestInit => ({
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
});

export function usePlayback(language: 'en' | 'hi' | 'kn') {
  const [playing, setPlaying] = useState(false);
  useEffect(() => () => window.speechSynthesis?.cancel(), []);
  function stop() {
    window.speechSynthesis?.cancel();
    setPlaying(false);
  }
  function speak(text: string, onError: () => void) {
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return onError();
    stop();
    const utterance = new SpeechSynthesisUtterance(text);
    const available = window.speechSynthesis.getVoices();
    const voices = available.filter((item) => item.localService);
    const voice = voices.find((item) => item.lang.toLowerCase() === language + '-in')
      ?? voices.find((item) => item.lang.toLowerCase().startsWith(language));
    if (!voice) return onError();
    utterance.voice = voice;
    utterance.lang = language + '-IN';
    utterance.rate = 0.9;
    utterance.onend = () => setPlaying(false);
    utterance.onerror = ({ error }) => {
      setPlaying(false);
      if (error !== 'canceled' && error !== 'interrupted') onError();
    };
    setPlaying(true);
    window.speechSynthesis.speak(utterance);
  }
  return { playing, stop, speak };
}

