// Version : 1.10 (mur : rattrapage des réussites passées déjà gardées sur le serveur, date d'origine ; 1.9 : mur des réussites de la famille : routes /mur/…, réussites de RoutineSite publiées par le serveur ; 1.8 : jetons de passage /fz/jeton et /fz/ouvrir : le code ZF ne passe plus dans les liens entre le portail et les sites ; 1.7 : les réponses de l'espace enseignant portent le prénom de l'élève, « prenom », à afficher à la place du code ZF ; 1.6 : progression des jeux des 6 sites FamZakSites liée au code ZF ; 1.5 : réponses écrites de Probabilités et Technologie corrigées par Claude via une GitHub Action ; 1.4 : séances de « Fluidité verbale » : archivage audio privé, accès et remise à zéro réservés à l'enseignant, analyse et notes automatiques par Workers AI)
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
// Probabilités et Technologie numérique (réponses écrites, corrigées par Claude) :
//   /reponses/envoyer   { classe, code, routine, jour, envoi, reponses[] } -> enregistre un envoi, valide le jour et le dépose
//                        dans le dépôt privé (reponses/…json) : ce dépôt lance la GitHub Action qui fait corriger l'envoi par Claude
//   /reponses/etat      { classe, code, routine?, jour? }     -> envois de l'élève, avec leur correction quand elle est prête
//   /admin/reponses     { motdepasse }                        -> tous les envois (la correction prête est récupérée au passage)
//   /admin/reponses/modifier { motdepasse, cle, note, texte } -> l'enseignant corrige ou valide la correction affichée à l'élève
//   /admin/reponses/relancer { motdepasse, cle }              -> redemande une correction à Claude
//   /admin/reponses/supprimer { motdepasse, cle }             -> supprime un envoi du suivi
//
// Progression des jeux (quiz, badges, défis) des sites FamZakSites, liée au code ZF (fichier famzak-progres.js des sites) :
//   /progres/lire       { classe, code }                      -> { progres: { <site>: { <clé>: valeur } }, dates: [ISO…] }
//                        (dates : jours de routine faits, pour la série de jours d'affilée de RoutineSite)
//   /progres/ecrire     { classe, code, site, valeurs: { <clé>: valeur } } -> fusionne ces valeurs (null efface une clé)
//   /admin/progres      { motdepasse }                        -> progression de tous les élèves
//
// Passage entre le portail famzak.github.io et les sites (adresses différentes) sans mettre le code ZF dans les liens :
//   /fz/jeton           { classe, code }                      -> { jeton } chiffré (AES-GCM, clé tirée du secret ADMIN_PASSWORD), valable 5 min
//   /fz/ouvrir          { jeton }                             -> { classe, code } si le jeton est valable
//
// Mur des réussites de la famille (page mur.html du portail, bandeau des 6 sites, script famzak-mur.js) :
//   /mur/publier        { classe, code, site, cle, texte, detail? } -> ajoute une réussite (une seule fois par élève, site et clé)
//   /mur/lire           { classe, code, limite? }             -> { reussites, series, defi, mois } : prénoms seulement, jamais de code
//   /mur/bravo          { classe, code, id }                  -> ajoute ou retire mon « Bravo »
//   /mur/cacher         { classe, code, id, cache }           -> cache (ou remontre) une de MES réussites
//   Les réussites de RoutineSite (jour fait, module fini, badges, séries, bonne correction) sont publiées ici même.
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
//                        clé  prog:<empreinte>:<site>  ->  { code, classe, maj, valeurs: { <clé>: valeur } }
//                        clé  mur:fil  ->  [{ id, e: <empreinte>, prenom, site, texte, detail, date, bravos: [empreinte], cache }] (300 dernières)
//                        clé  murvu:<empreinte>:<site>:<clé>  ->  id (réussite déjà publiée)
//                        clé  serie:<empreinte>  ->  { prenom, dates: [AAAA-MM-JJ heure de Paris] } (jours de routine faits, pour les séries)
//                        clé  rep:<empreinte>:<routine>:<jour>:<envoi>  ->  { code, classe, routine, jour, envoi, date, reponses, statut, chemin, correction }

import { CRITERES, analyserSeance, signature } from "./analyse.js";
import { MUR_TITRES } from "./mur-titres.js";

const ROUTINES = ["probabilites", "technologie", "parole"];
const CLASSES = ["5e", "seconde", "famille"];
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
      if (chemin === "/fz/jeton") return await fzJeton(env, corps, cors);
      if (chemin === "/fz/ouvrir") return await fzOuvrir(env, corps, cors);
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
      if (chemin === "/mur/publier") return await murPublier(env, corps, cors);
      if (chemin === "/mur/lire") return await murLire(env, corps, cors);
      if (chemin === "/mur/bravo") return await murBravo(env, corps, cors);
      if (chemin === "/mur/cacher") return await murCacher(env, corps, cors);
      if (chemin === "/progres/lire") return await progresLire(env, corps, cors);
      if (chemin === "/progres/ecrire") return await progresEcrire(env, corps, cors);
      if (chemin === "/admin/progres") return await adminProgres(env, request, corps, cors);
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

