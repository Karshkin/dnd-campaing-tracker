create table public.campaign_documents (
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null default campaign_private.selected_campaign() references public.campaigns on delete cascade,
 kind text not null check(kind in ('letter','contract','document','message')),
 title text not null check(length(btrim(title)) between 1 and 120),
 body text not null check(length(btrim(body)) between 1 and 50000),
 shared boolean not null default false,
 author_character_id integer,
 author_user_id uuid references public.profiles(id) on delete set null,
 author_character_name text,
 author_account_name text,
 recipients integer[] not null default '{}',
 groups integer[] not null default '{}',
 session_id uuid,
 created_at timestamptz not null default now(),
 unique(campaign_id,id),
 foreign key(campaign_id,author_character_id) references public.characters(campaign_id,id) on delete set null(author_character_id),
 foreign key(campaign_id,session_id) references public.chronicle_sessions(campaign_id,id) on delete set null(session_id)
);
create index documents_campaign_date on public.campaign_documents(campaign_id,created_at desc);

create function campaign_private.document_access(c uuid,target uuid,write boolean) returns boolean
language sql stable security definer set search_path = ''
as $$
 select auth.uid() is not null and exists(
  select 1 from public.campaign_documents d where (d.campaign_id,d.id) = (c,target)
  and (campaign_private.is_campaign_director(c) or (
    campaign_private.permitted_in(c,'tracker',1)
    and campaign_private.can_discover(c,'campaign_documents',target::text)
    and (d.author_user_id = auth.uid() or (not write and (
      d.shared or exists(select 1 from public.characters ch where ch.campaign_id = c and ch.user_id = auth.uid() and ch.id = any(d.recipients))
      or exists(select 1 from public.inventory_group_members g where g.campaign_id = c and g.user_id = auth.uid() and g.group_id = any(d.groups))
    )))
  ))
 );
