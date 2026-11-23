// Tests de la progression des jeux (node worker/test/progres.test.mjs)
import assert from "node:assert/strict";
import worker from "../src/index.js";

const kv = new Map();
const env = {
  ALLOWED_ORIGINS: "https://mikhub-dev.github.io", SEL: "mathsite:", ADMIN_PASSWORD: "secret-test",
  EMPREINTES: '{"5e":["489c1aecd78964bf6e285c1425430f40b6a14f6cc4ba1f9ffd2bc2f48b203a24"],"seconde":["8f29042f5b26a90537a0cec56715742c14a0e793fd534ed7b5478796565bc56f"],"famille":["8fcce93c08b4a5eeac2572ca661b19db7077c73c344e66b0c4a7915d6d9f5729"]}',
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

let r = await appel("/progres/lire", { classe: "5e", code: "MARCZA" });
assert.equal(r.statut, 200); assert.deepEqual(r.corps.progres, {}); assert.deepEqual(r.corps.dates, []);
r = await appel("/progres/ecrire", { classe: "5e", code: "MARCZA", site: "iasite", valeurs: { "quiz:iasite:donnees": { score: 2, total: 3 }, "iasite:etapes-vues": [1, 3] } });
assert.equal(r.statut, 200);
r = await appel("/progres/ecrire", { classe: "5e", code: "MARCZA", site: "iasite", valeurs: { "quiz:iasite:donnees": { score: 3, total: 3 }, "iasite:etapes-vues": null } });
r = await appel("/progres/lire", { classe: "5e", code: "MARCZA" });
assert.deepEqual(r.corps.progres, { iasite: { "quiz:iasite:donnees": { score: 3, total: 3 } } }, "fusion et effacement");
r = await appel("/progres/lire", { classe: "seconde", code: "MIKAZA" });
assert.deepEqual(r.corps.progres, {}, "chaque code a sa progression");
r = await appel("/progres/ecrire", { classe: "seconde", code: "MARCZA", site: "iasite", valeurs: {} });
assert.equal(r.statut, 403, "code d'une autre classe refusé");
r = await appel("/progres/ecrire", { classe: "5e", code: "MARCZA", site: "autre", valeurs: {} });
assert.equal(r.statut, 400, "site inconnu");
r = await appel("/progres/ecrire", { classe: "5e", code: "MARCZA", site: "iasite", valeurs: { x: "a".repeat(5000) } });
assert.equal(r.statut, 400, "valeur trop longue");
await appel("/valider", { classe: "5e", code: "MARCZA", routine: "probabilites", jour: 4 });
r = await appel("/progres/lire", { classe: "5e", code: "MARCZA" });
assert.equal(r.corps.dates.length, 1, "dates des jours faits");
r = await appel("/admin/progres", { motdepasse: "faux" }); assert.equal(r.statut, 401);
r = await appel("/admin/progres", { motdepasse: "secret-test" });
assert.equal(r.corps.eleves.length, 1); assert.equal(r.corps.eleves[0].code, "MARCZA");
// Classe « Famille » (code de test, pas un vrai code)
r = await appel("/progres/lire", { classe: "famille", code: "testfamille" }); assert.equal(r.statut, 200);
r = await appel("/progres/lire", { classe: "famille", code: "MARCZA" }); assert.equal(r.statut, 403);
r = await appel("/progres/lire", { classe: "5e", code: "TESTFAMILLE" }); assert.equal(r.statut, 403);
console.log("progres.test.mjs : OK");
