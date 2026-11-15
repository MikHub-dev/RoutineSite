# RoutineSite
Rituel de 30 minutes par jour sur un sujet à approfondir

## Routine « Fluidité verbale » (POC)
`parole.html` : jour 1 d'une routine orale (association de mots 60 s + discours de 2 min), mesures de voix faites dans le navigateur (Web Audio + reconnaissance vocale de Chrome). Accès par le même code élève que le reste du site. Chaque séance est enregistrée automatiquement (Worker, routes `/parole/…`) ; le bilan généré est copié-collé à Claude, qui répond avec une analyse, des axes d'amélioration et une note selon la grille (`parole-grille.js`). L'enseignant saisit les notes dans `enseignant.html` ; l'élève les retrouve dans « Mon suivi ».
