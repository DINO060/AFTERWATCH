# Afterwatch

**Founder:** John Diverson  
**Co-founder:** Astra

Application en français pour organiser anime, mangas, films et séries : catalogue,
collection privée, progression, priorités et planning hebdomadaire.

La migration vise **Next.js sur Vercel** et **Supabase Auth / PostgreSQL**.
Le catalogue est accessible sans compte. Un compte est nécessaire pour enregistrer
une collection, un planning ou utiliser Gemini.

## Développement

Node >= 22.13.0 et npm 10 sont requis.

```sh
npm install
# Copier .env.example vers .env.local et renseigner les valeurs publiques Supabase.
npm run dev
npm run typecheck
npm test
npm run build
```

L'installation génère `package-lock.json`. Le vérifier et le committer avant la
publication ; les anciennes dépendances et le verrou pnpm de Sites ont été retirés.
Le build de cette migration reste à vérifier après installation des dépendances.
Sans configuration Supabase, le catalogue reste utilisable et la connexion est
désactivée. Aucun utilisateur de développement partagé ne remplace une vraie session.

## Connexion et données

- Connexion par lien envoyé à l'adresse e-mail, sans mot de passe.
- Connexion Telegram optionnelle via un fournisseur OIDC personnalisé Supabase.
- Dans « Mon compte », un membre connecté par e-mail peut lier Telegram à son
  compte existant. Se connecter séparément avec Telegram peut créer un autre compte.
- Chaque collection est liée à l'identifiant vérifié du compte Supabase.
- La table est protégée par RLS. Les écritures passent par une fonction atomique
  qui refuse une version périmée ; l'API vérifie aussi le compte attendu par l'écran.
- Les sessions et les réponses de collection ne sont pas mises en cache.

L'utilisateur a confirmé avoir créé le projet Supabase. Sa Project URL et sa
Publishable key restent à fournir ; l'exécution de la migration SQL n'a pas encore
été confirmée. La création du projet Vercel et la configuration des e-mails et de
Telegram restent à confirmer. Le parcours utilise les tableaux de bord web,
sans installation de plugin Supabase. Les étapes sont dans
[DEPLOYMENT.md](DEPLOYMENT.md) ; l'état de reprise est dans
[CODEX_HANDOFF.md](CODEX_HANDOFF.md).

## Fonctionnalités

Le catalogue utilise Kitsu, Jikan en secours, TVmaze et Cinemeta. Les fiches
conservent synopsis, genres et compteurs disponibles ; les nombres et dates absents
restent inconnus. L'ajout manuel reste disponible.

Le planning automatique respecte les priorités, les jours disponibles et le budget
quotidien. Il attend confirmation avant d'ajouter les séances. Terminer une séance
met à jour la progression.

Gemini 2.5 Flash répond uniquement sur demande. Chaque utilisateur peut fournir sa
clé Google AI Studio d'un projet sans facturation. Cette clé reste en mémoire dans
l'écran, n'est pas enregistrée dans la collection et disparaît en quittant l'écran.
Le serveur contacte exclusivement l'API Gemini par HTTPS. Aucun appel OpenAI ni
basculement automatique vers une offre payante n'est ajouté.

`GEMINI_API_KEY` est facultative. Sur un site public, la laisser vide permet à
chaque utilisateur d'utiliser son propre quota. L'application ne peut pas vérifier
la facturation d'un projet Google. Gemini conseille sans modifier les données et
ne vérifie pas les sorties en direct.

Les rappels nécessitent une application ouverte. Lier Telegram n'active pas encore
de rappels dans Telegram : un bot et un ordonnanceur restent à développer.

La PWA dispose d'un manifeste et d'un écran hors connexion. Internet reste requis
pour les données, le catalogue et Gemini. Le service worker ne conserve aucune
page privée ni réponse API. Aucun APK ou installateur Windows n'est généré.

## Fichiers principaux

- `app/watch-app.tsx` : application, accès invité et collection.
- `app/auth-panel.tsx`, `lib/auth.ts`, `lib/supabase/`, `proxy.ts` : comptes et sessions.
- `app/auth/callback/route.ts` : retour des liens e-mail et du flux OAuth.
- `app/catalog-browser.tsx`, `lib/catalog-*` : catalogue et fiches.
- `lib/watch.ts` : données et planificateur.
- `lib/server.ts`, `app/api/state/route.ts` : validation et sauvegarde.
- `supabase/migrations/` : schéma PostgreSQL, RLS et contrôle de version.
- `supabase/tests/` : tests SQL d'isolation et de conflits de version.
- `app/api/assistant/route.ts` : Gemini.
- `vercel.json` : configuration du déploiement Next.js.

Le fichier `.openai/hosting.json` identifie l'ancien hébergement Sites. Le nouveau
runtime n'en dépend pas. Aucun déploiement Vercel n'est effectué par ce fichier.

## Vérification de la migration

Les tests du catalogue et les tests des redirections, origines et paramètres de
connexion ont été exécutés. L'installation des dépendances n'a pas été autorisée
dans cette session : le build, le contrôle complet des types, les tests SQL sur une
base réelle et les parcours e-mail/Telegram restent à exécuter avant publication.
L'ancien site déployé n'a pas été remplacé.

## Licence et sources

Code original sous [licence MIT](LICENSE.md). Crédits dans [AUTHORS.md](AUTHORS.md).
L'illustration Afterwatch est originale. Les affiches et métadonnées externes restent
attribuées à Kitsu, Jikan / MyAnimeList, TVmaze (CC BY-SA), Cinemeta / IMDb et leurs
ayants droit. Aucun contenu vidéo ou manga n'est hébergé. Les services externes
peuvent être indisponibles ou limiter les appels.
