-- Additive feature tables and function definitions; no existing records are changed.
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
      if not staff_view or not h.outreach or not exists(select 1 from public.we_staff where id=(input_data->>'assigneeId')::uuid and active) then raise exception '403|Follow-up permission and an active case owner are required.'; end if;
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

create or replace function public.we_api(p_action text, p_token text default '', p_input jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  s public.we_sessions; h public.we_histories; j public.we_intakes; st public.we_staff; r public.we_referrals; d public.we_drafts;
  w uuid; new_id uuid; result jsonb; old_result public.we_operations; used integer; bucket_no bigint;
  v_token_hash text := encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex');
  fp text := encode(extensions.digest(p_action || p_input::text,'sha256'),'hex');
  v_actor text; next_status text := p_input->>'status'; detail text := p_input->>'reason'; target text := p_input->>'target';
begin
  if p_action='features' then return public.we_feature_api(p_token,p_input); end if;
  if p_action='sandbox' then return public.we_sandbox_api(p_input->>'action',p_input->>'hash',coalesce(p_input->>'payload',''),coalesce((p_input->>'version')::int,0)); end if;
  delete from public.we_sessions where expires < now();
  delete from public.we_limits where
    (key like 'provider:%' and bucket < floor(extract(epoch from now())/1800)-2)
    or (key not like 'provider:%' and key not like 'daily:%' and bucket < floor(extract(epoch from now())/300)-2)
    or (key like 'daily:%' and bucket < floor(extract(epoch from now())/86400)-2);
  select * into s from public.we_sessions where token_hash = v_token_hash and expires > now();
  if s.staff_id is not null then select * into st from public.we_staff where id=s.staff_id and active; end if;
  if p_action='session' then return jsonb_build_object('active',s.worker_id is not null,'workerId',s.worker_id); end if;
  if p_action='staff_session' then return jsonb_build_object('active',st.id is not null,'role',st.role,
    'setup',exists(select 1 from public.we_settings where key='bootstrap_hash') and not exists(select 1 from public.we_staff)); end if;
  if p_action in ('staff_login','restore','new_worker') then
    bucket_no := floor(extract(epoch from now())/300);
    insert into public.we_limits values (p_action || ':' || coalesce(p_input->>'rateKey','global'),bucket_no,1)
      on conflict(key,bucket) do update set uses=we_limits.uses+1 returning uses into used;
    if used > (case when p_action='new_worker' then 30 else 10 end) then return jsonb_build_object('_error',429,'message','Too many attempts. Wait five minutes.'); end if;
  end if;
  if p_action='staff_login' then
    if p_input->>'email' is null or length(p_input->>'password') not between 12 and 72 then return jsonb_build_object('_error',401,'message','Check your email and password.'); end if;
    if not exists(select 1 from public.we_staff) then
      perform 1 from public.we_settings where key='bootstrap_hash' for update;
      if not exists(select 1 from public.we_settings where key='bootstrap_hash' and value=encode(extensions.digest(coalesce(p_input->>'setupCode',''),'sha256'),'hex')) then
        return jsonb_build_object('_error',401,'message','A valid setup code is required.');
      end if;
      insert into public.we_staff(email,password_hash,role) values(lower(p_input->>'email'),extensions.crypt(p_input->>'password',extensions.gen_salt('bf',12)),'admin');
      delete from public.we_settings where key='bootstrap_hash';
    end if;
    select * into st from public.we_staff where email=lower(p_input->>'email') and active;
    if st.id is null or st.password_hash <> extensions.crypt(p_input->>'password',st.password_hash) then return jsonb_build_object('_error',401,'message','Check your email and password.'); end if;
    insert into public.we_sessions(token_hash,staff_id) values(p_input->>'tokenHash',st.id);
    return jsonb_build_object('active',true);
  end if;
  if p_action='new_worker' then
    insert into public.we_workers(recovery_hash) values(p_input->>'recoveryHash') returning id into w;
    insert into public.we_sessions(token_hash,worker_id) values(p_input->>'tokenHash',w);
    return jsonb_build_object('id',w);
  end if;
  if p_action='restore' then
    select id into w from public.we_workers where recovery_hash=p_input->>'recoveryHash';
    if w is null then return jsonb_build_object('_error',401,'message','Recovery code not found.'); end if;
    insert into public.we_sessions(token_hash,worker_id) values(p_input->>'tokenHash',w);
    return jsonb_build_object('active',true);
  end if;
  if p_action='signout' then delete from public.we_sessions where token_hash=v_token_hash; return '{}'; end if;
  if p_action like 'staff_%' then
    if st.id is null then raise exception '401|Sign in to the staff workspace.'; end if;
    v_actor := st.email;
    if p_action='staff_password' then
      select ss.* into st from public.we_staff ss where ss.id=s.staff_id for update;
      bucket_no:=floor(extract(epoch from now())/300);
      insert into public.we_limits values('password:'||st.id,bucket_no,1) on conflict(key,bucket) do update set uses=we_limits.uses+1 returning uses into used;
      if used>10 then return jsonb_build_object('_error',429,'message','Wait five minutes before trying again.'); end if;
      if st.password_hash <> extensions.crypt(coalesce(p_input->>'currentPassword',''),st.password_hash) then return jsonb_build_object('_error',401,'message','Check your current password.'); end if;
      update public.we_staff set password_hash=extensions.crypt(p_input->>'password',extensions.gen_salt('bf',12)) where id=st.id;
      delete from public.we_sessions where staff_id=st.id and token_hash<>v_token_hash;
      insert into public.we_events(target,kind,status,reason,actor) values('staff:'||st.id,'access','password_changed','Password changed; other sessions revoked.',v_actor);
      return jsonb_build_object('changed',true);
    end if;
    if p_action='staff_search' then
      return jsonb_build_object('page',(p_input->>'page')::int,'pageSize',(p_input->>'size')::int,
        'total',(select count(*) from public.we_histories x where (matching or outreach) and
          strpos(lower(concat_ws(' ',fields->>'place',fields->>'task',fields->>'period',fields->>'landmark',fields->>'alias')),lower(p_input->>'query'))>0),
        'records',coalesce((select jsonb_agg(public.we_record(x)||jsonb_build_object('label','Worker '||upper(left(x.worker_id::text,8)),
          'quote',coalesce((select source->>'text' from public.we_sources where history_id=x.id),''),'matching',x.matching,'outreach',x.outreach,
          'referral',exists(select 1 from public.we_referrals rr where rr.history_id=x.id and rr.history_version=x.version))) from
          (select * from public.we_histories where (matching or outreach) and
            strpos(lower(concat_ws(' ',fields->>'place',fields->>'task',fields->>'period',fields->>'landmark',fields->>'alias')),lower(p_input->>'query'))>0
            order by confirmed_at desc,id limit (p_input->>'size')::int offset (p_input->>'page')::int*(p_input->>'size')::int) x),'[]'));
    end if;
    if p_action='staff_add' then
      if st.role <> 'admin' then raise exception '403|Administrator access is required.'; end if;
      if p_input->>'role' not in ('admin','reviewer','health') or length(p_input->>'password') not between 12 and 72 then raise exception '400|Check the account details.'; end if;
      insert into public.we_staff(email,password_hash,role) values(lower(p_input->>'email'),extensions.crypt(p_input->>'password',extensions.gen_salt('bf',12)),p_input->>'role');
      insert into public.we_events(target,kind,status,reason,actor) values('staff:' || lower(p_input->>'email'),'access','created','Staff account created with role ' || (p_input->>'role'),v_actor);
      return jsonb_build_object('created',true);
    end if;
    if p_action='staff_records' then
      return coalesce((select jsonb_agg(public.we_record(x) || jsonb_build_object('worker',x.worker_id,'matching',x.matching,'outreach',x.outreach,
        'label','Worker ' || upper(left(x.worker_id::text,8)), 'quote',coalesce((select source->>'text' from public.we_sources where history_id=x.id),concat_ws(' · ',x.evidence->>'place',x.evidence->>'task',x.evidence->>'period',x.evidence->>'landmark',x.evidence->>'alias'))) order by x.confirmed_at desc)
        from (select * from public.we_histories where matching or outreach order by confirmed_at desc limit 200) x),'[]');
    end if;
    if p_action='staff_decisions' then return coalesce((select jsonb_agg(to_jsonb(x)) from public.we_decisions x),'[]'); end if;
    if p_action='staff_referrals' then
      return coalesce((select jsonb_agg(to_jsonb(x) || jsonb_build_object('outreach',coalesce(hh.outreach,false) and hh.version=x.history_version,
        'label','Worker ' || upper(left(hh.worker_id::text,8)), 'events',(select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]') from public.we_events e where e.target=x.id and e.kind='referral')) order by x.created_at desc)
        from public.we_referrals x join public.we_histories hh on hh.id=x.history_id),'[]');
    end if;
    select * into old_result from public.we_operations where actor=v_actor and operation=(p_input->>'operation')::uuid;
    if found then
      if old_result.fingerprint <> fp then raise exception '409|This action was already used.'; end if;
      return old_result.result;
    end if;
    if p_action='staff_decide' then
      -- Lock both records so withdrawal/revision cannot race a review decision.
      perform 1 from public.we_histories where id in ((p_input->>'left')::uuid,(p_input->>'right')::uuid) order by id for update;
      if (select count(*) from public.we_histories where matching and ((id=(p_input->>'left')::uuid and version=(p_input->>'leftVersion')::int)
        or (id=(p_input->>'right')::uuid and version=(p_input->>'rightVersion')::int))) <> 2 then raise exception '409|These histories changed.'; end if;
      if next_status='accepted' and coalesce((p_input->>'eligible')::boolean,false)=false then raise exception '409|The workplace details conflict.'; end if;
      insert into public.we_decisions values(target,(p_input->>'left')::uuid,(p_input->>'right')::uuid,(p_input->>'leftVersion')::int,(p_input->>'rightVersion')::int,next_status,detail,1)
        on conflict(id) do update set status=excluded.status,reason=excluded.reason,version=we_decisions.version+1 where we_decisions.version=(p_input->>'version')::int;
      if not found or ((p_input->>'version')::int=0 and (select version from public.we_decisions where id=target)<>1) then raise exception '409|This decision changed.'; end if;
      insert into public.we_events(target,kind,status,reason,actor) values(target,'review',next_status,detail,v_actor);
    elsif p_action='staff_transition' then
      select * into h from public.we_histories where id=(p_input->>'history')::uuid for update;
      select * into r from public.we_referrals where id=target for update;
      if h.id is null or not h.outreach or h.version<>(p_input->>'historyVersion')::int then raise exception '404|This history is unavailable for follow-up.'; end if;
      if next_status='draft' then
        if r.id is not null or h.version<>(p_input->>'version')::int then raise exception '409|This referral changed.'; end if;
        insert into public.we_referrals values(target,h.id,h.version,'draft',1,now());
      else
        if r.id is null or r.version<>(p_input->>'version')::int then raise exception '409|This referral changed.'; end if;
        if next_status='approved' and (st.role not in ('health','admin') or (p_input->>'healthApproval')::boolean is distinct from true) then raise exception '403|Health-team approval is required.'; end if;
        if not (case r.status when 'draft' then next_status in ('approved','cancelled') when 'approved' then next_status in ('invited','cancelled')
          when 'invited' then next_status in ('responded','declined','unreachable','cancelled') when 'responded' then next_status in ('scheduled','declined','postponed','cancelled')
          when 'scheduled' then next_status in ('completed','postponed','cancelled') when 'postponed' then next_status in ('scheduled','cancelled')
          when 'unreachable' then next_status in ('invited','cancelled') else false end) then raise exception '409|This transition is unavailable.'; end if;
        update public.we_referrals set status=next_status,version=version+1 where id=target;
      end if;
      insert into public.we_events(target,kind,status,reason,actor) values(target,'referral',next_status,detail,v_actor);
    else raise exception '404|Operation not found.';
    end if;
    result := jsonb_build_object('status',next_status);
    insert into public.we_operations values(v_actor,(p_input->>'operation')::uuid,fp,result);
    return result;
  end if;
  if s.worker_id is null then raise exception '401|Open your work history first.'; end if;
  w := s.worker_id;
  if p_action='draft' then
    select dd.* into d from public.we_drafts dd join public.we_intakes ii on ii.id=dd.intake_id
      where ii.worker_id=w and not exists(select 1 from public.we_histories hh where hh.intake_id=ii.id)
      order by dd.updated_at desc, dd.intake_id limit 1;
    if d.intake_id is null then return 'null'::jsonb; end if;
    return jsonb_build_object('id',d.intake_id,'version',d.version,'data',d.payload,'updatedAt',d.updated_at);
  end if;
  if p_action in ('draft_save','draft_discard') then
    select * into j from public.we_intakes where id=(p_input->>'id')::uuid and worker_id=w for update;
    if j.id is null then raise exception '404|Interview not found.'; end if;
    if p_action='draft_discard' then delete from public.we_drafts where intake_id=j.id; return jsonb_build_object('discarded',true); end if;
    if exists(select 1 from public.we_histories where intake_id=j.id) then raise exception '409|This account has already been confirmed.'; end if;
    select * into d from public.we_drafts where intake_id=j.id;
    if d.operation=(p_input->>'operation')::uuid then
      if d.payload<>p_input->'data' then raise exception '409|This draft action was already used.'; end if;
      return jsonb_build_object('id',d.intake_id,'version',d.version,'data',d.payload,'updatedAt',d.updated_at);
    end if;
    if coalesce(d.version,0)<>(p_input->>'version')::int then raise exception '409|This draft changed in another tab. Reopen the current draft.'; end if;
    insert into public.we_drafts values(j.id,(p_input->>'version')::int+1,(p_input->>'operation')::uuid,p_input->'data',now())
      on conflict(intake_id) do update set version=excluded.version,operation=excluded.operation,payload=excluded.payload,updated_at=excluded.updated_at returning * into d;
    return jsonb_build_object('id',d.intake_id,'version',d.version,'data',d.payload,'updatedAt',d.updated_at);
  end if;
  if p_action='recovery' then
    update public.we_workers set recovery_hash=p_input->>'recoveryHash' where id=w;
    delete from public.we_sessions where worker_id=w and token_hash<>v_token_hash;
    return '{}';
  end if;
  if p_action='intake' then
    if (select count(*) from public.we_intakes where worker_id=w and created_at>now()-interval '1 day')>=50 then raise exception '429|Daily history limit reached.'; end if;
    insert into public.we_intakes(worker_id,language,voice,matching,outreach) values(w,p_input->>'language',(p_input->>'voice')::boolean,(p_input->>'matching')::boolean,(p_input->>'outreach')::boolean) returning id into new_id;
    return jsonb_build_object('id',new_id);
  end if;
  if p_action='intake_get' then
    select * into j from public.we_intakes where id=(p_input->>'id')::uuid and worker_id=w;
    if j.id is null then raise exception '404|Interview not found.'; end if;
    return to_jsonb(j);
  end if;
  if p_action='reserve' then
    bucket_no := floor(extract(epoch from now())/86400);
    insert into public.we_limits values('daily:providers',bucket_no,1) on conflict(key,bucket) do update set uses=we_limits.uses+1 returning uses into used;
    if used>200 then return jsonb_build_object('_error',429,'message','Daily voice and analysis budget reached. Type the details.'); end if;
    bucket_no := floor(extract(epoch from now())/1800);
    insert into public.we_limits values('provider:' || w,bucket_no,1) on conflict(key,bucket) do update set uses=we_limits.uses+1 returning uses into used;
    if used>20 then return jsonb_build_object('_error',429,'message','Voice and analysis limit reached. Type the details.'); end if;
    return '{}';
  end if;
  if p_action='history' then return coalesce((select jsonb_agg(public.we_record(x) order by x.confirmed_at desc) from public.we_histories x where worker_id=w),'[]'); end if;
  if p_action='confirm' then
    select * into j from public.we_intakes where id=(p_input->>'id')::uuid and worker_id=w for update;
    if j.id is null then raise exception '404|Interview not found.'; end if;
    select * into h from public.we_histories where intake_id=j.id;
    if h.id is not null then
      if h.operation<>(p_input->>'operation')::uuid or h.fingerprint<>fp then raise exception '409|This interview has already been saved.'; end if;
      return public.we_record(h);
    end if;
    if p_input ? 'permissions' then
      update public.we_intakes set matching=(p_input->'permissions'->>'matching')::boolean,outreach=(p_input->'permissions'->>'outreach')::boolean where id=j.id returning * into j;
    end if;
    insert into public.we_histories(intake_id,worker_id,fields,evidence,matching,outreach,operation,fingerprint)
      values(j.id,w,p_input->'fields',p_input->'evidence',j.matching,j.outreach,(p_input->>'operation')::uuid,fp) returning * into h;
    insert into public.we_revisions(history_id,version,fields,evidence,operation) values(h.id,1,h.fields,h.evidence,h.operation);
    if p_input ? 'source' then insert into public.we_sources values(h.id,p_input->'source'); end if;
    delete from public.we_drafts where intake_id=j.id;
    return public.we_record(h);
  end if;
  select * into h from public.we_histories where id=(p_input->>'id')::uuid and worker_id=w for update;
  if h.id is null then raise exception '404|History not found.'; end if;
  if p_action='delete_history' then
    if h.version<>(p_input->>'version')::int then raise exception '409|This history changed. Review it before deletion.'; end if;
    delete from public.we_events ev where strpos(ev.target,h.id::text)>0;
    delete from public.we_decisions where left_id=h.id or right_id=h.id;
    delete from public.we_referrals where history_id=h.id;
    delete from public.we_sources where history_id=h.id;
    delete from public.we_revisions where history_id=h.id;
    delete from public.we_histories where id=h.id;
    delete from public.we_drafts where intake_id=h.intake_id;
    delete from public.we_intakes where id=h.intake_id;
    return jsonb_build_object('deleted',true);
  end if;
  if p_action='revise' then
    if exists(select 1 from public.we_revisions where history_id=h.id and operation=(p_input->>'operation')::uuid and version=(p_input->>'version')::int+1 and fields=p_input->'fields') then return public.we_record(h); end if;
    if h.version<>(p_input->>'version')::int then raise exception '409|This history changed.'; end if;
    insert into public.we_revisions(history_id,version,fields,evidence,operation) values(h.id,h.version+1,p_input->'fields',h.evidence,(p_input->>'operation')::uuid);
    update public.we_histories set fields=p_input->'fields',version=version+1 where id=h.id returning * into h;
  elsif p_action='withdraw' then update public.we_histories set matching=false,outreach=false where id=h.id returning * into h;
  else raise exception '404|Operation not found.';
  end if;
  insert into public.we_events(target,kind,status,reason,actor)
    select id,'referral','cancelled',case when p_action='withdraw' then 'Worker withdrew sharing.' else 'Worker corrected the history. Review the current version.' end,'Worker'
      from public.we_referrals where history_id=h.id and status not in ('completed','declined','cancelled');
  update public.we_referrals set status='cancelled',version=version+1 where history_id=h.id and status not in ('completed','declined','cancelled');
  return public.we_record(h);
end;
$$;
