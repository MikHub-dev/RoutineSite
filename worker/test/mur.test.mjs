// Tests du mur des réussites (node worker/test/mur.test.mjs). Codes et prénoms FICTIFS, fabriqués ici.
import assert from "node:assert/strict";
import worker from "../src/index.js";

const SEL = "mathsite:";
const hex = b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, "0")).join("");
const sha = async t => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)));
const b64 = u => Buffer.from(u).toString("base64");
async function chiffrer(prenom, code) {
  const k = await crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", new TextEncoder().encode("famzak-prenom:" + code)), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return b64(iv) + "." + b64(new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(prenom))));
}
const ELEVES = [["famille", "TESTAAAA", "ALICE"], ["famille", "TESTBBBB", "BRUNO"], ["5e", "TESTCCCC", null]];
const EMPREINTES = { "5e": [], seconde: [], famille: [] }, PRENOMS = {};
for (const [classe, code, prenom] of ELEVES) {
  const e = await sha(`${SEL}${classe}:${code}`);
  EMPREINTES[classe].push(e);
  if (prenom) PRENOMS[e] = await chiffrer(prenom, code);
}
const kv = new Map();
const env = {
  ALLOWED_ORIGINS: "https://mikhub-dev.github.io,https://famzak.github.io", SEL, ADMIN_PASSWORD: "secret-test",
  EMPREINTES: JSON.stringify(EMPREINTES), PRENOMS: JSON.stringify(PRENOMS),
  SUIVI: {
    async get(k) { return kv.get(k) ?? null; },
    async put(k, v) { kv.set(k, v); },
    async delete(k) { kv.delete(k); },
    async list({ prefix }) { return { keys: [...kv.keys()].filter(k => k.startsWith(prefix)).sort().map(name => ({ name })), list_complete: true }; }
  }
};
const appel = async (chemin, corps, origine = "https://mikhub-dev.github.io") => {
  const r = await worker.fetch(new Request("https://w.example" + chemin, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origine }, body: JSON.stringify(corps)
  }), env, { waitUntil() {} });
  return { statut: r.status, corps: await r.json() };
};
const A = { classe: "famille", code: "TESTAAAA" }, B = { classe: "famille", code: "testbbbb" }, C = { classe: "5e", code: "TESTCCCC" };

// Publication par un site
let r = await appel("/mur/publier", { ...A, site: "culturegsite", cle: "quiz:culturegsite:ses-1", texte: "a fait un sans-faute au quiz « Lire les comptes »", detail: "10/10" });
assert.equal(r.statut, 200); assert.ok(r.corps.id);
r = await appel("/mur/publier", { ...A, site: "culturegsite", cle: "quiz:culturegsite:ses-1", texte: "encore" });
assert.equal(r.corps.deja, true, "une seule fois par clé");
r = await appel("/mur/publier", { ...A, site: "routinesite", cle: "x", texte: "triche" });
assert.equal(r.statut, 400, "RoutineSite : seulement par le serveur");
r = await appel("/mur/publier", { classe: "famille", code: "INCONNU1", site: "iasite", cle: "x", texte: "bonjour" });
assert.equal(r.statut, 403, "code inconnu refusé");
r = await appel("/mur/publier", { ...C, site: "iasite", cle: "quiz:x", texte: "a fini le quiz" });
assert.equal(r.corps.id, null, "sans prénom connu : rien sur le mur");
r = await appel("/mur/publier", { ...B, site: "iasite", cle: "quiz:<b>", texte: "<script>alert(1)</script> ok" });
assert.equal(r.statut, 400, "clé invalide");
r = await appel("/mur/publier", { ...B, site: "iasite", cle: "quiz:iasite:attention", texte: "<b>a maîtrisé</b> le parcours" });
assert.ok(r.corps.id);

// Lecture : prénoms seulement, jamais de code ni d'empreinte
r = await appel("/mur/lire", B, "https://famzak.github.io");
assert.equal(r.statut, 200);
assert.equal(r.corps.moi, "BRUNO");
assert.equal(r.corps.reussites.length, 2);
assert.equal(r.corps.reussites[0].prenom, "BRUNO"); assert.equal(r.corps.reussites[0].moi, true);
assert.ok(!r.corps.reussites[0].texte.includes("<"), "pas de balise");
const brut = JSON.stringify(r.corps);
for (const [classe, code] of ELEVES) { assert.ok(!brut.toUpperCase().includes(code), "aucun code ZF"); }
for (const l of Object.values(EMPREINTES)) for (const e of l) assert.ok(!brut.includes(e), "aucune empreinte");

// Bravo
const idA = r.corps.reussites[1].id;
r = await appel("/mur/bravo", { ...B, id: idA }); assert.equal(r.corps.bravos, 1); assert.equal(r.corps.jaiDitBravo, true);
r = await appel("/mur/bravo", { ...B, id: idA }); assert.equal(r.corps.bravos, 0);
await appel("/mur/bravo", { ...B, id: idA });
// Cacher : seulement l'auteur
r = await appel("/mur/cacher", { ...B, id: idA }); assert.equal(r.statut, 403);
r = await appel("/mur/cacher", { ...A, id: idA }); assert.equal(r.corps.cache, true);
r = await appel("/mur/lire", B); assert.equal(r.corps.reussites.length, 1, "réussite cachée aux autres");
r = await appel("/mur/lire", A); assert.equal(r.corps.reussites.length, 2, "l'auteur la voit encore"); assert.equal(r.corps.reussites[1].cache, true);
await appel("/mur/cacher", { ...A, id: idA, cache: false });

