-- =====================================================================
-- Carnet d'entraînement — étape 1 bis : parrainage FitMotivator
-- À lancer APRÈS 001_multi_utilisateurs.sql (Supabase → SQL Editor → Run).
--
-- Règles :
--   • un FitMotivator a son propre abonnement, qui INCLUT ses challengers
--     (nombre illimité) ;
--   • il partage un code de parrainage ; un challenger qui l'utilise a accès
--     à l'app tant que l'abonnement de son FitMotivator est actif ;
--   • si le FitMotivator arrête, le challenger peut s'abonner lui-même et
--     garde toutes ses données (elles sont à son nom, pas à celui du coach) ;
--   • le FitMotivator voit les données d'un challenger EN LECTURE SEULE,
--     uniquement si ce challenger a donné son accord (révocable).
--
-- Tout ce qui change un lien parrain/challenger passe par des fonctions
-- serveur (« RPC ») : le navigateur n'écrit jamais directement dans profiles.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Nouvelles colonnes du profil
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists display_name       text,
  add column if not exists role               text not null default 'user',
  add column if not exists referral_code      text unique,
  add column if not exists sponsor_id         uuid references public.profiles (id) on delete set null,
  add column if not exists share_with_sponsor boolean not null default false,
  add column if not exists sponsored_at       timestamptz;

do $$ begin
  alter table public.profiles add constraint profiles_role_check check (role in ('user', 'fitmotivator'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.profiles add constraint profiles_not_own_sponsor check (sponsor_id is distinct from id);
exception when duplicate_object then null; end $$;

create index if not exists profiles_sponsor_idx on public.profiles (sponsor_id);


-- ---------------------------------------------------------------------
-- 2. Accès : on remplace has_access() pour ajouter le parrainage
--    Accès = accès offert
--         OU abonnement personnel actif
--         OU parrainé par un FitMotivator qui a lui-même un accès personnel
--            (offert ou abonnement actif — pas de parrainage en cascade).
-- ---------------------------------------------------------------------
create or replace function public.has_own_access(p public.profiles)
returns boolean
language sql
stable  -- dépend de now()
set search_path = ''
as $$
  -- coalesce : sans abonnement, subscription_status est NULL, et en SQL
  -- « NULL = 'active' » ne vaut ni vrai ni faux mais NULL. Sans coalesce,
  -- « if not has_own_access(...) » devient « if NULL » et la vérification
  -- ne se déclenche jamais.
  select coalesce(
    p.comp
    or (p.subscription_status = 'active'
        and (p.current_period_end is null or p.current_period_end > now())),
    false);
$$;

create or replace function public.has_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles me
    left join public.profiles coach
           on coach.id = me.sponsor_id and coach.role = 'fitmotivator'
    where me.id = (select auth.uid())
      and (
        public.has_own_access(me)
        or (coach.id is not null and public.has_own_access(coach))
      )
  );
$$;

revoke all on function public.has_access() from public, anon;
grant execute on function public.has_access() to authenticated;


-- ---------------------------------------------------------------------
-- 3. « Ce challenger m'a-t-il autorisé à voir ses données ? »
--    Sert aux règles de lecture côté FitMotivator.
-- ---------------------------------------------------------------------
create or replace function public.coach_can_read(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles c
    join public.profiles coach on coach.id = c.sponsor_id
    where c.id = target
      and c.sponsor_id = (select auth.uid())
      and c.share_with_sponsor
      and coach.role = 'fitmotivator'
      and public.has_own_access(coach)
  );
$$;

revoke all on function public.coach_can_read(uuid) from public, anon;
grant execute on function public.coach_can_read(uuid) to authenticated;

-- Règles de LECTURE supplémentaires pour le coach (aucune écriture possible).
-- Plusieurs règles « select » se combinent en OU : un utilisateur lit ses
-- propres lignes (règle de 001) OU celles d'un challenger qui l'autorise.
drop policy if exists "journées : lecture par le coach" on public.user_days;
create policy "journées : lecture par le coach" on public.user_days for select to authenticated
  using ((select public.coach_can_read(user_id)));

drop policy if exists "réglages : lecture par le coach" on public.user_settings;
create policy "réglages : lecture par le coach" on public.user_settings for select to authenticated
  using ((select public.coach_can_read(user_id)));


-- ---------------------------------------------------------------------
-- 4. Fonctions serveur (RPC), appelées depuis l'app
--    security definer = elles peuvent modifier profiles, mais chacune
--    vérifie elle-même QUI l'appelle et ce qu'il a le droit de faire.
-- ---------------------------------------------------------------------

-- Code lisible, sans caractères ambigus (pas de 0/O, 1/I/L).
create or replace function public.new_referral_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := 'FIT-';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.profiles where referral_code = code);
  end loop;
  return code;
end;
$$;
revoke all on function public.new_referral_code() from public, anon, authenticated;

