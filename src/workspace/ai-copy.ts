import type {Locale} from './types';
const text={
  en:{consent:'Allow {provider} to help organize and translate this text',available:'AI extraction available',basic:'Basic suggestions',limit:'AI usage limit reached. Basic suggestions are shown; check or enter each detail.',demo:'Fictional sandbox · 30-minute session. Use fictional information only. Account connections and real outreach are disabled.'},
  hi:{consent:'इस पाठ को व्यवस्थित करने और अनुवाद में {provider} की मदद लें',available:'AI जानकारी निकालने के लिए उपलब्ध है',basic:'सामान्य सुझाव',limit:'AI की उपयोग सीमा पूरी हुई। सामान्य सुझाव दिखाए गए हैं; हर विवरण जाँचें या भरें।',demo:'काल्पनिक डेमो · 30 मिनट का सत्र। केवल काल्पनिक जानकारी भरें। खाते जोड़ना और असली संपर्क बंद हैं।'},
  kn:{consent:'ಈ ಪಠ್ಯವನ್ನು ಜೋಡಿಸಲು ಮತ್ತು ಅನುವಾದಿಸಲು {provider} ಸಹಾಯಕ್ಕೆ ಅನುಮತಿ ನೀಡಿ',available:'AI ಮಾಹಿತಿ ಸಂಗ್ರಹಣೆ ಲಭ್ಯ',basic:'ಸಾಮಾನ್ಯ ಸಲಹೆಗಳು',limit:'AI ಬಳಕೆಯ ಮಿತಿ ತಲುಪಿದೆ. ಸಾಮಾನ್ಯ ಸಲಹೆಗಳನ್ನು ಪರಿಶೀಲಿಸಿ ಅಥವಾ ವಿವರಗಳನ್ನು ನಮೂದಿಸಿ.',demo:'ಕಾಲ್ಪನಿಕ ಡೆಮೊ · 30 ನಿಮಿಷದ ಅವಧಿ. ಕಾಲ್ಪನಿಕ ಮಾಹಿತಿಯನ್ನು ಮಾತ್ರ ಬಳಸಿ. ಖಾತೆ ಸಂಪರ್ಕ ಮತ್ತು ನಿಜವಾದ ಸಂಪರ್ಕವನ್ನು ನಿಷ್ಕ್ರಿಯಗೊಳಿಸಲಾಗಿದೆ.'},
};
export const aiCopy=(language:Locale)=>text[language];
