import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, setIcon, MarkdownPostProcessorContext, EditorPosition, TFile } from 'obsidian';
import { EditorView, ViewUpdate, Decoration, DecorationSet, WidgetType } from '@codemirror/view';
import { StateField, StateEffect, RangeSetBuilder } from '@codemirror/state';
import { formatCzechGrammarResult, CzechWordAnalysis } from './czechGrammarAnalyzer';
import axios from 'axios';
import yaml from 'js-yaml';

async function retryRequest(fn: () => Promise<any>, retries = 3, delay = 10000): Promise<any> {
    try {
        return await fn();
    } catch (error) {
        if (retries > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
            return retryRequest(fn, retries - 1, delay * 2);
        }
        throw error;
    }
}

interface PracticeForeignLanguageSettings {
    openaiApiKey: string;
    language: string;
    voice: string;
    speed: number;
    buttonIcon: string;
    buttonText: string;
    wordColumn: string;
    translationColumn: string;
    phraseColumn: string;
    phraseTranslationColumn: string;
	wordNoteColumn: string;
    newWordsFolder: string;
	serverURLs: string[];
}

const DEFAULT_SETTINGS: PracticeForeignLanguageSettings = {
    openaiApiKey: '',
    language: 'cs-CZ',
    voice: 'alloy',
    speed: 0.75,
    buttonIcon: 'volume-2',
    buttonText: 'Speak',
    wordColumn: 'Slovo',
    translationColumn: 'Překlad',
    phraseColumn: 'Výraz',
    phraseTranslationColumn: 'Překlad Výrazu',
	wordNoteColumn: 'Poznámka',
    newWordsFolder: 'CzechGrammarWords',
	serverURLs: [
	]
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
	private requestQueue: { word: string; resolve: (value: any) => void; reject: (reason?: any) => void; }[] = [];
    private isProcessingQueue = false;
    private editorExtension: StateField<DecorationSet>;
	private currentServerURLIndex: number = 0;

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

        this.addCommand({
            id: 'analyze-czech-grammar-table',
            name: 'Analyze Czech Grammar Table',
            callback: () => this.analyzeCzechGrammarTable()
        });

		this.addCommand({
            id: 'analyze-current-page-czech-grammar',
            name: 'Analyze Czech Grammar for Current Page',
            callback: () => this.analyzeCurrentPageCzechGrammar()
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

	updateFrontmatter(existingFrontmatter: any, czechWordGrammar: CzechWordAnalysis) {
        const updatedFrontmatter = { ...existingFrontmatter };
        //updatedFrontmatter.grammarData = czechWordGrammar.priruckaData;
        updatedFrontmatter.partOfSpeech = czechWordGrammar.partOfSpeechType;

        if (czechWordGrammar.partOfSpeechType === 'Sloveso') {
            updatedFrontmatter.verbConjugationGroup = czechWordGrammar.verbConjugationGroup;
            updatedFrontmatter.vzor = czechWordGrammar.verbVzor;
            updatedFrontmatter.isIrregularVerb = czechWordGrammar.isIrregularVerb;
        } else if (czechWordGrammar.partOfSpeechType === 'Podstatné jméno') {
			updatedFrontmatter.nounRodFull = czechWordGrammar.nounRodFull;
            updatedFrontmatter.nounRod = czechWordGrammar.nounRod;
            updatedFrontmatter.vzor = czechWordGrammar.nounVzor;
        }

        return updatedFrontmatter;
    }

	determineFilePath(wordData: any, tableHeaderColumns: string[]): string {
        // Check if the wordNoteColumn exists in the table
        if (tableHeaderColumns.includes(this.settings.wordNoteColumn)) {
            const noteLink = wordData.wordNote;
            if (noteLink) {
                const match = noteLink.match(/\[(.*?)\]\((.*?)\)/);
                if (match) {
                    const [, , path] = match;
                    // Extract folder and file name from the path
                    const lastSlashIndex = path.lastIndexOf('/');
                    if (lastSlashIndex !== -1) {
                        const folder = path.substring(0, lastSlashIndex);
                        const fileName = path.substring(lastSlashIndex + 1);
                        return `${folder}/${fileName}`;
                    }
                }
            }
        }
        
        // If the column doesn't exist or the value is not in the expected format,
        // use the old logic
        return `${this.settings.newWordsFolder}/${wordData.slovo}.md`;
    }

	async processWordWithNewPath(wordData: any, tableHeader: string, sourcePath: string, tableHeaderColumns: string[]) {
        const czechWordGrammar = await this.analyzeCzechWordGrammar(wordData.slovo);
        if (czechWordGrammar) {
            const frontmatter = this.createFrontmatter(wordData, czechWordGrammar, tableHeader);
            const content = this.createNoteContent(wordData, czechWordGrammar, sourcePath, tableHeader);
            
            const filePath = this.determineFilePath(wordData, tableHeaderColumns);
            await this.createOrUpdateWordNote(filePath, content);
        } else {
            new Notice(`Failed to analyze word: ${wordData.slovo}`);
        }
    }

	async createOrUpdateWordNote(filePath: string, content: string) {
        try {
            const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
            const dir = this.app.vault.getAbstractFileByPath(dirPath);
            if (!dir) {
                await this.app.vault.createFolder(dirPath);
            }

            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile) {
                await this.app.vault.modify(file, content);
            } else {
                await this.app.vault.create(filePath, content);
            }

            new Notice(`Note for "${filePath}" has been created/updated.`);
        } catch (error) {
            console.error(`Error creating/updating note for "${filePath}":`, error);
            new Notice(`Failed to create/update note for "${filePath}". Check the console for details.`);
        }
    }

	updateNoteContent(content: string, frontmatter: any, czechWordGrammar: CzechWordAnalysis) {
        const yamlFrontmatter = yaml.dump(frontmatter, {
            lineWidth: -1,
            quotingType: '"',
            forceQuotes: true
        });

        const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
        const updatedContent = content.replace(frontmatterRegex, `---\n${yamlFrontmatter}---`);

        // Update the formatted grammar result in the content
        const formattedResult = formatCzechGrammarResult(czechWordGrammar);
        const grammarSectionRegex = /## Grammar\n[\s\S]*?(?=\n##|$)/;
        const grammarSection = `## Grammar\n${formattedResult}`;

        if (updatedContent.match(grammarSectionRegex)) {
            return updatedContent.replace(grammarSectionRegex, grammarSection);
        } else {
            return updatedContent + '\n\n' + grammarSection;
        }
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

                const isSourceMode = transaction.state.field(EditorView.contentAttributes).spellcheck === "true";

                while ((match = regex.exec(text)) !== null) {
                    const [fullMatch, speechText, params] = match;
                    const from = match.index;
                    const to = from + fullMatch.length;
                    const settings = plugin.parseInlineParams(params || '');
                    
                    if (!isSourceMode) {
                        const deco = Decoration.replace({
                            widget: new SpeakButtonWidget(plugin, speechText, settings),
                        });
                        builder.add(from, to, deco);
                    }
                }
                return builder.finish();
            },
            provide(field: StateField<DecorationSet>): any {
                return EditorView.decorations.from(field);
            },
        });
    }

    isSourceMode(state: any): boolean {
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

    async analyzeCzechGrammarTable() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('No active file');
            return;
        }

        const content = await this.app.vault.read(activeFile);
        const lines = content.split('\n');

        let tableStart = -1;
        let tableHeader = '';
		let tableHeaderRow = '';
		let tableHeaderColumns;

        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('## ') && lines[i + 2]?.includes(`${this.settings.wordColumn}`) && lines[i + 2]?.includes(`${this.settings.translationColumn}`)) {
                tableHeader = lines[i];
				tableHeaderRow = lines[i+2];
				tableHeaderColumns = tableHeaderRow.split('|').map(col => col.trim()).filter(col => col);
                tableStart = i + 1;
                break;
            }
        }

        if (tableStart === -1) {
            new Notice('No suitable table found');
            return;
        } else {
			console.log(`Table found at line ${tableStart}, reading words`);
		}

        const tableData = [];
        for (let i = tableStart + 3; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('|') && line.endsWith('|')) {
                const columns = line.split('|').map(col => col.trim()).filter(col => col);
                if (columns.length >= 2) {
					//console.log(`reading line with word, columns: ${columns}`)
                    const rowData = this.extractRowData(columns, tableHeaderColumns, tableHeader);
                    if (rowData) {
                        tableData.push(rowData);
                    }
                }
            } else {
                break; // End of table
            }
        }

		const totalWords = tableData.length;
        let processedWords = 0;

        for (const wordData of tableData) {
            await this.processWordWithNewPath(wordData, tableHeader, activeFile.path, tableHeaderColumns);
            processedWords++;
            new Notice(`Processing words: ${processedWords}/${totalWords}`);
        }

        await this.processQueue(); // Ждем завершения обработки всей очереди

        new Notice(`Processed ${processedWords} words`);
    }


    queueWordAnalysis(wordData: any, tableHeader: string, sourcePath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.requestQueue.push({
                word: wordData.slovo,
                resolve: async (czechWordGrammar) => {
                    if (czechWordGrammar) {
                        const frontmatter = this.createFrontmatter(wordData, czechWordGrammar, tableHeader);
                        const content = this.createNoteContent(wordData, czechWordGrammar, sourcePath, tableHeader);
                        await this.createWordNote(wordData.slovo, frontmatter, content);
                    } else {
                        new Notice(`Failed to analyze word: ${wordData.slovo}`);
                    }
                    resolve();
                },
                reject
            });

            if (!this.isProcessingQueue) {
                this.processQueue();
            }
        });
    }

    async processQueue() {
        if (this.isProcessingQueue) return;
        this.isProcessingQueue = true;

        while (this.requestQueue.length > 0) {
            const request = this.requestQueue.shift();
            if (request) {
                try {
                    const czechWordGrammar = await this.analyzeCzechWordGrammar(request.word);
                    await request.resolve(czechWordGrammar);
                } catch (error) {
                    request.reject(error);
                }
                await this.sleep(10000); 
            }
        }

        this.isProcessingQueue = false;
    }

    sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    extractRowData(columns: string[], tableHeaderColumns: string[], title: string) {
        const columnIndexes = {
            slovo: tableHeaderColumns.indexOf(this.settings.wordColumn),
            preklad: tableHeaderColumns.indexOf(this.settings.translationColumn),
            vyraz: tableHeaderColumns.indexOf(this.settings.phraseColumn),
            prekladVyrazu: tableHeaderColumns.indexOf(this.settings.phraseTranslationColumn),
			wordNote: tableHeaderColumns.indexOf(this.settings.wordNoteColumn)
        };

        if (columnIndexes.slovo === -1 || columnIndexes.preklad === -1) {
            return null;
        }

        return {
            slovo: columns[columnIndexes.slovo],
            preklad: columns[columnIndexes.preklad],
            vyraz: columnIndexes.vyraz !== -1 ? columns[columnIndexes.vyraz] : '',
            prekladVyrazu: columnIndexes.prekladVyrazu !== -1 ? columns[columnIndexes.prekladVyrazu] : '',
            wordNote: columnIndexes.wordNote !== -1 ? columns[columnIndexes.wordNote] : '',
			titleTag: this.convertToTag(title)
        };
    }

    convertToTag(title: string): string {
		// Remove leading '#' symbols and trim whitespace
		const trimmedTitle = title?.trim()?.replace(/^#+\s*/, '').trim();
		// Replace punctuation with underscores, keep all letters (including non-Latin) and numbers
		return trimmedTitle?.replace(/[^\p{L}\p{N}]+/gu, '_')?.toLowerCase()?.replace(/^_|_$/g, '');
	}

    async processWord(wordData: any, tableHeader: string, sourcePath: string) {
        const czechWordGrammar = await this.analyzeCzechWordGrammar(wordData.slovo);
		console.log("processWord, czechWordGrammar = ");
		console.log(czechWordGrammar);
        const frontmatter = this.createFrontmatter(wordData, czechWordGrammar, tableHeader);
        const content = this.createNoteContent(wordData, czechWordGrammar, sourcePath, tableHeader);
        
        await this.createWordNote(wordData.slovo, frontmatter, content);
    }

    async analyzeCurrentPageCzechGrammar() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('No active file');
            return;
        }

        const fileContent = await this.app.vault.read(activeFile);
        const frontmatter = this.app.metadataCache.getFileCache(activeFile)?.frontmatter;

        if (!frontmatter || !frontmatter.slovo) {
            new Notice('No "slovo" property found in frontmatter');
            return;
        }

        const word = frontmatter.slovo;
        const czechWordGrammar = await this.analyzeCzechWordGrammar(word);

        if (czechWordGrammar) {
            const wordData = {
                slovo: word,
                preklad: frontmatter.translation || '',
                vyraz: frontmatter.phrase || '',
                prekladVyrazu: frontmatter.phrase_translation || '',
                titleTag: this.convertToTag(frontmatter.theme || '')
            };

            const updatedContent = this.createNoteContent(wordData, czechWordGrammar, activeFile.path, frontmatter.theme || '');
            
            await this.app.vault.modify(activeFile, updatedContent);
            new Notice(`Note for "${word}" has been updated.`);
        } else {
            new Notice(`Failed to analyze word: ${word}`);
        }
    }

	async analyzeCzechWordGrammar(word: string): Promise<CzechWordAnalysis | null> {
		const serverUrl = this.getNextServerURL();
        try {
            const response = await retryRequest(() => 
                axios.get(serverUrl + '/api/analyze', {
                    params: { word: word },
                    timeout: 10000, // 10 seconds timeout
                    withCredentials: false // Это может помочь с CORS, если сервер настроен соответствующим образом
                })
            );

            if (response.status === 200) {
                const data: CzechWordAnalysis = response.data;
                const formattedResult = formatCzechGrammarResult(data);
                console.log('Formatted result:', formattedResult);
                
                return {
                    ...data,
                    formattedResult: formattedResult
                };
            } else {
                console.error('Error analyzing word:', word, 'Status:', response.status);
                new Notice(`Error analyzing word: ${word}. Status: ${response.status}`);
                return null;
            }
        } catch (error) {
            if (axios.isAxiosError(error)) {
                if (error.code === 'ECONNABORTED') {
                    console.error('Request timed out:', word);
                    new Notice(`Request timed out for word: ${word}`);
                } else if (error.response) {
                    console.error('Error response:', error.response.status, error.response.data);
                    new Notice(`Error analyzing word: ${word}. Status: ${error.response.status}`);
                } else if (error.request) {
                    console.error('No response received:', error.request);
                    new Notice(`No response received for word: ${word}`);
                } else {
                    console.error('Error setting up request:', error.message);
                    new Notice(`Error setting up request for word: ${word}`);
                }
            } else {
                console.error('Unexpected error:', error);
                new Notice(`Unexpected error analyzing word: ${word}`);
            }
            return null;
        }
    }

	createFrontmatter(wordData: any, czechWordGrammar: any, tableHeader: string) {
		let frontmatter: Record<string, any> = {
			slovo: wordData.slovo,
			translation: wordData.preklad,
			theme: tableHeader.replace(/^#+\s*/, '').trim(),
			phrase: wordData.vyraz,
			phrase_translation: wordData.prekladVyrazu,
			partOfSpeech: czechWordGrammar.partOfSpeechType,
			partOfSpeechVerbose: czechWordGrammar.partOfSpeechFull
		};
	
		if (czechWordGrammar.partOfSpeechType === 'Sloveso') {
			frontmatter.verbConjugationGroup = czechWordGrammar.verbConjugationGroup;
			frontmatter.vzor = czechWordGrammar.verbVzor;
			frontmatter.isIrregularVerb = czechWordGrammar.isIrregularVerb;
		} else if (czechWordGrammar.partOfSpeechType === 'Podstatné jméno') {
			frontmatter.nounRod = czechWordGrammar.nounRod;
			frontmatter.nounRodFull = czechWordGrammar.nounRodFull;
			frontmatter.vzor = czechWordGrammar.nounVzor;
		}
	
		// Convert the frontmatter object to YAML format
		const yamlFrontmatter = yaml.dump(frontmatter, {
			lineWidth: -1,  // Disable line wrapping
			quotingType: '"',  // Use double quotes for strings
			forceQuotes: true  // Force quoting of all strings
		});
	
		// Return the YAML frontmatter wrapped in --- without extra quotes
		return `---\n${yamlFrontmatter}---\n`;
	}

	formatPartOfSpeechAndPattern(czechWordGrammar: CzechWordAnalysis): string {
		let result = czechWordGrammar.partOfSpeechFull;
	
		if (czechWordGrammar.nounVzor) {
			result += `. Grammar pattern is: ${czechWordGrammar.nounVzor}`;
		} else if (czechWordGrammar.verbVzor) {
			result += `. Grammar pattern is: ${czechWordGrammar.verbVzor}`;
		}
		return result;
	}

    createNoteContent(wordData: any, czechWordGrammar: any, sourcePath: string, tableHeader: string) {
        const wordTags = this.createTags(wordData, czechWordGrammar, 'czwords');
        const phraseTags = this.createTags(wordData, czechWordGrammar, 'czphrase');
    
        const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
        let sourceLink = sourceFile instanceof TFile 
            ? this.app.metadataCache.fileToLinktext(sourceFile, '') 
            : sourcePath;
    
        const frontmatter = this.createFrontmatter(wordData, czechWordGrammar, tableHeader);
		//console.log("createNoteContent czechWordGrammar = ", czechWordGrammar)
    
        // Create content with trimmed lines
        const content = `${frontmatter}# ${wordData.slovo}
    
    Theme note: [[${tableHeader}]]
	${this.formatPartOfSpeechAndPattern(czechWordGrammar)}
    
    ${wordTags.join(' ')}
    ${wordData.slovo} !speak[${wordData.slovo}] ::: ${wordData.preklad}
    
    ${phraseTags.join(' ')}
    ${wordData.vyraz} !speak[${wordData.vyraz}] ::: ${wordData.prekladVyrazu}
    
    ### Grammar

    link to prirucka: https://prirucka.ujc.cas.cz/?slovo=${encodeURIComponent(wordData.slovo)}
    link to slovnik: https://slovnik.seznam.cz/preklad/cesky_anglicky/${encodeURIComponent(wordData.slovo)}    
    ${czechWordGrammar.formattedResult}
    `;
    
        // Split the content into lines, trim each line, and join back
        return content.split('\n').map(line => line.trim()).join('\n');
    }

	createTags(wordData: any, czechWordGrammar: any, type: 'czwords' | 'czphrase') {
		const basePath = `#flashcards/${type}`;
		const tags = czechWordGrammar?.partOfSpeechType ? [
			`${basePath}/theme/${wordData.titleTag}`,
			`${basePath}/${this.convertToTag(czechWordGrammar.partOfSpeechType).toLowerCase()}`
		] : [
			`${basePath}/theme/${wordData.titleTag}`
		];
	
		if (czechWordGrammar.partOfSpeechType === 'Sloveso' || czechWordGrammar.partOfSpeechType === 'Podstatné jméno') {
			const vzorType = czechWordGrammar.partOfSpeechType === 'Sloveso' ? 'sloveso_vzor' : 'podstatne_jmeno_vzor';
			tags.push(`${basePath}/${vzorType}/${czechWordGrammar.verbVzor || czechWordGrammar.nounVzor}`);
		}
	
		if (czechWordGrammar.partOfSpeechType === 'Sloveso') {
			tags.push(`${basePath}/verbgroup/${czechWordGrammar.verbConjugationGroup}`);
		}
	
		if (czechWordGrammar.partOfSpeechType === 'Podstatné jméno') {
			tags.push(`${basePath}/nounrod/${czechWordGrammar.nounRod}`);
		}
	
		tags.push(`${basePath}/all`);
	
		return tags;
	}

    async createWordNote(word: string, frontmatter: any, content: string) {
		const folderPath = this.settings.newWordsFolder;
		const fileName = `${folderPath}/${word}.md`;
	
		try {
			const folder = this.app.vault.getAbstractFileByPath(folderPath);
			if (!folder) {
				await this.app.vault.createFolder(folderPath);
			}
	
			const file = this.app.vault.getAbstractFileByPath(fileName);
	
			if (file instanceof TFile) {
				await this.app.vault.modify(file, `${content}`);
			} else {
				await this.app.vault.create(fileName, `${content}`);
			}
	
			new Notice(`Note for "${word}" has been created/updated.`);
		} catch (error) {
			console.error(`Error creating/updating note for "${word}":`, error);
			new Notice(`Failed to create/update note for "${word}". Check the console for details.`);
		}
	}

	private getNextServerURL(): string {
        const url = this.settings.serverURLs[this.currentServerURLIndex];
		console.log("using server url: " + url);
        this.currentServerURLIndex = (this.currentServerURLIndex + 1) % this.settings.serverURLs.length;
        return url;
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

        new Setting(containerEl)
            .setName('Word Column')
            .setDesc('Name of the column containing the Czech word')
            .addText(text => text
                .setPlaceholder('Slovo')
                .setValue(this.plugin.settings.wordColumn)
                .onChange(async (value) => {
                    this.plugin.settings.wordColumn = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Translation Column')
            .setDesc('Name of the column containing the translation')
            .addText(text => text
                .setPlaceholder('Překlad')
                .setValue(this.plugin.settings.translationColumn)
                .onChange(async (value) => {
                    this.plugin.settings.translationColumn = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Phrase Column')
            .setDesc('Name of the column containing the example phrase')
            .addText(text => text
                .setPlaceholder('Výraz')
                .setValue(this.plugin.settings.phraseColumn)
                .onChange(async (value) => {
                    this.plugin.settings.phraseColumn = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Phrase Translation Column')
            .setDesc('Name of the column containing the phrase translation')
            .addText(text => text
                .setPlaceholder('Překlad Výrazu')
                .setValue(this.plugin.settings.phraseTranslationColumn)
                .onChange(async (value) => {
                    this.plugin.settings.phraseTranslationColumn = value;
                    await this.plugin.saveSettings();
                }));

				new Setting(containerEl)
				.setName('Word Note Column')
				.setDesc('Name of the column containing the note link for each word')
				.addText(text => text
					.setPlaceholder('Poznámka')
					.setValue(this.plugin.settings.wordNoteColumn)
					.onChange(async (value) => {
						this.plugin.settings.wordNoteColumn = value;
						await this.plugin.saveSettings();
					}));		

        new Setting(containerEl)
            .setName('New Words Folder')
            .setDesc('Folder where new word notes will be created')
            .addText(text => text
                .setPlaceholder('CzechGrammarWords')
                .setValue(this.plugin.settings.newWordsFolder)
                .onChange(async (value) => {
                    this.plugin.settings.newWordsFolder = value;
                    await this.plugin.saveSettings();
                }));

		new Setting(containerEl)
			.setName('Server URLs')
			.setDesc('Enter server URLs (one per line)')
			.addTextArea(text => text
				.setPlaceholder('https://server1.com\nhttps://server2.com')
				.setValue(this.plugin.settings.serverURLs.join('\n'))
				.onChange(async (value) => {
					this.plugin.settings.serverURLs = value.split('\n').filter(url => url.trim() !== '');
					await this.plugin.saveSettings();
				}));
    }
}