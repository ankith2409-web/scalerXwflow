import {readFile,writeFile} from 'node:fs/promises';
const schema=await readFile(new URL('../database/workecho.sql',import.meta.url),'utf8');
const sql='-- Install maintenance endpoints. Definitions only: this migration does not delete records.\n'+schema.slice(schema.indexOf('create function public.we_record')).replaceAll('create function public.','create or replace function public.');
await writeFile(new URL('../database/migrations/003-privacy-and-search.sql',import.meta.url),sql);console.log('Generated maintenance migration.');
