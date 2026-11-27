-- Feature metadata is separate from the worker's original account and confirmed fields.
create table if not exists public.we_feature_items (
  id text primary key, kind text not null check(kind in ('workplace','details','link','case','attachment')),
  history_id uuid references public.we_histories(id) on delete cascade,
  data jsonb not null, version integer not null, actor text not null, updated_at timestamptz not null default now(),
  check((kind='workplace')=(history_id is null))
);
create index if not exists we_feature_history on public.we_feature_items(history_id,kind);
create table if not exists public.we_sandboxes (
  token_hash text primary key, payload text not null, version integer not null,
  expires timestamptz not null default now()+interval '30 minutes', check(length(payload)<=3200000)
);
alter table public.we_feature_items enable row level security;
alter table public.we_sandboxes enable row level security;
revoke all on public.we_feature_items,public.we_sandboxes from public;

create or replace function public.we_feature_safe(item public.we_feature_items) returns jsonb
language sql stable strict set search_path='' as $$
  select jsonb_build_object('id',item.id,'kind',item.kind,'historyId',item.history_id,'data',item.data-'base64',
    'version',item.version,'actor',item.actor,'updatedAt',item.updated_at);
$$;
create or replace function public.we_feature_api(p_token text,p_input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  s public.we_sessions; st public.we_staff; h public.we_histories; item public.we_feature_items;
  action text:=p_input->>'action'; kind text:=p_input->>'kind'; item_id text:=p_input->>'id';
  staff_view boolean:=coalesce((p_input->>'staff')::boolean,false); v_actor text;
  v_history_id uuid:=(p_input->>'historyId')::uuid; input_data jsonb:=p_input->'data';
  details jsonb; link jsonb; result jsonb; members jsonb; total integer; workplace public.we_feature_items;
begin
  select * into s from public.we_sessions where token_hash=encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex') and expires>now();
  if staff_view then
    select * into st from public.we_staff where id=s.staff_id and active;
    if st.id is null then raise exception '401|Sign in to the staff workspace.'; end if;
    v_actor:=st.email;
  else
    if s.worker_id is null then raise exception '401|Open your work history first.'; end if;
    v_actor:='Worker';
  end if;
  -- Serialize bounded metadata writes, including storage-cap checks and optimistic versions.
  if action not in ('history','workplaces','cases','download','timeline') then perform pg_advisory_xact_lock(73241906); end if;
  if action='timeline' then
    if staff_view then raise exception '403|Worker access is required.'; end if;
    return coalesce((select jsonb_agg(public.we_feature_safe(x) order by x.updated_at,x.id) from public.we_feature_items x join public.we_histories hh on hh.id=x.history_id where hh.worker_id=s.worker_id and x.kind in ('details','link','attachment')),'[]');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'label',email) order by email),'[]') into members from public.we_staff where active;
  if action='workplaces' then
    if not staff_view then raise exception '403|Staff access is required.'; end if;
    select count(*) into total from public.we_feature_items x where x.kind='workplace' and strpos(lower(x.data::text),lower(p_input->>'query'))>0;
    select coalesce(jsonb_agg(public.we_feature_safe(x)),'[]') into result from
      (select * from public.we_feature_items x where x.kind='workplace' and strpos(lower(x.data::text),lower(p_input->>'query'))>0
       order by x.updated_at desc,x.id limit 25 offset (p_input->>'page')::int*25) x;
    return jsonb_build_object('items',result,'total',total,'page',(p_input->>'page')::int,'members',members);
  end if;
  if action='cases' then
    if not staff_view then raise exception '403|Staff access is required.'; end if;
    select count(*) into total from public.we_feature_items x join public.we_histories hh on hh.id=x.history_id
      where x.kind='case' and hh.outreach and strpos(lower((x.data||hh.fields)::text),lower(p_input->>'query'))>0;
    select coalesce(jsonb_agg(public.we_feature_safe(x)||jsonb_build_object('record',public.we_record(hh))),'[]') into result
      from (select x.* from public.we_feature_items x join public.we_histories hh on hh.id=x.history_id
        where x.kind='case' and hh.outreach and strpos(lower((x.data||hh.fields)::text),lower(p_input->>'query'))>0
        order by x.updated_at desc,x.id limit 25 offset (p_input->>'page')::int*25) x join public.we_histories hh on hh.id=x.history_id;
    return jsonb_build_object('items',result,'total',total,'page',(p_input->>'page')::int,'members',members);
  end if;
  if kind='workplace' then
    if not staff_view then raise exception '403|Staff access is required.'; end if;
  else
    select * into h from public.we_histories hh where hh.id=v_history_id and
      (case when staff_view then hh.matching or hh.outreach else hh.worker_id=s.worker_id end) for update;
    if h.id is null then raise exception '404|This history is unavailable.'; end if;
    if p_input ? 'historyVersion' and (p_input->>'historyVersion')::int<>h.version then raise exception '409|The worker changed this history. Refresh it.'; end if;
  end if;
  if action='history' then
    select public.we_feature_safe(x) into details from public.we_feature_items x where x.id=v_history_id||':details';
    if staff_view and details->'data'->'location'->>'shared' is distinct from 'true' then details:=jsonb_set(details,'{data,location}','null'); end if;
    select public.we_feature_safe(x)||jsonb_build_object('workplace',public.we_feature_safe(wp)) into link
      from public.we_feature_items x left join public.we_feature_items wp on wp.id=x.data->>'workplaceId'
      where x.id=v_history_id||':link' and (not staff_view or h.matching);
    return jsonb_build_object('record',public.we_record(h),'details',details,'link',link,
      'case',case when staff_view and h.outreach then (select public.we_feature_safe(x) from public.we_feature_items x where x.id=v_history_id||':case') else null end,
      'attachments',(select coalesce(jsonb_agg(public.we_feature_safe(x) order by x.updated_at),'[]') from public.we_feature_items x
        where x.history_id=h.id and x.kind='attachment' and (not staff_view or x.data->>'shared'='true')),
      'members',case when staff_view then members else '[]'::jsonb end);
  end if;
  select * into item from public.we_feature_items x where x.id=item_id for update;
  if action='save' then
    if kind='details' and staff_view then raise exception '403|Only the worker can change these details.'; end if;
    if kind='link' then
      if not staff_view or not h.matching then raise exception '403|Workplace matching permission is required.'; end if;
      if input_data->>'workplaceId' is not null and not exists(select 1 from public.we_feature_items x where x.id=input_data->>'workplaceId' and x.kind='workplace' and x.data->>'status'='reviewed') then raise exception '409|Choose a reviewed workplace.'; end if;
      select * into workplace from public.we_feature_items x where x.id=input_data->>'workplaceId';
      input_data:=input_data||jsonb_build_object('workplaceVersion',workplace.version,'workplaceSnapshot',case when workplace.id is not null then jsonb_build_object('name',workplace.data->>'name','locality',workplace.data->>'locality') else null end);
    end if;
    if kind='case' then
      if not staff_view or not h.outreach or not exists(select 1 from public.we_staff where id::text=input_data->>'assigneeId' and active) then raise exception '403|Follow-up permission and an active case owner are required.'; end if;
    end if;
    if kind not in ('workplace','details','link','case') then raise exception '400|Invalid feature.'; end if;
    if coalesce(item.version,0)<>(p_input->>'version')::int or (item.id is not null and (item.kind<>kind or item.history_id is distinct from v_history_id)) then raise exception '409|This information changed. Reopen it before saving.'; end if;
    if v_history_id is not null then input_data:=input_data||jsonb_build_object('historyVersion',h.version); end if;
    insert into public.we_feature_items(id,kind,history_id,data,version,actor) values(item_id,kind,v_history_id,input_data,1,v_actor)
      on conflict(id) do update set data=excluded.data,version=we_feature_items.version+1,actor=excluded.actor,updated_at=now();
  elsif action='upload' then
    if staff_view then raise exception '403|Only the worker can attach evidence.'; end if;
    if item.id is not null then
      if item.history_id<>h.id or item.data->>'sha256'<>input_data->>'sha256' then raise exception '409|This attachment action was already used.'; end if;
      return public.we_feature_safe(item);
    end if;
    if (select count(*) from public.we_feature_items x where x.history_id=h.id and x.kind='attachment')>=3 then raise exception '413|Keep up to three attachments per job.'; end if;
    if length(input_data->>'base64')>349528 or (select coalesce(sum(pg_column_size(x.data)),0) from public.we_feature_items x where x.kind='attachment')>67108864 then raise exception '413|Attachment storage is full.'; end if;
    insert into public.we_feature_items(id,kind,history_id,data,version,actor) values(item_id,'attachment',h.id,input_data,1,v_actor);
  else
    if item.id is null or item.kind<>'attachment' or item.history_id<>h.id or (staff_view and item.data->>'shared'<>'true') then raise exception '404|Attachment unavailable.'; end if;
    if action='download' then return public.we_feature_safe(item)||jsonb_build_object('data',item.data); end if;
    if item.version<>(p_input->>'version')::int then raise exception '409|This attachment changed. Refresh it.'; end if;
    if action='remove' then
      if staff_view then raise exception '403|Only the worker can remove evidence.'; end if;
      delete from public.we_feature_items where id=item.id; return jsonb_build_object('removed',true);
    elsif action='attachment' then
      if staff_view then input_data:=input_data||jsonb_build_object('reviewedBy',v_actor,'reviewedAt',now()); end if;
      update public.we_feature_items set data=data||input_data,version=version+1,actor=v_actor,updated_at=now() where id=item.id;
    else raise exception '404|This action is unavailable.'; end if;
  end if;
  select * into item from public.we_feature_items x where x.id=item_id;
  return public.we_feature_safe(item);
