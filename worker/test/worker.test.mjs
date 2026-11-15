// Tests du Worker (node worker/test/worker.test.mjs)
import assert from "node:assert/strict";
import worker from "../src/index.js";

const kv = new Map();
const env = {
  ALLOWED_ORIGINS: "https://mikhub-dev.github.io", SEL: "mathsite:", ADMIN_PASSWORD: "secret-test",
  EMPREINTES: '{"5e":["489c1aecd78964bf6e285c1425430f40b6a14f6cc4ba1f9ffd2bc2f48b203a24"],"seconde":["8f29042f5b26a90537a0cec56715742c14a0e793fd534ed7b5478796565bc56f"]}',
  SUIVI: {
    async get(k) { return kv.get(k) ?? null; },
    async put(k, v) { kv.set(k, v); },
    async delete(k) { kv.delete(k); },
    async list({ prefix }) { return { keys: [...kv.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; }
  }
};
const appel = async (chemin, corps, origine = "https://mikhub-dev.github.io") => {
  const r = await worker.fetch(new Request("https://w.example" + chemin, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origine, "CF-Connecting-IP": "1.2.3.4" }, body: JSON.stringify(corps)
  }), env);
  return { statut: r.status, corps: await r.json() };
};

let r = await appel("/valider", { classe: "5e", code: "marcza", routine: "probabilites", jour: 3 });
assert.equal(r.statut, 200); assert.deepEqual(r.corps.jours.probabilites, [3]);
r = await appel("/valider", { classe: "5e", code: "MARCZA", routine: "technologie", jour: 12 });
assert.deepEqual(r.corps.jours, { probabilites: [3], technologie: [12], parole: [] });
r = await appel("/valider", { classe: "seconde", code: "MARCZA", routine: "probabilites", jour: 1 });
assert.equal(r.statut, 403, "un code d'une autre classe est refusé");
r = await appel("/valider", { classe: "seconde", code: "MIKAZA", routine: "probabilites", jour: 101 });
assert.equal(r.statut, 400, "jour hors limites");
r = await appel("/valider", { classe: "seconde", code: "MIKAZA", routine: "probabilites", jour: 1 });
assert.equal(r.statut, 200);
r = await appel("/etat", { classe: "5e", code: "MARCZA" });
assert.deepEqual(r.corps.jours, { probabilites: [3], technologie: [12], parole: [] });
r = await appel("/valider", { classe: "5e", code: "MARCZA", routine: "probabilites", jour: 3 }, "https://autre.example");
assert.equal(r.statut, 403, "origine non autorisée");

r = await appel("/admin/etat", { motdepasse: "faux" }); assert.equal(r.statut, 401);
r = await appel("/admin/etat", { motdepasse: "secret-test" });
assert.equal(r.statut, 200); assert.equal(r.corps.eleves.length, 2);
const marcza = r.corps.eleves.find(e => e.code === "MARCZA");
assert.equal(marcza.classe, "5e"); assert.deepEqual(marcza.jours.probabilites.map(j => j.n), [3]);
assert.ok(!JSON.stringify(r.corps).includes("secret-test"));

r = await appel("/admin/reinitialiser", { motdepasse: "faux", empreinte: marcza.empreinte, routine: "probabilites", jour: 3 });
assert.equal(r.statut, 401, "sans mot de passe, pas de remise à zéro");
r = await appel("/admin/reinitialiser", { motdepasse: "secret-test", empreinte: marcza.empreinte, routine: "probabilites", jour: 3 });
assert.deepEqual(r.corps, { ok: true, supprimes: 1 });
r = await appel("/etat", { classe: "5e", code: "MARCZA" });
assert.deepEqual(r.corps.jours, { probabilites: [], technologie: [12], parole: [] }, "le jour est de nouveau « non fait »");
r = await appel("/admin/reinitialiser", { motdepasse: "secret-test", empreinte: marcza.empreinte, routine: "technologie", jour: "tous" });
assert.equal(r.corps.supprimes, 1);

