// Tests de l'analyse automatique (node worker/test/analyse.test.mjs) : Workers AI simulé, aucun appel réseau.
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { motsAssociation, indicesStructure, estimerStructure, indiceLiens, estimerLiens, lireJson, texteDeSortie, validerReponse, signature, cosinus } from "../src/analyse.js";

// ---------- Fonctions pures ----------
assert.deepEqual(motsAssociation("Alors lanterne, la lumière de la nuit nuit l'horloge euh", "Lanterne"), ["lanterne", "lanterne", "lumière", "nuit", "horloge"].filter((m, i, a) => i === 0 || m !== a[i - 1]), "mots outils retirés, doublons consécutifs fusionnés");
assert.equal(motsAssociation("a b c", "").length, 0, "mots trop courts ignorés");
const ind = indicesStructure("Il était une fois un horloger. Alors un jour, soudain, l'horloge s'arrête. Puis enfin tout repart.", true);
assert.ok(ind.connecteurs >= 5 && ind.motImpose === true, "connecteurs repérés");
assert.ok(estimerStructure({ motImpose: true, partDifferents: 0.7, mots: 200, connecteurs: 6 }) === 15, "estimation maximale");
assert.ok(estimerStructure({ motImpose: false, partDifferents: 0.2, mots: 20, connecteurs: 0 }) <= 3, "estimation faible");
assert.ok(Math.abs(cosinus([1, 0], [1, 0]) - 1) < 1e-9 && cosinus([1, 0], [0, 1]) === 0);
assert.equal(estimerLiens(null), null);
assert.equal(estimerLiens({ moyenne: 0.9 }), 10); assert.equal(estimerLiens({ moyenne: 0.1 }), 1);
assert.deepEqual(lireJson('```json\n{"a":1}\n```'), { a: 1 }); assert.equal(lireJson("pas de json"), null); assert.equal(lireJson("{cassé"), null);
assert.equal(texteDeSortie({ response: "x" }), "x"); assert.equal(texteDeSortie({ choices: [{ message: { content: "y" } }] }), "y"); assert.equal(texteDeSortie({ response: { a: 1 } }), '{"a":1}');
const v = validerReponse({ ex1: { liens: 14 }, ex2: { debut: 4.3, fil: -2, developpement: 9 }, axes: ["a", "b", "c", "d"], analyse: " texte  ", consigne: "c" });
assert.equal(v.liens, 10, "borné à 10"); assert.deepEqual(v.detail, { debut: 4.5, fil: 0, developpement: 2 }, "bornés et arrondis au demi-point");
assert.equal(v.axes.length, 3, "3 axes au maximum"); assert.equal(v.analyse, "texte");
assert.equal(validerReponse({ ex2: { debut: 3 } }).structurePartielle, null, "jugement incomplet refusé");
assert.equal(validerReponse(null), null);
assert.equal(signature({ ex1: { texte: "a" } }), signature({ ex1: { texte: "a" }, bilan: "x" }), "le bilan ne change pas la signature");
assert.notEqual(signature({ ex1: { texte: "a" } }), signature({ ex1: { texte: "b" } }));
const vecteurs = { chat: [1, 0, 0], chien: [0.9, 0.1, 0], maison: [0, 1, 0], toit: [0, 0.9, 0.1] };
const il = indiceLiens(["chat", "chien", "maison"], vecteurs);
assert.equal(il, null, "moins de 3 paires : pas d'indice");
const il2 = indiceLiens(["chat", "chien", "maison", "toit", "chat"], vecteurs);
assert.equal(il2.n, 4); assert.ok(il2.sauts >= 2 && il2.partSauts > 0);

