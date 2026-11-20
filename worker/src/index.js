// Version : 1.4 (séances de « Fluidité verbale » : archivage audio privé, accès et remise à zéro réservés à l'enseignant, analyse et notes automatiques par Workers AI)
// Worker « routinesite-suivi » : suivi des jours faits par élève pour RoutineSite.
//
// Routes (toutes en POST, JSON) :
//   /valider            { classe, code, routine, jour }      -> enregistre le jour comme fait
//   /etat               { classe, code }                      -> jours faits par cet élève
//   /admin/etat         { motdepasse }                        -> jours faits de tous les élèves
//   /admin/reinitialiser{ motdepasse, empreinte, routine, jour|"tous" } -> remet à « non fait »
//
// Routine « Fluidité verbale » (séances orales, mesures et notes) :
//   /parole/enregistrer { classe, code, jour, seance, bilan, ex1, ex2 } -> enregistre ou met à jour une séance
//   /parole/etat        { classe, code }                      -> séances de l'élève (mesures, notes, retour)
//   /admin/parole       { motdepasse }                        -> toutes les séances de tous les élèves
//   /admin/parole/noter { motdepasse, cle, notes, retour }    -> enregistre les notes et le retour de Claude
//   /admin/parole/supprimer { motdepasse, cle }               -> supprime une séance
//   /parole/audio       { classe, code, jour, seance, exo, mime, duree, audio(base64) } -> archive l'enregistrement dans un dépôt GitHub PRIVÉ
//   /admin/parole/archive       { motdepasse }                -> liste les fichiers de l'archive audio
//   /admin/parole/audio         { motdepasse, chemin }        -> sert un fichier de l'archive (lecture / téléchargement)
//   /admin/parole/reinitialiser { motdepasse, empreinte, jour|"tous", audios:"garder"|"supprimer" } -> remise à zéro d'un jour
//   /parole/analyser    { classe, code, jour, seance }            -> relance l'analyse automatique d'une séance (échec ou blocage)
//   /admin/parole/analyser { motdepasse, cle }                    -> relance l'analyse d'une séance (sans plafond)
//
// Analyse automatique : lancée après chaque enregistrement de séance (en arrière-plan) avec Cloudflare Workers AI
// (binding « AI » dans wrangler.toml, gratuit dans la franchise quotidienne, aucune clé) : un modèle de langage juge les critères
// « jugés » et rédige le retour, un modèle d'embeddings recoupe la pertinence des liens. Voir analyse.js.
//
// Archivage audio : secret GITHUB_TOKEN (jeton limité au dépôt d'archive, droit « Contents : lecture et écriture »)
// et variable AUDIO_REPO (« propriétaire/dépôt »). Le Worker refuse d'écrire si le dépôt n'est pas privé.
//
// Secret : ADMIN_PASSWORD (le même mot de passe enseignant que MathSite).
// Stockage KV « SUIVI » : clé  fait:<empreinte>:<routine>:<jour>  ->  { code, classe, date }
//                        clé  parole:<empreinte>:<jour>:<séance>  ->  { code, classe, jour, seance, date, maj, bilan, ex1, ex2, notes, retour }

import { CRITERES, analyserSeance, signature } from "./analyse.js";

const ROUTINES = ["probabilites", "technologie", "parole"];
const CLASSES = ["5e", "seconde"];
const MAX_ECHECS = 10;          // tentatives de mot de passe avant blocage
const BLOCAGE_SECONDES = 900;   // durée du blocage (15 min)

export default {
  async fetch(request, env, ctx) {
    const origine = request.headers.get("Origin") || "";
    const autorisees = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
    const cors = {
      "Access-Control-Allow-Origin": autorisees.includes(origine) ? origine : (autorisees[0] || ""),
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ erreur: "POST attendu" }, 405, cors);
    if (origine && !autorisees.includes(origine)) return json({ erreur: "Origine refusée" }, 403, cors);

    let corps;
    try { corps = await request.json(); } catch (e) { return json({ erreur: "JSON invalide" }, 400, cors); }
    if (!corps || typeof corps !== "object") return json({ erreur: "Requête invalide" }, 400, cors);

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
    } catch (e) {
      return json({ erreur: "Erreur du serveur" }, 500, cors);
    }
    return json({ erreur: "Route inconnue" }, 404, cors);
  }
};

