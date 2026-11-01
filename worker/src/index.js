// Version : 1.0
// Worker « routinesite-suivi » : suivi des jours faits par élève pour RoutineSite.
//
// Routes (toutes en POST, JSON) :
//   /valider            { classe, code, routine, jour }      -> enregistre le jour comme fait
//   /etat               { classe, code }                      -> jours faits par cet élève
//   /admin/etat         { motdepasse }                        -> jours faits de tous les élèves
//   /admin/reinitialiser{ motdepasse, empreinte, routine, jour|"tous" } -> remet à « non fait »
//
// Secret : ADMIN_PASSWORD (le même mot de passe enseignant que MathSite).
// Stockage KV « SUIVI » : clé  fait:<empreinte>:<routine>:<jour>  ->  { code, classe, date }

const ROUTINES = ["probabilites", "technologie"];
const CLASSES = ["5e", "seconde"];
const MAX_ECHECS = 10;          // tentatives de mot de passe avant blocage
const BLOCAGE_SECONDES = 900;   // durée du blocage (15 min)

export default {
  async fetch(request, env) {
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
