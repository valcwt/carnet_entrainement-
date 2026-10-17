# Feuille de route — Carnet d'entraînement multi-utilisateurs

Projet d'apprentissage : transformer le carnet perso en app à abonnement, sur le modèle FitMotivator / challengers.
Tout se fait sur la branche `multi-utilisateurs` ; le carnet en production (`main`) n'est pas touché tant que ce n'est pas fini.

Légende : ✅ fait · 🔄 en cours · 🔲 à faire · ⏸️ plus tard

---

## Les comptes

| Profil | Accès | Particularités |
|---|---|---|
| **Abonné solo** | Son abonnement | Tout le carnet |
| **Challenger** | Code de son FitMotivator (gratuit) **ou** son propre abonnement | Peut partager ses données en lecture avec son FitMotivator (accord révocable) |
| **FitMotivator** | Son abonnement FitMotivator | Inclut ses challengers en illimité ; voit leurs données avec accord |

- Un challenger qui paie garde son accès quoi que fasse son FitMotivator, et garde toujours ses données.
- Quand il passe en solo, il choisit : rester avec son coach et partager / rester sans partager / quitter son coach.
- Pas d'essai gratuit. Abonnement arrêté = plus aucun accès (les données restent en base et reviennent au réabonnement).

## Grille tarifaire (fictive, Stripe en mode test)

| Offre | Semaine | Mois | An | Rôle accordé |
|---|---|---|---|---|
| Challenger / solo | 2,99 € | 9,99 € | 89 € | `user` |
| FitMotivator | 7,99 € | 24,99 € | 229 € | `fitmotivator` |

## Code de parrainage d'un challenger abonné (avec récompense)

- Un challenger (ou solo) **qui paie** reçoit aussi un code. Contrairement à celui d'un FitMotivator, il **n'offre pas l'accès** : la personne invitée doit s'abonner.
- Quand l'invité paie sa première échéance, le parrain gagne **1 mois offert** (crédit sur son compte Stripe). Plafond proposé : 12 mois offerts par an — *à valider*.
- En base : un champ `referred_by` séparé de `sponsor_id`. « Qui m'a amené » et « qui m'offre l'accès » sont deux choses différentes.

---

## Étapes

### 1. Comptes et sécurité
- ✅ Tables multi-utilisateurs + RLS (`supabase/migrations/001_multi_utilisateurs.sql`)
- ✅ Parrainage FitMotivator : codes, challengers, partage en lecture (`002_parrainage_fitmotivator.sql`)
- ✅ Tests de sécurité sur Postgres local (`supabase/tests/`)
- 🔲 Lancer 001 puis 002 dans le SQL Editor de Supabase
- 🔲 Authentification : inscription, connexion, mot de passe oublié (Supabase Auth)
- 🔲 Front : écran de connexion, lecture/écriture directe dans Supabase, cache local par utilisateur
- 🔲 Premier lancement : assistant de départ + modèles génériques ; retirer les données perso du code
- 🔲 Écrans parrainage : saisir un code, liste des challengers, vue coach, accord de partage

### 2. Stripe (mode test)
- 🔲 Offres et prix semaine / mois / an, chaque offre accorde son rôle (migration 003)
- 🔲 Tunnel de paiement (Checkout) + pages de succès et d'échec
- 🔲 Webhook signé `/api/stripe-webhook` : synchronise statut, fin de période et rôle
- 🔲 Tâche planifiée quotidienne de rattrapage (si un webhook a été manqué)
- 🔲 Portail client : changer de carte, arrêter le renouvellement, consulter son abonnement depuis l'app
- 🔲 Passage challenger → FitMotivator **sans double prélèvement** (modification de l'abonnement avec prorata, pas de second abonnement)
- 🔲 Solo déjà abonné qui entre un code FitMotivator : lui proposer de résilier
- 🔲 Récompense de parrainage challenger (1 mois offert) + champ `referred_by`
- 🔲 Tests : paiement, webhooks, attribution de l'accès, non-régression FitMotivator

### 3. QR code de parrainage
- 🔲 QR code du code de parrainage, affichage plein écran
- 🔲 Partage en image
- 🔲 Page d'arrivée sur mobile (le code se pré-remplit à l'inscription)

### 4. Programmes personnalisés
- 🔲 Bibliothèque d'exercices
- 🔲 L'utilisateur compose ses séances et son programme
- 🔲 Calendrier de programme fiable + replanifier depuis une séance

### 5. Interface
- 🔲 Refonte ergonomie, agencement, styles

### 6. Fusion
- 🔲 Migrer le carnet actuel dans le compte de Valentin, basculer la production, supprimer les anciennes tables `days` / `settings`

---

## TODO — plus tard
- ⏸️ **E-mails transactionnels** : confirmation de paiement, échec de paiement, fin d'abonnement, bienvenue (service d'envoi type Resend)
- ⏸️ Écran de lecture des **Tips** (conseils)
- ⏸️ Analyse de la semaine par IA (bilan du vendredi)
- ⏸️ Connexion avec Google
- ⏸️ Si ouverture au public : noms propres pour l'app et les rôles, RGPD (consentement données de santé, export / suppression du compte), offre Vercel Pro si payant
