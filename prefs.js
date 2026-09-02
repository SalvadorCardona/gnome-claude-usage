import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class ClaudeUsagePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'utilities-system-monitor-symbolic',
        });
        window.add(page);

        const display = new Adw.PreferencesGroup({
            title: _('Display'),
            description: _('What the top bar pie shows.'),
        });
        page.add(display);

        const metric = new Adw.ComboRow({
            title: _('Limit shown'),
            model: new Gtk.StringList({
                strings: [
                    _('Current session (5 h)'),
                    _('This week, all models'),
                    _('This week, main model'),
                    _('Whichever of the three is highest'),
                ],
            }),
        });
        const METRICS = ['session', 'week', 'model', 'max'];
        metric.selected = Math.max(0, METRICS.indexOf(settings.get_string('panel-metric')));
        metric.connect('notify::selected', row => {
            settings.set_string('panel-metric', METRICS[row.selected]);
        });
        display.add(metric);

        const percentage = new Adw.SwitchRow({
            title: _('Show the percentage'),
            subtitle: _('As a number, next to the pie.'),
        });
        settings.bind('show-percentage', percentage, 'active', Gio.SettingsBindFlags.DEFAULT);
        display.add(percentage);

        const reading = new Adw.PreferencesGroup({
            title: _('Reading'),
            description: _('The figures come from “claude -p /usage”, which takes about '
                + 'five seconds to answer and consumes no tokens. The binary path can stay '
                + 'empty: it is looked up in PATH, then in ~/.local/bin/claude and '
                + '~/.claude/local/claude.'),
        });
        page.add(reading);

        const interval = new Adw.SpinRow({
            title: _('Refresh interval'),
            subtitle: _('In seconds. The menu also refreshes when opened.'),
            adjustment: new Gtk.Adjustment({
                lower: 60,
                upper: 3600,
                step_increment: 30,
                page_increment: 300,
            }),
        });
        settings.bind('refresh-interval', interval, 'value', Gio.SettingsBindFlags.DEFAULT);
        reading.add(interval);

        const path = new Adw.EntryRow({
            title: _('Path to the claude binary'),
            show_apply_button: true,
        });
        path.text = settings.get_string('claude-path');
        path.connect('apply', row => settings.set_string('claude-path', row.text.trim()));
        reading.add(path);

        const about = new Adw.PreferencesGroup({
            title: _('About'),
        });
        page.add(about);

        const author = new Adw.ActionRow({
            title: _('Author'),
            subtitle: 'Salvador Cardona — cardona.digital',
            activatable: true,
        });
        author.add_suffix(new Gtk.Image({icon_name: 'adw-external-link-symbolic'}));
        author.connect('activated', () => {
            new Gtk.UriLauncher({uri: 'https://cardona.digital'}).launch(window, null, null);
        });
        about.add(author);
    }
}
