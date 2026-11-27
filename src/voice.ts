import { useEffect, useRef, useState } from 'react';
import type { Language } from './copy';

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const send = async () => {
    const timeout = AbortSignal.timeout(path.endsWith('/extract') ? 30_000 : 20_000);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    const response = await fetch(path, { ...init, cache: 'no-store', signal });
    if (!response.ok) throw new Error(String(response.status));
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

export function usePlayback(language: 'en' | 'hi') {
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

type Capture = { recorder: MediaRecorder; stream: MediaStream; timer?: number };
type Recognition = {
  lang: string; interimResults: boolean; maxAlternatives: number;
  onstart: (() => void) | null; onend: (() => void) | null;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start: () => void; stop: () => void; abort: () => void;
};
type VoiceWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
const recognizer = () => (window as VoiceWindow).SpeechRecognition ?? (window as VoiceWindow).webkitSpeechRecognition;
export const browserVoiceAvailable = () => Boolean(window.isSecureContext && recognizer());

export function useRecorder(language: Language, provider: 'sarvam' | 'browser') {
  const [state, setState] = useState<'idle' | 'opening' | 'recording' | 'processing'>('idle');
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (state !== 'recording') { setElapsed(0); return; }
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.min(25, Math.floor((Date.now() - started) / 1000))), 250);
    return () => window.clearInterval(timer);
  }, [state]);
  const current = useRef<Capture | null>(null);
  const browser = useRef<{ recognition: Recognition; timer?: number } | null>(null);
  const generation = useRef(0);
  const upload = useRef<AbortController | null>(null);
  useEffect(() => () => {
    generation.current++;
    upload.current?.abort();
    if (browser.current) {
      window.clearTimeout(browser.current.timer);
      browser.current.recognition.abort();
      browser.current = null;
    }
    const capture = current.current;
    if (capture) {
      window.clearTimeout(capture.timer);
      capture.recorder.onstop = null;
      if (capture.recorder.state !== 'inactive') capture.recorder.stop();
      capture.stream.getTracks().forEach((track) => track.stop());
    }
  }, []);

  async function start(id: string, callbacks: { answer: (text: string) => void; micError: () => void; voiceError: () => void }) {
    setState('opening');
    const run = ++generation.current;
    if (provider === 'browser') {
      try {
        const RecognitionClass = recognizer();
        if (!RecognitionClass) throw new Error();
        const recognition = new RecognitionClass();
        recognition.lang = language + '-IN';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        let received = false;
        const capture = { recognition, timer: window.setTimeout(() => recognition.stop(), 25_000) };
        browser.current = capture;
        recognition.onstart = () => { if (generation.current === run) setState('recording'); };
        recognition.onresult = ({ results }) => {
          if (generation.current !== run) return;
          const text = Array.from(results, (result) => result[0]?.transcript ?? '').join(' ').trim().slice(0, 500);
          if (text) { received = true; callbacks.answer(text); }
        };
        recognition.onerror = ({ error }) => {
          if (generation.current !== run) return;
          received = true;
          if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(error)) callbacks.micError();
          else callbacks.voiceError();
        };
        recognition.onend = () => {
          window.clearTimeout(capture.timer);
          if (browser.current === capture) browser.current = null;
          if (generation.current !== run) return;
          if (!received) callbacks.voiceError();
          setState('idle');
        };
        recognition.start();
      } catch {
        window.clearTimeout(browser.current?.timer);
        browser.current = null;
        callbacks.micError();
        setState('idle');
      }
      return;
    }
    let stream: MediaStream | undefined;
    try {
      const types = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'];
      const mimeType = types.find((type) => window.MediaRecorder?.isTypeSupported(type));
      if (!mimeType || !navigator.mediaDevices) throw new Error();
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 }, video: false });
      if (generation.current !== run) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32_000 });
      const capture: Capture = { recorder, stream };
      const chunks: Blob[] = [];
      recorder.ondataavailable = ({ data }) => { if (data.size) chunks.push(data); };
      recorder.onerror = () => { if (recorder.state !== 'inactive') recorder.stop(); };
      recorder.onstop = async () => {
        window.clearTimeout(capture.timer);
        capture.stream.getTracks().forEach((track) => track.stop());
        current.current = null;
        if (generation.current !== run) return;
        setState('processing');
        const abort = new AbortController();
        upload.current = abort;
        try {
          const contentType = recorder.mimeType.split(';')[0];
          const clip = new Blob(chunks, { type: contentType });
          if (!clip.size) throw new Error();
          const { transcript } = await request<{ transcript: string }>('/api/intakes/' + id + '/turns', {
            method: 'POST', body: clip, signal: abort.signal, headers: { 'Content-Type': contentType },
          });
          if (generation.current === run) callbacks.answer(transcript);
        } catch {
          if (generation.current === run) callbacks.voiceError();
        } finally {
          if (generation.current === run) setState('idle');
          if (upload.current === abort) upload.current = null;
        }
      };
      recorder.start();
      current.current = capture;
      capture.timer = window.setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, 25_000);
      setState('recording');
    } catch {
      stream?.getTracks().forEach((track) => track.stop());
      if (generation.current === run) {
        setState('idle');
        callbacks.micError();
      }
    }
  }
  function stop() {
    if (browser.current) {
      setState('processing');
      browser.current.recognition.stop();
    }
    const recorder = current.current?.recorder;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }
  return { state, start, stop, elapsed };
}
