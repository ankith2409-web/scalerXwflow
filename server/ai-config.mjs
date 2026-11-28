// Keys stay in the server runtime. Gemini never receives an OpenAI credential or vice versa.
export function aiConfig(env=process.env,{demo=false}={}){
  const provider=env.WORKECHO_AI_PROVIDER==='gemini'?'gemini':'openai';
  const enabled=env.WORKECHO_AI_ENABLED==='1'&&(!demo||env.WORKECHO_DEMO_AI_ENABLED==='1');
  return {provider,key:enabled?(provider==='gemini'?env.GEMINI_API_KEY??'':env.OPENAI_API_KEY??''):'',
    model:provider==='gemini'?(env.GEMINI_MODEL||'gemini-3.5-flash-lite'):(env.OPENAI_MODEL||'gpt-4.1-mini')};
}
