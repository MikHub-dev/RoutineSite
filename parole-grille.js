// Grille de notation « Fluidité verbale » (version 1) : barèmes, points mesurés, affichage.
// Partagée par parole.html (élève) et enseignant.html. Même contenu que le document de suivi du Project « 30 minutes par jour ».
// Nécessite commun.js (fonction esc).
const GRILLE_VERSION = 1;
const GRILLE = {
  ex1: { titre: "Exercice 1 — Association de mots (60 s)", total: 50, criteres: [
    { id: "rythme", nom: "Rythme", max: 15, type: "mesuré", regle: "secondes par mot d'association : ≤ 1,5 s → 15 ; ≤ 2 → 12 ; ≤ 2,5 → 9 ; ≤ 3 → 7 ; ≤ 4 → 4 ; au-delà → 2 (les mots hors exercice, comme un avant-propos, sont exclus)" },
    { id: "continuite", nom: "Continuité", max: 15, type: "mesuré", regle: "départ à 15 ; −1 par blanc ≥ 2 s (maximum −8) ; −2 si une pause dépasse 4 s ; −2 si délai avant de parler > 3 s ; −2 si silence final > 4 s ; les petites pauses entre deux mots ne comptent pas" },
    { id: "richesse", nom: "Richesse", max: 10, type: "mesuré", regle: "part de mots différents : ≥ 90 % → 10 ; ≥ 80 % → 8 ; ≥ 70 % → 6 ; ≥ 55 % → 4 ; en dessous → 2" },
    { id: "liens", nom: "Pertinence des liens", max: 10, type: "jugé", regle: "10 : chaque mot est lié naturellement au précédent ; 7 : bons liens avec quelques sauts ; 4 : liens souvent faibles ou par thème seulement ; 1 : mots sans rapport" }
  ] },
  ex2: { titre: "Exercice 2 — Discours improvisé (2 min)", total: 50, criteres: [
    { id: "continuite", nom: "Continuité", max: 15, type: "mesuré", regle: "départ à 15 ; −1 par blanc ≥ 2 s (maximum −8) ; −0,5 par pause de 0,7 à 2 s (maximum −4) ; −2 si une pause dépasse 4 s ; −2 si délai avant de parler > 3 s ; −2 si silence final > 4 s" },
    { id: "debit", nom: "Débit", max: 10, type: "mesuré", regle: "mots par minute hors pauses : 110–170 → 10 ; 90–110 ou 170–190 → 7 ; 70–90 → 4 ; en dessous ou au-delà → 2" },
    { id: "structure", nom: "Structure et cohérence", max: 15, type: "jugé", regle: "début, milieu et fin repérables (5) ; fil conducteur cohérent (5) ; mot imposé utilisé (3) ; idées développées plutôt que répétées (2)" },
    { id: "voix", nom: "Voix", max: 10, type: "mesuré", regle: "variation de hauteur : 2 à 4,5 demi-tons → 4 ; 1,5 à 2 → 2 ; autre → 1 ; volume stable (baisse < 3 dB du début à la fin) → 3, sinon 1 ; mots de remplissage : ≤ 3 → 3 ; ≤ 8 → 2 ; plus → 1" }
  ] }
};
const NIVEAUX = [[0, "à construire"], [40, "en progrès"], [60, "solide"], [80, "très fluide"]];
const niveauNote = t => t == null ? "" : NIVEAUX.filter(n => t >= n[0]).pop()[1];
const nf = (x, d = 1) => x == null ? "—" : String(Math.round(x * Math.pow(10, d)) / Math.pow(10, d)).replace(".", ",");

