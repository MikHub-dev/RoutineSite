/* famzak-verrou.js — verrou simple (code ZF) des sites FamZakSites (v1.0).
   Un seul fichier, servi par RoutineSite, chargé en tête de chaque page des 6 sites :
     <script src="https://mikhub-dev.github.io/RoutineSite/famzak-verrou.js"></script>
   et par le portail https://famzak.github.io/ avec data-portail="oui" (il n'y sert qu'à vérifier les codes).

   Fonctionnement :
   - Le portail demande un code ZF existant, le vérifie ici (empreintes SHA-256, comme MathSite et
     le serveur de RoutineSite), puis ajoute « #fz=<CODE> » aux liens vers les sites.
   - Sur un site, ce script lit « #fz=… », le vérifie, l'efface de l'adresse et garde l'accès sur
     l'appareil (localStorage « famzak:acces », commun aux 6 sites qui ont la même adresse de base).
   - Sans accès valable, la page renvoie au portail, qui revient ensuite à la page demandée.
   - Le code ouvre aussi la session de progression (famzak:eleve) et celle de RoutineSite.
   Limites (verrou simple) : tout se passe dans le navigateur. Les fichiers (PDF, images) restent
   accessibles par leur adresse directe, et quelqu'un qui lit le code de la page peut contourner le verrou.
   Pas de serveur nécessaire : le verrou marche même si le serveur de RoutineSite ne répond pas.
   Ajouter un code : ajouter son empreinte ci-dessous (sel + classe + ":" + CODE, en SHA-256),
   dans RoutineSite/commun.js et dans worker/wrangler.toml (EMPREINTES). */
(function () {
  "use strict";
  var PORTAIL = "https://famzak.github.io/";
  var SEL = "mathsite:";
  var EMPREINTES = {
    "5e": ["489c1aecd78964bf6e285c1425430f40b6a14f6cc4ba1f9ffd2bc2f48b203a24"],
    "seconde": ["8f29042f5b26a90537a0cec56715742c14a0e793fd534ed7b5478796565bc56f"],
    "famille": ["d407849a1cdcd66d153dede7d147896ded5bab84e54ae1d9e1fe6962234505fb", "d91d5de7dffd23db09ceeb90d067be821556434b0e5715de302ec7c76b00c5a1", "3d59bb698ab0002a131b50fabda888d0a1ff1ede656436267ce636bf2d78f8de"]
  };
  var CLE = "famzak:acces";
  var normaliser = function (s) { return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); };
  var toutes = [];
  Object.keys(EMPREINTES).forEach(function (k) { toutes = toutes.concat(EMPREINTES[k]); });

  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); }
  function sha256(texte) { return crypto.subtle.digest("SHA-256", new TextEncoder().encode(texte)).then(hex); }
  // Renvoie { classe, code, h } si le code existe dans une classe, sinon null.
  function verifier(code) {
    code = normaliser(code);
    if (code.length < 6 || !(window.crypto && crypto.subtle)) return Promise.resolve(null);
    var classes = Object.keys(EMPREINTES);
    return Promise.all(classes.map(function (c) { return sha256(SEL + c + ":" + code); })).then(function (hs) {
      for (var i = 0; i < classes.length; i++) if (EMPREINTES[classes[i]].indexOf(hs[i]) >= 0) return { classe: classes[i], code: code, h: hs[i] };
      return null;
    });
  }
  function lire() {
    try { var a = JSON.parse(localStorage.getItem(CLE)); if (a && a.code && toutes.indexOf(a.h) >= 0) return a; } catch (e) {}
    try { var b = JSON.parse(sessionStorage.getItem(CLE)); if (b && b.code && toutes.indexOf(b.h) >= 0) return b; } catch (e) {}
    return null;
  }
  function ecrire(a) {
    var v = JSON.stringify({ classe: a.classe, code: a.code, h: a.h, date: new Date().toISOString().slice(0, 10) });
    try { localStorage.setItem(CLE, v); } catch (e) { try { sessionStorage.setItem(CLE, v); } catch (e2) {} }
  }
  function oublier() { try { localStorage.removeItem(CLE); } catch (e) {} try { sessionStorage.removeItem(CLE); } catch (e) {} }
  window.FamZakVerrou = { verifier: verifier, lire: lire, ecrire: ecrire, oublier: oublier, PORTAIL: PORTAIL };

  var moi = document.currentScript;
  if (moi && moi.dataset.portail === "oui") return;          // portail : seulement la vérification
  if (location.protocol === "file:") return;                 // copie ouverte sur l'ordinateur : pas de verrou

  // Ouvre les sessions de progression avec ce code (force = le code vient d'être donné par le portail).
  // Une seule fois par onglet, sauf code neuf : « Changer de code » sur un site reste respecté.
  function sessions(a, force) {
    try { if (!force && sessionStorage.getItem("famzak:verrou-ouvert")) return; sessionStorage.setItem("famzak:verrou-ouvert", "1"); } catch (e) {}
    var s = JSON.stringify({ classe: a.classe, code: a.code });
    ["famzak:eleve", "routinesite:code"].forEach(function (k) {
      try { if (force || !sessionStorage.getItem(k)) sessionStorage.setItem(k, s); } catch (e) {}
    });
  }
  function cacher() { document.documentElement.style.visibility = "hidden"; }
  function montrer() { document.documentElement.style.visibility = ""; }
  function versPortail() {
    cacher();
    location.replace(PORTAIL + "?retour=" + encodeURIComponent(location.href));
  }

  // 1. Code transmis par le portail dans l'adresse : #fz=CODE (éventuellement après une autre ancre : #quiz&fz=CODE)
  var morceaux = location.hash.replace(/^#/, "").split("&");
  var donne = null;
  morceaux = morceaux.filter(function (p) { if (/^fz=/.test(p)) { donne = decodeURIComponent(p.slice(3)); return false; } return p !== ""; });
  if (donne !== null) {
    var reste = morceaux.join("&");
    try { history.replaceState(history.state, "", location.pathname + location.search + (reste ? "#" + reste : "")); } catch (e) {}
    cacher();
    verifier(donne).then(function (a) {
      if (!a) return versPortail();
      ecrire(a); sessions(a, true); montrer();
    }, function () { montrer(); });                        // vérification impossible : on n'enferme pas l'élève
    return;
  }
  // 2. Accès déjà gardé sur l'appareil
  var a = lire();
  if (a) { sessions(a, false); return; }
  // 3. Sinon : retour au portail pour donner son code
  versPortail();
})();
