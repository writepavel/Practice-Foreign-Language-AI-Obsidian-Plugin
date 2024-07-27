import { TFolder, TFile, Notice, normalizePath, FuzzySuggestModal } from 'obsidian';
import { IPracticeForeignLanguagePlugin, PracticeForeignLanguageSettings } from './types';

export class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
    constructor(private plugin: IPracticeForeignLanguagePlugin) {
        super(plugin.app);
        this.setPlaceholder("Choose a folder to process");
    }

    onChooseItem(item: TFolder, evt: MouseEvent | KeyboardEvent): void {
        processFolderFiles(this.plugin, item);
    }

    getItems(): TFolder[] {
        return this.plugin.app.vault.getAllLoadedFiles()
            .filter((file): file is TFolder => file instanceof TFolder);
    }

    getItemText(item: TFolder): string {
        return item.path;
    }
}

export async function processFolderFiles(plugin: IPracticeForeignLanguagePlugin, folder: TFolder) {
    const settings: PracticeForeignLanguageSettings = plugin.getSettings();
    const files = folder.children.filter((file): file is TFile => file instanceof TFile && file.extension === 'md');
    const totalFiles = files.length;
    let processedFiles = 0;

    const processedFolder = normalizePath(`${folder.path}/processed word tables`);
    if (!await plugin.app.vault.adapter.exists(processedFolder)) {
        await plugin.app.vault.createFolder(processedFolder);
    }

    for (const file of files) {
        try {
            const content = await plugin.app.vault.read(file);
            const lines = content.split('\n');

            let tableStart = -1;
            let tableHeader = '';
            let tableHeaderRow = '';
            let tableHeaderColumns;

            // Find the table start and header
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].startsWith('## ') || lines[i].startsWith('### ')) {
                    tableHeader = lines[i];
                    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
                        if (lines[j].includes(`${settings.wordColumn}`) && lines[j].includes(`${settings.translationColumn}`)) {
                            tableHeaderRow = lines[j];
                            tableHeaderColumns = tableHeaderRow.split('|').map(col => col.trim()).filter(col => col);
                            tableStart = j - 1;
                            break;
                        }
                    }
                    if (tableStart !== -1) break;
                }
            }

            if (tableStart !== -1) {
                const tableData = [];
                for (let i = tableStart + 3; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (line.startsWith('|') && line.endsWith('|')) {
                        const columns = line.split('|').map(col => col.trim()).filter(col => col);
                        if (columns.length >= 2) {
                            const rowData = plugin.extractRowData(columns, tableHeaderColumns, tableHeader);
                            if (rowData) {
                                tableData.push(rowData);
                            }
                        }
                    } else if (line.startsWith('## ') || line.startsWith('### ')) {
                        break;
                    }
                }

                for (const wordData of tableData) {
                    await plugin.processWordFromTable(wordData, tableHeader, tableHeaderColumns, settings.useRemoteGrammarAnalysis);
                }

                // Move the processed file
                const newPath = `${processedFolder}/${file.name}`;
                await plugin.app.vault.rename(file, newPath);

                processedFiles++;
                new Notice(`Processed ${processedFiles}/${totalFiles} files`);
            }
        } catch (error) {
            console.error(`Error processing file ${file.name}:`, error);
            new Notice(`Failed to process file ${file.name}. Check console for details.`);
        }
    }

    new Notice(`Finished processing ${processedFiles}/${totalFiles} files`);
}

export function addProcessFolderCommand(plugin: IPracticeForeignLanguagePlugin) {
    plugin.addCommand({
        id: 'process-folder-files',
        name: 'Process all word tables in a folder',
        callback: () => new FolderSuggestModal(plugin).open()
    });
}