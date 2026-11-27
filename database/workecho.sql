-- Apply to a dedicated WorkEcho PostgreSQL database (Neon recommended).
-- The server connects as the table owner. Browser clients have no database credentials.
create extension if not exists pgcrypto with schema extensions;
create table public.we_settings (key text primary key, value text not null);
create table public.we_workers (id uuid primary key default gen_random_uuid(), recovery_hash text unique not null, created_at timestamptz not null default now());
create table public.we_staff (id uuid primary key default gen_random_uuid(), email text unique not null, password_hash text not null,
  role text not null check (role in ('admin','reviewer','health')), active boolean not null default true);
create table public.we_sessions (token_hash text primary key, worker_id uuid references public.we_workers, staff_id uuid references public.we_staff,
  expires timestamptz not null default now() + interval '12 hours', check (num_nonnulls(worker_id,staff_id) = 1));
create table public.we_intakes (id uuid primary key default gen_random_uuid(), worker_id uuid not null references public.we_workers,
  language text not null check(language in ('en','hi')), voice boolean not null, matching boolean not null, outreach boolean not null,
  notice text not null default 'workecho-v2', created_at timestamptz not null default now());
create table public.we_histories (id uuid primary key default gen_random_uuid(), intake_id uuid unique not null references public.we_intakes,
  worker_id uuid not null references public.we_workers, fields jsonb not null, evidence jsonb not null, version integer not null default 1,
  matching boolean not null, outreach boolean not null, operation uuid not null, fingerprint text not null, confirmed_at timestamptz not null default now());
create index we_histories_owner on public.we_histories(worker_id);
create index we_shared on public.we_histories(confirmed_at) where matching or outreach;
create table public.we_revisions (history_id uuid not null references public.we_histories, version integer not null, fields jsonb not null,
  evidence jsonb not null, operation uuid not null, changed_at timestamptz not null default now(), primary key(history_id,version), unique(history_id,operation));
create table public.we_decisions (id text primary key, left_id uuid not null references public.we_histories, right_id uuid not null references public.we_histories,
  left_version integer not null, right_version integer not null, status text not null check(status in ('accepted','unresolved','rejected')),
  reason text not null, version integer not null default 1);
create table public.we_referrals (id text primary key, history_id uuid not null references public.we_histories, history_version integer not null,
  status text not null check(status in ('draft','approved','invited','responded','scheduled','completed','declined','unreachable','postponed','cancelled')),
  version integer not null, created_at timestamptz not null default now());
create table public.we_events (id bigint generated always as identity primary key, target text not null, kind text not null, status text not null,
  reason text not null, actor text not null, at timestamptz not null default now());
create index we_events_target on public.we_events(target,id);
create table public.we_operations (actor text not null, operation uuid not null, fingerprint text not null, result jsonb not null, primary key(actor,operation));
create table public.we_limits (key text not null, bucket bigint not null, uses integer not null, primary key(key,bucket));

create function public.we_record(h public.we_histories) returns jsonb language sql stable set search_path = '' as $$
 select jsonb_build_object('id',h.id,'fields',h.fields,'evidence',h.evidence,'version',h.version,'confirmedAt',h.confirmed_at,'sharing',h.matching or h.outreach);
$$;

-- The application server supplies authenticated credentials. This RPC is callable only by service_role.
-- SECURITY INVOKER preserves table permissions. No browser role can read these tables or invoke it.
create function public.we_api(p_action text, p_token text default '', p_input jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  s public.we_sessions; h public.we_histories; j public.we_intakes; st public.we_staff; r public.we_referrals;
  w uuid; new_id uuid; result jsonb; old_result public.we_operations; used integer; bucket_no bigint;
  v_token_hash text := encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex');
  fp text := encode(extensions.digest(p_action || p_input::text,'sha256'),'hex');
  v_actor text; next_status text := p_input->>'status'; detail text := p_input->>'reason'; target text := p_input->>'target';
begin
  delete from public.we_sessions where expires < now();
  delete from public.we_limits where
    (key like 'provider:%' and bucket < floor(extract(epoch from now())/1800)-2)
    or (key not like 'provider:%' and key not like 'daily:%' and bucket < floor(extract(epoch from now())/300)-2)
    or (key like 'daily:%' and bucket < floor(extract(epoch from now())/86400)-2);
  select * into s from public.we_sessions where token_hash = v_token_hash and expires > now();
  if s.staff_id is not null then select * into st from public.we_staff where id=s.staff_id and active; end if;
  if p_action='session' then return jsonb_build_object('active',s.worker_id is not null); end if;
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
    if p_action='staff_add' then
      if st.role <> 'admin' then raise exception '403|Administrator access is required.'; end if;
      if p_input->>'role' not in ('admin','reviewer','health') or length(p_input->>'password') not between 12 and 72 then raise exception '400|Check the account details.'; end if;
      insert into public.we_staff(email,password_hash,role) values(lower(p_input->>'email'),extensions.crypt(p_input->>'password',extensions.gen_salt('bf',12)),p_input->>'role');
      insert into public.we_events(target,kind,status,reason,actor) values('staff:' || lower(p_input->>'email'),'access','created','Staff account created with role ' || (p_input->>'role'),v_actor);
      return jsonb_build_object('created',true);
    end if;
    if p_action='staff_records' then
      return coalesce((select jsonb_agg(public.we_record(x) || jsonb_build_object('worker',x.worker_id,'matching',x.matching,'outreach',x.outreach,
        'label','Worker ' || upper(left(x.worker_id::text,8)), 'quote',concat_ws(' · ',x.evidence->>'place',x.evidence->>'task',x.evidence->>'period',x.evidence->>'landmark',x.evidence->>'alias')) order by x.confirmed_at desc)
        from public.we_histories x where x.matching or x.outreach),'[]');
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
  if p_action='recovery' then update public.we_workers set recovery_hash=p_input->>'recoveryHash' where id=w; return '{}'; end if;
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
    insert into public.we_histories(intake_id,worker_id,fields,evidence,matching,outreach,operation,fingerprint)
      values(j.id,w,p_input->'fields',p_input->'evidence',j.matching,j.outreach,(p_input->>'operation')::uuid,fp) returning * into h;
    insert into public.we_revisions(history_id,version,fields,evidence,operation) values(h.id,1,h.fields,h.evidence,h.operation);
    return public.we_record(h);
  end if;
  select * into h from public.we_histories where id=(p_input->>'id')::uuid and worker_id=w for update;
  if h.id is null then raise exception '404|History not found.'; end if;
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

-- Private by default. Only the server's service role can access records or call the RPC.
do $$ declare t text; r text; begin
  foreach t in array array['we_settings','we_workers','we_staff','we_sessions','we_intakes','we_histories','we_revisions','we_decisions','we_referrals','we_events','we_operations','we_limits'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from public',t);
    for r in select rolname from pg_roles where rolname in ('anon','authenticated') loop
      execute format('revoke all on table public.%I from %I',t,r);
    end loop;
    if exists(select 1 from pg_roles where rolname='service_role') then execute format('grant all on table public.%I to service_role',t); end if;
  end loop;
end $$;
revoke all on function public.we_api(text,text,jsonb), public.we_record(public.we_histories) from public;
do $$ declare r text; begin
  for r in select rolname from pg_roles where rolname in ('anon','authenticated') loop
    execute format('revoke all on function public.we_api(text,text,jsonb), public.we_record(public.we_histories) from %I',r);
  end loop;
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant usage, select on sequence public.we_events_id_seq to service_role;
    grant execute on function public.we_api(text,text,jsonb), public.we_record(public.we_histories) to service_role;
  end if;
end $$;
