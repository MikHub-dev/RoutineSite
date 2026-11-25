/* famzak-mur.js — mur des réussites de la famille FamZakSites (v1.1 : date d'origine possible).
   Un seul fichier, servi par RoutineSite. Chargé :
   - sur les 6 sites, par famzak-verrou.js dès que le code ZF est connu (rien à ajouter dans les pages) ;
   - sur le portail famzak.github.io (page mur.html et accueil), par une balise <script>.

   Ce qu'il fait
   - Repère les réussites des jeux dans le stockage de l'appareil, au moment où elles arrivent, et les
     envoie au serveur de RoutineSite (Worker « routinesite-suivi », route /mur/publier) :
       quiz sans faute (famzak:quiz:…), toutes les fiches d'un paquet QuantumSite connues (qflash-…),
       15 étapes d'IASite vues, projet MorphoSite terminé, défi chronométré FFJM de MathSite réussi.
     Les réussites de RoutineSite (jours, modules, badges, séries, bonne correction) sont publiées par le serveur lui-même.
     Les notes d'évaluation de MathSite sont publiées par evaluations.js (FamZakMur.publier).
     Chaque réussite n'est publiée qu'une fois (le serveur s'en souvient).
   - Affiche le bandeau « Dernière réussite de la famille » là où la page a un <div id="famzak-mur-bandeau">.
   - Donne à la page du mur (portail) de quoi lire le mur, dire « Bravo » et cacher une de ses réussites.
   Le mur ne montre que des prénoms, jamais un code ZF : le serveur ne renvoie ni code ni empreinte. */
