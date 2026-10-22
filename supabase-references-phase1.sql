-- مكتبة الكتب والمراجع — المرحلة الأولى
-- آمن وقابل لإعادة التنفيذ. لا يغيّر الجداول الحالية.

create table if not exists public.mx_references (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  file_name text not null,
  file_type text not null,
  mime_type text not null,
  file_size bigint not null default 0 check (file_size >= 0),
  storage_path text,
  status text not null default 'uploaded' check (status in ('uploaded','processing','ready','review','approved','error','archived')),
  subject text,
  grade text,
  class_key text,
  lesson_key text,
  extracted_text text,
  page_count integer,
  ocr_used boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references auth.users(id)
);

create index if not exists mx_references_owner_idx on public.mx_references(owner_id, updated_at desc);
create index if not exists mx_references_status_idx on public.mx_references(owner_id, status);
create index if not exists mx_references_search_idx on public.mx_references using gin (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(file_name,'') || ' ' || coalesce(extracted_text,'')));

alter table public.mx_references enable row level security;

drop policy if exists mx_references_select_own on public.mx_references;
drop policy if exists mx_references_insert_own on public.mx_references;
drop policy if exists mx_references_update_own on public.mx_references;
drop policy if exists mx_references_delete_own on public.mx_references;

create policy mx_references_select_own on public.mx_references for select to authenticated using (owner_id = auth.uid());
create policy mx_references_insert_own on public.mx_references for insert to authenticated with check (owner_id = auth.uid());
create policy mx_references_update_own on public.mx_references for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy mx_references_delete_own on public.mx_references for delete to authenticated using (owner_id = auth.uid());

do $$ begin
  if not exists (select 1 from storage.buckets where id = 'mx-references') then
    insert into storage.buckets (id, name, public) values ('mx-references', 'mx-references', false);
  end if;
end $$;

drop policy if exists mx_references_storage_select on storage.objects;
drop policy if exists mx_references_storage_insert on storage.objects;
drop policy if exists mx_references_storage_update on storage.objects;
drop policy if exists mx_references_storage_delete on storage.objects;

create policy mx_references_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'mx-references' and (storage.foldername(name))[1] = auth.uid()::text);
create policy mx_references_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'mx-references' and (storage.foldername(name))[1] = auth.uid()::text);
create policy mx_references_storage_update on storage.objects for update to authenticated
  using (bucket_id = 'mx-references' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'mx-references' and (storage.foldername(name))[1] = auth.uid()::text);
create policy mx_references_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'mx-references' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function public.mx_references_touch_updated_at()
returns trigger language plpgsql security invoker set search_path = public
as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists mx_references_touch on public.mx_references;
create trigger mx_references_touch before update on public.mx_references
for each row execute function public.mx_references_touch_updated_at();

grant select, insert, update, delete on public.mx_references to authenticated;
