-- Tests du parrainage FitMotivator (Postgres local, après 00, 001 et 002).
-- Comptes : M = FitMotivator abonné, N = FitMotivator SANS abonnement,
--           X et Y = challengers, Z = utilisateur sans rien.
\set ON_ERROR_STOP 0
\pset footer off
insert into auth.users values
 ('10000000-0000-0000-0000-00000000000a', 'm@test'),
 ('20000000-0000-0000-0000-00000000000b', 'n@test'),
 ('30000000-0000-0000-0000-00000000000c', 'x@test'),
 ('40000000-0000-0000-0000-00000000000d', 'y@test'),
 ('50000000-0000-0000-0000-00000000000e', 'z@test');

-- Le serveur attribue les rôles et l'abonnement de M
set role service_role;
update public.profiles set role = 'fitmotivator', subscription_status = 'active',
       current_period_end = now() + interval '30 days', display_name = 'Coach Max' where email = 'm@test';
update public.profiles set role = 'fitmotivator' where email = 'n@test';
reset role;

\echo '=== M (FitMotivator abonné) obtient son code'
set role authenticated; set request.jwt.claim.sub = '10000000-0000-0000-0000-00000000000a';
select public.my_referral_code() ~ '^FIT-[A-Z2-9]{6}$' as format_ok;
select public.my_referral_code() = public.my_referral_code() as code_stable;
\echo '--- M utilise son propre code (doit échouer) :'
select public.redeem_referral_code(public.my_referral_code());
reset role;
set role service_role; select referral_code as code_m from public.profiles where email = 'm@test' \gset
select public.new_referral_code() is null as dummy \gset
reset role;

\echo '=== Z (simple utilisateur) ne peut pas avoir de code'
set role authenticated; set request.jwt.claim.sub = '50000000-0000-0000-0000-00000000000e';
select public.my_referral_code();
\echo '--- Z ne peut pas appeler le générateur interne :'
select public.new_referral_code();
reset role;

\echo '=== X : avant le code, pas d accès ; code invalide refusé'
set role authenticated; set request.jwt.claim.sub = '30000000-0000-0000-0000-00000000000c';
select public.has_access() as acces_x_avant;
select public.redeem_referral_code('FIT-XXXXXX');
\echo '--- X utilise le code de M (en minuscules, avec espaces) :'
select public.redeem_referral_code(lower(' ' || :'code_m' || ' ')) as coach;
select public.has_access() as acces_x_apres;
insert into public.user_days(date, data) values ('2026-10-17', '{"weight":80,"note":"privé"}');
select * from public.my_sponsor();
reset role;

\echo '=== M ne voit PAS encore les données de X (pas d accord)'
set role authenticated; set request.jwt.claim.sub = '10000000-0000-0000-0000-00000000000a';
select display_name, email, share_with_sponsor from public.my_challengers();
select count(*) as journees_de_x_vues_par_m from public.user_days where user_id = '30000000-0000-0000-0000-00000000000c';
reset role;

\echo '=== X accepte le partage → M lit, mais ne peut pas écrire'
set role authenticated; set request.jwt.claim.sub = '30000000-0000-0000-0000-00000000000c';
select public.set_share_with_sponsor(true);
reset role;
set role authenticated; set request.jwt.claim.sub = '10000000-0000-0000-0000-00000000000a';
select data from public.user_days where user_id = '30000000-0000-0000-0000-00000000000c';
update public.user_days set data = '{"hack":1}' where user_id = '30000000-0000-0000-0000-00000000000c';
delete from public.user_days where user_id = '30000000-0000-0000-0000-00000000000c';
insert into public.user_days(user_id, date, data) values ('30000000-0000-0000-0000-00000000000c', '2026-10-18', '{"hack":1}');
\echo '--- M ne peut pas lire le profil (paiement) de X directement :'
select count(*) as profils_visibles_par_m_le_sien_seulement from public.profiles;
reset role;

