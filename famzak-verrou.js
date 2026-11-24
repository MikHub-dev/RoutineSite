/* famzak-verrou.js — verrou simple (code ZF) des sites FamZakSites (v1.2).
   Un seul fichier, servi par RoutineSite, chargé en tête de chaque page des 6 sites :
     <script src="https://mikhub-dev.github.io/RoutineSite/famzak-verrou.js"></script>
   et par le portail https://famzak.github.io/ avec data-portail="oui" (il n'y sert qu'à vérifier les codes).

   Fonctionnement :
   - Le portail demande un code ZF existant et le vérifie ici (empreintes SHA-256, comme MathSite et
     le serveur de RoutineSite).
   - Passage portail ⇄ sites (deux adresses différentes, qui ne partagent pas leur stockage) : le code ZF
     n'est JAMAIS mis dans un lien (v1.2). Les liens restent propres ; au clic, on demande au serveur de
     RoutineSite un jeton chiffré valable 5 minutes, ajouté à l'adresse (« #fz=j.<jeton> »). La page
     d'arrivée échange ce jeton contre l'accès, puis l'efface de l'adresse. Serveur injoignable : on
     part sans jeton et la page d'arrivée demande le code ZF.
   - Sur un site, l'accès est gardé sur l'appareil (localStorage « famzak:acces », commun aux 6 sites
     qui ont la même adresse de base).
   - Sans accès valable, la page reste cachée et demande le code ZF elle-même : un code donné sur
     n'importe lequel des 6 sites ou sur le portail ouvre tous les autres (jeton au clic vers le portail).
   - Si ce fichier ne se charge pas, l'attribut onerror de la balise cache la page (verrou fermé).
   - Le code ouvre aussi la session de progression (famzak:eleve) et celle de RoutineSite.
   Limites (verrou simple) : tout se passe dans le navigateur. Les fichiers (PDF, images) restent
   accessibles par leur adresse directe, et quelqu'un qui lit le code de la page peut contourner le verrou.
   La vérification du code se fait sans serveur ; seul le passage d'une adresse à l'autre sans retaper
   le code a besoin du serveur de RoutineSite.
   Ajouter un code : ajouter son empreinte ci-dessous (sel + classe + ":" + CODE, en SHA-256),
   dans RoutineSite/commun.js et dans worker/wrangler.toml (EMPREINTES), et son prénom chiffré (PRENOMS).
   Affichage (v1.1) : les sites montrent le prénom, jamais le code ZF. Les prénoms sont rangés sous l'empreinte,
   chiffrés (AES-GCM) avec une clé tirée du code lui-même : seul celui qui connaît le code peut lire le prénom,
   et la liste ne permet pas de retrouver les codes. Même liste dans worker/wrangler.toml (PRENOMS). */
