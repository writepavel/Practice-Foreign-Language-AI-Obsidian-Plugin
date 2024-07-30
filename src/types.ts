import { App, Plugin } from 'obsidian';
import { CzechWordAnalysis } from './czechGrammarAnalyzer';

export interface PracticeForeignLanguageSettings {
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
    partOfSpeechColumn: string;
    newWordsFolder: string;
    flashcardsNoteSection: string;
    useRemoteGrammarAnalysis: boolean;
	serverURLs: string[];
	metaBindTemplateInitialized: boolean;
}

export const DEFAULT_SETTINGS: PracticeForeignLanguageSettings = {
    openaiApiKey: '',
    language: 'cs-CZ',
    voice: 'alloy',
    speed: 0.75,
    buttonIcon: 'volume-2',
    buttonText: '',
    wordColumn: 'Slovo',
    translationColumn: 'Překlad',
    phraseColumn: 'Výraz',
    phraseTranslationColumn: 'Překlad Výrazu',
	wordNoteColumn: 'Poznámka',
    partOfSpeechColumn: 'Slovní druh',
    flashcardsNoteSection: 'Flashcards',
    newWordsFolder: 'CzechGrammarWords',
    useRemoteGrammarAnalysis: false,
	serverURLs: [
	],
	metaBindTemplateInitialized: false
}

export interface IPracticeForeignLanguagePlugin {
    createOrUpdateWordNote(filePath: unknown, wordData: any, czechWordGrammar: CzechWordAnalysis | null, withRemoteAnalyze: boolean, tableHeader: string): unknown;
    determineFilePath(wordData: any, tableHeaderColumns: string[]): unknown;
    analyzeCzechWordGrammar(slovo: any): CzechWordAnalysis | PromiseLike<CzechWordAnalysis | null> | null;
    registerEditorExtension(arg0: unknown): unknown;
    registerMarkdownPostProcessor(arg0: (element: HTMLElement, context: import("obsidian").MarkdownPostProcessorContext) => void): unknown;
    app: App;
    settings: PracticeForeignLanguageSettings;
    getSettings(): PracticeForeignLanguageSettings;
    extractRowData(columns: string[], tableHeaderColumns: string[], title: string): any;
    addCommand(command: { id: string; name: string; callback: () => void }): void;
}