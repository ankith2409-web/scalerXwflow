import { useEffect, useRef, useState } from 'react';

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, cache: 'no-store', signal: init.signal ?? AbortSignal.timeout(18_000) });
  if (!response.ok) throw new Error(String(response.status));
  return response.json() as Promise<T>;
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
    const voices = window.speechSynthesis.getVoices().filter((item) => item.localService);
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

export function useRecorder() {
  const [state, setState] = useState<'idle' | 'opening' | 'recording' | 'processing'>('idle');
  const current = useRef<Capture | null>(null);
  const generation = useRef(0);
  const upload = useRef<AbortController | null>(null);
  useEffect(() => () => {
    generation.current++;
    upload.current?.abort();
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
    const recorder = current.current?.recorder;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }
  return { state, start, stop };
}
