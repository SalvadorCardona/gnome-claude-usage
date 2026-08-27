/* Claude Usage — indicateur de consommation Claude Code pour GNOME Shell.
 *
 * Le camembert de la barre montre une limite (par défaut la fenêtre de 5 h) ;
 * le menu montre les trois, leurs remises à zéro, et ce qui pèse dans la
 * consommation. Les chiffres viennent de `claude -p /usage` (voir usage.js).
 */

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension, gettext as _, ngettext} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Pie, cssColorFor} from './pie.js';
import {formatReset, localizeBullet, localizePeriod, localizeSummary, pct} from './format.js';
import * as Usage from './usage.js';

/* Un relevé plus vieux que ça, à l'ouverture du menu, est rafraîchi : on ne
 * veut pas lire des chiffres d'il y a un quart d'heure. */
const STALE_SECONDS = 60;

/* Le traducteur passé aux fonctions de format.js, qui ignorent tout de gettext
 * pour rester éprouvables hors du shell. */
const T = {_, n: ngettext};

/* Le nom du mois dans la langue de l'utilisateur, que GLib connaît et pas nous. */
function monthName(date) {
    return GLib.DateTime.new_local(date.getFullYear(), date.getMonth() + 1, date.getDate(), 0, 0, 0)
        .format('%OB');
}

/* Comment nommer chaque limite. Le CLI n'en donne que la valeur. */
function limitLabel(limit) {
    switch (limit.key) {
    case 'session':
        return {title: _('Current session'), hint: _('5-hour window')};
    case 'week':
        return {title: _('This week'), hint: _('all models')};
    case 'model':
        return {title: _('This week'), hint: limit.model};
    default:
        return {title: limit.key, hint: ''};
    }
}

/* Les pannes de relevé, dites en clair. */
function errorMessage(error) {
    switch (error?.code) {
    case 'no-binary':
        return _('The “claude” command was not found');
    case 'command-failed':
        return _('“claude -p /usage” failed');
    case 'unreadable':
        return _('Unexpected answer from “claude -p /usage”');
    default:
        return _('Could not read your usage');
    }
}

