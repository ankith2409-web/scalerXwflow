// Opt-in live-provider evaluation. Uses typed, fictional fixtures, never worker records.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {extractAccount} from '../server/intelligence.mjs';
const cases=JSON.parse(await readFile(new URL('../tests/fixtures/extraction-cases.json',import.meta.url),'utf8'));
const key=process.env.GEMINI_API_KEY;if(!key)throw new Error('Set GEMINI_API_KEY in the server environment. Never put a key in arguments.');
const model=process.env.GEMINI_MODEL||'gemini-3.5-flash-lite';const results=[];
for(const item of cases){
  const rules=await extractAccount(item.text,{key:''});
  const ai=await extractAccount(item.text,{key,provider:'gemini',model});
  results.push({id:item.id,language:item.language,expected:item.expected,rules:rules.fields,ai:ai.fields,method:ai.method,reason:ai.reason});
  await new Promise(resolve=>setTimeout(resolve,7500));
}
await mkdir('.data',{recursive:true});await writeFile('.data/extraction-evaluation.json',JSON.stringify({timestamp:new Date().toISOString(),model,input:'typed fictional fixtures',results},null,2));
console.log(JSON.stringify({cases:results.length,model,liveModelResponses:results.filter(x=>x.method==='model').length,output:'.data/extraction-evaluation.json'}));
