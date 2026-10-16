/* Test de contrat du parseur : rejoue chaque échantillon de
 * tests/fixtures/usage/<version du CLI>.txt et compare le résultat de
 * parseUsage() à <version>.expected.json.
 *
 *     gjs -m tests/parser-contract.js                   rejoue tout
 *     gjs -m tests/parser-contract.js --write-expected  crée les .expected.json manquants
 *
 * Le wording du CLI change sans préavis : l'échantillon qui échoue désigne la
 * version qui a cassé l'analyse. Aucun appel au vrai CLI ici — voir
 * tools/capture-usage.py pour enregistrer un nouvel échantillon.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

import {parseUsage} from '../usage.js';

const dir = GLib.path_get_dirname(import.meta.url.replace('file://', ''));
const fixtures = GLib.build_filenamev([dir, 'fixtures', 'usage']);
const writeExpected = ARGV.includes('--write-expected');

function read(path) {
    const [, bytes] = GLib.file_get_contents(path);
    return new TextDecoder().decode(bytes);
}

/* Ce que le parseur promet, sans l'heure du relevé ni le texte brut. */
function contractView(parsed) {
    return {limits: parsed.limits, sections: parsed.sections, note: parsed.note};
}

const versions = [];
const enumerator = Gio.File.new_for_path(fixtures)
    .enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
for (let info = enumerator.next_file(null); info; info = enumerator.next_file(null)) {
    const match = info.get_name().match(/^(\d+\.\d+\.\d+.*)\.txt$/);
    if (match)
        versions.push(match[1]);
}
versions.sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));

const failures = [];
let checked = 0;

if (!versions.length)
    failures.push('aucun échantillon dans tests/fixtures/usage/');

for (const version of versions) {
    const sample = GLib.build_filenamev([fixtures, `${version}.txt`]);
    const expectedPath = GLib.build_filenamev([fixtures, `${version}.expected.json`]);
    const actual = contractView(parseUsage(read(sample)));
    const problems = [];

    // Les invariants d'abord : leur message dit quoi a cassé, pas seulement « ça diffère ».
    const keys = actual.limits.map(l => l.key);
    for (const key of ['session', 'week']) {
        if (!keys.includes(key))
            problems.push(`limite « ${key} » introuvable`);
    }
    for (const limit of actual.limits) {
        if (!Number.isInteger(limit.percent) || limit.percent < 0 || limit.percent > 100)
            problems.push(`pourcentage invalide pour « ${limit.key} » : ${limit.percent}`);
        if (!limit.resets)
            problems.push(`date de remise à zéro vide pour « ${limit.key} »`);
    }
    if (!actual.sections.length)
        problems.push('aucune section « Last … » reconnue');

    if (writeExpected && !GLib.file_test(expectedPath, GLib.FileTest.EXISTS)) {
        GLib.file_set_contents(expectedPath, JSON.stringify(actual, null, 2) + '\n');
        print(`écrit  ${version}.expected.json`);
    } else if (!GLib.file_test(expectedPath, GLib.FileTest.EXISTS)) {
        problems.push(`${version}.expected.json manquant (--write-expected)`);
    } else {
        const expected = JSON.stringify(JSON.parse(read(expectedPath)), null, 2);
        const got = JSON.stringify(actual, null, 2);
        if (expected !== got)
            problems.push(`résultat différent de ${version}.expected.json\n--- attendu\n${expected}\n--- obtenu\n${got}`);
    }

    checked++;
    if (problems.length) {
        failures.push(`CLI ${version} : le parseur ne lit plus ce format\n  - ${problems.join('\n  - ')}`);
        print(`FAIL   ${version}`);
    } else {
        print(`ok     ${version}`);
    }
}

if (failures.length) {
    printerr(`\n${failures.join('\n\n')}`);
    System.exit(1);
}
print(`\n${checked} échantillon(s) rejoué(s).`);
