-- Owner authorization must use auth app_metadata, never user_metadata or a browser-only email list.
-- Apply after assigning app_metadata.role to the intended Auth users.

create or replace function public.is_owner()
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select lower(coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '')) = 'owner';
$$;

create or replace function public.ameen_purchase_invoice_reports_is_owner()
returns boolean
language sql
stable
set search_path = public
as $$
  select lower(coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '')) = 'owner';
$$;

create or replace function public.inventory_recon_is_owner()
returns boolean
language sql
stable
set search_path = public
as $$
  select lower(coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '')) = 'owner';
$$;

comment on function public.is_owner() is
  'Owner authorization from immutable Auth app_metadata.role.';
comment on function public.ameen_purchase_invoice_reports_is_owner() is
  'Owner authorization from immutable Auth app_metadata.role.';
comment on function public.inventory_recon_is_owner() is
  'Owner authorization from immutable Auth app_metadata.role.';

revoke all on function public.is_owner() from public, anon;
revoke all on function public.ameen_purchase_invoice_reports_is_owner() from public, anon;
revoke all on function public.inventory_recon_is_owner() from public, anon;

grant execute on function public.is_owner() to authenticated, service_role;
grant execute on function public.ameen_purchase_invoice_reports_is_owner() to authenticated, service_role;
grant execute on function public.inventory_recon_is_owner() to authenticated, service_role;