// ---------- Élève ----------
async function valider(env, c, cors) {
  const eleve = await identifier(env, c.classe, c.code);
  if (!eleve) return json({ erreur: "Code inconnu" }, 403, cors);
  if (!ROUTINES.includes(c.routine)) return json({ erreur: "Routine inconnue" }, 400, cors);
  const n = Number(c.jour);
  if (!Number.isInteger(n) || n < 1 || n > 100) return json({ erreur: "Jour invalide" }, 400, cors);
  const cle = `fait:${eleve.empreinte}:${c.routine}:${n}`;
  if (!(await env.SUIVI.get(cle))) {
    await env.SUIVI.put(cle, JSON.stringify({ code: eleve.code, classe: c.classe, date: new Date().toISOString() }));
  }
  return json({ ok: true, jours: await joursDe(env, eleve.empreinte) }, 200, cors);
}

async function etatEleve(env, c, cors) {
  const eleve = await identifier(env, c.classe, c.code);
  if (!eleve) return json({ erreur: "Code inconnu" }, 403, cors);
  return json({ ok: true, jours: await joursDe(env, eleve.empreinte) }, 200, cors);
}

async function joursDe(env, empreinte) {
  const jours = Object.fromEntries(ROUTINES.map(r => [r, []]));
  for (const nom of await toutesLesCles(env, `fait:${empreinte}:`)) {
    const [, , routine, n] = nom.split(":");
    if (jours[routine]) jours[routine].push(Number(n));
  }
  ROUTINES.forEach(r => jours[r].sort((a, b) => a - b));
  return jours;
}

// ---------- Enseignant ----------
async function adminEtat(env, request, c, cors) {
  const refus = await verifierMotDePasse(env, request, c.motdepasse, cors);
  if (refus) return refus;
  const eleves = {};
  for (const nom of await toutesLesCles(env, "fait:")) {
    const [, empreinte, routine, n] = nom.split(":");
    const valeur = JSON.parse((await env.SUIVI.get(nom)) || "null");
    if (!valeur) continue;
    const e = eleves[empreinte] || (eleves[empreinte] = { empreinte, code: valeur.code, classe: valeur.classe, jours: Object.fromEntries(ROUTINES.map(r => [r, []])) });
    if (e.jours[routine]) e.jours[routine].push({ n: Number(n), date: valeur.date });
  }
  const liste = Object.values(eleves).sort((a, b) => a.classe.localeCompare(b.classe) || a.code.localeCompare(b.code));
  liste.forEach(e => ROUTINES.forEach(r => e.jours[r].sort((x, y) => x.n - y.n)));
  return json({ ok: true, eleves: liste }, 200, cors);
}

async function adminReinitialiser(env, request, c, cors) {
  const refus = await verifierMotDePasse(env, request, c.motdepasse, cors);
  if (refus) return refus;
  if (typeof c.empreinte !== "string" || !/^[0-9a-f]{64}$/.test(c.empreinte)) return json({ erreur: "Élève invalide" }, 400, cors);
  if (!ROUTINES.includes(c.routine)) return json({ erreur: "Routine inconnue" }, 400, cors);
  if (c.routine === "parole") return json({ erreur: "Pour la fluidité verbale, utilisez /admin/parole/reinitialiser (choix de conserver ou non les audios)" }, 400, cors);
  let supprimes = 0;
  if (c.jour === "tous") {
    for (const nom of await toutesLesCles(env, `fait:${c.empreinte}:${c.routine}:`)) { await env.SUIVI.delete(nom); supprimes++; }
  } else {
    const n = Number(c.jour);
    if (!Number.isInteger(n) || n < 1 || n > 100) return json({ erreur: "Jour invalide" }, 400, cors);
    const cle = `fait:${c.empreinte}:${c.routine}:${n}`;
    if (await env.SUIVI.get(cle)) { await env.SUIVI.delete(cle); supprimes = 1; }
  }
  return json({ ok: true, supprimes }, 200, cors);
}

