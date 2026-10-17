# Tests de sécurité (RLS)

Ces scripts vérifient, sur un Postgres local, que les règles de `migrations/001_multi_utilisateurs.sql` font bien ce qu'on attend.
Ils ne sont **pas** à lancer dans Supabase.

1. `00_simulation_supabase.sql` recrée le minimum de Supabase : les rôles `anon`, `authenticated`, `service_role`, la table `auth.users` et la fonction `auth.uid()`.
2. `../migrations/001_multi_utilisateurs.sql` crée les tables et les règles.
3. `01_test_securite.sql` simule 4 comptes (abonné, non abonné, accès offert, abonnement expiré) et un visiteur non connecté.

Résultats attendus :

| Situation | Résultat |
|---|---|
| Abonné lit et écrit ses journées | ✅ autorisé |
| Abonné écrit une journée au nom d'un autre | ❌ `violates row-level security policy` |
| Abonné se donne l'accès offert (`comp`) | ❌ `permission denied` |
| Non abonné lit ou écrit des journées | ❌ 0 ligne visible, écriture refusée |
| Non abonné lit son profil | ✅ (pour savoir qu'il doit payer) |
| Non abonné modifie la journée d'un autre | ❌ `UPDATE 0` |
| Accès offert | ✅ ne voit que ses lignes |
| Abonnement expiré | ❌ bloqué |
| Visiteur non connecté | ❌ `permission denied` |
| Abonné qui résilie | ❌ ne voit plus rien, mais ses données restent en base |
| Compte supprimé | ses données partent avec (cascade) |
