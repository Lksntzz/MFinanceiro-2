-- Configuracao global de manutencao do app.
-- Fonte principal: tabela mf_global_settings (linha unica: key = 'global').

create table if not exists public.mf_global_settings (
  key text primary key,
  maintenance_mode boolean not null default false,
  maintenance_message text not null default 'Estamos em manutencao para melhorias. Tente novamente em alguns minutos.',
  updated_at timestamptz not null default now()
);

create or replace function public.set_mf_global_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_mf_global_settings_updated_at on public.mf_global_settings;
create trigger trg_mf_global_settings_updated_at
before update on public.mf_global_settings
for each row
execute procedure public.set_mf_global_settings_updated_at();

insert into public.mf_global_settings (key, maintenance_mode, maintenance_message)
values (
  'global',
  false,
  'Estamos em manutencao para melhorias. Tente novamente em alguns minutos.'
)
on conflict (key) do nothing;

alter table public.mf_global_settings enable row level security;

-- Leitura liberada para anon/auth para que a tela de manutencao funcione
-- antes do login e sem expor escrita.
drop policy if exists "mf_global_settings_select_anon" on public.mf_global_settings;
create policy "mf_global_settings_select_anon"
on public.mf_global_settings
for select
to anon
using (true);

drop policy if exists "mf_global_settings_select_auth" on public.mf_global_settings;
create policy "mf_global_settings_select_auth"
on public.mf_global_settings
for select
to authenticated
using (true);
