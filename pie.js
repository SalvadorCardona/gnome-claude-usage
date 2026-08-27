/* Le camembert, dessiné au Cairo dans une St.DrawingArea.
 *
 * C'est un anneau plutôt qu'un disque plein : à 16 px dans la barre, un disque
 * partiellement rempli se lit mal, alors qu'un arc se compare d'un coup d'œil
 * à l'anneau complet qui lui sert de fond.
 */

import GObject from 'gi://GObject';
import St from 'gi://St';

const TAU = Math.PI * 2;

/* Seuils choisis pour prévenir, pas pour affoler : l'ambre arrive à la moitié,
 * le rouge seulement quand il ne reste plus grand-chose. */
const PALETTE = [
    {upTo: 50, color: [0.25, 0.72, 0.31]},   // vert
    {upTo: 80, color: [0.82, 0.60, 0.13]},   // ambre
    {upTo: 95, color: [0.94, 0.53, 0.24]},   // orange
    {upTo: Infinity, color: [0.97, 0.32, 0.29]}, // rouge
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
