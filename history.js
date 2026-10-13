/* L'historique local des relevés, pour la courbe de tendance du menu.
 *
 * Un relevé = l'instant et le pourcentage de chaque limite, rangés dans un
 * petit fichier JSON du dossier de données de l'utilisateur. Rien ne quitte la
 * machine, et on ne garde que ce que la courbe montre : sept jours.
 *
 * Les fonctions de calcul n'ont besoin de rien d'autre que de tableaux, pour
 * rester éprouvables ; seules load/save touchent au disque, et en asynchrone.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.File.prototype, 'replace_contents_async');

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
