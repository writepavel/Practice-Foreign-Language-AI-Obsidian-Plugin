import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, setIcon, MarkdownPostProcessorContext, EditorPosition, TFile } from 'obsidian';
import { EditorView, ViewUpdate, Decoration, DecorationSet, WidgetType } from '@codemirror/view';
import { StateField, StateEffect, RangeSetBuilder } from '@codemirror/state';
import { formatCzechGrammarResult, CzechWordAnalysis } from './src/czechGrammarAnalyzer';
import { checkAndSetupMetaBind, checkAndSetupDataview, checkAndSetupTemplater } from './src/dependenciesSetup';
import { updateExistingNote, createFrontmatter, createNoteContent, analyzeCzechGrammarForAllWords } from './src/wordNote';
import { addProcessFolderCommand } from './src/allTablesInFolder';
import { setupVocabularyTableProcessor } from './src/vocabularyTrainerTable';
import { addGeneratePatternsCommand, shouldFillFrontmatterWithWordList, fillFrontmatterWithWordList, generateGrammarPatterns } from './src/patternsGenerator';
import { formatForTag, processWordFromTable } from './src/utils';
import { DEFAULT_SETTINGS, PracticeForeignLanguageSettings, IPracticeForeignLanguagePlugin } from './src/types';

import axios from 'axios';
import yaml from 'js-yaml';

