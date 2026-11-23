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
| `POST /parole/enregistrer` | l'élève | enregistre ou met à jour une séance de « Fluidité verbale » (mesures, texte) |
| `POST /parole/etat` | l'élève | renvoie ses séances avec leurs notes (page « Mon suivi ») |
| `POST /admin/parole` | l'enseignant | liste toutes les séances de tous les élèves |
| `POST /admin/parole/noter` | l'enseignant | enregistre les notes (par critère) et le retour de Claude |
| `POST /admin/parole/supprimer` | l'enseignant | supprime une séance |
| `POST /parole/audio` | l'élève | archive l'enregistrement audio d'un exercice dans un dépôt GitHub **privé** |
| `POST /admin/parole/archive` | l'enseignant | liste les fichiers de l'archive audio (mot de passe obligatoire) |
| `POST /admin/parole/audio` | l'enseignant | sert un fichier de l'archive pour l'écouter ou le télécharger (mot de passe obligatoire) |
| `POST /admin/parole/reinitialiser` | l'enseignant | remet un jour (ou tous) à zéro, en gardant ou en supprimant les audios |
| `POST /parole/analyser` | l'élève | relance l'analyse automatique de sa séance (si elle a échoué ou est restée bloquée) |
| `POST /admin/parole/analyser` | l'enseignant | relance l'analyse d'une séance, sans plafond |
| `POST /reponses/envoyer` | l'élève | enregistre ses réponses écrites (Probabilités, Technologie), valide le jour et les dépose dans le dépôt privé pour correction par Claude |
| `POST /reponses/etat` | l'élève | renvoie ses envois avec leur correction quand elle est prête |
| `POST /admin/reponses` | l'enseignant | liste tous les envois et leurs corrections |
| `POST /admin/reponses/modifier` | l'enseignant | modifie le score ou le texte de correction affiché à l'élève |
| `POST /admin/reponses/relancer` | l'enseignant | redemande une correction à Claude |
| `POST /admin/reponses/supprimer` | l'enseignant | supprime un envoi du suivi |

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

## Publier sans terminal (sans Codespace)

- **Déploiement automatique** : le fichier `.github/workflows/deployer-worker.yml` publie le Worker à chaque modification de `worker/` sur `main` (ou via GitHub > Actions > « Déployer le Worker » > Run workflow). Il faut créer une fois, dans GitHub > Settings > Secrets and variables > Actions, les secrets `CLOUDFLARE_API_TOKEN` (modèle « Edit Cloudflare Workers ») et `CLOUDFLARE_ACCOUNT_ID` (visible dans le tableau de bord Cloudflare).
- **Copier-coller dans Cloudflare** : `worker/dist/worker.js` est le Worker complet en un seul fichier. Tableau de bord Cloudflare > Workers & Pages > `routinesite-suivi` > Edit code : remplacer tout le code par ce fichier, puis Deploy. Ajouter ensuite, dans Settings > Bindings, une liaison « Workers AI » nommée `AI`.

## Notes et retours automatiques (version 1.4 : Cloudflare Workers AI)

Après chaque exercice, le Worker enregistre la séance puis l'analyse en arrière-plan (quelques secondes), sans clé API ni abonnement supplémentaire :