// ---------- Jetons de passage entre le portail et les sites ----------
const DUREE_JETON_MS = 5 * 60 * 1000;
const b64url = u => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const deB64url = t => Uint8Array.from(atob(String(t).replace(/-/g, "+").replace(/_/g, "/")), ch => ch.charCodeAt(0));
async function cleJeton(env) {
  const k = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("famzak-jeton:" + env.ADMIN_PASSWORD));
  return crypto.subtle.importKey("raw", k, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function fzJeton(env, c, cors) {
  if (!env.ADMIN_PASSWORD) return json({ erreur: "Jetons indisponibles" }, 503, cors);
  const eleve = await identifier(env, c.classe, c.code);
  if (!eleve) return json({ erreur: "Code inconnu" }, 403, cors);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const texte = new TextEncoder().encode(JSON.stringify({ k: c.classe, c: eleve.code, e: Date.now() + DUREE_JETON_MS }));
  const chiffre = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await cleJeton(env), texte));
  const tout = new Uint8Array(iv.length + chiffre.length); tout.set(iv); tout.set(chiffre, iv.length);
  return json({ ok: true, jeton: b64url(tout) }, 200, cors);
}
async function fzOuvrir(env, c, cors) {
  if (!env.ADMIN_PASSWORD) return json({ erreur: "Jetons indisponibles" }, 503, cors);
  if (typeof c.jeton !== "string" || c.jeton.length > 400) return json({ erreur: "Jeton invalide" }, 400, cors);
  let d;
  try {
    const tout = deB64url(c.jeton);
    const clair = await crypto.subtle.decrypt({ name: "AES-GCM", iv: tout.slice(0, 12) }, await cleJeton(env), tout.slice(12));
    d = JSON.parse(new TextDecoder().decode(clair));
  } catch (e) { return json({ erreur: "Jeton invalide" }, 403, cors); }
  if (!d || !(d.e > Date.now())) return json({ erreur: "Jeton expiré" }, 403, cors);
  const eleve = await identifier(env, d.k, d.c);
  if (!eleve) return json({ erreur: "Code inconnu" }, 403, cors);
  return json({ ok: true, classe: d.k, code: eleve.code }, 200, cors);
}

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
    try { await murApresJourFait(env, eleve, c.classe, c.routine, n); } catch (e) { /* le mur ne bloque jamais le suivi */ }
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

// ---------- Progression des jeux (FamZakSites) ----------
const SITES_PROGRES = ["routinesite", "mathsite", "quantumsite", "culturegsite", "iasite", "morphosite"];
const PROGRES_MAX_CLE = 160, PROGRES_MAX_VALEUR = 4000, PROGRES_MAX_SITE = 60000;

async function progresLire(env, c, cors) {
  const eleve = await identifier(env, c.classe, c.code);
  if (!eleve) return json({ erreur: "Code inconnu" }, 403, cors);
  const progres = {};
  for (const site of SITES_PROGRES) {
    const brut = await env.SUIVI.get(`prog:${eleve.empreinte}:${site}`);
    if (brut) { try { progres[site] = JSON.parse(brut).valeurs || {}; } catch (e) {} }
  }
  const dates = [];
  for (const nom of await toutesLesCles(env, `fait:${eleve.empreinte}:`)) {
    try { const v = JSON.parse(await env.SUIVI.get(nom)); if (v && v.date) dates.push(v.date); } catch (e) {}
  }
  return json({ ok: true, progres, dates: dates.sort(), prenom: await prenomDe(env, c.classe, eleve.code) }, 200, cors);
}

async function progresEcrire(env, c, cors) {
  const eleve = await identifier(env, c.classe, c.code);
  if (!eleve) return json({ erreur: "Code inconnu" }, 403, cors);
  if (!SITES_PROGRES.includes(c.site)) return json({ erreur: "Site inconnu" }, 400, cors);
  if (!c.valeurs || typeof c.valeurs !== "object" || Array.isArray(c.valeurs)) return json({ erreur: "Valeurs invalides" }, 400, cors);
  const cle = `prog:${eleve.empreinte}:${c.site}`;
  let actuel = {};
  try { actuel = (JSON.parse(await env.SUIVI.get(cle)) || {}).valeurs || {}; } catch (e) {}
  for (const [k, v] of Object.entries(c.valeurs)) {
    if (typeof k !== "string" || !k || k.length > PROGRES_MAX_CLE) return json({ erreur: "Clé invalide" }, 400, cors);
    if (v === null) { delete actuel[k]; continue; }
    if (JSON.stringify(v).length > PROGRES_MAX_VALEUR) return json({ erreur: "Valeur trop longue" }, 400, cors);
    actuel[k] = v;
  }
  const texte = JSON.stringify({ code: eleve.code, classe: c.classe, maj: new Date().toISOString(), valeurs: actuel });
  if (texte.length > PROGRES_MAX_SITE) return json({ erreur: "Progression trop volumineuse" }, 400, cors);
  await env.SUIVI.put(cle, texte);
  return json({ ok: true }, 200, cors);
}

