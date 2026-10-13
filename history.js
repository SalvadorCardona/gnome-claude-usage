/* L'historique local des relevés.
 *
 * Deux usages, deux fichiers du dossier de données de l'utilisateur, rien ne
 * quitte la machine :
 *
 *  - la courbe de tendance du menu : un petit fichier JSON, sept jours
 *    (loadHistory/saveHistory, addSample, series) ;
 *  - le journal des lectures : une ligne JSON horodatée par relevé, trente
 *    jours (record, formatLine, prune), voir plus bas.
 *
 * Les fonctions de calcul n'ont besoin de rien d'autre que de tableaux, pour
 * rester éprouvables ; seules les fonctions d'E/S touchent au disque, et en
 * asynchrone.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.File.prototype, 'replace_async');
Gio._promisify(Gio.File.prototype, 'replace_contents_async');
Gio._promisify(Gio.File.prototype, 'append_to_async');
Gio._promisify(Gio.OutputStream.prototype, 'write_bytes_async');
Gio._promisify(Gio.OutputStream.prototype, 'close_async');

export const WINDOW_MS = 7 * 24 * 3600 * 1000;

/* Deux relevés plus proches que ça disent la même chose : un clic sur
 * « Rafraîchir » en rafale ne doit pas gonfler le fichier. */
const MIN_GAP_MS = 60 * 1000;

function historyFile() {
    const dir = GLib.build_filenamev([GLib.get_user_data_dir(), 'claude-usage-indicator']);
    GLib.mkdir_with_parents(dir, 0o700);
    return Gio.File.new_for_path(GLib.build_filenamev([dir, 'history.json']));
}

/** Lit l'historique ; un fichier absent ou abîmé donne un historique vide. */
export async function loadHistory() {
    try {
        const [bytes] = await historyFile().load_contents_async(null);
        return sanitize(JSON.parse(new TextDecoder().decode(bytes)));
    } catch (_e) {
        return [];
    }
}

export async function saveHistory(samples) {
    const bytes = new TextEncoder().encode(JSON.stringify(samples));
    await historyFile().replace_contents_async(
        bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
}

/* Écarte tout ce qui n'a pas la forme d'un relevé : le fichier est lisible et
 * modifiable à la main, et une entrée bancale ferait échouer le dessin. */
function sanitize(raw) {
    if (!Array.isArray(raw))
        return [];
    return raw
        .filter(s => s && Number.isFinite(s.t) && s.p && typeof s.p === 'object')
        .sort((a, b) => a.t - b.t);
}

/**
 * Ajoute le relevé `limits` (ceux de usage.js) à l'instant `now` (ms) et
 * rend le nouvel historique, purgé de ce qui dépasse sept jours.
 */
export function addSample(samples, limits, now) {
    const kept = samples.filter(s => s.t > now - WINDOW_MS);
    const p = {};
    for (const limit of limits)
        p[limit.key] = limit.percent;

    const last = kept[kept.length - 1];
    if (last && now - last.t < MIN_GAP_MS)
        kept.pop();
    kept.push({t: now, p});
    return kept;
}

/**
 * Les points de la limite `key` sur les sept derniers jours, avec x dans
 * [0, 1] (0 = il y a sept jours, 1 = maintenant) et y le pourcentage.
 */
export function series(samples, key, now) {
    return samples
        .filter(s => s.t > now - WINDOW_MS && s.t <= now && Number.isFinite(s.p[key]))
        .map(s => ({x: 1 - (now - s.t) / WINDOW_MS, y: s.p[key]}));
}

/* ---- Journal des lectures : une ligne par relevé, 30 jours ----
 *
 *     {"t":"2026-10-13T09:41:00+02:00","limits":{"session":12,"week":34}}
 *
 * Rien d'autre que des pourcentages : ni jeton, ni chemin, ni sortie brute du
 * CLI. Aucune erreur d'écriture ne doit remonter jusqu'à l'indicateur, d'où le
 * `catch` de record() qui se contente de journaliser. */


/* Au-delà, une ligne est supprimée. */
export const RETENTION_DAYS = 30;

/* La purge réécrit tout le fichier : une fois par jour suffit, la rétention
 * se compte en jours. */
const PURGE_EVERY_SECONDS = 24 * 3600;

export function historyPath() {
    return GLib.build_filenamev([GLib.get_user_data_dir(), 'claude-usage', 'history.jsonl']);
}

/* La ligne d'une lecture, terminée par un saut de ligne. `at` est un GLib.DateTime. */
export function formatLine(at, limits) {
    const percents = {};
    for (const limit of limits)
        percents[limit.key] = limit.percent;
    return `${JSON.stringify({t: at.format('%FT%T%:z'), limits: percents})}\n`;
}

/* Le contenu du fichier sans les lignes plus vieilles que la rétention.
 * Une ligne illisible est écartée plutôt que conservée : elle ne servirait à
 * personne et ne serait jamais purgée. `now` et le résultat sont en ms. */
export function prune(text, now) {
    const limit = now - RETENTION_DAYS * 24 * 3600 * 1000;
    const kept = [];
    for (const line of text.split('\n')) {
        if (!line)
            continue;
        try {
            const time = Date.parse(JSON.parse(line).t);
            if (time >= limit)
                kept.push(line);
        } catch (e) {
            // Ligne tronquée ou étrangère : écartée.
        }
    }
    return kept.length ? `${kept.join('\n')}\n` : '';
}

let _queue = Promise.resolve();
let _lastPurge = 0;

/** Ajoute une lecture à l'historique. Ne rejette jamais. */
export function record(data) {
    _queue = _queue.then(() => _record(data)).catch(error => {
        console.warn(`[claude-usage] history: ${error?.message ?? error}`);
    });
    return _queue;
}

async function _record(data) {
    if (!data?.limits?.length)
        return;

    const path = historyPath();
    GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o700);
    const file = Gio.File.new_for_path(path);

    const stream = await file.append_to_async(
        Gio.FileCreateFlags.NONE, GLib.PRIORITY_LOW, null);
    // Une ligne tient largement dans un seul écrit : pas de boucle sur les écritures partielles.
    await stream.write_bytes_async(
        new GLib.Bytes(new TextEncoder().encode(formatLine(data.fetchedAt, data.limits))),
        GLib.PRIORITY_LOW, null);
    await stream.close_async(GLib.PRIORITY_LOW, null);

    const now = GLib.get_monotonic_time() / GLib.USEC_PER_SEC;
    if (_lastPurge && now - _lastPurge < PURGE_EVERY_SECONDS)
        return;
    _lastPurge = now;

    const [bytes] = await file.load_contents_async(null);
    const text = new TextDecoder().decode(bytes);
    const pruned = prune(text, Date.now());
    if (pruned !== text && pruned) {
        // replace_contents_async mal lié dans GJS : on passe par le flux.
        const out = await file.replace_async(
            null, false, Gio.FileCreateFlags.NONE, GLib.PRIORITY_LOW, null);
        await out.write_bytes_async(
            new GLib.Bytes(new TextEncoder().encode(pruned)), GLib.PRIORITY_LOW, null);
        await out.close_async(GLib.PRIORITY_LOW, null);
    }
}
