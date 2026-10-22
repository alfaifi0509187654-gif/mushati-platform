-- المرحلة الثانية والثالثة: صفحات المصدر والدروس والأسئلة المقترحة
-- لا يغيّر الاختبارات المنشورة؛ الأسئلة الجديدة تبدأ بحالة suggested.
create table if not exists public.mx_reference_pages (
  id uuid primary key default gen_random_uuid(),
  reference_id uuid not null references public.mx_references(id) on delete cascade,
  page_number integer not null,
  text_content text not null default '',
  confidence numeric not null default 100,
  ocr_used boolean not null default false,
  created_at timestamptz not null default now(),
  unique(reference_id, page_number)
);
create index if not exists mx_reference_pages_ref_idx on public.mx_reference_pages(reference_id, page_number);
alter table public.mx_reference_pages enable row level security;
drop policy if exists mx_reference_pages_owner on public.mx_reference_pages;
create policy mx_reference_pages_owner on public.mx_reference_pages for all to authenticated
using (exists (select 1 from public.mx_references r where r.id=reference_id and r.owner_id=auth.uid()))
with check (exists (select 1 from public.mx_references r where r.id=reference_id and r.owner_id=auth.uid()));
grant select, insert, update, delete on public.mx_reference_pages to authenticated;

create table if not exists public.mx_reference_lessons (
  id uuid primary key default gen_random_uuid(),
  reference_id uuid not null references public.mx_references(id) on delete cascade,
  lesson_key text not null,
  title text not null,
  content text not null default '',
  source_pages integer[] not null default '{}',
  status text not null default 'review' check (status in ('draft','review','approved','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(reference_id, lesson_key)
);
create index if not exists mx_reference_lessons_ref_idx on public.mx_reference_lessons(reference_id, updated_at desc);
alter table public.mx_reference_lessons enable row level security;
drop policy if exists mx_reference_lessons_owner on public.mx_reference_lessons;
create policy mx_reference_lessons_owner on public.mx_reference_lessons for all to authenticated
using (exists (select 1 from public.mx_references r where r.id=reference_id and r.owner_id=auth.uid()))
with check (exists (select 1 from public.mx_references r where r.id=reference_id and r.owner_id=auth.uid()));
grant select, insert, update, delete on public.mx_reference_lessons to authenticated;

create table if not exists public.mx_reference_questions (
  id uuid primary key default gen_random_uuid(),
  reference_id uuid not null references public.mx_references(id) on delete cascade,
  lesson_id uuid references public.mx_reference_lessons(id) on delete set null,
  question_text text not null,
  options jsonb not null default '[]'::jsonb,
  answer_index integer not null default 0,
  explanation text not null default '',
  source_pages integer[] not null default '{}',
  status text not null default 'suggested' check (status in ('suggested','review','approved','rejected')),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references auth.users(id)
);
create index if not exists mx_reference_questions_ref_idx on public.mx_reference_questions(reference_id, status);
alter table public.mx_reference_questions enable row level security;
drop policy if exists mx_reference_questions_owner on public.mx_reference_questions;
create policy mx_reference_questions_owner on public.mx_reference_questions for all to authenticated
using (exists (select 1 from public.mx_references r where r.id=reference_id and r.owner_id=auth.uid()))
with check (exists (select 1 from public.mx_references r where r.id=reference_id and r.owner_id=auth.uid()));
grant select, insert, update, delete on public.mx_reference_questions to authenticated;

create or replace function public.mx_reference_content_touch()
returns trigger language plpgsql security invoker set search_path=public
as $$ begin new.updated_at=now(); return new; end $$;
drop trigger if exists mx_reference_lessons_touch on public.mx_reference_lessons;
create trigger mx_reference_lessons_touch before update on public.mx_reference_lessons
for each row execute function public.mx_reference_content_touch();
