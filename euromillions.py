#!/usr/bin/env python3
"""
EuroMillions : historique des tirages, statistiques et proposition de grilles.

Rappel honnête : chaque tirage est indépendant et uniforme. Aucune pondération
basée sur le passé (numéros « chauds », « froids », retards...) ne change la
probabilité de gagner (1 chance sur 139 838 160 pour le rang 1).
La seule chose qu'un algorithme peut améliorer, c'est l'ESPÉRANCE DE GAIN en
évitant les combinaisons très jouées (dates, suites, motifs) : on ne gagne pas
plus souvent, mais on partage moins le gain si on gagne. C'est le mode
--anti-populaire.

Aucune dépendance : Python 3.8+ uniquement (bibliothèque standard).

Exemples :
    python3 euromillions.py                        # télécharge, stats, 1 grille
    python3 euromillions.py --grilles 5 --anti-populaire
    python3 euromillions.py --strategie froids --fenetre 100
    python3 euromillions.py --poids-frequence 0.5 --poids-retard 1 --poids-recent 0
    python3 euromillions.py --hors-ligne           # réutilise les fichiers déjà téléchargés
    python3 euromillions.py --dossier ~/Téléchargements/fdj   # ZIP/CSV téléchargés à la main
    python3 euromillions.py --export-json site/data/tirages.json   # données du site web
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import math
import random
import re
import statistics
import sys
import urllib.request
import zipfile
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path

# --------------------------------------------------------------------------
# Source des données : archives officielles FDJ
# https://www.fdj.fr/jeux-de-tirage/euromillions-my-million/historique
# --------------------------------------------------------------------------
PAGE_HISTORIQUE = "https://www.fdj.fr/jeux-de-tirage/euromillions-my-million/historique"
BASE_DOC = "https://www.sto.api.fdj.fr/anonymous/service-draw-info/v3/documentations/"
ARCHIVES_CONNUES = {
    # nom local : identifiant FDJ (vérifiés en novembre 2026)
    "euromillions_2004_2011.zip": "1a2b3c4d-9876-4562-b3fc-2c963f66afa8",
    "euromillions_2011_2014.zip": "1a2b3c4d-9876-4562-b3fc-2c963f66afa9",
    "euromillions_2014_2016.zip": "1a2b3c4d-9876-4562-b3fc-2c963f66afb6",
    "euromillions_2016_2019.zip": "1a2b3c4d-9876-4562-b3fc-2c963f66afc6",
    "euromillions_2019_2020.zip": "1a2b3c4d-9876-4562-b3fc-2c963f66afd6",
    "euromillions_2020_actuel.zip": "1a2b3c4d-9876-4562-b3fc-2c963f66afe6",
}
ARCHIVE_COURANTE = "euromillions_2020_actuel.zip"  # la seule qui change : re-téléchargée à chaque lancement

NB_NUMEROS, NB_ETOILES = 50, 12
# Le nombre d'étoiles a changé : 9 jusqu'en mai 2011, 11 jusqu'au 24/09/2016, 12 ensuite.
DEBUT_12_ETOILES = date(2016, 9, 27)

USER_AGENT = "Mozilla/5.0 (compatible; euromillions-stats/1.0)"


@dataclass(frozen=True)
class Tirage:
    jour: date
    boules: tuple[int, ...]
    etoiles: tuple[int, ...]


# --------------------------------------------------------------------------
# Téléchargement
# --------------------------------------------------------------------------
def _get(url: str, timeout: int = 30) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def _ids_depuis_page() -> list[str]:
    """Cherche sur la page FDJ les identifiants d'archives (au cas où ils changent)."""
    try:
        html = _get(PAGE_HISTORIQUE).decode("utf-8", "replace")
    except Exception:
        return []
    return sorted(set(re.findall(r"documentations/([0-9a-f-]{36})", html)))