// ---------- Worker avec Workers AI simulé ----------
const kv = new Map();
const appelsIA = { embed: 0, llm: 0 };
let modeLLM = "ok", liens = 8, deferred = null;
const themes = { lanterne: [1, 0.2, 0], lumiere: [0.9, 0.3, 0], lumière: [0.9, 0.3, 0], nuit: [0.8, 0.4, 0], horloge: [0, 1, 0.1], temps: [0.1, 0.9, 0], heure: [0.1, 0.95, 0.1] };
const vec = m => themes[m] || [0.05, 0.05, ((m.length * 7) % 10) / 10];
const reponseModele = () => ({ ex1: { liens, justification: "Bons liens." }, ex2: { debut: 4, fil: 4, developpement: 1, justification: "Histoire claire." }, analyse: "Tu enchaînes bien.", axes: ["Commence plus vite", "Repars du dernier mot", "Finis fort", "quatrième"], consigne: "Refais l'exercice 1 sans pause de plus de 4 s." });
const env = {
  ALLOWED_ORIGINS: "https://mikhub-dev.github.io", SEL: "mathsite:", ADMIN_PASSWORD: "secret-test",
  EMPREINTES: '{"5e":["489c1aecd78964bf6e285c1425430f40b6a14f6cc4ba1f9ffd2bc2f48b203a24"],"seconde":["8f29042f5b26a90537a0cec56715742c14a0e793fd534ed7b5478796565bc56f"]}',
  SUIVI: {
    async get(k) { return kv.get(k) ?? null; }, async put(k, v) { kv.set(k, v); }, async delete(k) { kv.delete(k); },
    async list({ prefix }) { return { keys: [...kv.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; }
  },
  AI: {
    async run(modele, entree) {
      if (modele.includes("bge-m3")) { appelsIA.embed++; return { shape: [entree.text.length, 3], data: entree.text.map(vec) }; }
      appelsIA.llm++;
      assert.equal(entree.temperature, 0, "température nulle"); assert.equal(entree.messages[0].role, "system");
      if (modeLLM === "panne") throw new Error("Workers AI indisponible");
      if (modeLLM === "bloque") await deferred;
      if (modeLLM === "garbage") return { response: "désolé, je ne peux pas" };
      if (modeLLM === "fence") return { response: "```json\n" + JSON.stringify(reponseModele()) + "\n```" };
      if (modeLLM === "choices") return { choices: [{ message: { content: JSON.stringify(reponseModele()) } }] };
      return { response: JSON.stringify(reponseModele()) };
    }
  }
};
const attentes = [];
const ctx = { waitUntil: p => attentes.push(p) };
const finir = async () => { while (attentes.length) await Promise.all(attentes.splice(0)); };
const appel = async (chemin, corps, e = env) => {
  const r = await worker.fetch(new Request("https://w.example" + chemin, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://mikhub-dev.github.io", "CF-Connecting-IP": "9.9.9.9" }, body: JSON.stringify(corps) }), e, ctx);
  return { statut: r.status, corps: await r.json() };
};
const ELEVE = { classe: "seconde", code: "MIKAZA" }, PWD = { motdepasse: "secret-test" };
const ex1 = (texte = "lanterne lumière nuit horloge temps heure", extra = {}) => ({ texte, aParle: true, reconnue: true, duree: 60, mots: 26, differents: 24, delai: 1.9, silenceFinal: 1.5, pauses: 20, blancs: 7, plusLongue: 5, motCle: "lanterne", auto: { rythme: 9, continuite: 6, richesse: 10, liens: null }, ...extra });
const ex2 = (texte = "Il était une fois une horloge. Alors un jour, elle s'arrête. Puis enfin elle repart.") => ({ texte, aParle: true, reconnue: true, duree: 120, mots: 240, differents: 130, delai: 1, silenceFinal: 1, pauses: 12, blancs: 1, plusLongue: 2.5, debit: 130, hauteurSt: 3, tendanceDb: -1, remplissage: 2, motImpose: true, motCle: "horloge", auto: { continuite: 13, debit: 10, structure: null, voix: 10 } });
const etat = async () => (await appel("/parole/etat", ELEVE)).corps;
const seanceN = async n => (await etat()).seances.find(s => s.seance === n);

// 1. exercice 1 : réponse immédiate, analyse en arrière-plan
let r = await appel("/parole/enregistrer", { ...ELEVE, jour: 1, seance: "1763000000001", ex1: ex1() });
assert.equal(r.statut, 200); assert.equal(r.corps.analyse, "en_cours", "l'analyse est lancée sans bloquer la réponse");
await finir();
let s = await seanceN("1763000000001");
assert.equal(s.analyse.statut, "ok"); assert.equal(s.analyse.sources.liens, "modele");
assert.equal(s.notesAuto.ex1.liens, 8); assert.deepEqual(s.notesAuto.ex1, { rythme: 9, continuite: 6, richesse: 10, liens: 8 }, "points mesurés de la page + liens jugés = 33/50");
assert.equal(s.notesAuto.ex2.structure, null, "exercice 2 non fait");
assert.match(s.analyse.retour, /Exercice 1 : 33\/50/); assert.match(s.analyse.retour, /première note/); assert.match(s.analyse.retour, /Total sur 100 : il faut les deux exercices/);
assert.deepEqual(s.analyse.axes, ["Commence plus vite", "Repars du dernier mot", "Finis fort"], "trois axes au maximum");
assert.equal(s.analyse.modele, "@cf/mistralai/mistral-small-3.1-24b-instruct");
assert.ok(s.analyse.indices === undefined && s.corrections === undefined && s.bilan === undefined, "l'élève ne voit pas les indices internes");
assert.equal((await etat()).analyseActive, true);
r = await appel("/admin/parole", PWD);
const brut = r.corps.seances.find(x => x.seance === "1763000000001");
assert.ok(brut.analyse.indices.liens && brut.analyse.indices.estimationLiens != null, "l'enseignant voit les indices embeddings");
assert.equal(appelsIA.embed, 1); assert.equal(appelsIA.llm, 1);

// 2. nouvel enregistrement identique (bilan généré) : pas de nouvelle analyse
r = await appel("/parole/enregistrer", { ...ELEVE, jour: 1, seance: "1763000000001", ex1: ex1(), bilan: "BILAN" });
assert.equal(r.corps.analyse, "ok"); await finir(); assert.equal(appelsIA.llm, 1, "contenu inchangé : aucun appel supplémentaire");

// 3. exercice 2 ajouté à la même séance : nouvelle analyse, total sur 100
r = await appel("/parole/enregistrer", { ...ELEVE, jour: 1, seance: "1763000000001", ex1: ex1(), ex2: ex2() });
assert.equal(r.corps.analyse, "en_cours"); await finir();
s = await seanceN("1763000000001");
assert.equal(s.analyse.statut, "ok"); assert.equal(s.notesAuto.ex2.structure, 12, "4 + 4 + 1 jugés + 3 pour le mot imposé utilisé");
assert.match(s.analyse.retour, /Total : 33\/100|Total : 78\/100/);   // 33 + (13+10+12+10 = 45) = 78
assert.match(s.analyse.retour, /Total : 78\/100 — niveau « solide »/);
assert.equal(appelsIA.llm, 2);

// 4. deuxième séance : comparaison avec la précédente
modeLLM = "fence"; liens = 9;
r = await appel("/parole/enregistrer", { ...ELEVE, jour: 2, seance: "1763000000002", ex1: ex1("lanterne nuit lumière horloge") });
await finir();
s = await seanceN("1763000000002");
assert.equal(s.analyse.statut, "ok", "réponse du modèle entourée de balises acceptée");
assert.match(s.analyse.retour, /Exercice 1 : 34\/50 \(précédent : 33\/50, \+1\)/, "comparaison calculée par le Worker");
modeLLM = "choices";
r = await appel("/parole/enregistrer", { ...ELEVE, jour: 2, seance: "1763000000003", ex1: ex1("lanterne temps") });
await finir(); assert.equal((await seanceN("1763000000003")).analyse.statut, "ok", "format de réponse « choices » accepté");

// 5. modèle en panne : estimation, puis relance réussie
modeLLM = "panne";
r = await appel("/parole/enregistrer", { ...ELEVE, jour: 3, seance: "1763000000004", ex1: ex1("lanterne lumière nuit horloge temps heure") });
await finir();
s = await seanceN("1763000000004");
assert.equal(s.analyse.statut, "estimation"); assert.equal(s.analyse.sources.liens, "estimation"); assert.ok(s.notesAuto.ex1.liens >= 1 && s.notesAuto.ex1.liens <= 10);
assert.match(s.analyse.retour, /estimations automatiques/);
assert.ok(JSON.parse(kv.get([...kv.keys()].find(k => k.endsWith(":3:1763000000004")))).analyse.erreur, "l'erreur est gardée pour l'enseignant"); assert.equal(s.analyse.erreur, undefined, "mais pas montrée à l'élève");
modeLLM = "ok"; liens = 7;
r = await appel("/parole/analyser", { ...ELEVE, jour: 3, seance: "1763000000004" });
assert.equal(r.statut, 200); assert.equal(r.corps.statut, "en_cours"); await finir();
s = await seanceN("1763000000004"); assert.equal(s.analyse.statut, "ok"); assert.equal(s.notesAuto.ex1.liens, 7);
r = await appel("/parole/analyser", { ...ELEVE, jour: 3, seance: "1763000000004" });
assert.equal(r.corps.statut, "ok", "analyse déjà à jour : pas de nouvel appel"); await finir();
r = await appel("/parole/analyser", { classe: "seconde", code: "MARCZA", jour: 3, seance: "1763000000004" });
assert.equal(r.statut, 403, "code d'une autre classe refusé");
r = await appel("/parole/analyser", { ...ELEVE, jour: 9, seance: "1763000000099" });
assert.equal(r.statut, 404, "séance inconnue");

// 6. réponse illisible : estimation aussi
modeLLM = "garbage";
await appel("/parole/enregistrer", { ...ELEVE, jour: 4, seance: "1763000000005", ex1: ex1("lanterne nuit lumière horloge temps heure") }); await finir();
assert.equal((await seanceN("1763000000005")).analyse.statut, "estimation");
modeLLM = "ok";

// 7. séance où personne n'a parlé : pas d'appel au modèle
const avant = appelsIA.llm;
await appel("/parole/enregistrer", { ...ELEVE, jour: 4, seance: "1763000000006", ex1: { texte: "", aParle: false, mots: 0, differents: 0, auto: { rythme: 0, continuite: 0, richesse: 0, liens: null } } }); await finir();
s = await seanceN("1763000000006"); assert.equal(s.analyse.statut, "ok"); assert.equal(s.notesAuto.ex1.liens, 0); assert.equal(appelsIA.llm, avant, "aucun appel quand il n'y a pas de voix");

// 8. séance modifiée pendant l'analyse : l'ancien résultat est écarté
modeLLM = "bloque"; let liberer; deferred = new Promise(ok => { liberer = ok; });
await appel("/parole/enregistrer", { ...ELEVE, jour: 5, seance: "1763000000007", ex1: ex1("lanterne nuit") });
modeLLM = "ok"; liens = 6;
await appel("/parole/enregistrer", { ...ELEVE, jour: 5, seance: "1763000000007", ex1: ex1("lanterne nuit lumière horloge") });
liberer(); await finir();
s = await seanceN("1763000000007"); assert.equal(s.analyse.statut, "ok"); assert.equal(s.notesAuto.ex1.liens, 6, "seule l'analyse du contenu le plus récent est conservée");

// 9. corrections de l'enseignant mémorisées (hors vue élève)
const cle = Object.keys(Object.fromEntries(kv)).find(k => k.endsWith(":1:1763000000001"));
r = await appel("/admin/parole/noter", { ...PWD, cle, notes: { ex1: { rythme: 9, continuite: 6, richesse: 10, liens: 7 }, ex2: { continuite: 13, debit: 10, structure: 12, voix: 10 } }, retour: "ok" });
assert.equal(r.statut, 200);
const apres = JSON.parse(kv.get(cle));
assert.deepEqual(apres.corrections, [{ ex: "ex1", critere: "liens", auto: 8, final: 7 }], "seul l'écart avec la note automatique est gardé");
assert.equal(apres.notesAuto.ex1.liens, 8, "la note automatique reste consultable");
assert.equal((await seanceN("1763000000001")).corrections, undefined);

// 10. relance par l'enseignant
r = await appel("/admin/parole/analyser", { motdepasse: "faux", cle }); assert.equal(r.statut, 401);
r = await appel("/admin/parole/analyser", { ...PWD, cle }); assert.equal(r.statut, 200); assert.equal(r.corps.statut, "en_cours"); await finir();
assert.equal(JSON.parse(kv.get(cle)).analyse.statut, "ok");

// 11. analyse « en cours » bloquée : relance possible après 90 s
const bloquee = JSON.parse(kv.get(cle)); bloquee.analyse = { ...bloquee.analyse, statut: "en_cours", debut: new Date(Date.now() - 120000).toISOString() }; kv.set(cle, JSON.stringify(bloquee));
r = await appel("/parole/analyser", { ...ELEVE, jour: 1, seance: "1763000000001" }); assert.equal(r.corps.statut, "en_cours"); await finir();
assert.equal(JSON.parse(kv.get(cle)).analyse.statut, "ok");
const recente = JSON.parse(kv.get(cle)); recente.analyse = { ...recente.analyse, statut: "en_cours", debut: new Date().toISOString() }; kv.set(cle, JSON.stringify(recente));
const llmAvant = appelsIA.llm; r = await appel("/parole/analyser", { ...ELEVE, jour: 1, seance: "1763000000001" }); await finir();
assert.equal(appelsIA.llm, llmAvant, "une analyse récente n'est pas doublée");

// 12. plafonds
const emp = cle.split(":")[1], jourIso = new Date().toISOString().slice(0, 10);
kv.set(`analyses:${emp}:${jourIso}`, "30");
await appel("/parole/enregistrer", { ...ELEVE, jour: 6, seance: "1763000000008", ex1: ex1("lanterne temps") }); await finir();
s = await seanceN("1763000000008"); assert.equal(s.analyse.statut, "plafond", "plafond journalier : la séance est enregistrée mais pas analysée");
r = await appel("/parole/analyser", { ...ELEVE, jour: 6, seance: "1763000000008" }); assert.equal(r.statut, 429);
r = await appel("/admin/parole/analyser", { ...PWD, cle: `parole:${emp}:6:1763000000008` }); assert.equal(r.statut, 200, "l'enseignant n'est pas soumis au plafond"); await finir();
kv.delete(`analyses:${emp}:${jourIso}`);
for (let i = 0; i < 9; i++) { await appel("/parole/enregistrer", { ...ELEVE, jour: 7, seance: "1763000000009", ex1: ex1("lanterne " + "mot".repeat(1) + i + " nuit") }); await finir(); }
s = await seanceN("1763000000009"); assert.equal(s.analyse.statut, "plafond", "au plus 8 analyses automatiques par séance"); assert.equal(s.analyse.nb, 8);

// 13. sans binding AI : fonctionnement d'avant, rien n'est cassé
const sansIA = { ...env }; delete sansIA.AI;
r = await appel("/parole/enregistrer", { ...ELEVE, jour: 8, seance: "1763000000010", ex1: ex1() }, sansIA);
assert.equal(r.statut, 200); assert.equal(r.corps.analyse, null);
assert.equal((await seanceN("1763000000010")).analyse, undefined);
r = await appel("/parole/analyser", { ...ELEVE, jour: 8, seance: "1763000000010" }, sansIA); assert.equal(r.statut, 503);
assert.equal((await appel("/parole/etat", ELEVE, sansIA)).corps.analyseActive, false);

console.log("Analyse automatique : tous les tests passent");
