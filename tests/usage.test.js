/* Tests du parseur de `claude -p "/usage"`.
 *
 * Le format de sortie du CLI n'est pas documenté et peut changer sans
 * prévenir : ces tests confrontent `parseUsage` à des échantillons, réels ou
 * fictifs, rangés dans tests/samples/. Une régression du vocabulaire se voit
 * ici plutôt que dans la barre du shell.
 *
 * Lancement, depuis la racine du dépôt :
 *
 *     gjs -m tests/usage.test.js
 *
 * gjs plutôt que Node : usage.js importe `gi://Gio` et `gi://GLib`, présents
 * hors du shell, alors que les modules « resource:/// » ne le sont pas — on
 * n'importe donc rien ici qui vienne de GNOME Shell.
 */

import GLib from 'gi://GLib';
import System from 'system';

import {classifyFailure, classifyNoLimits, parseUsage} from '../usage.js';

const SAMPLES = GLib.build_filenamev([
    GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]),
    'samples',
]);

function sample(name) {
    const [, bytes] = GLib.file_get_contents(GLib.build_filenamev([SAMPLES, name]));
    return new TextDecoder().decode(bytes);
}

/* Un relevé sans la date du relevé, qui change à chaque appel. */
function parsed(name) {
    const {fetchedAt, ...rest} = parseUsage(sample(name));
    if (!(fetchedAt instanceof GLib.DateTime))
        throw new Error('fetchedAt devrait être un GLib.DateTime');
    return rest;
}

function assertEqual(actual, expected, what) {
    const a = JSON.stringify(actual, null, 2);
    const e = JSON.stringify(expected, null, 2);
    if (a !== e)
        throw new Error(`${what}\n  attendu : ${e}\n  obtenu  : ${a}`);
}

const TESTS = {
    'relevé réel complet : trois limites, deux blocs, la note'() {
        const usage = parsed('real-full.txt');
        assertEqual(usage.limits, [
            {key: 'session', percent: 8, resets: 'Oct 13, 7:40pm (Europe/Paris)'},
            {key: 'week', percent: 15, resets: 'Oct 19, 4pm (Europe/Paris)'},
            {key: 'model', model: 'Fable', percent: 0, resets: 'Oct 19, 4pm (Europe/Paris)'},
        ], 'limites');
        assertEqual(usage.sections.map(s => [s.title, s.summary, s.bullets.length]), [
            ['Last 24h', '5266 requests · 166 sessions', 6],
            ['Last 7d', '21786 requests · 540 sessions', 5],
        ], 'blocs');
        assertEqual(usage.sections[0].bullets[0],
            '56% of your usage was while 4+ sessions ran in parallel', 'première puce');
        assertEqual(usage.note.startsWith('Approximate, based on local sessions'), true, 'note');
    },

    'échantillon de la documentation : les limites seules'() {
        const usage = parsed('docs-limits-only.txt');
        assertEqual(usage.limits, [
            {key: 'session', percent: 37, resets: 'Aug 27, 7:50pm (Europe/Paris)'},
            {key: 'week', percent: 25, resets: 'Sep 1, 4:00pm (Europe/Paris)'},
            {key: 'model', model: 'Fable', percent: 8, resets: 'Sep 1, 4:00pm (Europe/Paris)'},
        ], 'limites');
        assertEqual(usage.sections, [], 'blocs');
        assertEqual(usage.note, '', 'note');
    },

    'session sans date de remise à zéro, pas de limite par modèle'() {
        const usage = parsed('session-without-reset.txt');
        assertEqual(usage.limits, [
            {key: 'session', percent: 0, resets: ''},
            {key: 'week', percent: 42, resets: 'Oct 19, 4pm (Europe/Paris)'},
        ], 'limites');
    },

    'puces « • » et « reset » au singulier'() {
        const usage = parsed('bullet-separators.txt');
        assertEqual(usage.limits, [
            {key: 'session', percent: 100, resets: 'Mar 3, 12am (America/New_York)'},
            {key: 'week', percent: 91, resets: 'Mar 7, 9:30am (America/New_York)'},
            {key: 'model', model: 'Opus', percent: 77, resets: 'Mar 7, 9:30am (America/New_York)'},
        ], 'limites');
        assertEqual(usage.sections, [
            {title: 'Last 24h', summary: '12 requests · 1 session', bullets: ['Top skills: /review 3%']},
        ], 'blocs');
    },

    'blocs sans limites : une ligne non indentée clôt le bloc'() {
        const usage = parsed('sections-without-limits.txt');
        assertEqual(usage.limits, [], 'limites');
        assertEqual(usage.sections, [{
            title: 'Last 7d',
            summary: '1307 requests · 25 sessions',
            bullets: [
                '33% of your usage came from sessions active for 8+ hours',
                'Top MCP servers: claude-in-chrome 4%',
            ],
        }], 'blocs');
    },

    'sortie inconnue : le texte brut, sans exception'() {
        const text = sample('unknown.txt');
        const usage = parsed('unknown.txt');
        assertEqual(usage.limits, [], 'limites');
        assertEqual(usage.sections, [], 'blocs');
        assertEqual(usage.note, '', 'note');
        assertEqual(usage.raw, text.trim(), 'texte brut');
    },

    'sortie vide : rien, sans exception'() {
        const {fetchedAt: _, ...usage} = parseUsage('');
        assertEqual(usage, {limits: [], sections: [], note: '', raw: ''}, 'relevé');
    },

    'échec : délai dépassé, c’est le réseau'() {
        const e = classifyFailure('', true);
        assertEqual([e.code, e.detail], ['network', ''], 'code');
    },

    'échec : erreur réseau sur stderr'() {
        const e = classifyFailure('Error: getaddrinfo ENOTFOUND api.anthropic.com\n', false);
        assertEqual([e.code, e.detail], ['network', ''], 'code');
    },

    'échec : demande de /login'() {
        const e = classifyFailure('Please run /login to continue\n', false);
        assertEqual([e.code, e.detail], ['not-logged-in', ''], 'code');
    },

    'échec sans motif connu : le texte brut'() {
        const e = classifyFailure('  boom  \n', false);
        assertEqual([e.code, e.detail], ['command-failed', 'boom'], 'code');
    },

    'sans limites ni abonnement : compte non connecté'() {
        const e = classifyNoLimits([
            'Total cost:            $0.0000',
            'Total duration (API):  0s',
            'Usage:                 0 input, 0 output, 0 cache read, 0 cache write',
        ].join('\n'));
        assertEqual([e.code, e.detail], ['not-logged-in', ''], 'code');
    },

    'sans limites, avec abonnement : format inconnu'() {
        const text = 'You are currently using your subscription to power your Claude Code usage\n';
        const e = classifyNoLimits(text);
        assertEqual([e.code, e.detail], ['unreadable', text.trim()], 'code');
    },

    'sans limites, clé d’API : message du CLI affiché tel quel'() {
        const text = sample('unknown.txt').trim();
        const e = classifyNoLimits(text);
        assertEqual([e.code, e.detail], ['unreadable', text], 'code');
    },
};

let failures = 0;
for (const [name, test] of Object.entries(TESTS)) {
    try {
        test();
        print(`ok      ${name}`);
    } catch (e) {
        failures++;
        print(`ÉCHEC   ${name}\n  ${e.message}`);
    }
}

const total = Object.keys(TESTS).length;
print(`\n${total - failures}/${total} réussis`);
System.exit(failures ? 1 : 0);
