-- =====================================================================
-- Carnet d'entraînement — étape 1 : passage en multi-utilisateurs
-- À coller dans Supabase → SQL Editor → Run (une seule fois).
--
-- Principe « expand / contract » : on CRÉE de nouvelles tables à côté
-- des anciennes (days, settings), sans y toucher. Le site actuel continue
-- de tourner ; on supprimera les anciennes tables à la toute fin.
--
-- Qui peut faire quoi :
--   • chaque utilisateur ne voit et ne modifie QUE ses propres lignes ;
--   • et seulement si son abonnement est actif (ou si l'accès lui est offert) ;
--   • le statut d'abonnement n'est modifiable que par le serveur
--     (webhook Stripe, clé service_role), jamais depuis le navigateur.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Profils : un par compte, créé automatiquement à l'inscription
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  email                text,
  comp                 boolean     not null default false,  -- accès offert (toi, ta femme, testeurs)
  stripe_customer_id   text unique,
  subscription_status  text,                                 -- statut Stripe : active, past_due, canceled…
  current_period_end   timestamptz,                          -- fin de la période payée
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- À chaque nouvel inscrit dans auth.users, on crée sa ligne de profil.
-- « security definer » : la fonction s'exécute avec les droits de son
-- créateur, car le nouvel inscrit n'a pas le droit d'écrire dans profiles.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------------------------------------------------------------------
-- 2. « Cet utilisateur a-t-il accès ? » — utilisé par toutes les règles
--    Accès = accès offert, OU abonnement Stripe « active » non expiré.
--    (Pas d'essai gratuit, et un impayé « past_due » coupe l'accès.)
-- ---------------------------------------------------------------------
create or replace function public.has_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and (
        p.comp
        or (
          p.subscription_status = 'active'
          and (p.current_period_end is null or p.current_period_end > now())
        )
      )
  );
$$;

revoke all on function public.has_access() from public, anon;
grant execute on function public.has_access() to authenticated;


-- ---------------------------------------------------------------------
-- 3. Les données du carnet, une ligne par (utilisateur, jour)
-- ---------------------------------------------------------------------
create table if not exists public.user_days (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date        date not null,
  data        jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (user_id, date),
  constraint user_days_data_size check (octet_length(data::text) < 200000)  -- une journée pèse quelques Ko
);

create table if not exists public.user_settings (
  user_id     uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data        jsonb not null,
  updated_at  timestamptz not null default now(),
  constraint user_settings_data_size check (octet_length(data::text) < 500000)
);


-- ---------------------------------------------------------------------
-- 4. Sécurité au niveau des lignes (RLS)
--    Une fois RLS activé, TOUT est refusé par défaut ; chaque « policy »
--    ouvre un accès précis. Pas de policy = pas d'accès.
-- ---------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.user_days     enable row level security;
alter table public.user_settings enable row level security;

-- Profil : l'utilisateur peut LIRE le sien (pour savoir s'il doit payer).
-- Aucune policy d'écriture : seul le serveur (service_role) le modifie.
drop policy if exists "profil : lecture du sien" on public.profiles;
create policy "profil : lecture du sien"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

-- Journées : ses propres lignes, et seulement avec un accès actif.
drop policy if exists "journées : lecture"      on public.user_days;
drop policy if exists "journées : ajout"        on public.user_days;
drop policy if exists "journées : modification" on public.user_days;
drop policy if exists "journées : suppression"  on public.user_days;

create policy "journées : lecture" on public.user_days for select to authenticated
  using (user_id = (select auth.uid()) and (select public.has_access()));
create policy "journées : ajout" on public.user_days for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.has_access()));
create policy "journées : modification" on public.user_days for update to authenticated
  using      (user_id = (select auth.uid()) and (select public.has_access()))
  with check (user_id = (select auth.uid()) and (select public.has_access()));
create policy "journées : suppression" on public.user_days for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.has_access()));

-- Réglages (programme, objectifs, plans) : même logique.
drop policy if exists "réglages : lecture"      on public.user_settings;
drop policy if exists "réglages : ajout"        on public.user_settings;
drop policy if exists "réglages : modification" on public.user_settings;
drop policy if exists "réglages : suppression"  on public.user_settings;

create policy "réglages : lecture" on public.user_settings for select to authenticated
  using (user_id = (select auth.uid()) and (select public.has_access()));
create policy "réglages : ajout" on public.user_settings for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.has_access()));
create policy "réglages : modification" on public.user_settings for update to authenticated
  using      (user_id = (select auth.uid()) and (select public.has_access()))
  with check (user_id = (select auth.uid()) and (select public.has_access()));
create policy "réglages : suppression" on public.user_settings for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.has_access()));


-- ---------------------------------------------------------------------
-- 5. Droits de base (en plus de RLS, par prudence)
--    anon = visiteur non connecté : aucun accès.
--    authenticated = connecté : les policies ci-dessus décident.
-- ---------------------------------------------------------------------
revoke all on public.profiles, public.user_days, public.user_settings from anon;
revoke insert, update, delete on public.profiles from authenticated;  -- le statut d'abonnement ne se modifie pas depuis le navigateur
grant select                          on public.profiles      to authenticated;
grant select, insert, update, delete  on public.user_days     to authenticated;
grant select, insert, update, delete  on public.user_settings to authenticated;
