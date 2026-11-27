import { createCloudHandler } from './cloud.mjs';
import { RequestError } from './errors.mjs';

export async function createNeonRpc(connectionString=process.env.DATABASE_URL){
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(connectionString);
  return async (action, credential = '', input = {}) => {
    let result;
    try {
      result = await sql.query('select public.we_api($1, $2, $3::jsonb) as value', [action, credential, JSON.stringify(input)],
        { fetchOptions: { signal: AbortSignal.timeout(12000) } });
    } catch (error) {
      const match = /^(\d{3})\|(.+)$/.exec(error.message);
      throw new RequestError(match ? Number(match[1]) : 503, match?.[2] ?? 'The workspace is unavailable. Try again.');
    }
    return result[0].value;
  };
}
export async function createNeonHandler({ connectionString = process.env.DATABASE_URL, origin = process.env.APP_ORIGIN,
  aiKey = process.env.WORKECHO_AI_ENABLED === '1' ? process.env.OPENAI_API_KEY : '', speechKey = process.env.SARVAM_API_KEY } = {}) {
  return createCloudHandler({origin,aiKey,speechKey,rpc:await createNeonRpc(connectionString)});
}