// m : mesures d'un exercice { aParle, duree, mots, differents, delai, silenceFinal, pauses, blancs, plusLongue, debit, hauteurSt, tendanceDb, remplissage }
// Renvoie les points de chaque critère « mesuré » (null pour les critères « jugés »).
function noterAuto(ex, m) {
  const auto = {};
  GRILLE[ex].criteres.forEach(c => { auto[c.id] = null; });
  if (!m) return auto;
  const mesures = GRILLE[ex].criteres.filter(c => c.type === "mesuré").map(c => c.id);
  if (!m.aParle) { mesures.forEach(id => { auto[id] = 0; }); return auto; }
  const penalites = (m.plusLongue > 4 ? 2 : 0) + (m.delai > 3 ? 2 : 0) + (m.silenceFinal > 4 ? 2 : 0);
  if (ex === "ex1") {
    const spm = m.mots > 0 ? m.duree / m.mots : null;
    auto.rythme = spm == null ? 0 : spm <= 1.5 ? 15 : spm <= 2 ? 12 : spm <= 2.5 ? 9 : spm <= 3 ? 7 : spm <= 4 ? 4 : 2;
    auto.continuite = Math.max(0, 15 - Math.min(8, m.blancs || 0) - penalites);
    const part = m.mots > 0 ? m.differents / m.mots : 0;
    auto.richesse = part >= .9 ? 10 : part >= .8 ? 8 : part >= .7 ? 6 : part >= .55 ? 4 : 2;
  } else {
    const courtes = Math.max(0, (m.pauses || 0) - (m.blancs || 0));
    auto.continuite = Math.max(0, 15 - Math.min(8, m.blancs || 0) - Math.min(4, 0.5 * courtes) - penalites);
    const d = m.debit;
    auto.debit = d == null ? 0 : (d >= 110 && d <= 170) ? 10 : ((d >= 90 && d < 110) || (d > 170 && d <= 190)) ? 7 : (d >= 70 && d < 90) ? 4 : 2;
    const h = m.hauteurSt, v = m.tendanceDb, r = m.remplissage;
    const ph = h == null ? 1 : (h >= 2 && h <= 4.5) ? 4 : (h >= 1.5 && h < 2) ? 2 : 1;
    const pv = v == null ? 1 : v > -3 ? 3 : 1;
    const pr = r == null ? 1 : r <= 3 ? 3 : r <= 8 ? 2 : 1;
    auto.voix = ph + pv + pr;
  }
  return auto;
}

// Points mesurés disponibles : { pts, sur }
function pointsMesures(ex, auto) {
  let pts = 0, sur = 0;
  GRILLE[ex].criteres.forEach(c => { if (c.type === "mesuré" && auto && auto[c.id] != null) { pts += auto[c.id]; sur += c.max; } });
  return { pts, sur };
}
// Total /50 d'un exercice à partir des notes finales (null tant qu'un critère manque).
function totalExercice(ex, notesEx) {
  if (!notesEx) return null;
  let s = 0;
  for (const c of GRILLE[ex].criteres) { const v = notesEx[c.id]; if (v == null) return null; s += v; }
  return s;
}
// Notes retenues pour une séance : celles validées par l'enseignant, sinon les notes automatiques du Worker (null si aucune).
function notesEffectives(seance) { return seance.notes || seance.notesAuto || null; }
// Note ramenée sur 100 à partir des exercices notés (un seul exercice noté : /50 ramené sur 100). « auto » : notes non validées par l'enseignant.
function noteSur100(seance) {
  let somme = 0, max = 0;
  const notes = notesEffectives(seance);
  ["ex1", "ex2"].forEach(ex => {
    const t = totalExercice(ex, notes && notes[ex]);
    if (t != null) { somme += t; max += GRILLE[ex].total; }
  });
  return max ? { pct: somme / max * 100, complet: max === 100, somme, max, auto: !seance.notes } : null;
}

// Tableau « critère / points mesurés / points finals » pour un exercice.
function tableauNotesHtml(ex, auto, finales) {
  const lignes = GRILLE[ex].criteres.map(c => {
    const a = auto ? auto[c.id] : null, f = finales ? finales[c.id] : null;
    const cellule = f != null ? `<b>${nf(f)}</b>` : (a != null ? `${nf(a)} <span class="small">(mesuré)</span>` : `<span class="small">jugé par l'analyse automatique</span>`);
    return `<tr><td>${esc(c.nom)}</td><td>${cellule}</td><td class="small">/ ${c.max}</td></tr>`;
  }).join("");
  const t = totalExercice(ex, finales);
  const pm = pointsMesures(ex, auto);
  const pied = t != null ? `<tr><td><b>Total</b></td><td><b>${nf(t)}</b></td><td class="small">/ ${GRILLE[ex].total}</td></tr>`
    : `<tr><td class="small">Points mesurés</td><td class="small">${nf(pm.pts)}</td><td class="small">/ ${pm.sur || "—"}</td></tr>`;
  return `<table class="notes-tab"><tbody>${lignes}${pied}</tbody></table>`;
}

