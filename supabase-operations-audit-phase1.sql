-- منصة المشاطي: سجل عمليات وإشعارات المرحلة الأولى
-- إضافة فقط: لا يحذف أو يعدل الطلاب والدرجات والحضور الحاليين.

create table if not exists public.mx_audit_events (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid(),
  event_type text not null check (event_type in ('grade','attendance','behavior','message','note','account')),
  class_key text,
  student_id text,
  previous_value text,
  new_value text,
  note text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.mx_audit_events enable row level security;

drop policy if exists mx_audit_events_owner_select on public.mx_audit_events;
create policy mx_audit_events_owner_select on public.mx_audit_events
  for select to authenticated using (owner = (select auth.uid()));

drop policy if exists mx_audit_events_owner_insert on public.mx_audit_events;
create policy mx_audit_events_owner_insert on public.mx_audit_events
  for insert to authenticated with check (owner = (select auth.uid()));

create index if not exists mx_audit_events_owner_created_idx
  on public.mx_audit_events(owner, created_at desc);
create index if not exists mx_audit_events_owner_student_idx
  on public.mx_audit_events(owner, student_id, created_at desc);

create or replace function public.mx_audit_event_add(
  p_event_type text,
  p_class_key text default null,
  p_student_id text default null,
  p_previous_value text default null,
  p_new_value text default null,
  p_note text default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare me uuid := auth.uid(); new_id uuid;
begin
  if me is null then return jsonb_build_object('error','auth'); end if;
  if p_event_type not in ('grade','attendance','behavior','message','note','account') then
    return jsonb_build_object('error','invalid_event_type');
  end if;
  insert into public.mx_audit_events(owner,event_type,class_key,student_id,previous_value,new_value,note,payload)
  values (me,p_event_type,p_class_key,p_student_id,p_previous_value,p_new_value,p_note,coalesce(p_payload,'{}'::jsonb))
  returning id into new_id;
  return jsonb_build_object('ok',true,'id',new_id);
end;
$$;

create or replace function public.mx_audit_event_list(p_limit integer default 100, p_offset integer default 0)
returns setof public.mx_audit_events
language sql
stable
security definer
set search_path = public
as $$
  select * from public.mx_audit_events
  where owner = auth.uid()
  order by created_at desc
  limit least(greatest(coalesce(p_limit,100),1),200)
  offset greatest(coalesce(p_offset,0),0);
$$;

revoke all on function public.mx_audit_event_add(text,text,text,text,text,text,jsonb) from public, anon;
revoke all on function public.mx_audit_event_list(integer,integer) from public, anon;
grant execute on function public.mx_audit_event_add(text,text,text,text,text,text,jsonb) to authenticated;
grant execute on function public.mx_audit_event_list(integer,integer) to authenticated;
