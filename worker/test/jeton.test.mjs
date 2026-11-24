// Tests des jetons de passage portail ⇄ sites (node worker/test/jeton.test.mjs). Code fictif, jamais un vrai code ZF.
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import worker from "../src/index.js";

const CODE = "ESSAI42";
const h = Buffer.from(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode("mathsite:famille:" + CODE))).toString("hex");
const env = { ALLOWED_ORIGINS: "https://mikhub-dev.github.io,https://famzak.github.io", SEL: "mathsite:", ADMIN_PASSWORD: "secret-test",
  EMPREINTES: JSON.stringify({ famille: [h] }), SUIVI: { async get() { return null; }, async list() { return { keys: [], list_complete: true }; } } };
const appel = async (chemin, corps, origine = "https://famzak.github.io") => {
  const r = await worker.fetch(new Request("https://w.example" + chemin, { method: "POST", headers: { "Content-Type": "application/json", Origin: origine }, body: JSON.stringify(corps) }), env);
  return { statut: r.status, corps: await r.json(), cors: r.headers.get("Access-Control-Allow-Origin") };
};

let r = await appel("/fz/jeton", { classe: "famille", code: "essai-42" });
assert.equal(r.statut, 200); assert.equal(r.cors, "https://famzak.github.io");
const jeton = r.corps.jeton;
assert.ok(/^[A-Za-z0-9_-]+$/.test(jeton) && !jeton.includes(CODE), "le jeton ne contient pas le code");
r = await appel("/fz/ouvrir", { jeton }, "https://mikhub-dev.github.io");
assert.deepEqual([r.statut, r.corps.classe, r.corps.code], [200, "famille", CODE]);
r = await appel("/fz/jeton", { classe: "famille", code: "AUTRE99" }); assert.equal(r.statut, 403, "code inconnu");
r = await appel("/fz/ouvrir", { jeton: jeton.slice(0, -3) + "AAA" }); assert.equal(r.statut, 403, "jeton modifié");
r = await appel("/fz/ouvrir", { jeton: 42 }); assert.equal(r.statut, 400);
r = await appel("/fz/ouvrir", { jeton }, "https://autre.example"); assert.equal(r.statut, 403, "origine refusée");
const maintenant = Date.now; Date.now = () => maintenant() + 6 * 60 * 1000;
r = await appel("/fz/ouvrir", { jeton }); assert.equal(r.statut, 403, "jeton expiré"); Date.now = maintenant;
env.ADMIN_PASSWORD = "autre"; r = await appel("/fz/ouvrir", { jeton }); assert.equal(r.statut, 403, "autre clé");
console.log("Jetons de passage : tous les tests passent");
