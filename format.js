/* Mise en forme des chaînes que le CLI rend en anglais.
 *
 * Aucune de ces fonctions n'importe gettext : elles reçoivent leur traducteur
 * en argument. C'est ce qui permet de les éprouver hors du shell, où les
 * modules « resource:/// » n'existent pas — et le jeu de phrases du CLI n'est
 * pas documenté, donc il vaut mieux pouvoir le tester.
 *
 * Toute chaîne non reconnue est rendue telle quelle : mieux vaut afficher
 * l'anglais d'origine que le déformer.
 */

/** Traducteur neutre : rend l'anglais d'origine. */
export const IDENTITY = {
    _: s => s,
    n: (singular, plural, count) => (count === 1 ? singular : plural),
};

const MONTHS = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * « Aug 27, 2:30pm (Europe/Paris) » → « aujourd'hui à 14:30 ».
 * Le nom du mois vient de `monthName`, que l'appelant tire de GLib pour
 * respecter la locale ; sans lui, on garde l'abréviation anglaise.
 */
export function formatReset(raw, t = IDENTITY, now = new Date(), monthName = null) {
    if (!raw)
        return '';

    const withoutZone = raw.replace(/\s*\([^)]*\)\s*$/, '').trim();
    const match = withoutZone.match(
        /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (!match)
        return withoutZone;

    const month = MONTHS[match[1].toLowerCase()];
    if (month === undefined)
        return withoutZone;

    const day = Number(match[2]);
    let hour = Number(match[3]);
    const minute = Number(match[4] ?? 0);
    const meridiem = match[5]?.toLowerCase();

    if (meridiem === 'pm' && hour !== 12)
        hour += 12;
    if (meridiem === 'am' && hour === 12)
        hour = 0;

    // Le CLI omet l'année ; un mois largement passé désigne l'année suivante.
    let year = now.getFullYear();
    if (new Date(year, month, day, hour, minute).getTime() < now.getTime() - 30 * 24 * 3600 * 1000)
        year += 1;

    const date = new Date(year, month, day, hour, minute);
    const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

    const delta = daysBetween(now, date);
    if (delta === 0)
        return format(t._('today at %s'), time);
    if (delta === 1)
        return format(t._('tomorrow at %s'), time);

    const monthLabel = monthName ? monthName(date) : match[1];
    return format(t._('%s %s at %s'), String(day), monthLabel, time);
}

function daysBetween(from, to) {
    const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
    return Math.round((b - a) / (24 * 3600 * 1000));
}

/** « Last 24h » / « Last 7d » — l'intitulé de chaque bloc de statistiques. */
export function localizePeriod(title, t = IDENTITY) {
    const hours = title.match(/^Last\s+(\d+)\s*h$/i);
    if (hours)
        return format(t.n('Last %s hour', 'Last %s hours', Number(hours[1])), hours[1]);

    const days = title.match(/^Last\s+(\d+)\s*d$/i);
    if (days)
        return format(t.n('Last %s day', 'Last %s days', Number(days[1])), days[1]);

    return title;
}

/** « 1307 requests · 25 sessions ». */
export function localizeSummary(summary, t = IDENTITY) {
    return summary
        .replace(/(\d+)\s+requests?/g,
            (_m, n) => format(t.n('%s request', '%s requests', Number(n)), n))
        .replace(/(\d+)\s+sessions?/g,
            (_m, n) => format(t.n('%s session', '%s sessions', Number(n)), n));
}

/** Les puces qui détaillent ce qui pèse dans la consommation. */
export function localizeBullet(bullet, t = IDENTITY) {
    const rules = [
        [/^(\d+)% of your usage was while (\d+)\+ sessions ran in parallel$/i,
            (p, n) => format(t._('%s with %s or more sessions in parallel'), pct(p, t), n)],
        [/^(\d+)% of your usage was at >(\S+) context$/i,
            (p, c) => format(t._('%s beyond %s of context'), pct(p, t), c)],
        [/^(\d+)% of your usage came from sessions active for (\d+)\+ hours?$/i,
            (p, h) => format(t._('%s from sessions open %s hours or more'), pct(p, t), h)],
        [/^Top skills:\s*(.+)$/i,
            list => format(t._('Most used skills: %s'), percents(list, t))],
        [/^Top MCP servers:\s*(.+)$/i,
            list => format(t._('Most used MCP servers: %s'), percents(list, t))],
    ];

    for (const [pattern, replace] of rules) {
        const match = bullet.match(pattern);
        if (match)
            return replace(...match.slice(1));
    }

    return percents(bullet, t);
}

/**
 * Le signe pourcent, collé en anglais et précédé d'une espace insécable en
 * français. Passer par une chaîne traduisible évite de coder la typographie
 * d'une langue en dur.
 */
export function pct(value, t = IDENTITY) {
    return format(t._('%s%%'), String(value));
}

function percents(text, t) {
    return text.replace(/(\d+)%/g, (_m, n) => pct(n, t));
}

/** Un printf minimal : seuls %s et %% servent ici. */
function format(pattern, ...args) {
    let index = 0;
    return pattern.replace(/%[s%]/g, match => (match === '%%' ? '%' : args[index++] ?? ''));
}