// ---------- Fluidité verbale : séances orales ----------
// Une séance = une visite de la page parole.html ; elle est réenregistrée après chaque exercice (même clé).
const MAX_SEANCES = 300;
const CLE_SEANCE = /^parole:[0-9a-f]{64}:\d{1,3}:\d{10,14}$/;

const texteBorne = (s, max) => typeof s === "string" ? s.slice(0, max) : "";
const nombreOuNull = x => (x === null || x === "" || x === undefined || !Number.isFinite(Number(x))) ? null : Math.round(Number(x) * 100) / 100;

function notesValides(n) {            // ne garde que les critères connus, bornés par leur maximum ; null si absent
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
  const s = { texte: texteBorne(e.texte, 6000), aParle: e.aParle === true, reconnue: e.reconnue === true,
    motImpose: typeof e.motImpose === "boolean" ? e.motImpose : null, motCle: texteBorne(e.motCle, 40) };
  for (const k of ["duree", "mots", "differents", "delai", "silenceFinal", "pauses", "blancs", "plusLongue", "totalPauses", "debit", "hauteurSt", "tendanceDb", "remplissage"]) s[k] = nombreOuNull(e[k]);
  s.auto = e.auto && typeof e.auto === "object" ? Object.fromEntries(Object.entries(e.auto).slice(0, 8).map(([k, v]) => [k.slice(0, 20), nombreOuNull(v)])) : {};
  return s;
}

async function paroleEnregistrer(env, ctx, c, cors) {
  const eleve = await identifier(env, c.classe, c.code);
  if (!eleve) return json({ erreur: "Code inconnu" }, 403, cors);
  const jour = Number(c.jour);
  if (!Number.isInteger(jour) || jour < 1 || jour > 100) return json({ erreur: "Jour invalide" }, 400, cors);
  if (typeof c.seance !== "string" || !/^\d{10,14}$/.test(c.seance)) return json({ erreur: "Séance invalide" }, 400, cors);
  const cle = `parole:${eleve.empreinte}:${jour}:${c.seance}`;
  const ancien = JSON.parse((await env.SUIVI.get(cle)) || "null");
  if (!ancien && (await toutesLesCles(env, `parole:${eleve.empreinte}:`)).length >= MAX_SEANCES) return json({ erreur: "Trop de séances enregistrées" }, 429, cors);
  const maintenant = new Date().toISOString();
  const valeur = {
    code: eleve.code, classe: c.classe, jour, seance: c.seance,
    date: ancien ? ancien.date : maintenant, maj: maintenant,
    bilan: texteBorne(c.bilan, 8000), ex1: exerciceValide(c.ex1), ex2: exerciceValide(c.ex2),
    notes: ancien ? ancien.notes : null, retour: ancien ? ancien.retour : "", audios: ancien ? (ancien.audios || []) : []
  };
  if (ancien) { if (ancien.notesAuto) valeur.notesAuto = ancien.notesAuto; if (ancien.analyse) valeur.analyse = ancien.analyse; if (ancien.corrections) valeur.corrections = ancien.corrections; if (ancien.notesLe) valeur.notesLe = ancien.notesLe; }
  // Analyse automatique : seulement si le contenu à analyser a changé, dans la limite des plafonds, et si le binding « AI » existe.
  let lancer = false;
  if (env.AI && (valeur.ex1 || valeur.ex2)) {
    const sig = signature(valeur), a = valeur.analyse;
    if (!a || a.sig !== sig) {
      const nb = ((a && a.nb) || 0) + 1;
      if (nb > MAX_ANALYSES_SEANCE) valeur.analyse = { ...(a || {}), sig, statut: "plafond", nb: nb - 1 };
      else if (!(await reserverAnalyse(env, eleve.empreinte))) valeur.analyse = { ...(a || {}), sig, statut: "plafond", nb: nb - 1 };
      else { valeur.analyse = { ...(a || {}), sig, statut: "en_cours", nb, debut: maintenant }; lancer = true; }
    }
  }
  await env.SUIVI.put(cle, JSON.stringify(valeur));
  if (lancer) arrierePlan(ctx, lancerAnalyse(env, cle));
  return json({ ok: true, analyse: valeur.analyse ? valeur.analyse.statut : null }, 200, cors);
}

