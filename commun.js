// Code partagé par les pages du site : empreintes des codes, session, adresse de réception.
// Empreintes SHA-256 des codes, calculées comme dans MathSite : sel + classe + ":" + code.
// Les codes eux-mêmes ne figurent nulle part (ce sont les mêmes que sur MathSite).
const SEL = "mathsite:";
const CLASSES = [
  { key: "5e", nom: "5e", niveau: "Collège" },
  { key: "seconde", nom: "Seconde", niveau: "Lycée" }
];
const EMPREINTES = {
  "5e": ["489c1aecd78964bf6e285c1425430f40b6a14f6cc4ba1f9ffd2bc2f48b203a24"],
  "seconde": ["8f29042f5b26a90537a0cec56715742c14a0e793fd534ed7b5478796565bc56f"]
};
const STOCKAGE = "routinesite:code";
// Adresse qui reçoit les réponses des élèves (assemblée ici pour ne pas figurer d'un bloc dans le code).
const ADRESSE_ENSEIGNANT = ["az.autres", "gmail.com"].join("@");

const normaliser = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function sha256(message) { // SHA-256 en JavaScript pur, si crypto.subtle est indisponible (file://)
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  const H = [], K = [];
  const frac = x => ((x - Math.floor(x)) * 4294967296) >>> 0;
  const premier = p => { for (let d = 2; d * d <= p; d++) if (p % d === 0) return false; return true; };
  for (let n = 2, i = 0; i < 64; n++) {
    if (!premier(n)) continue;
    if (i < 8) H[i] = frac(Math.pow(n, 1 / 2));
    K[i++] = frac(Math.pow(n, 1 / 3));
  }
  const o = Array.from(new TextEncoder().encode(message));
  const bits = o.length * 8;
  o.push(0x80);
  while (o.length % 64 !== 56) o.push(0);
  const haut = Math.floor(bits / 4294967296), bas = bits >>> 0;
  for (let i = 3; i >= 0; i--) o.push((haut >>> (i * 8)) & 255);
  for (let i = 3; i >= 0; i--) o.push((bas >>> (i * 8)) & 255);
  for (let off = 0; off < o.length; off += 64) {
    const w = new Array(64);
    for (let i = 0; i < 16; i++) { const j = off + 4 * i; w[i] = ((o[j] << 24) | (o[j + 1] << 16) | (o[j + 2] << 8) | o[j + 3]) >>> 0; }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, h].forEach((v, i) => { H[i] = (H[i] + v) >>> 0; });
  }
  return H.map(x => x.toString(16).padStart(8, "0")).join("");
}
async function empreinte(code, classe) {
  const texte = `${SEL}${classe}:${normaliser(code)}`;
  if (window.crypto && crypto.subtle) {
    try {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texte));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
    } catch (e) { /* repli ci-dessous */ }
  }
  return sha256(texte);
}
async function codeValable(classe, code) {
  return (EMPREINTES[classe] || []).includes(await empreinte(code, classe));
}
async function classeDuCode(code) {
  for (const k of CLASSES) if (await codeValable(k.key, code)) return k.key;
  return null;
}
const nomClasse = key => (CLASSES.find(k => k.key === key) || {}).nom || key;

// Une seule session mémorisée : { classe, code }.
function lireSession() {
  // Le code n'est gardé que pour l'onglet ouvert (sessionStorage) : fermer la page oblige à le ressaisir.
  try { localStorage.removeItem(STOCKAGE); } catch (e) {}   // efface un ancien code mémorisé durablement
  try { return JSON.parse(sessionStorage.getItem(STOCKAGE)) || null; } catch (e) { return null; }
}
function ecrireSession(s) {
  try { s ? sessionStorage.setItem(STOCKAGE, JSON.stringify(s)) : sessionStorage.removeItem(STOCKAGE); } catch (e) {}
}
// Session valide (code toujours reconnu) ou null.
async function sessionValide() {
  const s = lireSession();
  if (s && !(await codeValable(s.classe, s.code))) { ecrireSession(null); return null; }
  return s;
}

// Jours terminés : mémorisés sur l'appareil, par code et par routine.
function cleJours(routine, code) { return `routinesite:jours:${routine}:${normaliser(code)}`; }
function lireJours(routine, code) {
  try { return JSON.parse(localStorage.getItem(cleJours(routine, code))) || []; } catch (e) { return []; }
}
function ajouterJour(routine, code, n) {
  const j = lireJours(routine, code);
  if (!j.includes(n)) j.push(n);
  try { localStorage.setItem(cleJours(routine, code), JSON.stringify(j.sort((a, b) => a - b))); } catch (e) {}
}

// ---------- Suivi des jours (Worker « routinesite-suivi ») ----------
// Adresse du Worker, à renseigner après son déploiement (voir worker/LISEZMOI.md),
// par exemple "https://routinesite-suivi.mon-compte.workers.dev". Vide : suivi local seulement.
const URL_SUIVI = "https://routinesite-suivi.mikhub-dev.workers.dev";
const CLE_ATTENTE = "routinesite:attente";

async function appelerSuivi(chemin, corps) {
  if (!URL_SUIVI) throw new Error("suivi non configuré");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(URL_SUIVI.replace(/\/+$/, "") + chemin, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps), signal: ctl.signal
    });
    const donnees = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(donnees.erreur || `Erreur ${r.status}`); e.statut = r.status; throw e; }
    return donnees;
  } finally { clearTimeout(t); }
}

function lireAttente() { try { return JSON.parse(localStorage.getItem(CLE_ATTENTE)) || []; } catch (e) { return []; } }
function ecrireAttente(l) { try { localStorage.setItem(CLE_ATTENTE, JSON.stringify(l)); } catch (e) {} }

// Enregistre un jour fait auprès du Worker ; si le Worker est injoignable, le jour reste en attente.
async function enregistrerJour(session, routine, n) {
  ajouterJour(routine, session.code, n);
  if (!URL_SUIVI) return;
  try {
    await appelerSuivi("/valider", { classe: session.classe, code: session.code, routine, jour: n });
  } catch (e) {
    if (e.statut) return; // refus du serveur (code, jour) : inutile de réessayer
    const l = lireAttente();
    if (!l.some(x => x.routine === routine && x.n === n && x.code === session.code)) l.push({ classe: session.classe, code: session.code, routine, n });
    ecrireAttente(l);
  }
}

// Aligne les jours de l'appareil sur ceux du Worker (la remise à « non fait » par l'enseignant s'y applique).
async function synchroniserJours(session) {
  if (!URL_SUIVI) return false;
  try {
    const attente = lireAttente();
    for (const x of attente) { try { await appelerSuivi("/valider", { classe: x.classe, code: x.code, routine: x.routine, jour: x.n }); } catch (e) { if (!e.statut) throw e; } }
    if (attente.length) ecrireAttente([]);
    const { jours } = await appelerSuivi("/etat", { classe: session.classe, code: session.code });
    for (const routine of Object.keys(jours)) {
      try { localStorage.setItem(cleJours(routine, session.code), JSON.stringify(jours[routine])); } catch (e) {}
    }
    return true;
  } catch (e) { return false; }
}
