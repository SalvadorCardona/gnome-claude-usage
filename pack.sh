#!/usr/bin/env bash
# Fabrique le zip attendu par extensions.gnome.org.
#
# On n'utilise pas « gnome-extensions pack » : dès qu'il voit un dossier po/, il
# appelle msgfmt, absent d'une installation Ubuntu par défaut. Le contenu d'une
# archive d'extension est de toute façon simple — les fichiers d'exécution, à la
# racine — et le faire nous-mêmes évite d'exiger gettext pour construire.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$SRC/dist}"
UUID="claude-usage@salvadorcardona.github.io"
ZIP="$OUT/$UUID.shell-extension.zip"

glib-compile-schemas "$SRC/schemas"
python3 "$SRC/tools/po2mo.py" "$SRC/po/fr.po" "$SRC/locale/fr/LC_MESSAGES/claude-usage.mo"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

for item in metadata.json extension.js prefs.js usage.js pie.js format.js stylesheet.css schemas locale; do
    cp -r "$SRC/$item" "$STAGE/"
done

mkdir -p "$OUT"
rm -f "$ZIP"
(cd "$STAGE" && zip -r -q "$ZIP" .)

echo "Archive : $ZIP"
unzip -l "$ZIP" | tail -n +4 | head -n -2