(function () {
  "use strict";
  if (window.FamZakMur) return;
  var SERVEUR = "https://routinesite-suivi.mikhub-dev.workers.dev";
  var PORTAIL = "https://famzak.github.io/";
  var PAGE_MUR = PORTAIL + "mur.html";
  var SITES = {
    routinesite: { nom: "RoutineSite", symbole: "30'", couleur: "#ffb86b" },
    mathsite: { nom: "MathSite", symbole: "Ω", couleur: "#7aa2ff" },
    quantumsite: { nom: "QuantumSite", symbole: "ψ", couleur: "#5fd4ff" },
    culturegsite: { nom: "CultureGSite", symbole: "G", couleur: "#7ee0c3" },
    iasite: { nom: "IASite", symbole: "∇", couleur: "#ff6b8b" },
    morphosite: { nom: "MorphoSite", symbole: "φ", couleur: "#a78bfa" }
  };
  var ici = location.hostname === "famzak.github.io" ? "portail"
    : ((location.pathname.split("/")[1] || "").toLowerCase());
  if (ici !== "portail" && !SITES[ici]) ici = null;

  function acces() { var V = window.FamZakVerrou; return V && V.lire ? V.lire() : null; }
  function appel(route, corps, qui) {
    var a = qui && qui.classe && qui.code ? qui : acces();
    if (!a) return Promise.reject(new Error("Pas de code ZF"));
    var donnees = { classe: a.classe, code: a.code };
    for (var k in corps) donnees[k] = corps[k];
    return fetch(SERVEUR + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(donnees) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.erreur || "Erreur " + r.status); return d; }); });
  }

  /* ---------- Publier une réussite ---------- */
  // qui (facultatif) : { classe, code } de l'élève concerné quand ce n'est pas le code ouvert sur l'appareil
  // (espace Évaluations de MathSite ouvert avec un autre code). Sinon : le code ZF de l'appareil.
  // Réussites déjà envoyées depuis cet appareil (par empreinte du code, jamais le code) : pas de nouvel envoi inutile.
  var ENVOYEES = "famzak:mur:envoyees";
  function dejaEnvoyee(id) { try { return (JSON.parse(localStorage.getItem(ENVOYEES)) || []).indexOf(id) >= 0; } catch (e) { return false; } }
  function noterEnvoyee(id) {
    try { var l = JSON.parse(localStorage.getItem(ENVOYEES)) || []; l.push(id); localStorage.setItem(ENVOYEES, JSON.stringify(l.slice(-400))); } catch (e) {}
  }
  function publier(site, cle, texte, detail, grande, qui, date) {
    var a = acces();
    if (!(qui || a) || !SITES[site] || site === "routinesite") return Promise.resolve(null);
    var id = !qui && a && a.h ? a.h.slice(0, 16) + ":" + site + ":" + cle : null;
    if (id && dejaEnvoyee(id)) return Promise.resolve(null);
    return appel("/mur/publier", { site: site, cle: cle, texte: texte, detail: detail || "", grande: !!grande, date: date || undefined }, qui)
      .then(function (d) { if (id) noterEnvoyee(id); if (d && d.id) rafraichirBandeau(); return d; }, function () { return null; });
  }

  /* ---------- Textes : « [[7/8]] » met un nombre en valeur ; tout le reste est du texte brut ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function texteHtml(t) { return esc(t).replace(/\[\[([^\]]{1,30})\]\]/g, '<b class="fzm-note">$1</b>'); }
  function texteBrut(t) { return String(t || "").replace(/\[\[([^\]]{1,30})\]\]/g, "$1"); }
  function ilYa(iso) {
    var s = (Date.now() - Date.parse(iso)) / 1000;
    if (!(s >= 0)) return "";
    if (s < 60) return "à l'instant";
    if (s < 3600) return "il y a " + Math.floor(s / 60) + " min";
    if (s < 86400) return "il y a " + Math.floor(s / 3600) + " h";
    var j = Math.floor(s / 86400);
    return j === 1 ? "hier" : "il y a " + j + " jours";
  }

  /* ---------- Repérer les réussites dans le stockage de l'appareil ---------- */
  function titrePage() {
    var h = document.querySelector("h1");
    var t = h ? h.textContent : document.title;
    return String(t || "").replace(/\s+/g, " ").trim().split(/\s[—|·–]\s/)[0].slice(0, 90);
  }
  function lireJSON(v) { try { return JSON.parse(v); } catch (e) { return null; } }
  function examiner(cle, avant, apres) {
    if (!ici || ici === "portail" || ici === "routinesite" || apres == null) return;
    var a = lireJSON(avant), b = lireJSON(apres), m;
    // Quiz sans faute (moteur quiz-famzak.js et quiz des fiches) : { score, total }
    if ((m = /^famzak:quiz:(.+)$/.exec(cle))) {
      if (!b || !(b.total >= 3) || b.score !== b.total) return;
      if (a && a.total === b.total && a.score === a.total) return;
      var nomQuiz = titrePage(), id = m[1];
      if (ici === "iasite") {
        var page = id.split(":").pop();
        if (page === "attention") nomQuiz = "Le parcours de l'attention";
        else { try { if (typeof QUIZ_CHAP !== "undefined" && QUIZ_CHAP[page]) nomQuiz = QUIZ_CHAP[page][0]; } catch (e) {} }   // eslint-disable-line no-undef
      }
      publier(ici, "quiz:" + id, "a fait un sans-faute au quiz « " + nomQuiz + " »", "[[" + b.score + "/" + b.total + "]]");
      return;
    }
    // QuantumSite : toutes les fiches d'un paquet marquées « Je la connais »
    if (/^qflash-/.test(cle) && window.JEU_DE_FICHES && window.JEU_DE_FICHES.cle === cle && b) {
      var jeu = window.JEU_DE_FICHES, n = (jeu.cartes || []).length;
      var ok = function (o) { return o ? jeu.cartes.filter(function (c) { return o[c.n] === "ok"; }).length : 0; };
      if (n >= 5 && ok(b) === n && ok(a) < n) publier(ici, "fiches:" + cle, "connaît maintenant les " + n + " fiches « " + jeu.titre + " »", "Toutes marquées « Je la connais »", true);
      return;
    }
    // IASite : les 15 étapes du micro-GPT ouvertes
    if (cle === "famzak:iasite:etapes-vues") {
      if (Array.isArray(b) && b.length >= 15 && !(Array.isArray(a) && a.length >= 15)) publier(ici, "etapes:15", "a parcouru les 15 étapes du micro-GPT", "Construire une IA de zéro", true);
      return;
    }
    // MorphoSite : projet terminé
    if ((m = /^famzak:morpho:(.+)$/.exec(cle)) && m[1] !== "mode-devine") {
      if (!b || !b.fini || (a && a.fini)) return;
      var v = Object.keys(b.devine || {}).map(function (k) { return b.devine[k]; }), justes = v.filter(Boolean).length;
      var suite = v.length ? " en devinant juste " + justes + " fois sur " + v.length : "";
      publier(ici, "projet:" + m[1], "a terminé le projet « " + titrePage() + " »" + suite, "Projet concret");
      return;
    }
    // MathSite : défi chronométré FFJM réussi
    if (cle === "famzak:mathsite:ffjm" && b) {
      Object.keys(b).forEach(function (f) {
        if (!b[f] || !b[f].ok || (a && a[f] && a[f].ok)) return;
        var sec = Number(b[f].sec) || 0, duree = sec ? (Math.floor(sec / 60) ? Math.floor(sec / 60) + " min " : "") + (sec % 60) + " s" : "";
        publier(ici, "ffjm:" + f, "a réussi le défi chronométré « " + titrePage() + " »", duree ? "En [[" + duree + "]]" : "Concours FFJM");
      });
    }
  }
  if (ici && ici !== "portail" && ici !== "routinesite") {
    try {
      var ls = window.localStorage, setOrig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        var avant = null;
        if (this === ls) { try { avant = ls.getItem(k); } catch (e) {} }
        setOrig.call(this, k, v);
        if (this === ls && String(v) !== avant) { try { examiner(String(k), avant, String(v)); } catch (e) {} }
      };
    } catch (e) {}
  }

  /* ---------- Bandeau « Dernière réussite de la famille » ---------- */
  var cssPose = false;
  function css() {
    if (cssPose) return; cssPose = true;
    var st = document.createElement("style");
    st.textContent =
      "#famzak-mur-bandeau{box-sizing:border-box;display:flex;align-items:center;gap:12px 14px;flex-wrap:wrap;margin:14px auto;padding:10px 16px;width:calc(100% - 32px);max-width:1200px;" +
      "background:linear-gradient(100deg,rgba(255,107,139,.14),rgba(14,20,36,.92) 45%);border:1px solid rgba(159,179,214,.25);border-left:3px solid #ff6b8b;border-radius:12px;" +
      "color:#e6eefc;font:14px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif;text-align:left;position:relative;z-index:5}" +
      "#famzak-mur-bandeau[hidden]{display:none}" +
      "#famzak-mur-bandeau .fzm-coeur{width:22px;height:20px;flex:none;fill:#ff6b8b;filter:drop-shadow(0 0 6px rgba(255,107,139,.6))}" +
      "#famzak-mur-bandeau .fzm-texte{margin:0;flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}" +
      "#famzak-mur-bandeau .fzm-etiquette{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#9fb3d6}" +
      "#famzak-mur-bandeau .fzm-prenom{font-weight:700;letter-spacing:.04em}" +
      "#famzak-mur-bandeau .fzm-site{font-weight:600}" +
      "#famzak-mur-bandeau .fzm-quand{color:#9fb3d6}" +
      "#famzak-mur-bandeau .fzm-note{color:#ffcf9c}" +
      "#famzak-mur-bandeau button{display:inline-flex;align-items:center;gap:6px;font:600 13px system-ui,sans-serif;color:#9fb3d6;background:transparent;border:1px solid rgba(159,179,214,.3);border-radius:999px;padding:5px 11px;cursor:pointer}" +
      "#famzak-mur-bandeau button svg{width:14px;height:13px;fill:none;stroke:currentColor;stroke-width:2}" +
      "#famzak-mur-bandeau button.fzm-oui{color:#ffd2dc;border-color:rgba(255,107,139,.6);background:rgba(255,107,139,.14)}" +
      "#famzak-mur-bandeau button.fzm-oui svg{fill:#ff6b8b;stroke:#ff6b8b}" +
      "#famzak-mur-bandeau a{color:#7aa2ff;font-weight:700;text-decoration:none;white-space:nowrap}" +
      "#famzak-mur-bandeau a:hover{text-decoration:underline}" +
      "@media (max-width:600px){#famzak-mur-bandeau{width:calc(100% - 24px);padding:10px 12px;gap:8px 10px;align-items:flex-start}" +
      "#famzak-mur-bandeau .fzm-texte{flex-basis:calc(100% - 34px)}#famzak-mur-bandeau .fzm-quand{display:block;font-size:12.5px}" +
      "#famzak-mur-bandeau button{margin-left:32px}#famzak-mur-bandeau a{margin-left:auto;align-self:center;font-size:13.5px}}";
    document.head.appendChild(st);
  }
  var COEUR = '<svg viewBox="0 0 24 22" aria-hidden="true"><path d="M12 21C4 14 1 10 1 6.5 1 3 3.8 1 6.5 1 9 1 11 2.5 12 4.5 13 2.5 15 1 17.5 1 20.2 1 23 3 23 6.5 23 10 20 14 12 21Z"/></svg>';
  function rafraichirBandeau() {
    var zone = document.getElementById("famzak-mur-bandeau");
    if (!zone || !acces()) return;
    appel("/mur/lire", { limite: 40 }).then(function (d) {
      var liste = (d.reussites || []).filter(function (r) { return !r.cache; });
      var autres = liste.filter(function (r) { return !r.moi; });
      var r = autres[0] || liste[0];
      if (!r) { zone.hidden = true; return; }
      css();
      var aujourdHui = new Date().toDateString();
      var deplus = liste.filter(function (x) { return x !== r && new Date(x.date).toDateString() === aujourdHui; }).length;
      var s = SITES[r.site] || { nom: r.site, couleur: "#9fb3d6" };
      zone.setAttribute("role", "region");
      zone.setAttribute("aria-label", "Dernière réussite de la famille");
      zone.innerHTML = COEUR.replace("<svg", '<svg class="fzm-coeur"') +
        '<p class="fzm-texte"><span class="fzm-etiquette">Dernière réussite de la famille</span>' +
        '<span><span class="fzm-prenom">' + esc(r.prenom) + "</span> " + texteHtml(r.texte) +
        ' <span class="fzm-quand">· <span class="fzm-site" style="color:' + s.couleur + '">' + esc(s.nom) + "</span> · " + esc(ilYa(r.date)) +
        (deplus ? " · +" + deplus + " autre" + (deplus > 1 ? "s" : "") + " aujourd'hui" : "") + "</span></span></p>" +
        (r.moi ? "" : '<button type="button" class="' + (r.jaiDitBravo ? "fzm-oui" : "") + '" aria-pressed="' + r.jaiDitBravo + '">' + COEUR + "Bravo" + (r.bravos ? " · " + r.bravos : "") + "</button>") +
        '<a href="' + PAGE_MUR + '">Voir le mur des réussites →</a>';
      var b = zone.querySelector("button");
      if (b) b.addEventListener("click", function () {
        b.disabled = true;
        bravo(r.id).then(function () { rafraichirBandeau(); }, function () { b.disabled = false; });
      });
      zone.hidden = false;
    }).catch(function () { zone.hidden = true; });
  }

  function lire(limite) { return appel("/mur/lire", { limite: limite || 150 }); }
  function bravo(id) { return appel("/mur/bravo", { id: id }); }
  function cacher(id, oui) { return appel("/mur/cacher", { id: id, cache: oui !== false }); }

  window.FamZakMur = { publier: publier, lire: lire, bravo: bravo, cacher: cacher, rafraichirBandeau: rafraichirBandeau,
    SITES: SITES, PAGE_MUR: PAGE_MUR, texteHtml: texteHtml, texteBrut: texteBrut, esc: esc, ilYa: ilYa };

  // Publications demandées avant le chargement de ce fichier : window.FamZakMurAttente = [[site, cle, texte, detail, grande, qui, date], …] (date : AAAA-MM-JJ d'origine, facultative)
  var file = window.FamZakMurAttente;
  window.FamZakMurAttente = { push: function (x) { publier.apply(null, x); } };
  if (Array.isArray(file)) file.forEach(function (x) { publier.apply(null, x); });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", rafraichirBandeau); else rafraichirBandeau();
})();
