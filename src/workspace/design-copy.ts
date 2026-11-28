import type {Locale} from './types';
const copy={
  en:{choices:'Your choices',optional:'Optional assistance',skip:'Skip to main content',staff:'Staff workspace'},
  hi:{choices:'आपके विकल्प',optional:'वैकल्पिक सहायता',skip:'मुख्य सामग्री पर जाएँ',staff:'कर्मचारी कार्यक्षेत्र'},
  kn:{choices:'ನಿಮ್ಮ ಆಯ್ಕೆಗಳು',optional:'ಐಚ್ಛಿಕ ಸಹಾಯ',skip:'ಮುಖ್ಯ ವಿಷಯಕ್ಕೆ ಹೋಗಿ',staff:'ಸಿಬ್ಬಂದಿ ಕಾರ್ಯಕ್ಷೇತ್ರ'},
};
export const designCopy=(language:Locale)=>copy[language];