async function adminProgres(env, request, c, cors) {
  const refus = await verifierMotDePasse(env, request, c.motdepasse, cors);
  if (refus) return refus;
  const eleves = {};
  for (const nom of await toutesLesCles(env, "prog:")) {
    const [, empreinte, site] = nom.split(":");
    let v = null; try { v = JSON.parse(await env.SUIVI.get(nom)); } catch (e) {}
    if (!v) continue;
    const e = eleves[empreinte] || (eleves[empreinte] = { empreinte, code: v.code, classe: v.classe, sites: {} });
    e.sites[site] = { maj: v.maj, valeurs: v.valeurs };
  }
  return json({ ok: true, eleves: await avecPrenoms(env, Object.values(eleves)) }, 200, cors);
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
  const liste = (await avecPrenoms(env, Object.values(eleves))).sort((a, b) => a.classe.localeCompare(b.classe) || String(a.prenom || a.code).localeCompare(String(b.prenom || b.code)));
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
    message: `Audio ${await nomAffiche(env, c.classe, eleve.code)} jour ${jour} ${c.exo}`, content: c.audio, ...(env.AUDIO_BRANCH ? { branch: env.AUDIO_BRANCH } : {})
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
const CHEMIN_ARCHIVE = /^audio\/(5e|seconde|famille)\/[A-Z0-9]{6,20}\/jour-\d{3}\/[\w.-]+\.(webm|ogg|m4a|mp3|json)$/;
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
  return json({ ok: true, fichiers: await avecPrenoms(env, fichiers), tronque: !!d.truncated }, 200, cors);
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
          const r = await appelGitHub(env, "PUT", `/repos/${a.depot}/contents/${chemin}`, { message: `Sauvegarde avant remise à zéro ${await nomAffiche(env, ident.classe, ident.code)} jour ${jour}`, content: versBase64(contenu), ...(env.AUDIO_BRANCH ? { branch: env.AUDIO_BRANCH } : {}) });
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
  return json({ ok: true, seances: await avecPrenoms(env, await seancesDe(env, "parole:")) }, 200, cors);
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

// ---------- Probabilités et Technologie : réponses écrites corrigées par Claude ----------
// L'élève envoie ses réponses ; le Worker les enregistre (KV) et les dépose UNE fois dans le dépôt privé
// (reponses/<classe>/<CODE>/<routine>/jour-NNN/<envoi>.json). Ce dépôt contient la GitHub Action qui fait corriger
// chaque envoi par Claude (abonnement de l'enseignant) et écrit corrections/<même chemin>. Le Worker va chercher
// cette correction quand l'élève (ou l'enseignant) consulte ses envois.
const ROUTINES_ECRITES = ["probabilites", "technologie"];
const CLE_REPONSE = /^rep:[0-9a-f]{64}:(probabilites|technologie):\d{1,3}:\d{10,14}$/;
const MAX_ENVOIS_JOUR = 20;               // envois par élève et par jour calendaire (protège le quota Claude)
const MAX_REPONSE = 3000;                 // caractères par réponse
const ATTENTE_VERIF_MS = 15000;           // délai minimal entre deux recherches de la correction dans le dépôt
const RETARD_MS = 30 * 60 * 1000;         // au-delà, la correction est signalée « en retard »
const VERDICTS = ["juste", "partiel", "faux", "vide"];

const cheminEnvoi = v => `reponses/${v.classe}/${v.code}/${v.routine}/jour-${String(v.jour).padStart(3, "0")}/${v.envoi}.json`;
const cheminCorrection = v => "corrections/" + cheminEnvoi(v).slice("reponses/".length);
const depuisBase64 = b => { const bin = atob(String(b).replace(/\s/g, "")); return new TextDecoder().decode(Uint8Array.from(bin, ch => ch.charCodeAt(0))); };

async function deposerEnvoi(env, depot, v, relance = 0) {
  const chemin = cheminEnvoi(v);
  const contenu = JSON.stringify({ classe: v.classe, code: v.code, routine: v.routine, jour: v.jour, envoi: v.envoi, essai: v.essai, date: v.date, relance, reponses: v.reponses }, null, 2);
  let sha;
  if (relance) {                          // relance : on met à jour le fichier (nouveau commit, donc nouvelle correction)
    const r0 = await appelGitHub(env, "GET", `/repos/${depot}/contents/${chemin}${parametreBranche(env)}`);
    if (r0.ok) sha = (await r0.json().catch(() => ({}))).sha;
  }
  const r = await appelGitHub(env, "PUT", `/repos/${depot}/contents/${chemin}`, {
    message: `Réponses ${await nomAffiche(env, v.classe, v.code)} ${v.routine} jour ${v.jour} (envoi ${v.envoi}${relance ? `, relance ${relance}` : ""})`,
    content: versBase64(contenu), ...(sha ? { sha } : {}), ...(env.AUDIO_BRANCH ? { branch: env.AUDIO_BRANCH } : {})
  });
  if (r.ok) return { ok: true, chemin };
  if (r.status === 422 && !relance) return { ok: true, chemin, dejaLa: true };   // fichier déjà déposé : pas de second dépôt, pas de seconde correction
  return { ok: false, statut: r.status };
}

function correctionValide(o, nbExercices) {
  if (!o || typeof o !== "object") return null;
  const questions = Array.isArray(o.questions) ? o.questions.slice(0, 40).map(q => ({
    exercice: Math.min(nbExercices || 3, Math.max(1, parseInt(q && q.exercice, 10) || 1)),
    question: texteBorne(String((q && q.question) ?? ""), 10),
    verdict: VERDICTS.includes(q && q.verdict) ? q.verdict : "faux",
    commentaire: texteBorne(q && q.commentaire, 400)
  })) : [];
  const total = Number.isInteger(o.total) && o.total > 0 ? Math.min(o.total, 60) : questions.length;
  const justes = nombreOuNull(o.justes);
  return {
    justes: justes === null ? questions.filter(q => q.verdict === "juste").length : Math.min(total, Math.max(0, justes)),
    total, questions, texte: texteBorne(o.texte, 12000),
    aVerifier: texteBorne(o.aVerifier, 1000), modele: texteBorne(o.modele, 60)
  };
}

// Va chercher dans le dépôt privé la correction d'un envoi en attente ; met à jour le KV si elle est arrivée.
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
        if (d.statut === "echec") { v.statut = "echec"; v.erreur = texteBorne(d.erreur, 300); }
        else {
          const c = correctionValide(d.correction, v.reponses.length);
          if (c && c.texte) {
            v.statut = "corrige"; v.correctionAuto = c; v.correction = { justes: c.justes, total: c.total, texte: c.texte, questions: c.questions }; v.corrigeLe = d.date || new Date().toISOString();
            try { await murApresCorrection(env, v); } catch (e) { /* le mur ne bloque jamais le suivi */ }
          }
          else { v.statut = "echec"; v.erreur = "Correction illisible"; }
        }
      }
    }
  } catch (e) { /* on réessaiera à la prochaine consultation */ }
  await env.SUIVI.put(cle, JSON.stringify(v));
  return v;
}

function vueEleve(v, cle) {
  const enRetard = v.statut === "en_cours" && Date.now() - Date.parse(v.attenteDepuis || v.date) > RETARD_MS;
  return { cle, routine: v.routine, jour: v.jour, envoi: v.envoi, essai: v.essai, date: v.date, reponses: v.reponses,
    statut: enRetard ? "en_retard" : v.statut, correction: v.statut === "corrige" ? v.correction : null, valide: !!v.valideLe };
}

