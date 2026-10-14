#!/usr/bin/env python3
"""Enregistre la sortie actuelle de `claude -p "/usage"` comme échantillon.

    python3 tools/capture-usage.py [--force] [--from-file FICHIER --cli-version X.Y.Z]

L'échantillon va dans tests/fixtures/usage/<version du CLI>.txt, après retrait
des informations personnelles. Le test de contrat (tests/parser-contract.js)
rejoue ensuite tous les échantillons : le premier qui casse désigne la version
du CLI dont le wording a changé.

Ce script appelle le vrai CLI : il se lance à la main, jamais en intégration
continue.
"""

import argparse
import re
import subprocess
import sys
import tempfile
from pathlib import Path

FIXTURES = Path(__file__).resolve().parent.parent / 'tests' / 'fixtures' / 'usage'
VERSION_RE = re.compile(r'\d+\.\d+\.\d+(?:[-+][\w.]+)?')

# « Top skills: /nom 7%, /autre 2% » : les noms trahissent les outils de la
# personne, les pourcentages sont le seul contenu utile au parseur.
TOP_RE = re.compile(r'^(\s*Top (?:skills|subagents|MCP servers):\s*)(.+)$', re.M)
ITEM_RE = re.compile(r'\s*(.+?)\s+(\d+%)\s*$')


def _anonymise_top(match):
    kind = re.search(r'Top (skills|subagents|MCP servers)', match.group(1)).group(1)
    label = {'skills': 'skill', 'subagents': 'subagent', 'MCP servers': 'server'}[kind]
    prefix = '/' if kind == 'skills' else ''
    items = []
    for index, item in enumerate(match.group(2).split(','), start=1):
        found = ITEM_RE.match(item)
        if found:
            items.append(f'{prefix}{label}-{index} {found.group(2)}')
        else:
            items.append(f'{prefix}{label}-{index}')
    return match.group(1) + ', '.join(items)


def scrub(text):
    """Retire ce qui identifie la personne ou sa machine."""
    home = str(Path.home())
    text = text.replace(home, '~')
    text = re.sub(r'[\w.+-]+@[\w-]+(?:\.[\w-]+)+', 'user@example.com', text)
    # Le fuseau horaire situe la personne ; UTC garde la forme « (Zone/Ville) ».
    text = re.sub(r'\(([A-Z][A-Za-z_]+/[A-Za-z_+\-0-9/]+)\)', '(Etc/UTC)', text)
    text = TOP_RE.sub(_anonymise_top, text)
    return text.strip() + '\n'


def cli_version(claude):
    out = subprocess.run([claude, '--version'], capture_output=True, text=True, timeout=30)
    found = VERSION_RE.search(out.stdout)
    if out.returncode != 0 or not found:
        sys.exit(f'Version du CLI illisible : {out.stdout.strip() or out.stderr.strip()}')
    return found.group(0)


def run_usage(claude):
    # Un dossier vide : `claude` archive une session par répertoire visité.
    with tempfile.TemporaryDirectory() as cwd:
        out = subprocess.run([claude, '-p', '/usage'], capture_output=True,
                             text=True, timeout=90, cwd=cwd)
    if out.returncode != 0 or not out.stdout.strip():
        sys.exit(f'`claude -p "/usage"` a échoué : {(out.stderr or out.stdout).strip()}')
    return out.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--claude', default='claude', help='chemin du binaire claude')
    parser.add_argument('--force', action='store_true', help='remplacer un échantillon existant')
    parser.add_argument('--from-file', help='anonymiser un texte déjà obtenu au lieu d\'appeler le CLI')
    parser.add_argument('--cli-version', help='version du CLI (obligatoire avec --from-file)')
    args = parser.parse_args()

    if args.from_file:
        if not args.cli_version or not VERSION_RE.fullmatch(args.cli_version):
            sys.exit('--from-file demande --cli-version X.Y.Z')
        version, raw = args.cli_version, Path(args.from_file).read_text()
    else:
        version, raw = cli_version(args.claude), run_usage(args.claude)

    target = FIXTURES / f'{version}.txt'
    if target.exists() and not args.force:
        sys.exit(f'{target} existe déjà (une version = un échantillon) ; --force pour le remplacer.')

    FIXTURES.mkdir(parents=True, exist_ok=True)
    target.write_text(scrub(raw))
    print(f'Échantillon enregistré : {target}')
    print('Relisez-le, puis générez le résultat attendu :')
    print('  gjs -m tests/parser-contract.js --write-expected')


if __name__ == '__main__':
    main()
