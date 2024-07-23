import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, setIcon, MarkdownPostProcessorContext, EditorPosition } from 'obsidian';
import { EditorView, ViewUpdate, Decoration, DecorationSet, WidgetType } from '@codemirror/view';
import { StateField, StateEffect, RangeSetBuilder } from '@codemirror/state';
import axios from 'axios';

interface PracticeForeignLanguageSettings {
    openaiApiKey: string;
    language: string;
    voice: string;
    speed: number;
    buttonIcon: string;
    buttonText: string;
}

const DEFAULT_SETTINGS: PracticeForeignLanguageSettings = {
    openaiApiKey: '',
    language: 'cs-CZ',
    voice: 'alloy',
    speed: 0.75,
    buttonIcon: 'volume-2',
    buttonText: 'Speak'
}

class SpeakButtonWidget extends WidgetType {
    constructor(private plugin: PracticeForeignLanguagePlugin, private text: string, private settings: Partial<PracticeForeignLanguageSettings>) {
        super();
    }

    toDOM() {
        const button = document.createElement('button');
        button.className = 'pfl-speak-button';
        
        const iconSpan = button.createSpan({ cls: 'pfl-button-icon' });
        setIcon(iconSpan, this.settings.buttonIcon || this.plugin.settings.buttonIcon);
        
        const buttonText = this.settings.buttonText || this.plugin.settings.buttonText;
        button.createSpan({ text: buttonText });
        
        button.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.plugin.speakText(this.text, this.settings);
        };
        return button;
    }
}

export default class PracticeForeignLanguagePlugin extends Plugin {
    settings: PracticeForeignLanguageSettings;
    private editorExtension: StateField<DecorationSet>;

    async onload() {
        await this.loadSettings();

        this.addRibbonIcon('volume-2', 'Practice Foreign Language', () => {
            new Notice('Practice Foreign Language plugin is active');
        });

        this.addCommand({
            id: 'pfl-process-current-file',
            name: 'Process current file for TTS',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                this.processFileForTTS(editor);
            }
        });

        this.addSettingTab(new PracticeForeignLanguageSettingTab(this.app, this));

        this.registerMarkdownCodeBlockProcessor('ai-say-text', (source, el, ctx) => {
            const { text, settings } = this.parseBlockContent(source);
            this.createSpeakButton(el, text, settings);
        });

        this.setupEditorExtension();
        this.registerEditorExtension([this.editorExtension]);

