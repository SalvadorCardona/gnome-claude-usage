/* Tests de formatRemaining (format.js).
 *
 *     gjs -m tests/format.test.js
 */

import System from 'system';

import {formatRemaining, formatReset} from '../format.js';

let failed = 0;

function check(what, actual, expected) {
    if (actual !== expected) {
        failed++;
        printerr(`ÉCHEC ${what}\n  obtenu  ${actual}\n  attendu ${expected}`);
    } else {
        print(`ok ${what}`);
    }
}

const now = new Date(2026, 9, 13, 17, 30);

check('2 h 10', formatRemaining('Oct 13, 7:40pm (Europe/Paris)', undefined, now), '2 h 10');
check('minutes seules', formatRemaining('Oct 13, 6:12pm', undefined, now), '42 min');
check('heure pleine', formatRemaining('Oct 13, 8:30pm', undefined, now), '3 h 00');
check('date passée', formatRemaining('Oct 13, 5pm', undefined, now), '');
check('vide', formatRemaining('', undefined, now), '');
check('illisible', formatRemaining('soon', undefined, now), '');
check('formatReset inchangé', formatReset('Oct 13, 7:40pm (Europe/Paris)', undefined, now), 'today at 19:40');

System.exit(failed ? 1 : 0);
