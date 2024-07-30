import { TFolder, TFile, MarkdownView, Notice, Vault, normalizePath, FuzzySuggestModal, moment } from 'obsidian';
import { IPracticeForeignLanguagePlugin, PracticeForeignLanguageSettings } from './types';
import { getAPI, DataviewApi } from "obsidian-dataview";
import { OpenAI } from 'openai';
import { executeDataviewQuery, extractDataviewQueries, getGeneratorPromptContext } from './utils';

export function addGeneratePatternsCommand(plugin: IPracticeForeignLanguagePlugin) {
    plugin.addCommand({
        id: 'generate-patterns',
        name: 'Generate grammar patterns with words from current file',
        callback: () => generateGrammarPatterns(plugin)
    });
}

async function generateGrammarPatterns(plugin: IPracticeForeignLanguagePlugin): Promise<void> {
    const patternsJson = await askAItoGeneratePatternsJson(plugin);

    if (!patternsJson) {
        new Notice("Failed to generate patterns");
        return;
    }

    // Ensure required folders exist
    await ensureFolder(plugin.app.vault, 'a2_pattern_collections');
    await ensureFolder(plugin.app.vault, 'a2_grammar_patterns');

    // Create the collection file
    const collectionFileName = `${moment().format('YYYYMMDDHHmm')}_pattern_collection.md`;
    const collectionFolder = plugin.app.vault.getAbstractFileByPath('a2_pattern_collections') as TFolder;
    if (!collectionFolder) {
        new Notice("Folder 'a2_pattern_collections' not found");
        return;
    }

    const collectionContent = `---
tags: pattern_grammar_collection
---

# Grammar Pattern Collection

## Czech ➡️ Russian

\`\`\`dataview
table without id "[[" + file.name + "|" + czech + "]]" as Phrase, russian as Translation, "\`INPUT[knowledgeLevel][:" + file.name + "#toTranslationKnowledgeLevel]\`" as "Hard ➡️ Easy", "!speak[" + czech + "]" as 🔈
FROM #grammar_pattern AND [[]]
WHERE contains(file.outlinks, this.file.link)
\`\`\`

## Russian ➡️ Czech

\`\`\`dataview
table without id "[[" + file.name + "|" + russian + "]]" as Translation, czech as Phrase, "\`INPUT[knowledgeLevel][:" + file.name + "#toTranslationKnowledgeLevel]\`" as "Hard ➡️ Easy", "!speak[" + czech + "]" as 🔈
FROM #grammar_pattern AND [[]]
WHERE contains(file.outlinks, this.file.link)
\`\`\`

    `;

    const collectionFile = await plugin.app.vault.create(
        `a2_pattern_collections/${collectionFileName}`,
        collectionContent
    );

    // Create individual pattern files
    let patternCounter = 1;
    for (const pattern of patternsJson) {
        await createPatternNote(plugin, pattern, collectionFileName, patternCounter);
        patternCounter++;
    }
    
    // Open the collection file
    const leaf = plugin.app.workspace.getLeaf(false);
    await leaf.openFile(collectionFile as TFile);
}

async function createPatternNote(plugin: IPracticeForeignLanguagePlugin, pattern: any, collectionFileName: string, patternCounter: number): Promise<void> {
    const patternFileName = `${moment().format('YYYYMMDDHHmmss')}_grammar_pattern_${patternCounter.toString().padStart(3, '0')}.md`;
    
    // Function to convert object to YAML-like string
    const objectToYaml = (obj: any, indent: string = ''): string => {
        return Object.entries(obj).map(([key, value]) => {
            if (Array.isArray(value)) {
                return `${indent}${key}:\n${value.map(item => objectToYaml(item, indent + '  ')).join('')}`;
            } else if (typeof value === 'object' && value !== null) {
                return `${indent}${key}:\n${objectToYaml(value, indent + '  ')}`;
            } else {
                return `${indent}${key}: "${value}"\n`;
            }
        }).join('');
    };

    const patternContent = `---
czech: "${pattern.czech}"
russian: "${pattern.russian}"
grammar:
  structure: "${pattern.grammar.structure}"
nouns:
${objectToYaml(pattern.grammar.nouns, '  ')}
verbs:
${objectToYaml(pattern.grammar.verbs, '  ')}
otherWords:
${objectToYaml(pattern.grammar.otherWords, '  ')}
---

${pattern.czech} - ${pattern.russian}

#grammar_pattern

\`\`\`yaml
${objectToYaml(pattern.grammar, '  ')}
\`\`\`

from pattern collection [[${collectionFileName}]]`;

    await plugin.app.vault.create(`a2_grammar_patterns/${patternFileName}`, patternContent);
}

