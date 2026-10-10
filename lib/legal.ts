// Text of the legal pages (/mentions-legales, /confidentialite, /conditions) in both languages.
// Dependency-free (type imports only) so the tests can check it. Update `updated` with any change.
import type { Lang } from './i18n';

export const CONTACT_EMAIL = 'contact@afterwatch.online';
export type LegalBlock = string | { list: string[] };
export type LegalSection = { title: string; body: LegalBlock[] };
export type LegalDoc = { title: string; updated: string; intro: string; sections: LegalSection[] };
export type LegalKind = 'notice' | 'privacy' | 'terms';
export const legalPaths: Record<LegalKind, string> = {
  notice: '/mentions-legales',
  privacy: '/confidentialite',
  terms: '/conditions',
};

const fr: Record<LegalKind, LegalDoc> = {
  notice: {
    title: 'Mentions légales',
    updated: '7 octobre 2026',
    intro: 'Qui publie Afterwatch, où le site est hébergé et d’où viennent les informations du catalogue.',
    sections: [
      {
        title: 'Éditeur',
        body: [
          'Afterwatch (afterwatch.online) est édité à titre non professionnel par un particulier résidant aux États-Unis. Ses coordonnées sont connues de l’hébergeur.',
          `Contact : ${CONTACT_EMAIL}`,
        ],
      },
      {
        title: 'Hébergement',
        body: [
          'Site : Vercel Inc., 440 N Barranca Avenue #4133, Covina, CA 91723, États-Unis (https://vercel.com).',
          'Comptes et base de données : Supabase, Inc. (https://supabase.com).',
          'Envoi des e-mails : Resend (https://resend.com).',
        ],
      },
      {
        title: 'Informations du catalogue',
        body: [
          'Les titres, affiches, résumés et dates de sortie proviennent de services publics : Kitsu, MyAnimeList (via Jikan), AniList, TMDB, TVmaze et Cinemeta. Ils restent la propriété de leurs auteurs et ayants droit.',
          'Ce produit utilise l’API TMDB mais n’est ni approuvé ni certifié par TMDB.',
          'Certaines données de séries sont fournies par TVmaze.com (licence CC BY-SA).',
          'Afterwatch ne diffuse et n’héberge aucune vidéo.',
        ],
      },
      {
        title: 'Signaler un contenu',
        body: [
          `Pour signaler un contenu illicite, une atteinte à tes droits (dont le droit d’auteur) ou un problème de sécurité, écris à ${CONTACT_EMAIL} en précisant l’adresse de la page et la raison du signalement.`,
        ],
      },
    ],
  },
  privacy: {
    title: 'Politique de confidentialité',
    updated: '10 octobre 2026',
    intro:
      'Afterwatch collecte le minimum nécessaire pour faire fonctionner ton compte. Pas de publicité, pas de revente de données, pas de traceurs publicitaires.',
    sections: [
      {
        title: 'Responsable',
        body: [
          `L’éditeur d’Afterwatch, particulier résidant aux États-Unis, est responsable du traitement. Contact : ${CONTACT_EMAIL}`,
        ],
      },
      {
        title: 'Ce que nous collectons',
        body: [
          {
            list: [
              'Compte : adresse e-mail, mot de passe (enregistré sous forme chiffrée par Supabase, jamais lisible), nom affiché, pseudo public. Avec Google : ton nom et ton e-mail Google.',
              'Ta liste et ton planning : titres, progression, priorités, notes personnelles, séances et réglages (temps par jour, fuseau horaire).',
              'Communauté : ta photo de profil, tes publications (textes, #tags, photos et vidéos), tes notes et tes réactions. Les photos sont réduites dans ton navigateur, ce qui retire leur position GPS ; les vidéos sont limitées à 2 minutes et 100 Mo. Ce que tu publies est visible par les membres connectés.',
              'Notifications : tes choix, l’adresse technique d’envoi fournie par ton navigateur si tu actives le téléphone, et l’historique des envois pour éviter les doublons.',
              'Assistant : tes messages et les informations utiles de ta liste sont envoyés à Google Gemini pour produire la réponse. Nous gardons seulement le nombre de messages par jour, pas leur contenu. La conversation reste dans ton navigateur.',
              'Données techniques : adresse IP, date et erreurs, conservées par l’hébergeur pour la sécurité.',
            ],
          },
        ],
      },
      {
        title: 'Pourquoi',
        body: [
          {
            list: [
              'Fournir le service que tu demandes : ton compte, ta liste, ton planning, l’assistant (exécution du contrat).',
              'T’envoyer les e-mails et notifications que tu as activés (consentement, retirable à tout moment dans Mon compte).',
              'Protéger le site contre les abus et assurer sa sécurité (intérêt légitime).',
            ],
          },
        ],
      },
      {
        title: 'Qui reçoit des données',
        body: [
          {
            list: [
              'Vercel (hébergement du site), Supabase (comptes et base de données), Resend (e-mails).',
              'Google : Gemini pour l’assistant, et la connexion Google si tu l’utilises.',
              'Cloudflare Turnstile : la vérification anti-robots à l’inscription et à la connexion. Elle analyse des signaux techniques de ton navigateur, sans cookie publicitaire.',
              'Le service de notifications de ton navigateur (Google, Apple, Mozilla ou Microsoft), qui reçoit seulement la notification à afficher.',
            ],
          },
          'Les services du catalogue (Kitsu, Jikan, AniList, TMDB, TVmaze, Cinemeta) reçoivent uniquement des recherches de titres, jamais ton compte ni ta liste.',
          'Tes données ne sont jamais vendues ni utilisées pour de la publicité.',
        ],
      },
      {
        title: 'Où sont tes données',
        body: [
          'L’éditeur et plusieurs prestataires sont situés aux États-Unis : tes données peuvent y être transférées et traitées. Ces prestataires s’engagent à les protéger selon le RGPD (clauses contractuelles types ou cadre de protection des données UE–États-Unis).',
        ],
      },
      {
        title: 'Combien de temps',
        body: [
          'Tes données sont conservées tant que ton compte existe. Quand tu supprimes ton compte, ta liste, ton planning, tes préférences, tes appareils, ton pseudo, ta photo de profil, tes photos et tes vidéos sont effacés immédiatement. Des copies de sauvegarde peuvent subsister quelques jours avant d’être écrasées.',
        ],
      },
      {
        title: 'Tes droits',
        body: [
          {
            list: [
              'Accès et portabilité : Mon compte → Télécharger mes données.',
              'Rectification : modifie ton nom, ton pseudo et ta liste directement dans l’application.',
              'Effacement : Mon compte → Supprimer mon compte.',
              'Opposition, limitation, retrait du consentement : coupe les notifications dans Mon compte, ou écris-nous.',
            ],
          },
          `Pour toute question : ${CONTACT_EMAIL}. Si tu vis dans l’Union européenne, tu peux aussi saisir l’autorité de protection des données de ton pays (en France, la CNIL : https://www.cnil.fr).`,
        ],
      },
      {
        title: 'Cookies et stockage',
        body: [
          'Afterwatch utilise seulement ce qui est nécessaire au fonctionnement : les cookies de connexion, le cookie de langue et le stockage de ton navigateur (conversation avec l’assistant, réglages d’affichage). Aucun cookie publicitaire ou de mesure d’audience : aucun bandeau de consentement n’est donc nécessaire.',
        ],
      },
      {
        title: 'Âge minimum',
        body: [
          'Afterwatch s’adresse aux personnes de 13 ans et plus. Si la loi de ton pays fixe un âge plus élevé (15 ans en France, par exemple), l’accord d’un parent est nécessaire en dessous.',
        ],
      },
      {
        title: 'Modifications',
        body: [
          'Si cette politique change, la date en haut de la page est mise à jour. Les changements importants sont signalés dans l’application.',
        ],
      },
    ],
  },
  terms: {
    title: 'Conditions d’utilisation',
    updated: '10 octobre 2026',
    intro:
      'Les règles pour utiliser Afterwatch. En créant un compte, tu les acceptes. Elles sont écrites pour être lues.',
    sections: [
      {
        title: 'Le service',
        body: [
          'Afterwatch t’aide à découvrir et organiser des animes, mangas, films et séries : catalogue, liste personnelle, progression, planning, rappels et assistant. Le catalogue est accessible sans compte. Le compte est gratuit.',
        ],
      },
      {
        title: 'Ton compte',
        body: [
          {
            list: [
              'Tu dois avoir au moins 13 ans. Si la loi de ton pays fixe un âge plus élevé, l’accord d’un parent est nécessaire en dessous.',
              'Un compte par personne, avec des informations exactes.',
              'Tu gardes ton mot de passe pour toi. Tu es responsable de ce qui est fait avec ton compte.',
            ],
          },
        ],
      },
      {
        title: 'Ton pseudo et ta photo de profil',
        body: [
          'Ton pseudo et ta photo de profil sont visibles par les autres membres. Ils ne doivent pas imiter une autre personne ou Afterwatch, ni être insultants, choquants ou trompeurs. Nous pouvons te demander de les changer, ou les retirer s’ils ne respectent pas ces règles.',
        ],
      },
      {
        title: 'Règles de la communauté',
        body: [
          'Ces règles s’appliquent à tout ce que tu publies : avis, notes, recommandations, commentaires, photos, vidéos et réactions.',
          {
            list: [
              'Respecte les autres : pas de harcèlement, d’insultes, de menaces ni de propos haineux ou discriminatoires.',
              'Pas de contenu illégal, sexuel, violent ou choquant, ni de données personnelles d’autrui.',
              'Pas de publicité, de spam ni de liens vers du streaming ou du téléchargement illégal.',
              'Marque les spoilers comme tels.',
              'Ne publie que ce que tu as le droit de partager : pas d’épisode, de chapitre ni de long extrait d’une œuvre. Une courte capture ou une vidéo de toi qui réagis, oui.',
            ],
          },
          'Tu restes propriétaire de ce que tu publies. Tu autorises Afterwatch à l’afficher gratuitement sur le service tant qu’il est publié. Tu es responsable de tes publications.',
        ],
      },
      {
        title: 'Modération et signalements',
        body: [
          `Tu peux signaler un contenu dans l’application ou à ${CONTACT_EMAIL}. Nous pouvons retirer un contenu, et suspendre ou supprimer un compte qui ne respecte pas ces règles ou la loi.`,
        ],
      },
      {
        title: 'Assistant',
        body: [
          'Les réponses de l’assistant sont générées automatiquement et peuvent contenir des erreurs. Il ne modifie rien sans ton accord. Le nombre de messages par jour est limité.',
        ],
      },
      {
        title: 'Catalogue',
        body: [
          'Les informations du catalogue viennent de services tiers et peuvent être incomplètes ou inexactes. Afterwatch ne diffuse aucune vidéo et ne donne accès à aucun épisode.',
        ],
      },
      {
        title: 'Disponibilité et responsabilité',
        body: [
          'Afterwatch est fourni gratuitement, tel quel, sans garantie de disponibilité continue. Le service peut évoluer, ajouter ou retirer des fonctions. Dans les limites permises par la loi, l’éditeur n’est pas responsable des pertes liées à une indisponibilité ou à une information inexacte.',
        ],
      },
      {
        title: 'Supprimer ton compte',
        body: [
          'Tu peux supprimer ton compte à tout moment depuis Mon compte. Tes données sont alors effacées.',
        ],
      },
      {
        title: 'Changements',
        body: [
          'Ces conditions peuvent évoluer. La date en haut de la page est mise à jour et les changements importants sont signalés dans l’application. Continuer à utiliser Afterwatch vaut acceptation.',
        ],
      },
      {
        title: 'Droit applicable et contact',
        body: [
          'Ces conditions sont régies par le droit des États-Unis d’Amérique. Elles ne te privent pas des protections que t’accorde la loi de ton pays de résidence, notamment dans l’Union européenne.',
          `Une question ? ${CONTACT_EMAIL}`,
        ],
      },
    ],
  },
};