$$;
revoke all on function campaign_private.document_access(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function campaign_private.document_access(uuid,uuid,boolean) to authenticated;
alter table public.campaign_documents enable row level security;
revoke all on public.campaign_documents from public,anon,authenticated;
grant select,insert(kind,title,body,shared,author_character_id,recipients,groups,session_id),
 update(kind,title,body,shared,recipients,groups,session_id),delete on public.campaign_documents to authenticated;
create policy document_read on public.campaign_documents for select to authenticated
using(campaign_id = (select campaign_private.selected_campaign()) and (
 campaign_private.is_campaign_director(campaign_id) or (
  author_user_id = (select auth.uid()) and campaign_private.permitted_in(campaign_id,'tracker',1)
  and campaign_private.can_discover(campaign_id,'campaign_documents',id::text)
 ) or campaign_private.document_access(campaign_id,id,false)
));
create policy document_insert on public.campaign_documents for insert to authenticated
with check(campaign_id = (select campaign_private.selected_campaign()) and campaign_private.can_edit_chronicle_record(campaign_id,author_user_id));
create policy document_update on public.campaign_documents for update to authenticated
using(campaign_id = (select campaign_private.selected_campaign()) and campaign_private.document_access(campaign_id,id,true))
with check(campaign_id = (select campaign_private.selected_campaign()) and campaign_private.can_edit_chronicle_record(campaign_id,author_user_id));
create policy document_delete on public.campaign_documents for delete to authenticated
using(campaign_id = (select campaign_private.selected_campaign()) and campaign_private.document_access(campaign_id,id,true));
create trigger document_signature before insert on public.campaign_documents
for each row execute function campaign_private.sign_chronicle_record();
create trigger document_session_access before insert or update of session_id on public.campaign_documents
for each row execute function campaign_private.validate_chronicle_session();

create function campaign_private.validate_document_recipients() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
 if cardinality(new.recipients)>100 or cardinality(new.groups)>100
   or cardinality(new.recipients)<>(select count(*) from public.characters c where c.campaign_id=new.campaign_id and c.id=any(new.recipients))
   or cardinality(new.groups)<>(select count(*) from public.inventory_groups g where g.campaign_id=new.campaign_id and g.id=any(new.groups)) then
   raise exception 'Destinatarios inválidos';
 end if;
 return new;
end;
$$;
revoke all on function campaign_private.validate_document_recipients() from public,anon,authenticated;
create trigger document_recipients before insert or update of recipients,groups on public.campaign_documents
for each row execute function campaign_private.validate_document_recipients();
insert into campaign_private.visibility_entities values('campaign_documents','public.campaign_documents');

create table public.document_reads (
 campaign_id uuid not null default campaign_private.selected_campaign(),
 document_id uuid not null,
 user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
 read_at timestamptz not null default now(),
 primary key(document_id,user_id),
 foreign key(campaign_id,document_id) references public.campaign_documents(campaign_id,id) on delete cascade
);
alter table public.document_reads enable row level security;
revoke all on public.document_reads from public,anon,authenticated;
grant select,insert(document_id),delete on public.document_reads to authenticated;
create policy own_receipts on public.document_reads for all to authenticated
using(user_id=(select auth.uid()) and campaign_id=(select campaign_private.selected_campaign()) and
 campaign_private.document_access(campaign_id,document_id,false))
with check(user_id=(select auth.uid()) and campaign_id=(select campaign_private.selected_campaign()) and
 campaign_private.document_access(campaign_id,document_id,false));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('campaign-documents','campaign-documents',false,10485760,array['image/png','image/jpeg','image/webp','image/gif','image/avif']);
create table public.document_images (
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null default campaign_private.selected_campaign(),
 document_id uuid not null,
 path text not null unique,
 foreign key(campaign_id,document_id) references public.campaign_documents(campaign_id,id) on delete cascade,
 check(path ~ ('^'||campaign_id::text||'/'||document_id::text||'/[0-9a-f-]{36}\.(png|jpg|webp|gif|avif)$'))
);
alter table public.document_images enable row level security;
revoke all on public.document_images from public,anon,authenticated;
grant select,insert(document_id,path),delete on public.document_images to authenticated;
create policy attachment_read on public.document_images for select to authenticated
using(campaign_id=(select campaign_private.selected_campaign()) and campaign_private.document_access(campaign_id,document_id,false));
create policy attachment_insert on public.document_images for insert to authenticated
with check(campaign_id=(select campaign_private.selected_campaign()) and campaign_private.document_access(campaign_id,document_id,true));
create policy attachment_delete on public.document_images for delete to authenticated
using(campaign_id=(select campaign_private.selected_campaign()) and campaign_private.document_access(campaign_id,document_id,true));
create function campaign_private.document_asset_access(path text,write boolean) returns boolean
language sql stable security definer set search_path = ''
as $$
 select case when path ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f-]{36}\.(png|jpg|webp|gif|avif)$'
 then campaign_private.document_access(split_part(path,'/',1)::uuid,split_part(path,'/',2)::uuid,write)
 else false end;
$$;
revoke all on function campaign_private.document_asset_access(text,boolean) from public,anon,authenticated;
grant execute on function campaign_private.document_asset_access(text,boolean) to authenticated;
create policy document_image_storage_read on storage.objects for select to authenticated
using(bucket_id='campaign-documents' and campaign_private.document_asset_access(name,false));
create policy document_image_storage_insert on storage.objects for insert to authenticated
with check(bucket_id='campaign-documents' and campaign_private.document_asset_access(name,true));
create policy document_image_storage_delete on storage.objects for delete to authenticated
using(bucket_id='campaign-documents' and campaign_private.document_asset_access(name,true));
create policy document_image_guard_read on storage.objects as restrictive for select to authenticated
using(bucket_id<>'campaign-documents' or campaign_private.document_asset_access(name,false));
create policy document_image_guard_insert on storage.objects as restrictive for insert to authenticated
with check(bucket_id<>'campaign-documents' or campaign_private.document_asset_access(name,true));
create policy document_image_guard_update on storage.objects as restrictive for update to authenticated
using(bucket_id<>'campaign-documents') with check(bucket_id<>'campaign-documents');
create policy document_image_guard_delete on storage.objects as restrictive for delete to authenticated
using(bucket_id<>'campaign-documents' or campaign_private.document_asset_access(name,true));