// Grille complète (barèmes) dans un bloc dépliable.
function grilleHtml() {
  const tab = ex => `<h4>${esc(GRILLE[ex].titre)} — /${GRILLE[ex].total}</h4>
    <table class="notes-tab grille-tab"><thead><tr><th>Critère</th><th>Pts</th><th>Type</th><th>Barème</th></tr></thead><tbody>${
      GRILLE[ex].criteres.map(c => `<tr><td>${esc(c.nom)}</td><td>${c.max}</td><td>${esc(c.type)}</td><td class="small">${esc(c.regle)}</td></tr>`).join("")
    }</tbody></table>`;
  return `<details class="grille-details"><summary>Grille de notation (version ${GRILLE_VERSION})</summary>
    <p class="small">Chaque exercice est noté sur 50, le total sur 100. 75 points sont mesurés par la page (pauses, rythme, voix…) ; 25 sont jugés à la lecture de la transcription (pertinence des liens, structure de l'histoire) par l'analyse automatique du site, que ton enseignant peut corriger.</p>
    ${tab("ex1")}${tab("ex2")}
    <p class="small">Niveaux : ${NIVEAUX.map((n, i) => `${n[0]}${i < NIVEAUX.length - 1 ? "–" + (NIVEAUX[i + 1][0] - 1) : "–100"} ${n[1]}`).join(" · ")}.</p>
  </details>`;
}

// Courbe de la note (ramenée sur 100) au fil des séances ; points : [{ pct, etiquette }]
function courbeSvg(points) {
  if (points.length < 2) return "";
  const W = 560, H = 150, g = 34, d = 14;
  const x = i => g + (W - g - d) * (i / (points.length - 1));
  const y = v => H - 24 - (H - 24 - 10) * (v / 100);
  const lignes = [0, 40, 60, 80, 100].map(v => `<line x1="${g}" x2="${W - d}" y1="${y(v)}" y2="${y(v)}" stroke="var(--bord)" stroke-width="1"/><text x="${g - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--doux)">${v}</text>`).join("");
  const chemin = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.pct).toFixed(1)}`).join(" ");
  const pts = points.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.pct).toFixed(1)}" r="4" fill="var(--bleu)"><title>${esc(p.etiquette)} : ${nf(p.pct, 0)}/100</title></circle>`).join("");
  const etiq = points.map((p, i) => (points.length <= 12 || i % Math.ceil(points.length / 12) === 0) ? `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="var(--doux)">${esc(p.court)}</text>` : "").join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px" role="img" aria-label="Évolution de la note sur 100">${lignes}<path d="${chemin}" fill="none" stroke="var(--bleu)" stroke-width="2"/>${pts}${etiq}</svg>`;
}

// Lecture d'une ligne « [NOTES] ex1: rythme=9 continuite=6 … ; ex2: … » dans un retour de Claude.
function lireLigneNotes(texte) {
  const ligne = String(texte || "").split(/\r?\n/).find(l => /\[NOTES\]/i.test(l));
  if (!ligne) return null;
  const notes = { ex1: {}, ex2: {} };
  let trouve = 0;
  ["ex1", "ex2"].forEach(ex => {
    const m = ligne.match(new RegExp(ex + "\\s*:\\s*([^;|]*)", "i"));
    if (!m) return;
    GRILLE[ex].criteres.forEach(c => {
      const v = m[1].match(new RegExp("\\b" + c.id + "\\s*=\\s*([0-9]+(?:[.,][0-9]+)?)", "i"));
      if (v) { notes[ex][c.id] = Math.min(c.max, parseFloat(v[1].replace(",", "."))); trouve++; }
    });
  });
  return trouve ? notes : null;
}