(function () {
  "use strict";
  var PORTAIL = "https://famzak.github.io/";
  var SITES = "https://mikhub-dev.github.io/";
  var SERVEUR = "https://routinesite-suivi.mikhub-dev.workers.dev";
  var SEL = "mathsite:";
  var EMPREINTES = {
    "5e": ["489c1aecd78964bf6e285c1425430f40b6a14f6cc4ba1f9ffd2bc2f48b203a24"],
    "seconde": ["8f29042f5b26a90537a0cec56715742c14a0e793fd534ed7b5478796565bc56f"],
    "famille": ["d407849a1cdcd66d153dede7d147896ded5bab84e54ae1d9e1fe6962234505fb", "d91d5de7dffd23db09ceeb90d067be821556434b0e5715de302ec7c76b00c5a1", "3d59bb698ab0002a131b50fabda888d0a1ff1ede656436267ce636bf2d78f8de"]
  };
  // Prénom affiché, par empreinte : « iv.texte » en base64, chiffré avec SHA-256("famzak-prenom:" + CODE).
  var PRENOMS = {"489c1aecd78964bf6e285c1425430f40b6a14f6cc4ba1f9ffd2bc2f48b203a24":"95f8H4vlTd0I1R3h.LyXSQW5ZD40IYtVh6RmmHARPR9E=","8f29042f5b26a90537a0cec56715742c14a0e793fd534ed7b5478796565bc56f":"qwanJmNCPcQKA0Fh.Rt26T3wdiBfJQQDRvpR/pMcnw44ivw==","3d59bb698ab0002a131b50fabda888d0a1ff1ede656436267ce636bf2d78f8de":"IpB/kG9qAP02cQRz.shlmIxqg0Z/+voKFUrnBgdTFPy8=","d407849a1cdcd66d153dede7d147896ded5bab84e54ae1d9e1fe6962234505fb":"mJlc/5YmEN+xdzHP.n2oUvT4gIfNC78Ps6gbRlSm5fVA=","d91d5de7dffd23db09ceeb90d067be821556434b0e5715de302ec7c76b00c5a1":"OThJ8xmnkyDw8YFB.sLR7oAZkd8ZOltAmUooyQ9sIVMZEPA=="};
  var CLE = "famzak:acces";
  var normaliser = function (s) { return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); };
  var toutes = [];
  Object.keys(EMPREINTES).forEach(function (k) { toutes = toutes.concat(EMPREINTES[k]); });

  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); }
  function sha256(texte) { return crypto.subtle.digest("SHA-256", new TextEncoder().encode(texte)).then(hex); }
  function octets(b64) { var t = atob(b64), u = new Uint8Array(t.length); for (var i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; }
  // Prénom rangé sous l'empreinte h, déchiffré avec le code. null si inconnu ou illisible.
  function dechiffrer(h, code) {
    var v = PRENOMS[h];
    if (!v || !(window.crypto && crypto.subtle)) return Promise.resolve(null);
    var morceaux = v.split(".");
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode("famzak-prenom:" + code))
      .then(function (k) { return crypto.subtle.importKey("raw", k, "AES-GCM", false, ["decrypt"]); })
      .then(function (cle) { return crypto.subtle.decrypt({ name: "AES-GCM", iv: octets(morceaux[0]) }, cle, octets(morceaux[1])); })
      .then(function (b) { return new TextDecoder().decode(b); }, function () { return null; });
  }
  // Renvoie { classe, code, h, prenom } si le code existe dans une classe, sinon null.
  function verifier(code) {
    code = normaliser(code);
    if (code.length < 6 || !(window.crypto && crypto.subtle)) return Promise.resolve(null);
    var classes = Object.keys(EMPREINTES);
    return Promise.all(classes.map(function (c) { return sha256(SEL + c + ":" + code); })).then(function (hs) {
      for (var i = 0; i < classes.length; i++) if (EMPREINTES[classes[i]].indexOf(hs[i]) >= 0) {
        var a = { classe: classes[i], code: code, h: hs[i] };
        return dechiffrer(a.h, code).then(function (p) { a.prenom = p; return a; });
      }
      return null;
    });
  }
  // Prénom à afficher pour un code (jamais le code lui-même). Promesse : prénom, ou null si inconnu.
  var memo = {};
  function prenom(code) {
    code = normaliser(code);
    if (!code) return Promise.resolve(null);
    var a = lire();
    if (a && a.code === code && a.prenom) return Promise.resolve(a.prenom);
    if (!memo[code]) memo[code] = verifier(code).then(function (r) { return r ? r.prenom : null; }, function () { return null; });
    return memo[code];
  }
  // Version immédiate : prénom déjà connu sur l'appareil pour ce code (ou pour le code ouvert), sinon null.
  function nom(code) {
    var a = lire();
    if (!a || (code && normaliser(code) !== a.code)) return null;
    return a.prenom || null;
  }
  function lire() {
    try { var a = JSON.parse(localStorage.getItem(CLE)); if (a && a.code && toutes.indexOf(a.h) >= 0) return a; } catch (e) {}
    try { var b = JSON.parse(sessionStorage.getItem(CLE)); if (b && b.code && toutes.indexOf(b.h) >= 0) return b; } catch (e) {}
    return null;
  }
  function ecrire(a) {
    var v = JSON.stringify({ classe: a.classe, code: a.code, h: a.h, prenom: a.prenom || null, date: a.date || new Date().toISOString().slice(0, 10) });
    try { localStorage.setItem(CLE, v); } catch (e) { try { sessionStorage.setItem(CLE, v); } catch (e2) {} }
  }
  function oublier() { try { localStorage.removeItem(CLE); } catch (e) {} try { sessionStorage.removeItem(CLE); } catch (e) {} }
  // Accès gardé d'avant la v1.1 (sans prénom) : on le complète une fois.
  (function () {
    var a = lire();
    if (a && !a.prenom) dechiffrer(a.h, a.code).then(function (p) { if (p) { a.prenom = p; ecrire(a); } });
  })();
  // ---------- Passage d'une adresse à l'autre par jeton (le code ZF n'apparaît dans aucun lien) ----------
  function serveur(route, corps) {
    var ctl = window.AbortController ? new AbortController() : null;
    var t = ctl ? setTimeout(function () { ctl.abort(); }, 5000) : 0;
    return fetch(SERVEUR + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps), signal: ctl ? ctl.signal : undefined })
      .then(function (r) { clearTimeout(t); return r.ok ? r.json() : null; }, function () { clearTimeout(t); return null; });
  }
  function jeton(a) { return serveur("/fz/jeton", { classe: a.classe, code: a.code }).then(function (d) { return d && d.jeton ? d.jeton : null; }); }
  // Jeton reçu dans l'adresse -> accès { classe, code, h, prenom } (null si expiré ou refusé)
  function ouvrirJeton(j) {
    return serveur("/fz/ouvrir", { jeton: j }).then(function (d) { return d && d.code ? verifier(d.code) : null; });
  }
  function avecJeton(url, j) {
    if (!j) return url;
    return url + (url.indexOf("#") >= 0 ? "&" : "#") + "fz=j." + encodeURIComponent(j);
  }
  // Va à url (autre adresse) en y joignant un jeton ; fenetre : onglet déjà ouvert (clic « nouvel onglet »).
  function aller(url, a, fenetre, remplacer) {
    var cible = fenetre || window;
    return jeton(a).then(function (j) {
      var u = avecJeton(url, j);
      if (remplacer && !fenetre) location.replace(u); else cible.location.href = u;
    });
  }
  // Liens vers l'autre adresse (debut = PORTAIL ou SITES) : propres au survol, jeton ajouté au clic.
  function relier(debut, acces) {
    function lien(e) {
      var l = e.target && e.target.closest && e.target.closest("a[href]");
      if (!l || e.defaultPrevented) return null;
      var h = l.href || "";
      if (h.indexOf(debut) !== 0 || /[#&]fz=/.test(h)) return null;
      return l;
    }
    function suivre(e, nouvelOnglet) {
      var l = lien(e), a = l && acces();
      if (!l || !a) return;
      e.preventDefault();
      var f = null;
      if (nouvelOnglet) { try { f = window.open("", "_blank"); if (f) f.opener = null; } catch (x) { f = null; } if (!f) return void (location.href = l.href); }
      aller(l.href, a, f);
    }
    document.addEventListener("click", function (e) {
      if (e.button !== 0) return;
      var l = lien(e); if (!l) return;
      suivre(e, e.ctrlKey || e.metaKey || e.shiftKey || l.target === "_blank");
    });
    document.addEventListener("auxclick", function (e) { if (e.button === 1) suivre(e, true); });
  }
  // Lit « #fz=… » dans l'adresse et l'efface. Renvoie une promesse : accès, ou null ; undefined s'il n'y en a pas.
  function lireAdresse() {
    var donne = null;
    var morceaux = location.hash.replace(/^#/, "").split("&").filter(function (p) {
      if (/^fz=/.test(p)) { donne = decodeURIComponent(p.slice(3)); return false; } return p !== "";
    });
    if (donne === null) return undefined;
    var reste = morceaux.join("&");
    try { history.replaceState(history.state, "", location.pathname + location.search + (reste ? "#" + reste : "")); } catch (e) {}
    if (/^j\./.test(donne)) return ouvrirJeton(donne.slice(2));
    return verifier(donne);          // ancien format (code en clair), accepté le temps que les pages en cache se renouvellent
  }

  window.FamZakVerrou = { verifier: verifier, lire: lire, ecrire: ecrire, oublier: oublier, prenom: prenom, nom: nom,
    aller: aller, relier: relier, lireAdresse: lireAdresse, PORTAIL: PORTAIL, SITES: SITES };

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
  function quandPret(f) { if (document.body) f(); else document.addEventListener("DOMContentLoaded", f); }

  // Liens vers le portail (autre adresse) : un jeton est joint au clic, pour que le code n'ait pas à être redemandé.
  function relierPortail() { relier(PORTAIL, lire); }

  // Fenêtre « Code ZF » posée sur la page, qui reste cachée tant que le code n'est pas bon.
  function demander(message) {
    cacher();
    quandPret(function () {
      if (document.getElementById("fz-verrou")) return;
      var st = document.createElement("style");
      st.textContent = "#fz-verrou{visibility:visible;position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:16px;background:#050d22;color:#e6eefc;font:17px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif}" +
        "#fz-verrou form{width:min(420px,100%);background:#0b1838;border:1px solid rgba(159,179,214,.25);border-radius:16px;padding:22px 20px;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.5)}" +
        "#fz-verrou h2{margin:0 0 4px;font-size:1.35rem}#fz-verrou p{margin:0 0 14px;color:#9fb3d6;font-size:.95rem}" +
        "#fz-verrou .l{display:flex;gap:8px}#fz-verrou input{flex:1;min-width:0;font:600 1.05rem system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;padding:10px 12px;border-radius:10px;border:1px solid rgba(159,179,214,.35);background:#050d22;color:#e6eefc}" +
        "#fz-verrou button{font:600 1rem system-ui,sans-serif;padding:10px 16px;border-radius:10px;border:0;background:#7aa2ff;color:#071433;cursor:pointer}" +
        "#fz-verrou .e{min-height:1.3em;margin:10px 0 0;color:#ff6b8b}#fz-verrou a{color:#7aa2ff}";
      document.head.appendChild(st);
      var d = document.createElement("div");
      d.id = "fz-verrou"; d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "true"); d.setAttribute("aria-labelledby", "fz-titre");
      d.innerHTML = '<form><h2 id="fz-titre">FamZakSites</h2><p>Entre ton code ZF pour ouvrir les sites.</p>' +
        '<div class="l"><input id="fz-code" type="text" placeholder="CODE ZF" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Code ZF" required><button type="submit">Entrer</button></div>' +
        '<p class="e" role="alert">' + (message || "") + '</p><p style="margin:12px 0 0"><a href="' + PORTAIL + '">Aller au portail FamZakSites</a></p></form>';
      document.body.appendChild(d);
      var champ = d.querySelector("#fz-code"), err = d.querySelector(".e");
      champ.focus();
      d.querySelector("form").addEventListener("submit", function (e) {
        e.preventDefault(); err.textContent = "";
        verifier(champ.value).then(function (a) {
          if (!a) { err.textContent = "Ce code ZF n'existe pas. Vérifie-le et réessaie."; champ.select(); return; }
          ecrire(a); sessions(a, true); location.reload();
        });
      });
    });
  }
  window.FamZakVerrou.demander = demander;

  // Déconnexion (« Changer de code » sur un site ou sur le portail) : efface le code partout.
  // Les 6 sites partagent leur stockage ; le portail, à une autre adresse, est prévenu par « #fz-sortie ».
  function effacerTout() {
    oublier();
    ["famzak:eleve", "routinesite:code", "famzak:verrou-ouvert"].forEach(function (k) { try { sessionStorage.removeItem(k); } catch (e) {} });
    try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf("mathsite-code-eleve") === 0) localStorage.removeItem(k); }); } catch (e) {}
  }
  function deconnecter() { effacerTout(); cacher(); location.href = PORTAIL + "#fz-sortie"; }
  window.FamZakVerrou.deconnecter = deconnecter;
  // Un autre onglet des sites s'est déconnecté : on referme celui-ci aussi.
  window.addEventListener("storage", function (e) { if (e.key === CLE && !e.newValue && !lire()) location.reload(); });

  // Déconnexion demandée par le portail : on efface ici puis on retourne au portail.
  if (/(^#|&)fz-sortie(&|$)/.test(location.hash)) { effacerTout(); cacher(); location.replace(PORTAIL + "#fz-sortie"); return; }

  // 1. Accès transmis dans l'adresse par le portail : #fz=j.<jeton>, éventuellement après une autre ancre
  var recu = lireAdresse();
  if (recu !== undefined) {
    cacher();
    recu.then(function (a) {
      if (!a) { var deja = lire(); if (deja) { relierPortail(); return montrer(); } return demander("Lien expiré : entre ton code ZF."); }
      // Accès reçu : on recharge (l'adresse est déjà nettoyée) pour que les scripts de la page, déjà lancés
      // pendant l'échange du jeton, démarrent avec la session ouverte.
      ecrire(a); sessions(a, true); location.reload();
    }, function () { demander(); });
    return;
  }
  // 2. Code déjà donné sur l'un des sites ou sur le portail (gardé sur l'appareil)
  var a = lire();
  if (a) { sessions(a, false); relierPortail(); return; }
  // 3. Sinon : la page reste cachée et demande le code ZF
  demander();
})();
