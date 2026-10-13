/* Tests des calculs de history.js (hors disque).
 *
 *     gjs -m tests/history.test.js
 */

import System from 'system';

import {addSample, series, WINDOW_MS} from '../history.js';

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

if (failed) {
    printerr(`${failed} échec(s)`);
    System.exit(1);
}