// ---------- Archivage des enregistrements audio (dépôt GitHub privé) ----------
const MAX_AUDIO_BASE64 = 4500000;          // ≈ 3,3 Mo d'audio
const TYPES_AUDIO = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3" };

function appelGitHub(env, methode, chemin, corps, accept = "application/vnd.github+json") {
  return fetch("https://api.github.com" + chemin, {
    method: methode,
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, "User-Agent": "routinesite-suivi", Accept: accept,
      "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
    body: corps ? JSON.stringify(corps) : undefined
  });
}

// Vrai seulement si le dépôt d'archive existe et est PRIVÉ (résultat gardé une minute : un dépôt rendu public est vite détecté).
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
  if (typeof c.seance !== "string" || !/^\d{10,14}$/.test(c.seance)) return json({ erreur: "Séance invalide" }, 400, cors);
  if (c.exo !== "ex1" && c.exo !== "ex2") return json({ erreur: "Exercice invalide" }, 400, cors);
  const ext = TYPES_AUDIO[String(c.mime || "").split(";")[0].trim().toLowerCase()];
  if (!ext) return json({ erreur: "Format audio non accepté" }, 400, cors);
  if (typeof c.audio !== "string" || c.audio.length < 100 || !/^[A-Za-z0-9+/]+={0,2}$/.test(c.audio)) return json({ erreur: "Audio invalide" }, 400, cors);
  if (c.audio.length > MAX_AUDIO_BASE64) return json({ erreur: "Enregistrement trop volumineux" }, 413, cors);
  const depot = env.AUDIO_REPO || "";
  if (!env.GITHUB_TOKEN || !/^[\w.-]+\/[\w.-]+$/.test(depot)) return json({ erreur: "Archivage audio non configuré" }, 503, cors);
  if (!(await depotPrive(env, depot))) return json({ erreur: "Archivage refusé : le dépôt d'archive doit exister et être privé" }, 503, cors);

  const maintenant = new Date();
  const horodatage = maintenant.toISOString().replace(/[-:]/g, "").slice(0, 15);
  const chemin = `audio/${c.classe}/${eleve.code}/jour-${String(jour).padStart(3, "0")}/${c.seance}-${c.exo}-${horodatage}.${ext}`;
  const r = await appelGitHub(env, "PUT", `/repos/${depot}/contents/${chemin}`, {
    message: `Audio ${eleve.code} jour ${jour} ${c.exo}`, content: c.audio, ...(env.AUDIO_BRANCH ? { branch: env.AUDIO_BRANCH } : {})
  });
  if (!r.ok) return json({ erreur: `Dépôt d'archive : refus de GitHub (${r.status})` }, 502, cors);

  const cleSeance = `parole:${eleve.empreinte}:${jour}:${c.seance}`;
  const v = JSON.parse((await env.SUIVI.get(cleSeance)) || "null");
  if (v) {
    v.audios = [...(v.audios || []).slice(-19), { exo: c.exo, depot, chemin, date: maintenant.toISOString(), taille: Math.floor(c.audio.length * 3 / 4), duree: nombreOuNull(c.duree) }];
    await env.SUIVI.put(cleSeance, JSON.stringify(v));
  }
  return json({ ok: true, chemin }, 200, cors);
}

// ---------- Archive audio : accès réservé à l'enseignant (mot de passe) ----------
const CHEMIN_ARCHIVE = /^audio\/(5e|seconde)\/[A-Z0-9]{6,20}\/jour-\d{3}\/[\w.-]+\.(webm|ogg|m4a|mp3|json)$/;
const TYPES_SERVIS = { webm: "audio/webm", ogg: "audio/ogg", m4a: "audio/mp4", mp3: "audio/mpeg", json: "application/json" };

