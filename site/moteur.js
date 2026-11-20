// Calculs du site : portage de euromillions.py (statistiques, poids, tirage pondéré,
// score de popularité). Toute modification de la logique doit être faite des deux côtés.

export const NB_NUMEROS = 50;
export const NB_ETOILES = 12;
// Le nombre d'étoiles est passé à 12 le 27/09/2016 : on ne compte les étoiles qu'à partir de là.
export const DEBUT_12_ETOILES = "2016-09-27";
export const ESSAIS_MAX = 5000;

//                fréquence, récent, retard
export const STRATEGIES = {
  equilibre: [0.3, 0.2, 0.3],
  chauds: [0.6, 0.6, -0.3],
  froids: [-0.6, -0.4, 0.6],
  aleatoire: [0, 0, 0],
};

export const NUMEROS_FETICHES = new Set([7, 3, 9, 13, 11, 17, 21, 23]);

/** Convertit le JSON produit par `euromillions.py --export-json`. */
export function lireDonnees(json) {
  return json.tirages.map(([jour, boules, etoiles]) => ({ jour, boules, etoiles }));
}

/**
 * Statistiques par valeur (1..maxi). Les tableaux sont indexés par la valeur (case 0 inutilisée).
 * attr : "boules" ou "etoiles" ; k : nombre de valeurs tirées par tirage (5 ou 2).
 */
export function calculerStats(tirages, attr, maxi, k, fenetre) {
  const n = tirages.length;
  const compte = new Array(maxi + 1).fill(0);
  const compteRecent = new Array(maxi + 1).fill(0);
  const retard = new Array(maxi + 1).fill(n);
  for (const t of tirages) for (const x of t[attr]) compte[x]++;
  const recents = tirages.slice(-fenetre);
  for (const t of recents) for (const x of t[attr]) compteRecent[x]++;
  for (let idx = 0; idx < n; idx++) {
    for (const x of tirages[n - 1 - idx][attr]) retard[x] = Math.min(retard[x], idx);
  }
  const valeurs = Array.from({ length: maxi }, (_, i) => i + 1);
  const frequence = compte.map((c) => c / n);
  const recent = compteRecent.map((c) => c / Math.max(1, recents.length));
  return { valeurs, n, nRecent: recents.length, compte, compteRecent, frequence, recent, retard, attendu: k / maxi };
}

function zscores(tab, valeurs) {
  const vals = valeurs.map((v) => tab[v]);
  const mu = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mu) ** 2, 0) / vals.length) || 1;
  const z = [];
  for (const v of valeurs) z[v] = (tab[v] - mu) / sd;
  return z;
}

/** Poids = exp(somme des coefficients × écarts normalisés). Coefficients nuls = tirage uniforme. */
export function calculerPoids(st, pFreq, pRecent, pRetard) {
  const zf = zscores(st.frequence, st.valeurs);
  const zr = zscores(st.recent, st.valeurs);
  const zd = zscores(st.retard, st.valeurs);
  const w = [];
  for (const v of st.valeurs) w[v] = Math.exp(pFreq * zf[v] + pRecent * zr[v] + pRetard * zd[v]);
  return w;
}

/** Générateur pseudo-aléatoire reproductible (mulberry32). Renvoie des flottants dans [0, 1). */
export function creerAlea(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Graine saisie par l'utilisateur : un entier tel quel, un texte haché ; vide = graine aléatoire. */
export function graineDepuisTexte(texte) {
  const s = String(texte ?? "").trim();
  if (s === "") return crypto.getRandomValues(new Uint32Array(1))[0];
  if (/^-?\d+$/.test(s)) return Number(BigInt.asUintN(32, BigInt(s)));
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.codePointAt(0), 16777619);
  return h >>> 0;
}

/** Tire k valeurs distinctes, proportionnellement aux poids. */
export function tiragePondere(alea, w, valeurs, k) {
  const restant = valeurs.map((v) => [v, w[v]]);
  const choix = [];
  for (let i = 0; i < k; i++) {
    const total = restant.reduce((s, [, p]) => s + p, 0);
    let r = alea() * total;
    let j = 0;
    while (j < restant.length - 1 && r >= restant[j][1]) r -= restant[j++][1];
    choix.push(restant[j][0]);
    restant.splice(j, 1);
  }
  return choix.sort((a, b) => a - b);
}