async function reponsesEnvoyer(env, c, cors) {
  const eleve = await identifier(env, c.classe, c.code);
  if (!eleve) return json({ erreur: "Code inconnu" }, 403, cors);
  if (!ROUTINES_ECRITES.includes(c.routine)) return json({ erreur: "Routine inconnue" }, 400, cors);
  const jour = Number(c.jour);
  if (!Number.isInteger(jour) || jour < 1 || jour > 100) return json({ erreur: "Jour invalide" }, 400, cors);
  if (typeof c.envoi !== "string" || !/^\d{10,14}$/.test(c.envoi)) return json({ erreur: "Envoi invalide" }, 400, cors);
  if (!Array.isArray(c.reponses) || c.reponses.length < 1 || c.reponses.length > 6) return json({ erreur: "Réponses invalides" }, 400, cors);
  const reponses = c.reponses.map(x => texteBorne(typeof x === "string" ? x : (x && x.texte), MAX_REPONSE).trim());
  if (reponses.some(x => !x)) return json({ erreur: "Réponds à tous les exercices avant d'envoyer" }, 400, cors);

  const cle = `rep:${eleve.empreinte}:${c.routine}:${jour}:${c.envoi}`;
  const existant = JSON.parse((await env.SUIVI.get(cle)) || "null");
  if (existant) return json({ ok: true, deja: true, envoi: vueEleve(existant, cle) }, 200, cors);   // même envoi renvoyé (double clic, réseau) : rien de plus

  const aujourdhui = new Date().toISOString().slice(0, 10);
  const cleQuota = `envois:${eleve.empreinte}:${aujourdhui}`;
  const nbJour = Number(await env.SUIVI.get(cleQuota)) || 0;
  if (nbJour >= MAX_ENVOIS_JOUR) return json({ erreur: "Tu as fait beaucoup d'envois aujourd'hui : réessaie demain" }, 429, cors);
  await env.SUIVI.put(cleQuota, String(nbJour + 1), { expirationTtl: 172800 });

  const essai = (await toutesLesCles(env, `rep:${eleve.empreinte}:${c.routine}:${jour}:`)).length + 1;
  const v = { code: eleve.code, classe: c.classe, routine: c.routine, jour, envoi: c.envoi, essai, date: new Date().toISOString(), reponses, statut: "en_cours", relance: 0 };

  // Le jour compte comme fait dès l'envoi (comme avec l'e-mail).
  const cleFait = `fait:${eleve.empreinte}:${c.routine}:${jour}`;
  if (!(await env.SUIVI.get(cleFait))) {
    await env.SUIVI.put(cleFait, JSON.stringify({ code: eleve.code, classe: c.classe, date: v.date }));
    try { await murApresJourFait(env, eleve, c.classe, c.routine, jour); } catch (e) { /* le mur ne bloque jamais le suivi */ }
  }

  const a = await archiveUtilisable(env, cors);
  if (a.refus) { v.statut = "non_configure"; }
  else {
    const d = await deposerEnvoi(env, a.depot, v);
    if (d.ok) v.chemin = d.chemin;
    else { v.statut = "echec_depot"; v.erreur = `GitHub ${d.statut}`; }
  }
  await env.SUIVI.put(cle, JSON.stringify(v));
  return json({ ok: true, envoi: vueEleve(v, cle) }, 200, cors);
}

async function reponsesEtat(env, c, cors) {
  const eleve = await identifier(env, c.classe, c.code);
  if (!eleve) return json({ erreur: "Code inconnu" }, 403, cors);
  let prefixe = `rep:${eleve.empreinte}:`;
  if (c.routine !== undefined) {
    if (!ROUTINES_ECRITES.includes(c.routine)) return json({ erreur: "Routine inconnue" }, 400, cors);
    prefixe += `${c.routine}:`;
    if (c.jour !== undefined) {
      const jour = Number(c.jour);
      if (!Number.isInteger(jour) || jour < 1 || jour > 100) return json({ erreur: "Jour invalide" }, 400, cors);
      prefixe += `${jour}:`;
    }
  }
  const envois = [];
  for (const cle of await toutesLesCles(env, prefixe)) {
    let v = JSON.parse((await env.SUIVI.get(cle)) || "null");
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
    let v = JSON.parse((await env.SUIVI.get(cle)) || "null");
    if (!v) continue;
    v = await recupererCorrection(env, cle, v);
    envois.push({ cle, ...v });
  }
  envois.sort((x, y) => String(x.date).localeCompare(String(y.date)));
  return json({ ok: true, envois: await avecPrenoms(env, envois) }, 200, cors);
}

async function adminReponsesModifier(env, request, c, cors) {
  const refus = await verifierMotDePasse(env, request, c.motdepasse, cors);
  if (refus) return refus;
  if (typeof c.cle !== "string" || !CLE_REPONSE.test(c.cle)) return json({ erreur: "Envoi invalide" }, 400, cors);
  const v = JSON.parse((await env.SUIVI.get(c.cle)) || "null");
  if (!v) return json({ erreur: "Envoi introuvable" }, 404, cors);
  const texte = texteBorne(c.texte, 12000).trim();
  if (!texte) return json({ erreur: "Le texte de correction est vide" }, 400, cors);
  const total = Number.isInteger(Number(c.total)) && Number(c.total) > 0 ? Math.min(60, Number(c.total)) : ((v.correction && v.correction.total) || 0);
  const justes = nombreOuNull(c.justes);
  v.correction = { ...(v.correction || {}), texte, total, justes: justes === null ? ((v.correction && v.correction.justes) || 0) : Math.min(total, Math.max(0, justes)) };
  v.statut = "corrige";
  v.valideLe = new Date().toISOString();
  await env.SUIVI.put(c.cle, JSON.stringify(v));
  return json({ ok: true, correction: v.correction }, 200, cors);
}

async function adminReponsesRelancer(env, request, c, cors) {
  const refus = await verifierMotDePasse(env, request, c.motdepasse, cors);
  if (refus) return refus;
  if (typeof c.cle !== "string" || !CLE_REPONSE.test(c.cle)) return json({ erreur: "Envoi invalide" }, 400, cors);
  const v = JSON.parse((await env.SUIVI.get(c.cle)) || "null");
  if (!v) return json({ erreur: "Envoi introuvable" }, 404, cors);
  const a = await archiveUtilisable(env, cors);
  if (a.refus) return a.refus;
  const relance = (v.relance || 0) + 1;
  const d = await deposerEnvoi(env, a.depot, v, relance);
  if (!d.ok) return json({ erreur: `Dépôt privé : refus de GitHub (${d.statut})` }, 502, cors);
  Object.assign(v, { relance, statut: "en_cours", chemin: d.chemin, attenteDepuis: new Date().toISOString() });
  delete v.erreur; delete v.verifieLe;
  await env.SUIVI.put(c.cle, JSON.stringify(v));
  return json({ ok: true, statut: v.statut }, 200, cors);
}