// Dépôt d'archive utilisable (configuré ET privé) : nom du dépôt, ou une réponse d'erreur.
async function archiveUtilisable(env, cors) {
  const depot = env.AUDIO_REPO || "";
  if (!env.GITHUB_TOKEN || !/^[\w.-]+\/[\w.-]+$/.test(depot)) return { refus: json({ erreur: "Archive audio non configurée" }, 503, cors) };
  if (!(await depotPrive(env, depot))) return { refus: json({ erreur: "Archive audio inaccessible : le dépôt doit exister et être privé" }, 503, cors) };
  return { depot };
}
const parametreBranche = env => env.AUDIO_BRANCH ? `?ref=${encodeURIComponent(env.AUDIO_BRANCH)}` : "";

async function adminParoleArchive(env, request, c, cors) {
  const refus = await verifierMotDePasse(env, request, c.motdepasse, cors);
  if (refus) return refus;
  const a = await archiveUtilisable(env, cors);
  if (a.refus) return a.refus;
  const r = await appelGitHub(env, "GET", `/repos/${a.depot}/git/trees/${encodeURIComponent(env.AUDIO_BRANCH || "HEAD")}?recursive=1`);
  if (r.status === 404 || r.status === 409) return json({ ok: true, fichiers: [], tronque: false }, 200, cors);   // dépôt vide
  if (!r.ok) return json({ erreur: `Archive : refus de GitHub (${r.status})` }, 502, cors);
  const d = await r.json().catch(() => ({}));
  const fichiers = (d.tree || []).filter(x => x.type === "blob" && CHEMIN_ARCHIVE.test(x.path)).map(x => {
    const [, classe, code, jour, nom] = x.path.split("/");
    return { chemin: x.path, classe, code, jour: Number(jour.slice(5)), nom, taille: x.size || 0 };
  });
  return json({ ok: true, fichiers, tronque: !!d.truncated }, 200, cors);
}

// Sert un fichier de l'archive. Le dépôt est celui du Worker (jamais choisi par l'appelant) ; le chemin est contrôlé.
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

// ---------- Remise à zéro d'un jour de « Fluidité verbale » ----------
const MAX_SUPPRESSIONS = 200;
const versBase64 = texte => { let s = ""; new TextEncoder().encode(texte).forEach(b => { s += String.fromCharCode(b); }); return btoa(s); };

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
    if (e.type === "dir") { if (profondeur < 3) await purgerDossier(env, depot, e.path, compteur, profondeur + 1); continue; }
    if (e.type !== "file") continue;
    if (compteur.n >= MAX_SUPPRESSIONS) throw new Error("trop de fichiers à supprimer en une fois");
    const r = await appelGitHub(env, "DELETE", `/repos/${depot}/contents/${e.path}`, { message: `Suppression audio (remise à zéro) ${e.path}`, sha: e.sha, ...(env.AUDIO_BRANCH ? { branch: env.AUDIO_BRANCH } : {}) });
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    compteur.n++;
  }
}