async function ensureFolder(vault: Vault, path: string): Promise<void> {
    try {
        const folder = vault.getAbstractFileByPath(path);
        if (!folder) {
            await vault.createFolder(path);
            console.log(`Created folder: ${path}`);
        }
    } catch (error) {
        console.error(`Error creating folder ${path}:`, error);
        new Notice(`Failed to create folder: ${path}`);
    }
}

async function askAItoGeneratePatternsJson(plugin: IPracticeForeignLanguagePlugin): Promise<any> {

    const openAI = new OpenAI({
        apiKey: plugin.settings.openaiApiKey,
        dangerouslyAllowBrowser: true
      });
      try {
        const generatorContext = await getGeneratorPromptContext(plugin);
        console.log("Grammar patterns generation context:", generatorContext);
    
        if (!generatorContext) {
          new Notice("Failed to get generator context");
          return;
        }
    
        const prompt = createPrompt(generatorContext);
        let response = await callOpenAI(prompt, openAI);
    
        if (response) {
          console.log("Initial OpenAI API Response:", response);
          
          new Notice("Double-checking and correcting patterns...");
          const correctedPatterns = await doubleCheckPatterns(response, openAI);
          
          console.log("Corrected Patterns:", correctedPatterns);
          new Notice("Pattern generation and correction complete. Check the console for results.");

          return correctedPatterns;
        }
      } catch (error) {
        console.error("Error in generateGrammarPatterns:", error);
        new Notice("Error generating grammar patterns. Check the console for details.");
      }
    }

