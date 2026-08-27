#!/usr/bin/env bash
# Installe l'extension dans un vrai dossier, dont chaque fichier est un lien
# vers le dépôt : une modification est prise en compte au rechargement suivant,
# sans réinstallation. Le dossier lui-même ne peut pas être un lien — GNOME
# Shell ne suit pas les liens quand il énumère ses extensions.
set -euo pipefail

UUID="claude-usage@salvadorcardona.github.io"
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"

glib-compile-schemas "$SRC/schemas"
python3 "$SRC/tools/po2mo.py" "$SRC/po/fr.po" "$SRC/locale/fr/LC_MESSAGES/claude-usage.mo"

mkdir -p "$DEST"
find "$DEST" -mindepth 1 -maxdepth 1 -exec rm -rf {} +

for item in metadata.json extension.js prefs.js usage.js pie.js format.js stylesheet.css schemas locale; do
    ln -sfn "$SRC/$item" "$DEST/$item"
done

echo "Installé : $DEST"
echo "Activation : gnome-extensions enable $UUID"
