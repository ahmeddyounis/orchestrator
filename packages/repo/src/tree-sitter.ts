import path from 'path';
import Parser from 'tree-sitter';

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

export function getParser(lang: SupportedLanguage): Parser | null {
    try {
        const parser = new Parser();
        const language = langLoaders[lang]();
        parser.setLanguage(language.typescript || language.javascript || language.python || language.go || language.rust || language);
        return parser;
    } catch (e) {
        console.error(`Failed to load parser for ${lang}`, e);
        return null;
    }
}

export function parse(content: string, lang: SupportedLanguage): Parser.Tree | null {
    const parser = getParser(lang);
    if (!parser) {
        return null;
    }
    return parser.parse(content);
}

export async function parseFileToTree(content: string, filePath: string, languageHint?: SupportedLanguage) {
    const language = languageHint ?? getLanguageForFile(filePath);
    if (!language) {
        return null;
    }

    const parser = getParser(language);
    if (!parser) {
        return null;
    }
    
    // timebox parsing
    const timeout = 500;
    
    const parsePromise = new Promise<Parser.Tree>((resolve) => {
        const tree = parser.parse(content);
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
