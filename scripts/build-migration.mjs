import {readFile,writeFile,mkdir} from 'node:fs/promises';
const schema=await readFile(new URL('../database/workecho.sql',import.meta.url),'utf8');
const functions=schema.slice(schema.indexOf('create function public.we_record')).replaceAll('create function public.','create or replace function public.');
const additions=schema.slice(schema.indexOf('create table public.we_sources'),schema.indexOf('create function public.we_record'));
const sql='-- Additive WorkEcho quality migration. No worker histories are removed.\n'
+'alter table public.we_intakes drop constraint if exists we_intakes_language_check;\n'
+"alter table public.we_intakes add constraint we_intakes_language_check check(language in ('en','hi','kn'));\n"
+additions.replaceAll('create table public.','create table if not exists public.').replaceAll('create index ','create index if not exists ')
+functions;
await mkdir(new URL('../database/migrations/',import.meta.url),{recursive:true});
await writeFile(new URL('../database/migrations/002-workflow-quality.sql',import.meta.url),sql);
console.log('Generated additive workflow migration ('+sql.length+' characters).');
