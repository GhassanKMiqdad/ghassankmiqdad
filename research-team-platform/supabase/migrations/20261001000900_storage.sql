-- =============================================================================
-- Supabase Storage: private bucket for project documents
--
-- Object layout:  <project_id>/<document_id>/<sanitized-file-name>
-- The first folder is the project id, so every storage policy reuses exactly
-- the same permission helper as the documents table.
--
-- No UPDATE policy: stored files are immutable (no overwrite / upsert).
--
-- Uploads happen in two steps (signed upload URL, then a `documents` row).
-- Until the row exists the uploader may still see and discard their own
-- object, so a failed second step never needs the service role.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-documents',
  'project-documents',
  false,
  52428800, -- 50 MB
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.presentation',
    'application/rtf',
    'text/plain',
    'text/csv',
    'text/markdown',
    'application/json',
    'application/x-tex',
    'application/x-bibtex',
    'application/zip',
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- True when a document row references the object (in any project and
-- regardless of what the caller may see).
create or replace function private.is_registered_document_path(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.documents d where d.storage_path = p_name);
$$;

revoke execute on function private.is_registered_document_path(text) from public, anon;
grant execute on function private.is_registered_document_path(text) to authenticated, service_role;

-- The uploader's own object that is not (yet) registered as a document.
create or replace function private.is_own_pending_upload(p_name text, p_owner_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_owner_id is not null
     and p_owner_id = (select auth.uid())::text
     and private.has_permission(private.try_uuid((storage.foldername(p_name))[1]), 'documents.upload')
     and not private.is_registered_document_path(p_name);
$$;

revoke execute on function private.is_own_pending_upload(text, text) from public, anon;
grant execute on function private.is_own_pending_upload(text, text) to authenticated, service_role;

create policy project_documents_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'project-documents'
    and (
      private.has_permission(private.try_uuid((storage.foldername(name))[1]), 'documents.view')
      or private.is_own_pending_upload(name, owner_id)
    )
  );

create policy project_documents_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'project-documents'
    and private.has_permission(private.try_uuid((storage.foldername(name))[1]), 'documents.upload')
  );

create policy project_documents_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'project-documents'
    and (
      private.has_permission(private.try_uuid((storage.foldername(name))[1]), 'documents.delete')
      or private.is_own_pending_upload(name, owner_id)
    )
  );
