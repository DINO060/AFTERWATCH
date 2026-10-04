# Reprendre Afterwatch avec Codex dans VS Code

## But du projet
Application personnelle en français pour organiser anime, mangas, films et séries : catalogue, collection, priorités, progression, planning hebdomadaire et rappels pendant que l’app reste ouverte. John Diverson est le fondateur ; Astra est crédité comme cofondateur.

## Version transférée
Code de la version déployée et corrigée le 4 octobre 2026, avec licence MIT et crédits ajoutés. Site actuel : https://afterwatch-john.johndiverson0.chatgpt.site. L’envoi sur GitHub ne remplace pas cet hébergement et ne configure aucun déploiement automatique.

## Stack et dossiers
- React 19, TypeScript, Vinext/Vite, composants shadcn, Cloudflare Workers et D1.
- `app/watch-app.tsx` : collection, priorités, progression, planning, rappels et écran Gemini.
- `app/catalog-browser.tsx` : catalogue et fiches.
- `lib/catalog-gateway.ts`, `catalog-server.ts`, `catalog-client.ts` : Kitsu, Jikan en secours, TVmaze et Cinemeta, cache et accès CORS de secours.
- `lib/watch.ts` : modèle de données et planificateur.
- `lib/server.ts`, `app/api/state/route.ts` : validation, identité, persistance et contrôle de version.
- `app/api/assistant/route.ts` : Gemini 2.5 Flash, à la demande uniquement.
- `db/schema.ts`, `drizzle/` : schéma et migration D1.
- `public/manifest.webmanifest`, `public/sw.js`, `app/install-app.tsx` : installation PWA et écran hors connexion. Aucune page privée ni réponse API n’est mise en cache.

## Installation locale
Node >= 22.13.0 et pnpm 11.25.0 sont déclarés dans `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Le projet utilise `cloudflare:workers` et un binding D1 `DB`. Le démarrage hors de l’environnement Sites n’a pas été vérifié : vérifier la configuration Worker/Vinext et appliquer la migration D1 à une base locale avant de tester la collection. Lire les scripts et le README avant d’adapter l’hébergement.

## Vérifications existantes
```sh
pnpm exec tsc --noEmit
node tests/catalog.mjs
pnpm build
```

La compilation et le build ont réussi dans l’environnement d’origine. Les catalogues, recherches et fiches des quatre catégories ont répondu en production. La connexion Gemini réelle nécessite la clé de l’utilisateur. L’installation PWA et l’ensemble des parcours n’ont pas fait l’objet d’un test navigateur automatisé.

## Points à garder en tête
- L’authentification actuelle est fournie par Sites. Les en-têtes `oai-authenticated-user-*` ne sont fiables que derrière son dispatcher. Pour un autre hébergeur, remplacer cette authentification par une vérification serveur appropriée ; ne pas exposer directement ces en-têtes comme preuve d’identité.
- La collection est stockée côté serveur par utilisateur. Préserver le contrôle de version pour éviter les écrasements entre appareils. Aucune collection personnelle n’est incluse dans ce dépôt.
- L’utilisateur veut Gemini sans tokens OpenAI payants. La clé saisie reste seulement en mémoire de l’écran ; ne pas la committer ni la stocker dans la collection.
- Les compteurs inconnus des API doivent rester inconnus. Ne pas inventer de nombres d’épisodes ou de dates de sortie.
- Les rappels actuels nécessitent une app ouverte ; les notifications push lorsque l’app est fermée ne sont pas encore implémentées.
- Le domaine a été acheté, mais son nom et son registrar n’ont pas encore été fournis. La configuration DNS reste à faire.
- GitHub Pages seul ne peut pas exécuter le backend de cette version.