const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.5, 'Claude Usage');

        this._extension = extension;
        this._settings = extension.getSettings();
        this._data = null;
        this._error = null;
        this._busy = false;
        this._destroyed = false;
        this._timeoutId = 0;

        this._buildPanel();
        this._buildMenu();

        this._settingsChangedId = this._settings.connect('changed', (_s, key) => {
            if (key === 'refresh-interval')
                this._scheduleRefresh();
            else
                this._render();
        });

        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open && this._isStale())
                this.refresh();
        });

        this._render();
        this.refresh();
        this._scheduleRefresh();
    }

    /* --- barre supérieure --- */

    _buildPanel() {
        const box = new St.BoxLayout({
            style_class: 'panel-status-menu-box claude-usage-panel',
        });

        this._panelPie = new Pie({
            diameter: 16,
            thickness: 4,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._panelLabel = new St.Label({
            style_class: 'claude-usage-panel-label',
            y_align: Clutter.ActorAlign.CENTER,
        });

        box.add_child(this._panelPie);
        box.add_child(this._panelLabel);
        this.add_child(box);
    }

    /* --- menu --- */

    _buildMenu() {
        const header = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'claude-usage-header',
        });
        header.add_child(new St.Label({
            text: _('Claude usage'),
            style_class: 'claude-usage-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._refreshButton = new St.Button({
            style_class: 'claude-usage-refresh',
            child: new St.Icon({
                icon_name: 'view-refresh-symbolic',
                icon_size: 16,
            }),
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._refreshButton.connect('clicked', () => this.refresh());
        header.add_child(this._refreshButton);
        this.menu.addMenuItem(header);

        // La rangée de camemberts : une limite par camembert.
        this._gaugesItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'claude-usage-gauges-item',
        });
        this._gauges = new St.BoxLayout({
            style_class: 'claude-usage-gauges',
            x_expand: true,
        });
        this._gaugesItem.add_child(this._gauges);
        this.menu.addMenuItem(this._gaugesItem);

        // Message d'erreur, masqué tant que tout va bien.
        this._errorItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'claude-usage-error-item',
        });
        this._errorLabel = new St.Label({style_class: 'claude-usage-error'});
        this._errorLabel.clutter_text.line_wrap = true;
        this._errorItem.add_child(this._errorLabel);
        this._errorItem.visible = false;
        this.menu.addMenuItem(this._errorItem);

        this._detailsSeparator = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._detailsSeparator);

        this._detailsItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'claude-usage-details-item',
        });
        this._details = new St.BoxLayout({
            style_class: 'claude-usage-details',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        this._detailsItem.add_child(this._details);
        this.menu.addMenuItem(this._detailsItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._footer = new PopupMenu.PopupMenuItem('', {
            reactive: false,
            can_focus: false,
            style_class: 'claude-usage-footer',
        });
        this.menu.addMenuItem(this._footer);

        const prefs = new PopupMenu.PopupMenuItem(_('Settings…'));
        prefs.connect('activate', () => this._extension.openPreferences());
        this.menu.addMenuItem(prefs);
    }

    /* --- relevé --- */

    _isStale() {
        if (!this._data)
            return true;
        const age = GLib.DateTime.new_now_local().difference(this._data.fetchedAt);
        return age / GLib.TIME_SPAN_SECOND > STALE_SECONDS;
    }

    _scheduleRefresh() {
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);

        const interval = this._settings.get_int('refresh-interval');
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, interval, () => {
            this.refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    async refresh() {
        if (this._busy || this._destroyed)
            return;

        this._busy = true;
        this._refreshButton.reactive = false;
        this._render();

        try {
            const path = Usage.findClaude(this._settings.get_string('claude-path'));
            this._data = await Usage.fetchUsage(path);
            this._error = null;
        } catch (error) {
            // Une annulation n'est pas un échec : c'est nous qui l'avons voulue.
            if (!error?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                this._error = error instanceof Usage.UsageError
                    ? error
                    : new Usage.UsageError('unknown', String(error));
                console.warn(`[claude-usage] ${this._error.code} ${this._error.detail}`);
            }
        } finally {
            // Un relevé dure cinq secondes : l'extension a pu être désactivée
            // entre-temps, et il n'y a plus rien à redessiner.
            this._busy = false;
            if (!this._destroyed) {
                this._refreshButton.reactive = true;
                this._render();
            }
        }
    }

    /* --- rendu --- */

    _panelLimit() {
        if (!this._data?.limits.length)
            return null;

        const metric = this._settings.get_string('panel-metric');
        if (metric === 'max') {
            return this._data.limits.reduce(
                (worst, limit) => (limit.percent > worst.percent ? limit : worst));
        }
        return this._data.limits.find(l => l.key === metric) ?? this._data.limits[0];
    }

    _render() {
        const limit = this._panelLimit();

        if (limit) {
            this._panelPie.percent = limit.percent;
            this._panelLabel.visible = this._settings.get_boolean('show-percentage');
            this._panelLabel.text = pct(limit.percent, T);
            this._panelLabel.style = `color: ${cssColorFor(limit.percent)};`;
        } else {
            this._panelPie.setUnknown();
            this._panelLabel.visible = true;
            this._panelLabel.text = this._busy ? '…' : '—';
            this._panelLabel.style = null;
        }

        this._renderGauges();
        this._renderDetails();
        this._renderFooter();
    }

    _renderGauges() {
        this._gauges.destroy_all_children();

        const limits = this._data?.limits ?? [];
        this._gaugesItem.visible = limits.length > 0;

        for (const limit of limits)
            this._gauges.add_child(this._buildGauge(limit));

        this._errorItem.visible = !!this._error;
        if (this._error) {
            const detail = this._error.detail
                ? `\n${this._error.detail.split('\n').slice(0, 4).join('\n')}`
                : '';
            this._errorLabel.text = `${errorMessage(this._error)}${detail}`;
        }
    }

    _buildGauge(limit) {
        const column = new St.BoxLayout({
            style_class: 'claude-usage-gauge',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });

        const stack = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_align: Clutter.ActorAlign.CENTER,
        });
        const pie = new Pie({diameter: 74, thickness: 10});
        pie.percent = limit.percent;
        stack.add_child(pie);
        stack.add_child(new St.Label({
            text: pct(limit.percent, T),
            style_class: 'claude-usage-gauge-value',
            style: `color: ${cssColorFor(limit.percent)};`,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        column.add_child(stack);

        const {title, hint} = limitLabel(limit);
        column.add_child(new St.Label({
            text: title,
            style_class: 'claude-usage-gauge-label',
            x_align: Clutter.ActorAlign.CENTER,
        }));
        column.add_child(new St.Label({
            text: hint,
            style_class: 'claude-usage-gauge-hint',
            x_align: Clutter.ActorAlign.CENTER,
        }));

        const reset = formatReset(limit.resets, T, new Date(), monthName);
        if (reset) {
            column.add_child(new St.Label({
                text: `↻ ${reset}`,
                style_class: 'claude-usage-gauge-reset',
                x_align: Clutter.ActorAlign.CENTER,
            }));
        }

        return column;
    }

    _renderDetails() {
        this._details.destroy_all_children();

        const sections = this._data?.sections ?? [];
        this._detailsItem.visible = sections.length > 0;
        this._detailsSeparator.visible = sections.length > 0;

        for (const section of sections) {
            const title = new St.Label({
                text: `${localizePeriod(section.title, T)} · ${localizeSummary(section.summary, T)}`,
                style_class: 'claude-usage-section-title',
            });
            title.clutter_text.line_wrap = true;
            this._details.add_child(title);

            for (const bullet of section.bullets) {
                const line = new St.Label({
                    text: localizeBullet(bullet, T),
                    style_class: 'claude-usage-bullet',
                });
                line.clutter_text.line_wrap = true;
                this._details.add_child(line);
            }
        }
    }

    _renderFooter() {
        if (this._busy) {
            this._footer.label.text = _('Reading…');
            return;
        }
        if (!this._data) {
            this._footer.label.text = _('No reading yet');
            return;
        }
        this._footer.label.text = _('Read at %s').replace('%s', this._data.fetchedAt.format('%H:%M'));
    }

    destroy() {
        this._destroyed = true;
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }
        Usage.cancel();
        this._settings = null;
        super.destroy();
    }
});

export default class ClaudeUsageExtension extends Extension {
    enable() {
        this._indicator = new Indicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
