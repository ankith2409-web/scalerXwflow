// Curated aliases only. No fuzzy place-name merge or inferred employment dates.
const digits=value=>value.replace(/[०-९೦-೯]/gu,c=>String((c.codePointAt(0)>=0xce6?c.codePointAt(0)-0xce6:c.codePointAt(0)-0x966)));
const normalize=value=>digits((value??'').normalize('NFKC').toLocaleLowerCase()).replace(/[’']/gu,'').replace(/\s+/gu,' ').trim();
const cities=[['jodhpur','जोधपुर','ಜೋಧಪುರ'],['jaipur','जयपुर','ಜೈಪುರ'],['bengaluru','bangalore','बेंगलुरु','बैंगलोर','ಬೆಂಗಳೂರು'],['mysuru','mysore','मैसूर','ಮೈಸೂರು'],['tumakuru','tumkur','तुमकुर','ತುಮಕೂರು']];
const regions=[['karnataka','कर्नाटक','ಕರ್ನಾಟಕ'],['rajasthan','राजस्थान','ರಾಜಸ್ಥಾನ']];
function includesWord(text,word){return /^[a-z]+$/u.test(word)?new RegExp('(?:^|[^a-z])'+word+'(?=$|[^a-z])','u').test(text):text.split(/[,;|]/u).some(part=>part.trim()===word)||text.includes(word);}
function place(value){
  const text=normalize(value),primary=text.split(/[,;|]/u)[0].trim();
  const found=cities.filter(group=>group.some(word=>includesWord(text,word)));
  return {ambiguous:found.length>1,name:found.length===1?found[0][0]:primary,
    region:regions.find(group=>group.some(word=>includesWord(text,word)))?.[0]??text.split(/[,;|]/u).slice(1).join(',').trim()};
}
function landmark(value){const text=normalize(value).replace(/^(?:behind|beside|near|opposite|by)\s+(?:the\s+)?/u,'');
  if(/(?:railway|rail) crossing|रेलवे (?:क्रॉसिंग|फाटक)|रेल फाटक|ರೈಲ್ವೆ ಕ್ರಾಸಿಂಗ್|ರೈಲ್ವೆ ಗೇಟ್/u.test(text))return 'railway crossing';return text;}
function years(value){const match=normalize(value).match(/^((?:19|20)\d{2})(?:\s*[-–—]\s*((?:19|20)\d{2}))?$/u);if(!match)return null;const a=Number(match[1]),b=Number(match[2]??match[1]);return a<=b?[a,b]:null;}
export function compare(left,right){
  const a=left.fields,b=right.fields,aa=place(a.place),bb=place(b.place);
  const regionConflict=Boolean(aa.region&&bb.region&&aa.region!==bb.region);
  const samePlace=Boolean(aa.name&&aa.name===bb.name&&!regionConflict&&!aa.ambiguous&&!bb.ambiguous);
  const conflict=Boolean(aa.name&&bb.name&&!samePlace&&!aa.ambiguous&&!bb.ambiguous);
  const alias=Boolean(normalize(a.alias)&&normalize(a.alias)===normalize(b.alias));
  const sharedLandmark=Boolean(landmark(a.landmark)&&landmark(a.landmark)===landmark(b.landmark));
  const ay=years(a.period),by=years(b.period),overlap=!ay||!by?'unknown':ay[0]<=by[1]&&by[0]<=ay[1]?'overlap':'separate';
  const clues=[];if(samePlace)clues.push('Same locality');if(sharedLandmark)clues.push('Matching landmark phrase');if(alias)clues.push('Shared name or nickname');if(normalize(a.task)&&normalize(a.task)===normalize(b.task))clues.push('Similar task');
  return {clues,overlap,conflict,eligible:samePlace&&(alias||sharedLandmark),show:samePlace&&(alias||sharedLandmark)||conflict&&alias};
}
