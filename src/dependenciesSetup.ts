import { Notice, Plugin, Modal, Setting } from 'obsidian';
import { DEFAULT_SETTINGS, PracticeForeignLanguageSettings } from './types';

interface MetaBindPlugin extends Plugin {
  settings: {
    inputFieldTemplates: Array<{
      declaration: string;
      name: string;
    }>;
  };
  saveSettings: () => Promise<void>;
}

class MetaBindInstallPrompt extends Modal {
  constructor(app: any) {
    super(app);
  }

  onOpen() {
    const {contentEl} = this;
    contentEl.createEl('h2', {text: 'MetaBind Plugin Required'});
    contentEl.createEl('p', {text: 'This plugin requires the MetaBind plugin to function properly. Would you like to install it now?'});
    
    contentEl.createEl('p', {
      text: 'After installing MetaBind, please disable and re-enable this plugin, or reload Obsidian to complete the setup.',
      cls: 'mod-warning'
    });
    
    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText('Install MetaBind')
        .setCta()
        .onClick(() => {
          window.open('https://obsidian.md/plugins?id=obsidian-meta-bind-plugin', '_blank');
          this.close();
        }))
      .addButton(btn => btn
        .setButtonText('Cancel')
        .onClick(() => {
          this.close();
        }));
  }

  onClose() {
    const {contentEl} = this;
    contentEl.empty();
  }
}

class TemplaterInstallPrompt extends Modal {
  constructor(app: any) {
    super(app);
  }

  onOpen() {
    const {contentEl} = this;
    contentEl.createEl('h2', {text: 'Templater Plugin Required'});
    contentEl.createEl('p', {text: 'This plugin requires the Templater plugin to function properly. Would you like to install it now?'});
    
    contentEl.createEl('p', {
      text: 'After installing Templater, please disable and re-enable this plugin, or reload Obsidian to complete the setup.',
      cls: 'mod-warning'
    });
    
    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText('Install Templater')
        .setCta()
        .onClick(() => {
          window.open('https://obsidian.md/plugins?id=templater-obsidian', '_blank');
          this.close();
        }))
      .addButton(btn => btn
        .setButtonText('Cancel')
        .onClick(() => {
          this.close();
        }));
  }

  onClose() {
    const {contentEl} = this;
    contentEl.empty();
  }
}

export async function checkAndSetupTemplater(this: Plugin): Promise<void> {
  try {
    const dataviewPlugin = this.app.plugins.plugins['templater-obsidian'] as Plugin | undefined;

    if (!dataviewPlugin) {
      new Notice('Templater plugin is required. Please install it to use this feature.', 10000);
      new TemplaterInstallPrompt(this.app).open();
      return;
    }
  } catch (error) {
    console.error('Error in checkAndSetupTemplater:', error);
    new Notice(`Error setting up Templater integration: ${error.message}`);
  }
}

class DataviewInstallPrompt extends Modal {
  constructor(app: any) {
    super(app);
  }

  onOpen() {
    const {contentEl} = this;
    contentEl.createEl('h2', {text: 'Dataview Plugin Required'});
    contentEl.createEl('p', {text: 'This plugin requires the Dataview plugin to function properly. Would you like to install it now?'});
    
    contentEl.createEl('p', {
      text: 'After installing Dataview, please disable and re-enable this plugin, or reload Obsidian to complete the setup.',
      cls: 'mod-warning'
    });
    
    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText('Install Dataview')
        .setCta()
        .onClick(() => {
          window.open('https://obsidian.md/plugins?id=dataview', '_blank');
          this.close();
        }))
      .addButton(btn => btn
        .setButtonText('Cancel')
        .onClick(() => {
          this.close();
        }));
  }

  onClose() {
    const {contentEl} = this;
    contentEl.empty();
  }
}

export async function checkAndSetupDataview(this: Plugin): Promise<void> {
  try {
    const dataviewPlugin = this.app.plugins.plugins['dataview'] as Plugin | undefined;

    if (!dataviewPlugin) {
      new Notice('Dataview plugin is required. Please install it to use this feature.', 10000);
      new DataviewInstallPrompt(this.app).open();
      return;
    }
  } catch (error) {
    console.error('Error in checkAndSetupDataView:', error);
    new Notice(`Error setting up DataView integration: ${error.message}`);
  }
}