/** Plus le score est haut, plus la grille ressemble à ce que les joueurs cochent. */
export function scorePopularite(boules, etoiles, dejaSorties) {
  const raisons = [];
  let s = 0;
  const nb = (pred) => boules.filter(pred).length;
  if (nb((b) => b <= 31) >= 4) {
    s += boules.every((b) => b <= 31) ? 2 : 1;
    raisons.push("dates (≤ 31)");
  }
  if (nb((b) => b <= 12) >= 3) {
    s += 1;
    raisons.push("mois (≤ 12)");
  }
  const ecarts = boules.slice(1).map((b, i) => b - boules[i]);
  const suites = ecarts.filter((e) => e === 1).length;
  if (suites >= 2) {
    s += suites;
    raisons.push("suite de numéros");
  }
  if (new Set(ecarts).size === 1) {
    s += 3;
    raisons.push("progression régulière");
  }
  if (new Set(boules.map((b) => Math.floor(b / 10))).size <= 2) {
    s += 1;
    raisons.push("même dizaine");
  }
  if (nb((b) => b % 10 === boules[0] % 10) >= 3) {
    s += 1;
    raisons.push("même terminaison");
  }
  if (boules.every((b) => b % 5 === 0) || boules.every((b) => b % 2 === 0) || boules.every((b) => b % 2 === 1)) {
    s += 1;
    raisons.push("tous pairs/impairs/multiples de 5");
  }
  if (nb((b) => NUMEROS_FETICHES.has(b)) >= 3) {
    s += 1;
    raisons.push("numéros fétiches");
  }
  if (boules.reduce((a, b) => a + b, 0) < 90) {
    s += 1;
    raisons.push("somme basse (petits numéros)");
  }
  if (etoiles.includes(7) || (etoiles[0] === 1 && etoiles[1] === 2)) {
    s += 1;
    raisons.push("étoile 7 ou 1-2");
  }
  if (dejaSorties.has(boules.join("-"))) {
    s += 3;
    raisons.push("grille déjà sortie (souvent rejouée)");
  }
  return { score: s, raisons };
}

/**
 * Propose `nbGrilles` grilles distinctes. En mode anti-populaire, chaque grille est retirée
 * jusqu'à ce que son score soit ≤ seuil (au plus ESSAIS_MAX essais, comme le script).
 */
export function proposerGrilles({ alea, wBoules, wEtoiles, stBoules, stEtoiles, tirages, nbGrilles, antiPopulaire, seuil }) {
  const deja = new Set(tirages.map((t) => t.boules.join("-")));
  const vues = new Set();
  const grilles = [];
  for (let g = 0; g < nbGrilles; g++) {
    let b, e, pop, cle;
    for (let essai = 0; essai < ESSAIS_MAX; essai++) {
      b = tiragePondere(alea, wBoules, stBoules.valeurs, 5);
      e = tiragePondere(alea, wEtoiles, stEtoiles.valeurs, 2);
      pop = scorePopularite(b, e, deja);
      cle = `${b.join("-")}|${e.join("-")}`;
      if (vues.has(cle)) continue;
      if (!antiPopulaire || pop.score <= seuil) break;
    }
    vues.add(cle);
    grilles.push({ boules: b, etoiles: e, ...pop, sousLeSeuil: !antiPopulaire || pop.score <= seuil });
  }
  return grilles;
}

/** Même contenu que `euromillions.py --export`. */
export function exporterCsv(stBoules, wBoules, stEtoiles, wEtoiles) {
  const lignes = [["type", "valeur", "frequence", "ecart_theorique_pct", "frequence_recente", "retard", "poids"].join(";")];
  for (const [nom, st, w] of [["numero", stBoules, wBoules], ["etoile", stEtoiles, wEtoiles]]) {
    const total = st.valeurs.reduce((s, v) => s + w[v], 0);
    for (const v of st.valeurs) {
      const ecart = (st.frequence[v] / st.attendu) * 100 - 100;
      lignes.push([nom, v, st.frequence[v].toFixed(4), (ecart >= 0 ? "+" : "") + ecart.toFixed(1),
        st.recent[v].toFixed(4), st.retard[v], (w[v] / total).toFixed(4)].join(";"));
    }
  }
  return lignes.join("\r\n") + "\r\n";
}
