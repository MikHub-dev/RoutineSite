// Analyse automatique d'une séance de « Fluidité verbale » avec Cloudflare Workers AI (gratuit dans la franchise quotidienne).
//   - un modèle de langage juge les critères « jugés » de la grille (pertinence des liens, structure de l'histoire)
//     et rédige le retour (analyse, axes, consigne) ;
//   - un modèle d'embeddings multilingue mesure la proximité de sens entre mots consécutifs (indice de recoupement des liens) ;
//   - si le modèle de langage échoue, des estimations simples donnent quand même une note provisoire.
// Aucune dépendance à l'API Claude : seul le binding « AI » du Worker est utilisé.

export const MODELE_DEFAUT = "@cf/mistralai/mistral-small-3.1-24b-instruct";
export const MODELE_EMBED_DEFAUT = "@cf/baai/bge-m3";
export const DELAI_MS = 25000;            // une analyse qui dépasse ce délai est abandonnée

export const CRITERES = {
  ex1: { rythme: 15, continuite: 15, richesse: 10, liens: 10 },
  ex2: { continuite: 15, debit: 10, structure: 15, voix: 10 }
};
export const TOTAL_EX = 50;
export const NIVEAUX = [[0, "à construire"], [40, "en progrès"], [60, "solide"], [80, "très fluide"]];
export const niveau = t => NIVEAUX.filter(n => t >= n[0]).pop()[1];

// Seuils PROVISOIRES de l'indice « embeddings » : à ajuster avec les premières séances réelles (valeurs visibles dans l'espace enseignant).
export const SEUIL_SAUT = 0.42;            // similarité en dessous de laquelle deux mots consécutifs sont comptés comme un « saut »
export const SIM_BASSE = 0.35, SIM_HAUTE = 0.65;   // similarité moyenne correspondant à 1 / 10 points de liens
export const ECART_A_VERIFIER = 3;         // écart (en points) entre le jugement du modèle et l'estimation par embeddings au-delà duquel la séance est à vérifier

const borne = (x, min, max) => Math.min(max, Math.max(min, x));
const demi = x => Math.round(x * 2) / 2;
const nombre = x => (x === null || x === undefined || x === "" || !Number.isFinite(Number(x))) ? null : Number(x);
export const nf = (x, d = 1) => x == null ? "—" : String(Math.round(x * Math.pow(10, d)) / Math.pow(10, d)).replace(".", ",");

// ---------- Outils de texte ----------
const MOTS_OUTILS = new Set(("le la les un une des du de d l et ou à au aux en dans sur sous par pour avec sans ce cet cette ces se sa son ses mon ma mes ton ta tes " +
  "qui que quoi dont où est sont a ont été être avoir fait il elle on ils elles je tu nous vous y ne pas plus très bien aussi puis alors donc mais euh heu ben bon voilà").split(/\s+/));

