# Tests de l'écran de connexion (sans vrai Supabase)

`fake_supabase.cjs` imite le client Supabase en mémoire, avec les mêmes règles d'accès que la base (un utilisateur sans accès actif ne lit ni n'écrit rien). `test_auth.mjs` ouvre la vraie page `index.html` dans un navigateur simulé (jsdom) et rejoue 27 scénarios : inscription, connexion, erreurs, écran « pas d'accès », code de parrainage, enregistrement au nom du bon compte, perte d'accès en cours de route, déconnexion, mot de passe oublié, lien expiré, deux comptes sur le même appareil.

Lancer, depuis la racine du repo :

```
npm i --no-save jsdom@24
node tests/front/test_auth.mjs
```
