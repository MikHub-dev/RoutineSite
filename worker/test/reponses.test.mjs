// Tests des réponses écrites corrigées par Claude (node worker/test/reponses.test.mjs)
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
const appel = async (chemin, corps) => {
  const r = await worker.fetch(new Request("https://w.example" + chemin, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://mikhub-dev.github.io", "CF-Connecting-IP": "1.2.3.4" }, body: JSON.stringify(corps)
  }), env);
  return { statut: r.status, corps: await r.json() };
};

// Faux GitHub : un dépôt privé dont les fichiers sont en mémoire ; un PUT sans sha sur un fichier existant est refusé (422).
const depot = new Map(); let sha = 0; let prive = true; const puts = [];
globalThis.fetch = async (url, opt = {}) => {
  const p = decodeURIComponent(new URL(String(url)).pathname); const m = opt.method || "GET";
  const rep = (corps, statut = 200) => new Response(JSON.stringify(corps), { status: statut });
  let x;
  if (/^\/repos\/[^/]+\/[^/]+$/.test(p)) return rep({ private: prive });
  if ((x = p.match(/^\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/))) {
    const chemin = x[1];
    if (m === "PUT") {
      const b = JSON.parse(opt.body);
      if (depot.has(chemin) && b.sha !== depot.get(chemin).sha) return rep({}, 422);
      depot.set(chemin, { content: b.content, sha: "s" + (++sha) }); puts.push(chemin);
      return rep({ content: {} }, 201);
    }
    if (depot.has(chemin)) return rep({ type: "file", path: chemin, sha: depot.get(chemin).sha, content: depot.get(chemin).content });
    return rep({}, 404);
  }
  return rep({}, 404);
};
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64");
const lireDepot = chemin => JSON.parse(Buffer.from(depot.get(chemin).content, "base64").toString());

const base = { classe: "5e", code: "marcza", routine: "probabilites", jour: 4, envoi: "1795300000000", reponses: ["1/ 1/8\n2/ 1/3", "oui", "non"] };

// Sans dépôt configuré : l'envoi est gardé, le jour est validé, la correction n'est pas possible.
let r = await appel("/reponses/envoyer", base);
assert.equal(r.statut, 200); assert.equal(r.corps.envoi.statut, "non_configure");
r = await appel("/etat", { classe: "5e", code: "MARCZA" }); assert.deepEqual(r.corps.jours.probabilites, [4], "l'envoi valide le jour");
kv.clear();

env.GITHUB_TOKEN = "ghp_test"; env.AUDIO_REPO = "MikHub-dev/RoutineSite-audio";
// Validations
r = await appel("/reponses/envoyer", { ...base, code: "INCONNU1" }); assert.equal(r.statut, 403);
r = await appel("/reponses/envoyer", { ...base, routine: "parole" }); assert.equal(r.statut, 400, "la parole n'est pas une routine écrite");
r = await appel("/reponses/envoyer", { ...base, jour: 101 }); assert.equal(r.statut, 400);
r = await appel("/reponses/envoyer", { ...base, envoi: "abc" }); assert.equal(r.statut, 400);
r = await appel("/reponses/envoyer", { ...base, reponses: ["a", " ", "c"] }); assert.equal(r.statut, 400, "réponse vide refusée");

// Dépôt public : rien n'est écrit
prive = false;
r = await appel("/reponses/envoyer", base);
assert.equal(r.corps.envoi.statut, "non_configure"); assert.equal(puts.length, 0, "rien n'est écrit dans un dépôt public");
kv.clear(); prive = true;

// Envoi normal : un seul dépôt, même si l'élève renvoie le même envoi (double clic, réseau)
r = await appel("/reponses/envoyer", base);
assert.equal(r.statut, 200); assert.equal(r.corps.envoi.statut, "en_cours"); assert.equal(r.corps.envoi.essai, 1);
const chemin = "reponses/5e/MARCZA/probabilites/jour-004/1795300000000.json";
assert.deepEqual(puts, [chemin]);
assert.deepEqual(lireDepot(chemin).reponses, base.reponses); assert.equal(lireDepot(chemin).relance, 0);
r = await appel("/reponses/envoyer", base);
assert.equal(r.corps.deja, true); assert.equal(puts.length, 1, "pas de second dépôt pour le même envoi, donc pas de seconde correction");
assert.ok(!JSON.stringify(r.corps).includes("RoutineSite-audio"), "l'élève ne voit pas l'emplacement du dépôt privé");

// Correction pas encore prête
r = await appel("/reponses/etat", { classe: "5e", code: "MARCZA", routine: "probabilites", jour: 4 });
assert.equal(r.corps.envois.length, 1); assert.equal(r.corps.envois[0].statut, "en_cours"); assert.equal(r.corps.envois[0].correction, null);

