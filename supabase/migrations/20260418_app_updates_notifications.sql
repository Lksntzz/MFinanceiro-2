-- Notificacao de atualizacoes do aplicativo (novidades, correçoes e melhorias).

create table if not exists public.mf_app_updates (
  id bigint generated always as identity primary key,
  version text not null unique,
  title text not null,
  summary text,
  has_new_features boolean not null default false,
  new_features text[] not null default '{}',
  fixes text[] not null default '{}',
  is_active boolean not null default true,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_mf_app_updates_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_mf_app_updates_updated_at on public.mf_app_updates;
create trigger trg_mf_app_updates_updated_at
before update on public.mf_app_updates
for each row
execute procedure public.set_mf_app_updates_updated_at();

alter table public.mf_app_updates enable row level security;
alter table public.mf_app_updates force row level security;

drop policy if exists "mf_app_updates_select_auth" on public.mf_app_updates;
create policy "mf_app_updates_select_auth"
on public.mf_app_updates
for select
to authenticated
using (is_active = true);

insert into public.mf_app_updates (
  version,
  title,
  summary,
  has_new_features,
  new_features,
  fixes,
  is_active,
  published_at
)
values (
  '2026.04.18-1',
  'Notificacao de atualizacao no app',
  'Agora o aplicativo avisa automaticamente quando houver atualizacao.',
  true,
  array[
    'Nova notificacao de atualizacao por versao.',
    'Bloco dedicado para Novidades quando houver recursos novos.'
  ],
  array[
    'Ajustes gerais de seguranca e governanca no Supabase.',
    'Melhorias de organizacao para futuras releases.'
  ],
  true,
  now()
)
on conflict (version) do update
set
  title = excluded.title,
  summary = excluded.summary,
  has_new_features = excluded.has_new_features,
  new_features = excluded.new_features,
  fixes = excluded.fixes,
  is_active = excluded.is_active,
  published_at = excluded.published_at,
  updated_at = now();