        this.registerMarkdownPostProcessor(this.inlinePostProcessor.bind(this));
    }

    setupEditorExtension() {
        const plugin = this;
        this.editorExtension = StateField.define<DecorationSet>({
            create(state): DecorationSet {
                return Decoration.none;
            },
            update(oldState: DecorationSet, transaction): DecorationSet {
                const builder = new RangeSetBuilder<Decoration>();
                const text = transaction.state.doc.toString();
                const regex = /!speak\[(.*?)\](?:\{(.*?)\})?/g;
                let match;

                // Определяем режим редактора
                const isSourceMode = transaction.state.field(EditorView.contentAttributes).spellcheck === "true";

                while ((match = regex.exec(text)) !== null) {
                    const [fullMatch, speechText, params] = match;
                    const from = match.index;
                    const to = from + fullMatch.length;
                    const settings = plugin.parseInlineParams(params || '');
                    
                    if (!isSourceMode) {
                        // В режиме Live Preview или Reading view заменяем текст на кнопку
                        const deco = Decoration.replace({
                            widget: new SpeakButtonWidget(plugin, speechText, settings),
                        });
                        builder.add(from, to, deco);
                    }
                    // В режиме Source не добавляем декорацию, оставляя текст видимым
                }
                return builder.finish();
            },
            provide(field: StateField<DecorationSet>): any {
                return EditorView.decorations.from(field);
            },
        });
    }

    isSourceMode(state: any): boolean {
        // Проверяем наличие определенных расширений, характерных для режима Source
        return state.field(EditorView.contentAttributes).spellcheck === "true";
    }

    inlinePostProcessor(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
        const inlineSpeakRegex = /!speak\[(.*?)\](?:\{(.*?)\})?/g;
        const walker = document.createNodeIterator(el, NodeFilter.SHOW_TEXT);
        let node;
        let matches = [];

        while (node = walker.nextNode()) {
            let match;
            while (match = inlineSpeakRegex.exec(node.nodeValue)) {
                matches.push({node: node, match: match});
            }
        }

        // Process matches in reverse order to avoid messing up indices
        for (let i = matches.length - 1; i >= 0; i--) {
            const {node, match} = matches[i];
            const [fullMatch, text, params] = match;
            const settings = this.parseInlineParams(params);
            
            const buttonEl = this.createSpeakButton(null, text, settings);
            const range = document.createRange();
            range.setStart(node, match.index);
            range.setEnd(node, match.index + fullMatch.length);
            range.deleteContents();
            range.insertNode(buttonEl);
        }
    }

    parseInlineParams(params: string): Partial<PracticeForeignLanguageSettings> {
        const settings: Partial<PracticeForeignLanguageSettings> = {};
        if (params) {
            params.split(',').forEach(param => {
                const [key, value] = param.split('=').map(s => s.trim());
                if (key && value) {
                    switch (key) {
                        case 'language':
                            settings.language = value;
                            break;
                        case 'voice':
                            settings.voice = value;
                            break;
                        case 'speed':
                            settings.speed = parseFloat(value);
                            break;
                        case 'button-icon':
                            settings.buttonIcon = value;
                            break;
                        case 'button-text':
                            settings.buttonText = value;
                            break;
                    }
                }
            });
        }
        return settings;
    }

    createSpeakButton(containerEl: HTMLElement | null, text: string, settings: Partial<PracticeForeignLanguageSettings>): HTMLElement {
        const button = (containerEl || document.createElement('span')).createEl('button', { cls: 'pfl-speak-button' });
        
        const iconSpan = button.createSpan({ cls: 'pfl-button-icon' });
        setIcon(iconSpan, settings.buttonIcon || this.settings.buttonIcon);
        
        const buttonText = settings.buttonText || this.settings.buttonText;
        button.createSpan({ text: buttonText });
        
        button.onclick = () => this.speakText(text, settings);

        return button;
    }

    parseBlockContent(source: string): { text: string, settings: Partial<PracticeForeignLanguageSettings> } {
        const lines = source.split('\n');
        const settings: Partial<PracticeForeignLanguageSettings> & { text?: string } = {};
        let text = '';

        lines.forEach(line => {
            const [key, ...valueParts] = line.split(':').map(s => s.trim());
            const value = valueParts.join(':').trim();
            if (key && value) {
                switch (key.toLowerCase()) {
                    case 'text':
                        settings.text = value;
                        break;
                    case 'language':
                        settings.language = value;
                        break;
                    case 'voice':
                        settings.voice = value;
                        break;
                    case 'speed':
                        settings.speed = parseFloat(value);
                        break;
                    case 'button-icon':
                        settings.buttonIcon = value;
                        break;
                    case 'button-text':
                        settings.buttonText = value;
                        break;
                }
            } else if (!key.includes(':')) {
                text += line + '\n';
            }
        });

        // If text is not specified in settings, use the remaining content
        if (!settings.text) {
            settings.text = text.trim();
        }

        return { text: settings.text || '', settings };
    }

    async speakText(text: string, blockSettings: Partial<PracticeForeignLanguageSettings> = {}) {
        if (!this.settings.openaiApiKey) {
            new Notice('Please set your OpenAI API key in the plugin settings');
            return;
        }

        const finalSettings = { ...this.settings, ...blockSettings };

        try {
            const response = await axios.post(
                'https://api.openai.com/v1/audio/speech',
                {
                    model: "tts-1",
                    input: text,
                    voice: finalSettings.voice,
                    response_format: "mp3",
                    speed: finalSettings.speed,
                    language: finalSettings.language
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.settings.openaiApiKey}`,
                        'Content-Type': 'application/json'
                    },
                    responseType: 'arraybuffer'
                }
            );

            const audioBlob = new Blob([response.data], { type: 'audio/mpeg' });
            const audioUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(audioUrl);
            audio.play();
        } catch (error) {
            console.error('Error generating speech:', error);
            new Notice('Error generating speech. Check console for details.');
        }
    }

    processFileForTTS(editor: Editor) {
        const content = editor.getValue();
        const regex = /```ai-say-text\n([\s\S]*?)\n```/g;
        let match;

        while ((match = regex.exec(content)) !== null) {
            const [, blockContent] = match;
            const { text, settings } = this.parseBlockContent(blockContent);
            this.speakText(text, settings);
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

class PracticeForeignLanguageSettingTab extends PluginSettingTab {
    plugin: PracticeForeignLanguagePlugin;

    constructor(app: App, plugin: PracticeForeignLanguagePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName('OpenAI API Key')
            .setDesc('Enter your OpenAI API key')
            .addText(text => text
                .setPlaceholder('Enter your API key')
                .setValue(this.plugin.settings.openaiApiKey)
                .onChange(async (value) => {
                    this.plugin.settings.openaiApiKey = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Language')
            .setDesc('Select the default language for text-to-speech')
            .addDropdown(dropdown => dropdown
                .addOption('cs-CZ', 'Czech')
                .addOption('uk-UA', 'Ukrainian')
                .addOption('ru-RU', 'Russian')
                .addOption('en-US', 'English')
                .setValue(this.plugin.settings.language)
                .onChange(async (value) => {
                    this.plugin.settings.language = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Voice')
            .setDesc('Select the default voice for text-to-speech')
            .addDropdown(dropdown => dropdown
                .addOption('alloy', 'Alloy')
                .addOption('echo', 'Echo')
                .addOption('fable', 'Fable')
                .addOption('onyx', 'Onyx')
                .addOption('nova', 'Nova')
                .addOption('shimmer', 'Shimmer')
                .setValue(this.plugin.settings.voice)
                .onChange(async (value) => {
                    this.plugin.settings.voice = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Speed')
            .setDesc('Set the default speech speed (0.25 to 4.0)')
            .addSlider(slider => slider
                .setLimits(0.25, 4.0, 0.25)
                .setValue(this.plugin.settings.speed)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.speed = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Button Text')
            .setDesc('Set the default text for the speak button')
            .addText(text => text
                .setPlaceholder('Enter button text')
                .setValue(this.plugin.settings.buttonText)
                .onChange(async (value) => {
                    this.plugin.settings.buttonText = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Button Icon')
            .setDesc('Set the default icon for the speak button')
            .addText(text => text
                .setPlaceholder('Enter icon name')
                .setValue(this.plugin.settings.buttonIcon)
                .onChange(async (value) => {
                    this.plugin.settings.buttonIcon = value;
                    await this.plugin.saveSettings();
                }));
    }
}