// La GitHub Action écrit la correction ; le Worker la récupère (après le délai minimal entre deux recherches)
const correction = { justes: 4, total: 5, questions: [{ exercice: 1, question: "1", verdict: "juste", commentaire: "Bravo" }, { exercice: 2, question: "1", verdict: "peut-être", commentaire: "x" }], texte: "Bonjour MARCZA,\n\nBravo…", modele: "claude" };
depot.set("corrections/5e/MARCZA/probabilites/jour-004/1795300000000.json", { content: b64({ statut: "ok", relance: 0, date: "2026-11-23T06:00:00Z", correction }), sha: "c1" });
const cle = `rep:489c1aecd78964bf6e285c1425430f40b6a14f6cc4ba1f9ffd2bc2f48b203a24:probabilites:4:1795300000000`;
const v = JSON.parse(kv.get(cle)); v.verifieLe = "2000-01-01T00:00:00Z"; kv.set(cle, JSON.stringify(v));
r = await appel("/reponses/etat", { classe: "5e", code: "MARCZA" });
const e = r.corps.envois[0];
assert.equal(e.statut, "corrige"); assert.equal(e.correction.justes, 4); assert.equal(e.correction.total, 5);
assert.match(e.correction.texte, /Bravo/); assert.equal(e.correction.questions[1].verdict, "faux", "verdict inconnu ramené à « faux »");

// Un autre élève ne voit pas cet envoi
r = await appel("/reponses/etat", { classe: "seconde", code: "MIKAZA" }); assert.equal(r.corps.envois.length, 0);

// Deuxième essai du même jour
r = await appel("/reponses/envoyer", { ...base, envoi: "1795300000999" }); assert.equal(r.corps.envoi.essai, 2);

// Enseignant : liste, modification, relance, suppression
r = await appel("/admin/reponses", { motdepasse: "faux" }); assert.equal(r.statut, 401);
r = await appel("/admin/reponses", { motdepasse: "secret-test" });
assert.equal(r.statut, 200); assert.equal(r.corps.envois.length, 2); assert.equal(r.corps.envois[0].correctionAuto.justes, 4);
r = await appel("/admin/reponses/modifier", { motdepasse: "secret-test", cle: "rep:x", texte: "t" }); assert.equal(r.statut, 400);
r = await appel("/admin/reponses/modifier", { motdepasse: "secret-test", cle, texte: "Texte revu", justes: 5, total: 5 });
assert.equal(r.statut, 200);
r = await appel("/reponses/etat", { classe: "5e", code: "MARCZA", routine: "probabilites", jour: 4 });
assert.equal(r.corps.envois[0].correction.texte, "Texte revu"); assert.equal(r.corps.envois[0].correction.justes, 5); assert.equal(r.corps.envois[0].valide, true);

r = await appel("/admin/reponses/relancer", { motdepasse: "secret-test", cle });
assert.equal(r.statut, 200); assert.equal(puts.filter(p => p === chemin).length, 2, "la relance met à jour le fichier (nouvelle correction)");
assert.equal(lireDepot(chemin).relance, 1);
const v2 = JSON.parse(kv.get(cle)); v2.verifieLe = "2000-01-01T00:00:00Z"; kv.set(cle, JSON.stringify(v2));
r = await appel("/reponses/etat", { classe: "5e", code: "MARCZA", routine: "probabilites", jour: 4 });
assert.equal(r.corps.envois[0].statut, "en_cours", "l'ancienne correction (relance 0) ne compte plus");
depot.set("corrections/5e/MARCZA/probabilites/jour-004/1795300000000.json", { content: b64({ statut: "echec", relance: 1, erreur: "quota" }), sha: "c2" });
const v3 = JSON.parse(kv.get(cle)); v3.verifieLe = "2000-01-01T00:00:00Z"; kv.set(cle, JSON.stringify(v3));
r = await appel("/reponses/etat", { classe: "5e", code: "MARCZA", routine: "probabilites", jour: 4 });
assert.equal(r.corps.envois[0].statut, "echec");

r = await appel("/admin/reponses/supprimer", { motdepasse: "secret-test", cle });
assert.deepEqual(r.corps, { ok: true, supprimes: 1 });

// Quota d'envois par jour
for (let i = 0; i < 25; i++) r = await appel("/reponses/envoyer", { ...base, envoi: String(1795400000000 + i) });
assert.equal(r.statut, 429, "au-delà du plafond quotidien, l'envoi est refusé");

console.log("Réponses écrites : tous les tests passent.");
