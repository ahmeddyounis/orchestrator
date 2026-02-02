import path from 'node:path';
import Parser from 'tree-sitter';
import treeSitterTypeScript from 'tree-sitter-typescript';
import treeSitterJavaScript from 'tree-sitter-javascript';
import treeSitterPython from 'tree-sitter-python';
import treeSitterGo from 'tree-sitter-go';
import treeSitterRust from 'tree-sitter-rust';

export type SupportedLanguage = 'typescript' | 'javascript' | 'python' | 'go' | 'rust';

type TreeSitterLanguage = NonNullable<Parameters<Parser['setLanguage']>[0]>;

const languageModules: Record<SupportedLanguage, unknown> = {
  typescript: treeSitterTypeScript,
  javascript: treeSitterJavaScript,
  python: treeSitterPython,
  go: treeSitterGo,
  rust: treeSitterRust,
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

function resolveLanguageModule(lang: SupportedLanguage, filePath?: string): TreeSitterLanguage {
  const languageModule = languageModules[lang] as unknown;
  if (languageModule && typeof languageModule === 'object') {
    const mod = languageModule as Record<string, unknown>;

    const ext = filePath ? path.extname(filePath) : '';
    if (lang === 'typescript' && ext === '.tsx') {
      const tsx = mod.tsx;
      if (tsx) {
        return tsx as TreeSitterLanguage;
      }
    }
    if (lang === 'javascript' && ext === '.jsx') {
      const jsx = mod.jsx;
      if (jsx) {
        return jsx as TreeSitterLanguage;
      }
    }

    const language = mod[lang] ?? mod.typescript ?? languageModule;
    return language as TreeSitterLanguage;
  }
  return languageModule as TreeSitterLanguage;
}

export function getParser(
  lang: SupportedLanguage,
  filePath?: string,
): { parser: Parser; language: TreeSitterLanguage } | null {
  try {
    const parser = new Parser();
    const language = resolveLanguageModule(lang, filePath);
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

function countParseErrors(tree: Parser.Tree): number {
  const cursor = tree.walk();
  let errorsCount = 0;

  while (true) {
    if (cursor.nodeType === 'ERROR') {
      errorsCount++;
    }
    if (cursor.nodeIsMissing) {
      errorsCount++;
    }

    if (cursor.gotoFirstChild()) {
      continue;
    }

    while (true) {
      if (cursor.gotoNextSibling()) {
        break;
      }
      if (!cursor.gotoParent()) {
        return errorsCount;
      }
    }
  }
}

export async function parseFileToTree(
  content: string,
  filePath: string,
  languageHint?: SupportedLanguage,
) {
  const language = languageHint ?? getLanguageForFile(filePath);
  if (!language) {
    return null;
  }

  const parserInfo = getParser(language, filePath);
  if (!parserInfo) {
    return null;
  }

  // timebox parsing
  const timeoutMs = 500;
  parserInfo.parser.setTimeoutMicros(timeoutMs * 1000);

  const tree = parserInfo.parser.parse(content);
  if (tree === null) {
    return {
      rootNode: null,
      language,
      errorsCount: -1, // indicates timeout
    };
  }
  return {
    rootNode: tree.rootNode,
    language,
    errorsCount: countParseErrors(tree),
  };
}
