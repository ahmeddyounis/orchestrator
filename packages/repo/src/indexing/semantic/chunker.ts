import { createHash } from 'crypto';
import Parser, { Query } from 'tree-sitter';
import { getLanguageForFile, getParser } from '../../tree-sitter';
import { FileInput, SemanticChunk } from './types';

// These should probably be configurable
const MIN_CHUNK_CHARS = 50;
const MAX_CHUNK_CHARS = 2500;
const HARD_MAX_CHUNK_CHARS = 5000;

// Based on https://github.com/tree-sitter/tree-sitter-typescript/blob/master/src/node-types.json
const TS_QUERY = `
(function_declaration name: (identifier) @name) @body
(lexical_declaration (variable_declarator name: (identifier) @name (arrow_function) @body)) @export
(function_expression name: (identifier) @name) @body
(method_definition name: (property_identifier) @name) @body
(class_declaration name: (type_identifier) @name) @body
(interface_declaration name: (type_identifier) @name) @body
(type_alias_declaration name: (type_identifier) @name) @body
(export_statement (lexical_declaration (variable_declarator name: (identifier) @name))) @body
(export_statement (function_declaration name: (identifier) @name)) @body
(export_statement (class_declaration name: (type_identifier) @name)) @body
(export_statement (interface_declaration name: (type_identifier) @name)) @body
(export_statement (type_alias_declaration name: (type_identifier) @name)) @body
`;

const KIND_MAP: Record<string, SemanticChunk['kind']> = {
  function_declaration: 'function',
  method_definition: 'method',
  class_declaration: 'class',
  interface_declaration: 'interface',
  type_alias_declaration: 'type',
  export_statement: 'export',
  lexical_declaration: 'const',
};

function getNodeName(node: Parser.SyntaxNode): string {
  const directNameNode = node.childForFieldName('name');
  if (directNameNode) {
    return directNameNode.text;
  }

  const nameNode =
    node.descendantsOfType('property_identifier')[0] ??
    node.descendantsOfType('type_identifier')[0] ??
    node.descendantsOfType('identifier')[0];
  return nameNode?.text ?? 'anonymous';
}

function getNodeKind(node: Parser.SyntaxNode): SemanticChunk['kind'] {
  return KIND_MAP[node.type] ?? 'unknown';
}

export class SemanticChunker {
  chunk(file: FileInput): SemanticChunk[] {
    const lang = getLanguageForFile(file.path);
    if (!lang) {
      return [];
    }

    const parserInfo = getParser(lang);
    if (!parserInfo) {
      return [];
    }
    const { parser, language } = parserInfo;

    const tree = parser.parse(file.content);
    const query = new Query(language, this.getQuery(file.language));
    const matches = query.matches(tree.rootNode);

    const chunks: SemanticChunk[] = [];
    for (const match of matches) {
      const node = match.captures[0].node;
      const nameCapture = match.captures.find((capture) => capture.name === 'name');
      const name = nameCapture?.node.text ?? getNodeName(node);

      if (node.type === 'method_definition' && name === 'constructor') {
        continue;
      }
      if (node.type === 'lexical_declaration' && node.parent?.type === 'export_statement') {
        continue;
      }

      if (node.endIndex - node.startIndex < MIN_CHUNK_CHARS) {
        continue;
      }

      const startLine = node.startPosition.row;
      const endLine = node.endPosition.row;
      let content = node.text;

      if (content.length > HARD_MAX_CHUNK_CHARS) {
        content = content.substring(0, HARD_MAX_CHUNK_CHARS) + '...[TRUNCATED]';
      } else if (content.length > MAX_CHUNK_CHARS) {
        // Could do smarter splitting later
        content = content.substring(0, MAX_CHUNK_CHARS) + '...[TRUNCATED]';
      }

      const kind = getNodeKind(node);

      const chunkId = createHash('sha256')
        .update(`${file.path}-${kind}-${name}-${startLine}-${endLine}-${file.fileHash}`)
        .digest('hex');

      chunks.push({
        chunkId,
        path: file.path,
        language: file.language,
        kind,
        name,
        startLine,
        endLine,
        content,
        fileHash: file.fileHash,
        parentName: this.findParentName(node) ?? null,
      });
    }

    return chunks;
  }

  private findParentName(node: Parser.SyntaxNode): string | undefined {
    let current = node.parent;
    while (current) {
      if (current.type === 'class_declaration') {
        return getNodeName(current);
      }
      current = current.parent;
    }
    return undefined;
  }

  private getQuery(language: string): string {
    switch (language.toLowerCase()) {
      case 'typescript':
      case 'javascript':
      case 'tsx':
        return TS_QUERY;
      default:
        return '';
    }
  }
}
