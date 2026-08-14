-- Adiciona destino iOS dedicado sem alterar o estado operacional atual.
-- Compatibilidade: iOS herdava o estado mobile; portanto a nova linha nasce
-- com o mesmo estado/mensagem da linha mobile (ou global como fallback).

insert into public.mf_global_settings (
  key,
  maintenance_mode,
  maintenance_message,
  updated_at
)
select
  'ios',
  coalesce(
    (select maintenance_mode from public.mf_global_settings where key = 'mobile' limit 1),
    (select maintenance_mode from public.mf_global_settings where key = 'global' limit 1),
    false
  ),
  coalesce(
    (select maintenance_message from public.mf_global_settings where key = 'mobile' limit 1),
    (select maintenance_message from public.mf_global_settings where key = 'global' limit 1),
    'Estamos realizando melhorias importantes. O MF Financeiro estará disponível novamente em breve.'
  ),
  now()
where not exists (
  select 1 from public.mf_global_settings where key = 'ios'
);
