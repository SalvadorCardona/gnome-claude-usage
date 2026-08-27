/* Lecture de la consommation Claude Code.
 *
 * La source est `claude -p "/usage"`, c'est-à-dire exactement ce qu'affiche la
 * commande /usage dans une session : les chiffres officiels du compte, avec
 * leurs dates de remise à zéro. On passe volontairement par le CLI plutôt que
 * par l'API : le jeton reste dans ~/.claude/.credentials.json, l'extension ne
 * le lit jamais et n'a rien à renouveler.
 *
 * Coût : ~5 s par appel, d'où le rafraîchissement espacé et strictement
 * asynchrone — rien ici ne doit jamais bloquer le shell.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

// Le shell hérite d'un PATH minimal : on cherche là où les installeurs posent
// le binaire avant d'abandonner.
const CANDIDATE_PATHS = [
    '/.local/bin/claude',
    '/.claude/local/claude',
    '/bin/claude',
];

export function findClaude(configured) {
    if (configured) {
        return GLib.file_test(configured, GLib.FileTest.IS_EXECUTABLE)
            ? configured
            : null;
    }

    const inPath = GLib.find_program_in_path('claude');
    if (inPath)
        return inPath;

    const home = GLib.get_home_dir();
    for (const suffix of CANDIDATE_PATHS) {
        const candidate = home + suffix;
        if (GLib.file_test(candidate, GLib.FileTest.IS_EXECUTABLE))
            return candidate;
    }

    for (const candidate of ['/usr/local/bin/claude', '/usr/bin/claude']) {
        if (GLib.file_test(candidate, GLib.FileTest.IS_EXECUTABLE))
            return candidate;
    }

    return null;
}

/* Un dossier vide et dédié comme répertoire de travail : `claude` archive une
 * session par répertoire visité, autant qu'elles se rangent toutes au même
 * endroit plutôt que de polluer le dossier personnel. */
function workingDirectory() {
    const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'claude-usage-indicator']);
    GLib.mkdir_with_parents(dir, 0o700);
    return dir;
}

/* Une panne de relevé, désignée par un code : « no-binary », « command-failed »,
 * « unreadable » ou « unknown ». Le libellé montré à l'utilisateur est choisi
 * par l'interface, seule à disposer de gettext. */
export class UsageError extends Error {
    constructor(code, detail = '') {
        super(code);
        this.name = 'UsageError';
        this.code = code;
        this.detail = detail;
    }
}

let _cancellable = null;

/** Interrompt un relevé en cours (changement de réglage, désactivation). */
export function cancel() {
    if (_cancellable) {
        _cancellable.cancel();
        _cancellable = null;
    }
}

export async function fetchUsage(claudePath) {
    if (!claudePath)
        throw new UsageError('no-binary');

    cancel();
    _cancellable = new Gio.Cancellable();
    const cancellable = _cancellable;

    const launcher = new Gio.SubprocessLauncher({
        flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
    });
    launcher.set_cwd(workingDirectory());
    const proc = launcher.spawnv([claudePath, '-p', '/usage']);

    // Le CLI peut rester pendu sur un réseau qui ne répond pas ; on coupe.
    const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
        proc.force_exit();
        return GLib.SOURCE_REMOVE;
    });

    let stdout, stderr;
    try {
        [stdout, stderr] = await proc.communicate_utf8_async(null, cancellable);
    } finally {
        GLib.source_remove(timeoutId);
        if (cancellable === _cancellable)
            _cancellable = null;
    }

    if (!proc.get_successful())
        throw new UsageError('command-failed', (stderr || stdout || '').trim());

    const parsed = parseUsage(stdout || '');
    if (!parsed.limits.length)
        throw new UsageError('unreadable', (stdout || '').trim());

    return parsed;
}

const RESET_SUFFIX = String.raw`(?:\s*[·•]\s*resets?\s+(.+?))?\s*$`;

/**
 * Le CLI parle anglais quelle que soit la locale, d'où des motifs en anglais.
 * Le parseur rend des clés et des nombres, jamais de texte d'interface.
 */
export function parseUsage(text) {
    const limits = [];

    const session = text.match(
        new RegExp(String.raw`^\s*Current session:\s*(\d+)%\s*used` + RESET_SUFFIX, 'm'));
    if (session) {
        limits.push({
            key: 'session',
            percent: Number(session[1]),
            resets: (session[2] || '').trim(),
        });
    }

    const week = text.match(
        new RegExp(String.raw`^\s*Current week \(all models\):\s*(\d+)%\s*used` + RESET_SUFFIX, 'm'));
    if (week) {
        limits.push({
            key: 'week',
            percent: Number(week[1]),
            resets: (week[2] || '').trim(),
        });
    }

    const model = text.match(
        new RegExp(String.raw`^\s*Current week \((?!all models\))([^)]+)\):\s*(\d+)%\s*used` + RESET_SUFFIX, 'm'));
    if (model) {
        limits.push({
            key: 'model',
            // Un nom propre — « Opus », « Fable » — qui ne se traduit pas.
            model: model[1].trim(),
            percent: Number(model[2]),
            resets: (model[3] || '').trim(),
        });
    }

    return {
        limits,
        sections: parseSections(text),
        note: extractNote(text),
        raw: text.trim(),
        fetchedAt: GLib.DateTime.new_now_local(),
    };
}

/* Les blocs « Last 24h · N requests · M sessions » suivis de leurs puces. */
function parseSections(text) {
    const sections = [];
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const header = lines[i].match(/^\s*(Last\s+\S+)\s*[·•]\s*(.+?)\s*$/);
        if (!header)
            continue;

        const bullets = [];
        for (let j = i + 1; j < lines.length; j++) {
            const line = lines[j];
            if (!line.trim())
                break;
            if (!/^\s{2,}/.test(line))
                break;
            bullets.push(line.trim());
        }

        sections.push({
            title: header[1],
            summary: header[2].split(/\s*[·•]\s*/).join(' · '),
            bullets,
        });
    }

    return sections;
}

function extractNote(text) {
    const note = text.match(/^\s*(Approximate,.+)$/m);
    return note ? note[1].trim() : '';
}