const en: Record<LegalKind, LegalDoc> = {
  notice: {
    title: 'Legal notice',
    updated: 'October 7, 2026',
    intro: 'Who publishes Afterwatch, where the site is hosted and where the catalog information comes from.',
    sections: [
      {
        title: 'Publisher',
        body: [
          'Afterwatch (afterwatch.online) is published on a non-professional basis by an individual living in the United States. Their details are known to the host.',
          `Contact: ${CONTACT_EMAIL}`,
        ],
      },
      {
        title: 'Hosting',
        body: [
          'Website: Vercel Inc., 440 N Barranca Avenue #4133, Covina, CA 91723, United States (https://vercel.com).',
          'Accounts and database: Supabase, Inc. (https://supabase.com).',
          'E-mail delivery: Resend (https://resend.com).',
        ],
      },
      {
        title: 'Catalog information',
        body: [
          'Titles, posters, synopses and release dates come from public services: Kitsu, MyAnimeList (via Jikan), AniList, TMDB, TVmaze and Cinemeta. They remain the property of their authors and rights holders.',
          'This product uses the TMDB API but is not endorsed or certified by TMDB.',
          'Some series data is provided by TVmaze.com (CC BY-SA license).',
          'Afterwatch neither streams nor hosts any video.',
        ],
      },
      {
        title: 'Reporting content',
        body: [
          `To report illegal content, a violation of your rights (including copyright) or a security issue, write to ${CONTACT_EMAIL} with the page address and the reason.`,
        ],
      },
    ],
  },
  privacy: {
    title: 'Privacy policy',
    updated: 'October 10, 2026',
    intro:
      'Afterwatch collects the minimum needed to run your account. No ads, no selling of data, no advertising trackers.',
    sections: [
      {
        title: 'Controller',
        body: [
          `The publisher of Afterwatch, an individual living in the United States, is the data controller. Contact: ${CONTACT_EMAIL}`,
        ],
      },
      {
        title: 'What we collect',
        body: [
          {
            list: [
              'Account: e-mail address, password (stored encrypted by Supabase, never readable), display name, public username. With Google: your Google name and e-mail.',
              'Your list and schedule: titles, progress, priorities, personal notes, sessions and settings (time per day, time zone).',
              'Community: your profile photo, your posts (text, #tags, photos and videos), your scores and reactions. Photos are resized in your browser, which removes their GPS location; videos are limited to 2 minutes and 100 MB. What you post is visible to signed-in members.',
              'Notifications: your choices, the technical delivery address your browser provides if you turn on phone notifications, and the delivery history used to avoid duplicates.',
              'Assistant: your messages and the relevant parts of your list are sent to Google Gemini to produce the answer. We only keep the number of messages per day, not their content. The conversation stays in your browser.',
              'Technical data: IP address, date and errors, kept by the host for security.',
            ],
          },
        ],
      },
      {
        title: 'Why',
        body: [
          {
            list: [
              'To provide the service you ask for: your account, list, schedule and the assistant (performance of the contract).',
              'To send the e-mails and notifications you turned on (consent, which you can withdraw anytime in My account).',
              'To protect the site against abuse and keep it secure (legitimate interest).',
            ],
          },
        ],
      },
      {
        title: 'Who receives data',
        body: [
          {
            list: [
              'Vercel (website hosting), Supabase (accounts and database), Resend (e-mails).',
              'Google: Gemini for the assistant, and Google sign-in if you use it.',
              'Cloudflare Turnstile: the anti-robot check when you sign up or sign in. It looks at technical signals from your browser, without advertising cookies.',
              'Your browser’s push service (Google, Apple, Mozilla or Microsoft), which only receives the notification to display.',
            ],
          },
          'Catalog services (Kitsu, Jikan, AniList, TMDB, TVmaze, Cinemeta) only receive title searches, never your account or your list.',
          'Your data is never sold or used for advertising.',
        ],
      },
      {
        title: 'Where your data is',
        body: [
          'The publisher and several providers are located in the United States: your data may be transferred and processed there. These providers commit to protecting it under the GDPR (standard contractual clauses or the EU–US Data Privacy Framework).',
        ],
      },
      {
        title: 'How long',
        body: [
          'Your data is kept as long as your account exists. When you delete your account, your list, schedule, preferences, devices, username, profile photo, photos and videos are erased immediately. Backup copies may remain for a few days before being overwritten.',
        ],
      },
      {
        title: 'Your rights',
        body: [
          {
            list: [
              'Access and portability: My account → Download my data.',
              'Correction: edit your name, username and list directly in the app.',
              'Erasure: My account → Delete my account.',
              'Objection, restriction, withdrawing consent: turn off notifications in My account, or write to us.',
            ],
          },
          `Any question: ${CONTACT_EMAIL}. If you live in the European Union, you can also contact your country’s data protection authority (in France, the CNIL: https://www.cnil.fr).`,
        ],
      },
      {
        title: 'Cookies and storage',
        body: [
          'Afterwatch only uses what it needs to work: sign-in cookies, the language cookie and your browser’s storage (assistant conversation, display settings). No advertising or analytics cookies, so no consent banner is needed.',
        ],
      },
      {
        title: 'Minimum age',
        body: [
          'Afterwatch is for people aged 13 and over. If your country’s law sets a higher age (15 in France, for example), a parent’s consent is required below it.',
        ],
      },
      {
        title: 'Changes',
        body: [
          'If this policy changes, the date at the top of the page is updated. Important changes are announced in the app.',
        ],
      },
    ],
  },
  terms: {
    title: 'Terms of use',
    updated: 'October 10, 2026',
    intro:
      'The rules for using Afterwatch. By creating an account, you accept them. They’re written to be read.',
    sections: [
      {
        title: 'The service',
        body: [
          'Afterwatch helps you discover and organize anime, manga, films and series: catalog, personal list, progress, schedule, reminders and assistant. The catalog is open without an account. Accounts are free.',
        ],
      },
      {
        title: 'Your account',
        body: [
          {
            list: [
              'You must be at least 13. If your country’s law sets a higher age, a parent’s consent is required below it.',
              'One account per person, with accurate information.',
              'Keep your password to yourself. You are responsible for what is done with your account.',
            ],
          },
        ],
      },
      {
        title: 'Your username and profile photo',
        body: [
          'Your username and profile photo are visible to other members. They must not impersonate someone else or Afterwatch, nor be insulting, shocking or misleading. We may ask you to change them, or remove them if they break these rules.',
        ],
      },
      {
        title: 'Community rules',
        body: [
          'These rules apply to everything you post: reviews, ratings, recommendations, comments, photos, videos and reactions.',
          {
            list: [
              'Respect others: no harassment, insults, threats, hateful or discriminatory content.',
              'No illegal, sexual, violent or shocking content, and no one else’s personal data.',
              'No ads, spam or links to illegal streaming or downloads.',
              'Mark spoilers as spoilers.',
              'Only post what you have the right to share: no episodes, chapters or long clips of a work. A short screenshot or a video of you reacting is fine.',
            ],
          },
          'You keep ownership of what you post. You allow Afterwatch to display it on the service, free of charge, for as long as it is posted. You are responsible for your posts.',
        ],
      },
      {
        title: 'Moderation and reports',
        body: [
          `You can report content in the app or at ${CONTACT_EMAIL}. We may remove content, and suspend or delete an account that breaks these rules or the law.`,
        ],
      },
      {
        title: 'Assistant',
        body: [
          'The assistant’s answers are generated automatically and may contain mistakes. It changes nothing without your OK. The number of messages per day is limited.',
        ],
      },
      {
        title: 'Catalog',
        body: [
          'Catalog information comes from third-party services and may be incomplete or inaccurate. Afterwatch streams no video and gives access to no episode.',
        ],
      },
      {
        title: 'Availability and liability',
        body: [
          'Afterwatch is provided free of charge, as is, with no guarantee of continuous availability. The service may change, add or remove features. To the extent permitted by law, the publisher is not liable for losses caused by downtime or inaccurate information.',
        ],
      },
      {
        title: 'Deleting your account',
        body: ['You can delete your account anytime from My account. Your data is then erased.'],
      },
      {
        title: 'Changes',
        body: [
          'These terms may change. The date at the top of the page is updated and important changes are announced in the app. Continuing to use Afterwatch means you accept them.',
        ],
      },
      {
        title: 'Governing law and contact',
        body: [
          'These terms are governed by the law of the United States of America. They do not deprive you of the protections granted by the law of your country of residence, especially in the European Union.',
          `Questions? ${CONTACT_EMAIL}`,
        ],
      },
    ],
  },
};

export const legalDocs: Record<Lang, Record<LegalKind, LegalDoc>> = { fr, en };
