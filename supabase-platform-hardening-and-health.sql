-- منصة المشاطي: تقوية محافظة وآمنة، بلا حذف بيانات
-- 1) تقييد دوال المعلم الحساسة على authenticated فقط
revoke execute on function public.mx_t_remote_session_create(text,text,timestamptz,timestamptz) from public, anon;
revoke execute on function public.mx_t_remote_report(uuid) from public, anon;
grant execute on function public.mx_t_remote_session_create(text,text,timestamptz,timestamptz) to authenticated;
grant execute on function public.mx_t_remote_report(uuid) to authenticated;

-- 2) دالة صحة موحّدة للوحة الحالة، لا تعيد كلمات مرور أو نصوص ملفات
create or replace function public.mx_platform_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare
  me uuid := auth.uid();
  role_name text;
begin
  if me is null then
    return jsonb_build_object('connected', false, 'error', 'auth');
  end if;

  select ar.role into role_name
  from public.mx_app_roles ar
  where ar.active and (ar.auth_user_id = me or ar.owner = me)
  order by case when ar.auth_user_id = me then 0 else 1 end
  limit 1;

  return jsonb_build_object(
    'connected', true,
    'checked_at', now(),
    'role', coalesce(role_name, 'authenticated'),
    'roles', (select count(*) from public.mx_app_roles where owner = me),
    'students', (select count(*) from public.mx_students where owner = me),
    'classes', (select count(*) from public.mx_classes where owner = me),
    'files', (select count(*) from public.mx_files where owner = me),
    'references', (select count(*) from public.mx_references where owner_id = me),
    'reference_pages', (select count(*) from public.mx_reference_pages p join public.mx_references r on r.id = p.reference_id where r.owner_id = me),
    'lessons', (select count(*) from public.mx_reference_lessons l join public.mx_references r on r.id = l.reference_id where r.owner_id = me),
    'questions', (select count(*) from public.mx_reference_questions q join public.mx_references r on r.id = q.reference_id where r.owner_id = me),
    'suggested_questions', (select count(*) from public.mx_reference_questions q join public.mx_references r on r.id = q.reference_id where r.owner_id = me and q.status in ('suggested','review')),
    'remote_sessions', (select count(*) from public.mx_remote_sessions where owner = me),
    'remote_attendance', (select count(*) from public.mx_remote_attendance where owner = me),
    'lab_audits', (select count(*) from public.mx_lab_audit where owner = me),
    'state_saved_at', (select saved_at from public.mx_state where owner = me limit 1),
    'storage_bucket_ready', exists(select 1 from storage.buckets where id = 'mx-references')
  );
end;
$$;

revoke all on function public.mx_platform_health() from public, anon;
grant execute on function public.mx_platform_health() to authenticated;

-- 3) تحسين كلفة تقييم auth.uid() في سياسات الملكية؛ لا يغيّر نطاق الوصول
alter policy mx_students_owner on public.mx_students
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
alter policy mx_classes_owner on public.mx_classes
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
alter policy mx_files_owner on public.mx_files
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
alter policy mx_app_roles_owner on public.mx_app_roles
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
alter policy mx_state_owner on public.mx_state
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
alter policy mx_msg_settings_owner on public.mx_msg_settings
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
alter policy mx_lab_audit_owner on public.mx_lab_audit
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
alter policy mx_references_select_own on public.mx_references
  using (owner_id = (select auth.uid()));
alter policy mx_references_insert_own on public.mx_references
  with check (owner_id = (select auth.uid()));
alter policy mx_references_update_own on public.mx_references
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
alter policy mx_references_delete_own on public.mx_references
  using (owner_id = (select auth.uid()));
alter policy mx_reference_pages_owner on public.mx_reference_pages
  using (exists (select 1 from public.mx_references r where r.id = mx_reference_pages.reference_id and r.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.mx_references r where r.id = mx_reference_pages.reference_id and r.owner_id = (select auth.uid())));
alter policy mx_reference_lessons_owner on public.mx_reference_lessons
  using (exists (select 1 from public.mx_references r where r.id = mx_reference_lessons.reference_id and r.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.mx_references r where r.id = mx_reference_lessons.reference_id and r.owner_id = (select auth.uid())));
alter policy mx_reference_questions_owner on public.mx_reference_questions
  using (exists (select 1 from public.mx_references r where r.id = mx_reference_questions.reference_id and r.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.mx_references r where r.id = mx_reference_questions.reference_id and r.owner_id = (select auth.uid())));

-- 4) فهارس إضافية للعلاقات التي كشفها فحص الأداء
create index if not exists mx_app_roles_auth_user_idx on public.mx_app_roles(auth_user_id);
create index if not exists mx_reference_questions_approved_by_idx on public.mx_reference_questions(approved_by);
create index if not exists mx_reference_questions_lesson_id_idx on public.mx_reference_questions(lesson_id);
create index if not exists mx_references_approved_by_idx on public.mx_references(approved_by);
