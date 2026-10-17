\set ON_ERROR_STOP 0
\pset footer off
-- 3 comptes : A abonné actif, B non abonné, C accès offert, D abonnement expiré
insert into auth.users values
 ('aaaaaaaa-0000-0000-0000-000000000001','a@test'),
 ('bbbbbbbb-0000-0000-0000-000000000002','b@test'),
 ('cccccccc-0000-0000-0000-000000000003','c@test'),
 ('dddddddd-0000-0000-0000-000000000004','d@test');
\echo '--- profils créés par le trigger :'
select email, comp, subscription_status from public.profiles order by email;
-- Le "serveur" (service_role) règle les statuts
set role service_role;
update public.profiles set subscription_status='active', current_period_end=now()+interval '30 days' where email='a@test';
update public.profiles set comp=true where email='c@test';
update public.profiles set subscription_status='active', current_period_end=now()-interval '1 day' where email='d@test';
reset role;

\echo '=== A (abonné) écrit et lit ses journées'
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
insert into public.user_days(date,data) values ('2026-10-17','{"weight":105}');
insert into public.user_settings(data) values ('{"x":1}');
select user_id, date, data from public.user_days;
\echo '--- A tente d écrire une ligne au nom de B (doit échouer) :'
insert into public.user_days(user_id,date,data) values ('bbbbbbbb-0000-0000-0000-000000000002','2026-10-17','{"hack":1}');
\echo '--- A tente de se mettre "comp" (doit échouer) :'
update public.profiles set comp=true where id=auth.uid();
select email, comp, subscription_status from public.profiles;
reset role;

\echo '=== B (non abonné) : ne doit rien voir ni écrire'
set role authenticated; set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
select count(*) as journees_visibles_par_B from public.user_days;
insert into public.user_days(date,data) values ('2026-10-17','{"weight":80}');
\echo '--- B voit quand même son profil (pour savoir qu il doit payer) :'
select email, subscription_status, public.has_access() as acces from public.profiles;
\echo '--- B tente de modifier la journée de A (0 ligne attendue) :'
update public.user_days set data='{"hack":1}' where user_id='aaaaaaaa-0000-0000-0000-000000000001';
reset role;

\echo '=== C (accès offert) : écrit et ne voit que ses lignes'
set role authenticated; set request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
insert into public.user_days(date,data) values ('2026-10-17','{"weight":60}');
select count(*) as journees_visibles_par_C, public.has_access() as acces from public.user_days;
reset role;

\echo '=== D (abonnement expiré) : bloqué'
set role authenticated; set request.jwt.claim.sub = 'dddddddd-0000-0000-0000-000000000004';
select public.has_access() as acces_D;
insert into public.user_days(date,data) values ('2026-10-17','{"weight":90}');
reset role;

\echo '=== Visiteur non connecté (anon) : aucun accès'
set role anon;
select count(*) from public.user_days;
select count(*) from public.profiles;
reset role;

\echo '=== A n est plus abonné → il ne voit plus ses données (mais elles existent)'
set role service_role; update public.profiles set subscription_status='canceled' where email='a@test'; reset role;
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select count(*) as journees_visibles_par_A_resilie from public.user_days;
reset role;
\echo '=== Vue serveur (service_role) : tout est là, données intactes'
set role service_role;
select p.email, d.date, d.data from public.user_days d join public.profiles p on p.id=d.user_id order by p.email;
reset role;
\echo '=== Suppression d un compte → ses données partent avec (cascade)'
delete from auth.users where email='c@test';
select count(*) as lignes_restantes_de_C from public.user_days where user_id='cccccccc-0000-0000-0000-000000000003';