// ---------- Fluidité verbale ----------
const ex1 = { texte: "lanterne rouge soleil", aParle: true, reconnue: true, duree: 60, mots: 31, differents: 29, delai: 2, silenceFinal: 1.7, pauses: 23, blancs: 7, plusLongue: 5.6, totalPauses: 44.1, remplissage: 0, auto: { rythme: 12, continuite: 6, richesse: 10, liens: null } };
r = await appel("/parole/enregistrer", { classe: "seconde", code: "MIKAZA", jour: 1, seance: "1763211000000", bilan: "BILAN JOUR 1", ex1 });
assert.equal(r.statut, 200, "séance enregistrée");
r = await appel("/parole/enregistrer", { classe: "seconde", code: "MARCZA", jour: 1, seance: "1763211000000", ex1 });
assert.equal(r.statut, 403, "code d'une autre classe refusé");
r = await appel("/parole/enregistrer", { classe: "seconde", code: "MIKAZA", jour: 0, seance: "1763211000000", ex1 });
assert.equal(r.statut, 400, "jour invalide");
r = await appel("/parole/enregistrer", { classe: "seconde", code: "MIKAZA", jour: 1, seance: "abc", ex1 });
assert.equal(r.statut, 400, "séance invalide");
r = await appel("/parole/enregistrer", { classe: "seconde", code: "MIKAZA", jour: 1, seance: "1763211000000", bilan: "BILAN JOUR 1 (mis à jour)", ex1, ex2: { texte: "une horloge", aParle: true, duree: 120, mots: 250, differents: 150, auto: { continuite: 10 } } });
assert.equal(r.statut, 200, "la même séance est mise à jour, pas dupliquée");
r = await appel("/parole/etat", { classe: "seconde", code: "mikaza" });
assert.equal(r.corps.seances.length, 1); assert.equal(r.corps.seances[0].ex1.blancs, 7); assert.equal(r.corps.seances[0].ex2.mots, 250);
assert.ok(!("bilan" in r.corps.seances[0]), "le texte complet du bilan n'est pas renvoyé à l'élève");
r = await appel("/parole/etat", { classe: "5e", code: "MARCZA" });
assert.equal(r.corps.seances.length, 0, "chaque élève ne voit que ses séances");
r = await appel("/valider", { classe: "seconde", code: "MIKAZA", routine: "parole", jour: 1 });
assert.equal(r.statut, 200); assert.deepEqual(r.corps.jours.parole, [1]);

r = await appel("/admin/parole", { motdepasse: "faux" }); assert.equal(r.statut, 401);
r = await appel("/admin/parole", { motdepasse: "secret-test" });
assert.equal(r.statut, 200); assert.equal(r.corps.seances.length, 1);
const cleSeance = r.corps.seances[0].cle;
assert.match(r.corps.seances[0].bilan, /mis à jour/);
r = await appel("/admin/parole/noter", { motdepasse: "secret-test", cle: "parole:x", notes: {} }); assert.equal(r.statut, 400);
r = await appel("/admin/parole/noter", { motdepasse: "faux", cle: cleSeance, notes: {} }); assert.equal(r.statut, 401);
r = await appel("/admin/parole/noter", { motdepasse: "secret-test", cle: cleSeance, retour: "Bon début.",
  notes: { ex1: { rythme: 9, continuite: 6, richesse: 10, liens: 99 }, ex2: { continuite: 10, debit: "x", structure: 12, voix: 7 } } });
assert.equal(r.statut, 200);
assert.equal(r.corps.notes.ex1.liens, 10, "une note est bornée à son maximum");
assert.equal(r.corps.notes.ex2.debit, null, "une valeur non numérique devient « non noté »");
r = await appel("/parole/etat", { classe: "seconde", code: "MIKAZA" });
assert.equal(r.corps.seances[0].notes.ex1.rythme, 9); assert.equal(r.corps.seances[0].retour, "Bon début.");
r = await appel("/parole/enregistrer", { classe: "seconde", code: "MIKAZA", jour: 1, seance: "1763211000000", bilan: "BILAN encore mis à jour", ex1 });
r = await appel("/parole/etat", { classe: "seconde", code: "MIKAZA" });
assert.equal(r.corps.seances[0].notes.ex1.rythme, 9, "réenregistrer une séance ne perd pas les notes");
r = await appel("/admin/parole/supprimer", { motdepasse: "secret-test", cle: cleSeance });
assert.deepEqual(r.corps, { ok: true, supprimees: 1 });
r = await appel("/parole/etat", { classe: "seconde", code: "MIKAZA" }); assert.equal(r.corps.seances.length, 0);