async function adminReponsesSupprimer(env, request, c, cors) {
  const refus = await verifierMotDePasse(env, request, c.motdepasse, cors);
  if (refus) return refus;
  if (typeof c.cle !== "string" || !CLE_REPONSE.test(c.cle)) return json({ erreur: "Envoi invalide" }, 400, cors);
  const existe = !!(await env.SUIVI.get(c.cle));
  if (existe) await env.SUIVI.delete(c.cle);
  return json({ ok: true, supprimes: existe ? 1 : 0 }, 200, cors);
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

// Prénom à afficher à la place du code ZF. Variable PRENOMS (wrangler.toml) : { <empreinte>: "iv.texte" en base64 },
// chiffré en AES-GCM avec SHA-256("famzak-prenom:" + CODE) : il ne se lit qu'avec le code (que le Worker reçoit
// ou a gardé avec chaque enregistrement), et la liste publique ne permet pas de retrouver les codes.
// Même liste dans famzak-verrou.js. Code sans prénom : null (les pages affichent alors « Élève » + début d'empreinte).
const octets = b => Uint8Array.from(atob(b), ch => ch.charCodeAt(0));
const memoPrenoms = new Map();
async function prenomDe(env, classe, code) {
  const propre = normaliser(code);
  if (!CLASSES.includes(classe) || !propre) return null;
  const cle = `${classe}:${propre}`;
  if (memoPrenoms.has(cle)) return memoPrenoms.get(cle);
  let prenom = null;
  try {
    const v = (JSON.parse(env.PRENOMS || "{}"))[await sha256(`${env.SEL}${classe}:${propre}`)];
    if (v) {
      const [iv, texte] = v.split(".");
      const k = await crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", new TextEncoder().encode("famzak-prenom:" + propre)), "AES-GCM", false, ["decrypt"]);
      prenom = new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: octets(iv) }, k, octets(texte)));
    }
  } catch (e) { prenom = null; }
  memoPrenoms.set(cle, prenom);
  return prenom;
}
// Ajoute « prenom » à chaque élément qui porte { classe, code }.
async function avecPrenoms(env, liste) {
  for (const x of liste) if (x && x.code) x.prenom = await prenomDe(env, x.classe, x.code);
  return liste;
}
// Nom lisible pour les messages (commits de l'archive) : le prénom, sinon le début de l'empreinte.
async function nomAffiche(env, classe, code) {
  return (await prenomDe(env, classe, code)) || `élève ${(await sha256(`${env.SEL}${classe}:${normaliser(code)}`)).slice(0, 6)}`;
}

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

// ---------- Mur des réussites de la famille ----------
// Une réussite = { id, e (empreinte de l'auteur, jamais renvoyée), prenom, site, texte, detail, date, bravos: [empreintes], cache }.
// Le texte est du texte brut (les pages l'affichent avec textContent) ; « [[…]] » y marque un nombre à mettre en valeur.
// Seuls les prénoms sortent du serveur : ni code ZF, ni empreinte.
const MUR_SITES = ["routinesite", "mathsite", "quantumsite", "culturegsite", "iasite", "morphosite"];
const MUR_MAX = 500, MUR_MAX_JOUR = 40, MUR_DEFI = 25;
const MUR_MODULES = {
  probabilites: ["Le langage des probabilités", "Combiner des événements", "Expériences à plusieurs épreuves",
    "Fréquences, simulation, tableaux croisés", "Probabilités conditionnelles", "Indépendance et répétition",
    "Variables aléatoires", "Dénombrement", "Loi binomiale", "Sommes et grands nombres"],
  technologie: ["L'ordinateur", "Coder l'information", "Réseaux et Internet", "Le Web", "Données et objets connectés",
    "Transmission et infrastructures", "Cybersécurité", "Au cœur de la machine", "Intelligence artificielle",
    "Perspectives et synthèse"]
};
const MUR_ROUTINES = { probabilites: "Probabilités en 100 jours", technologie: "Technologie numérique en 100 jours", parole: "Fluidité verbale en 100 jours" };
const MUR_PALIERS_JOURS = [[1, "🌱 Premier pas"], [10, "🥉 10 jours"], [30, "🥈 30 jours"], [50, "🥇 Mi-parcours"], [100, "🏆 100 jours"]];
const MUR_PALIERS_SERIE = [[3, "🔥 Série de 3 jours"], [7, "⚡ Série de 7 jours"], [30, "💎 Série de 30 jours"]];