async function adminParoleReinitialiser(env, request, c, cors) {
  const refus = await verifierMotDePasse(env, request, c.motdepasse, cors);
  if (refus) return refus;
  if (typeof c.empreinte !== "string" || !/^[0-9a-f]{64}$/.test(c.empreinte)) return json({ erreur: "Élève invalide" }, 400, cors);
  if (c.audios !== "garder" && c.audios !== "supprimer") return json({ erreur: "Précisez s'il faut garder ou supprimer les audios" }, 400, cors);
  const tous = c.jour === "tous", n = Number(c.jour);
  if (!tous && (!Number.isInteger(n) || n < 1 || n > 100)) return json({ erreur: "Jour invalide" }, 400, cors);

  const clesSeances = await toutesLesCles(env, tous ? `parole:${c.empreinte}:` : `parole:${c.empreinte}:${n}:`);
  const clesFait = (await toutesLesCles(env, `fait:${c.empreinte}:parole:`)).filter(k => tous || k === `fait:${c.empreinte}:parole:${n}`);
  const seances = [];
  for (const k of clesSeances) { const v = JSON.parse((await env.SUIVI.get(k)) || "null"); if (v) seances.push(v); }
  let ident = seances[0] ? { classe: seances[0].classe, code: seances[0].code } : null;
  if (!ident && clesFait[0]) { const v = JSON.parse((await env.SUIVI.get(clesFait[0])) || "null"); if (v) ident = { classe: v.classe, code: v.code }; }
  const nbReferences = seances.reduce((s, x) => s + (x.audios || []).length, 0);

  const rapport = { seances: clesSeances.length, joursRemis: clesFait.length, audiosSupprimes: 0, audiosConserves: nbReferences, instantanes: [] };
  const a = (env.GITHUB_TOKEN && env.AUDIO_REPO && ident) ? await archiveUtilisable(env, cors) : { refus: null, depot: null };
  if (a.refus && nbReferences) return a.refus;          // des audios existent mais l'archive est inaccessible : on ne touche à rien

  if (a.depot) {
    try {
      if (c.audios === "supprimer") {
        const compteur = { n: 0 };
        const dossiers = tous ? [`audio/${ident.classe}/${ident.code}`] : [`audio/${ident.classe}/${ident.code}/jour-${String(n).padStart(3, "0")}`];
        for (const d of dossiers) await purgerDossier(env, a.depot, d, compteur);
        rapport.audiosSupprimes = compteur.n; rapport.audiosConserves = 0;
      } else if (nbReferences) {
        // les audios restent dans l'archive ; on y dépose aussi les mesures, notes et transcriptions de la séance remise à zéro
        const parJour = {};
        seances.forEach(s => { (parJour[s.jour] = parJour[s.jour] || []).push(s); });
        const horodatage = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
        for (const [jour, liste] of Object.entries(parJour)) {
          if (!liste.some(s => (s.audios || []).length)) continue;
          const chemin = `audio/${ident.classe}/${ident.code}/jour-${String(jour).padStart(3, "0")}/reinitialisation-${horodatage}.json`;
          const contenu = JSON.stringify({ reinitialiseLe: new Date().toISOString(), classe: ident.classe, code: ident.code, jour: Number(jour), seances: liste }, null, 2);
          const r = await appelGitHub(env, "PUT", `/repos/${a.depot}/contents/${chemin}`, { message: `Sauvegarde avant remise à zéro ${ident.code} jour ${jour}`, content: versBase64(contenu), ...(env.AUDIO_BRANCH ? { branch: env.AUDIO_BRANCH } : {}) });
          if (!r.ok) throw new Error(`GitHub ${r.status}`);
          rapport.instantanes.push(chemin);
        }
      }
    } catch (e) {
      return json({ erreur: `Remise à zéro interrompue, rien n'a été effacé côté suivi : ${e.message}` }, 502, cors);
    }
  }
  for (const k of clesSeances) await env.SUIVI.delete(k);
  for (const k of clesFait) await env.SUIVI.delete(k);
  return json({ ok: true, ...rapport }, 200, cors);
}

// ---------- Analyse automatique (Workers AI) ----------
const MAX_ANALYSES_SEANCE = 8;       // analyses automatiques par séance (hors relance de l'enseignant)
const MAX_ANALYSES_JOUR = 30;        // par élève et par jour (protège la franchise gratuite de Workers AI)
const BLOCAGE_ANALYSE_MS = 90000;    // une analyse « en cours » depuis plus longtemps est considérée comme bloquée

const arrierePlan = (ctx, promesse) => { const p = promesse.catch(() => {}); if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p); };

async function reserverAnalyse(env, empreinte) {
  const cle = `analyses:${empreinte}:${new Date().toISOString().slice(0, 10)}`;
  const n = Number(await env.SUIVI.get(cle)) || 0;
  if (n >= MAX_ANALYSES_JOUR) return false;
  await env.SUIVI.put(cle, String(n + 1), { expirationTtl: 172800 });
  return true;
}

