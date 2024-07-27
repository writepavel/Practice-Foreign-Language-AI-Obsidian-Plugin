import * as yaml from 'js-yaml';
import { CzechWordAnalysis, formatCzechGrammarResult } from './czechGrammarAnalyzer';
import { formatForTag } from './utils';

function parseExistingFrontmatter(frontmatterContent: string): Record<string, any> {
    const lines = frontmatterContent.split('\n');
    const result: Record<string, any> = {};

    for (const line of lines) {
        const match = line.match(/^(\w+):\s*(.*)$/);
        if (match) {
            const [, key, value] = match;
            result[key] = value.replace(/^"(.*)"$/, '$1');
        }
    }

    return result;
}

function mergeFrontmatter(existingFrontmatter: Record<string, any>, newFrontmatter: Record<string, any>): Record<string, any> {
    const updatedFrontmatter = { ...existingFrontmatter };

    for (const key in newFrontmatter) {
        if (newFrontmatter.hasOwnProperty(key) &&
            newFrontmatter[key] !== undefined &&
            newFrontmatter[key] !== null) {

            const existingValue = existingFrontmatter[key];
            if (existingValue === null ||
                existingValue === "" ||
                existingValue === "NOT_DEFINED" ||
                existingValue === undefined) {
                updatedFrontmatter[key] = newFrontmatter[key];
            }
        }
    }

    return updatedFrontmatter;
}

function updateFrontmatterContent(existingContent: string, newFrontmatter: Record<string, any>): string {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
    const frontmatterMatch = existingContent.match(frontmatterRegex);

    let updatedFrontmatter: Record<string, any>;

    if (frontmatterMatch) {
        const existingFrontmatter = parseExistingFrontmatter(frontmatterMatch[1]);
        updatedFrontmatter = mergeFrontmatter(existingFrontmatter, newFrontmatter);
    } else {
        updatedFrontmatter = newFrontmatter;
    }

    const yamlFrontmatter = yaml.dump(updatedFrontmatter, {
        lineWidth: -1,
        quotingType: '"',
        forceQuotes: true,
        noRefs: true,
        noCompatMode: true
    });

    const contentAfterFrontmatter = frontmatterMatch
        ? existingContent.slice(frontmatterMatch[0].length).trim()
        : existingContent.trim();

    return `---\n${yamlFrontmatter.trim()}\n---\n\n${contentAfterFrontmatter}`;
}

function addOrUpdateSection(content: string, sectionName: string, newSectionContent: string): string {
    const sectionRegex = new RegExp(`## ${sectionName}\\n[\\s\\S]*?(?=\\n##|$)`);
    const sectionContent = `## ${sectionName}\n${newSectionContent}`;

    if (content.match(sectionRegex)) {
        return content.replace(sectionRegex, sectionContent);
    } else {
        return content + '\n\n' + sectionContent;
    }
}

function getPartOfSpeech(wordData: any, czechWordGrammar: any): string {
    if (czechWordGrammar?.partOfSpeechType) {
        return czechWordGrammar.partOfSpeechType;
    } else {
        const wordType = (wordData.partOfSpeech || '').toLowerCase();

        const partOfSpeechMap = {
            'slov': 'Sloveso',
            'pod': 'Podstatné jméno',
            'příd': 'Přídavné jméno',
            'přísl': 'Příslovce',
            'čís': 'Číslovka',
            'předl': 'Předložka',
            'záj': 'Zájmeno',
            'spoj': 'Spojka',
            'část': 'Částice',
            'citos': 'Citoslovce'
        };

        for (const [key, value] of Object.entries(partOfSpeechMap)) {
            if (wordType.includes(key.toLowerCase())) {
                return value;
            }
        }

        const additionalChecks = [
            ['verb', 'Sloveso'],
            ['глаг', 'Sloveso'],
            ['noun', 'Podstatné jméno'],
            ['сущ', 'Podstatné jméno'],
            ['подст', 'Podstatné jméno'],
            ['adj', 'Přídavné jméno'],
            ['прил', 'Přídavné jméno'],
            ['adv', 'Příslovce'],
            ['нар', 'Příslovce'],
            ['num', 'Číslovka'],
            ['числ', 'Číslovka'],
            ['prep', 'Předložka'],
            ['пред', 'Předložka'],
            ['pron', 'Zájmeno'],
            ['мест', 'Zájmeno'],
            ['conj', 'Spojka'],
            ['союз', 'Spojka'],
            ['part', 'Částice'],
            ['част', 'Частice'],
            ['interj', 'Citoslovce'],
            ['межд', 'Citoslovce']
        ];

        for (const [check, result] of additionalChecks) {
            if (wordType.includes(check.toLowerCase())) {
                return result;
            }
        }
        return 'NOT_DEFINED';
    }
}

