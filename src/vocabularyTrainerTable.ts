import { MarkdownPostProcessorContext, MarkdownRenderChild } from 'obsidian';
import { StateField, RangeSetBuilder } from '@codemirror/state';
import { Decoration, DecorationSet, WidgetType, ViewPlugin, PluginValue, EditorView, ViewUpdate } from '@codemirror/view';
import { IPracticeForeignLanguagePlugin, PracticeForeignLanguageSettings } from './types';

export function setupVocabularyTableProcessor(plugin: IPracticeForeignLanguagePlugin) {
    // Markdown post-processor
    plugin.registerMarkdownPostProcessor((element: HTMLElement, context: MarkdownPostProcessorContext) => {
        console.log("Post-processor called with element:", element);
        
        const renderChild = new VocabularyTableRenderChild(element, plugin);
        context.addChild(renderChild);
    });
    
    // CodeMirror extension for Live Preview mode
    const vocabularyTableField = StateField.define<DecorationSet>({
        create() { 
            console.log("vocabularyTableField create called");
            return Decoration.none;
        },
        update(oldState, transaction) {
            console.log("vocabularyTableField update called");
            return oldState;
        },
        provide(field) {
            console.log("vocabularyTableField provide called", field);
            return EditorView.decorations.from(field);
        }
    });

    plugin.registerEditorExtension([vocabularyTableField, vocabularyTablePlugin]);
}

class VocabularyTableRenderChild extends MarkdownRenderChild {
    private observer: MutationObserver;

    constructor(containerEl: HTMLElement, private plugin: IPracticeForeignLanguagePlugin) {
        super(containerEl);

        this.observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => {
                        if (node instanceof HTMLElement) {
                            this.processElement(node);
                        }
                    });
                }
            });
        });
    }

    onload() {
        console.log("VocabularyTableRenderChild onload called");
        this.processElement(this.containerEl);
        this.observer.observe(this.containerEl, { childList: true, subtree: true });
    }

    onunload() {
        console.log("VocabularyTableRenderChild onunload called");
        this.observer.disconnect();
    }

    private processElement(element: HTMLElement) {
        console.log("Processing element:", element);
        const sliders = element.querySelectorAll('.knowledge-level-slider');
        if (sliders.length > 0) {
            console.log("Knowledge level sliders found:", sliders);
            sliders.forEach(slider => {
                const table = this.findAncestorTable(slider);
                if (table) {
                    console.log("Vocabulary table found:", table);
                    this.applyVocabularyTableStyling(table);
                } else {
                    console.log("No ancestor table found for the knowledge level slider");
                }
            });
        } else {
            console.log("No knowledge level sliders found in this element");
        }
    }

    private findAncestorTable(element: Element): HTMLTableElement | null {
        let currentElement = element.parentElement;
        while (currentElement) {
            if (currentElement.tagName.toLowerCase() === 'table') {
                return currentElement as HTMLTableElement;
            }
            currentElement = currentElement.parentElement;
        }
        return null;
    }

    private applyVocabularyTableStyling(table: HTMLTableElement) {
        console.log("Applying vocabulary table styling");
        table.classList.add('vocabulary-table');
        
        const rows = table.querySelectorAll('tbody tr');
        rows.forEach((row, rowIndex) => {
            const cells = Array.from(row.querySelectorAll('td'));
            const sliderCellIndex = cells.findIndex(cell => cell.querySelector('.knowledge-level-slider'));
            
            if (sliderCellIndex > 0) {  // Ensure there's a cell before the slider cell
                const translationCell = cells[sliderCellIndex - 1];
                const wordCell = cells[sliderCellIndex - 2];  // The cell before the translation
                const sliderCell = cells[sliderCellIndex];
                
                if (translationCell && wordCell && sliderCell) {
                    console.log(`Processing row ${rowIndex}: word cell ${sliderCellIndex - 2}, translation cell ${sliderCellIndex - 1}, slider cell ${sliderCellIndex}`);
                    
                    translationCell.classList.add('vocabulary-translation');
                    translationCell.classList.add('hidden');
                    
                    const slider = sliderCell.querySelector('.knowledge-level-slider') as HTMLInputElement;
                    
                    const showTranslation = () => {
                        console.log(`Showing translation for row ${rowIndex}`);
                        translationCell.classList.remove('hidden');
                    };
    
                    const hideTranslation = () => {
                        console.log(`Hiding translation for row ${rowIndex}`);
                        translationCell.classList.add('hidden');
                    };
    
                    let isMouseDown = false;
    
                    slider.addEventListener('mousedown', (e: Event) => {
                        console.log(`Mousedown event on slider for row ${rowIndex}`);
                        isMouseDown = true;
                        showTranslation();
                    });
    
                    slider.addEventListener('touchstart', (e: Event) => {
                        console.log(`Touchstart event on slider for row ${rowIndex}`);
                        showTranslation();
                    });
    
                    slider.addEventListener('input', (e: Event) => {
                        console.log(`Input event on slider for row ${rowIndex}, value: ${slider.value}`);
                        if (!isMouseDown) {
                            hideTranslation();
                        }
                    });
    
                    slider.addEventListener('change', (e: Event) => {
                        console.log(`Change event on slider for row ${rowIndex}, value: ${slider.value}`);
                        hideTranslation();
                    });
    
                    document.addEventListener('mouseup', () => {
                        console.log(`Mouseup event for row ${rowIndex}`);
                        isMouseDown = false;
                        hideTranslation();
                    });
    
                    document.addEventListener('touchend', () => {
                        console.log(`Touchend event for row ${rowIndex}`);
                        hideTranslation();
                    });
                } else {
                    console.log(`Missing required cells in row ${rowIndex}`);
                }
            } else {
                console.log(`No slider found in row ${rowIndex}`);
            }
        });
    }

    private createSlider(cell: HTMLTableCellElement, index: number): HTMLInputElement {
        console.log("Creating slider for cell:", index);
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '1';
        slider.max = '3';
        slider.value = '1';
        slider.className = 'knowledge-level-slider';
        slider.id = `slider-${index}`;
        cell.appendChild(slider);
        return slider;
    }
}

