// src/analyse.js
var MODELE_DEFAUT = "@cf/mistralai/mistral-small-3.1-24b-instruct";
var MODELE_EMBED_DEFAUT = "@cf/baai/bge-m3";
var DELAI_MS = 25e3;
var CRITERES = {
  ex1: { rythme: 15, continuite: 15, richesse: 10, liens: 10 },
  ex2: { continuite: 15, debit: 10, structure: 15, voix: 10 }
};
var NIVEAUX = [[0, "\xE0 construire"], [40, "en progr\xE8s"], [60, "solide"], [80, "tr\xE8s fluide"]];
var niveau = (t) => NIVEAUX.filter((n) => t >= n[0]).pop()[1];
var SEUIL_SAUT = 0.42;
var SIM_BASSE = 0.35;
var SIM_HAUTE = 0.65;
var ECART_A_VERIFIER = 3;
var borne = (x, min, max) => Math.min(max, Math.max(min, x));
var demi = (x) => Math.round(x * 2) / 2;
var nombre = (x) => x === null || x === void 0 || x === "" || !Number.isFinite(Number(x)) ? null : Number(x);
var nf = (x, d = 1) => x == null ? "\u2014" : String(Math.round(x * Math.pow(10, d)) / Math.pow(10, d)).replace(".", ",");
var MOTS_OUTILS = new Set("le la les un une des du de d l et ou \xE0 au aux en dans sur sous par pour avec sans ce cet cette ces se sa son ses mon ma mes ton ta tes qui que quoi dont o\xF9 est sont a ont \xE9t\xE9 \xEAtre avoir fait il elle on ils elles je tu nous vous y ne pas plus tr\xE8s bien aussi puis alors donc mais euh heu ben bon voil\xE0".split(/\s+/));
function motsAssociation(texte, motDepart) {
  const brut = String(texte || "").toLowerCase().replace(/[’']/g, " ").split(/[^a-zà-ÿœæ-]+/).map((w) => w.replace(/^-+|-+$/g, "")).filter(Boolean);
  const liste = [String(motDepart || "").toLowerCase().trim(), ...brut.filter((w) => w.length >= 3 && !MOTS_OUTILS.has(w))].filter(Boolean);
  return liste.filter((w, i) => i === 0 || w !== liste[i - 1]).slice(0, 70);
}
var CONNECTEURS = ["alors", "puis", "ensuite", "enfin", "finalement", "soudain", "un jour", "il \xE9tait une fois", "apr\xE8s", "pendant", "mais", "donc", "parce que", "quand", "pourtant", "depuis", "avant", "d'abord", "tout \xE0 coup"];
function indicesStructure(texte, motImpose) {
  const t = String(texte || "").toLowerCase().replace(/[’]/g, "'");
  const mots = t.split(/[^a-zà-ÿœæ'-]+/).filter(Boolean);
  const differents = new Set(mots).size;
  let connecteurs = 0;
  CONNECTEURS.forEach((c) => {
    const m = t.match(new RegExp("(^|[^a-z\xE0-\xFF])" + c.replace(/'/g, "'") + "(?![a-z\xE0-\xFF])", "g"));
    if (m) connecteurs += m.length;
  });
  return { mots: mots.length, differents, partDifferents: mots.length ? differents / mots.length : 0, connecteurs, motImpose: motImpose === true };
}
function estimerStructure(ind) {
  const v = (ind.motImpose ? 3 : 0) + (ind.partDifferents >= 0.5 ? 2 : 1) + 5 * Math.min(1, ind.mots / 180) + 5 * Math.min(1, ind.connecteurs / 5);
  return borne(demi(v), 0, 15);
}
function cosinus(a, b) {
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
}
function indiceLiens(mots, vecteurs) {
  const sims = [];
  for (let i = 1; i < mots.length; i++) if (vecteurs[mots[i - 1]] && vecteurs[mots[i]]) sims.push(cosinus(vecteurs[mots[i - 1]], vecteurs[mots[i]]));
  if (sims.length < 3) return null;
  const tri = sims.slice().sort((x, y) => x - y);
  const moyenne = sims.reduce((s, x) => s + x, 0) / sims.length;
  const sauts = sims.filter((x) => x < SEUIL_SAUT).length;
  return { n: sims.length, moyenne: Math.round(moyenne * 1e3) / 1e3, mediane: Math.round(tri[Math.floor(tri.length / 2)] * 1e3) / 1e3, sauts, partSauts: Math.round(sauts / sims.length * 100) / 100 };
}
function estimerLiens(indice) {
  if (!indice) return null;
  return borne(demi(1 + 9 * borne((indice.moyenne - SIM_BASSE) / (SIM_HAUTE - SIM_BASSE), 0, 1)), 0, 10);
}
function signature(s) {
  const e = (x) => x ? [x.texte, x.aParle, x.mots, x.differents, x.blancs, x.motImpose, x.motCle, x.auto] : null;
  const t = JSON.stringify([e(s.ex1), e(s.ex2)]);
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16);
}
function totalExercice(ex, notesEx) {
  if (!notesEx) return null;
  let s = 0;
  for (const c of Object.keys(CRITERES[ex])) {
    const v = notesEx[c];
    if (v == null) return null;
    s += v;
  }
  return s;
}
var notesEffectives = (s) => s.notes || s.notesAuto || null;
function notesVides() {
  return { ex1: Object.fromEntries(Object.keys(CRITERES.ex1).map((c) => [c, null])), ex2: Object.fromEntries(Object.keys(CRITERES.ex2).map((c) => [c, null])) };
}
function resumeHistorique(historique) {
  const lignes = [];
  historique.slice(-7).forEach((s) => {
    const n = notesEffectives(s) || {};
    const t1 = totalExercice("ex1", n.ex1), t2 = totalExercice("ex2", n.ex2);
    lignes.push(`jour ${s.jour} (${String(s.date).slice(0, 10)}) : exercice 1 ${t1 == null ? s.ex1 ? "non not\xE9" : "non fait" : t1 + "/50"}, exercice 2 ${t2 == null ? s.ex2 ? "non not\xE9" : "non fait" : t2 + "/50"}`);
  });
  return lignes;
}
function comparaison(seance, notes, historique) {
  const phrases = [];
  ["ex1", "ex2"].forEach((ex) => {
    const t = totalExercice(ex, notes[ex]);
    if (t == null) return;
    const avant = historique.map((s) => totalExercice(ex, (notesEffectives(s) || {})[ex])).filter((v) => v != null);
    const nom = ex === "ex1" ? "Exercice 1" : "Exercice 2";
    if (!avant.length) {
      phrases.push(`${nom} : ${nf(t)}/50, c'est ta premi\xE8re note, elle sert de base de d\xE9part.`);
      return;
    }
    const prec = avant[avant.length - 1], d = t - prec;
    let f = `${nom} : ${nf(t)}/50 (pr\xE9c\xE9dent : ${nf(prec)}/50, ${d >= 0 ? "+" : ""}${nf(d)})`;
    if (avant.length >= 2) {
      const rec = avant.slice(-7);
      f += `, moyenne des ${rec.length} derniers : ${nf(rec.reduce((s, x) => s + x, 0) / rec.length)}/50`;
    }
    phrases.push(f + ".");
  });
  return phrases;
}
var SYSTEME = `Tu es le correcteur d'une routine quotidienne de fluidit\xE9 verbale (100 jours) pour un \xE9l\xE8ve francophone, dans le site de suivi de son enseignant. Tu notes avec une grille fixe, de fa\xE7on constante d'un jour \xE0 l'autre, puis tu \xE9cris un retour bref, bienveillant et pr\xE9cis, en fran\xE7ais, en tutoyant l'\xE9l\xE8ve.

Tu juges seulement les crit\xE8res suivants (les autres sont mesur\xE9s par la page) :
- Exercice 1, \xAB liens \xBB (0 \xE0 10, demi-points autoris\xE9s) : pertinence des liens entre mots cons\xE9cutifs. 10 : chaque mot est li\xE9 naturellement au pr\xE9c\xE9dent ; 7 : bons liens avec quelques sauts ; 4 : liens souvent faibles ou seulement th\xE9matiques ; 1 : mots sans rapport. Seule la cha\xEEne de mots compte (ignore les avant-propos et commentaires).
- Exercice 2, structure et coh\xE9rence : \xAB debut \xBB (0 \xE0 5) : d\xE9but, milieu et fin rep\xE9rables ; \xAB fil \xBB (0 \xE0 5) : fil conducteur coh\xE9rent ; \xAB developpement \xBB (0 \xE0 2) : id\xE9es d\xE9velopp\xE9es plut\xF4t que r\xE9p\xE9t\xE9es. Le mot impos\xE9 est v\xE9rifi\xE9 ailleurs : ne le note pas.

R\xE8gles : la transcription vient d'une reconnaissance vocale automatique, des mots peuvent \xEAtre faux ou manquer : ne p\xE9nalise jamais ces erreurs ni les h\xE9sitations (elles sont mesur\xE9es ailleurs). Ne t'appuie que sur la transcription et sur les chiffres fournis, sans rien inventer ; appuie-toi sur un ou deux mots ou passages courts de la transcription. Reste coh\xE9rent : une prestation de m\xEAme qualit\xE9 re\xE7oit la m\xEAme note. Dans le retour, ne r\xE9p\xE8te pas les chiffres d\xE9j\xE0 donn\xE9s ailleurs ; explique ce qui s'est pass\xE9 et comment progresser.

R\xE9ponds UNIQUEMENT par un objet JSON valide (sans texte autour, sans balises) de cette forme, en omettant le bloc d'un exercice non fait :
{"ex1":{"liens":0,"justification":"une phrase"},"ex2":{"debut":0,"fil":0,"developpement":0,"justification":"une phrase"},"analyse":"3 \xE0 5 phrases : points forts puis points \xE0 travailler","axes":["axe 1 concret","axe 2","axe 3"],"consigne":"une consigne pr\xE9cise et r\xE9alisable pour la prochaine s\xE9ance"}
Les axes sont au nombre de 3 au maximum, courts et concrets.`;
function ligneMesures(ex, m) {
  if (!m) return "non fait";
  if (!m.aParle) return "aucune voix d\xE9tect\xE9e";
  const p = [`${nf(m.mots, 0)} mots (${nf(m.differents, 0)} diff\xE9rents)`, `${nf(m.blancs, 0)} blancs de 2 s ou plus`, `plus longue pause ${nf(m.plusLongue)} s`, `d\xE9lai avant de parler ${nf(m.delai)} s`, `silence final ${nf(m.silenceFinal)} s`];
  if (ex === "ex2") p.push(`d\xE9bit ${nf(m.debit, 0)} mots/min`, `variation de hauteur ${nf(m.hauteurSt)} demi-tons`, `mots de remplissage ${nf(m.remplissage, 0)}`);
  return p.join(" ; ");
}
function construirePrompt(seance, historique) {
  const L = [`Jour ${seance.jour} sur 100.`];
  if (seance.ex1 && seance.ex1.motCle) L.push(`Mot de d\xE9part de l'association : \xAB ${seance.ex1.motCle} \xBB.`);
  if (seance.ex2 && seance.ex2.motCle) L.push(`Mot impos\xE9 pour l'histoire : \xAB ${seance.ex2.motCle} \xBB (${seance.ex2.motImpose === true ? "utilis\xE9" : seance.ex2.motImpose === false ? "absent" : "inconnu"}).`);
  [["ex1", "Exercice 1 (association, 60 s)"], ["ex2", "Exercice 2 (discours improvis\xE9, 2 min)"]].forEach(([ex, titre]) => {
    const m = seance[ex];
    L.push("", `${titre} \u2014 mesures : ${ligneMesures(ex, m)}`);
    if (m && m.aParle) L.push(`Transcription : ${String(m.texte || "(vide)").slice(0, 3500)}`);
  });
  const h = resumeHistorique(historique);
  L.push("", h.length ? "S\xE9ances pr\xE9c\xE9dentes :\n" + h.join("\n") : "C'est la premi\xE8re s\xE9ance de l'\xE9l\xE8ve.");
  const dernier = historique.slice().reverse().find((s) => s.analyse && Array.isArray(s.analyse.axes) && s.analyse.axes.length);
  if (dernier) L.push("", "Axes donn\xE9s la derni\xE8re fois (dis si c'est am\xE9lior\xE9) : " + dernier.analyse.axes.join(" | "));
  return [{ role: "system", content: SYSTEME }, { role: "user", content: L.join("\n") }];
}
function texteDeSortie(s) {
  if (!s) return "";
  if (typeof s === "string") return s;
  if (typeof s.response === "string") return s.response;
  if (s.response && typeof s.response === "object") return JSON.stringify(s.response);
  const c = s.choices && s.choices[0];
  if (c) {
    const m = c.message && c.message.content;
    if (typeof m === "string") return m;
    if (typeof c.text === "string") return c.text;
  }
  return "";
}
function lireJson(texte) {
  let t = String(texte || "").replace(/```(?:json)?/gi, "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    const o = JSON.parse(t.slice(a, b + 1));
    return o && typeof o === "object" ? o : null;
  } catch (e) {
    return null;
  }
}
var chaine = (x, max) => typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, max) : "";
var noteBornee = (x, max) => {
  const v = nombre(x);
  return v === null ? null : borne(demi(v), 0, max);
};
function validerReponse(o) {
  if (!o) return null;
  const ex1 = o.ex1 || {}, ex2 = o.ex2 || {};
  const parts = [noteBornee(ex2.debut, 5), noteBornee(ex2.fil, 5), noteBornee(ex2.developpement, 2)];
  return {
    liens: noteBornee(ex1.liens, 10),
    structurePartielle: parts.every((v) => v !== null) ? parts[0] + parts[1] + parts[2] : null,
    detail: parts.every((v) => v !== null) ? { debut: parts[0], fil: parts[1], developpement: parts[2] } : null,
    justifications: { ex1: chaine(ex1.justification, 300), ex2: chaine(ex2.justification, 300) },
    analyse: chaine(o.analyse, 1200),
    axes: (Array.isArray(o.axes) ? o.axes : []).map((a) => chaine(a, 260)).filter(Boolean).slice(0, 3),
    consigne: chaine(o.consigne, 400)
  };
}
var avecDelai = (promesse, ms) => Promise.race([promesse, new Promise((_, ko) => setTimeout(() => ko(new Error("d\xE9lai d\xE9pass\xE9")), ms))]);
async function vecteursDe(env, mots) {
  const uniques = [...new Set(mots)];
  const sortie = await avecDelai(env.AI.run(env.AI_EMBED_MODEL || MODELE_EMBED_DEFAUT, { text: uniques }), DELAI_MS);
  const data = sortie && (sortie.data || sortie.result && sortie.result.data);
  if (!Array.isArray(data) || data.length !== uniques.length) throw new Error("embeddings inattendus");
  return Object.fromEntries(uniques.map((m, i) => [m, data[i]]));
}
async function jugementModele(env, seance, historique) {
  const modele = env.AI_MODEL || MODELE_DEFAUT;
  const sortie = await avecDelai(env.AI.run(modele, { messages: construirePrompt(seance, historique), temperature: 0, max_tokens: 900 }), DELAI_MS);
  const rep = validerReponse(lireJson(texteDeSortie(sortie)));
  if (!rep) throw new Error("r\xE9ponse du mod\xE8le illisible");
  return { rep, modele };
}
function composerRetour(seance, notes, jug, historique, source) {
  const L = [`Retour du jour \u2014 jour ${seance.jour} sur 100`, ""];
  const noms = { rythme: "rythme", continuite: "continuit\xE9", richesse: "richesse", liens: "liens", debit: "d\xE9bit", structure: "structure", voix: "voix" };
  ["ex1", "ex2"].forEach((ex) => {
    if (!seance[ex]) return;
    const n = notes[ex], t = totalExercice(ex, n);
    const detail = Object.keys(CRITERES[ex]).map((c) => `${noms[c]} ${n[c] == null ? "\u2014" : nf(n[c])}/${CRITERES[ex][c]}`).join(" \xB7 ");
    L.push(`${ex === "ex1" ? "Exercice 1" : "Exercice 2"} : ${t == null ? "note incompl\xE8te" : nf(t) + "/50"} (${detail})`);
  });
  const t1 = seance.ex1 ? totalExercice("ex1", notes.ex1) : 0, t2 = seance.ex2 ? totalExercice("ex2", notes.ex2) : 0;
  if (seance.ex1 && seance.ex2 && t1 != null && t2 != null) L.push(`Total : ${nf(t1 + t2)}/100 \u2014 niveau \xAB ${niveau(t1 + t2)} \xBB`);
  else L.push("Total sur 100 : il faut les deux exercices.");
  const cmp = comparaison(seance, notes, historique);
  if (cmp.length) L.push("", "\xC9volution : " + cmp.join(" "));
  if (source === "estimation") L.push("", "Le retour d\xE9taill\xE9 n'a pas pu \xEAtre r\xE9dig\xE9 aujourd'hui : les notes des crit\xE8res jug\xE9s (liens, structure) sont des estimations automatiques, que l'enseignant peut corriger.");
  else {
    if (jug.analyse) L.push("", "Analyse : " + jug.analyse);
    if (jug.axes.length) L.push("", "\xC0 travailler :", ...jug.axes.map((a, i) => `${i + 1}. ${a}`));
    if (jug.consigne) L.push("", "Consigne pour la prochaine s\xE9ance : " + jug.consigne);
  }
  return L.join("\n");
}
async function analyserSeance(env, seance, historique) {
  const aParle = (ex) => !!(seance[ex] && seance[ex].aParle);
  const notes = notesVides();
  ["ex1", "ex2"].forEach((ex) => {
    if (seance[ex]) Object.keys(CRITERES[ex]).forEach((c) => {
      const v = nombre(seance[ex].auto && seance[ex].auto[c]);
      notes[ex][c] = v === null ? null : borne(v, 0, CRITERES[ex][c]);
    });
  });
  const analyse = { sources: {}, indices: {}, verifier: false };
  if (!aParle("ex1") && !aParle("ex2")) {
    if (seance.ex1) notes.ex1.liens = 0;
    if (seance.ex2) notes.ex2.structure = 0;
    analyse.statut = "ok";
    analyse.sources = { liens: "aucune voix", structure: "aucune voix" };
    analyse.retour = composerRetour(seance, notes, { analyse: "Aucune voix n'a \xE9t\xE9 d\xE9tect\xE9e : v\xE9rifie le micro et recommence.", axes: [], consigne: "" }, historique, "modele");
    return { analyse, notesAuto: notes };
  }
  let indice = null, erreurEmbed = null;
  const tacheEmbed = (async () => {
    if (!aParle("ex1")) return;
    const mots = motsAssociation(seance.ex1.texte, seance.ex1.motCle);
    if (mots.length < 4) return;
    try {
      indice = indiceLiens(mots, await vecteursDe(env, mots));
    } catch (e) {
      erreurEmbed = e.message;
    }
  })();
  let jug = null, modele = null, erreurModele = null;
  const tacheModele = jugementModele(env, seance, historique).then((r) => {
    jug = r.rep;
    modele = r.modele;
  }).catch((e) => {
    erreurModele = e.message;
  });
  await Promise.all([tacheEmbed, tacheModele]);
  const estLiens = estimerLiens(indice);
  const indS = aParle("ex2") ? indicesStructure(seance.ex2.texte, seance.ex2.motImpose) : null;
  const estStructure = indS ? estimerStructure(indS) : null;
  analyse.indices = { liens: indice, estimationLiens: estLiens, structure: indS, estimationStructure: estStructure };
  if (erreurEmbed) analyse.erreurEmbeddings = erreurEmbed;
  if (seance.ex1) {
    if (!aParle("ex1")) {
      notes.ex1.liens = 0;
      analyse.sources.liens = "aucune voix";
    } else if (jug && jug.liens !== null) {
      notes.ex1.liens = jug.liens;
      analyse.sources.liens = "modele";
    } else if (estLiens !== null) {
      notes.ex1.liens = estLiens;
      analyse.sources.liens = "estimation";
    }
  }
  if (seance.ex2) {
    if (!aParle("ex2")) {
      notes.ex2.structure = 0;
      analyse.sources.structure = "aucune voix";
    } else if (jug && jug.structurePartielle !== null) {
      notes.ex2.structure = borne(jug.structurePartielle + (seance.ex2.motImpose === true ? 3 : 0), 0, 15);
      analyse.sources.structure = "modele";
      analyse.detailStructure = { ...jug.detail, mot: seance.ex2.motImpose === true ? 3 : 0 };
    } else {
      notes.ex2.structure = estStructure;
      analyse.sources.structure = "estimation";
    }
  }
  if (analyse.sources.liens === "modele" && estLiens !== null && Math.abs(notes.ex1.liens - estLiens) >= ECART_A_VERIFIER) analyse.verifier = true;
  const complet = ["ex1", "ex2"].every((ex) => !seance[ex] || totalExercice(ex, notes[ex]) !== null);
  analyse.modele = modele || null;
  if (jug) {
    analyse.justifications = jug.justifications;
    analyse.axes = jug.axes;
    analyse.consigne = jug.consigne;
    analyse.texteAnalyse = jug.analyse;
  }
  if (erreurModele) analyse.erreur = erreurModele;
  if (jug && complet) {
    analyse.statut = "ok";
    analyse.retour = composerRetour(seance, notes, jug, historique, "modele");
  } else if (complet) {
    analyse.statut = "estimation";
    analyse.retour = composerRetour(seance, notes, { analyse: "", axes: [], consigne: "" }, historique, "estimation");
  } else {
    analyse.statut = "echec";
  }
  return { analyse, notesAuto: complet ? notes : null };
}

// src/index.js
var ROUTINES = ["probabilites", "technologie", "parole"];
var CLASSES = ["5e", "seconde"];
var MAX_ECHECS = 10;
var BLOCAGE_SECONDES = 900;
var src_default = {
  async fetch(request, env, ctx) {
    const origine = request.headers.get("Origin") || "";
    const autorisees = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const cors = {
      "Access-Control-Allow-Origin": autorisees.includes(origine) ? origine : autorisees[0] || "",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ erreur: "POST attendu" }, 405, cors);
    if (origine && !autorisees.includes(origine)) return json({ erreur: "Origine refus\xE9e" }, 403, cors);
    let corps;
    try {
      corps = await request.json();
    } catch (e) {
      return json({ erreur: "JSON invalide" }, 400, cors);
    }
    if (!corps || typeof corps !== "object") return json({ erreur: "Requ\xEAte invalide" }, 400, cors);
    const chemin = new URL(request.url).pathname.replace(/\/+$/, "");
    try {
      if (chemin === "/valider") return await valider(env, corps, cors);
      if (chemin === "/etat") return await etatEleve(env, corps, cors);
      if (chemin === "/admin/etat") return await adminEtat(env, request, corps, cors);
      if (chemin === "/admin/reinitialiser") return await adminReinitialiser(env, request, corps, cors);
      if (chemin === "/parole/enregistrer") return await paroleEnregistrer(env, ctx, corps, cors);
      if (chemin === "/parole/analyser") return await paroleAnalyser(env, ctx, corps, cors);
      if (chemin === "/parole/etat") return await paroleEtat(env, corps, cors);
      if (chemin === "/parole/audio") return await paroleAudio(env, corps, cors);
      if (chemin === "/admin/parole/archive") return await adminParoleArchive(env, request, corps, cors);
      if (chemin === "/admin/parole/audio") return await adminParoleAudio(env, request, corps, cors);
      if (chemin === "/admin/parole/reinitialiser") return await adminParoleReinitialiser(env, request, corps, cors);
      if (chemin === "/admin/parole") return await adminParole(env, request, corps, cors);
      if (chemin === "/admin/parole/noter") return await adminParoleNoter(env, request, corps, cors);
      if (chemin === "/admin/parole/analyser") return await adminParoleAnalyser(env, ctx, request, corps, cors);
      if (chemin === "/admin/parole/supprimer") return await adminParoleSupprimer(env, request, corps, cors);
      if (chemin === "/reponses/envoyer") return await reponsesEnvoyer(env, corps, cors);
      if (chemin === "/reponses/etat") return await reponsesEtat(env, corps, cors);
      if (chemin === "/admin/reponses") return await adminReponses(env, request, corps, cors);
      if (chemin === "/admin/reponses/modifier") return await adminReponsesModifier(env, request, corps, cors);
      if (chemin === "/admin/reponses/relancer") return await adminReponsesRelancer(env, request, corps, cors);
      if (chemin === "/admin/reponses/supprimer") return await adminReponsesSupprimer(env, request, corps, cors);
    } catch (e) {
      return json({ erreur: "Erreur du serveur" }, 500, cors);
    }
    return json({ erreur: "Route inconnue" }, 404, cors);
  }
};
async function valider(env, c, cors) {
  const eleve = await identifier(env, c.classe, c.code);
  if (!eleve) return json({ erreur: "Code inconnu" }, 403, cors);
  if (!ROUTINES.includes(c.routine)) return json({ erreur: "Routine inconnue" }, 400, cors);
  const n = Number(c.jour);
  if (!Number.isInteger(n) || n < 1 || n > 100) return json({ erreur: "Jour invalide" }, 400, cors);
  const cle = `fait:${eleve.empreinte}:${c.routine}:${n}`;
  if (!await env.SUIVI.get(cle)) {
    await env.SUIVI.put(cle, JSON.stringify({ code: eleve.code, classe: c.classe, date: (/* @__PURE__ */ new Date()).toISOString() }));
  }
  return json({ ok: true, jours: await joursDe(env, eleve.empreinte) }, 200, cors);
}
async function etatEleve(env, c, cors) {
  const eleve = await identifier(env, c.classe, c.code);
  if (!eleve) return json({ erreur: "Code inconnu" }, 403, cors);
  return json({ ok: true, jours: await joursDe(env, eleve.empreinte) }, 200, cors);
}
async function joursDe(env, empreinte) {
  const jours = Object.fromEntries(ROUTINES.map((r) => [r, []]));
  for (const nom of await toutesLesCles(env, `fait:${empreinte}:`)) {
    const [, , routine, n] = nom.split(":");
    if (jours[routine]) jours[routine].push(Number(n));
  }
  ROUTINES.forEach((r) => jours[r].sort((a, b) => a - b));
  return jours;
}
async function adminEtat(env, request, c, cors) {
  const refus = await verifierMotDePasse(env, request, c.motdepasse, cors);
  if (refus) return refus;
  const eleves = {};
  for (const nom of await toutesLesCles(env, "fait:")) {
    const [, empreinte, routine, n] = nom.split(":");
    const valeur = JSON.parse(await env.SUIVI.get(nom) || "null");
    if (!valeur) continue;
    const e = eleves[empreinte] || (eleves[empreinte] = { empreinte, code: valeur.code, classe: valeur.classe, jours: Object.fromEntries(ROUTINES.map((r) => [r, []])) });
    if (e.jours[routine]) e.jours[routine].push({ n: Number(n), date: valeur.date });
  }
  const liste = Object.values(eleves).sort((a, b) => a.classe.localeCompare(b.classe) || a.code.localeCompare(b.code));
  liste.forEach((e) => ROUTINES.forEach((r) => e.jours[r].sort((x, y) => x.n - y.n)));
  return json({ ok: true, eleves: liste }, 200, cors);
}
async function adminReinitialiser(env, request, c, cors) {
  const refus = await verifierMotDePasse(env, request, c.motdepasse, cors);
  if (refus) return refus;
  if (typeof c.empreinte !== "string" || !/^[0-9a-f]{64}$/.test(c.empreinte)) return json({ erreur: "\xC9l\xE8ve invalide" }, 400, cors);
  if (!ROUTINES.includes(c.routine)) return json({ erreur: "Routine inconnue" }, 400, cors);
  if (c.routine === "parole") return json({ erreur: "Pour la fluidit\xE9 verbale, utilisez /admin/parole/reinitialiser (choix de conserver ou non les audios)" }, 400, cors);
  let supprimes = 0;
  if (c.jour === "tous") {
    for (const nom of await toutesLesCles(env, `fait:${c.empreinte}:${c.routine}:`)) {
      await env.SUIVI.delete(nom);
      supprimes++;
    }
  } else {
    const n = Number(c.jour);
    if (!Number.isInteger(n) || n < 1 || n > 100) return json({ erreur: "Jour invalide" }, 400, cors);
    const cle = `fait:${c.empreinte}:${c.routine}:${n}`;
    if (await env.SUIVI.get(cle)) {
      await env.SUIVI.delete(cle);
      supprimes = 1;
    }
  }
  return json({ ok: true, supprimes }, 200, cors);
}
var MAX_SEANCES = 300;
var CLE_SEANCE = /^parole:[0-9a-f]{64}:\d{1,3}:\d{10,14}$/;
var texteBorne = (s, max) => typeof s === "string" ? s.slice(0, max) : "";
var nombreOuNull = (x) => x === null || x === "" || x === void 0 || !Number.isFinite(Number(x)) ? null : Math.round(Number(x) * 100) / 100;
function notesValides(n) {
  if (!n || typeof n !== "object") return null;
  const sortie = {};
  for (const ex of Object.keys(CRITERES)) {
    sortie[ex] = {};
    for (const [c, max] of Object.entries(CRITERES[ex])) {
      const v = nombreOuNull(n[ex] && n[ex][c]);
      sortie[ex][c] = v === null ? null : Math.min(max, Math.max(0, v));
    }
  }
  return sortie;
}
function exerciceValide(e) {
  if (!e || typeof e !== "object") return null;
  const s = {
    texte: texteBorne(e.texte, 6e3),
    aParle: e.aParle === true,
    reconnue: e.reconnue === true,
    motImpose: typeof e.motImpose === "boolean" ? e.motImpose : null,
    motCle: texteBorne(e.motCle, 40)
  };
  for (const k of ["duree", "mots", "differents", "delai", "silenceFinal", "pauses", "blancs", "plusLongue", "totalPauses", "debit", "hauteurSt", "tendanceDb", "remplissage"]) s[k] = nombreOuNull(e[k]);
  s.auto = e.auto && typeof e.auto === "object" ? Object.fromEntries(Object.entries(e.auto).slice(0, 8).map(([k, v]) => [k.slice(0, 20), nombreOuNull(v)])) : {};
  return s;
}
async function paroleEnregistrer(env, ctx, c, cors) {
  const eleve = await identifier(env, c.classe, c.code);
  if (!eleve) return json({ erreur: "Code inconnu" }, 403, cors);
  const jour = Number(c.jour);
  if (!Number.isInteger(jour) || jour < 1 || jour > 100) return json({ erreur: "Jour invalide" }, 400, cors);
  if (typeof c.seance !== "string" || !/^\d{10,14}$/.test(c.seance)) return json({ erreur: "S\xE9ance invalide" }, 400, cors);
  const cle = `parole:${eleve.empreinte}:${jour}:${c.seance}`;
  const ancien = JSON.parse(await env.SUIVI.get(cle) || "null");
  if (!ancien && (await toutesLesCles(env, `parole:${eleve.empreinte}:`)).length >= MAX_SEANCES) return json({ erreur: "Trop de s\xE9ances enregistr\xE9es" }, 429, cors);
  const maintenant = (/* @__PURE__ */ new Date()).toISOString();
  const valeur = {
    code: eleve.code,
    classe: c.classe,
    jour,
    seance: c.seance,
    date: ancien ? ancien.date : maintenant,
    maj: maintenant,
    bilan: texteBorne(c.bilan, 8e3),
    ex1: exerciceValide(c.ex1),
    ex2: exerciceValide(c.ex2),
    notes: ancien ? ancien.notes : null,
    retour: ancien ? ancien.retour : "",
    audios: ancien ? ancien.audios || [] : []
  };
  if (ancien) {
    if (ancien.notesAuto) valeur.notesAuto = ancien.notesAuto;
    if (ancien.analyse) valeur.analyse = ancien.analyse;
    if (ancien.corrections) valeur.corrections = ancien.corrections;
    if (ancien.notesLe) valeur.notesLe = ancien.notesLe;
  }
  let lancer = false;
  if (env.AI && (valeur.ex1 || valeur.ex2)) {
    const sig = signature(valeur), a = valeur.analyse;
    if (!a || a.sig !== sig) {
      const nb = (a && a.nb || 0) + 1;
      if (nb > MAX_ANALYSES_SEANCE) valeur.analyse = { ...a || {}, sig, statut: "plafond", nb: nb - 1 };
      else if (!await reserverAnalyse(env, eleve.empreinte)) valeur.analyse = { ...a || {}, sig, statut: "plafond", nb: nb - 1 };
      else {
        valeur.analyse = { ...a || {}, sig, statut: "en_cours", nb, debut: maintenant };
        lancer = true;
      }
    }
  }
  await env.SUIVI.put(cle, JSON.stringify(valeur));
  if (lancer) arrierePlan(ctx, lancerAnalyse(env, cle));
  return json({ ok: true, analyse: valeur.analyse ? valeur.analyse.statut : null }, 200, cors);
}
var MAX_AUDIO_BASE64 = 45e5;
var TYPES_AUDIO = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3" };
function appelGitHub(env, methode, chemin, corps, accept = "application/vnd.github+json") {
  return fetch("https://api.github.com" + chemin, {
    method: methode,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "User-Agent": "routinesite-suivi",
      Accept: accept,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json"
    },
    body: corps ? JSON.stringify(corps) : void 0
  });
}
async function depotPrive(env, depot) {
  const cle = `audio:prive:${depot}`;
  if (await env.SUIVI.get(cle)) return true;
  const r = await appelGitHub(env, "GET", `/repos/${depot}`);
  if (!r.ok) return false;
  const d = await r.json().catch(() => ({}));
  if (d.private !== true) return false;
  await env.SUIVI.put(cle, "1", { expirationTtl: 60 });
  return true;
}
async function paroleAudio(env, c, cors) {
  const eleve = await identifier(env, c.classe, c.code);
  if (!eleve) return json({ erreur: "Code inconnu" }, 403, cors);
  const jour = Number(c.jour);
  if (!Number.isInteger(jour) || jour < 1 || jour > 100) return json({ erreur: "Jour invalide" }, 400, cors);
  if (typeof c.seance !== "string" || !/^\d{10,14}$/.test(c.seance)) return json({ erreur: "S\xE9ance invalide" }, 400, cors);
  if (c.exo !== "ex1" && c.exo !== "ex2") return json({ erreur: "Exercice invalide" }, 400, cors);
  const ext = TYPES_AUDIO[String(c.mime || "").split(";")[0].trim().toLowerCase()];
  if (!ext) return json({ erreur: "Format audio non accept\xE9" }, 400, cors);
  if (typeof c.audio !== "string" || c.audio.length < 100 || !/^[A-Za-z0-9+/]+={0,2}$/.test(c.audio)) return json({ erreur: "Audio invalide" }, 400, cors);
  if (c.audio.length > MAX_AUDIO_BASE64) return json({ erreur: "Enregistrement trop volumineux" }, 413, cors);
  const depot = env.AUDIO_REPO || "";
  if (!env.GITHUB_TOKEN || !/^[\w.-]+\/[\w.-]+$/.test(depot)) return json({ erreur: "Archivage audio non configur\xE9" }, 503, cors);
  if (!await depotPrive(env, depot)) return json({ erreur: "Archivage refus\xE9 : le d\xE9p\xF4t d'archive doit exister et \xEAtre priv\xE9" }, 503, cors);
  const maintenant = /* @__PURE__ */ new Date();
  const horodatage = maintenant.toISOString().replace(/[-:]/g, "").slice(0, 15);
  const chemin = `audio/${c.classe}/${eleve.code}/jour-${String(jour).padStart(3, "0")}/${c.seance}-${c.exo}-${horodatage}.${ext}`;
  const r = await appelGitHub(env, "PUT", `/repos/${depot}/contents/${chemin}`, {
    message: `Audio ${eleve.code} jour ${jour} ${c.exo}`,
    content: c.audio,
    ...env.AUDIO_BRANCH ? { branch: env.AUDIO_BRANCH } : {}
  });
  if (!r.ok) return json({ erreur: `D\xE9p\xF4t d'archive : refus de GitHub (${r.status})` }, 502, cors);
  const cleSeance = `parole:${eleve.empreinte}:${jour}:${c.seance}`;
  const v = JSON.parse(await env.SUIVI.get(cleSeance) || "null");
  if (v) {
    v.audios = [...(v.audios || []).slice(-19), { exo: c.exo, depot, chemin, date: maintenant.toISOString(), taille: Math.floor(c.audio.length * 3 / 4), duree: nombreOuNull(c.duree) }];
    await env.SUIVI.put(cleSeance, JSON.stringify(v));
  }
  return json({ ok: true, chemin }, 200, cors);
}
var CHEMIN_ARCHIVE = /^audio\/(5e|seconde)\/[A-Z0-9]{6,20}\/jour-\d{3}\/[\w.-]+\.(webm|ogg|m4a|mp3|json)$/;
var TYPES_SERVIS = { webm: "audio/webm", ogg: "audio/ogg", m4a: "audio/mp4", mp3: "audio/mpeg", json: "application/json" };
async function archiveUtilisable(env, cors) {
  const depot = env.AUDIO_REPO || "";
  if (!env.GITHUB_TOKEN || !/^[\w.-]+\/[\w.-]+$/.test(depot)) return { refus: json({ erreur: "Archive audio non configur\xE9e" }, 503, cors) };
  if (!await depotPrive(env, depot)) return { refus: json({ erreur: "Archive audio inaccessible : le d\xE9p\xF4t doit exister et \xEAtre priv\xE9" }, 503, cors) };
  return { depot };
}
var parametreBranche = (env) => env.AUDIO_BRANCH ? `?ref=${encodeURIComponent(env.AUDIO_BRANCH)}` : "";
async function adminParoleArchive(env, request, c, cors) {
  const refus = await verifierMotDePasse(env, request, c.motdepasse, cors);
  if (refus) return refus;
  const a = await archiveUtilisable(env, cors);
  if (a.refus) return a.refus;
  const r = await appelGitHub(env, "GET", `/repos/${a.depot}/git/trees/${encodeURIComponent(env.AUDIO_BRANCH || "HEAD")}?recursive=1`);
  if (r.status === 404 || r.status === 409) return json({ ok: true, fichiers: [], tronque: false }, 200, cors);
  if (!r.ok) return json({ erreur: `Archive : refus de GitHub (${r.status})` }, 502, cors);
  const d = await r.json().catch(() => ({}));
  const fichiers = (d.tree || []).filter((x) => x.type === "blob" && CHEMIN_ARCHIVE.test(x.path)).map((x) => {
    const [, classe, code, jour, nom] = x.path.split("/");
    return { chemin: x.path, classe, code, jour: Number(jour.slice(5)), nom, taille: x.size || 0 };
  });
  return json({ ok: true, fichiers, tronque: !!d.truncated }, 200, cors);
}
async function adminParoleAudio(env, request, c, cors) {
  const refus = await verifierMotDePasse(env, request, c.motdepasse, cors);
  if (refus) return refus;
  if (typeof c.chemin !== "string" || !CHEMIN_ARCHIVE.test(c.chemin)) return json({ erreur: "Fichier invalide" }, 400, cors);
  const a = await archiveUtilisable(env, cors);
  if (a.refus) return a.refus;
  const r = await appelGitHub(env, "GET", `/repos/${a.depot}/contents/${c.chemin}${parametreBranche(env)}`, null, "application/vnd.github.raw+json");
  if (r.status === 404) return json({ erreur: "Fichier introuvable dans l'archive" }, 404, cors);
  if (!r.ok) return json({ erreur: `Archive : refus de GitHub (${r.status})` }, 502, cors);
  const ext = c.chemin.split(".").pop();
  return new Response(r.body, { status: 200, headers: { "Content-Type": TYPES_SERVIS[ext] || "application/octet-stream", "Cache-Control": "no-store", ...cors } });
}
var MAX_SUPPRESSIONS = 200;
var versBase64 = (texte) => {
  let s = "";
  new TextEncoder().encode(texte).forEach((b) => {
    s += String.fromCharCode(b);
  });
  return btoa(s);
};
async function listerDossier(env, depot, chemin) {
  const r = await appelGitHub(env, "GET", `/repos/${depot}/contents/${chemin}${parametreBranche(env)}`);
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  const d = await r.json();
  return Array.isArray(d) ? d : [d];
}
async function purgerDossier(env, depot, chemin, compteur, profondeur = 0) {
  for (const e of await listerDossier(env, depot, chemin)) {
    if (typeof e.path !== "string" || !e.path.startsWith("audio/")) continue;
    if (e.type === "dir") {
      if (profondeur < 3) await purgerDossier(env, depot, e.path, compteur, profondeur + 1);
      continue;
    }
    if (e.type !== "file") continue;
    if (compteur.n >= MAX_SUPPRESSIONS) throw new Error("trop de fichiers \xE0 supprimer en une fois");
    const r = await appelGitHub(env, "DELETE", `/repos/${depot}/contents/${e.path}`, { message: `Suppression audio (remise \xE0 z\xE9ro) ${e.path}`, sha: e.sha, ...env.AUDIO_BRANCH ? { branch: env.AUDIO_BRANCH } : {} });
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    compteur.n++;
  }
}
async function adminParoleReinitialiser(env, request, c, cors) {
  const refus = await verifierMotDePasse(env, request, c.motdepasse, cors);
  if (refus) return refus;
  if (typeof c.empreinte !== "string" || !/^[0-9a-f]{64}$/.test(c.empreinte)) return json({ erreur: "\xC9l\xE8ve invalide" }, 400, cors);
  if (c.audios !== "garder" && c.audios !== "supprimer") return json({ erreur: "Pr\xE9cisez s'il faut garder ou supprimer les audios" }, 400, cors);
  const tous = c.jour === "tous", n = Number(c.jour);
  if (!tous && (!Number.isInteger(n) || n < 1 || n > 100)) return json({ erreur: "Jour invalide" }, 400, cors);
  const clesSeances = await toutesLesCles(env, tous ? `parole:${c.empreinte}:` : `parole:${c.empreinte}:${n}:`);
  const clesFait = (await toutesLesCles(env, `fait:${c.empreinte}:parole:`)).filter((k) => tous || k === `fait:${c.empreinte}:parole:${n}`);
  const seances = [];
  for (const k of clesSeances) {
    const v = JSON.parse(await env.SUIVI.get(k) || "null");
    if (v) seances.push(v);
  }
  let ident = seances[0] ? { classe: seances[0].classe, code: seances[0].code } : null;
  if (!ident && clesFait[0]) {
    const v = JSON.parse(await env.SUIVI.get(clesFait[0]) || "null");
    if (v) ident = { classe: v.classe, code: v.code };
  }
  const nbReferences = seances.reduce((s, x) => s + (x.audios || []).length, 0);
  const rapport = { seances: clesSeances.length, joursRemis: clesFait.length, audiosSupprimes: 0, audiosConserves: nbReferences, instantanes: [] };
  const a = env.GITHUB_TOKEN && env.AUDIO_REPO && ident ? await archiveUtilisable(env, cors) : { refus: null, depot: null };
  if (a.refus && nbReferences) return a.refus;
  if (a.depot) {
    try {
      if (c.audios === "supprimer") {
        const compteur = { n: 0 };
        const dossiers = tous ? [`audio/${ident.classe}/${ident.code}`] : [`audio/${ident.classe}/${ident.code}/jour-${String(n).padStart(3, "0")}`];
        for (const d of dossiers) await purgerDossier(env, a.depot, d, compteur);
        rapport.audiosSupprimes = compteur.n;
        rapport.audiosConserves = 0;
      } else if (nbReferences) {
        const parJour = {};
        seances.forEach((s) => {
          (parJour[s.jour] = parJour[s.jour] || []).push(s);
        });
        const horodatage = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").slice(0, 15);
        for (const [jour, liste] of Object.entries(parJour)) {
          if (!liste.some((s) => (s.audios || []).length)) continue;
          const chemin = `audio/${ident.classe}/${ident.code}/jour-${String(jour).padStart(3, "0")}/reinitialisation-${horodatage}.json`;
          const contenu = JSON.stringify({ reinitialiseLe: (/* @__PURE__ */ new Date()).toISOString(), classe: ident.classe, code: ident.code, jour: Number(jour), seances: liste }, null, 2);
          const r = await appelGitHub(env, "PUT", `/repos/${a.depot}/contents/${chemin}`, { message: `Sauvegarde avant remise \xE0 z\xE9ro ${ident.code} jour ${jour}`, content: versBase64(contenu), ...env.AUDIO_BRANCH ? { branch: env.AUDIO_BRANCH } : {} });
          if (!r.ok) throw new Error(`GitHub ${r.status}`);
          rapport.instantanes.push(chemin);
        }
      }
    } catch (e) {
      return json({ erreur: `Remise \xE0 z\xE9ro interrompue, rien n'a \xE9t\xE9 effac\xE9 c\xF4t\xE9 suivi : ${e.message}` }, 502, cors);
    }
  }
  for (const k of clesSeances) await env.SUIVI.delete(k);
  for (const k of clesFait) await env.SUIVI.delete(k);
  return json({ ok: true, ...rapport }, 200, cors);
}
var MAX_ANALYSES_SEANCE = 8;
var MAX_ANALYSES_JOUR = 30;
var BLOCAGE_ANALYSE_MS = 9e4;
var arrierePlan = (ctx, promesse) => {
  const p = promesse.catch(() => {
  });
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p);
};
async function reserverAnalyse(env, empreinte) {
  const cle = `analyses:${empreinte}:${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}`;
  const n = Number(await env.SUIVI.get(cle)) || 0;
  if (n >= MAX_ANALYSES_JOUR) return false;
  await env.SUIVI.put(cle, String(n + 1), { expirationTtl: 172800 });
  return true;
}
async function lancerAnalyse(env, cle) {
  const s0 = JSON.parse(await env.SUIVI.get(cle) || "null");
  if (!s0) return;
  const sig = signature(s0);
  const historique = (await seancesDe(env, `parole:${cle.split(":")[1]}:`)).filter((x) => x.cle !== cle && (x.ex1 || x.ex2)).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let resultat;
  try {
    resultat = await analyserSeance(env, s0, historique);
  } catch (e) {
    resultat = { analyse: { statut: "echec", erreur: String(e && e.message || e).slice(0, 200) }, notesAuto: null };
  }
  const s1 = JSON.parse(await env.SUIVI.get(cle) || "null");
  if (!s1 || signature(s1) !== sig) return;
  s1.analyse = { ...resultat.analyse, sig, nb: s1.analyse && s1.analyse.nb || 1, le: (/* @__PURE__ */ new Date()).toISOString() };
  if (resultat.notesAuto) s1.notesAuto = resultat.notesAuto;
  await env.SUIVI.put(cle, JSON.stringify(s1));
}
async function relancer(env, ctx, cle, { force, cors }) {
  if (!env.AI) return json({ erreur: "Analyse automatique non activ\xE9e sur le Worker (binding AI absent)" }, 503, cors);
  const v = JSON.parse(await env.SUIVI.get(cle) || "null");
  if (!v || !(v.ex1 || v.ex2)) return json({ erreur: "S\xE9ance introuvable" }, 404, cors);
  const a = v.analyse || {};
  if (a.statut === "en_cours" && Date.now() - Date.parse(a.debut || 0) < BLOCAGE_ANALYSE_MS) return json({ ok: true, statut: "en_cours" }, 200, cors);
  if (!force) {
    if (a.statut === "ok" && a.sig === signature(v)) return json({ ok: true, statut: "ok" }, 200, cors);
    if ((a.nb || 0) >= MAX_ANALYSES_SEANCE) return json({ erreur: "Nombre maximal d'analyses atteint pour cette s\xE9ance : demande \xE0 ton enseignant" }, 429, cors);
    if (!await reserverAnalyse(env, cle.split(":")[1])) return json({ erreur: "Limite d'analyses atteinte pour aujourd'hui : r\xE9essaie demain" }, 429, cors);
  }
  v.analyse = { ...a, sig: signature(v), statut: "en_cours", nb: force ? 1 : (a.nb || 0) + 1, debut: (/* @__PURE__ */ new Date()).toISOString() };
  await env.SUIVI.put(cle, JSON.stringify(v));
  arrierePlan(ctx, lancerAnalyse(env, cle));
  return json({ ok: true, statut: "en_cours" }, 200, cors);
}
async function paroleAnalyser(env, ctx, c, cors) {
  const eleve = await identifier(env, c.classe, c.code);
  if (!eleve) return json({ erreur: "Code inconnu" }, 403, cors);
  const jour = Number(c.jour);
  if (!Number.isInteger(jour) || jour < 1 || jour > 100) return json({ erreur: "Jour invalide" }, 400, cors);
  if (typeof c.seance !== "string" || !/^\d{10,14}$/.test(c.seance)) return json({ erreur: "S\xE9ance invalide" }, 400, cors);
  return relancer(env, ctx, `parole:${eleve.empreinte}:${jour}:${c.seance}`, { force: false, cors });
}
async function adminParoleAnalyser(env, ctx, request, c, cors) {
  const refus = await verifierMotDePasse(env, request, c.motdepasse, cors);
  if (refus) return refus;
  if (typeof c.cle !== "string" || !CLE_SEANCE.test(c.cle)) return json({ erreur: "S\xE9ance invalide" }, 400, cors);
  return relancer(env, ctx, c.cle, { force: true, cors });
}
async function seancesDe(env, prefixe) {
  const liste = [];
  for (const nom of await toutesLesCles(env, prefixe)) {
    const v = JSON.parse(await env.SUIVI.get(nom) || "null");
    if (v) liste.push({ cle: nom, ...v });
  }
  return liste.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}
async function paroleEtat(env, c, cors) {
  const eleve = await identifier(env, c.classe, c.code);
  if (!eleve) return json({ erreur: "Code inconnu" }, 403, cors);
  const seances = (await seancesDe(env, `parole:${eleve.empreinte}:`)).map(({ cle, bilan, audios, corrections, analyse, ...reste }) => {
    if (analyse) {
      const { indices, erreurEmbeddings, erreur, verifier, sig, ...visible } = analyse;
      reste.analyse = visible;
    }
    return reste;
  });
  return json({ ok: true, seances, analyseActive: !!env.AI }, 200, cors);
}
async function adminParole(env, request, c, cors) {
  const refus = await verifierMotDePasse(env, request, c.motdepasse, cors);
  if (refus) return refus;
  return json({ ok: true, seances: await seancesDe(env, "parole:") }, 200, cors);
}
async function adminParoleNoter(env, request, c, cors) {
  const refus = await verifierMotDePasse(env, request, c.motdepasse, cors);
  if (refus) return refus;
  if (typeof c.cle !== "string" || !CLE_SEANCE.test(c.cle)) return json({ erreur: "S\xE9ance invalide" }, 400, cors);
  const v = JSON.parse(await env.SUIVI.get(c.cle) || "null");
  if (!v) return json({ erreur: "S\xE9ance introuvable" }, 404, cors);
  v.notes = notesValides(c.notes);
  v.corrections = [];
  if (v.notesAuto) for (const ex of Object.keys(CRITERES)) for (const cr of Object.keys(CRITERES[ex])) {
    const a = v.notesAuto[ex] && v.notesAuto[ex][cr], f = v.notes && v.notes[ex] && v.notes[ex][cr];
    if (a != null && f != null && a !== f) v.corrections.push({ ex, critere: cr, auto: a, final: f });
  }
  v.retour = texteBorne(c.retour, 8e3);
  v.notesLe = (/* @__PURE__ */ new Date()).toISOString();
  await env.SUIVI.put(c.cle, JSON.stringify(v));
  return json({ ok: true, notes: v.notes }, 200, cors);
}
async function adminParoleSupprimer(env, request, c, cors) {
  const refus = await verifierMotDePasse(env, request, c.motdepasse, cors);
  if (refus) return refus;
  if (typeof c.cle !== "string" || !CLE_SEANCE.test(c.cle)) return json({ erreur: "S\xE9ance invalide" }, 400, cors);
  const existe = !!await env.SUIVI.get(c.cle);
  if (existe) await env.SUIVI.delete(c.cle);
  return json({ ok: true, supprimees: existe ? 1 : 0 }, 200, cors);
}
var ROUTINES_ECRITES = ["probabilites", "technologie"];
var CLE_REPONSE = /^rep:[0-9a-f]{64}:(probabilites|technologie):\d{1,3}:\d{10,14}$/;
var MAX_ENVOIS_JOUR = 20;
var MAX_REPONSE = 3e3;
var ATTENTE_VERIF_MS = 15e3;
var RETARD_MS = 30 * 60 * 1e3;
var VERDICTS = ["juste", "partiel", "faux", "vide"];
var cheminEnvoi = (v) => `reponses/${v.classe}/${v.code}/${v.routine}/jour-${String(v.jour).padStart(3, "0")}/${v.envoi}.json`;
var cheminCorrection = (v) => "corrections/" + cheminEnvoi(v).slice("reponses/".length);
var depuisBase64 = (b) => {
  const bin = atob(String(b).replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
};
async function deposerEnvoi(env, depot, v, relance = 0) {
  const chemin = cheminEnvoi(v);
  const contenu = JSON.stringify({ classe: v.classe, code: v.code, routine: v.routine, jour: v.jour, envoi: v.envoi, essai: v.essai, date: v.date, relance, reponses: v.reponses }, null, 2);
  let sha;
  if (relance) {
    const r0 = await appelGitHub(env, "GET", `/repos/${depot}/contents/${chemin}${parametreBranche(env)}`);
    if (r0.ok) sha = (await r0.json().catch(() => ({}))).sha;
  }
  const r = await appelGitHub(env, "PUT", `/repos/${depot}/contents/${chemin}`, {
    message: `R\xE9ponses ${v.code} ${v.routine} jour ${v.jour} (envoi ${v.envoi}${relance ? `, relance ${relance}` : ""})`,
    content: versBase64(contenu),
    ...sha ? { sha } : {},
    ...env.AUDIO_BRANCH ? { branch: env.AUDIO_BRANCH } : {}
  });
  if (r.ok) return { ok: true, chemin };
  if (r.status === 422 && !relance) return { ok: true, chemin, dejaLa: true };
  return { ok: false, statut: r.status };
}
function correctionValide(o, nbExercices) {
  if (!o || typeof o !== "object") return null;
  const questions = Array.isArray(o.questions) ? o.questions.slice(0, 40).map((q) => ({
    exercice: Math.min(nbExercices || 3, Math.max(1, parseInt(q && q.exercice, 10) || 1)),
    question: texteBorne(String((q && q.question) ?? ""), 10),
    verdict: VERDICTS.includes(q && q.verdict) ? q.verdict : "faux",
    commentaire: texteBorne(q && q.commentaire, 400)
  })) : [];
  const total = Number.isInteger(o.total) && o.total > 0 ? Math.min(o.total, 60) : questions.length;
  const justes = nombreOuNull(o.justes);
  return {
    justes: justes === null ? questions.filter((q) => q.verdict === "juste").length : Math.min(total, Math.max(0, justes)),
    total,
    questions,
    texte: texteBorne(o.texte, 12e3),
    aVerifier: texteBorne(o.aVerifier, 1e3),
    modele: texteBorne(o.modele, 60)
  };
}
async function recupererCorrection(env, cle, v, force = false) {
  if (v.statut !== "en_cours") return v;
  const maintenant = Date.now();
  if (!force && v.verifieLe && maintenant - Date.parse(v.verifieLe) < ATTENTE_VERIF_MS) return v;
  const depot = env.AUDIO_REPO || "";
  if (!env.GITHUB_TOKEN || !/^[\w.-]+\/[\w.-]+$/.test(depot)) return v;
  v.verifieLe = new Date(maintenant).toISOString();
  try {
    const r = await appelGitHub(env, "GET", `/repos/${depot}/contents/${cheminCorrection(v)}${parametreBranche(env)}`);
    if (r.ok) {
      const d = JSON.parse(depuisBase64((await r.json()).content || ""));
      if ((Number(d.relance) || 0) >= (v.relance || 0)) {
        if (d.statut === "echec") {
          v.statut = "echec";
          v.erreur = texteBorne(d.erreur, 300);
        } else {
          const c = correctionValide(d.correction, v.reponses.length);
          if (c && c.texte) {
            v.statut = "corrige";
            v.correctionAuto = c;
            v.correction = { justes: c.justes, total: c.total, texte: c.texte, questions: c.questions };
            v.corrigeLe = d.date || (/* @__PURE__ */ new Date()).toISOString();
          } else {
            v.statut = "echec";
            v.erreur = "Correction illisible";
          }
        }
      }
    }
  } catch (e) {
  }
  await env.SUIVI.put(cle, JSON.stringify(v));
  return v;
}
function vueEleve(v, cle) {
  const enRetard = v.statut === "en_cours" && Date.now() - Date.parse(v.attenteDepuis || v.date) > RETARD_MS;
  return {
    cle,
    routine: v.routine,
    jour: v.jour,
    envoi: v.envoi,
    essai: v.essai,
    date: v.date,
    reponses: v.reponses,
    statut: enRetard ? "en_retard" : v.statut,
    correction: v.statut === "corrige" ? v.correction : null,
    valide: !!v.valideLe
  };
}
async function reponsesEnvoyer(env, c, cors) {
  const eleve = await identifier(env, c.classe, c.code);
  if (!eleve) return json({ erreur: "Code inconnu" }, 403, cors);
  if (!ROUTINES_ECRITES.includes(c.routine)) return json({ erreur: "Routine inconnue" }, 400, cors);
  const jour = Number(c.jour);
  if (!Number.isInteger(jour) || jour < 1 || jour > 100) return json({ erreur: "Jour invalide" }, 400, cors);
  if (typeof c.envoi !== "string" || !/^\d{10,14}$/.test(c.envoi)) return json({ erreur: "Envoi invalide" }, 400, cors);
  if (!Array.isArray(c.reponses) || c.reponses.length < 1 || c.reponses.length > 6) return json({ erreur: "R\xE9ponses invalides" }, 400, cors);
  const reponses = c.reponses.map((x) => texteBorne(typeof x === "string" ? x : x && x.texte, MAX_REPONSE).trim());
  if (reponses.some((x) => !x)) return json({ erreur: "R\xE9ponds \xE0 tous les exercices avant d'envoyer" }, 400, cors);
  const cle = `rep:${eleve.empreinte}:${c.routine}:${jour}:${c.envoi}`;
  const existant = JSON.parse(await env.SUIVI.get(cle) || "null");
  if (existant) return json({ ok: true, deja: true, envoi: vueEleve(existant, cle) }, 200, cors);
  const aujourdhui = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const cleQuota = `envois:${eleve.empreinte}:${aujourdhui}`;
  const nbJour = Number(await env.SUIVI.get(cleQuota)) || 0;
  if (nbJour >= MAX_ENVOIS_JOUR) return json({ erreur: "Tu as fait beaucoup d'envois aujourd'hui : r\xE9essaie demain" }, 429, cors);
  await env.SUIVI.put(cleQuota, String(nbJour + 1), { expirationTtl: 172800 });
  const essai = (await toutesLesCles(env, `rep:${eleve.empreinte}:${c.routine}:${jour}:`)).length + 1;
  const v = { code: eleve.code, classe: c.classe, routine: c.routine, jour, envoi: c.envoi, essai, date: (/* @__PURE__ */ new Date()).toISOString(), reponses, statut: "en_cours", relance: 0 };
  const cleFait = `fait:${eleve.empreinte}:${c.routine}:${jour}`;
  if (!await env.SUIVI.get(cleFait)) await env.SUIVI.put(cleFait, JSON.stringify({ code: eleve.code, classe: c.classe, date: v.date }));
  const a = await archiveUtilisable(env, cors);
  if (a.refus) {
    v.statut = "non_configure";
  } else {
    const d = await deposerEnvoi(env, a.depot, v);
    if (d.ok) v.chemin = d.chemin;
    else {
      v.statut = "echec_depot";
      v.erreur = `GitHub ${d.statut}`;
    }
  }
  await env.SUIVI.put(cle, JSON.stringify(v));
  return json({ ok: true, envoi: vueEleve(v, cle) }, 200, cors);
}
async function reponsesEtat(env, c, cors) {
  const eleve = await identifier(env, c.classe, c.code);
  if (!eleve) return json({ erreur: "Code inconnu" }, 403, cors);
  let prefixe = `rep:${eleve.empreinte}:`;
  if (c.routine !== void 0) {
    if (!ROUTINES_ECRITES.includes(c.routine)) return json({ erreur: "Routine inconnue" }, 400, cors);
    prefixe += `${c.routine}:`;
    if (c.jour !== void 0) {
      const jour = Number(c.jour);
      if (!Number.isInteger(jour) || jour < 1 || jour > 100) return json({ erreur: "Jour invalide" }, 400, cors);
      prefixe += `${jour}:`;
    }
  }
  const envois = [];
  for (const cle of await toutesLesCles(env, prefixe)) {
    let v = JSON.parse(await env.SUIVI.get(cle) || "null");
    if (!v) continue;
    v = await recupererCorrection(env, cle, v);
    envois.push(vueEleve(v, cle));
  }
  envois.sort((x, y) => String(x.date).localeCompare(String(y.date)));
  return json({ ok: true, envois }, 200, cors);
}
async function adminReponses(env, request, c, cors) {
  const refus = await verifierMotDePasse(env, request, c.motdepasse, cors);
  if (refus) return refus;
  const envois = [];
  for (const cle of await toutesLesCles(env, "rep:")) {
    let v = JSON.parse(await env.SUIVI.get(cle) || "null");
    if (!v) continue;
    v = await recupererCorrection(env, cle, v);
    envois.push({ cle, ...v });
  }
  envois.sort((x, y) => String(x.date).localeCompare(String(y.date)));
  return json({ ok: true, envois }, 200, cors);
}
async function adminReponsesModifier(env, request, c, cors) {
  const refus = await verifierMotDePasse(env, request, c.motdepasse, cors);
  if (refus) return refus;
  if (typeof c.cle !== "string" || !CLE_REPONSE.test(c.cle)) return json({ erreur: "Envoi invalide" }, 400, cors);
  const v = JSON.parse(await env.SUIVI.get(c.cle) || "null");
  if (!v) return json({ erreur: "Envoi introuvable" }, 404, cors);
  const texte = texteBorne(c.texte, 12e3).trim();
  if (!texte) return json({ erreur: "Le texte de correction est vide" }, 400, cors);
  const total = Number.isInteger(Number(c.total)) && Number(c.total) > 0 ? Math.min(60, Number(c.total)) : v.correction && v.correction.total || 0;
  const justes = nombreOuNull(c.justes);
  v.correction = { ...v.correction || {}, texte, total, justes: justes === null ? v.correction && v.correction.justes || 0 : Math.min(total, Math.max(0, justes)) };
  v.statut = "corrige";
  v.valideLe = (/* @__PURE__ */ new Date()).toISOString();
  await env.SUIVI.put(c.cle, JSON.stringify(v));
  return json({ ok: true, correction: v.correction }, 200, cors);
}
async function adminReponsesRelancer(env, request, c, cors) {
  const refus = await verifierMotDePasse(env, request, c.motdepasse, cors);
  if (refus) return refus;
  if (typeof c.cle !== "string" || !CLE_REPONSE.test(c.cle)) return json({ erreur: "Envoi invalide" }, 400, cors);
  const v = JSON.parse(await env.SUIVI.get(c.cle) || "null");
  if (!v) return json({ erreur: "Envoi introuvable" }, 404, cors);
  const a = await archiveUtilisable(env, cors);
  if (a.refus) return a.refus;
  const relance = (v.relance || 0) + 1;
  const d = await deposerEnvoi(env, a.depot, v, relance);
  if (!d.ok) return json({ erreur: `D\xE9p\xF4t priv\xE9 : refus de GitHub (${d.statut})` }, 502, cors);
  Object.assign(v, { relance, statut: "en_cours", chemin: d.chemin, attenteDepuis: (/* @__PURE__ */ new Date()).toISOString() });
  delete v.erreur;
  delete v.verifieLe;
  await env.SUIVI.put(c.cle, JSON.stringify(v));
  return json({ ok: true, statut: v.statut }, 200, cors);
}
async function adminReponsesSupprimer(env, request, c, cors) {
  const refus = await verifierMotDePasse(env, request, c.motdepasse, cors);
  if (refus) return refus;
  if (typeof c.cle !== "string" || !CLE_REPONSE.test(c.cle)) return json({ erreur: "Envoi invalide" }, 400, cors);
  const existe = !!await env.SUIVI.get(c.cle);
  if (existe) await env.SUIVI.delete(c.cle);
  return json({ ok: true, supprimes: existe ? 1 : 0 }, 200, cors);
}
async function verifierMotDePasse(env, request, saisi, cors) {
  if (!env.ADMIN_PASSWORD) return json({ erreur: "Mot de passe enseignant non configur\xE9" }, 503, cors);
  const ip = request.headers.get("CF-Connecting-IP") || "inconnue";
  const cleEchecs = `echecs:${ip}`;
  const echecs = Number(await env.SUIVI.get(cleEchecs)) || 0;
  if (echecs >= MAX_ECHECS) return json({ erreur: "Trop d'essais, r\xE9essayez plus tard" }, 429, cors);
  if (typeof saisi === "string" && saisi && await memeTexte(saisi, env.ADMIN_PASSWORD)) {
    if (echecs) await env.SUIVI.delete(cleEchecs);
    return null;
  }
  await env.SUIVI.put(cleEchecs, String(echecs + 1), { expirationTtl: BLOCAGE_SECONDES });
  return json({ erreur: "Mot de passe incorrect" }, 401, cors);
}
async function memeTexte(a, b) {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
function normaliser(s) {
  return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
async function identifier(env, classe, code) {
  if (!CLASSES.includes(classe)) return null;
  const propre = normaliser(code);
  if (propre.length < 6) return null;
  const empreinte = await sha256(`${env.SEL}${classe}:${propre}`);
  let valides = [];
  try {
    valides = JSON.parse(env.EMPREINTES || "{}")[classe] || [];
  } catch (e) {
  }
  return valides.includes(empreinte) ? { empreinte, code: propre } : null;
}
async function toutesLesCles(env, prefixe) {
  const noms = [];
  let curseur;
  do {
    const page = await env.SUIVI.list({ prefix: prefixe, cursor: curseur });
    page.keys.forEach((k) => noms.push(k.name));
    curseur = page.list_complete ? void 0 : page.cursor;
  } while (curseur);
  return noms;
}
async function sha256(texte) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texte));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function json(donnees, statut, cors) {
  return new Response(JSON.stringify(donnees), { status: statut, headers: { "Content-Type": "application/json", ...cors } });
}
export {
  src_default as default
};
