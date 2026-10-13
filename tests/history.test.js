/* Tests de history.js : les calculs de la courbe, puis la ligne du journal et
 * sa purge (hors disque).
 *
 * Lancement, depuis la racine du dépôt :
 *
 *     gjs -m tests/history.test.js
 */

import GLib from 'gi://GLib';
import System from 'system';

import {addSample, formatLine, prune, RETENTION_DAYS, series, WINDOW_MS} from '../history.js';

const DAY = 24 * 3600 * 1000;
const NOW = 10 * DAY;
let failed = 0;

function check(what, actual, expected) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
        failed++;
        printerr(`ÉCHEC ${what}\n  obtenu  ${a}\n  attendu ${e}`);
    } else {
        print(`ok ${what}`);
    }
}

const limits = [{key: 'week', percent: 40}, {key: 'session', percent: 10}];

check('historique vide → aucune série', series([], 'week', NOW), []);

let h = addSample([], limits, NOW - DAY);
check('un relevé', h, [{t: NOW - DAY, p: {week: 40, session: 10}}]);
check('un seul point, à 6/7 de la courbe', series(h, 'week', NOW).map(p => [p.x.toFixed(3), p.y]),
    [['0.857', 40]]);

h = addSample(h, limits, NOW - DAY + 10 * 1000);
check('relevés rapprochés fusionnés', h.length, 1);

h = addSample(h, [{key: 'week', percent: 55}], NOW);
check('deux relevés', h.length, 2);
check('dernier point à x = 1', series(h, 'week', NOW).pop(), {x: 1, y: 55});

h = addSample(h, limits, NOW + WINDOW_MS);
check('purge au-delà de sept jours', h.length, 1);

check('limite absente → aucune série', series(h, 'model', NOW + WINDOW_MS), []);


function assertEqual(actual, expected, what) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e)
        throw new Error(`${what}\n  attendu : ${e}\n  obtenu  : ${a}`);
}

const line = daysAgo => JSON.stringify({t: new Date(Date.now() - daysAgo * DAY).toISOString(), limits: {session: 1}});

const TESTS = {
    'une ligne horodatée avec les seuls pourcentages'() {
        const at = GLib.DateTime.new_utc(2026, 10, 13, 9, 41, 0);
        const text = formatLine(at, [
            {key: 'session', percent: 12, resets: 'Oct 13, 7:40pm (Europe/Paris)'},
            {key: 'model', model: 'Fable', percent: 5, resets: 'Oct 19, 4pm'},
        ]);
        assertEqual(text.endsWith('\n'), true, 'saut de ligne final');
        assertEqual(JSON.parse(text), {t: '2026-10-13T09:41:00+00:00', limits: {session: 12, model: 5}}, 'ligne');
    },

    'l\'horodatage écrit est relisible par Date.parse'() {
        const text = formatLine(GLib.DateTime.new_now_local(), []);
        assertEqual(Number.isNaN(Date.parse(JSON.parse(text).t)), false, 'date');
    },

    'purge : les lignes de plus de 30 jours disparaissent'() {
        const old = line(RETENTION_DAYS + 1);
        const recent = line(RETENTION_DAYS - 1);
        const today = line(0);
        assertEqual(prune(`${old}\n${recent}\n${today}\n`, Date.now()), `${recent}\n${today}\n`, 'conservées');
    },

    'purge : une ligne illisible est écartée'() {
        assertEqual(prune('pas du json\n{"x":1}\n', Date.now()), '', 'rien');
    },

    'purge : fichier vide'() {
        assertEqual(prune('', Date.now()), '', 'rien');
    },
};

for (const [name, test] of Object.entries(TESTS)) {
    try {
        test();
        print(`ok ${name}`);
    } catch (e) {
        failed++;
        printerr(`ÉCHEC ${name}\n  ${e.message}`);
    }
}

if (failed) {
    printerr(`${failed} échec(s)`);
    System.exit(1);
}
