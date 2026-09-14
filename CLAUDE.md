# Claude Usage — CLAUDE.md

Extension GNOME Shell qui affiche la consommation Claude Code dans la barre
supérieure (camembert, fenêtre de 5 h) avec le détail au clic (limites
hebdomadaires, remises à zéro, ce qui pèse dans la consommation). Les chiffres
viennent de `claude -p "/usage"` en CLI — jamais l'API Anthropic directement,
jamais de clé lue ou de jeton dépensé.

## Stack

- GJS (JavaScript sur GNOME Shell, moteur Spidermonkey), modules ES (`import`).
- Pas de Node, pas de `package.json`, pas de gestionnaire de paquets.
- `shell-version` ciblée : 48, 49, 50 (voir `metadata.json`).
- GTK4/Adwaita pour `prefs.js`, Cairo pour le dessin du camembert (`pie.js`).

## Commandes réelles

Installation en dev (chaque fichier du dépôt est ensuite lié dans
`~/.local/share/gnome-shell/extensions/` — modifier le clone modifie
l'extension installée) :

```bash
git clone https://github.com/SalvadorCardona/gnome-claude-usage.git
cd gnome-claude-usage
./install.sh
gnome-extensions enable claude-usage@salvadorcardona.github.io
```

Puis se déconnecter/reconnecter : GNOME Shell ne découvre une extension
nouvelle qu'au démarrage, et Wayland ne permet pas de le relancer sur place.

Empaquetage pour extensions.gnome.org :

```bash
./pack.sh
```

`pack.sh` produit le zip attendu (`glib-compile-schemas` + `tools/po2mo.py`)
sans passer par `gnome-extensions pack`, volontairement — voir « Pièges »
ci-dessous.

Il n'y a à ce jour ni suite de tests automatisée ni lint configuré. Ne pas en
inventer ni en supposer un. `format.js` est écrit pour être éprouvé
manuellement (il n'importe aucun module GNOME), mais rien ne l'exécute
automatiquement.

## Arborescence utile

```
extension.js   l'indicateur : camembert de barre, menu, boucle de rafraîchissement
usage.js       lance le CLI `claude -p /usage` et analyse sa réponse — aucun texte d'interface
format.js      met l'anglais du CLI dans la langue de l'utilisateur ; sans import GNOME, donc éprouvable
pie.js         l'anneau du camembert, dessiné au Cairo
prefs.js       la fenêtre de réglages
po/            catalogues de traduction (po/fr.po)
tools/         tools/po2mo.py, compilateur .po → .mo maison
schemas/       schéma GSettings de l'extension
```

## Conventions de code

- Commentaires en français, à l'en-tête des fichiers et sur les décisions non
  évidentes (pourquoi, pas quoi) — voir le style dans `extension.js` et
  `install.sh`.
- `format.js` reçoit son traducteur en argument (objet `{_, n}`) plutôt que
  d'importer gettext directement, pour rester éprouvable hors du shell, où les
  modules `resource:///` n'existent pas. Garder cette séparation pour tout
  nouveau code de formatage.
- `usage.js` ne doit contenir aucun texte destiné à l'utilisateur : c'est la
  couche qui parle au CLI et structure les données, la traduction/mise en
  forme reste dans `format.js`/`extension.js`.
- Tout relevé du CLI est asynchrone ; ne rien bloquer dans la boucle du shell.

## Conventions de commit

Type conventionnel en anglais, description courte en français, minuscule,
sans point final :

```
feat: indicateur GNOME de consommation Claude Code
fix: ne rien redessiner si l'extension est désactivée pendant un relevé
docs: renvoyer vers la fiche extensions.gnome.org
```

## Pièges connus

- **Ne pas utiliser `gnome-extensions pack`** pour l'empaquetage : dès qu'il
  voit `po/`, il appelle `msgfmt`, absent d'une installation Ubuntu par
  défaut. `pack.sh` reconstruit l'archive à la main pour cette raison —
  garder ce script comme unique chemin d'empaquetage.
- **Localisation** : le CLI `claude` répond toujours en anglais, quelle que
  soit la locale. `format.js` analyse cet anglais et le restitue dans la
  langue de l'utilisateur ; une phrase non reconnue est affichée telle quelle
  plutôt que déformée, car ce vocabulaire n'est pas une interface documentée.
  Le catalogue de traduction est `po/fr.po`, compilé via `tools/po2mo.py`
  (pas `msgfmt`, absent par défaut) vers `locale/fr/LC_MESSAGES/claude-usage.mo`.
- Le dossier d'installation lui-même ne peut pas être un lien symbolique :
  GNOME Shell ne suit pas les liens quand il énumère ses extensions (seuls
  les fichiers à l'intérieur le sont).
- `docs/` est publié tel quel sur GitHub Pages par `.github/workflows/pages.yml` ;
  l'activation de Pages se fait à la main dans les réglages du dépôt, le
  workflow ne peut pas le faire lui-même (permission d'administration hors de
  portée du `GITHUB_TOKEN`).