def telecharger(dossier: Path) -> list[str]:
    """Télécharge les archives FDJ. Renvoie les archives connues toujours absentes du dossier."""
    dossier.mkdir(parents=True, exist_ok=True)
    echecs = []
    for nom, ident in ARCHIVES_CONNUES.items():
        cible = dossier / nom
        if cible.exists() and nom != ARCHIVE_COURANTE:
            continue
        try:
            contenu = _get(BASE_DOC + ident)
            if not contenu.startswith(b"PK"):
                raise ValueError("réponse inattendue (pas un ZIP)")
            cible.write_bytes(contenu)
            print(f"  téléchargé  {nom} ({len(contenu) // 1024} Ko)")
        except Exception as e:  # noqa: BLE001
            echecs.append((nom, e))

    if echecs:
        # Les identifiants ont peut-être changé : on relit la page historique.
        connus = set(ARCHIVES_CONNUES.values())
        nouveaux = [i for i in _ids_depuis_page() if i not in connus]
        for ident in nouveaux:
            try:
                contenu = _get(BASE_DOC + ident)
                if contenu.startswith(b"PK"):
                    (dossier / f"euromillions_{ident}.zip").write_bytes(contenu)
                    print(f"  téléchargé  archive {ident}")
            except Exception:  # noqa: BLE001
                pass
        for nom, e in echecs:
            etat = "copie locale utilisée" if (dossier / nom).exists() else "MANQUANT"
            print(f"  ⚠ échec {nom} : {e} ({etat})", file=sys.stderr)
    return [nom for nom in ARCHIVES_CONNUES if not (dossier / nom).exists()]


def exporter_json(tirages: list[Tirage], chemin: Path) -> None:
    """Écrit l'historique au format lu par le site web (site/app.js)."""
    chemin.parent.mkdir(parents=True, exist_ok=True)
    donnees = {
        "genere_le": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": PAGE_HISTORIQUE,
        "tirages": [[t.jour.isoformat(), list(t.boules), list(t.etoiles)] for t in tirages],
    }
    chemin.write_text(json.dumps(donnees, separators=(",", ":")), encoding="utf-8")


