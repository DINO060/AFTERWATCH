# Déployer Afterwatch avec Supabase et Vercel

Les fichiers de migration sont préparés localement. L'utilisateur a confirmé la
création de son projet Supabase ; la migration SQL et la configuration du projet
restent à confirmer. La création du projet Vercel n'a pas été confirmée.

Le parcours choisi utilise les tableaux de bord dans le navigateur : **aucun plugin
Supabase ou Vercel n'est requis**. L'utilisateur a refusé l'installation du plugin
Supabase. Les dépendances npm du code constituent une étape distincte ; leur
installation et le build restent en attente d'un accès au registre autorisé.

## 1. Supabase

Ouvrir le projet Supabase déjà créé. Les réglages conseillés sont :

- **Enable Data API** : coché.
- **Automatically expose new tables** : décoché.
- **Enable automatic RLS** : coché.

Dans **SQL Editor → New query**, copier le contenu de
[`supabase/migrations/202610040001_watch_states.sql`](supabase/migrations/202610040001_watch_states.sql)
et cliquer sur **Run**. Vérifier le résultat. Si la migration a déjà été exécutée,
vérifier l'état de la base avant de relancer ce script de création.
Elle crée la table privée `watch_states`, ses protections RLS et la fonction de
sauvegarde. Les anciens fichiers SQLite/D1 ne s'appliquent pas à PostgreSQL.

Les tests de `supabase/tests/watch_states.sql` sont transactionnels et annulent
leurs écritures. Les exécuter avec l'éditeur SQL sur une base de développement.
Ils nécessitent les rôles et le schéma Auth de Supabase.

Depuis **Connect** (ou Project Settings > API), récupérer la **Project URL** et la
**Publishable key**. Ces valeurs n'ont pas encore été fournies pour Afterwatch.
Les renseigner dans `.env.local` pour le développement :

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://VOTRE-PROJET.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=VOTRE_CLE_PUBLIQUE
```

Le fichier `.env.local` reste ignoré par Git ; `.env.example` reste un modèle vide.
Ces variables sont publiques par conception ; **ne jamais utiliser une clé
service-role ou une clé secrète**. Les sessions de chaque utilisateur et RLS
protègent les collections. Aucune clé d'administration n'est requise par l'app.

## 2. E-mails de connexion

Activer Email dans Authentication > Providers et autoriser les nouvelles inscriptions.
Les utilisateurs reçoivent un lien de connexion, sans choisir de mot de passe.

Configurer un fournisseur SMTP de production dans Supabase (par exemple Resend,
Brevo ou un autre service compatible), avec une adresse d'envoi sur un domaine
vérifié. Le SMTP de démonstration Supabase envoie uniquement aux membres autorisés
du projet et ne suffit pas pour les visiteurs publics.
[Documentation SMTP Supabase](https://supabase.com/docs/guides/auth/auth-smtp)

Dans Authentication > URL Configuration, définir :

- Site URL : l'origine finale Vercel ou le domaine personnalisé.
- Redirect URLs : `https://VOTRE-SITE/auth/callback`.
- Pour les essais locaux : `http://localhost:3000/auth/callback`.

Éviter des redirections génériques vers des domaines non maîtrisés. Pour la connexion
e-mail PKCE par défaut, ouvrir le lien dans le navigateur qui l'a demandé.
Une alternative prise en charge par le callback consiste à utiliser ce lien dans
le modèle Magic Link de Supabase :

```html
<a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email">Me connecter à Afterwatch</a>
```

Les liens sont vérifiés côté serveur et leurs réponses ne sont pas mises en cache.
Ne pas transmettre les liens contenant un jeton à un tiers.

## 3. Telegram, facultatif

Créer un bot Afterwatch avec BotFather et obtenir ses identifiants de connexion
Telegram (Client ID et Client Secret, dans Login Widget).

Dans Supabase Auth > Providers, ajouter un fournisseur OIDC personnalisé :

- Identifiant : `custom:telegram`.
- Issuer : `https://oauth.telegram.org`.
- Client ID et Client Secret : ceux de BotFather, conservés côté Supabase.
- Scopes : `openid profile` ; aucun numéro de téléphone requis.
- `email_optional: true` : Telegram ne fournit pas d'adresse e-mail.
- PKCE activé et vérification du nonce conservée.

Copier **l'URL de callback fournie par Supabase** dans les Allowed URLs de BotFather.
Il s'agit du callback du fournisseur Supabase, différent du retour final
`/auth/callback` de l'application. Telegram ne fournit pas de endpoint UserInfo
séparé ; le fournisseur doit utiliser les claims vérifiés de l'ID token.

Activer la liaison manuelle des identités dans Supabase pour permettre le bouton
« Lier mon compte Telegram » depuis un compte e-mail existant. Configurer ensuite :

