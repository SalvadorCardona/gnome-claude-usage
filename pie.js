/* Le camembert, dessiné au Cairo dans une St.DrawingArea.
 *
 * C'est un anneau plutôt qu'un disque plein : à 16 px dans la barre, un disque
 * partiellement rempli se lit mal, alors qu'un arc se compare d'un coup d'œil
 * à l'anneau complet qui lui sert de fond.
 */

import GObject from 'gi://GObject';
import St from 'gi://St';

const TAU = Math.PI * 2;

/* Seuils choisis pour prévenir, pas pour affoler : l'orange arrive à 70 %, le
 * rouge quand il ne reste plus grand-chose.
 *
 * Les teintes sont assombries pour garder au moins 3:1 de contraste sur un
 * fond clair comme sur un fond sombre (seuil WCAG pour les graphiques). Le
 * pourcentage, affiché à côté du camembert et dans les jauges, lève l'ambiguïté
 * quand la teinte seule ne suffit pas à distinguer les niveaux. */
const PALETTE = [
    {upTo: 70, color: [0.18, 0.60, 0.25]},       // vert
    {upTo: 90, color: [0.85, 0.42, 0.05]},       // orange
    {upTo: Infinity, color: [0.85, 0.20, 0.20]}, // rouge
];

export function colorFor(percent) {
    for (const step of PALETTE) {
        if (percent < step.upTo)
            return step.color;
    }
    return PALETTE[PALETTE.length - 1].color;
}

export function cssColorFor(percent) {
    const [r, g, b] = colorFor(percent);
    return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

export const Pie = GObject.registerClass({
    Properties: {
        'percent': GObject.ParamSpec.double(
            'percent', 'percent', 'percent',
            GObject.ParamFlags.READWRITE, 0, 100, 0),
    },
}, class Pie extends St.DrawingArea {
    _init(params = {}) {
        const {diameter = 16, thickness = 4, unknown = false, ...rest} = params;

        // Avant super._init : GObject peut appeler le setter « percent » dès la
        // construction, et il a besoin de trouver ces champs en place.
        this._diameter = diameter;
        this._thickness = thickness;
        this._unknown = unknown;
        this._percent = 0;

        super._init({
            width: diameter,
            height: diameter,
            style_class: 'claude-usage-pie',
            ...rest,
        });

        this.connect('repaint', this._draw.bind(this));
    }

    get percent() {
        return this._percent;
    }

    set percent(value) {
        const clamped = Math.max(0, Math.min(100, value));
        if (clamped === this._percent && !this._unknown)
            return;
        this._percent = clamped;
        this._unknown = false;
        this.queue_repaint();
    }

    /** Aucun relevé disponible : l'anneau reste gris et vide. */
    setUnknown() {
        this._unknown = true;
        this._percent = 0;
        this.queue_repaint();
    }

    _draw(area) {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();
        const cx = width / 2;
        const cy = height / 2;
        const radius = Math.min(width, height) / 2 - this._thickness / 2;

        cr.setLineWidth(this._thickness);
        cr.setLineCap(1 /* Cairo.LineCap.ROUND */);

        // L'anneau de fond, qui matérialise le 100 %.
        cr.setSourceRGBA(1, 1, 1, this._unknown ? 0.15 : 0.18);
        cr.arc(cx, cy, radius, 0, TAU);
        cr.stroke();

        if (!this._unknown && this._percent > 0) {
            const [r, g, b] = colorFor(this._percent);
            const start = -Math.PI / 2;                       // midi
            const sweep = Math.max(0.04, (this._percent / 100) * TAU);
            cr.setSourceRGBA(r, g, b, 1);
            cr.arc(cx, cy, radius, start, start + sweep);
            cr.stroke();
        }

        cr.$dispose();
    }
});