- un modèle de langage (`@cf/mistralai/mistral-small-3.1-24b-instruct`) juge les 25 points « jugés » de la grille (pertinence des liens, structure de l'histoire) et rédige le retour : analyse, 3 axes au maximum, consigne pour la prochaine séance ; la comparaison avec les séances précédentes est calculée par le Worker lui-même ;
- un modèle d'embeddings multilingue (`@cf/baai/bge-m3`) mesure la proximité de sens entre mots consécutifs : c'est un indice indépendant qui recoupe le jugement du modèle (écart de 3 points ou plus : la séance est marquée « à vérifier ») ;
- si le modèle de langage est en panne, des estimations simples donnent une note provisoire et la séance est marquée « estimation » ; l'élève et l'enseignant peuvent relancer l'analyse.

Les points « mesurés » (75 sur 100) sont calculés par la page de l'élève et seulement bornés par le Worker.

**Activation** : le fichier `wrangler.toml` contient déjà la liaison `[ai] binding = "AI"`. Il suffit de republier le Worker (aucun secret à ajouter) :

```bash
cd worker
npx wrangler deploy
```

Tant que le Worker n'est pas republié (ou si la liaison est retirée), rien ne change : les séances sont enregistrées, les points mesurés s'affichent.

**Coût** : Workers AI est gratuit jusqu'à 10 000 « neurons » par jour. Une séance consomme environ 110 neurons (≈ 2 500 tokens lus et 600 écrits avec Mistral Small 3.1, tarifs Cloudflare à vérifier sur la page de tarifs), soit environ 1 % de la franchise. Au-delà, le tarif Workers Paid est de 0,011 $ pour 1 000 neurons. Plafonds du Worker : 8 analyses automatiques par séance et 30 par élève et par jour. Pour changer de modèle, définir `AI_MODEL` (jugement) ou `AI_EMBED_MODEL` (liens) dans `[vars]`.

**Confidentialité** : seul le texte de la transcription et les mesures sont envoyés au modèle, jamais l'audio.

**Notes de l'élève et de l'enseignant** : les notes automatiques comptent immédiatement (marquées « auto » sur la page de l'élève). Dans l'espace enseignant, « Valider / corriger les notes » enregistre les notes retenues ; chaque écart avec la note automatique est mémorisé (`corrections`) pour suivre la fiabilité de l'analyse.

**Calibration** : les seuils de l'indice de proximité (`SEUIL_SAUT`, `SIM_BASSE`, `SIM_HAUTE` dans `src/analyse.js`) sont provisoires. Après quelques séances, comparer dans l'espace enseignant (section « Analyse automatique ») l'indice et les notes corrigées, puis ajuster.

## Archiver les enregistrements audio (dépôt GitHub privé)

La page « Fluidité verbale » envoie l'enregistrement de chaque exercice au Worker, qui le dépose dans un dépôt GitHub d'archive : `audio/<classe>/<CODE>/jour-001/<séance>-ex1-<horodatage>.webm`. On peut ensuite le télécharger ou le faire réanalyser.

**Le dépôt d'archive doit être privé.** Le dépôt RoutineSite est public (GitHub Pages) : y déposer la voix d'un élève la rendrait téléchargeable par tous et la conserverait dans l'historique git même après suppression. Le Worker vérifie la visibilité du dépôt (à chaque minute au plus) et **refuse d'écrire, de lire et de supprimer** s'il n'est pas privé.

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

### Accès aux enregistrements : uniquement par l'espace enseignant

Aucun lien public ni adresse GitHub n'est affiché sur le site. Pour écouter ou télécharger un enregistrement, l'espace enseignant le demande au Worker avec le mot de passe enseignant ; le Worker le lit dans le dépôt privé avec son jeton et le renvoie. Sans mot de passe valide (ou après 10 essais erronés, blocage de 15 minutes), rien n'est servi. L'emplacement de l'archive n'est jamais transmis aux élèves, et le Worker ne lit que des chemins `audio/<classe>/<CODE>/jour-NNN/…` de son propre dépôt d'archive.

La section « Archive audio » de l'espace enseignant liste tous les fichiers, y compris ceux d'un jour remis à zéro avec conservation des audios.

### Remise à zéro d'un jour (espace enseignant)

Depuis la case d'un jour de la grille « Fluidité verbale », ou depuis une séance (« Remettre ce jour à zéro… »), l'enseignant choisit :

- **Remettre à zéro et garder les audios** : les séances du jour (mesures, notes, transcriptions) et le statut « fait » sont effacés ; les audios restent dans l'archive, avec un fichier `reinitialisation-<horodatage>.json` qui conserve les mesures, notes et transcriptions pour une réanalyse.
- **Remettre à zéro et supprimer les audios** : les fichiers audio du jour sont aussi retirés de l'archive. Attention : ils restent récupérables dans l'historique git du dépôt privé tant que celui-ci n'est pas purgé.

Si l'archive est inaccessible (jeton expiré, dépôt devenu public) alors qu'il existe des audios, rien n'est effacé et un message l'indique. Si une suppression échoue en cours de route, le suivi n'est pas effacé : on peut recommencer.

- Un enregistrement de 2 minutes pèse environ 0,5 Mo (voix à 32 kbit/s).
- Sans configuration (ou si le dépôt est public), la page affiche « Audio non archivé » ; l'analyse et les notes restent enregistrées normalement.
- Une voix d'élève est une donnée personnelle : prévenir l'élève (la page l'indique) et, s'il est mineur, ses parents ; supprimer les fichiers quand ils ne servent plus.

## Corriger les réponses écrites avec Claude (version 1.5 : Probabilités et Technologie numérique)

Quand l'élève appuie sur « Envoyer mes réponses » (`jour.html`), ses réponses ne partent plus par e-mail : le Worker les enregistre, valide le jour et les dépose **une seule fois** dans le dépôt privé d'archive (`reponses/<classe>/<CODE>/<routine>/jour-NNN/<envoi>.json`). Ce dépôt contient la GitHub Action `corriger-reponses.yml`, lancée par ce dépôt de fichier : Claude Code corrige l'envoi d'après l'énoncé et le corrigé du jour (`data/*.json`), dans le style des e-mails de retour, et écrit `corrections/<même chemin>`. Le Worker lit cette correction quand la page de l'élève la demande ; l'élève voit « Correction en cours… » puis son score et le texte complet, en général 2 à 5 minutes après l'envoi.

- Claude utilise **l'abonnement de l'enseignant** (aucune clé API payante) : secret `CLAUDE_CODE_OAUTH_TOKEN` du dépôt privé, créé avec `claude setup-token` (valable un an). Chaque correction consomme le même quota que les conversations avec Claude.
- Le Worker n'a besoin de **rien de nouveau** : il réutilise `GITHUB_TOKEN` et `AUDIO_REPO` (archive audio). Republier le Worker suffit (déploiement automatique à chaque push sur `main`).
- **Un envoi = une correction** : un double clic ou un renvoi après coupure réseau réutilise le même identifiant d'envoi ; le Worker ne dépose pas deux fois le même fichier. L'Action ne traite que les envois sans correction et un seul passage tourne à la fois.
- Plafond : 20 envois par élève et par jour.
- Espace enseignant, section « Probabilités et Technologie : corrections de Claude » : relire, modifier le score ou le texte (l'élève voit alors la version de l'enseignant, marquée « relue »), redemander une correction à Claude, supprimer un envoi. Claude signale à part les corrigés du site qui lui semblent faux ou ambigus.
- Si l'archive n'est pas configurée, ou si le Worker n'est pas joignable, la page repasse par l'e-mail comme avant.
- **Confidentialité** : les réponses (texte seulement, avec le code de l'élève) sont envoyées à Claude sous le compte de l'enseignant ; désactiver dans claude.ai, Réglages > Confidentialité, l'option qui autorise l'utilisation des conversations pour améliorer les modèles.

## Tester en local

```bash
node worker/test/worker.test.mjs
node worker/test/analyse.test.mjs   # analyse automatique, avec Workers AI simulé
node worker/test/reponses.test.mjs  # réponses écrites corrigées par Claude, avec GitHub simulé
```

## Limites à connaître

- Le Worker enregistre qu'un élève a **validé** un jour sur le site. La preuve que l'e-mail est bien parti est l'e-mail reçu.
- Les contrôles côté site (entrée par code) ne sont pas une sécurité forte : les pages et fichiers du dépôt sont publics. Les données de suivi, elles, ne sont accessibles qu'avec un code valide (élève) ou le mot de passe (enseignant).

## Progression des jeux liée au code (version 1.6)

Les routes `/progres/lire`, `/progres/ecrire` et `/admin/progres` gardent, par code élève, la progression des jeux des six sites FamZakSites (meilleurs scores de quiz, fiches vues, badges, défis FFJM…). Les sites passent par le fichier commun `famzak-progres.js` : le code est saisi une fois (il est partagé par les six sites, qui ont la même adresse de base), chaque progrès est gardé sur l'appareil puis envoyé ici, et récupéré à la connexion sur un autre appareil. Clé KV : `prog:<empreinte>:<site>`. `/progres/lire` renvoie aussi les dates des jours de routine faits (série de jours d'affilée de RoutineSite). `dist/worker.js` est régénéré par `npx esbuild src/index.js --bundle --format=esm --outfile=dist/worker.js`.

