import { MarkdownPostProcessorContext, MarkdownRenderChild } from 'obsidian';
import { StateField, RangeSetBuilder } from '@codemirror/state';
import { Decoration, DecorationSet, WidgetType, ViewPlugin, PluginValue, EditorView, ViewUpdate } from '@codemirror/view';
import { IPracticeForeignLanguagePlugin, PracticeForeignLanguageSettings } from './types';

export function setupVocabularyTableProcessor(plugin: IPracticeForeignLanguagePlugin) {
    // Markdown post-processor
    plugin.registerMarkdownPostProcessor((element: HTMLElement, context: MarkdownPostProcessorContext) => {
        
        const renderChild = new VocabularyTableRenderChild(element, plugin);
        context.addChild(renderChild);
    });
    
    // CodeMirror extension for Live Preview mode
    const vocabularyTableField = StateField.define<DecorationSet>({
        create() { 
            return Decoration.none;
        },
        update(oldState, transaction) {
            return oldState;
        },
        provide(field) {
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
        this.processElement(this.containerEl);
        this.observer.observe(this.containerEl, { childList: true, subtree: true });
    }

    onunload() {
        this.observer.disconnect();
    }

    private processElement(element: HTMLElement) {
        const sliders = element.querySelectorAll('.knowledge-level-slider');
        if (sliders.length > 0) {
            sliders.forEach(slider => {
                const table = this.findAncestorTable(slider);
                if (table) {
                    this.applyVocabularyTableStyling(table);
                }
            });
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
        table.classList.add('vocabulary-table');
        
        const rows = table.querySelectorAll('tbody tr');
        rows.forEach((row, rowIndex) => {
            const cells = Array.from(row.querySelectorAll('td'));
            const sliderCellIndex = cells.findIndex(cell => cell.querySelector('.knowledge-level-slider'));
            
            if (sliderCellIndex > 0) {
                const translationCell = cells[sliderCellIndex - 1];
                const wordCell = cells[sliderCellIndex - 2];
                const sliderCell = cells[sliderCellIndex];
                
                if (translationCell && wordCell && sliderCell) {
                    
                    translationCell.classList.add('vocabulary-translation');
                    translationCell.setAttribute('data-hidden', 'true');
    
                    const slider = sliderCell.querySelector('.knowledge-level-slider') as HTMLInputElement;
    
                    const toggleTranslation = (show: boolean) => {
                        translationCell.setAttribute('data-hidden', show ? 'false' : 'true');
                    };
    
                    let isMouseDown = false;
                    let isSliderActive = false;
    
                    // Mouse events
                    translationCell.addEventListener('mousedown', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        isMouseDown = true;
                        toggleTranslation(true);
                    });
    
                    /*slider.addEventListener('mousedown', (e) => {
                        isSliderActive = true;
                        toggleTranslation(true);
                    });
    
                    slider.addEventListener('input', (e) => {
                        if (isSliderActive) {
                            e.stopPropagation();
                            toggleTranslation(true);
                        }
                    });*/
    
                    document.addEventListener('mouseup', (e) => {
                        if (isMouseDown || isSliderActive) {
                            e.preventDefault();
                            e.stopPropagation();
                            isMouseDown = false;
                            isSliderActive = false;
                            toggleTranslation(false);
                        }
                    });
    
                    // Touch events
                    translationCell.addEventListener('touchstart', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        isMouseDown = true;
                        toggleTranslation(true);
                    });

                    /*slider.addEventListener('touchstart', (e) => {
                        isSliderActive = true;
                        toggleTranslation(true);
                    });

                    slider.addEventListener('touchmove', (e) => {
                        if (isSliderActive) {
                            e.stopPropagation();
                            toggleTranslation(true);
                        }
                    });*/

                    document.addEventListener('touchend', (e) => {
                        if (isMouseDown || isSliderActive) {
                            e.preventDefault();
                            e.stopPropagation();
                            isMouseDown = false;
                            isSliderActive = false;
                            toggleTranslation(false);
                        }
                    });

                    translationCell.addEventListener('mouseover', () => {
                        // console.log(`${new Date().toISOString().substr(11, 12)} Наведение на ячейку перевода в строке ${rowIndex}`);
                    });
    
                    translationCell.addEventListener('mouseout', () => {
                        // console.log(`${new Date().toISOString().substr(11, 12)} Уход с ячейки перевода в строке ${rowIndex}`);
                    });
                } else {
                    console.log(`${new Date().toISOString().substr(11, 12)} Отсутствуют необходимые ячейки в строке ${rowIndex}`);
                }
            } else {
                console.log(`${new Date().toISOString().substr(11, 12)} Слайдер не найден в строке ${rowIndex}`);
            }
        });
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