```dotenv
NEXT_PUBLIC_TELEGRAM_AUTH_PROVIDER=custom:telegram
```

Ne renseigner cette variable qu'après configuration et validation du fournisseur.
Le bouton Telegram reste masqué si elle est vide. Le Client Secret ne va jamais
dans les variables publiques Vercel. Se connecter avec Telegram avant d'avoir lié
son compte e-mail peut créer un compte distinct : la liaison se fait depuis le
compte existant, après connexion.

La connexion Telegram n'active pas de rappels. Cette fonctionnalité nécessitera
une autorisation de messages, un bot et une planification côté serveur.
[Supabase OIDC](https://supabase.com/docs/guides/auth/custom-oauth-providers),
[Telegram Login](https://core.telegram.org/bots/telegram-login),
[Liaison d'identités](https://supabase.com/docs/guides/auth/auth-identity-linking).

## 4. Installer et valider le code

```sh
npm install
npm run typecheck
npm test
npm run build
```

L'installation crée `package-lock.json`. Le vérifier et le committer avec la
migration avant de déployer. Dans les installations suivantes, utiliser `npm ci`.
Les tests SQL doivent aussi passer sur un projet Supabase de développement.

## 5. Vercel

Importer le dépôt GitHub `DINO060/AFTERWATCH` dans Vercel après avoir poussé les
changements vérifiés. Framework : Next.js. Le code contient `vercel.json` et les
scripts `dev`, `build`, `start`. Sélectionner Node 22.x ou une version compatible.

Ajouter les deux variables publiques Supabase dans les environnements nécessaires.
Ajouter la variable Telegram seulement si son fournisseur fonctionne. Ces valeurs
`NEXT_PUBLIC_*` sont intégrées au build : les modifier exige un nouveau déploiement.

`GEMINI_API_KEY` (clé Google AI Studio) active l'assistant pour tous les membres, avec une limite
de 30 messages par membre et par jour : exécuter d'abord
`supabase/migrations/202610070002_assistant_usage.sql`. Sans clé, l'assistant est désactivé.
Activer la facturation du projet Google avant l'ouverture au public : sur le palier gratuit,
Google peut utiliser les conversations pour améliorer ses produits. `GEMINI_MODEL` est facultatif.

Déployer d'abord une prévisualisation et tester : catalogue invité, lien e-mail,
Telegram, liaison de compte, sauvegarde sur deux appareils avec conflit de version,
déconnexion et accès refusé aux données d'un autre compte. Ajouter les URLs exactes
de prévisualisation à la liste Supabase si des essais de connexion sont nécessaires.

Une fois les validations réussies, publier la version de production et remplacer
les URLs Supabase par les origines finales. Ajouter éventuellement le domaine acheté
au projet Vercel et appliquer les enregistrements DNS fournis par Vercel chez le
registrar. Conserver les enregistrements d'e-mail.
[Next.js sur Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs).

## Collections de l'ancien site

Aucune collection personnelle n'est incluse dans le dépôt. Une collection existante
sur Sites reste dans l'ancien D1 et n'apparaît pas automatiquement dans Supabase.
Tout import devra vérifier la propriété du compte et conserver la sauvegarde source.

## 6. Notifications (e-mail et téléphone)

Trois envois : rappel au début d'une séance, nouvel épisode (anime via AniList, séries
via TMDB/TVmaze) et résumé du lundi 9 h. Chaque membre les active dans « Mon compte ».

1. **SQL** : exécuter `supabase/migrations/202610060001_notifications.sql` une fois.
   Puis `202610070001_notifications_server_access.sql` : le projet n’expose pas
   automatiquement les nouvelles tables, le rôle serveur a besoin de droits explicites.
2. **Vercel → Environment Variables** (Production et Preview) : `SUPABASE_SECRET_KEY`
   (Supabase → Project Settings → API Keys → Secret key), `RESEND_API_KEY` (Resend → API
   Keys, accès « Sending » au domaine), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
   et `CRON_SECRET` (générés dans `.env.local`). Redéployer ensuite.
3. **Planification Supabase** (SQL Editor), en remplaçant `COLLER_LE_CRON_SECRET` par la
   valeur de `CRON_SECRET` — ce secret ne doit jamais être commité :

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select vault.create_secret('COLLER_LE_CRON_SECRET', 'afterwatch_cron_secret');
select cron.schedule(
  'afterwatch-notify',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://www.afterwatch.online/api/cron/notify',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'afterwatch_cron_secret'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);
```

Vérifier les appels dans `cron.job_run_details` et les réponses dans `net._http_response`.
Pour arrêter : `select cron.unschedule('afterwatch-notify');`.
