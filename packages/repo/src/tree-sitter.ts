import path from 'path';
import Parser, { Language } from 'tree-sitter';

export type SupportedLanguage = 'typescript' | 'javascript' | 'python' | 'go' | 'rust';

const langLoaders: Record<SupportedLanguage, () => any> = {
    typescript: () => require('tree-sitter-typescript'),
    javascript: () => require('tree-sitter-javascript'),
    python: () => require('tree-sitter-python'),
    go: () => require('tree-sitter-go'),
    rust: () => require('tree-sitter-rust'),
};

const extToLang: Record<string, SupportedLanguage> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
};

export function getLanguageForFile(filePath: string): SupportedLanguage | null {
    const ext = path.extname(filePath);
    return extToLang[ext] ?? null;
}

export function getParser(lang: SupportedLanguage): { parser: Parser, language: Language } | null {
    try {
        const parser = new Parser();
        const languageModule = langLoaders[lang]();
        // Handle module inconsistencies: some export the language, some have a property.
        const language = languageModule[lang] || languageModule.typescript || languageModule;
        parser.setLanguage(language);
        return { parser, language };
    } catch (e) {
        console.error(`Failed to load parser for ${lang}`, e);
        return null;
    }
}

export function parse(content: string, lang: SupportedLanguage): Parser.Tree | null {
    const parserInfo = getParser(lang);
    if (!parserInfo) {
        return null;
    }
    return parserInfo.parser.parse(content);
}

export async function parseFileToTree(content: string, filePath: string, languageHint?: SupportedLanguage) {
    const language = languageHint ?? getLanguageForFile(filePath);
    if (!language) {
        return null;
    }

    const parserInfo = getParser(language);
    if (!parserInfo) {
        return null;
    }
    
    // timebox parsing
    const timeout = 500;
    
    const parsePromise = new Promise<Parser.Tree>((resolve) => {
        const tree = parserInfo.parser.parse(content);
        resolve(tree);
    });

    const timeoutPromise = new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), timeout);
    });

    const tree = await Promise.race([parsePromise, timeoutPromise]);

    if (!tree) {
        return {
            rootNode: null,
            language,
            errorsCount: -1, // indicates timeout
        }
    }
    return {
        rootNode: tree.rootNode,
        language,
        errorsCount: tree.rootNode.descendantsOfType('ERROR').length,
    };
}
