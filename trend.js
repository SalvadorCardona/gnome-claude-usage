/* La courbe de tendance du menu, dessinée au Cairo comme le camembert.
 *
 * Elle montre un pourcentage sur sept jours. Avec peu de relevés une ligne ne
 * dit rien (un seul point n'en fait pas une), d'où des points toujours marqués
 * en plus du trait : même isolé, un relevé se voit.
 */

import GObject from 'gi://GObject';
import St from 'gi://St';

import {colorFor} from './pie.js';

const PAD = 6;

export const Trend = GObject.registerClass(
class Trend extends St.DrawingArea {
    _init(params = {}) {
        const {width = 320, height = 64, ...rest} = params;
        super._init({
            width,
            height,
            style_class: 'claude-usage-trend',
            ...rest,
        });
        this._points = [];
        this.connect('repaint', this._draw.bind(this));
    }

    /** Les points de history.series(), x et y déjà bornés. */
    setPoints(points) {
        this._points = points;
        this.queue_repaint();
    }

    _draw(area) {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();
        const w = width - 2 * PAD;
        const h = height - 2 * PAD;
        const px = p => PAD + Math.max(0, Math.min(1, p.x)) * w;
        const py = p => PAD + (1 - Math.max(0, Math.min(100, p.y)) / 100) * h;

        // 0 %, 50 % et 100 % : de quoi lire la hauteur sans graduations écrites.
        cr.setLineWidth(1);
        cr.setSourceRGBA(1, 1, 1, 0.12);
        for (const level of [0, 50, 100]) {
            const y = Math.round(PAD + (1 - level / 100) * h) + 0.5;
            cr.moveTo(PAD, y);
            cr.lineTo(PAD + w, y);
            cr.stroke();
        }

        const points = this._points;
        if (points.length > 1) {
            const last = points[points.length - 1];
            const [r, g, b] = colorFor(last.y);

            cr.moveTo(px(points[0]), PAD + h);
            for (const p of points)
                cr.lineTo(px(p), py(p));
            cr.lineTo(px(last), PAD + h);
            cr.closePath();
            cr.setSourceRGBA(r, g, b, 0.18);
            cr.fill();

            cr.setLineWidth(2);
            cr.setLineJoin(1 /* Cairo.LineJoin.ROUND */);
            cr.moveTo(px(points[0]), py(points[0]));
            for (const p of points.slice(1))
                cr.lineTo(px(p), py(p));
            cr.setSourceRGBA(r, g, b, 1);
            cr.stroke();
        }

        for (const p of points) {
            const [r, g, b] = colorFor(p.y);
            cr.setSourceRGBA(r, g, b, 1);
            cr.arc(px(p), py(p), points.length > 1 ? 2 : 3, 0, Math.PI * 2);
            cr.fill();
        }

        cr.$dispose();
    }
});