async function lancerAnalyse(env, cle) {
  const s0 = JSON.parse((await env.SUIVI.get(cle)) || "null");
  if (!s0) return;
  const sig = signature(s0);
  const historique = (await seancesDe(env, `parole:${cle.split(":")[1]}:`)).filter(x => x.cle !== cle && (x.ex1 || x.ex2)).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let resultat;
  try { resultat = await analyserSeance(env, s0, historique); }
  catch (e) { resultat = { analyse: { statut: "echec", erreur: String(e && e.message || e).slice(0, 200) }, notesAuto: null }; }
  const s1 = JSON.parse((await env.SUIVI.get(cle)) || "null");
  if (!s1 || signature(s1) !== sig) return;          // séance supprimée ou modifiée entre-temps : une autre analyse prend le relais
  s1.analyse = { ...resultat.analyse, sig, nb: (s1.analyse && s1.analyse.nb) || 1, le: new Date().toISOString() };
  if (resultat.notesAuto) s1.notesAuto = resultat.notesAuto;
  await env.SUIVI.put(cle, JSON.stringify(s1));
}

// Relance (élève ou enseignant) : seulement si la séance existe, que l'analyse est absente, en échec, en estimation ou bloquée.
async function relancer(env, ctx, cle, { force, cors }) {
  if (!env.AI) return json({ erreur: "Analyse automatique non activée sur le Worker (binding AI absent)" }, 503, cors);
  const v = JSON.parse((await env.SUIVI.get(cle)) || "null");
  if (!v || !(v.ex1 || v.ex2)) return json({ erreur: "Séance introuvable" }, 404, cors);
  const a = v.analyse || {};
  if (a.statut === "en_cours" && Date.now() - Date.parse(a.debut || 0) < BLOCAGE_ANALYSE_MS) return json({ ok: true, statut: "en_cours" }, 200, cors);
  if (!force) {
    if (a.statut === "ok" && a.sig === signature(v)) return json({ ok: true, statut: "ok" }, 200, cors);
    if ((a.nb || 0) >= MAX_ANALYSES_SEANCE) return json({ erreur: "Nombre maximal d'analyses atteint pour cette séance : demande à ton enseignant" }, 429, cors);
    if (!(await reserverAnalyse(env, cle.split(":")[1]))) return json({ erreur: "Limite d'analyses atteinte pour aujourd'hui : réessaie demain" }, 429, cors);
  }
  v.analyse = { ...a, sig: signature(v), statut: "en_cours", nb: force ? 1 : (a.nb || 0) + 1, debut: new Date().toISOString() };
  await env.SUIVI.put(cle, JSON.stringify(v));
  arrierePlan(ctx, lancerAnalyse(env, cle));
  return json({ ok: true, statut: "en_cours" }, 200, cors);
}

async function paroleAnalyser(env, ctx, c, cors) {
  const eleve = await identifier(env, c.classe, c.code);
  if (!eleve) return json({ erreur: "Code inconnu" }, 403, cors);
  const jour = Number(c.jour);
  if (!Number.isInteger(jour) || jour < 1 || jour > 100) return json({ erreur: "Jour invalide" }, 400, cors);
  if (typeof c.seance !== "string" || !/^\d{10,14}$/.test(c.seance)) return json({ erreur: "Séance invalide" }, 400, cors);
  return relancer(env, ctx, `parole:${eleve.empreinte}:${jour}:${c.seance}`, { force: false, cors });
}

async function adminParoleAnalyser(env, ctx, request, c, cors) {
  const refus = await verifierMotDePasse(env, request, c.motdepasse, cors);
  if (refus) return refus;
  if (typeof c.cle !== "string" || !CLE_SEANCE.test(c.cle)) return json({ erreur: "Séance invalide" }, 400, cors);
  return relancer(env, ctx, c.cle, { force: true, cors });
}

