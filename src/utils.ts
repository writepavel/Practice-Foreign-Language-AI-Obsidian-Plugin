import { Notice } from "obsidian";
import { CzechWordAnalysis } from "./czechGrammarAnalyzer";
import { IPracticeForeignLanguagePlugin } from "./types";
import { getAPI, DataviewApi } from "obsidian-dataview";

/**
 * Converts a string to a tag format.
 * 
 * @param title - The title to convert.
 * @returns The title converted to a tag format.
 */
export function formatForTag(title: string): string {
    // Remove leading '#' symbols and trim whitespace
    const trimmedTitle = title?.trim()?.replace(/^#+\s*/, '').trim();
    // Replace punctuation with underscores, keep all letters (including non-Latin) and numbers
    return trimmedTitle?.replace(/[^\p{L}\p{N}]+/gu, '_')?.toLowerCase()?.replace(/^_|_$/g, '');
}

export async function processWordFromTable(plugin: IPracticeForeignLanguagePlugin, wordData: any, tableHeader: string, tableHeaderColumns: string[], withRemoteAnalyze: boolean) {
    let czechWordGrammar: CzechWordAnalysis | null = null;

    if (withRemoteAnalyze) {
        czechWordGrammar = await plugin.analyzeCzechWordGrammar(wordData.slovo);
        if (!czechWordGrammar) {
            new Notice(`Failed to analyze word: ${wordData.slovo}`);
            return;
        }
    }

    const filePath = plugin.determineFilePath(wordData, tableHeaderColumns);
    await plugin.createOrUpdateWordNote(filePath, wordData, czechWordGrammar, withRemoteAnalyze, tableHeader);
}

export async function getGeneratorPromptContext(plugin: IPracticeForeignLanguagePlugin): Promise<any> {
    const dvapi = getAPI();
    if (!dvapi) {
        new Notice("Dataview plugin is not available");
        return;
    }

    const activeFile = plugin.app.workspace.getActiveFile();
    if (!activeFile) {
        new Notice("No active file");
        return;
    }

    // Get frontmatter of the current file
    const currentFrontmatter = dvapi.page(activeFile.path)?.file?.frontmatter;
    console.log("Frontmatter of the current file:", currentFrontmatter);

    // Extract dataview queries from the file content
    const fileContent = await plugin.app.vault.read(activeFile);
    const queries = extractDataviewQueries(fileContent);

    if (queries.length === 0) {
        new Notice("No dataview queries found in the file");
        return;
    }

    // Use the first query as is
    const firstQuery = queries[0];

    const queryResult = await executeDataviewQuery(dvapi, firstQuery, activeFile.path);

    // Process the results to get frontmatter for each file
    const frontmatters = await Promise.all(queryResult.slice(0, 50).map(async (row) => {
        const fileLink = row[0]; // Assuming the first column is the file link
        const filePath = fileLink.replace(/\[\[(.*?)\|.*?\]\]/, "$1") + ".md";
        const page = dvapi.page(filePath)?.file;
        //console.log("next page is ", page);
        return {
            file: filePath,
            word: page.frontmatter.slovo,
            translation: page.translation,
            ...page.frontmatter
        };
    }));

    const groupedByPartOfSpeech = frontmatters.reduce((acc, curr) => {
        const partOfSpeech = curr.partOfSpeech || 'Undefined';
        if (!acc[partOfSpeech]) {
            acc[partOfSpeech] = [];
        }
        acc[partOfSpeech].push(curr);
        return acc;
    }, {} as Record<string, typeof frontmatters>);

    // Sort the groups alphabetically
    const sortedGroups = Object.fromEntries(
        Object.entries(groupedByPartOfSpeech).sort(([a], [b]) => a.localeCompare(b))
    );

    console.log("Words grouped by part of speech:", sortedGroups);


    Object.entries(sortedGroups).forEach(([partOfSpeech, words]) => {
        console.log(`${partOfSpeech}: ${words.length} words`);
    });

    console.log("Frontmatters of found files (limited to 20):", frontmatters);

    // Create the result object
    const result = {
        wordlist: groupedByPartOfSpeech,
        wordlistParameters: {
            partsOfSpeechList: currentFrontmatter.partsOfSpeechList || [],
            themeList: currentFrontmatter.themeList || [],
            nounGenderList: currentFrontmatter.nounGenderList || [],
            verbConjugationGroups: currentFrontmatter.verbConjugationGroups || []
        },
        patternsGrammarRequirements: {
            patternSklonovaniPads: currentFrontmatter.patternSklonovaniPads || [],
            patternVerbPersons: currentFrontmatter.patternVerbPersons || [],
            patternVerbTenses: currentFrontmatter.patternVerbTenses || [],
            additionalAIPromptForPatterns: currentFrontmatter.additionalAIPromptForPatterns || ''
        }
    };

    return result;

}

export function extractDataviewQueries(content: string): string[] {
    const regex = /```dataview\n([\s\S]*?)\n```/g;
    const queries: string[] = [];
    let match;

    while ((match = regex.exec(content)) !== null) {
        queries.push(match[1].trim());
    }

    return queries;
}

export async function executeDataviewQuery(dvapi: DataviewApi, query: string, sourcePath: string): Promise<any[]> {
    const levelConditionRegex = /and choice\(\(none\(this\.(to|translationTo|toPhrase|phraseTranslationToPhrase)(?:Translation)?ShowLevels\) or \( none\((?:\1(?:Translation)?)?KnowledgeLevel\) and contains\(this\.\1(?:Translation)?ShowLevels, 1\)\)\), true, any\(this\.\1(?:Translation)?ShowLevels, \(level\) => \1(?:Translation)?KnowledgeLevel = level\)\)/g;
    const modifiedQuery = query.replace(levelConditionRegex, '');

    try {
        const result = await dvapi.query(modifiedQuery, sourcePath);
        if (result.successful) {
            return result.value.values;
        } else {
            console.error("Query execution failed:", result.error);
            return [];
        }
    } catch (error) {
        console.error("Error executing query:", error);
        return [];
    }
}