-- FitMotivator : obtenir (ou créer) son code de parrainage.
create or replace function public.my_referral_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = (select auth.uid());
  if me.id is null or me.role <> 'fitmotivator' then
    raise exception 'Réservé aux FitMotivators.' using errcode = '42501';
  end if;
  if me.referral_code is null then
    update public.profiles set referral_code = public.new_referral_code(), updated_at = now()
     where id = me.id
     returning referral_code into me.referral_code;
  end if;
  return me.referral_code;
end;
$$;

-- FitMotivator : changer de code (l'ancien ne fonctionne plus pour les
-- nouveaux challengers ; ceux déjà inscrits restent rattachés).
create or replace function public.regenerate_referral_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  code text;
begin
  if not exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'fitmotivator') then
    raise exception 'Réservé aux FitMotivators.' using errcode = '42501';
  end if;
  update public.profiles set referral_code = public.new_referral_code(), updated_at = now()
   where id = (select auth.uid())
   returning referral_code into code;
  return code;
end;
$$;

-- Challenger : utiliser un code. Renvoie le nom du FitMotivator.
-- Le partage des données repart toujours à « non » : c'est au challenger
-- de l'accepter explicitement ensuite.
create or replace function public.redeem_referral_code(code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  coach public.profiles;
  me_id uuid := (select auth.uid());
begin
  if me_id is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;
  select * into coach from public.profiles
   where referral_code = upper(trim(code)) and role = 'fitmotivator';
  if coach.id is null then
    raise exception 'Code de parrainage invalide.' using errcode = 'P0002';
  end if;
  if coach.id = me_id then
    raise exception 'Tu ne peux pas utiliser ton propre code.' using errcode = '22023';
  end if;
  if not public.has_own_access(coach) then
    raise exception 'L''abonnement de ce FitMotivator n''est pas actif.' using errcode = 'P0001';
  end if;
  update public.profiles
     set sponsor_id = coach.id, share_with_sponsor = false, sponsored_at = now(), updated_at = now()
   where id = me_id;
  return coalesce(coach.display_name, coach.email);
end;
$$;

-- Challenger : accepter ou retirer le partage de ses données avec son coach.
create or replace function public.set_share_with_sponsor(share boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set share_with_sponsor = share, updated_at = now()
   where id = (select auth.uid()) and sponsor_id is not null;
  if not found then
    raise exception 'Tu n''as pas de FitMotivator.' using errcode = 'P0002';
  end if;
end;
$$;

-- Challenger : quitter son FitMotivator.
create or replace function public.leave_sponsor()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
     set sponsor_id = null, share_with_sponsor = false, sponsored_at = null, updated_at = now()
   where id = (select auth.uid());
end;
$$;

-- FitMotivator : retirer un challenger.
create or replace function public.remove_challenger(challenger uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
     set sponsor_id = null, share_with_sponsor = false, sponsored_at = null, updated_at = now()
   where id = challenger and sponsor_id = (select auth.uid());
  if not found then
    raise exception 'Ce compte n''est pas un de tes challengers.' using errcode = 'P0002';
  end if;
end;
$$;

-- FitMotivator : la liste de ses challengers (sans aucune info de paiement).
create or replace function public.my_challengers()
returns table (id uuid, display_name text, email text, sponsored_at timestamptz, share_with_sponsor boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.display_name, c.email, c.sponsored_at, c.share_with_sponsor
  from public.profiles c
  where c.sponsor_id = (select auth.uid())
  order by c.sponsored_at desc nulls last;
$$;

-- Challenger : qui est mon FitMotivator, et mon accès vient-il de lui ?
create or replace function public.my_sponsor()
returns table (display_name text, email text, coach_active boolean, share_with_sponsor boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(coach.display_name, coach.email), coach.email,
         public.has_own_access(coach), me.share_with_sponsor
  from public.profiles me
  join public.profiles coach on coach.id = me.sponsor_id
  where me.id = (select auth.uid());
$$;

-- Tout le monde : choisir son nom affiché (vu par son coach ou ses challengers).
create or replace function public.set_display_name(name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if length(trim(coalesce(name, ''))) not between 1 and 60 then
    raise exception 'Le nom doit faire entre 1 et 60 caractères.' using errcode = '22023';
  end if;
  update public.profiles set display_name = trim(name), updated_at = now()
   where id = (select auth.uid());
end;
$$;

-- Droits : les fonctions publiques sont réservées aux utilisateurs connectés.
do $$
declare f text;
begin
  foreach f in array array[
    'public.my_referral_code()', 'public.regenerate_referral_code()',
    'public.redeem_referral_code(text)', 'public.set_share_with_sponsor(boolean)',
    'public.leave_sponsor()', 'public.remove_challenger(uuid)',
    'public.my_challengers()', 'public.my_sponsor()', 'public.set_display_name(text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- Le rôle FitMotivator ne s'attribue que côté serveur : par le webhook
-- Stripe (abonnement FitMotivator), ou à la main pour tester, en SQL :
--   update public.profiles set role = 'fitmotivator' where email = 'toi@exemple.fr';