async function seancesDe(env, prefixe) {
  const liste = [];
  for (const nom of await toutesLesCles(env, prefixe)) {
    const v = JSON.parse((await env.SUIVI.get(nom)) || "null");
    if (v) liste.push({ cle: nom, ...v });
  }
  return liste.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

async function paroleEtat(env, c, cors) {
  const eleve = await identifier(env, c.classe, c.code);
  if (!eleve) return json({ erreur: "Code inconnu" }, 403, cors);
  const seances = (await seancesDe(env, `parole:${eleve.empreinte}:`)).map(({ cle, bilan, audios, corrections, analyse, ...reste }) => {
    if (analyse) { const { indices, erreurEmbeddings, erreur, verifier, sig, ...visible } = analyse; reste.analyse = visible; }
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
  if (typeof c.cle !== "string" || !CLE_SEANCE.test(c.cle)) return json({ erreur: "Séance invalide" }, 400, cors);
  const v = JSON.parse((await env.SUIVI.get(c.cle)) || "null");
  if (!v) return json({ erreur: "Séance introuvable" }, 404, cors);
  v.notes = notesValides(c.notes);
  v.corrections = [];       // écarts entre la note de l'enseignant et la note automatique (suivi de la fiabilité de l'analyse)
  if (v.notesAuto) for (const ex of Object.keys(CRITERES)) for (const cr of Object.keys(CRITERES[ex])) {
    const a = v.notesAuto[ex] && v.notesAuto[ex][cr], f = v.notes && v.notes[ex] && v.notes[ex][cr];
    if (a != null && f != null && a !== f) v.corrections.push({ ex, critere: cr, auto: a, final: f });
  }
  v.retour = texteBorne(c.retour, 8000);
  v.notesLe = new Date().toISOString();
  await env.SUIVI.put(c.cle, JSON.stringify(v));
  return json({ ok: true, notes: v.notes }, 200, cors);
}

async function adminParoleSupprimer(env, request, c, cors) {
  const refus = await verifierMotDePasse(env, request, c.motdepasse, cors);
  if (refus) return refus;
  if (typeof c.cle !== "string" || !CLE_SEANCE.test(c.cle)) return json({ erreur: "Séance invalide" }, 400, cors);
  const existe = !!(await env.SUIVI.get(c.cle));
  if (existe) await env.SUIVI.delete(c.cle);
  return json({ ok: true, supprimees: existe ? 1 : 0 }, 200, cors);
}

// Mot de passe enseignant : comparé par empreinte ; blocage temporaire après trop d'échecs.
async function verifierMotDePasse(env, request, saisi, cors) {
  if (!env.ADMIN_PASSWORD) return json({ erreur: "Mot de passe enseignant non configuré" }, 503, cors);
  const ip = request.headers.get("CF-Connecting-IP") || "inconnue";
  const cleEchecs = `echecs:${ip}`;
  const echecs = Number(await env.SUIVI.get(cleEchecs)) || 0;
  if (echecs >= MAX_ECHECS) return json({ erreur: "Trop d'essais, réessayez plus tard" }, 429, cors);
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

// ---------- Outils ----------
function normaliser(s) { return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }

async function identifier(env, classe, code) {
  if (!CLASSES.includes(classe)) return null;
  const propre = normaliser(code);
  if (propre.length < 6) return null;
  const empreinte = await sha256(`${env.SEL}${classe}:${propre}`);
  let valides = [];
  try { valides = (JSON.parse(env.EMPREINTES || "{}")[classe]) || []; } catch (e) {}
  return valides.includes(empreinte) ? { empreinte, code: propre } : null;
}

async function toutesLesCles(env, prefixe) {
  const noms = [];
  let curseur;
  do {
    const page = await env.SUIVI.list({ prefix: prefixe, cursor: curseur });
    page.keys.forEach(k => noms.push(k.name));
    curseur = page.list_complete ? undefined : page.cursor;
  } while (curseur);
  return noms;
}

async function sha256(texte) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texte));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function json(donnees, statut, cors) {
  return new Response(JSON.stringify(donnees), { status: statut, headers: { "Content-Type": "application/json", ...cors } });
}