const murTexte = (s, max) => String(typeof s === "string" ? s : "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
// Date du jour à Paris (AAAA-MM-JJ) : les séries et la semaine suivent l'heure de la famille.
const murJourParis = d => new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const murDecaler = (jour, n) => { const d = new Date(jour + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function murFil(env) { try { return JSON.parse(await env.SUIVI.get("mur:fil")) || []; } catch (e) { return []; } }
async function murEcrireFil(env, fil) {
  fil.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  await env.SUIVI.put("mur:fil", JSON.stringify(fil.slice(0, MUR_MAX)));
}
async function murDejaRattrapees(env) { try { return new Set(JSON.parse(await env.SUIVI.get("murvu:rattrapage")) || []); } catch (e) { return new Set(); } }
// Date d'origine acceptée (passée, après 2024) : « AAAA-MM-JJ » ou ISO complet. Sinon null (= maintenant).
function murDate(d) {
  if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(d)) return null;
  const t = Date.parse(d.length === 10 ? d + "T12:00:00Z" : d);
  if (!(t > Date.parse("2024-01-01")) || t > Date.now() + 60000) return null;
  return new Date(Math.min(t, Date.now())).toISOString();
}

// Ajoute une réussite (une seule fois par élève, site et clé). Renvoie l'id, ou null si déjà publiée ou refusée.
async function murAjouter(env, empreinte, classe, code, site, cle, texte, detail, grande, date) {
  const vu = `murvu:${empreinte}:${site}:${cle}`;
  if (await env.SUIVI.get(vu)) return null;
  if ((await murDejaRattrapees(env)).has(`${empreinte}:${site}:${cle}`)) return null;
  const quota = `murjour:${empreinte}:${murJourParis(new Date())}`;
  const nb = Number(await env.SUIVI.get(quota)) || 0;
  if (nb >= MUR_MAX_JOUR) return null;
  const prenom = await prenomDe(env, classe, code);
  if (!prenom) return null;                      // pas de prénom connu : rien sur le mur (jamais de code affiché)
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const fil = await murFil(env);
  fil.unshift({ id, e: empreinte, prenom, site, cle, texte, detail: detail || "", date: murDate(date) || new Date().toISOString(), bravos: [], cache: false, grande: !!grande });
  await murEcrireFil(env, fil);
  await env.SUIVI.put(vu, id);
  await env.SUIVI.put(quota, String(nb + 1), { expirationTtl: 172800 });
  return id;
}

async function murPublier(env, c, cors) {
  const eleve = await identifier(env, c.classe, c.code);
  if (!eleve) return json({ erreur: "Code inconnu" }, 403, cors);
  if (!MUR_SITES.includes(c.site) || c.site === "routinesite") return json({ erreur: "Site inconnu" }, 400, cors);   // RoutineSite : publié par le serveur
  const cle = murTexte(c.cle, 120), texte = murTexte(c.texte, 180), detail = murTexte(c.detail, 120);
  if (!cle || !/^[\w:.\-]+$/.test(cle)) return json({ erreur: "Clé invalide" }, 400, cors);
  if (texte.length < 4) return json({ erreur: "Texte invalide" }, 400, cors);
  const id = await murAjouter(env, eleve.empreinte, c.classe, eleve.code, c.site, cle, texte, detail, c.grande === true, c.date);
  return json({ ok: true, id, deja: !id }, 200, cors);
}

function murVue(r, moi) {
  return { id: r.id, prenom: r.prenom, site: r.site, texte: r.texte, detail: r.detail, date: r.date, grande: !!r.grande,
    bravos: r.bravos.length, jaiDitBravo: r.bravos.includes(moi), moi: r.e === moi, cache: !!r.cache };
}

// Série en cours : jours d'affilée jusqu'à aujourd'hui ou hier (heure de Paris).
function murSerie(dates) {
  const ens = new Set(dates || []);
  let j = murJourParis(new Date());
  if (!ens.has(j)) j = murDecaler(j, -1);
  let n = 0;
  while (ens.has(j)) { n++; j = murDecaler(j, -1); }
  return n;
}
function murRecord(dates) {
  let record = 0, cours = 0, prec = null;
  [...new Set(dates || [])].sort().forEach(j => { cours = prec && murDecaler(prec, 1) === j ? cours + 1 : 1; record = Math.max(record, cours); prec = j; });
  return record;
}

// Jours de routine faits (heure de Paris), gardés à part pour calculer les séries sans tout relire.
async function murDatesDe(env, empreinte, classe, code) {
  let s = null;
  try { s = JSON.parse(await env.SUIVI.get(`serie:${empreinte}`)); } catch (e) {}
  if (s && Array.isArray(s.dates)) return s;
  const dates = new Set();
  for (const nom of await toutesLesCles(env, `fait:${empreinte}:`)) {
    try { const v = JSON.parse(await env.SUIVI.get(nom)); if (v && v.date) dates.add(murJourParis(new Date(v.date))); } catch (e) {}
  }
  s = { prenom: await prenomDe(env, classe, code), dates: [...dates].sort().slice(-400) };
  await env.SUIVI.put(`serie:${empreinte}`, JSON.stringify(s));
  return s;
}

// Appelé quand un jour de routine devient « fait » (première fois) : série, paliers de jours, module terminé.
async function murApresJourFait(env, eleve, classe, routine, n) {
  const s = await murDatesDe(env, eleve.empreinte, classe, eleve.code);
  const recordAvant = murRecord(s.dates);
  const aujourdhui = murJourParis(new Date());
  if (!s.dates.includes(aujourdhui)) { s.dates.push(aujourdhui); s.dates = s.dates.sort().slice(-400); }
  if (!s.prenom) s.prenom = await prenomDe(env, classe, eleve.code);
  await env.SUIVI.put(`serie:${eleve.empreinte}`, JSON.stringify(s));
  const nomRoutine = MUR_ROUTINES[routine] || routine;
  const ajouter = (cle, texte, detail, grande) => murAjouter(env, eleve.empreinte, classe, eleve.code, "routinesite", cle, texte, detail, grande);
  // Séries (toutes routines confondues), comme les badges de RoutineSite
  const record = murRecord(s.dates);
  for (const [p, nom] of MUR_PALIERS_SERIE) if (record >= p && recordAvant < p) await ajouter(`serie:${p}`, `a obtenu le badge ${nom}`, "Jours d'affilée, toutes routines", p >= 7);
  // Paliers de jours faits dans cette routine
  const faits = (await joursDe(env, eleve.empreinte))[routine] || [];
  for (const [p, nom] of MUR_PALIERS_JOURS) if (faits.length === p) await ajouter(`jours:${routine}:${p}`, `a obtenu le badge ${nom}`, nomRoutine, p >= 30);
  // Module de 10 jours terminé
  const modules = MUR_MODULES[routine];
  if (modules) {
    const m = Math.ceil(n / 10), debut = (m - 1) * 10 + 1;
    let complet = true;
    for (let j = debut; j < debut + 10; j++) if (!faits.includes(j)) { complet = false; break; }
    if (complet) await ajouter(`module:${routine}:${m}`, `a fini le module ${m} « ${modules[m - 1]} »`, nomRoutine, true);
  }
}

// Appelé quand une correction de Probabilités ou Technologie arrive : au moins 3/4 des exercices justes.
async function murApresCorrection(env, v) {
  const c = v.correction || {};
  if (!(c.total > 0) || c.justes / c.total < 0.75) return;
  const eleve = await identifier(env, v.classe, v.code);
  if (!eleve) return;
  const texte = c.justes === c.total ? `a tout juste au jour ${v.jour} : [[${c.justes}/${c.total}]]` : `a eu [[${c.justes}/${c.total}]] au jour ${v.jour}`;
  await murAjouter(env, eleve.empreinte, v.classe, eleve.code, "routinesite", `correction:${v.routine}:${v.jour}`, texte, MUR_ROUTINES[v.routine] || v.routine, c.justes === c.total);
}

async function murLire(env, c, cors) {
  const eleve = await identifier(env, c.classe, c.code);
  if (!eleve) return json({ erreur: "Code inconnu" }, 403, cors);
  try { await murRattrapage(env); } catch (e) { /* on réessaiera à la prochaine lecture */ }
  const limite = Math.min(MUR_MAX, Math.max(1, Number(c.limite) || 100));
  const fil = await murFil(env);
  const visibles = fil.filter(r => !r.cache || r.e === eleve.empreinte);
  // Ma série (créée au besoin), puis celles de toute la famille
  await murDatesDe(env, eleve.empreinte, c.classe, eleve.code);
  const series = [];
  for (const nom of await toutesLesCles(env, "serie:")) {
    let s = null; try { s = JSON.parse(await env.SUIVI.get(nom)); } catch (e) {}
    if (s && s.prenom) series.push({ prenom: s.prenom, jours: murSerie(s.dates), record: murRecord(s.dates), moi: nom === `serie:${eleve.empreinte}` });
  }
  series.sort((a, b) => b.jours - a.jours || a.prenom.localeCompare(b.prenom));
  // Défi de la semaine (du lundi au dimanche, heure de Paris) et réussites du mois, par site
  const auj = murJourParis(new Date()), jourSemaine = (new Date(auj + "T12:00:00Z").getUTCDay() + 6) % 7, lundi = murDecaler(auj, -jourSemaine);
  const parPrenom = {}, parSite = {};
  let semaine = 0, mois = 0;
  for (const r of fil) {
    if (r.cache) continue;
    const j = murJourParis(new Date(r.date));
    if (j >= lundi) { semaine++; parPrenom[r.prenom] = (parPrenom[r.prenom] || 0) + 1; }
    if (j.slice(0, 7) === auj.slice(0, 7)) { mois++; parSite[r.site] = (parSite[r.site] || 0) + 1; }
  }
  return json({ ok: true, moi: await prenomDe(env, c.classe, eleve.code), reussites: visibles.slice(0, limite).map(r => murVue(r, eleve.empreinte)), series,
    defi: { but: MUR_DEFI, fait: semaine, parPrenom, fin: murDecaler(lundi, 6) }, mois: { total: mois, parSite } }, 200, cors);
}

async function murBravo(env, c, cors) {
  const eleve = await identifier(env, c.classe, c.code);
  if (!eleve) return json({ erreur: "Code inconnu" }, 403, cors);
  const fil = await murFil(env);
  const r = fil.find(x => x.id === c.id);
  if (!r) return json({ erreur: "Réussite introuvable" }, 404, cors);
  const i = r.bravos.indexOf(eleve.empreinte);
  if (i >= 0) r.bravos.splice(i, 1); else r.bravos.push(eleve.empreinte);
  await murEcrireFil(env, fil);
  return json({ ok: true, bravos: r.bravos.length, jaiDitBravo: i < 0 }, 200, cors);
}

async function murCacher(env, c, cors) {
  const eleve = await identifier(env, c.classe, c.code);
  if (!eleve) return json({ erreur: "Code inconnu" }, 403, cors);
  const fil = await murFil(env);
  const r = fil.find(x => x.id === c.id);
  if (!r) return json({ erreur: "Réussite introuvable" }, 404, cors);
  if (r.e !== eleve.empreinte) return json({ erreur: "Seul l'auteur peut cacher sa réussite" }, 403, cors);
  r.cache = c.cache !== false;
  await murEcrireFil(env, fil);
  return json({ ok: true, cache: r.cache }, 200, cors);
}

// ---------- Rattrapage : les réussites passées déjà gardées sur le serveur (une seule fois) ----------
// Jours de routine (fait:…), corrections (rep:…) et progression des jeux des sites (prog:…) : chaque réussite
// est ajoutée au mur à sa date d'origine, avec le prénom de l'élève. Les titres viennent de mur-titres.js.
// Les notes d'évaluation de MathSite (gardées dans le dépôt de MathSite) arrivent quand l'élève ouvre son espace.
const MUR_RATTRAPAGE = "1";
async function murRattrapage(env) {
  if ((await env.SUIVI.get("mur:rattrapage")) === MUR_RATTRAPAGE) return 0;
  await env.SUIVI.put("mur:rattrapage", MUR_RATTRAPAGE);
  const cands = [];
  const ajouter = (e, classe, code, site, cle, texte, detail, date, grande) => cands.push({ e, classe, code, site, cle, texte, detail: detail || "", date, grande: !!grande });
  const lireJSON = async nom => { try { return JSON.parse(await env.SUIVI.get(nom)); } catch (x) { return null; } };

  // RoutineSite : jours faits
  const parEleve = {};
  for (const nom of await toutesLesCles(env, "fait:")) {
    const [, e, routine, n] = nom.split(":");
    const v = await lireJSON(nom);
    if (!v || !v.date) continue;
    const x = parEleve[e] || (parEleve[e] = { code: v.code, classe: v.classe, routines: {} });
    (x.routines[routine] || (x.routines[routine] = [])).push({ n: Number(n), date: v.date });
  }
  for (const [e, x] of Object.entries(parEleve)) {
    const toutes = [];
    for (const [routine, jours] of Object.entries(x.routines)) {
      jours.sort((a, b) => a.date.localeCompare(b.date));
      toutes.push(...jours);
      const nomRoutine = MUR_ROUTINES[routine] || routine;
      for (const [p, nom] of MUR_PALIERS_JOURS) if (jours.length >= p) ajouter(e, x.classe, x.code, "routinesite", `jours:${routine}:${p}`, `a obtenu le badge ${nom}`, nomRoutine, jours[p - 1].date, p >= 30);
      const modules = MUR_MODULES[routine];
      if (modules) for (let m = 1; m <= 10; m++) {
        const dix = jours.filter(j => j.n > (m - 1) * 10 && j.n <= m * 10);
        if (dix.length === 10) ajouter(e, x.classe, x.code, "routinesite", `module:${routine}:${m}`, `a fini le module ${m} « ${modules[m - 1]} »`, nomRoutine, dix[dix.length - 1].date, true);
      }
    }
    // Séries : premier jour où la série atteint 3, 7, 30 jours d'affilée (heure de Paris)
    const dernier = {};
    toutes.forEach(j => { const d = murJourParis(new Date(j.date)); if (!dernier[d] || j.date > dernier[d]) dernier[d] = j.date; });
    let cours = 0, prec = null;
    const atteint = {};
    Object.keys(dernier).sort().forEach(d => {
      cours = prec && murDecaler(prec, 1) === d ? cours + 1 : 1; prec = d;
      for (const [p] of MUR_PALIERS_SERIE) if (cours >= p && !atteint[p]) atteint[p] = dernier[d];
    });
    for (const [p, nom] of MUR_PALIERS_SERIE) if (atteint[p]) ajouter(e, x.classe, x.code, "routinesite", `serie:${p}`, `a obtenu le badge ${nom}`, "Jours d'affilée, toutes routines", atteint[p], p >= 7);
  }
  // RoutineSite : corrections d'au moins 3/4
  for (const nom of await toutesLesCles(env, "rep:")) {
    const v = await lireJSON(nom);
    const c = v && v.statut === "corrige" && v.correction;
    if (!c || !(c.total > 0) || c.justes / c.total < 0.75) continue;
    const e = nom.split(":")[1];
    const texte = c.justes === c.total ? `a tout juste au jour ${v.jour} : [[${c.justes}/${c.total}]]` : `a eu [[${c.justes}/${c.total}]] au jour ${v.jour}`;
    ajouter(e, v.classe, v.code, "routinesite", `correction:${v.routine}:${v.jour}`, texte, MUR_ROUTINES[v.routine] || v.routine, v.corrigeLe || v.date, c.justes === c.total);
  }
  // Jeux des autres sites (progression liée au code ZF)
  for (const nom of await toutesLesCles(env, "prog:")) {
    const [, e, site] = nom.split(":");
    const v = await lireJSON(nom);
    if (!v || !v.valeurs || !MUR_SITES.includes(site) || site === "routinesite") continue;
    const maj = v.maj || new Date().toISOString();
    for (const [k, val] of Object.entries(v.valeurs)) {
      const t = MUR_TITRES[k];
      let m;
      if ((m = /^famzak:quiz:(.+)$/.exec(k))) {
        if (!val || !(val.total >= 3) || val.score !== val.total) continue;
        ajouter(e, v.classe, v.code, site, "quiz:" + m[1], t ? `a fait un sans-faute au quiz « ${t.titre} »` : "a fait un sans-faute à un quiz", `[[${val.score}/${val.total}]]`, val.date || maj);
      } else if (/^qflash-/.test(k) && t && t.n) {
        const ok = val && typeof val === "object" ? Object.values(val).filter(x => x === "ok").length : 0;
        if (t.n >= 5 && ok >= t.n) ajouter(e, v.classe, v.code, site, "fiches:" + k, `connaît maintenant les ${t.n} fiches « ${t.titre} »`, "Toutes marquées « Je la connais »", maj, true);
      } else if (k === "famzak:iasite:etapes-vues") {
        if (Array.isArray(val) && val.length >= 15) ajouter(e, v.classe, v.code, site, "etapes:15", "a parcouru les 15 étapes du micro-GPT", "Construire une IA de zéro", maj, true);
      } else if ((m = /^famzak:morpho:(.+)$/.exec(k)) && m[1] !== "mode-devine") {
        if (!val || !val.fini) continue;
        const d = Object.values(val.devine || {}), justes = d.filter(Boolean).length;
        ajouter(e, v.classe, v.code, site, "projet:" + m[1], `a terminé le projet « ${t ? t.titre : m[1]} »${d.length ? ` en devinant juste ${justes} fois sur ${d.length}` : ""}`, "Projet concret", maj);
      } else if (k === "famzak:mathsite:ffjm" && val && typeof val === "object") {
        for (const [f, r] of Object.entries(val)) {
          if (!r || !r.ok) continue;
          const sec = Number(r.sec) || 0, duree = sec ? (Math.floor(sec / 60) ? Math.floor(sec / 60) + " min " : "") + (sec % 60) + " s" : "";
          const tf = MUR_TITRES["ffjm:" + f];
          ajouter(e, v.classe, v.code, site, "ffjm:" + f, tf ? `a réussi le défi chronométré « ${tf.titre} »` : "a réussi un défi chronométré FFJM", duree ? `En [[${duree}]]` : "Concours FFJM", r.date || maj);
        }
      }
    }
  }
  // Ajout au fil : prénom obligatoire, sans doublon avec ce qui y est déjà
  const fil = await murFil(env);
  const deja = new Set(fil.map(r => r.cle ? `${r.e}:${r.site}:${r.cle}` : `${r.e}:${r.site}:${r.texte}`));
  const vus = await murDejaRattrapees(env);
  let ajoutes = 0;
  for (const x of cands) {
    const id1 = `${x.e}:${x.site}:${x.cle}`;
    if (deja.has(id1) || deja.has(`${x.e}:${x.site}:${x.texte}`) || vus.has(id1)) continue;
    const prenom = await prenomDe(env, x.classe, x.code);
    if (!prenom) continue;
    deja.add(id1); vus.add(id1); ajoutes++;
    fil.push({ id: Date.parse(x.date).toString(36) + Math.random().toString(36).slice(2, 7), e: x.e, prenom, site: x.site, cle: x.cle, texte: murTexte(x.texte, 180), detail: murTexte(x.detail, 120), date: murDate(x.date) || new Date().toISOString(), bravos: [], cache: false, grande: x.grande });
  }
  if (ajoutes) {
    await murEcrireFil(env, fil);
    await env.SUIVI.put("murvu:rattrapage", JSON.stringify([...vus]));
  }
  return ajoutes;
}
