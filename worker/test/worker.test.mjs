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
assert.deepEqual(r.corps.jours, { probabilites: [3], technologie: [12] });
r = await appel("/valider", { classe: "seconde", code: "MARCZA", routine: "probabilites", jour: 1 });
assert.equal(r.statut, 403, "un code d'une autre classe est refusé");
r = await appel("/valider", { classe: "seconde", code: "MIKAZA", routine: "probabilites", jour: 101 });
assert.equal(r.statut, 400, "jour hors limites");
r = await appel("/valider", { classe: "seconde", code: "MIKAZA", routine: "probabilites", jour: 1 });
assert.equal(r.statut, 200);
r = await appel("/etat", { classe: "5e", code: "MARCZA" });
assert.deepEqual(r.corps.jours, { probabilites: [3], technologie: [12] });
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
assert.deepEqual(r.corps.jours, { probabilites: [], technologie: [12] }, "le jour est de nouveau « non fait »");
r = await appel("/admin/reinitialiser", { motdepasse: "secret-test", empreinte: marcza.empreinte, routine: "technologie", jour: "tous" });
assert.equal(r.corps.supprimes, 1);

for (let i = 0; i < 10; i++) await appel("/admin/etat", { motdepasse: "faux" });
r = await appel("/admin/etat", { motdepasse: "secret-test" });
assert.equal(r.statut, 429, "blocage après trop d'échecs");
console.log("Worker : tous les tests passent");