export function motsAssociation(texte, motDepart) {
  const brut = String(texte || "").toLowerCase().replace(/[’']/g, " ").split(/[^a-zà-ÿœæ-]+/).map(w => w.replace(/^-+|-+$/g, "")).filter(Boolean);
  const liste = [String(motDepart || "").toLowerCase().trim(), ...brut.filter(w => w.length >= 3 && !MOTS_OUTILS.has(w))].filter(Boolean);
  return liste.filter((w, i) => i === 0 || w !== liste[i - 1]).slice(0, 70);
}

const CONNECTEURS = ["alors", "puis", "ensuite", "enfin", "finalement", "soudain", "un jour", "il était une fois", "après", "pendant", "mais", "donc", "parce que", "quand", "pourtant", "depuis", "avant", "d'abord", "tout à coup"];
export function indicesStructure(texte, motImpose) {
  const t = String(texte || "").toLowerCase().replace(/[’]/g, "'");
  const mots = t.split(/[^a-zà-ÿœæ'-]+/).filter(Boolean);
  const differents = new Set(mots).size;
  let connecteurs = 0;
  CONNECTEURS.forEach(c => { const m = t.match(new RegExp("(^|[^a-zà-ÿ])" + c.replace(/'/g, "'") + "(?![a-zà-ÿ])", "g")); if (m) connecteurs += m.length; });
  return { mots: mots.length, differents, partDifferents: mots.length ? differents / mots.length : 0, connecteurs, motImpose: motImpose === true };
}
export function estimerStructure(ind) {
  const v = (ind.motImpose ? 3 : 0) + (ind.partDifferents >= 0.5 ? 2 : 1) + 5 * Math.min(1, ind.mots / 180) + 5 * Math.min(1, ind.connecteurs / 5);
  return borne(demi(v), 0, 15);
}

// ---------- Indice « embeddings » pour les liens ----------
export function cosinus(a, b) {
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
}
// mots : suite de mots ; vecteurs : { mot -> vecteur }
export function indiceLiens(mots, vecteurs) {
  const sims = [];
  for (let i = 1; i < mots.length; i++) if (vecteurs[mots[i - 1]] && vecteurs[mots[i]]) sims.push(cosinus(vecteurs[mots[i - 1]], vecteurs[mots[i]]));
  if (sims.length < 3) return null;
  const tri = sims.slice().sort((x, y) => x - y);
  const moyenne = sims.reduce((s, x) => s + x, 0) / sims.length;
  const sauts = sims.filter(x => x < SEUIL_SAUT).length;
  return { n: sims.length, moyenne: Math.round(moyenne * 1000) / 1000, mediane: Math.round(tri[Math.floor(tri.length / 2)] * 1000) / 1000, sauts, partSauts: Math.round(sauts / sims.length * 100) / 100 };
}
export function estimerLiens(indice) {
  if (!indice) return null;
  return borne(demi(1 + 9 * borne((indice.moyenne - SIM_BASSE) / (SIM_HAUTE - SIM_BASSE), 0, 1)), 0, 10);
}

// ---------- Signature d'une séance (change quand le contenu à analyser change) ----------
export function signature(s) {
  const e = x => x ? [x.texte, x.aParle, x.mots, x.differents, x.blancs, x.motImpose, x.motCle, x.auto] : null;
  const t = JSON.stringify([e(s.ex1), e(s.ex2)]);
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16);
}

// ---------- Notes ----------
export function totalExercice(ex, notesEx) {
  if (!notesEx) return null;
  let s = 0;
  for (const c of Object.keys(CRITERES[ex])) { const v = notesEx[c]; if (v == null) return null; s += v; }
  return s;
}
export const notesEffectives = s => s.notes || s.notesAuto || null;   // notes validées par l'enseignant, sinon notes automatiques

function notesVides() { return { ex1: Object.fromEntries(Object.keys(CRITERES.ex1).map(c => [c, null])), ex2: Object.fromEntries(Object.keys(CRITERES.ex2).map(c => [c, null])) }; }

// ---------- Historique ----------
function resumeHistorique(historique) {
  const lignes = [];
  historique.slice(-7).forEach(s => {
    const n = notesEffectives(s) || {};
    const t1 = totalExercice("ex1", n.ex1), t2 = totalExercice("ex2", n.ex2);
    lignes.push(`jour ${s.jour} (${String(s.date).slice(0, 10)}) : exercice 1 ${t1 == null ? (s.ex1 ? "non noté" : "non fait") : t1 + "/50"}, exercice 2 ${t2 == null ? (s.ex2 ? "non noté" : "non fait") : t2 + "/50"}`);
  });
  return lignes;
}
function comparaison(seance, notes, historique) {
  const phrases = [];
  ["ex1", "ex2"].forEach(ex => {
    const t = totalExercice(ex, notes[ex]);
    if (t == null) return;
    const avant = historique.map(s => totalExercice(ex, (notesEffectives(s) || {})[ex])).filter(v => v != null);
    const nom = ex === "ex1" ? "Exercice 1" : "Exercice 2";
    if (!avant.length) { phrases.push(`${nom} : ${nf(t)}/50, c'est ta première note, elle sert de base de départ.`); return; }
    const prec = avant[avant.length - 1], d = t - prec;
    let f = `${nom} : ${nf(t)}/50 (précédent : ${nf(prec)}/50, ${d >= 0 ? "+" : ""}${nf(d)})`;
    if (avant.length >= 2) { const rec = avant.slice(-7); f += `, moyenne des ${rec.length} derniers : ${nf(rec.reduce((s, x) => s + x, 0) / rec.length)}/50`; }
    phrases.push(f + ".");
  });
  return phrases;
}

// ---------- Consigne donnée au modèle ----------
const SYSTEME = `Tu es le correcteur d'une routine quotidienne de fluidité verbale (100 jours) pour un élève francophone, dans le site de suivi de son enseignant. Tu notes avec une grille fixe, de façon constante d'un jour à l'autre, puis tu écris un retour bref, bienveillant et précis, en français, en tutoyant l'élève.

Tu juges seulement les critères suivants (les autres sont mesurés par la page) :
- Exercice 1, « liens » (0 à 10, demi-points autorisés) : pertinence des liens entre mots consécutifs. 10 : chaque mot est lié naturellement au précédent ; 7 : bons liens avec quelques sauts ; 4 : liens souvent faibles ou seulement thématiques ; 1 : mots sans rapport. Seule la chaîne de mots compte (ignore les avant-propos et commentaires).
- Exercice 2, structure et cohérence : « debut » (0 à 5) : début, milieu et fin repérables ; « fil » (0 à 5) : fil conducteur cohérent ; « developpement » (0 à 2) : idées développées plutôt que répétées. Le mot imposé est vérifié ailleurs : ne le note pas.

Règles : la transcription vient d'une reconnaissance vocale automatique, des mots peuvent être faux ou manquer : ne pénalise jamais ces erreurs ni les hésitations (elles sont mesurées ailleurs). Ne t'appuie que sur la transcription et sur les chiffres fournis, sans rien inventer ; appuie-toi sur un ou deux mots ou passages courts de la transcription. Reste cohérent : une prestation de même qualité reçoit la même note. Dans le retour, ne répète pas les chiffres déjà donnés ailleurs ; explique ce qui s'est passé et comment progresser.

Réponds UNIQUEMENT par un objet JSON valide (sans texte autour, sans balises) de cette forme, en omettant le bloc d'un exercice non fait :
{"ex1":{"liens":0,"justification":"une phrase"},"ex2":{"debut":0,"fil":0,"developpement":0,"justification":"une phrase"},"analyse":"3 à 5 phrases : points forts puis points à travailler","axes":["axe 1 concret","axe 2","axe 3"],"consigne":"une consigne précise et réalisable pour la prochaine séance"}
Les axes sont au nombre de 3 au maximum, courts et concrets.`;

function ligneMesures(ex, m) {
  if (!m) return "non fait";
  if (!m.aParle) return "aucune voix détectée";
  const p = [`${nf(m.mots, 0)} mots (${nf(m.differents, 0)} différents)`, `${nf(m.blancs, 0)} blancs de 2 s ou plus`, `plus longue pause ${nf(m.plusLongue)} s`, `délai avant de parler ${nf(m.delai)} s`, `silence final ${nf(m.silenceFinal)} s`];
  if (ex === "ex2") p.push(`débit ${nf(m.debit, 0)} mots/min`, `variation de hauteur ${nf(m.hauteurSt)} demi-tons`, `mots de remplissage ${nf(m.remplissage, 0)}`);
  return p.join(" ; ");
}
export function construirePrompt(seance, historique) {
  const L = [`Jour ${seance.jour} sur 100.`];
  if (seance.ex1 && seance.ex1.motCle) L.push(`Mot de départ de l'association : « ${seance.ex1.motCle} ».`);
  if (seance.ex2 && seance.ex2.motCle) L.push(`Mot imposé pour l'histoire : « ${seance.ex2.motCle} » (${seance.ex2.motImpose === true ? "utilisé" : seance.ex2.motImpose === false ? "absent" : "inconnu"}).`);
  [["ex1", "Exercice 1 (association, 60 s)"], ["ex2", "Exercice 2 (discours improvisé, 2 min)"]].forEach(([ex, titre]) => {
    const m = seance[ex];
    L.push("", `${titre} — mesures : ${ligneMesures(ex, m)}`);
    if (m && m.aParle) L.push(`Transcription : ${String(m.texte || "(vide)").slice(0, 3500)}`);
  });
  const h = resumeHistorique(historique);
  L.push("", h.length ? "Séances précédentes :\n" + h.join("\n") : "C'est la première séance de l'élève.");
  const dernier = historique.slice().reverse().find(s => s.analyse && Array.isArray(s.analyse.axes) && s.analyse.axes.length);
  if (dernier) L.push("", "Axes donnés la dernière fois (dis si c'est amélioré) : " + dernier.analyse.axes.join(" | "));
  return [{ role: "system", content: SYSTEME }, { role: "user", content: L.join("\n") }];
}

// ---------- Lecture de la réponse du modèle ----------
export function texteDeSortie(s) {
  if (!s) return "";
  if (typeof s === "string") return s;
  if (typeof s.response === "string") return s.response;
  if (s.response && typeof s.response === "object") return JSON.stringify(s.response);
  const c = s.choices && s.choices[0];
  if (c) { const m = c.message && c.message.content; if (typeof m === "string") return m; if (typeof c.text === "string") return c.text; }
  return "";
}
export function lireJson(texte) {
  let t = String(texte || "").replace(/```(?:json)?/gi, "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { const o = JSON.parse(t.slice(a, b + 1)); return o && typeof o === "object" ? o : null; } catch (e) { return null; }
}
const chaine = (x, max) => typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, max) : "";
const noteBornee = (x, max) => { const v = nombre(x); return v === null ? null : borne(demi(v), 0, max); };

// Extrait du JSON du modèle : jugements chiffrés (null si absents ou invalides) et textes.
export function validerReponse(o) {
  if (!o) return null;
  const ex1 = o.ex1 || {}, ex2 = o.ex2 || {};
  const parts = [noteBornee(ex2.debut, 5), noteBornee(ex2.fil, 5), noteBornee(ex2.developpement, 2)];
  return {
    liens: noteBornee(ex1.liens, 10),
    structurePartielle: parts.every(v => v !== null) ? parts[0] + parts[1] + parts[2] : null,
    detail: parts.every(v => v !== null) ? { debut: parts[0], fil: parts[1], developpement: parts[2] } : null,
    justifications: { ex1: chaine(ex1.justification, 300), ex2: chaine(ex2.justification, 300) },
    analyse: chaine(o.analyse, 1200),
    axes: (Array.isArray(o.axes) ? o.axes : []).map(a => chaine(a, 260)).filter(Boolean).slice(0, 3),
    consigne: chaine(o.consigne, 400)
  };
}

// ---------- Appels Workers AI ----------
const avecDelai = (promesse, ms) => Promise.race([promesse, new Promise((_, ko) => setTimeout(() => ko(new Error("délai dépassé")), ms))]);

async function vecteursDe(env, mots) {
  const uniques = [...new Set(mots)];
  const sortie = await avecDelai(env.AI.run(env.AI_EMBED_MODEL || MODELE_EMBED_DEFAUT, { text: uniques }), DELAI_MS);
  const data = sortie && (sortie.data || (sortie.result && sortie.result.data));
  if (!Array.isArray(data) || data.length !== uniques.length) throw new Error("embeddings inattendus");
  return Object.fromEntries(uniques.map((m, i) => [m, data[i]]));
}
async function jugementModele(env, seance, historique) {
  const modele = env.AI_MODEL || MODELE_DEFAUT;
  const sortie = await avecDelai(env.AI.run(modele, { messages: construirePrompt(seance, historique), temperature: 0, max_tokens: 900 }), DELAI_MS);
  const rep = validerReponse(lireJson(texteDeSortie(sortie)));
  if (!rep) throw new Error("réponse du modèle illisible");
  return { rep, modele };
}

// ---------- Retour rédigé ----------
function composerRetour(seance, notes, jug, historique, source) {
  const L = [`Retour du jour — jour ${seance.jour} sur 100`, ""];
  const noms = { rythme: "rythme", continuite: "continuité", richesse: "richesse", liens: "liens", debit: "débit", structure: "structure", voix: "voix" };
  ["ex1", "ex2"].forEach(ex => {
    if (!seance[ex]) return;
    const n = notes[ex], t = totalExercice(ex, n);
    const detail = Object.keys(CRITERES[ex]).map(c => `${noms[c]} ${n[c] == null ? "—" : nf(n[c])}/${CRITERES[ex][c]}`).join(" · ");
    L.push(`${ex === "ex1" ? "Exercice 1" : "Exercice 2"} : ${t == null ? "note incomplète" : nf(t) + "/50"} (${detail})`);
  });
  const t1 = seance.ex1 ? totalExercice("ex1", notes.ex1) : 0, t2 = seance.ex2 ? totalExercice("ex2", notes.ex2) : 0;
  if (seance.ex1 && seance.ex2 && t1 != null && t2 != null) L.push(`Total : ${nf(t1 + t2)}/100 — niveau « ${niveau(t1 + t2)} »`);
  else L.push("Total sur 100 : il faut les deux exercices.");
  const cmp = comparaison(seance, notes, historique);
  if (cmp.length) L.push("", "Évolution : " + cmp.join(" "));
  if (source === "estimation") L.push("", "Le retour détaillé n'a pas pu être rédigé aujourd'hui : les notes des critères jugés (liens, structure) sont des estimations automatiques, que l'enseignant peut corriger.");
  else {
    if (jug.analyse) L.push("", "Analyse : " + jug.analyse);
    if (jug.axes.length) L.push("", "À travailler :", ...jug.axes.map((a, i) => `${i + 1}. ${a}`));
    if (jug.consigne) L.push("", "Consigne pour la prochaine séance : " + jug.consigne);
  }
  return L.join("\n");
}

// ---------- Analyse complète d'une séance ----------
// Renvoie { analyse, notesAuto } ; lève une erreur seulement si aucune estimation n'est possible non plus.
export async function analyserSeance(env, seance, historique) {
  const aParle = ex => !!(seance[ex] && seance[ex].aParle);
  const notes = notesVides();
  ["ex1", "ex2"].forEach(ex => { if (seance[ex]) Object.keys(CRITERES[ex]).forEach(c => { const v = nombre(seance[ex].auto && seance[ex].auto[c]); notes[ex][c] = v === null ? null : borne(v, 0, CRITERES[ex][c]); }); });

  const analyse = { sources: {}, indices: {}, verifier: false };
  if (!aParle("ex1") && !aParle("ex2")) {      // rien à juger : pas de voix détectée
    if (seance.ex1) notes.ex1.liens = 0;
    if (seance.ex2) notes.ex2.structure = 0;
    analyse.statut = "ok"; analyse.sources = { liens: "aucune voix", structure: "aucune voix" };
    analyse.retour = composerRetour(seance, notes, { analyse: "Aucune voix n'a été détectée : vérifie le micro et recommence.", axes: [], consigne: "" }, historique, "modele");
    return { analyse, notesAuto: notes };
  }

  // Embeddings (liens) et modèle de langage en parallèle : le modèle ne voit pas l'indice, ce qui garde les deux avis indépendants.
  let indice = null, erreurEmbed = null;
  const tacheEmbed = (async () => {
    if (!aParle("ex1")) return;
    const mots = motsAssociation(seance.ex1.texte, seance.ex1.motCle);
    if (mots.length < 4) return;
    try { indice = indiceLiens(mots, await vecteursDe(env, mots)); } catch (e) { erreurEmbed = e.message; }
  })();
  let jug = null, modele = null, erreurModele = null;
  const tacheModele = jugementModele(env, seance, historique).then(r => { jug = r.rep; modele = r.modele; }).catch(e => { erreurModele = e.message; });
  await Promise.all([tacheEmbed, tacheModele]);

  const estLiens = estimerLiens(indice);
  const indS = aParle("ex2") ? indicesStructure(seance.ex2.texte, seance.ex2.motImpose) : null;
  const estStructure = indS ? estimerStructure(indS) : null;
  analyse.indices = { liens: indice, estimationLiens: estLiens, structure: indS, estimationStructure: estStructure };
  if (erreurEmbed) analyse.erreurEmbeddings = erreurEmbed;

  if (seance.ex1) {
    if (!aParle("ex1")) { notes.ex1.liens = 0; analyse.sources.liens = "aucune voix"; }
    else if (jug && jug.liens !== null) { notes.ex1.liens = jug.liens; analyse.sources.liens = "modele"; }
    else if (estLiens !== null) { notes.ex1.liens = estLiens; analyse.sources.liens = "estimation"; }
  }
  if (seance.ex2) {
    if (!aParle("ex2")) { notes.ex2.structure = 0; analyse.sources.structure = "aucune voix"; }
    else if (jug && jug.structurePartielle !== null) { notes.ex2.structure = borne(jug.structurePartielle + (seance.ex2.motImpose === true ? 3 : 0), 0, 15); analyse.sources.structure = "modele"; analyse.detailStructure = { ...jug.detail, mot: seance.ex2.motImpose === true ? 3 : 0 }; }
    else { notes.ex2.structure = estStructure; analyse.sources.structure = "estimation"; }
  }
  if (analyse.sources.liens === "modele" && estLiens !== null && Math.abs(notes.ex1.liens - estLiens) >= ECART_A_VERIFIER) analyse.verifier = true;

  const complet = ["ex1", "ex2"].every(ex => !seance[ex] || totalExercice(ex, notes[ex]) !== null);
  analyse.modele = modele || null;
  if (jug) { analyse.justifications = jug.justifications; analyse.axes = jug.axes; analyse.consigne = jug.consigne; analyse.texteAnalyse = jug.analyse; }
  if (erreurModele) analyse.erreur = erreurModele;
  if (jug && complet) { analyse.statut = "ok"; analyse.retour = composerRetour(seance, notes, jug, historique, "modele"); }
  else if (complet) { analyse.statut = "estimation"; analyse.retour = composerRetour(seance, notes, { analyse: "", axes: [], consigne: "" }, historique, "estimation"); }
  else { analyse.statut = "echec"; }
  return { analyse, notesAuto: complet ? notes : null };
}
