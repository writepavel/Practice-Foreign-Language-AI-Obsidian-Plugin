export interface CzechWordAnalysis {
    word: string;
    partOfSpeechFull: string;
    partOfSpeechType: string;
    nounRodFull?: string;
    nounRod?: string;
    nounVzor?: string;
    nominativ_single?: string;
    nominativ_plural?: string;
    genitiv_single?: string;
    akuzativ_plural?: string;
    verbVzor?: string;
    verbSuffixGroup?: string;
    verbConjugationGroup?: string;
    isIrregularVerb?: boolean;
    osoba2jednCislo?: string;
    priruckaData?: any; 
} 

export function formatCzechGrammarResult(data: CzechWordAnalysis): string {
    let result = `
    Část řeči: ${data.partOfSpeechFull} (${data.partOfSpeechType})`;

    if (data.partOfSpeechType === 'Podstatné jméno') {
        result += `
        Vzor: ${data.nounVzor}
        Rod: ${data.nounRodFull} (${data.nounRod})
        `;
    } else if (data.partOfSpeechType === 'Sloveso') {
        result += `
        Vzor: ${data.verbVzor}
        Nepravidelné sloveso: ${data.isIrregularVerb ? 'Ano' : 'Ne'}
        `;
        if (data.osoba2jednCislo) {
            result += `2. osoba jednotného čísla: ${data.osoba2jednCislo}\n`;
        }
    }

    if (data.priruckaData) {
        result += '\n' + convertJsonToMarkdownTable(data.priruckaData);
    }

    return result;
}

function convertJsonToMarkdownTable(jsonData: any): string {
    const headers = Object.keys(jsonData);
    const rows = Object.values(jsonData)[0].length;
    const columns = ['', 'jednotné číslo', 'množné číslo'];

    let table = '| ' + columns.join(' | ') + ' |\n';
    table += '| ' + columns.map(() => '------').join(' | ') + ' |\n';

    for (let i = 1; i < headers.length; i++) {
        const row = [headers[i]];
        for (let j = 0; j < rows; j++) {
            row.push(jsonData[headers[i]][j] || '');
        }
        table += '| ' + row.join(' | ') + ' |\n';
    }

    return table;
}

export function analyzeCzechWord(data: any): CzechWordAnalysis {
    const czechWordGrammar: CzechWordAnalysis = {
        word: data.word,
        priruckaData: data.priruckaData,
        verbVzor: data.verbVzor,
        partOfSpeechFull: data.slovnikData?.partOfSpeech || 'NOT_DEFINED',
        partOfSpeechType: determinePartOfSpeechType(data.slovnikData?.partOfSpeech || 'NOT_DEFINED')
    };

    if (czechWordGrammar.partOfSpeechType === 'Sloveso') {
        analyzeVerb(czechWordGrammar);
    }

    return czechWordGrammar;
}

function determinePartOfSpeechType(partOfSpeechFull: string): string {
    if (!partOfSpeechFull || partOfSpeechFull === 'NOT_DEFINED') {
        return 'NOT_DEFINED';
    }

    const types = [
        'Sloveso', 'Podstatné jméno', 'Přídavné jméno', 'Příslovce', 'Číslovka',
        'Předložka', 'Zájmeno', 'Spojka', 'Částice', 'Citoslovce'
    ];
    const lowercaseFullType = partOfSpeechFull.toLowerCase();
    for (const type of types) {
        if (lowercaseFullType.includes(type.toLowerCase())) {
            return type;
        }
    }
    return 'NOT_DEFINED';
}

function analyzeVerb(czechWordGrammar: CzechWordAnalysis): void {
    const infinitive = czechWordGrammar.word;
    czechWordGrammar.verbSuffixGroup = determineVerbSuffixGroup(infinitive);
    
    if (czechWordGrammar.priruckaData) {
        czechWordGrammar.osoba2jednCislo = czechWordGrammar.priruckaData['2. osoba']?.[0] || 'NOT_DEFINED';
        const conjugationInfo = determineVerbConjugation(czechWordGrammar.osoba2jednCislo);
        czechWordGrammar.verbVzor = conjugationInfo.vzor;
        czechWordGrammar.verbConjugationGroup = conjugationInfo.group;
    } else {
        czechWordGrammar.verbVzor = 'NO_GRAMMAR_TABLE';
        czechWordGrammar.verbConjugationGroup = 'NO_GRAMMAR_TABLE';
    }

    czechWordGrammar.isIrregularVerb = determineIfIrregular(czechWordGrammar.verbSuffixGroup, czechWordGrammar.verbConjugationGroup);
}

function determineVerbSuffixGroup(infinitive: string): number | string {
    if (infinitive.endsWith('at')) return 1;
    if (infinitive.endsWith('it') || infinitive.endsWith('et') || infinitive.endsWith('ět')) return 2;
    if (infinitive.endsWith('ovat') || infinitive.endsWith('nout')) return 3;
    return 'NOT_DEFINED';
}

function determineVerbConjugation(osoba2jednCislo: string): { vzor: string; group: number | string } {
    if (osoba2jednCislo.endsWith('áš')) return { vzor: 'Dělat', group: 1 };
    if (osoba2jednCislo.endsWith('íš')) return { vzor: 'Mluvit', group: 2 };
    if (osoba2jednCislo.endsWith('ješ')) return { vzor: 'Studovat', group: 3 };
    return { vzor: 'NOT_DEFINED', group: 'NOT_DEFINED' };
}

function determineIfIrregular(suffixGroup: number | string, conjugationGroup: number | string): boolean | string {
    if (suffixGroup === 'NO_GRAMMAR_TABLE' || conjugationGroup === 'NOT_DEFINED') return 'NOT_DEFINED';
    if (suffixGroup === conjugationGroup) return false;
    return true;
}