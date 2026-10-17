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

## Parrainage FitMotivator — `02_test_parrainage.sql`

À lancer après `001` et `002`. Comptes : M = FitMotivator abonné, N = FitMotivator sans abonnement, X et Y = challengers, Z = simple utilisateur.

| Situation | Résultat |
|---|---|
| M obtient son code (`FIT-XXXXXX`, toujours le même) | ✅ |
| M utilise son propre code | ❌ « Tu ne peux pas utiliser ton propre code. » |
| Z (pas FitMotivator) demande un code | ❌ « Réservé aux FitMotivators. » |
| Z appelle le générateur interne de codes | ❌ `permission denied` |
| X utilise un code inexistant | ❌ « Code de parrainage invalide. » |
| X utilise le code de M (minuscules, espaces) | ✅ accès ouvert, X écrit ses journées |
| M lit les journées de X **sans accord** | ❌ 0 ligne |
| X accepte le partage → M lit | ✅ en lecture seule |
| M modifie / supprime / crée une journée de X | ❌ 0 ligne ou `violates row-level security` |
| M lit le profil (paiement) de X | ❌ ne voit que le sien |
| M lit ou retire Y (pas son challenger) | ❌ |
| Y utilise le code de N (sans abonnement) | ❌ « L'abonnement de ce FitMotivator n'est pas actif. » |
| M résilie | ❌ X perd l'accès, M ne lit plus X |
| X s'abonne lui-même | ✅ il retrouve toutes ses données |
| M change de code | ✅ X reste rattaché, l'ancien code est refusé |
| X retire son accord, puis quitte M | ✅ M ne voit plus rien |
| Visiteur non connecté appelle les fonctions | ❌ `permission denied` |

Bug trouvé par ces tests : sans abonnement, `subscription_status` vaut `NULL`, et en SQL `NULL = 'active'` vaut `NULL` (ni vrai ni faux). `if not has_own_access(...)` devenait `if NULL`, donc la vérification ne se déclenchait jamais et le code d'un FitMotivator non abonné était accepté. Corrigé avec `coalesce(..., false)`.
