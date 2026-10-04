# Afterwatch

**Founder:** John Diverson  
**Co-founder:** Astra

Application personnelle en français pour suivre anime, mangas, films et séries.

## Utilisation

1. Ouvrir le Catalogue : anime/mangas avec Kitsu et Jikan en secours, séries avec TVmaze, films avec Cinemeta. Parcourir les couvertures et pages de résultats ou rechercher un titre.
2. Cliquer sur une couverture pour lire le synopsis, les genres, la durée, les épisodes/chapitres/tomes et les saisons disponibles. Ajouter à la liste en un clic ; les informations et la couverture sont conservées. Les anciennes collections restent compatibles.
3. L’ajout manuel reste disponible pour un titre absent des catalogues.
2. Indiquer la progression, le total disponible, la durée, le statut et la priorité.
3. Régler les jours et la durée quotidienne. Le planning automatique propose sept jours et attend confirmation.
4. Marquer une séance terminée pour mettre à jour la progression. Les séances peuvent être déplacées ou retirées.
5. Dans Assistant Gemini, fournir une clé Google AI Studio d’un projet au palier gratuit sans facturation. La clé saisie est conservée seulement en mémoire de l’écran, pas en base ou dans le dépôt. Changer d’écran la supprime.

Les rappels sont délivrés tant que l’application reste ouverte. Aucun push en arrière-plan n’est configuré. Les réponses Gemini sont des suggestions et ne modifient pas les données. Gemini n’interroge pas les sorties en direct. Les compteurs d’épisodes disponibles sont à vérifier par l’utilisateur.

## Architecture

React / TypeScript, Vinext, Cloudflare Workers, D1. Les données sont stockées par utilisateur authentifié avec contrôle de version optimiste. Une version périmée est refusée au lieu d’écraser une modification d’un autre appareil. Authentification fournie par la plateforme Sites (en-têtes vérifiés par le dispatcher) ; ne jamais accepter ces en-têtes depuis Internet sans cette frontière de confiance.

L’API `/api/assistant` contacte exclusivement Gemini 2.5 Flash par HTTPS avec la clé dans l’en-tête `x-goog-api-key`. Aucun appel IA automatique, aucun mécanisme de passage vers une offre payante. L’application ne peut pas inspecter la facturation du projet Google ; l’utilisateur doit choisir un projet sans facturation pour garantir le palier gratuit.

## Développement

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm exec tsc --noEmit
node tests/catalog.mjs
pnpm run db:generate
pnpm build
```

La base locale doit recevoir la migration `drizzle/0000_purple_goliath.sql` après génération de la configuration Worker. La variable optionnelle `GEMINI_API_KEY` peut être configurée comme secret serveur ; `.env.example` ne contient aucune valeur réelle. Ne jamais committer `.env`, une clé ou les données runtime.

## GitHub et hébergement

Dépôt : https://github.com/DINO060/AFTERWATCH

Pour reprendre dans VS Code : clone ce dépôt, ouvre le dossier et lis [CODEX_HANDOFF.md](CODEX_HANDOFF.md).

Le code peut être placé dans un dépôt GitHub privé. GitHub Pages seul ne peut pas exécuter ce backend ni D1 : la version construite est déployée sur Sites. Une migration vers un autre hébergeur exige d’adapter le stockage et l’authentification ; ne pas publier tel quel en supprimant les protections.

Après extraction du ZIP, crée un dépôt GitHub privé vide, puis, depuis ce dossier :

```sh
git init
git add .
git commit -m "Initial Afterwatch source"
git remote add github https://github.com/VOTRE_COMPTE/afterwatch.git
git push github HEAD:main
```

Les services de métadonnées sont externes et peuvent être temporairement indisponibles ou limiter les appels. Aucune exhaustivité mondiale n’est garantie. Les chiffres absents restent inconnus et les synopsis gardent la langue fournie par la source.

Le catalogue appelle d’abord les API depuis le serveur avec un délai borné. En cas de panne réseau, le navigateur peut joindre directement leurs endpoints publics CORS ; seul le terme de recherche est envoyé, jamais la collection ni la clé Gemini. Les routes catalogue ne lisent aucune donnée personnelle et restent derrière l’accès privé du site. Les routes de collection et Gemini exigent toujours une identité connectée.

Les sources contiennent une illustration originale générée pour Afterwatch. Les affiches importées restent attribuées aux catalogues : Kitsu, Jikan / MyAnimeList, TVmaze (CC BY-SA), et Cinemeta / IMDb. Aucun contenu vidéo ou manga n’est hébergé.

## Installer sur téléphone ou ordinateur

Le bouton « Installer l’app » utilise le mécanisme PWA du navigateur. Chrome/Edge peuvent proposer une installation ; Safari sur iPhone propose Partager → Sur l’écran d’accueil. Le manifeste, les icônes et un écran hors connexion sont inclus. Internet reste nécessaire pour la collection, le catalogue et Gemini. Le service worker ne met pas en cache les pages privées ni les réponses API. Ce projet ne génère pas d’APK ou d’installateur Windows.

## Nom de domaine

L’achat d’un domaine fournit une adresse, pas un serveur. La version actuelle peut recevoir un domaine personnalisé via Sites. Il faut d’abord enregistrer le nom exact sur l’hébergement, puis recopier les enregistrements DNS de validation et de routage fournis par celui-ci chez le registrar. Ne pas deviner les cibles DNS ni supprimer les enregistrements e-mail.

## Vérification réalisée

Compilation TypeScript et build Worker. Tests de régression catalogue : normalisation des métadonnées, valeurs inconnues, repli entre sources, pagination, annulation et validation des références. Tests du planificateur : ordre des priorités, budget quotidien, jours disponibles, absence de doublons, progression, total inconnu et fin avant minuit. L’appel Gemini réel nécessite une clé de l’utilisateur. Aucun test navigateur automatisé disponible dans cet environnement.

## Contenu de l’archive source

Le ZIP contient le code React/TypeScript, les routes serveur, les migrations D1, les composants, les ressources, les tests et le fichier de dépendances verrouillées. Il ne contient ni clés API, ni collection personnelle, ni dépendances installées. Le code est librement modifiable ; les affiches externes restent la propriété de leurs ayants droit. Pour redéployer hors de Sites, adapter impérativement l’authentification `lib/server.ts` et le binding D1. Les en-têtes `oai-authenticated-user-*` ne sont fiables que derrière le dispatcher Sites.

## License

Original Afterwatch code is licensed under the MIT License. See [LICENSE.md](LICENSE.md). Third-party dependencies retain their respective licenses. External covers, catalog metadata and other third-party material are not relicensed by this file. Project credits are listed in [AUTHORS.md](AUTHORS.md).