async function retryRequest(fn: () => Promise<any>, retries = 1, delay = 10000): Promise<any> {
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

export default class PracticeForeignLanguagePlugin extends Plugin implements IPracticeForeignLanguagePlugin {

    settings: PracticeForeignLanguageSettings;
	private requestQueue: { word: string; resolve: (value: any) => void; reject: (reason?: any) => void; }[] = [];
    private isProcessingQueue = false;
    private editorExtension: StateField<DecorationSet>;
	private currentServerURLIndex: number = 0;

    async onload() {
        await this.loadSettings();

        this.addRibbonIcon('land-plot', 'Generate patterns with AI', () => {
            generateGrammarPatterns(this);
        });

        /*this.addCommand({
            id: 'pfl-process-current-file',
            name: 'Process current file for TTS',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                this.processFileForTTS(editor);
            }
        });
*/

		this.addCommand({
            id: 'create-czech-word-cards',
            name: 'Create Czech Word Cards From Table',
            callback: () => this.analyzeCzechGrammarTable()
        });

		this.addCommand({
            id: 'analyze-current-page-czech-grammar',
            name: 'Analyze Czech Grammar for Current Page',
            callback: () => this.analyzeCurrentPageCzechGrammar()
        });

        this.addCommand({
            id: 'analyze-check-grammar-for-all-words',
            name: 'Analyze Check Grammar for All Words from Current File Query',
            callback: () => analyzeCzechGrammarForAllWords(this)
        });

		try {
			await checkAndSetupMetaBind.call(this);
		} catch (error) {
			console.error('Error during MetaBind setup:', error);
		}

		try {
			await checkAndSetupTemplater.call(this);
		} catch (error) {
			console.error('Error during Templater setup:', error);
		}

        try {
			await checkAndSetupDataview.call(this);
		} catch (error) {
			console.error('Error during Dataview setup:', error);
		}

		addProcessFolderCommand(this);
        addGeneratePatternsCommand(this);

        this.registerEvent(
            this.app.workspace.on('file-open', (file) => this.onFileOpen(file))
        );

        this.addSettingTab(new PracticeForeignLanguageSettingTab(this.app, this));

        this.registerMarkdownCodeBlockProcessor('ai-say-text', (source, el, ctx) => {
            const { text, settings } = this.parseBlockContent(source);
            this.createSpeakButton(el, text, settings);
        });

        this.setupEditorExtension();
        this.registerEditorExtension([this.editorExtension]);

        this.registerMarkdownPostProcessor(this.inlinePostProcessor.bind(this));
		setupVocabularyTableProcessor(this);
    }

    async onFileOpen(file: TFile | null) {
        if (file && file.extension === 'md') {
            const content = await this.app.vault.read(file);
            const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;

            if (shouldFillFrontmatterWithWordList(content, frontmatter)) {
                await fillFrontmatterWithWordList(file, content, frontmatter, this);
            }
        }
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

	public getSettings(): PracticeForeignLanguageSettings {
        return this.settings;
    }

    /*
	async processWordFromTable(wordData: any, tableHeader: string, tableHeaderColumns: string[], withRemoteAnalyze: boolean) {
		let czechWordGrammar: CzechWordAnalysis | null = null;
	
		if (withRemoteAnalyze) {
			czechWordGrammar = await this.analyzeCzechWordGrammar(wordData.slovo);
			if (!czechWordGrammar) {
				new Notice(`Failed to analyze word: ${wordData.slovo}`);
				return;
			}
		}
	
		const filePath = this.determineFilePath(wordData, tableHeaderColumns);
		await this.createOrUpdateWordNote(filePath, wordData, czechWordGrammar, withRemoteAnalyze, tableHeader);
	}
        */
	
    async createOrUpdateWordNote(filePath: string, wordData: any, czechWordGrammar: CzechWordAnalysis | null, withRemoteAnalyze: boolean, tableHeader: string) {
        try {
            const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
            const dir = this.app.vault.getAbstractFileByPath(dirPath);
            if (!dir) {
                await this.app.vault.createFolder(dirPath);
            }
    
            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile) {
                const existingContent = await this.app.vault.read(file);
                const frontmatter = createFrontmatter(wordData, czechWordGrammar, tableHeader);
                const updatedContent = updateExistingNote(existingContent, frontmatter, czechWordGrammar, withRemoteAnalyze, this.settings.flashcardsNoteSection);
                await this.app.vault.modify(file, updatedContent);
            } else {
                const content = createNoteContent(wordData, czechWordGrammar, tableHeader, this.settings.flashcardsNoteSection);
                await this.app.vault.create(filePath, content);
            }
    
            new Notice(`Note for "${filePath}" has been ${withRemoteAnalyze ? 'fully' : 'partially'} created/updated.`);
        } catch (error) {
            console.error(`Error creating/updating note for "${filePath}":`, error);
            new Notice(`Failed to create/update note for "${filePath}". Check the console for details.`);
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
		const withRemoteAnalyze = this.settings.useRemoteGrammarAnalysis;
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
	
		// Find the table start and header
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].startsWith('## ') || lines[i].startsWith('### ')) {
				tableHeader = lines[i];
				// Look for the table header row within the next 5 lines
				for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
					if (lines[j].includes(`${this.settings.wordColumn}`) && lines[j].includes(`${this.settings.translationColumn}`)) {
						tableHeaderRow = lines[j];
						tableHeaderColumns = tableHeaderRow.split('|').map(col => col.trim()).filter(col => col);
						tableStart = j - 1;
						break;
					}
				}
				if (tableStart !== -1) break;
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
					const rowData = this.extractRowData(columns, tableHeaderColumns, tableHeader);
					if (rowData) {
						tableData.push(rowData);
					}
				}
			} else if (line.startsWith('## ') || line.startsWith('### ')) {
				break; // End of table or start of a new section
			}
		}
	
		const totalWords = tableData.length;
		let processedWords = 0;
	
		for (const wordData of tableData) {
			await processWordFromTable(this, wordData, tableHeader, tableHeaderColumns, withRemoteAnalyze);
			processedWords++;
			new Notice(`Processing words: ${processedWords}/${totalWords}`);
		}
	
		await this.processQueue(); // Wait for the entire queue to complete processing
	
		new Notice(`Processed ${processedWords} words`);
	}

    queueWordAnalysis(wordData: any, tableHeader: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.requestQueue.push({
                word: wordData.slovo,
                resolve: async (czechWordGrammar) => {
                    if (czechWordGrammar) {
                        const frontmatter = createFrontmatter(wordData, czechWordGrammar, tableHeader);
                        const content = createNoteContent(wordData, czechWordGrammar, tableHeader, this.settings.flashcardsNoteSection);
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
			partOfSpeech: tableHeaderColumns.indexOf(this.settings.partOfSpeechColumn),
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
            partOfSpeech: columnIndexes.partOfSpeech !== -1 ? columns[columnIndexes.partOfSpeech] : '',
			titleTag: formatForTag(title)
        };
    }

    async processWord(wordData: any, tableHeader: string) {
        const czechWordGrammar = await this.analyzeCzechWordGrammar(wordData.slovo);
		console.log("processWord, czechWordGrammar = ");
		console.log(czechWordGrammar);
        const frontmatter = createFrontmatter(wordData, czechWordGrammar, tableHeader);
        const content = createNoteContent(wordData, czechWordGrammar, tableHeader, this.settings.flashcardsNoteSection);
        
        await this.createWordNote(wordData.slovo, frontmatter, content);
    }
	
	async analyzeCurrentPageCzechGrammar() {
		const withRemoteAnalyze = this.settings.useRemoteGrammarAnalysis;
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice('No active file');
			return;
		}
	
		const frontmatter = this.app.metadataCache.getFileCache(activeFile)?.frontmatter;
	
		if (!frontmatter || !frontmatter.slovo) {
			new Notice('No "slovo" property found in frontmatter');
			return;
		}
	
		const word = frontmatter.slovo;
		const czechWordGrammar = withRemoteAnalyze ? await this.analyzeCzechWordGrammar(word) : null;
	
		const wordData = {
			slovo: word,
			translation: frontmatter.translation || '',
			phrase: frontmatter.phrase || '',
			phrase_translation: frontmatter.phrase_translation || '',
			theme: frontmatter.theme || '',
			partOfSpeech: frontmatter.partOfSpeech || ''
		};
	
		// Create new frontmatter YAML string
		const newFrontmatterYaml = yaml.dump(wordData, {
			lineWidth: -1,
			quotingType: '"',
			forceQuotes: true,
			noRefs: true,
			noCompatMode: true
		});
	
		try {
			// Read the existing content of the file
			const existingContent = await this.app.vault.read(activeFile);
	
			// Use updateExistingNote to update the content
			const updatedContent = await updateExistingNote(existingContent, newFrontmatterYaml, czechWordGrammar, withRemoteAnalyze, this.settings.flashcardsNoteSection);
	
			// Modify the file with the updated content
			await this.app.vault.modify(activeFile, updatedContent);
	
			new Notice(`Note for "${word}" has been updated.`);
		} catch (error) {
			console.error(`Error updating note for "${word}":`, error);
			new Notice(`Failed to update note for "${word}". Check the console for details.`);
		}
	
		if (withRemoteAnalyze && !czechWordGrammar) {
			new Notice(`Failed to analyze word: ${word} but basic word data is updated.`);
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
		//console.log("using server url: " + url);
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
			.setName('Part Of Speech Column')
			.setDesc('Name of the column containing part of speech')
			.addText(text => text
				.setPlaceholder('Slovní druh')
				.setValue(this.plugin.settings.partOfSpeechColumn)
				.onChange(async (value) => {
					this.plugin.settings.partOfSpeechColumn = value;
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
			.setName('Flashcards Note Section')
			.setDesc('Name of word section for flashcards')
			.addText(text => text
				.setPlaceholder('Flashcards')
				.setValue(this.plugin.settings.flashcardsNoteSection)
				.onChange(async (value) => {
					this.plugin.settings.flashcardsNoteSection = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Remote Grammar Analysis')
			.setDesc('Use Remote Grammar Analysis to get additional info about word - noun gender, grammar vzor etc. But it is still very unstable.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useRemoteGrammarAnalysis)
				.onChange(async (value) => {
					this.plugin.settings.useRemoteGrammarAnalysis = value;
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