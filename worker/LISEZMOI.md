# Worker de suivi (RoutineSite)

Ce petit service Cloudflare garde en mémoire les jours terminés par chaque élève et permet à l'enseignant de les voir et de les remettre à « non fait ». Sans lui, le site fonctionne, mais les jours ne sont retenus que dans le navigateur de chaque élève et l'espace enseignant affiche « non configuré ».

Il reprend le principe de MathSite : le mot de passe enseignant est un secret du Worker (`ADMIN_PASSWORD`), jamais écrit dans le dépôt, et vérifié côté serveur.

## Déploiement (une seule fois, environ 10 minutes)

Il faut un compte Cloudflare (le même que celui de MathSite convient) et Node.js sur l'ordinateur.

```bash
cd worker

# 1. Créer la mémoire (KV) et noter l'identifiant affiché
npx wrangler kv namespace create SUIVI
#    → recopier l'id dans wrangler.toml, à la place de REMPLACER_PAR_L_ID_DU_KV

# 2. Définir le mot de passe enseignant (le même que celui de MathSite, tapé à l'invite)
npx wrangler secret put ADMIN_PASSWORD

# 3. Publier
npx wrangler deploy
```

La dernière commande affiche l'adresse du Worker, de la forme
`https://routinesite-suivi.<votre-compte>.workers.dev`.

## Brancher le site

1. Dans `commun.js`, renseigner la constante :
   `const URL_SUIVI = "https://routinesite-suivi.<votre-compte>.workers.dev";`
2. Dans `wrangler.toml`, `ALLOWED_ORIGINS` doit contenir l'adresse où le site est publié
   (`https://mikhub-dev.github.io`) ; si elle change, redéployer le Worker.
3. Valider et pousser `commun.js` sur la branche `main` : GitHub Pages republie le site.

## Ce que fait le Worker

| Route | Utilisée par | Rôle |
|---|---|---|
| `POST /valider` | l'élève | enregistre qu'un jour est fait (code vérifié par empreinte) |
| `POST /etat` | l'élève | renvoie ses jours faits (pour synchroniser ses appareils) |
| `POST /admin/etat` | l'enseignant | liste les élèves et leurs jours faits |
| `POST /admin/reinitialiser` | l'enseignant | remet un jour (ou tous) à « non fait » |
| `POST /parole/enregistrer` | l'élève | enregistre ou met à jour une séance de « Fluidité verbale » (mesures, texte, bilan) |
| `POST /parole/etat` | l'élève | renvoie ses séances avec leurs notes (page « Mon suivi ») |
| `POST /admin/parole` | l'enseignant | liste toutes les séances de tous les élèves |
| `POST /admin/parole/noter` | l'enseignant | enregistre les notes (par critère) et le retour de Claude |
| `POST /admin/parole/supprimer` | l'enseignant | supprime une séance |
| `POST /parole/audio` | l'élève | archive l'enregistrement audio d'un exercice dans un dépôt GitHub **privé** |

- Les codes ne sont jamais écrits dans le dépôt : seules leurs empreintes (SHA-256) figurent dans `wrangler.toml`.
- Après 10 mots de passe erronés depuis une même adresse, l'accès enseignant est bloqué 15 minutes.
- Seuls les élèves ayant au moins un jour fait apparaissent dans l'espace enseignant.

## Mettre à jour le Worker (version 1.1 : routine « Fluidité verbale »)

La routine « Fluidité verbale » ajoute des routes au Worker. Après avoir récupéré cette version du dépôt, republier le Worker (le KV, le mot de passe et `wrangler.toml` restent inchangés) :

```bash
cd worker
npx wrangler deploy
```

Tant que le Worker n'est pas republié, la page `parole.html` garde chaque séance sur l'appareil de l'élève et la renvoie à l'ouverture suivante ; l'espace enseignant affiche un message l'invitant à republier.

## Archiver les enregistrements audio (dépôt GitHub privé)

La page « Fluidité verbale » envoie l'enregistrement de chaque exercice au Worker, qui le dépose dans un dépôt GitHub d'archive : `audio/<classe>/<CODE>/jour-001/<séance>-ex1-<horodatage>.webm`. On peut ensuite le télécharger ou le faire réanalyser.

**Le dépôt d'archive doit être privé.** Le dépôt RoutineSite est public (GitHub Pages) : y déposer la voix d'un élève la rendrait téléchargeable par tous et la conserverait dans l'historique git même après suppression. Le Worker vérifie la visibilité du dépôt et **refuse d'écrire** s'il n'est pas privé.

```bash
# 1. Sur GitHub : créer un dépôt PRIVÉ (nom attendu : MikHub-dev/RoutineSite-audio, modifiable par AUDIO_REPO dans wrangler.toml)
# 2. Sur GitHub : Settings > Developer settings > Fine-grained tokens > nouveau jeton
#    - Repository access : « Only select repositories » → le dépôt d'archive seulement
#    - Permissions : Contents → Read and write
# 3. Donner le jeton au Worker (secret, jamais écrit dans le dépôt) puis republier
cd worker
npx wrangler secret put GITHUB_TOKEN
npx wrangler deploy
```

- Un enregistrement de 2 minutes pèse environ 0,5 Mo (voix à 32 kbit/s).
- Sans configuration (ou si le dépôt est public), la page affiche « Audio non archivé » ; l'analyse et les notes restent enregistrées normalement.
- Une voix d'élève est une donnée personnelle : prévenir l'élève (la page l'indique) et, s'il est mineur, ses parents ; supprimer les fichiers quand ils ne servent plus.

## Tester en local

```bash
node worker/test/worker.test.mjs
```

## Limites à connaître

- Le Worker enregistre qu'un élève a **validé** un jour sur le site. La preuve que l'e-mail est bien parti est l'e-mail reçu.
- Les contrôles côté site (entrée par code) ne sont pas une sécurité forte : les pages et fichiers du dépôt sont publics. Les données de suivi, elles, ne sont accessibles qu'avec un code valide (élève) ou le mot de passe (enseignant).
