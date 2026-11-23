# RoutineSite
Rituel de 30 minutes par jour sur un sujet à approfondir

## Routine « Fluidité verbale » (100 jours)
`parole.html` : jour 1 d'une routine orale (association de mots 60 s + discours de 2 min), mesures de voix faites dans le navigateur (Web Audio + reconnaissance vocale de Chrome). Accès par le même code élève que le reste du site. Chaque séance est enregistrée automatiquement (Worker, routes `/parole/…`), puis notée et commentée automatiquement par Cloudflare Workers AI (`worker/src/analyse.js` ; points mesurés par la page, points jugés par un modèle recoupé par un indice d'embeddings). L'élève voit son retour et ses notes dans « Mon suivi » et « Retour du jour » ; l'enseignant les valide ou les corrige dans `enseignant.html`. La grille est dans `parole-grille.js`. Voir `worker/LISEZMOI.md`.

## Probabilités et Technologie numérique : correction par Claude
Après « Envoyer mes réponses » (`jour.html`), les réponses sont corrigées automatiquement par Claude (GitHub Action du dépôt privé d'archive, sur l'abonnement de l'enseignant) ; l'élève voit son score et le texte de correction quelques minutes après, l'enseignant peut les modifier dans `enseignant.html`. Voir `worker/LISEZMOI.md`, section « Corriger les réponses écrites avec Claude ».

## Recherche
Dans « Mon espace » (après saisie du code), une zone de recherche parcourt les 200 séances de `data/probabilites.json` et `data/technologie.json` : titre, objectif, partie « Apprendre » et énoncés des exercices (les corrigés et « À retenir » ne sont pas cherchés). Chaque résultat ouvre `jour.html` sur la bonne partie (`#apprendre`, `#exercice-2`…).

## Jours d'affilée et badges
Dans « Mon espace » : badges à 1, 10, 30, 50 et 100 jours (jours faits, gardés par le serveur) et série de jours d'affilée. Les dates viennent du serveur (`/progres/lire`, Worker 1.6) : la série suit l'élève sur tous ses appareils. Le même Worker garde la progression des jeux des autres sites FamZakSites (voir `worker/LISEZMOI.md`).