// RoutineSite : jours faits -> premier pas, module terminé, palier 10 jours
for (let j = 1; j <= 10; j++) await appel("/valider", { ...A, routine: "probabilites", jour: j });
r = await appel("/mur/lire", A);
const textes = r.corps.reussites.filter(x => x.site === "routinesite").map(x => x.texte);
assert.ok(textes.some(t => t.includes("Premier pas")), "premier pas");
assert.ok(textes.some(t => t.includes("🥉 10 jours")), "palier 10 jours");
assert.ok(textes.some(t => t.includes("module 1 « Le langage des probabilités »")), "module fini");
assert.equal(textes.filter(t => t.includes("module")).length, 1);
// Série : tous ces jours sont faits aujourd'hui -> 1 jour d'affilée
const sA = r.corps.series.find(s => s.prenom === "ALICE"); assert.equal(sA.jours, 1); assert.equal(sA.moi, true);
assert.ok(r.corps.defi.fait >= 4 && r.corps.defi.but === 25);
assert.ok(r.corps.mois.parSite.routinesite >= 3);
// Série de 3 jours (dates des jours précédents simulées)
const empA = EMPREINTES.famille[0];
const auj = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const jMoins = n => { const d = new Date(auj + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
kv.set(`serie:${empA}`, JSON.stringify({ prenom: "ALICE", dates: [jMoins(2), jMoins(1)] }));
await appel("/valider", { ...A, routine: "technologie", jour: 1 });
r = await appel("/mur/lire", A);
assert.ok(r.corps.reussites.some(x => x.texte.includes("Série de 3 jours")), "badge série");
assert.equal(r.corps.series.find(s => s.prenom === "ALICE").jours, 3);

// Rattrapage des réussites passées (une seule fois, à leur date d'origine)
const empB = EMPREINTES.famille[1];
for (let j = 1; j <= 10; j++) kv.set(`fait:${empB}:technologie:${j}`, JSON.stringify({ code: "TESTBBBB", classe: "famille", date: `2026-10-${String(j).padStart(2, "0")}T17:00:00Z` }));
kv.set(`rep:${empB}:technologie:5:1700000000000`, JSON.stringify({ code: "TESTBBBB", classe: "famille", routine: "technologie", jour: 5, statut: "corrige", correction: { justes: 7, total: 8 }, corrigeLe: "2026-10-06T08:00:00Z" }));
kv.set(`prog:${empB}:morphosite`, JSON.stringify({ code: "TESTBBBB", classe: "famille", maj: "2026-11-02T10:00:00Z", valeurs: { "famzak:morpho:06-drone": { vues: [1], devine: { a: true, b: false }, fini: true }, "famzak:morpho:mode-devine": "oui" } }));
kv.set(`prog:${empB}:iasite`, JSON.stringify({ code: "TESTBBBB", classe: "famille", maj: "2026-11-03T10:00:00Z", valeurs: { "famzak:quiz:iasite:fondations": { score: 3, total: 3, date: "2026-11-03" }, "famzak:quiz:iasite:donnees": { score: 2, total: 3 } } }));
kv.set(`prog:${empB}:mathsite`, JSON.stringify({ code: "TESTBBBB", classe: "famille", maj: "2026-11-04T10:00:00Z", valeurs: { "famzak:mathsite:ffjm": { "ffjm-2024-quarts-fiche-11": { ok: true, sec: 95, date: "2026-11-04" }, "x": { ok: false } } } }));
kv.delete("mur:rattrapage");
const avant = JSON.parse(kv.get("mur:fil")).length;
r = await appel("/mur/lire", { ...B, limite: 500 });
const rat = r.corps.reussites.filter(x => x.prenom === "BRUNO");
const t = rat.map(x => x.texte).join(" | ");
assert.ok(t.includes("Premier pas") && t.includes("🥉 10 jours") && t.includes("module 1 « L'ordinateur »"), "jours et module : " + t);
assert.ok(t.includes("Série de 3 jours") && t.includes("Série de 7 jours"), "séries passées");
assert.ok(t.includes("[[7/8]] au jour 5"), "correction");
assert.ok(t.includes("a terminé le projet « Construire un drone » en devinant juste 1 fois sur 2"), "projet Morpho titré");
assert.ok(t.includes("sans-faute au quiz « Fondations »") && !t.includes("2/3"), "quiz");
assert.ok(t.includes("défi chronométré « Drôle de calcul »"), "FFJM titré");
const mod = rat.find(x => x.texte.includes("module 1"));
assert.equal(mod.date, "2026-10-10T17:00:00.000Z", "date d'origine");
const n1 = JSON.parse(kv.get("mur:fil")).length;
kv.delete("mur:rattrapage");
await appel("/mur/lire", B);
assert.equal(JSON.parse(kv.get("mur:fil")).length, n1, "pas de doublon si le rattrapage repasse");
r = await appel("/mur/publier", { ...B, site: "iasite", cle: "quiz:iasite:fondations", texte: "a fait un sans-faute" });
assert.equal(r.corps.deja, true, "réussite rattrapée : pas republiée en direct");
r = await appel("/mur/publier", { ...B, site: "mathsite", cle: "eval:x", texte: "a obtenu [[12/20]]", date: "2026-09-15" });
assert.equal(JSON.parse(kv.get("mur:fil")).find(x => x.id === r.corps.id).date, "2026-09-15T12:00:00.000Z", "date d'évaluation acceptée");
r = await appel("/mur/publier", { ...B, site: "mathsite", cle: "eval:y", texte: "a obtenu [[12/20]]", date: "2099-01-01" });
assert.ok(Date.parse(JSON.parse(kv.get("mur:fil")).find(x => x.id === r.corps.id).date) <= Date.now(), "date future refusée");
assert.ok(n1 > avant);
console.log("mur.test.mjs : OK");