class VocabularyTableWidget extends WidgetType {
    constructor(private tableLines: string[], private plugin: IPracticeForeignLanguagePlugin) {
        super();
    }

    toDOM() {
        const table = document.createElement('table');
        table.className = 'vocabulary-table';
        
        const tbody = document.createElement('tbody');
        this.tableLines.forEach((line, index) => {
            const row = document.createElement('tr');
            const cells = line.split('|').filter(cell => cell.trim() !== '');
            cells.forEach((cell, cellIndex) => {
                const cellElement = index === 0 ? document.createElement('th') : document.createElement('td');
                cellElement.innerHTML = cell.trim();
                row.appendChild(cellElement);
            });
            tbody.appendChild(row);
        });
        
        table.appendChild(tbody);
        
        const renderChild = new VocabularyTableRenderChild(table, this.plugin);
        renderChild.onload();
        
        return table;
    }
}

const vocabularyTablePlugin = ViewPlugin.fromClass(
    class implements PluginValue {
        decorations: DecorationSet;

        constructor(view: EditorView) {
            this.decorations = this.buildDecorations(view);
        }

        update(update: ViewUpdate) {
            if (update.docChanged || update.viewportChanged) {
                this.decorations = this.buildDecorations(update.view);
            }
        }

        buildDecorations(view: EditorView) {
            let builder = new RangeSetBuilder<Decoration>();
            for (let { from, to } of view.visibleRanges) {
                let pos = from;
                while (pos <= to) {
                    let line = view.state.doc.lineAt(pos);
                    if (line.text.trim().startsWith('|') && line.text.trim().endsWith('|')) {
                        let tableLines = [line.text];
                        let endLine = line.number;
                        while (endLine < view.state.doc.lines) {
                            endLine++;
                            let nextLine = view.state.doc.line(endLine);
                            if (nextLine.text.trim().startsWith('|') && nextLine.text.trim().endsWith('|')) {
                                tableLines.push(nextLine.text);
                            } else {
                                break;
                            }
                        }
                        if (tableLines.length > 1) {
                            builder.add(line.from, view.state.doc.line(endLine - 1).to, Decoration.replace({
                                widget: new VocabularyTableWidget(tableLines, this.plugin),
                            }));
                        }
                        pos = view.state.doc.line(endLine).from;
                    } else {
                        pos = line.to + 1;
                    }
                }
            }
            return builder.finish();
        }
    },
    {
        decorations: v => v.decorations
    }
);