end;
$$;
revoke all on function public.we_feature_api(text,jsonb),public.we_feature_safe(public.we_feature_items) from public;

-- Encrypted fictional-demo snapshots, isolated from worker and staff tables. No browser DB access.
create or replace function public.we_sandbox_api(p_action text,p_hash text,p_payload text default '',p_version integer default 0) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare item public.we_sandboxes; total bigint;
begin
  if p_hash !~ '^[a-f0-9]{64}$' then raise exception '400|Invalid sandbox.'; end if;
  perform pg_advisory_xact_lock(73241907);
  delete from public.we_sandboxes where expires<now();
  select * into item from public.we_sandboxes where token_hash=p_hash for update;
  if p_action='read' then return case when item.token_hash is null then 'null'::jsonb else to_jsonb(item)-'token_hash' end; end if;
  if p_action<>'write' or length(p_payload)>3200000 then raise exception '400|Invalid sandbox action.'; end if;
  if coalesce(item.version,0)<>p_version then raise exception '409|This demo changed in another tab. Retry the action.'; end if;
  select coalesce(sum(length(payload)),0) into total from public.we_sandboxes;
  if total+length(p_payload)-coalesce(length(item.payload),0)>67108864 then raise exception '413|The fictional demo is temporarily full.'; end if;
  insert into public.we_sandboxes values(p_hash,p_payload,p_version+1,now()+interval '30 minutes')
    on conflict(token_hash) do update set payload=excluded.payload,version=excluded.version,expires=excluded.expires;
  return jsonb_build_object('version',p_version+1);
end;
$$;
revoke all on function public.we_sandbox_api(text,text,text,integer) from public;
do $$ declare r text; begin
  foreach r in array array['anon','authenticated'] loop
    if exists(select 1 from pg_roles where rolname=r) then
      execute format('revoke all on public.we_feature_items,public.we_sandboxes from %I',r);
      execute format('revoke all on function public.we_feature_api(text,jsonb),public.we_feature_safe(public.we_feature_items),public.we_sandbox_api(text,text,text,integer) from %I',r);
    end if;
  end loop;
end $$;
do $$ begin
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant all on public.we_feature_items,public.we_sandboxes to service_role;
    grant execute on function public.we_feature_api(text,jsonb),public.we_feature_safe(public.we_feature_items),public.we_sandbox_api(text,text,text,integer) to service_role;
  end if;
end $$;
