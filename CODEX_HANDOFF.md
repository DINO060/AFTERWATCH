# Reprendre Afterwatch

## Objectif accepté — 4 octobre 2026

John Diverson veut rendre Afterwatch public avec **Supabase et Vercel**.
Catalogue sans connexion ; connexion par e-mail et Telegram optionnel pour les
collections privées. Pas de connexion SMS prévue au lancement.
John Diverson est le fondateur ; Astra est crédité comme cofondateur.

## Migration locale

- Vinext, Cloudflare Workers et D1 remplacés par Next.js et Supabase PostgreSQL.
- Scripts npm standard pour Vercel. Le verrou npm doit être généré et committé
  après installation des dépendances.
- Authentification Supabase avec sessions vérifiées côté serveur ; aucun en-tête
  `oai-authenticated-user-*` ni utilisateur partagé de développement accepté.
- Connexion e-mail par lien et écran « Mon compte » ; Telegram activable par
  fournisseur OIDC personnalisé `custom:telegram`.
- Accès invité au catalogue ; ajout et données personnelles réservés aux membres.
- Contrôle de version de collection conservé avec RPC PostgreSQL atomique et RLS.
- Le compte attendu par l'écran est vérifié à la sauvegarde pour éviter d'écrire
  des données d'un ancien compte dans un autre compte après un changement de session.

Voir [README.md](README.md) et [DEPLOYMENT.md](DEPLOYMENT.md) pour les fichiers et
la configuration. `.env.example` contient uniquement des noms de variables vides.

## État réel et prochaines étapes

**Dernière mise à jour (4 octobre 2026, soir) — remplace les points contraires ci-dessous :**

- Projet Supabase `AFTERWATCH` (ref `wqulfvkpelhdzewkyzcb`). L'utilisateur a exécuté
  la migration et le fichier de tests dans le SQL Editor. Vérifié depuis l'API publique :
  `watch_states` existe et l'accès anonyme est refusé (42501). **Ne pas relancer la
  migration** et ne jamais accorder de droits à `anon`.
- `.env.local` local contient la Project URL et la Publishable key (fichier ignoré par Git).
- `npm install` effectué, `package-lock.json` généré. `typecheck`, `npm test` et
  `npm run build` passent. `npm run lint` signale des règles de style préexistantes
  (`no-explicit-any`, `set-state-in-effect`), sans bloquer le build.
- Corrigés : boucle de rechargement après connexion (`app/watch-app.tsx`, événement
  `SIGNED_IN` émis avant la réponse de `/api/auth/user`) et redirection ouverte via
  segments `/.//` dans `lib/auth-redirect.ts` (tests ajoutés).
- Hébergement choisi : Vercel avec le domaine de l'utilisateur. GitHub Pages ne convient
  pas (routes serveur). Restent : projet Vercel, domaine/DNS, URLs Supabase de production,
  SMTP, CAPTCHA, essai de connexion réel dans un navigateur.

**Mise à jour du 4 octobre 2026 :** l'utilisateur a confirmé avoir créé son projet
Supabase. Le nom, l'identifiant, la Project URL et la Publishable key n'ont pas
encore été communiqués. La création du projet Vercel n'a pas été confirmée.

L'utilisateur **ne veut pas installer le plugin Supabase**. Continuer avec le
tableau de bord Supabase dans son navigateur et la configuration locale du code.
Aucun plugin n'est nécessaire à ce parcours. Ne pas imposer son installation ni
la reproposer comme condition pour continuer. Le choix de Supabase pour le site
reste confirmé.

La création du projet ne donne aucun accès automatique à son compte. Le plugin
n'est pas connecté et la vérification par la CLI n'a pas été autorisée. Aucune
migration SQL ni modification distante n'a été exécutée par l'assistant. L'utilisateur
n'a pas encore confirmé avoir exécuté le fichier SQL dans son tableau de bord.

Prochaines étapes concrètes :

1. Dans le projet Supabase existant, ouvrir **SQL Editor → New query**, copier
   `supabase/migrations/202610040001_watch_states.sql`, puis cliquer sur **Run**.
   Vérifier le résultat avant de considérer les tables et règles RLS comme installées.
   Ce script de création doit être exécuté une seule fois ; si son exécution a déjà
   été tentée, vérifier les objets existants avant de le relancer.
2. Depuis **Connect**, fournir uniquement la **Project URL** et la **Publishable key**
   (`sb_publishable_…`). Configurer `NEXT_PUBLIC_SUPABASE_URL` et
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` dans `.env.local`, puis dans Vercel.
   Garder les mots de passe et les clés secrètes hors du chat et du dépôt.
3. Configurer l'envoi des e-mails, les URLs de retour et, si souhaité, le bot et le
   fournisseur Telegram. Supabase exige un SMTP de production pour envoyer des
   liens aux visiteurs publics. Ces configurations restent à confirmer.
4. Installer les dépendances quand l'accès npm sera autorisé, générer le verrou,
   vérifier les types et le build, puis tester sur une base Supabase de développement.
5. Créer ou identifier le projet Vercel via son tableau de bord, configurer les
   variables et valider une prévisualisation avant la publication.

Réglages conseillés lors de la création Supabase : **Enable Data API** coché,
**Automatically expose new tables** décoché et **Enable automatic RLS** coché.
Ces recommandations ont été données à partir d'une capture ; leur application
effective n'a pas été vérifiée. La migration définit les autorisations et RLS.

Les tests existants du catalogue et cinq tests de sécurité de connexion passent.
La syntaxe et les imports locaux de 91 fichiers TypeScript ont été vérifiés avec
une installation locale existante, sans installer les dépendances du projet.
Le schéma JSON de la migration a également accepté les six exemples valides du
fichier de tests et rejeté des documents incomplets et budgets invalides ; cela ne
remplace pas l'exécution SQL sur PostgreSQL.

L'accès au registre npm a été refusé séparément de l'installation du plugin.
Le contrôle complet des types, le build Next.js, les tests SQL et les parcours
navigateur/e-mail/Telegram restent à réaliser. Ne pas présenter cette copie comme
publiée ou intégralement validée. Les changements sont locaux ; aucun commit ni
push de cette migration sur GitHub et aucun déploiement Vercel n'ont été effectués.

## Données et services

Aucune collection personnelle ni clé n'est incluse dans le dépôt. Les collections
de l'ancien D1 n'ont pas été transférées : les identifiants Sites et Supabase sont
différents. Une éventuelle importation doit vérifier le propriétaire des deux
comptes et conserver les données originales avant toute écriture.

Gemini reste à la demande, sans tokens OpenAI payants. La clé saisie reste en mémoire
de l'écran uniquement. Laisser `GEMINI_API_KEY` vide au lancement public évite de
partager le quota du propriétaire. Préserver les compteurs inconnus des catalogues.

Les rappels nécessitent toujours une app ouverte. Aucune notification Telegram
planifiée ni notification push en arrière-plan n'est encore implémentée. La PWA
ne met en cache que l'écran hors connexion générique, jamais les données privées.

## Hébergement

L'ancien site est https://afterwatch-john.johndiverson0.chatgpt.site ; aucun changement
n'y a été publié. `.openai/hosting.json` est sa référence historique. Le choix actuel
est Vercel, et cette migration ne doit pas être déployée via Sites.

Le domaine a été acheté, mais son nom et son registrar n'ont pas été communiqués.
Ajouter le domaine au projet Vercel et suivre les enregistrements DNS qu'il fournit.
Ne pas deviner les cibles DNS ni supprimer les enregistrements d'e-mail.