// ---------- Archivage audio (dépôt GitHub privé) ----------
const appelsGitHub = []; let depotEstPrive = true; let reponsePut = 201;
globalThis.fetch = async (url, opt = {}) => {
  appelsGitHub.push({ url: String(url), methode: opt.method, corps: opt.body ? JSON.parse(opt.body) : null, auth: opt.headers && opt.headers.Authorization });
  if (opt.method === "GET") return new Response(JSON.stringify({ private: depotEstPrive }), { status: 200 });
  return new Response(JSON.stringify({ content: {} }), { status: reponsePut });
};
const audioB64 = Buffer.from("x".repeat(3000)).toString("base64");
const enreg = { classe: "seconde", code: "MIKAZA", jour: 1, seance: "1763299000000", bilan: "B", ex1 };
const audio = (extra = {}) => ({ classe: "seconde", code: "MIKAZA", jour: 1, seance: "1763299000000", exo: "ex1", mime: "audio/webm;codecs=opus", duree: 60, audio: audioB64, ...extra });
await appel("/parole/enregistrer", enreg);

r = await appel("/parole/audio", audio());
assert.equal(r.statut, 503, "archivage non configuré : refusé proprement");
env.GITHUB_TOKEN = "ghp_test"; env.AUDIO_REPO = "MikHub-dev/RoutineSite-audio";
r = await appel("/parole/audio", audio({ code: "MARCZA" })); assert.equal(r.statut, 403, "code d'une autre classe refusé");
r = await appel("/parole/audio", audio({ mime: "text/html" })); assert.equal(r.statut, 400, "format non audio refusé");
r = await appel("/parole/audio", audio({ exo: "ex9" })); assert.equal(r.statut, 400, "exercice invalide");
r = await appel("/parole/audio", audio({ audio: "pas du base64 !!" })); assert.equal(r.statut, 400);
r = await appel("/parole/audio", audio({ audio: "A".repeat(4600000) })); assert.equal(r.statut, 413, "fichier trop gros");
assert.equal(appelsGitHub.length, 0, "aucun appel GitHub tant que la demande est invalide");

depotEstPrive = false;
r = await appel("/parole/audio", audio());
assert.equal(r.statut, 503, "dépôt PUBLIC : l'archivage est refusé");
assert.ok(!appelsGitHub.some(a => a.methode === "PUT"), "rien n'est écrit dans un dépôt public");

depotEstPrive = true;
r = await appel("/parole/audio", audio());
assert.equal(r.statut, 200);
const put = appelsGitHub.find(a => a.methode === "PUT");
assert.match(put.url, /api\.github\.com\/repos\/MikHub-dev\/RoutineSite-audio\/contents\/audio\/seconde\/MIKAZA\/jour-001\/1763299000000-ex1-\d{8}T\d{6}\.webm$/);
assert.equal(put.corps.content, audioB64); assert.equal(put.auth, "Bearer ghp_test");
r = await appel("/parole/etat", { classe: "seconde", code: "MIKAZA" });
assert.ok(!JSON.stringify(r.corps).includes("RoutineSite-audio"), "l'élève ne voit pas l'emplacement de l'archive");
r = await appel("/admin/parole", { motdepasse: "secret-test" });
const sa = r.corps.seances.find(s => s.seance === "1763299000000");
assert.equal(sa.audios.length, 1); assert.equal(sa.audios[0].depot, "MikHub-dev/RoutineSite-audio"); assert.equal(sa.audios[0].exo, "ex1");
await appel("/parole/enregistrer", { ...enreg, bilan: "B2" });
r = await appel("/admin/parole", { motdepasse: "secret-test" });
assert.equal(r.corps.seances.find(s => s.seance === "1763299000000").audios.length, 1, "réenregistrer la séance garde les références audio");
reponsePut = 422; r = await appel("/parole/audio", audio()); assert.equal(r.statut, 502, "échec GitHub signalé");
await appel("/admin/parole/supprimer", { motdepasse: "secret-test", cle: sa.cle });

for (let i = 0; i < 10; i++) await appel("/admin/etat", { motdepasse: "faux" });
r = await appel("/admin/etat", { motdepasse: "secret-test" });
assert.equal(r.statut, 429, "blocage après trop d'échecs");
console.log("Worker : tous les tests passent");
