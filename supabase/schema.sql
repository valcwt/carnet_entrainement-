-- Carnet d'entraînement : à coller dans Supabase → SQL Editor → Run

create table if not exists public.days (
  date        date primary key,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

create table if not exists public.settings (
  id          text primary key default 'main',
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

-- Sécurité : RLS activé sans aucune règle = personne ne peut lire ni écrire
-- avec la clé publique (anon). Seules les routes /api de Vercel, qui utilisent
-- la clé service_role côté serveur, ont accès aux tables.
alter table public.days     enable row level security;
alter table public.settings enable row level security;