export function createFrontmatter(wordData: any, czechWordGrammar: any, tableHeader: string): Record<string, any> {
    const partOfSpeech = getPartOfSpeech(wordData, czechWordGrammar);
    let frontmatter: Record<string, any> = {
        slovo: wordData.slovo,
        translation: wordData.preklad,
        theme: tableHeader.replace(/^#+\s*/, '').trim(),
        phrase: wordData.vyraz,
        phrase_translation: wordData.prekladVyrazu,
        partOfSpeech: partOfSpeech,
        partOfSpeechVerbose: czechWordGrammar?.partOfSpeechFull
    };

    if (partOfSpeech === 'Sloveso' && czechWordGrammar) {
        frontmatter.verbConjugationGroup = czechWordGrammar.verbConjugationGroup;
        frontmatter.vzor = czechWordGrammar.verbVzor;
        frontmatter.isIrregularVerb = czechWordGrammar.isIrregularVerb;
    } else if (partOfSpeech === 'Podstatné jméno' && czechWordGrammar) {
        frontmatter.nounRod = czechWordGrammar.nounRod;
        frontmatter.nounRodFull = czechWordGrammar.nounRodFull;
        frontmatter.vzor = czechWordGrammar.nounVzor;
    }

    return frontmatter;
}

function formatPartOfSpeechAndPattern(czechWordGrammar: CzechWordAnalysis): string {
    if (czechWordGrammar) {
        let result = czechWordGrammar.partOfSpeechFull;

        if (czechWordGrammar.nounVzor) {
            result += `. Grammar pattern is: ${czechWordGrammar.nounVzor}`;
        } else if (czechWordGrammar.verbVzor) {
            result += `. Grammar pattern is: ${czechWordGrammar.verbVzor}`;
        }
        return result + "\n";
    } else {
        return "";
    }
}

function createFlashcardDecks(wordData: any, czechWordGrammar: any, type: 'czwords' | 'czphrase') {
    const basePath = `#flashcards/${type}`;
    const partOfSpeech = getPartOfSpeech(wordData, czechWordGrammar);
    const tags = partOfSpeech ? [
        `${basePath}/theme/${formatForTag(wordData.titleTag)}`,
        `${basePath}/${formatForTag(partOfSpeech).toLowerCase()}`
    ] : [
        `${basePath}/theme/${formatForTag(wordData.titleTag)}`
    ];

    if (czechWordGrammar?.verbVzor || czechWordGrammar?.nounVzor) {
        const vzorType = partOfSpeech === 'Sloveso' ? 'sloveso_vzor' : 'podstatne_jmeno_vzor';
        tags.push(`${basePath}/${vzorType}/${czechWordGrammar.verbVzor || czechWordGrammar.nounVzor}`);
    }

    if (czechWordGrammar?.verbConjugationGroup) {
        tags.push(`${basePath}/verbgroup/${czechWordGrammar.verbConjugationGroup}`);
    }

    if (czechWordGrammar?.nounRod) {
        tags.push(`${basePath}/nounrod/${czechWordGrammar.nounRod}`);
    }

    tags.push(`${basePath}/all`);

    return tags;
}

function createFlashcardsSection(wordData: any, czechWordGrammar: any): string {

    console.log("createFlashcardsSection wordData = ", wordData);
    console.log("createFlashcardsSection czechWordGrammar = ", czechWordGrammar);

    const wordTags = createFlashcardDecks(wordData, czechWordGrammar, 'czwords');
    const phraseTags = createFlashcardDecks(wordData, czechWordGrammar, 'czphrase');

    return `
    ${wordTags.join(' ')}
    ${wordData.slovo} !speak[${wordData.slovo}] ::: ${wordData.preklad}
    
    ${phraseTags.join(' ')}
    ${wordData.vyraz} !speak[${wordData.vyraz}] ::: ${wordData.prekladVyrazu}
    `;
}
export function unifiedNoteContent(
    existingContent: string | null,
    wordData: any,
    czechWordGrammar: CzechWordAnalysis | null,
    tableHeader: string,
    flashcardsSection: string
): string {
    let content = existingContent || '';
    const newFrontmatter = createFrontmatter(wordData, czechWordGrammar, tableHeader);

    // Update frontmatter
    content = updateFrontmatterContent(content, newFrontmatter);

    // Add or update main content
    const mainContent = `# ${wordData.slovo}
Theme note: [[${tableHeader?.replace(/^#+\s*/, '')?.trim()}]]
${formatPartOfSpeechAndPattern(czechWordGrammar)}
Part Of Speech: \`INPUT[partOfSpeechSelect][:partOfSpeech]\` Noun gender: \`INPUT[nounGenderSelect][:nounRod]\`
Grammar pattern is: \`INPUT[grammarPatternSelect][:vzor]\``;

    // Use a regex to replace the entire section, including the ## header
    const sectionRegex = new RegExp(`^## ${wordData.slovo}\\n[\\s\\S]*?(?=\\n##|$)`, 'm');
    if (content.match(sectionRegex)) {
        content = content.replace(sectionRegex, mainContent);
    } else {
        content += '\n' + mainContent; // Only add one newline
    }

    // Add or update flashcards section
    const flashcardsContent = createFlashcardsSection(wordData, czechWordGrammar);
    content = addOrUpdateSection(content, flashcardsSection, flashcardsContent);

    // Add or update grammar section
    const grammarContent = `link to prirucka: https://prirucka.ujc.cas.cz/?slovo=${encodeURIComponent(wordData.slovo)}
link to slovnik: https://slovnik.seznam.cz/preklad/cesky_anglicky/${encodeURIComponent(wordData.slovo)}    
${czechWordGrammar?.formattedResult ? czechWordGrammar?.formattedResult : ""}`;

    content = addOrUpdateSection(content, 'Grammar', grammarContent);

    // Remove extra newlines between frontmatter and content
    content = content.replace(/---\n+/g, '---\n');

    // Split the content into lines, trim each line, and join back
    return content.split('\n').map(line => line.trim()).join('\n');
}

export function createNoteContent(
    wordData: any,
    czechWordGrammar: any,
    tableHeader: string,
    flashcardsSection: string
): string {
    console.log("createNoteContent tableHeader = ", tableHeader);
    return unifiedNoteContent(
        null, // No existing content for new notes
        wordData,
        czechWordGrammar,
        tableHeader,
        flashcardsSection
    );
}

function frontmatterToObjectType(frontmatterInput: string | Record<string, any>): Record<string, any> {
    if (typeof frontmatterInput === 'string') {
        try {
            const frontmatterDocs = yaml.loadAll(frontmatterInput) as Record<string, any>[];
            return frontmatterDocs[0] || {};
        } catch (error) {
            console.error('Error parsing YAML string:', error);
            return {};
        }
    } else if (typeof frontmatterInput === 'object' && frontmatterInput !== null) {
        return frontmatterInput;
    } else {
        console.error('Invalid frontmatter input type:', typeof frontmatterInput);
        return {};
    }
}

// Simplified updateExistingNote function
export function updateExistingNote(
    existingContent: string,
    newFrontmatterYaml: string,
    czechWordGrammar: CzechWordAnalysis | null,
    withRemoteAnalyze: boolean,
    flashcardsSection: string
): string {

    const newFrontmatter = frontmatterToObjectType(newFrontmatterYaml);
    // Extract necessary data from newFrontmatter to create a wordData object
    const wordData = {
        slovo: newFrontmatter.slovo,
        preklad: newFrontmatter.translation,
        vyraz: newFrontmatter.phrase,
        prekladVyrazu: newFrontmatter.phrase_translation,
        titleTag: newFrontmatter.theme,
        partOfSpeech: newFrontmatter.partOfSpeech
    };

    return unifiedNoteContent(
        existingContent,
        wordData,
        czechWordGrammar,
        newFrontmatter.theme,
        flashcardsSection
    );
}