function createPrompt(context: any): string {
    console.log("Context received in createPrompt:", context);
  
    if (!context || typeof context !== 'object') {
      console.error("Invalid context received in createPrompt");
      return JSON.stringify({
        model: "gpt-3.5-turbo-16k",
        messages: [
          {
            role: "system",
            content: "Error: Invalid context for grammar pattern generation."
          }
        ]
      });
    }
  
    const patternsGrammarRequirements = context.patternsGrammarRequirements || {};
    const patternSklonovaniPads = patternsGrammarRequirements.patternSklonovaniPads || [];
    const patternVerbPersons = patternsGrammarRequirements.patternVerbPersons || [];
    const patternVerbTenses = patternsGrammarRequirements.patternVerbTenses || [];
  
    return JSON.stringify({
        model: "gpt-4",
        //model: "gpt-3.5-turbo-16k",
        messages: [
          {
            role: "system",
            content: "You are a helpful assistant that generates Czech language grammar patterns for language learning. Always return your response as a valid JSON array, strictly adhering to the specified grammar requirements. The Czech and Russian fields are absolutely mandatory and must be provided for every pattern. Ensure all quotes within string values are properly escaped with a backslash (\\)."
          },
          {
            role: "user",
            content: `Generate 20 Czech language grammar patterns based on the following context and requirements:
    
            ${JSON.stringify(context)}
    
            STRICT REQUIREMENTS (must be followed exactly):
            - The "czech" and "russian" fields are MANDATORY for every pattern. Do not omit these under any circumstances.
            - Ensure all quotes within string values are properly escaped with a backslash (\\).
            - Only use the following noun cases (sklonovani) as specified in patternSklonovaniPads. Use the exact names provided:
              ${patternSklonovaniPads.join(', ') || 'No specific cases provided, use common cases'}
            - Only use the following verb persons as specified in patternVerbPersons:
              ${patternVerbPersons.join(', ') || 'No specific verb persons provided, use common forms'}
            - Only use the following verb tenses as specified in patternVerbTenses:
              ${patternVerbTenses.join(', ') || 'No specific verb tenses provided, use common tenses'}
          Additional requirements:
          - Use words from the provided wordlist when possible.
          - Follow parameters from wordlistParameters.
          - Use common words suitable for A2 level Czech.
          - Each pattern should be a short phrase of 3-5 words commonly used by Czech speakers in everyday speech.
          - Provide a diverse set of patterns to practice the specified grammar construction.
  
          Return the result as a JSON array of objects, each with the following structure:
          {
            "czech": "Czech phrase", // MANDATORY
            "russian": "Russian translation", // MANDATORY
            "grammar": {
              "nounForm": "Exact name of the noun case used (if applicable, must be from the specified list: )",
              "verbForm": "Exact verb person and tense used (if applicable, must be from the specified list)",
              "nounUsed": "The noun used in the phrase in its nominative form (if applicable)",
              "verbUsed": "The verb used in the phrase in its infinitive form (if applicable)",
              "adjectiveUsed": "The adjective used in the phrase in its basic form (if applicable)",
              "adverbUsed": "The adverb used in the phrase (if applicable)",
              "numeralUsed": "The numeral used in the phrase (if applicable)",
              "grammarNoteInCzech": "Brief grammar note in Czech",
              "grammarNoteInEnglish": "Brief grammar note in English",
              "grammarNoteInRussian": "Brief grammar note in Russian"
            }
          }
  
          Only include fields in the "grammar" object that are relevant to the specific pattern.
          For nounUsed, always provide the nominative form of the noun.
          For verbUsed, always provide the infinitive form of the verb.
          
          Remember, the "czech" and "russian" fields are absolutely mandatory for each pattern.
        Ensure all quotes within string values are properly escaped with a backslash (\\).`
      }
      ]
    });
  }

  async function callOpenAI(prompt: string, openai: any, model: string = "gpt-3.5-turbo-16k"): Promise<any> {
    let notice: Notice | null = null;
    let startTime = Date.now();
    let timer: NodeJS.Timeout;
  
    try {
      notice = new Notice('Processing query...', 0);
      
      timer = setInterval(() => {
        const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
        notice?.setMessage(`Processing query... (${elapsedSeconds}s)`);
      }, 1000);
  
      const response = await openai.chat.completions.create({
        model: model,
        messages: JSON.parse(prompt).messages
      });
      let content = response.choices[0].message.content;
  
      // Attempt to parse the content
      try {
        return JSON.parse(content);
      } catch (parseError) {
        console.error("Error parsing OpenAI response:", parseError);
        console.log("Raw response:", content);
        
        // If parsing fails, make one more attempt to extract JSON from the response
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          try {
            return JSON.parse(jsonMatch[0]);
          } catch (extractError) {
            console.error("Error parsing extracted JSON:", extractError);
          }
        }
        
        new Notice("Error parsing grammar patterns. Check the console for details.");
        return null;
      }
    } catch (error) {
      console.error("Error calling OpenAI API:", error);
      new Notice("Error generating grammar patterns. Check the console for details.");
      return null;
    } finally {
      if (timer) clearInterval(timer);
      if (notice) notice.hide();
    }
  }

  async function doubleCheckPatterns(patterns: any[], openAI: any): Promise<any[]> {
    const checkPrompt = JSON.stringify({
        model: "gpt-4",
        messages: [
            {
                role: "system",
                content: "You are an expert Czech language teacher with deep knowledge of Czech grammar, including noun cases, verb conjugations, and other grammatical nuances. Your task is to review, correct, and enrich Czech language patterns with detailed grammatical information."
            },
            {
                role: "user",
                content: `Review, correct, and enrich the following Czech language patterns. For each pattern:
                1. Verify and correct the overall grammatical structure.
                2. For each noun found:
                   - Add its base form (nominative singular)
                   - Specify the case used in the pattern
                   - Indicate plurality (singular or plural)
                3. For each verb found:
                   - Add its infinitive form
                   - Specify the conjugation (person and number)
                   - Indicate the tense used
                4. Ensure all other grammatical information is accurate and complete.

                Here are the patterns to review:

                ${JSON.stringify(patterns, null, 2)}

                IMPORTANT: Your response must be ONLY the corrected and enriched JSON array of patterns. Do not include any explanations or additional text outside the JSON structure. Each pattern in the array should maintain the overall structure as the input, with corrections and additions applied where necessary. The 'grammar' object should be expanded to include detailed information about each word as specified above.

                CRITICAL: Ensure that 'nouns', 'verbs', and 'otherWords' are arrays, where each word is a separate object within the array. Do not flatten these structures.

                Example of desired output structure for the 'grammar' object:
                "grammar": {
                  "structure": "Overall grammatical structure of the phrase",
                  "nouns": [
                    {
                      "word": "Used form in the pattern",
                      "baseForm": "Nominative singular",
                      "case": "Case used in the pattern",
                      "plurality": "singular/plural"
                    },
                    {
                      "word": "Another noun in the pattern",
                      "baseForm": "Its nominative singular",
                      "case": "Its case in the pattern",
                      "plurality": "singular/plural"
                    }
                  ],
                  "verbs": [
                    {
                      "word": "Used form in the pattern",
                      "infinitive": "Infinitive form",
                      "conjugation": "Person and number",
                      "tense": "Tense used"
                    }
                  ],
                  "otherWords": [
                    {
                      "word": "Any other significant word",
                      "type": "adjective/adverb/etc.",
                      "grammaticalInfo": "Any relevant grammatical information"
                    }
                  ]
                }`
            }
        ]
    });

    const response = await callOpenAI(checkPrompt, openAI, "gpt-4");
    return response;
}

