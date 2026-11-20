import * as m from "./moteur.js";

const $ = (sel) => document.querySelector(sel);
const NBSP = " ";

const fmtEntier = new Intl.NumberFormat("fr-FR");
const fmtEcart = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 0, signDisplay: "exceptZero" });
const fmtEcart1 = new Intl.NumberFormat("fr-FR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero" });
const fmtFois = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtCoef = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero" });
const fmtDate = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fmtDateHeure = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" });

const TEINTE_MAX = 0.72; // au-delà, le texte noir des cases ne reste plus lisible

const etat = {
  tirages: [],
  tirages12: [],
  fenetre: 50,
  coefs: [...m.STRATEGIES.equilibre],
  vue: "ecart",
  st: null, // { boules, etoiles }
  w: null, // { boules, etoiles }
  grilles: [],
  active: -1,
};

// --------------------------------------------------------------------------
// Petits utilitaires d'affichage
// --------------------------------------------------------------------------
function el(tag, attrs = {}, ...enfants) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else n.setAttribute(k, v);
  }
  for (const e of enfants) if (e != null) n.append(e);
  return n;
}

const SVG = "http://www.w3.org/2000/svg";
function svg(tag, attrs = {}) {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

const CHEMIN_ETOILE = (() => {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 21 : 50;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(50 + r * Math.cos(a)).toFixed(1)} ${(54 + r * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join(" L")} Z`;
})();

function iconeEtoile() {
  const s = svg("svg", { viewBox: "0 0 100 100", class: "etoile-icone", "aria-hidden": "true" });
  s.append(svg("path", { d: CHEMIN_ETOILE }));
  return s;
}

/** « 8 21 24 36 49 ★ 1 8 », avec un texte accessible « étoiles ». */
function numerosEnLigne(boules, etoiles) {
  return el("span", { class: "numeros" },
    boules.join(" "),
    iconeEtoile(),
    el("span", { class: "visuellement-cache", text: " étoiles " }),
    etoiles.join(" "));
}

const ecart = (st, v) => st.frequence[v] / st.attendu - 1;
const poidsRelatif = (st, w, v) => w[v] / (st.valeurs.reduce((s, x) => s + w[x], 0) / st.valeurs.length);
const dateLocale = (iso) => { const [a, mo, j] = iso.split("-").map(Number); return new Date(a, mo - 1, j); };

// --------------------------------------------------------------------------
// Calculs
// --------------------------------------------------------------------------
function recalculerStats() {
  etat.st = {
    boules: m.calculerStats(etat.tirages, "boules", m.NB_NUMEROS, 5, etat.fenetre),
    etoiles: m.calculerStats(etat.tirages12, "etoiles", m.NB_ETOILES, 2, etat.fenetre),
  };
  recalculerPoids();
}

function recalculerPoids() {
  const [pf, pr, pd] = etat.coefs;
  etat.w = {
    boules: m.calculerPoids(etat.st.boules, pf, pr, pd),
    etoiles: m.calculerPoids(etat.st.etoiles, pf, pr, pd),
  };
}

// --------------------------------------------------------------------------
// Le bulletin
// --------------------------------------------------------------------------
const plateaux = { boules: null, etoiles: null };

function construirePlateau(conteneur, type, maxi, parRang) {
  conteneur.replaceChildren();
  const cases = [];
  for (let debut = 1; debut <= maxi; debut += parRang) {
    const rang = el("div", { class: "rang", role: "row" });
    for (let v = debut; v < debut + parRang && v <= maxi; v++) {
      const c = el("div", { class: type === "etoiles" ? "case case-etoile" : "case", role: "gridcell", tabindex: v === 1 ? "0" : "-1" });
      c.dataset.type = type;
      c.dataset.v = v;
      if (type === "etoiles") {
        const s = svg("svg", { viewBox: "0 0 100 100", class: "contour", "aria-hidden": "true" });
        s.append(svg("path", { d: CHEMIN_ETOILE }));
        c.append(s);
      }
      c.append(el("span", { class: "num", text: String(v), "aria-hidden": "true" }));
      rang.append(c);
      cases[v] = c;
    }
    conteneur.append(rang);
  }
  brancherNavigation(conteneur);
  return cases;
}

/** Couleur d'une case selon la vue. Échelles communes aux numéros et aux étoiles. */
function echelles() {
  const { boules: sb, etoiles: se } = etat.st;
  const tous = (fn) => [...sb.valeurs.map((v) => fn("boules", v)), ...se.valeurs.map((v) => fn("etoiles", v))];
  const ecarts = tous((t, v) => ecart(etat.st[t], v));
  const retards = tous((t, v) => etat.st[t].retard[v]);
  const poids = tous((t, v) => poidsRelatif(etat.st[t], etat.w[t], v));
  return {
    ecartMax: Math.max(...ecarts.map(Math.abs)) || 1,
    retardMax: Math.max(...retards) || 1,
    poidsMin: Math.min(...poids),
    poidsMax: Math.max(...poids),
  };
}

function melange(couleur, t) {
  return `color-mix(in oklab, ${couleur} ${(t * 100).toFixed(1)}%, var(--papier))`;
}

function teinte(type, v, ech) {
  const st = etat.st[type];
  switch (etat.vue) {
    case "ecart": {
      const e = ecart(st, v);
      return melange(e >= 0 ? "var(--chaud)" : "var(--froid)", (Math.abs(e) / ech.ecartMax) * TEINTE_MAX);
    }
    case "retard":
      return melange("var(--froid)", (st.retard[v] / ech.retardMax) * TEINTE_MAX);
    case "poids": {
      // Échelle logarithmique : les poids sont multiplicatifs (×0,1 et ×10 sont aussi loin de ×1)
      const etendue = Math.log(ech.poidsMax / ech.poidsMin);
      if (etendue < 1e-9) return null;
      return melange("var(--violet)", (Math.log(poidsRelatif(st, etat.w[type], v) / ech.poidsMin) / etendue) * TEINTE_MAX);
    }
    default:
      return null;
  }
}

function descriptionCase(type, v) {
  const st = etat.st[type];
  const nom = type === "etoiles" ? `Étoile ${v}` : `Numéro ${v}`;
  const fois = (n) => `${fmtEntier.format(n)} fois`;
  const retard = st.retard[v];
  return [
    nom,
    `Sorti ${fois(st.compte[v])}, ${fmtEcart.format(ecart(st, v))} par rapport au hasard`,
    retard === 0 ? "Sorti au dernier tirage" : `Pas sorti depuis ${fmtEntier.format(retard)} tirage${retard > 1 ? "s" : ""}`,
    `Sur les ${fmtEntier.format(st.nRecent)} derniers tirages : ${fois(st.compteRecent[v])}`,
    `Poids avec vos réglages : ×${fmtFois.format(poidsRelatif(st, etat.w[type], v))}`,
  ];
}

function rendreBulletin() {
  const ech = echelles();
  $("#bulletin").dataset.vue = etat.vue;
  for (const type of ["boules", "etoiles"]) {
    for (const v of etat.st[type].valeurs) {
      const c = plateaux[type][v];
      const t = teinte(type, v, ech);
      if (t) c.style.setProperty("--teinte", t);
      else c.style.removeProperty("--teinte");
      const [nom, ...details] = descriptionCase(type, v);
      const grille = etat.grilles[etat.active];
      const coche = grille && grille[type].includes(v) ? ", dans la grille sélectionnée" : "";
      c.setAttribute("aria-label", `${nom}${coche}. ${details.join(". ")}.`);
    }
  }
  rendreLegende(ech);
}

function rendreLegende(ech) {
  const barre = $("#legende-barre");
  const grad = $("#legende-graduations");
  const texte = $("#legende-texte");
  const pct = (x) => fmtEcart.format(x);
  grad.replaceChildren();
  barre.removeAttribute("style");
  const graduations = (...vals) => grad.append(...vals.map((v) => el("span", { text: v })));
  switch (etat.vue) {
    case "ecart":
      barre.style.background = `linear-gradient(to right, ${melange("var(--froid)", TEINTE_MAX)}, var(--papier) 50%, ${melange("var(--chaud)", TEINTE_MAX)})`;
      graduations(pct(-ech.ecartMax), "0", pct(ech.ecartMax));
      texte.textContent = "Écart entre le nombre de sorties et ce que donnerait le hasard. Rouge : plus sorti que prévu, bleu : moins sorti.";
      break;
    case "retard":
      barre.style.background = `linear-gradient(to right, var(--papier), ${melange("var(--froid)", TEINTE_MAX)})`;
      graduations("0", `${fmtEntier.format(ech.retardMax)} tirages`);
      texte.textContent = "Nombre de tirages depuis la dernière sortie.";
      break;
    case "poids":
      if (Math.log(ech.poidsMax / ech.poidsMin) < 1e-9) {
        texte.textContent = "Tous les numéros ont le même poids : le tirage est uniforme.";
        break;
      }
      barre.style.background = `linear-gradient(to right, var(--papier), ${melange("var(--violet)", TEINTE_MAX)})`;
      graduations(`×${fmtFois.format(ech.poidsMin)}`, `×${fmtFois.format(ech.poidsMax)}`);
      texte.textContent = "Poids donné à chaque numéro par vos réglages, comparé à un tirage uniforme (×1), sur une échelle logarithmique. Il change avec la stratégie et les réglages fins.";
      break;
    default:
      texte.textContent = "Les numéros entourés sont ceux de la grille sélectionnée.";
  }
}

// Trait de stylo : une ellipse tracée à la main, un peu de travers, qui se referme en dépassant.
function cheminStylo(graine) {
  const a = m.creerAlea(graine * 7919 + 17);
  const rx = 40 + a() * 4, ry = 36 + a() * 5, rot = (a() - 0.5) * 0.6;
  const debut = a() * Math.PI * 2, tour = Math.PI * 2 + 0.45 + a() * 0.4;
  const pts = [];
  const N = 44;
  for (let i = 0; i <= N; i++) {
    const th = debut + (tour * i) / N;
    const r = 1 + 0.03 * Math.sin(3 * th + graine) + (i / N) * 0.07;
    const x = rx * r * Math.cos(th), y = ry * r * Math.sin(th);
    pts.push(`${(50 + x * Math.cos(rot) - y * Math.sin(rot)).toFixed(1)} ${(50 + x * Math.sin(rot) + y * Math.cos(rot)).toFixed(1)}`);
  }
  return `M${pts.join(" L")}`;
}

function dessinerGrille(animer) {
  document.querySelectorAll("#bulletin .stylo").forEach((n) => n.remove());
  const grille = etat.grilles[etat.active];
  if (!grille) return;
  let ordre = 0;
  for (const type of ["boules", "etoiles"]) {
    for (const v of grille[type]) {
      const s = svg("svg", { viewBox: "0 0 100 100", class: animer ? "stylo trace" : "stylo", "aria-hidden": "true" });
      s.style.setProperty("--delai", `${ordre++ * 90}ms`);
      s.append(svg("path", { d: cheminStylo(v + (type === "etoiles" ? 100 : 0)), pathLength: "1" }));
      plateaux[type][v].append(s);
    }
  }
}

// Navigation au clavier dans le bulletin (un seul arrêt de tabulation par plateau)
function brancherNavigation(conteneur) {
  conteneur.addEventListener("keydown", (ev) => {
    const c = ev.target.closest(".case");
    if (!c) return;
    const cases = [...conteneur.querySelectorAll(".case")];
    const i = cases.indexOf(c);
    const colonnes = getComputedStyle(c.parentElement).gridTemplateColumns.split(" ").length;
    const cible = { ArrowRight: i + 1, ArrowLeft: i - 1, ArrowDown: i + colonnes, ArrowUp: i - colonnes, Home: 0, End: cases.length - 1 }[ev.key];
    if (ev.key === "Escape") return cacherInfobulle();
    if (cible === undefined || cible < 0 || cible >= cases.length) return;
    ev.preventDefault();
    c.tabIndex = -1;
    cases[cible].tabIndex = 0;
    cases[cible].focus();
  });
}

// Infobulle : mêmes informations au survol et au focus clavier
function montrerInfobulle(c) {
  const bulle = $("#infobulle");
  const [nom, ...details] = descriptionCase(c.dataset.type, Number(c.dataset.v));
  bulle.replaceChildren(el("strong", { text: nom }), ...details.map((d) => el("p", { text: d })));
  bulle.hidden = false;
  const b = $("#bulletin").getBoundingClientRect();
  const r = c.getBoundingClientRect();
  const largeur = bulle.offsetWidth, hauteur = bulle.offsetHeight;
  let x = r.left - b.left + r.width / 2 - largeur / 2;
  x = Math.max(8, Math.min(x, b.width - largeur - 8));
  let y = r.top - b.top - hauteur - 8;
  if (y < 8) y = r.bottom - b.top + 8;
  bulle.style.left = `${x}px`;
  bulle.style.top = `${y}px`;
}
function cacherInfobulle() { $("#infobulle").hidden = true; }

function brancherInfobulle() {
  const bulletin = $("#bulletin");
  bulletin.addEventListener("pointerover", (ev) => {
    const c = ev.target.closest(".case");
    if (c) montrerInfobulle(c);
  });
  bulletin.addEventListener("pointerleave", cacherInfobulle);
  bulletin.addEventListener("focusin", (ev) => {
    const c = ev.target.closest(".case");
    if (c) montrerInfobulle(c);
  });
  bulletin.addEventListener("focusout", cacherInfobulle);
}

// --------------------------------------------------------------------------
// Réglages et grilles
// --------------------------------------------------------------------------
const curseurs = ["#poids-frequence", "#poids-recent", "#poids-retard"];

function afficherCoefs() {
  curseurs.forEach((sel, i) => {
    const input = $(sel);
    input.value = String(etat.coefs[i]);
    input.nextElementSibling.textContent = fmtCoef.format(etat.coefs[i]);
  });
}

function libelleBouton() {
  const n = Number($("#nb-grilles").value) || 1;
  $("#tirer").textContent = n > 1 ? `Tirer ${n} grilles` : "Tirer une grille";
}

function tirer(ev) {
  ev.preventDefault();
  const form = $("#reglages");
  if (!form.reportValidity()) return;
  const anti = $("#anti-populaire").checked;
  etat.grilles = m.proposerGrilles({
    alea: m.creerAlea(m.graineDepuisTexte($("#graine").value)),
    wBoules: etat.w.boules,
    wEtoiles: etat.w.etoiles,
    stBoules: etat.st.boules,
    stEtoiles: etat.st.etoiles,
    tirages: etat.tirages,
    nbGrilles: Math.min(10, Math.max(1, Number($("#nb-grilles").value) || 1)),
    antiPopulaire: anti,
    seuil: Number($("#seuil").value) || 0,
  });
  etat.active = 0;
  rendreGrilles();
  dessinerGrille(true);
  rendreBulletin();
  const n = etat.grilles.length;
  $("#annonce").textContent = `${n > 1 ? `${n} grilles tirées` : "Grille tirée"}. ${texteGrille(etat.grilles[0])}`;
  const haut = $("#bulletin").getBoundingClientRect().top;
  if (haut < 0 || haut > innerHeight * 0.6) {
    const reduit = matchMedia("(prefers-reduced-motion: reduce)").matches;
    $(".colonne-bulletin").scrollIntoView({ behavior: reduit ? "auto" : "smooth", block: "start" });
  }
}

const texteGrille = (g) => `Numéros ${g.boules.join(", ")}, étoiles ${g.etoiles.join(" et ")}.`;

function rendreGrilles() {
  const liste = $("#grilles");
  liste.replaceChildren();
  const anti = $("#anti-populaire").checked;
  etat.grilles.forEach((g, i) => {
    let pop = `Popularité ${g.score}`;
    if (g.raisons.length) pop += ` : ${g.raisons.join(", ")}`;
    const p = el("span", { class: "grille-pop", text: pop });
    if (anti && !g.sousLeSeuil) {
      p.classList.add("hors-seuil");
      p.textContent = `${pop}. Aucune grille sous le seuil après ${fmtEntier.format(m.ESSAIS_MAX)} essais : celle-ci le dépasse.`;
    }
    const bouton = el("button", { type: "button", "aria-pressed": String(i === etat.active) },
      el("span", { class: "grille-nom", text: `Grille ${i + 1}` }),
      el("span", { class: "grille-numeros" }, numerosEnLigne(g.boules, g.etoiles)),
      p);
    bouton.addEventListener("click", () => {
      etat.active = i;
      liste.querySelectorAll("button").forEach((b, j) => b.setAttribute("aria-pressed", String(j === i)));
      dessinerGrille(true);
      rendreBulletin();
    });
    liste.append(el("li", {}, bouton));
  });
}

function brancherReglages() {
  const form = $("#reglages");
  form.addEventListener("submit", tirer);

  document.querySelectorAll('input[name="vue"]').forEach((r) => r.addEventListener("change", () => {
    etat.vue = r.value;
    rendreBulletin();
  }));

  document.querySelectorAll('input[name="strategie"]').forEach((r) => r.addEventListener("change", () => {
    if (r.value !== "personnalisee") etat.coefs = [...m.STRATEGIES[r.value]];
    else $(".fins").open = true;
    afficherCoefs();
    recalculerPoids();
    rendreBulletin();
    rendreTableaux();
  }));

  curseurs.forEach((sel, i) => $(sel).addEventListener("input", (ev) => {
    etat.coefs[i] = Number(ev.target.value);
    ev.target.nextElementSibling.textContent = fmtCoef.format(etat.coefs[i]);
    document.querySelector('input[name="strategie"][value="personnalisee"]').checked = true;
    recalculerPoids();
    rendreBulletin();
    rendreTableaux();
  }));

  $("#fenetre").addEventListener("change", (ev) => {
    const n = Math.round(Number(ev.target.value));
    if (!(n >= 1)) return;
    etat.fenetre = n;
    recalculerStats();
    rendreBulletin();
    rendreChiffres();
  });

  $("#anti-populaire").addEventListener("change", (ev) => { $("#seuil").disabled = !ev.target.checked; });
  $("#nb-grilles").addEventListener("input", libelleBouton);
  $("#csv").addEventListener("click", telechargerCsv);
}

// --------------------------------------------------------------------------
// Ce que disent les chiffres
// --------------------------------------------------------------------------
function palmares(dl, type, combien) {
  const st = etat.st[type];
  const parFreq = [...st.valeurs].sort((a, b) => st.frequence[b] - st.frequence[a]);
  const parRetard = [...st.valeurs].sort((a, b) => st.retard[b] - st.retard[a]);
  const item = (v, detail) => el("span", {}, el("span", { class: "valeur", text: String(v) }), el("span", { class: "detail", text: detail }));
  const accord = type === "etoiles" ? "e" : "";
  dl.replaceChildren(
    el("dt", { text: `Les plus sorti${accord}s` }),
    el("dd", {}, ...parFreq.slice(0, combien).map((v) => item(v, fmtEcart.format(ecart(st, v))))),
    el("dt", { text: `Les moins sorti${accord}s` }),
    el("dd", {}, ...parFreq.slice(-combien).reverse().map((v) => item(v, fmtEcart.format(ecart(st, v))))),
    el("dt", { text: "En plus gros retard" }),
    el("dd", {}, ...parRetard.slice(0, combien).map((v) => item(v, `${st.retard[v]} tir.`))),
  );
}

function tableau(table, type) {
  const st = etat.st[type];
  const w = etat.w[type];
  const nom = type === "etoiles" ? "Étoile" : "Numéro";
  const entetes = [nom, "Sorties", "Écart au hasard", `Sur les ${st.nRecent} derniers`, "Retard (tirages)", "Poids"];
  table.replaceChildren(
    el("caption", { text: type === "etoiles" ? "Étoiles (depuis le 27/09/2016)" : "Numéros" }),
    el("thead", {}, el("tr", {}, ...entetes.map((t) => el("th", { scope: "col", text: t })))),
    el("tbody", {}, ...st.valeurs.map((v) => el("tr", {},
      el("th", { scope: "row", text: String(v) }),
      el("td", { text: fmtEntier.format(st.compte[v]) }),
      el("td", { text: fmtEcart1.format(ecart(st, v)) }),
      el("td", { text: fmtEntier.format(st.compteRecent[v]) }),
      el("td", { text: fmtEntier.format(st.retard[v]) }),
      el("td", { text: `×${fmtFois.format(poidsRelatif(st, w, v))}` }),
    ))),
  );
}

function rendreChiffres() {
  const st = etat.st.boules;
  const n = st.n;
  const p = 5 / 50;
  const parFreq = [...st.valeurs].sort((a, b) => st.frequence[b] - st.frequence[a]);
  const plus = parFreq[0], moins = parFreq.at(-1);
  // Écart type relatif attendu d'une loi binomiale (n, p), comparé à celui qu'on observe
  const sdHasard = Math.sqrt((1 - p) / (n * p));
  const sdObserve = Math.sqrt(st.valeurs.reduce((s, v) => s + ecart(st, v) ** 2, 0) / st.valeurs.length);
  const pctAbs = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 1 });
  $("#resume").textContent =
    `Sur ${fmtEntier.format(n)} tirages, chaque numéro devrait être sorti environ ${fmtEntier.format(Math.round(n * p))} fois. ` +
    `Le plus sorti, le ${plus}, l'a été ${fmtEntier.format(st.compte[plus])} fois (${fmtEcart.format(ecart(st, plus))}) ; ` +
    `le moins sorti, le ${moins}, ${fmtEntier.format(st.compte[moins])} fois (${fmtEcart.format(ecart(st, moins))}). ` +
    `Ces écarts semblent grands, mais le hasard seul en produit d'aussi grands : avec ${fmtEntier.format(n)} tirages, ` +
    `on attend un écart typique de ±${pctAbs.format(sdHasard)} par numéro, et on observe ±${pctAbs.format(sdObserve)}.`;
  palmares($("#palmares-boules"), "boules", 8);
  palmares($("#palmares-etoiles"), "etoiles", 4);
  rendreTableaux();
}

function rendreTableaux() {
  tableau($("#table-boules"), "boules");
  tableau($("#table-etoiles"), "etoiles");
}

function telechargerCsv() {
  const csv = m.exporterCsv(etat.st.boules, etat.w.boules, etat.st.etoiles, etat.w.etoiles);
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = el("a", { href: url, download: "euromillions-statistiques.csv" });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --------------------------------------------------------------------------
// Démarrage
// --------------------------------------------------------------------------
async function demarrer() {
  let json;
  try {
    const rep = await fetch("data/tirages.json", { cache: "no-cache" });
    if (!rep.ok) throw new Error(`HTTP ${rep.status}`);
    json = await rep.json();
  } catch (e) {
    const err = $("#erreur");
    err.append(
      `Les tirages n'ont pas pu être chargés (data/tirages.json : ${e.message}). En local, générez le fichier avec `,
      el("code", { text: "python3 euromillions.py --export-json site/data/tirages.json" }),
      " puis servez le dossier avec ",
      el("code", { text: "python3 -m http.server -d site" }),
      ".");
    err.hidden = false;
    return;
  }

  etat.tirages = m.lireDonnees(json);
  etat.tirages12 = etat.tirages.filter((t) => t.jour >= m.DEBUT_12_ETOILES);
  recalculerStats();

  const dernier = etat.tirages.at(-1);
  const d = $("#dernier");
  d.append(`Dernier tirage, ${fmtDate.format(dateLocale(dernier.jour))}${NBSP}: `, numerosEnLigne(dernier.boules, dernier.etoiles));
  d.hidden = false;
  $("#source").textContent =
    `Données : archives officielles des tirages publiées par la FDJ (${fmtEntier.format(etat.tirages.length)} tirages), ` +
    `mises à jour le ${fmtDateHeure.format(new Date(json.genere_le))}.`;

  plateaux.boules = construirePlateau($("#plateau-boules"), "boules", m.NB_NUMEROS, 10);
  plateaux.etoiles = construirePlateau($("#plateau-etoiles"), "etoiles", m.NB_ETOILES, 12);
  brancherInfobulle();
  brancherReglages();
  afficherCoefs();
  libelleBouton();
  rendreBulletin();
  rendreChiffres();
  $("#atelier").hidden = false;
  $("#chiffres").hidden = false;
}

demarrer();
