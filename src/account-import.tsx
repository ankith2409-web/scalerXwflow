import { useRef, useState } from 'react';
import { Check, FileText, Mic, Square } from 'lucide-react';
import { blank, keys, type Entry, type Language } from './copy';
import { jsonPost, request, useRecorder } from './voice';
import { Spinner } from './ui';
import { WisprImport } from './wispr-import';

type Proposal = { fields: Entry; evidence: Entry; method: string };
export function AccountImport({ intake, language, voiceAllowed, provider, onUse, onBack }: {
  intake: string; language: Language; voiceAllowed: boolean; provider: 'sarvam' | 'browser';
  onUse: (fields: Entry, evidence: Entry) => void; onBack: () => void;
}) {
  const hi = language === 'hi';
  const [text, setText] = useState('');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [source, setSource] = useState('own');
  const [confirmed, setConfirmed] = useState(false);
  const recorder = useRecorder(language, provider);
  const fileInput = useRef<HTMLInputElement>(null);
  const active = busy || recorder.state !== 'idle';
  const labels = hi ? ['स्थान', 'काम', 'समय', 'पास की पहचान', 'नाम या उपनाम'] : ['Place', 'Work', 'Time', 'Landmark', 'Name or nickname'];
  async function analyze() {
    setError(''); setBusy(true);
    try {
      setProposal(await request<Proposal>('/api/intakes/' + intake + '/extract', jsonPost({ transcript: text })));
    } catch {
      setError(hi ? 'अभी विवरण नहीं निकाले जा सके। नीचे विवरण खुद भरें। आपका मूल पाठ सुरक्षित है।' : 'Analysis is unavailable. Fill in the details below. Your original text is still here.');
      setProposal({ fields: { ...blank }, evidence: { ...blank }, method: 'manual' });
    } finally { setBusy(false); }
  }
  return <section className="paper account-import" aria-busy={active}>
    <h1>{hi ? 'एक बार में अपना अनुभव बताएं' : 'Tell your story once'}</h1>
    <p className="lede">{hi ? 'एक नौकरी का विवरण बोलें या पाठ लाएं। सहेजने से पहले हर बात जांचें।' : 'Speak about one job or bring in a transcript. Check every detail before saving.'}</p>
    <label className="field-label" htmlFor="source">{hi ? 'पाठ कहां से आया?' : 'Where is this account from?'}</label>
    <select id="source" className="line-input" value={source} disabled={active} onChange={(e) => { setSource(e.target.value); setConfirmed(false); }}>
      <option value="own">{hi ? 'मेरा अपना विवरण' : 'My own account'}</option>
      <option value="wispr">Wispr Flow transcript</option>
      <option value="interview">{hi ? 'अनुमति से लिया गया साक्षात्कार' : 'Interview recorded with permission'}</option>
    </select>
    {source !== 'own' && <p className="muted">{hi ? 'केवल संबंधित कर्मचारी की बात रखें। दूसरे लोगों की निजी जानकारी हटाएं।' : 'Include only this worker’s account. Remove other people’s private details. Export or copy the relevant transcript from Wispr Flow, then paste or upload it here.'}</p>}
    {source === 'wispr' && <WisprImport onImport={(value) => { setText(value); setProposal(null); setConfirmed(false); }} />}
    <label className="field-label" htmlFor="account">{hi ? 'मूल विवरण' : 'Original account'}</label>
    <textarea id="account" className="story-text" maxLength={12000} value={text} disabled={active} onChange={(e) => { setText(e.target.value); setProposal(null); }}
      placeholder={hi ? 'मैं कहां काम करता था, क्या काम था और कब…' : 'Where I worked, what I did, roughly when, nearby landmarks and any name I remember…'} />
    <p className="muted">{text.length.toLocaleString()} / 12,000 · {hi ? 'एक विवरण, एक नौकरी' : 'One worker, one job'}</p>
    <div className="action-row">
      {voiceAllowed && <button className="quiet" type="button" disabled={busy || ['opening', 'processing'].includes(recorder.state)} onClick={() => {
        if (recorder.state === 'recording') recorder.stop();
        else void recorder.start(intake, { answer: (value) => { setText((previous) => (previous ? previous + '\n' : '') + value); setProposal(null); },
          micError: () => setError(hi ? 'माइक्रोफोन की अनुमति जांचें या टाइप करें।' : 'Allow microphone access in your browser, or type your account.'),
          voiceError: () => setError(hi ? 'आवाज साफ नहीं मिली। फिर कोशिश करें या टाइप करें।' : 'Could not transcribe this clip. Your existing text is kept. Try again or type.') });
      }}>{recorder.state === 'recording' ? <Square size={18} /> : <Mic size={18} />}{recorder.state === 'recording' ? (hi ? 'रोकें' : 'Stop recording') : recorder.state === 'processing' ? (hi ? 'लिखा जा रहा है…' : 'Transcribing…') : (hi ? 'छोटा विवरण रिकॉर्ड करें' : 'Record a short account')}</button>}
      <button className="quiet" type="button" disabled={active} onClick={() => fileInput.current?.click()}><FileText size={18} />{hi ? 'पाठ फ़ाइल खोलें' : 'Upload transcript'}</button>
      <input hidden ref={fileInput} type="file" accept=".txt,.md,text/plain,text/markdown" onChange={async (e) => {
        const file = e.target.files?.[0]; if (!file) return;
        if (file.size > 48000) { setError(hi ? 'छोटी पाठ फ़ाइल चुनें।' : 'Choose a text file under 48 KB.'); return; }
        const value = await file.text();
        if (value.length > 12000) { setError(hi ? 'एक नौकरी का विवरण चुनें।' : 'Select the relevant account, up to 12,000 characters.'); return; }
        setText(value); setProposal(null); setError('');
      }} />
    </div>
    {voiceAllowed && <p className="muted">{hi ? 'हर क्लिप अधिकतम 25 सेकंड की है। आप और क्लिप जोड़ सकते हैं।' : 'Each clip lasts up to 25 seconds. Record another to add more.'}</p>}
    <label className="story-consent"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />{hi ? 'यह एक कर्मचारी का विवरण है और मुझे इसका उपयोग करने की अनुमति है।' : 'This account concerns one worker and I have permission to use it.'}</label>
    {error && <p role="alert" className="notice">{error}</p>}
    {!proposal && <button className="primary" disabled={active || !text.trim() || !confirmed} onClick={() => void analyze()}>{busy ? <Spinner /> : <Check size={18} />}{busy ? (hi ? 'विवरण तैयार हो रहा है…' : 'Preparing details…') : (hi ? 'विवरण तैयार करें' : 'Prepare details')}</button>}
    {proposal && <div className="proposal-fields">
      <h2>{hi ? 'जो याद है, वही रखें' : 'Keep only what you remember'}</h2>
      <p className="muted">{proposal.method === 'ai-excerpts' ? (hi ? 'सुझाव आपके मूल शब्दों से हैं। खाली जानकारी नहीं जोड़ी गई है।' : 'Suggestions quote your original account. Missing details stay blank.') : (hi ? 'नीचे अपना विवरण भरें। नाम वाले खंड मिलने पर भरे गए हैं।' : 'Fill in the five details below. Clearly labelled transcript lines are filled when available.')}</p>
      {keys.map((field, i) => <div key={field}><label className="field-label" htmlFor={'proposal-' + field}>{labels[i]}</label>
        <input id={'proposal-' + field} className="line-input" maxLength={500} value={proposal.fields[field] ?? ''} onChange={(e) => setProposal({ ...proposal, fields: { ...proposal.fields, [field]: e.target.value.trim() ? e.target.value : null } })} />
        {proposal.evidence[field] && <blockquote>{proposal.evidence[field]}</blockquote>}
      </div>)}
      <button className="primary" disabled={!Object.values(proposal.fields).some(Boolean)} onClick={() => onUse(proposal.fields, proposal.evidence)}>{hi ? 'जांचने के लिए आगे बढ़ें' : 'Continue to review'}</button>
    </div>}
    <button className="quiet" disabled={active} onClick={onBack}>{hi ? 'एक-एक सवाल का जवाब दें' : 'Answer one question at a time'}</button>
  </section>;
}