export function shouldFillFrontmatterWithWordList(content: string, frontmatter: any): boolean {
    // Check for Dataview query
    const hasDataviewQuery = /```dataview\s[\s\S]*?```/.test(content);

    // Check for specific frontmatter properties
    const hasFrontmatterProperties = frontmatter && 
        (Array.isArray(frontmatter.vzorList) ||
         Array.isArray(frontmatter.partsOfSpeechList) ||
         Array.isArray(frontmatter.themeList) ||
         typeof frontmatter.patternSklonovaniPads !== 'undefined');

    // Check for specific meta-bind inputs
    const hasMetaBindInputs = 
        content.includes('INPUT[wordThemesList][:themeList]') ||
        content.includes('INPUT[partOfSpeechList][:partsOfSpeechList]') ||
        content.includes('INPUT[grammarPatternsList][:vzorList]');

    return hasDataviewQuery && (hasFrontmatterProperties || hasMetaBindInputs);
} 

export async function fillFrontmatterWithWordList(file: TFile, content: string, frontmatter: any, plugin: IPracticeForeignLanguagePlugin) {
    try {
        if (!shouldFillFrontmatterWithWordList(content, frontmatter)) {
            // console.log(`Skipping file ${file.path}: not a candidate for processing`);
            return;
        }

        const dvapi = getAPI();
        if (!dvapi) {
            console.error('Dataview API not available');
            return;
        }

        const queries = extractDataviewQueries(content);
        if (queries.length === 0) {
            console.error(`No dataview queries found in the file ${file.path}`);
            return;
        }

        const firstQuery = queries[0];
        const queryResult = await executeDataviewQuery(dvapi, firstQuery, file.path);

        const words = await Promise.all(queryResult.slice(0, 20).map(async (row: any) => {
            if (typeof row[0] !== 'string') {
                console.warn(`Unexpected row format in ${file.path}: ${JSON.stringify(row)}`);
                return null;
            }
            const fileLink = row[0];
            const filePath = fileLink.replace(/\[\[(.*?)\|.*?\]\]/, "$1") + ".md";
            const page = dvapi.page(filePath);
            return page?.slovo || null;
        }));

        const filteredWords = words.filter((word): word is string => word !== null);

        await updateFrontmatter(file, filteredWords, frontmatter, plugin);
    } catch (error) {
        console.error(`Error in fillFrontmatterWithWordList for ${file.path}:`, error);
        new Notice(`Error updating frontmatter in ${file.path}. Check the console for details.`);
    }
}

async function updateFrontmatter(file: TFile, words: string[], frontmatter: any, plugin: IPracticeForeignLanguagePlugin) {
    await plugin.app.fileManager.processFrontMatter(file, (fm) => {
        fm.words = words;

        // Check for patternSklonovaniPads and update if necessary
        if (Array.isArray(fm.patternSklonovaniPads) && 
            fm.patternSklonovaniPads.includes("4. Akuzativ [koho / co?]") &&
            !fm.patternSklonovaniPads.includes("4. Accusative [koho / co?]")) {
            fm.patternSklonovaniPads.push("4. Accusative [koho / co?]");
        }
    });

    // Update the display in the editor
    const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (view) {
        view.requestSave();
    }
}

export { generateGrammarPatterns };