export async function checkAndSetupMetaBind(this: Plugin): Promise<void> {
  try {
    const metaBindPlugin = this.app.plugins.plugins['obsidian-meta-bind-plugin'] as MetaBindPlugin | undefined;

    if (!metaBindPlugin) {
      new Notice('MetaBind plugin is required. Please install it to use this feature.', 10000);
      new MetaBindInstallPrompt(this.app).open();
      return;
    }

    // Проверяем, инициализированы ли настройки MetaBind
    if (!metaBindPlugin.settings || !Array.isArray(metaBindPlugin.settings.inputFieldTemplates)) {
      throw new Error('MetaBind settings are not properly initialized');
    }

    // Получаем настройки вашего плагина
    const settings = this.settings as YourPluginSettings;

    const templatesConfig = [
      {
        name: 'partOfSpeechSelect',
        declaration: "INPUT[inlineSelect(option(Sloveso),option(Podstatné jméno),option(Přídavné jméno),option(Příslovce),option(Číslovka),option(Předložka),option(Zájmeno),option(Spojka),option(Částice),option(Citoslovce),option(NOT_DEFINED))]"
      },
      {
        name: 'grammarPatternSelect',
        declaration: "INPUT[inlineSelect(option(Dělat),option(Mluvit),option(Studovat),option(Pán),option(Muž),option(Předseda),option(Soudce),option(Hrad),option(Stroj),option(Kamen),option(Les),option(Žena),option(Růže),option(Kost),option(Píseň),option(Město),option(Moře),option(Stavení),option(Kuře),option(NOT_DEFINED))]"
      },
      {
        name: 'nounGenderSelect',
        declaration: "INPUT[inlineSelect(option(mužský_živ),option(mužský_neživ),option(ženský),option(střední),option(NOT_DEFINED))]"
      },
      {
        name: 'grammarPatternsList',
        declaration: "INPUT[listSuggester(option(Dělat),option(Mluvit),option(Studovat),option(Pán),option(Muž),option(Předseda),option(Soudce),option(Hrad),option(Stroj),option(Kamen),option(Les),option(Žena),option(Růže),option(Kost),option(Píseň),option(Město),option(Moře),option(Stavení),option(Kuře),option(NOT_DEFINED))]"
      },
      {
        name: 'nounGendersList',
        declaration: "INPUT[listSuggester(option(mužský_živ),option(mužský_neživ),option(ženský),option(střední),option(NOT_DEFINED))]"
      },
      {
        name: 'partOfSpeechList',
        declaration: "INPUT[listSuggester(option(Sloveso),option(Podstatné jméno),option(Přídavné jméno),option(Příslovce),option(Číslovka),option(Předložka),option(Zájmeno),option(Spojka),option(Částice),option(Citoslovce),option(NOT_DEFINED))]"
      },
      {
        name: 'verbConjugationGroups',
        declaration: "INPUT[listSuggester(option(1, 1 - Dělat),option(2, 2 - Mluvit),option(3, 3 - Studovat),option(NOT_DEFINED))]"
      },
      {
        name: 'showIrregularVerbsMode',
        declaration: "INPUT[suggester(option(any),option(irregular only),option(regular  only),defaultValue(any))]"
      },
      {
        name: 'wordThemesList',
        declaration: "INPUT[listSuggester(optionQuery('#wordlist-theme or \"a2_collections\" or \"a2_collections/processed word tables\"'))]"
      },
      {
        name: 'numberFormSelector',
        declaration: "INPUT[suggester(option(singular and plural),option(singular only),option(plural  only),defaultValue(singular and plural))]"
      },
      {
        name: 'sklonovaniPadsSelector',
        declaration: "INPUT[listSuggester(option(1. Nominativ [kdo / co?]),option(2. Genitiv [koho / čeho?]),option(3. Dativ [komu / čemu?]),option(4. Akuzativ [koho / co?]),option(5. Vokativ [voláme]),option(6. Local [o kom / o čem?]),option(7. Instrumental [kým / čím?]))]"
      },
      {
        name: 'verbsPersonsSelector',
        declaration: "INPUT[listSuggester(option(1. osoba [já]),option(2. osoba [ty / vy]),option(3. osoba [on / ona / ono / oni]))]"
      },
      {
        name: 'verbsTensesSelector',
        declaration: "INPUT[listSuggester(option(Past Tense),option(Present Tense),option(Future Tense))]"
      },
      {
        name: 'knowledgeLevel',
        declaration: "INPUT[slider(addLabels, minValue(1), maxValue(3),class(knowledge-level-slider))]"
      },
      {
        name: 'knowledgeLevelsSuggester',
        declaration: "INPUT[inlineListSuggester(option(1, 1 - Hard),option(2, 2 - Normal),option(3, 3 - Easy))]"
      }
    ];

    let templatesAdded = false;

    for (const template of templatesConfig) {
      const existingTemplate = metaBindPlugin.settings.inputFieldTemplates.find(
        t => t.name === template.name
      );

      if (!existingTemplate) {
        // Добавляем новый шаблон
        metaBindPlugin.settings.inputFieldTemplates.push(template);
        templatesAdded = true;
      }
    }

    if (templatesAdded) {
      // Сохраняем обновленные настройки
      await metaBindPlugin.saveSettings();
      new Notice('Added new templates to MetaBind settings.');
      
      // Отмечаем, что шаблоны были инициализированы
      settings.metaBindTemplatesInitialized = true;
      await this.saveData(settings);
    } else if (!settings.metaBindTemplatesInitialized) {
      // Если шаблоны существуют, но флаг инициализации не установлен
      new Notice('Templates already exist in MetaBind settings.');
      settings.metaBindTemplatesInitialized = true;
      await this.saveData(settings);
    }

    // Проверяем, что шаблоны действительно были добавлены
    const allTemplatesExist = templatesConfig.every(template => 
      metaBindPlugin.settings.inputFieldTemplates.some(t => t.name === template.name)
    );
    if (!allTemplatesExist) {
      throw new Error('Failed to add all templates to MetaBind settings');
    }

  } catch (error) {
    console.error('Error in checkAndSetupMetaBind:', error);
    new Notice(`Error setting up MetaBind integration: ${error.message}`);
  }
}