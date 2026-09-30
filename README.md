# Carnet d'entraînement

Page unique (`index.html`) + deux routes API (`/api/days`, `/api/settings`) qui parlent à Supabase côté serveur.

## 1. Supabase
1. Nouveau projet (région Paris `eu-west-3`).
2. SQL Editor → coller `supabase/schema.sql` → Run.
3. Settings → API : noter l'URL du projet et la clé `service_role`.

## 2. Vercel
1. Importer ce dossier (GitHub ou `npx vercel` dans le dossier).
2. Settings → Environment Variables :
   - `SUPABASE_URL` = URL du projet (https://xxxx.supabase.co)
   - `SUPABASE_SERVICE_ROLE_KEY` = clé service_role
   - `APP_PASSWORD` = (optionnel) mot de passe demandé une fois par appareil
3. Redéployer après avoir ajouté les variables.

## 3. Récupérer tes données
Dans l'ancien carnet (artefact Claude) : Historique → Exporter mes données → Copier.
Dans le nouveau : Historique → Importer une sauvegarde → coller → Importer ce contenu.

La clé service_role ne doit jamais être mise dans index.html ni commitée.