# --------------------------------------------------------------------------
# Lecture des CSV FDJ (formats variables selon les années)
# --------------------------------------------------------------------------
def _parse_date(s: str) -> date | None:
    s = s.strip()
    for fmt in ("%d/%m/%Y", "%d/%m/%y", "%Y%m%d", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _lire_csv(texte: str) -> list[Tirage]:
    premiere = texte.splitlines()[0] if texte else ""
    sep = ";" if premiere.count(";") >= premiere.count(",") else ","
    lecteur = csv.DictReader(io.StringIO(texte), delimiter=sep)
    if not lecteur.fieldnames:
        return []
    champs = {c.strip().lower(): c for c in lecteur.fieldnames if c}
    col_date = champs.get("date_de_tirage")
    cols_b = [champs.get(f"boule_{i}") for i in range(1, 6)]
    cols_e = [champs.get(f"etoile_{i}") for i in range(1, 3)]
    if not col_date or None in cols_b or None in cols_e:
        return []
    tirages = []
    for ligne in lecteur:
        try:
            jour = _parse_date(ligne[col_date])
            boules = tuple(sorted(int(ligne[c]) for c in cols_b))
            etoiles = tuple(sorted(int(ligne[c]) for c in cols_e))
        except (TypeError, ValueError, KeyError):
            continue
        if jour and len(set(boules)) == 5 and len(set(etoiles)) == 2:
            tirages.append(Tirage(jour, boules, etoiles))
    return tirages


def _decoder(brut: bytes) -> str:
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return brut.decode(enc)
        except UnicodeDecodeError:
            continue
    return brut.decode("latin-1", "replace")


def charger(dossier: Path) -> list[Tirage]:
    tous: dict[date, Tirage] = {}
    for f in sorted(dossier.iterdir()):
        sources: list[bytes] = []
        if f.suffix.lower() == ".zip" or zipfile.is_zipfile(f):
            with zipfile.ZipFile(f) as z:
                sources = [z.read(n) for n in z.namelist() if n.lower().endswith(".csv")]
        elif f.suffix.lower() == ".csv":
            sources = [f.read_bytes()]
        for brut in sources:
            for t in _lire_csv(_decoder(brut)):
                tous[t.jour] = t  # dédoublonnage par date
    return sorted(tous.values(), key=lambda t: t.jour)


# --------------------------------------------------------------------------
# Statistiques
# --------------------------------------------------------------------------
@dataclass
class Stats:
    frequence: dict[int, float]   # fréquence d'apparition sur tout l'historique (0..1)
    recent: dict[int, float]      # fréquence sur les N derniers tirages
    retard: dict[int, int]        # nb de tirages depuis la dernière sortie
    attendu: float                # fréquence théorique (5/50 ou 2/12)


def calculer_stats(tirages: list[Tirage], attr: str, maxi: int, k: int, fenetre: int) -> Stats:
    n = len(tirages)
    compte = {i: 0 for i in range(1, maxi + 1)}
    for t in tirages:
        for x in getattr(t, attr):
            compte[x] += 1
    recents = tirages[-fenetre:]
    compte_r = {i: 0 for i in range(1, maxi + 1)}
    for t in recents:
        for x in getattr(t, attr):
            compte_r[x] += 1
    retard = {i: n for i in range(1, maxi + 1)}
    for idx, t in enumerate(reversed(tirages)):
        for x in getattr(t, attr):
            retard[x] = min(retard[x], idx)
    return Stats(
        frequence={i: c / n for i, c in compte.items()},
        recent={i: c / max(1, len(recents)) for i, c in compte_r.items()},
        retard=retard,
        attendu=k / maxi,
    )


def _zscores(d: dict[int, float]) -> dict[int, float]:
    vals = list(d.values())
    mu = statistics.fmean(vals)
    sd = statistics.pstdev(vals) or 1.0
    return {k: (v - mu) / sd for k, v in d.items()}


def poids(st: Stats, p_freq: float, p_recent: float, p_retard: float) -> dict[int, float]:
    """Poids = exp(somme des coefficients × écarts normalisés). 0 partout = uniforme."""
    zf, zr, zd = _zscores(st.frequence), _zscores(st.recent), _zscores(
        {k: float(v) for k, v in st.retard.items()}
    )
    return {k: math.exp(p_freq * zf[k] + p_recent * zr[k] + p_retard * zd[k]) for k in zf}


def tirage_pondere(rng: random.Random, w: dict[int, float], k: int) -> list[int]:
    """Tire k valeurs distinctes, proportionnellement aux poids."""
    restant = dict(w)
    choix = []
    for _ in range(k):
        x = rng.choices(list(restant), weights=list(restant.values()))[0]
        choix.append(x)
        del restant[x]
    return sorted(choix)


# --------------------------------------------------------------------------
# Mode anti-combinaisons populaires
# --------------------------------------------------------------------------
NUMEROS_FETICHES = {7, 3, 9, 13, 11, 17, 21, 23}


def score_popularite(boules: list[int], etoiles: list[int], deja_sorties: set) -> tuple[int, list[str]]:
    """Plus le score est haut, plus la grille ressemble à ce que les joueurs cochent."""
    raisons = []
    s = 0
    if sum(b <= 31 for b in boules) >= 4:
        s += 2 if all(b <= 31 for b in boules) else 1
        raisons.append("dates (≤ 31)")
    if sum(b <= 12 for b in boules) >= 3:
        s += 1
        raisons.append("mois (≤ 12)")
    suites = sum(1 for a, b in zip(boules, boules[1:]) if b - a == 1)
    if suites >= 2:
        s += suites
        raisons.append("suite de numéros")
    ecarts = {b - a for a, b in zip(boules, boules[1:])}
    if len(ecarts) == 1:
        s += 3
        raisons.append("progression régulière")
    if len({b // 10 for b in boules}) <= 2:
        s += 1
        raisons.append("même dizaine")
    if sum(b % 10 == boules[0] % 10 for b in boules) >= 3:
        s += 1
        raisons.append("même terminaison")
    if all(b % 5 == 0 for b in boules) or all(b % 2 == 0 for b in boules) or all(b % 2 for b in boules):
        s += 1
        raisons.append("tous pairs/impairs/multiples de 5")
    if sum(b in NUMEROS_FETICHES for b in boules) >= 3:
        s += 1
        raisons.append("numéros fétiches")
    if sum(boules) < 90:
        s += 1
        raisons.append("somme basse (petits numéros)")
    if set(etoiles) & {7} or etoiles == [1, 2]:
        s += 1
        raisons.append("étoile 7 ou 1-2")
    if tuple(boules) in deja_sorties:
        s += 3
        raisons.append("grille déjà sortie (souvent rejouée)")
    return s, raisons


# --------------------------------------------------------------------------
# Programme principal
# --------------------------------------------------------------------------
STRATEGIES = {
    #             fréquence, récent, retard
    "aleatoire": (0.0, 0.0, 0.0),
    "chauds":    (0.6, 0.6, -0.3),
    "froids":    (-0.6, -0.4, 0.6),
    "equilibre": (0.3, 0.2, 0.3),
}


def afficher_stats(nom: str, st: Stats, top: int = 8, e: str = "") -> None:
    tri = sorted(st.frequence, key=lambda k: st.frequence[k], reverse=True)
    fmt = lambda ks: "  ".join(f"{k:>2} ({st.frequence[k] / st.attendu * 100 - 100:+.0f}%)" for k in ks)
    print(f"\n{nom} les plus sorti{e}s   : {fmt(tri[:top])}")
    print(f"{nom} les moins sorti{e}s  : {fmt(tri[-top:][::-1])}")
    ret = sorted(st.retard, key=lambda k: st.retard[k], reverse=True)[:top]
    print(f"{nom} en plus gros retard : " + "  ".join(f"{k:>2} ({st.retard[k]} tir.)" for k in ret))


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Statistiques EuroMillions et proposition de grilles pondérées.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Rappel : la pondération ne change PAS vos chances. Jouez avec modération (09 74 75 13 13).",
    )
    ap.add_argument("--dossier", type=Path, default=Path(__file__).resolve().parent / "donnees",
                    help="dossier des ZIP/CSV FDJ (défaut : ./donnees à côté du script)")
    ap.add_argument("--hors-ligne", action="store_true", help="ne rien télécharger, utiliser le dossier tel quel")
    ap.add_argument("--grilles", type=int, default=1, help="nombre de grilles à proposer (défaut 1)")
    ap.add_argument("--strategie", choices=STRATEGIES, default="equilibre",
                    help="préréglage de pondération (défaut equilibre)")
    ap.add_argument("--poids-frequence", type=float, help="poids de la fréquence historique (+ = favorise les numéros souvent sortis)")
    ap.add_argument("--poids-recent", type=float, help="poids de la fréquence récente (sur --fenetre tirages)")
    ap.add_argument("--poids-retard", type=float, help="poids du retard (+ = favorise les numéros pas sortis depuis longtemps)")
    ap.add_argument("--fenetre", type=int, default=50, help="nb de tirages pour la fréquence récente (défaut 50)")
    ap.add_argument("--anti-populaire", action="store_true",
                    help="écarter les grilles qui ressemblent aux choix courants des joueurs")
    ap.add_argument("--seuil", type=int, default=1, help="score de popularité max accepté en mode anti-populaire (défaut 1)")
    ap.add_argument("--graine", type=int, help="graine aléatoire (pour reproduire un résultat)")
    ap.add_argument("--export", type=Path, help="écrire les statistiques par numéro dans ce fichier CSV")
    ap.add_argument("--sans-stats", action="store_true", help="n'afficher que les grilles")
    ap.add_argument("--export-json", type=Path,
                    help="écrire l'historique dans ce fichier JSON pour le site web, puis s'arrêter "
                         "(échoue si une archive manque, pour ne jamais publier un historique incomplet)")
    a = ap.parse_args()

    manquants: list[str] = []
    if not a.hors_ligne:
        print("Mise à jour de l'historique FDJ…")
        manquants = telecharger(a.dossier)
    if not a.dossier.exists():
        print(f"Dossier introuvable : {a.dossier}", file=sys.stderr)
        return 1
    tirages = charger(a.dossier)
    if not tirages:
        print("Aucun tirage lu. Téléchargez les archives ZIP sur\n  " + PAGE_HISTORIQUE +
              f"\net placez-les dans {a.dossier}, puis relancez avec --hors-ligne.", file=sys.stderr)
        return 1

    if a.export_json:
        if manquants:
            print(f"Export JSON annulé, archives manquantes : {', '.join(manquants)}", file=sys.stderr)
            return 1
        exporter_json(tirages, a.export_json)
        print(f"{len(tirages)} tirages (du {tirages[0].jour:%d/%m/%Y} au {tirages[-1].jour:%d/%m/%Y}) "
              f"exportés dans {a.export_json}")
        return 0

    tirages_12 = [t for t in tirages if t.jour >= DEBUT_12_ETOILES]
    st_b = calculer_stats(tirages, "boules", NB_NUMEROS, 5, a.fenetre)
    st_e = calculer_stats(tirages_12 or tirages, "etoiles", NB_ETOILES, 2, a.fenetre)

    dernier = tirages[-1]
    print(f"\n{len(tirages)} tirages chargés, du {tirages[0].jour:%d/%m/%Y} au {dernier.jour:%d/%m/%Y}.")
    print(f"Dernier tirage : {' - '.join(map(str, dernier.boules))}  ★ {' - '.join(map(str, dernier.etoiles))}")
    if not a.sans_stats:
        print("(entre parenthèses : écart à la fréquence théorique ; les étoiles sont comptées depuis le passage à 12, en 2016)")
        afficher_stats("Numéros", st_b)
        afficher_stats("Étoiles", st_e, top=4, e="e")

    pf, pr, pd = STRATEGIES[a.strategie]
    pf = pf if a.poids_frequence is None else a.poids_frequence
    pr = pr if a.poids_recent is None else a.poids_recent
    pd = pd if a.poids_retard is None else a.poids_retard
    w_b, w_e = poids(st_b, pf, pr, pd), poids(st_e, pf, pr, pd)

    rng = random.Random(a.graine)
    deja = {t.boules for t in tirages}
    print(f"\nPondération : fréquence {pf:+.2f}, récent {pr:+.2f}, retard {pd:+.2f}"
          + ("  |  mode anti-populaire" if a.anti_populaire else ""))
    print("-" * 60)
    vues = set()
    for g in range(1, a.grilles + 1):
        for essai in range(5000):
            b = tirage_pondere(rng, w_b, 5)
            e = tirage_pondere(rng, w_e, 2)
            score, raisons = score_popularite(b, e, deja)
            if (tuple(b), tuple(e)) in vues:
                continue
            if not a.anti_populaire or score <= a.seuil:
                break
        vues.add((tuple(b), tuple(e)))
        info = f"popularité {score}" + (f" ({', '.join(raisons)})" if raisons else "")
        print(f"Grille {g} :  {'  '.join(f'{x:>2}' for x in b)}   ★ {'  '.join(f'{x:>2}' for x in e)}    [{info}]")
    print("-" * 60)
    print("Probabilité du rang 1 : 1 / 139 838 160, quelle que soit la grille.")

    if a.export:
        with a.export.open("w", newline="", encoding="utf-8") as f:
            wr = csv.writer(f, delimiter=";")
            wr.writerow(["type", "valeur", "frequence", "ecart_theorique_pct", "frequence_recente", "retard", "poids"])
            for nom, st, w in (("numero", st_b, w_b), ("etoile", st_e, w_e)):
                total = sum(w.values())
                for k in sorted(st.frequence):
                    wr.writerow([nom, k, f"{st.frequence[k]:.4f}",
                                 f"{st.frequence[k] / st.attendu * 100 - 100:+.1f}",
                                 f"{st.recent[k]:.4f}", st.retard[k], f"{w[k] / total:.4f}"])
        print(f"Statistiques exportées dans {a.export}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