\echo '=== Y n a pas de coach : M ne voit rien de Y ; Y ne voit rien de X'
set role service_role; update public.profiles set subscription_status='active', current_period_end=now()+interval '30 days' where email='y@test'; reset role;
set role authenticated; set request.jwt.claim.sub = '40000000-0000-0000-0000-00000000000d';
insert into public.user_days(date, data) values ('2026-10-17', '{"weight":70}');
select count(*) as lignes_vues_par_y from public.user_days;
select public.set_share_with_sponsor(true);
reset role;
set role authenticated; set request.jwt.claim.sub = '10000000-0000-0000-0000-00000000000a';
select count(*) as journees_de_y_vues_par_m from public.user_days where user_id = '40000000-0000-0000-0000-00000000000d';
\echo '--- M tente de retirer Y qui n est pas son challenger (doit échouer) :'
select public.remove_challenger('40000000-0000-0000-0000-00000000000d');
reset role;

\echo '=== N (FitMotivator sans abonnement) : son code est refusé (doit échouer)'
set role authenticated; set request.jwt.claim.sub = '20000000-0000-0000-0000-00000000000b';
select public.my_referral_code() as code_n \gset
reset role;
set role authenticated; set request.jwt.claim.sub = '40000000-0000-0000-0000-00000000000d';
select public.redeem_referral_code(:'code_n');
reset role;

\echo '=== M arrête son abonnement → X perd l accès, M ne lit plus X'
set role service_role; update public.profiles set subscription_status = 'canceled' where email = 'm@test'; reset role;
set role authenticated; set request.jwt.claim.sub = '30000000-0000-0000-0000-00000000000c';
select public.has_access() as acces_x, count(*) as lignes_x from public.user_days;
select coach_active from public.my_sponsor();
reset role;
set role authenticated; set request.jwt.claim.sub = '10000000-0000-0000-0000-00000000000a';
select count(*) as journees_de_x_vues_par_m_resilie from public.user_days where user_id = '30000000-0000-0000-0000-00000000000c';
reset role;

\echo '=== X s abonne lui-même → il retrouve ses données'
set role service_role; update public.profiles set subscription_status='active', current_period_end=now()+interval '30 days' where email='x@test'; reset role;
set role authenticated; set request.jwt.claim.sub = '30000000-0000-0000-0000-00000000000c';
select public.has_access() as acces_x, data from public.user_days;
reset role;

\echo '=== M se réabonne, nouveau code : X reste rattaché, l ancien code ne marche plus'
set role service_role; update public.profiles set subscription_status='active' where email='m@test'; reset role;
set role authenticated; set request.jwt.claim.sub = '10000000-0000-0000-0000-00000000000a';
select public.regenerate_referral_code() <> :'code_m' as nouveau_code;
select count(*) as challengers_toujours_la from public.my_challengers();
reset role;
set role authenticated; set request.jwt.claim.sub = '50000000-0000-0000-0000-00000000000e';
select public.redeem_referral_code(:'code_m');
reset role;

\echo '=== X retire son accord, puis quitte M'
set role authenticated; set request.jwt.claim.sub = '30000000-0000-0000-0000-00000000000c';
select public.set_share_with_sponsor(false);
reset role;
set role authenticated; set request.jwt.claim.sub = '10000000-0000-0000-0000-00000000000a';
select count(*) as journees_de_x_apres_retrait from public.user_days where user_id = '30000000-0000-0000-0000-00000000000c';
reset role;
set role authenticated; set request.jwt.claim.sub = '30000000-0000-0000-0000-00000000000c';
select public.leave_sponsor();
select count(*) as coach_de_x from public.my_sponsor();
reset role;

\echo '=== Un visiteur non connecté ne peut rien appeler'
set role anon;
select public.my_referral_code();
select public.redeem_referral_code('FIT-AAAAAA');
reset role;
