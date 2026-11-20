# EuroMillions : historique, statistiques, grilles pondérées

Deux versions qui font les mêmes calculs :

- **le site** : https://m-xime.github.io/euro-million/ (rien à installer) ;
- **le script** : un seul fichier, `euromillions.py`, sans dépendance (Python 3.8 ou plus récent).

## Lancer

```bash
python3 euromillions.py
```

Au premier lancement, le script télécharge les 6 archives officielles de la FDJ (de 2004 à aujourd'hui) dans un dossier `donnees/` à côté du script. Ensuite, il ne re-télécharge que l'archive en cours, qui est la seule à recevoir de nouveaux tirages. Il affiche les statistiques puis propose une grille.

Si le téléchargement échoue (pare-feu, ou la FDJ a changé ses liens), récupère les ZIP à la main sur
https://www.fdj.fr/jeux-de-tirage/euromillions-my-million/historique, mets-les dans `donnees/` et lance :

```bash
python3 euromillions.py --hors-ligne
```

## Options utiles

| Option | Effet |
|---|---|
| `--grilles 5` | propose 5 grilles différentes |
| `--strategie chauds` | favorise les numéros souvent sortis, en général et récemment |
| `--strategie froids` | favorise les numéros peu sortis ou en retard |
| `--strategie equilibre` | mélange léger des deux (par défaut) |
| `--strategie aleatoire` | aucune pondération, tirage uniforme |
| `--poids-frequence X` `--poids-recent X` `--poids-retard X` | règle chaque critère à la main (positif = favorise, négatif = défavorise, 0 = ignoré). Prend le pas sur la stratégie. |
| `--fenetre 100` | nombre de tirages pris en compte pour la fréquence « récente » (50 par défaut) |
| `--anti-populaire` | écarte les grilles qui ressemblent à ce que les joueurs cochent souvent |
| `--seuil 0` | rend le mode anti-populaire plus strict (1 par défaut) |
| `--graine 42` | rend le résultat reproductible |
| `--export stats.csv` | exporte les stats et le poids de chaque numéro et étoile (ouvrable dans Excel) |
| `--sans-stats` | n'affiche que les grilles |
| `--export-json fichier.json` | écrit l'historique pour le site web puis s'arrête (échoue si une archive FDJ manque) |

Exemple : `python3 euromillions.py --grilles 3 --strategie froids --anti-populaire`

## Le site web

En ligne sur https://m-xime.github.io/euro-million/

Le dossier `site/` contient la version web (HTML + JavaScript, sans dépendance) : mêmes statistiques, mêmes stratégies, même mode anti-populaire. Le bulletin se colore selon l'écart à la moyenne, le retard ou le poids donné par tes réglages, et les grilles tirées y sont entourées. Il n'y a pas de serveur : tout est calculé dans le navigateur, à partir de `site/data/tirages.json`. Avec la même graine, le site redonne les mêmes grilles, mais pas les mêmes que le script : les deux n'utilisent pas le même générateur aléatoire.

### Mise à jour automatique

Le workflow GitHub Actions `.github/workflows/pages.yml` a deux jobs :

- `build` lance `python3 euromillions.py --export-json site/data/tirages.json`, qui télécharge l'historique FDJ, puis prépare le dossier `site/` ;
- `deploy` le publie sur GitHub Pages.

Il tourne à chaque push sur `main`, le mercredi et le samedi à 6 h 17 UTC (après les tirages du mardi et du vendredi), et à la demande depuis l'onglet Actions (« Run workflow »). Si une archive FDJ manque, `build` échoue et le site en ligne reste tel quel. Les données ne sont jamais commitées (`site/data/` est dans `.gitignore`).

GitHub suspend les workflows planifiés après 60 jours sans activité sur le dépôt : il suffit alors de le relancer depuis l'onglet Actions.

### Lancer le site en local

```bash
python3 euromillions.py --export-json site/data/tirages.json
python3 -m http.server -d site
```

puis ouvre http://localhost:8000. Si le port 8000 est déjà pris, choisis-en un autre : `python3 -m http.server 8080 -d site`. Ouvrir `site/index.html` directement ne marche pas : le navigateur bloque le chargement des données depuis un fichier local.

### Configuration GitHub (déjà faite)

Le dépôt doit être public (GitHub Pages n'est pas disponible pour un dépôt privé avec un compte gratuit) et, dans Settings → Pages, la source doit être « GitHub Actions ».

## Comment la pondération marche

Pour chaque numéro (1 à 50) et chaque étoile (1 à 12), le script calcule :
- la **fréquence** sur tout l'historique,
- la **fréquence récente** sur les N derniers tirages,
- le **retard**, c'est-à-dire le nombre de tirages depuis sa dernière sortie.

Chaque critère est centré-réduit, puis le poids d'un numéro vaut `exp(pf × fréquence + pr × récent + pd × retard)`. Les 5 numéros et les 2 étoiles sont tirés au hasard en proportion de ces poids. Les étoiles ne sont comptées qu'à partir du 27/09/2016, date du passage à 12 étoiles, pour ne pas désavantager les étoiles 10 à 12.

## Le mode anti-populaire

Il donne à chaque grille un score de « popularité » et rejette celles qui dépassent le seuil. Le score monte quand la grille contient :
- 4 ou 5 numéros ≤ 31 (des dates) ou 3 numéros ≤ 12 (des mois),
- des suites (12-13-14), une progression régulière (5-10-15-20-25),
- des numéros tous de la même dizaine, de la même terminaison, tous pairs ou tous impairs,
- plusieurs numéros « fétiches » (7, 13…), une somme très basse,
- l'étoile 7 ou les étoiles 1-2,
- une combinaison déjà sortie (beaucoup de gens la rejouent).

## À garder en tête

Chaque tirage est indépendant. Une boule n'a pas de mémoire : un numéro « en retard » n'a pas plus de chances de sortir, et un numéro « chaud » n'en a pas plus non plus. Quelle que soit la grille, la probabilité du rang 1 est de 1 sur 139 838 160. Les écarts de fréquence que tu verras (±10 à 20 %) sont du même ordre que ce que le hasard seul produit sur environ 1 900 tirages.

Le seul vrai levier, c'est le mode anti-populaire. Il ne fait pas gagner plus souvent, mais si tu gagnes, tu as moins de chances de partager le gain avec d'autres joueurs qui ont coché la même grille.

Jouer comporte des risques : endettement, dépendance. Appelle le 09 74 75 13 13 (appel non surtaxé).
