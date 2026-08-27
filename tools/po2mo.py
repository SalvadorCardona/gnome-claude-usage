#!/usr/bin/env python3
"""Compile un .po en .mo.

msgfmt fait cela mieux, mais gettext n'est pas installé partout ; ce script
évite d'imposer une dépendance système pour construire l'extension. Le format
MO est décrit dans le manuel GNU gettext, section « The Format of GNU MO Files ».
"""

import array
import re
import struct
import sys
from pathlib import Path

MAGIC = 0x950412DE


def parse_po(text):
    """Rend une liste (msgid, msgid_plural|None, [msgstr, ...])."""
    entries = []
    msgid = msgid_plural = None
    msgstrs = {}
    current = None

    def flush():
        nonlocal msgid, msgid_plural, msgstrs, current
        if msgid is not None:
            ordered = [msgstrs[k] for k in sorted(msgstrs)]
            entries.append((msgid, msgid_plural, ordered))
        msgid = msgid_plural = None
        msgstrs = {}
        current = None

    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith('#'):
            continue

        if line.startswith('msgid_plural'):
            current = 'msgid_plural'
            msgid_plural = unquote(line[len('msgid_plural'):])
        elif line.startswith('msgid'):
            flush()
            current = 'msgid'
            msgid = unquote(line[len('msgid'):])
        elif line.startswith('msgstr['):
            index = int(re.match(r'msgstr\[(\d+)\]', line).group(1))
            current = ('msgstr', index)
            msgstrs[index] = unquote(line[line.index(']') + 1:])
        elif line.startswith('msgstr'):
            current = ('msgstr', 0)
            msgstrs[0] = unquote(line[len('msgstr'):])
        elif line.startswith('"'):
            piece = unquote(line)
            if current == 'msgid':
                msgid += piece
            elif current == 'msgid_plural':
                msgid_plural += piece
            elif isinstance(current, tuple):
                msgstrs[current[1]] += piece

    flush()
    return entries


def unquote(fragment):
    fragment = fragment.strip()
    if not (fragment.startswith('"') and fragment.endswith('"')):
        raise ValueError(f'chaîne mal formée : {fragment!r}')
    return fragment[1:-1].encode().decode('unicode_escape').encode('latin-1').decode('utf-8')


def build_mo(entries):
    # Les entrées vides (non traduites) n'ont rien à faire dans le catalogue.
    table = {}
    for msgid, msgid_plural, msgstrs in entries:
        if not any(msgstrs):
            continue
        if msgid_plural is not None:
            key = msgid + '\x00' + msgid_plural
            value = '\x00'.join(msgstrs)
        else:
            key = msgid
            value = msgstrs[0]
        table[key.encode('utf-8')] = value.encode('utf-8')

    # La recherche se fait par dichotomie : les clés doivent être triées.
    keys = sorted(table)
    count = len(keys)
    originals_offset = 28
    translations_offset = originals_offset + count * 8
    hash_offset = translations_offset + count * 8
    strings_offset = hash_offset

    originals, translations, payload = [], [], b''
    for key in keys:
        originals.append((len(key), strings_offset + len(payload)))
        payload += key + b'\x00'
    for key in keys:
        value = table[key]
        translations.append((len(value), strings_offset + len(payload)))
        payload += value + b'\x00'

    output = struct.pack('<Iiiiiii', MAGIC, 0, count,
                         originals_offset, translations_offset, 0, hash_offset)
    output += array.array('i', [n for pair in originals for n in pair]).tobytes()
    output += array.array('i', [n for pair in translations for n in pair]).tobytes()
    return output + payload


def main():
    if len(sys.argv) != 3:
        sys.exit('usage: po2mo.py <source.po> <cible.mo>')
    source, target = Path(sys.argv[1]), Path(sys.argv[2])
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(build_mo(parse_po(source.read_text(encoding='utf-8'))))
    print(f'{source} → {target}')


if __name__ == '__main__':
    main()
