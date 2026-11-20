# RoutineSite
Rituel de 30 minutes par jour sur un sujet à approfondir

## Routine « Fluidité verbale » (POC)
`parole.html` : jour 1 d'une routine orale (association de mots 60 s + discours de 2 min), mesures de voix faites dans le navigateur (Web Audio + reconnaissance vocale de Chrome). Accès par le même code élève que le reste du site. Chaque séance est enregistrée automatiquement (Worker, routes `/parole/…`), puis notée et commentée automatiquement par Cloudflare Workers AI (`worker/src/analyse.js` ; points mesurés par la page, points jugés par un modèle recoupé par un indice d'embeddings). L'élève voit son retour et ses notes dans « Mon suivi » et « Retour du jour » ; l'enseignant les valide ou les corrige dans `enseignant.html`. La grille est dans `parole-grille.js`. Voir `worker/LISEZMOI.md`.
