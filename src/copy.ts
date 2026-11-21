export const keys = ['place', 'task', 'period', 'landmark', 'alias'] as const;
export type Field = typeof keys[number];
export type Language = 'en' | 'hi';
export type Entry = Record<Field, string | null>;
export type SavedEntry = { id: string; fields: Entry; evidence: Entry; confirmedAt: string; version: number };
export const blank: Entry = { place: null, task: null, period: null, landmark: null, alias: null };

export const copy = {
  en: {
    permissions: 'Choose what you share', matchConsent: 'Allow demo staff to compare this fictional history.',
    outreachConsent: 'Allow simulated follow-up for this history.', privacyTitle: 'Your choices stay with the record',
    privacy: 'Your history stays in this demo session. Demo staff see it only if you allow comparison. No real messages are sent.',
    how: 'Hear how it works', staff: 'Staff workspace', said: 'What you said', proposed: 'Proposed record',
    confirmed: 'Confirmed by you', correct: 'Correct this entry', export: 'Export history',
    exportWarning: 'A copy will stay on this device after you sign out. Only download on a device you trust.',
    download: 'Download text summary', cancel: 'Cancel', stale: 'This history changed. Open the current entry before editing it.',
    changed: 'Updated. Check this detail before saving.',
    home: 'Your work history', intro: 'Tell us where you worked, what you did, and roughly when. You can check every answer before you save it.',
    fictional: 'Demo only. Use fictional work details.', language: 'Language', savingConsent: 'I agree to save this fictional work history for this demo session.',
    voiceConsent: 'Send my recorded answers to Sarvam for transcription.', noVoice: 'Recording is unavailable here. You can type or try a fictional answer.',
    start: 'Start a work history', history: 'Saved histories', leave: 'Exit', signOut: 'Finish and sign out',
    signOutDetail: 'Signing out clears the demo records for this session.', back: 'Back', demo: 'Try a fictional answer',
    replay: 'Hear the question', readBack: 'Hear this entry', stopPlayback: 'Stop playback', record: 'Record answer', stop: 'Stop recording', processing: 'Transcribing your answer…',
    transcript: 'What we heard', sample: 'Fictional example', typeInstead: 'Type instead', next: 'Continue', skip: 'I don’t remember', answer: 'Your answer',
    check: 'Is this entry right?', checkHelp: 'Check each detail. Change anything we got wrong before you save.', change: 'Change', done: 'Done',
    missing: 'Not remembered', save: 'Confirm and save', retrySave: 'Retry this save', savePending: 'Saving…',
    saved: 'Your work history is saved', savedHelp: 'You can open it again during this demo session.', add: 'Add another job', empty: 'No work histories saved yet.',
    loading: 'Loading…', unavailable: 'We couldn’t complete that action. Try again.', voiceError: 'We couldn’t get a clear answer. Try again or type just this detail.',
    micError: 'We couldn’t access the microphone. Check your browser settings or type your answer.',
    speechError: 'A voice for this language is unavailable. You can read the question on screen.',
    assist: 'You can ask someone you trust to help you type.', job: 'Work history', new: 'New work history',
    field: {
      place: ['Place', 'Where did you work?', 'Village, town or district', 'Near Jaipur, Rajasthan'],
      task: ['Work', 'What did you do there?', 'The work you remember doing', 'I cut stone slabs'],
      period: ['Time', 'Roughly when did you work there?', 'A season or an event is fine', 'Before lockdown, for two monsoons'],
      landmark: ['Landmark', 'Was there a landmark nearby?', 'A crossing, road or building', 'Behind the railway crossing'],
      alias: ['Name or nickname', 'What did people call the place or contractor?', 'Any name you remember', 'Raju’s stone shed'],
    },
  },
  hi: {
    permissions: 'तय करें कि क्या साझा करना है', matchConsent: 'इस काल्पनिक रिकॉर्ड की तुलना करने की अनुमति दें।',
    outreachConsent: 'इस रिकॉर्ड के लिए संपर्क का अभ्यास करने की अनुमति दें।', privacyTitle: 'आपकी पसंद रिकॉर्ड के साथ रहती है',
    privacy: 'आपका रिकॉर्ड इस डेमो सत्र में रहता है। आपकी अनुमति पर ही डेमो कर्मचारी तुलना कर सकते हैं। कोई असली संदेश नहीं भेजा जाता।',
    how: 'सुनें कि यह कैसे काम करता है', staff: 'कर्मचारी कार्यक्षेत्र', said: 'आपने क्या कहा', proposed: 'प्रस्तावित रिकॉर्ड',
    confirmed: 'आपने पुष्टि की', correct: 'इस रिकॉर्ड को सुधारें', export: 'रिकॉर्ड डाउनलोड करें',
    exportWarning: 'बाहर निकलने के बाद भी इस डिवाइस पर एक कॉपी रहेगी। अपने भरोसे के डिवाइस पर ही डाउनलोड करें।',
    download: 'सारांश डाउनलोड करें', cancel: 'रद्द करें', stale: 'रिकॉर्ड बदल गया है। सुधारने से पहले नया रिकॉर्ड खोलें।',
    changed: 'बदलाव हुआ। सहेजने से पहले इसकी जाँच करें।',
    home: 'आपके काम का रिकॉर्ड', intro: 'बताइए आपने कहाँ, क्या और लगभग कब काम किया। सहेजने से पहले हर जवाब जाँच सकते हैं।',
    fictional: 'यह डेमो है। केवल काल्पनिक जानकारी दें।', language: 'भाषा', savingConsent: 'मैं इस डेमो सत्र में काल्पनिक काम का रिकॉर्ड सहेजने के लिए सहमत हूँ।',
    voiceConsent: 'मेरे बोले हुए जवाब लिखने के लिए Sarvam को भेजें।', noVoice: 'यहाँ रिकॉर्डिंग उपलब्ध नहीं है। जवाब लिखें या काल्पनिक उदाहरण आज़माएँ।',
    start: 'काम का रिकॉर्ड शुरू करें', history: 'सहेजे गए रिकॉर्ड', leave: 'बाहर निकलें', signOut: 'समाप्त करें और बाहर निकलें',
    signOutDetail: 'बाहर निकलने पर इस डेमो सत्र के रिकॉर्ड मिट जाएँगे।', back: 'वापस', demo: 'काल्पनिक जवाब आज़माएँ',
    replay: 'सवाल सुनें', readBack: 'यह रिकॉर्ड सुनें', stopPlayback: 'सुनना रोकें', record: 'जवाब रिकॉर्ड करें', stop: 'रिकॉर्डिंग रोकें', processing: 'जवाब लिखा जा रहा है…',
    transcript: 'हमें यह सुनाई दिया', sample: 'काल्पनिक उदाहरण', typeInstead: 'जवाब लिखें', next: 'आगे बढ़ें', skip: 'मुझे याद नहीं', answer: 'आपका जवाब',
    check: 'क्या यह रिकॉर्ड सही है?', checkHelp: 'हर जानकारी जाँचें और सहेजने से पहले गलतियाँ सुधारें।', change: 'बदलें', done: 'हो गया',
    missing: 'याद नहीं', save: 'पुष्टि करें और सहेजें', retrySave: 'फिर से सहेजें', savePending: 'सहेजा जा रहा है…',
    saved: 'आपका रिकॉर्ड सहेज लिया गया है', savedHelp: 'इस डेमो सत्र में आप इसे फिर खोल सकते हैं।', add: 'एक और काम जोड़ें', empty: 'अभी कोई रिकॉर्ड सहेजा नहीं गया है।',
    loading: 'लोड हो रहा है…', unavailable: 'यह काम पूरा नहीं हुआ। फिर से कोशिश करें।', voiceError: 'जवाब साफ़ नहीं मिला। सिर्फ़ यह जानकारी दोबारा बोलें या लिखें।',
    micError: 'माइक्रोफ़ोन उपलब्ध नहीं है। ब्राउज़र की अनुमति जाँचें या जवाब लिखें।',
    speechError: 'इस भाषा की आवाज़ उपलब्ध नहीं है। सवाल स्क्रीन पर पढ़ सकते हैं।',
    assist: 'जवाब लिखने में किसी भरोसेमंद व्यक्ति की मदद ले सकते हैं।', job: 'काम का रिकॉर्ड', new: 'नया रिकॉर्ड',
    field: {
      place: ['जगह', 'आपने कहाँ काम किया?', 'गाँव, शहर या ज़िला', 'जयपुर के पास, राजस्थान'],
      task: ['काम', 'आप वहाँ क्या काम करते थे?', 'जो काम याद है', 'मैं पत्थर की स्लैब काटता था'],
      period: ['समय', 'आपने वहाँ लगभग कब काम किया?', 'मौसम या कोई घटना भी बता सकते हैं', 'लॉकडाउन से पहले, दो बरसात तक'],
      landmark: ['पास की पहचान', 'पास में पहचानने लायक क्या था?', 'फाटक, सड़क या इमारत', 'रेलवे फाटक के पीछे'],
      alias: ['नाम या उपनाम', 'लोग उस जगह या ठेकेदार को क्या कहते थे?', 'जो नाम याद है', 'राजू का पत्थर का शेड'],
    },
  },
};

export type Labels = typeof copy[Language];
