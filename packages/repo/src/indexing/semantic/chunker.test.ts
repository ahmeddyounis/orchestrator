
import { describe, it, expect } from 'vitest';
import { SemanticChunker } from './chunker';
import { FileInput } from './types';

describe('SemanticChunker', () => {
  const chunker = new SemanticChunker();

  it('should chunk a simple typescript file', () => {
    const tsFile: FileInput = {
      path: 'src/test.ts',
      language: 'typescript',
      fileHash: 'testhash123',
      content: `
function helloWorld() {
    console.log("This is a function to ensure it is long enough to be a chunk.");
}

class MyClass {
    constructor() {
        // A constructor, should not be a chunk
    }

    public myMethod() {
        // A method that is long enough to be a chunk.
        console.log("a method");
        return 1;
    }
}

const myVar = () => {
    console.log("This is an arrow function that is long enough to be a chunk.");
};

export const exportedVar = () => "this is another long line to make it a chunk";
      `,
    };

    const chunks = chunker.chunk(tsFile);
    
    // MyClass, myMethod, helloWorld, myVar, exportedVar
    expect(chunks).toHaveLength(5);

    const func = chunks.find(c => c.name === 'helloWorld');
    expect(func).toBeDefined();
    expect(func?.kind).toBe('function');
    expect(func?.startLine).toBe(1);
    expect(func?.endLine).toBe(3);

    const cls = chunks.find(c => c.name === 'MyClass');
    expect(cls).toBeDefined();
    expect(cls?.kind).toBe('class');
    expect(cls?.startLine).toBe(5);
    expect(cls?.endLine).toBe(15);
    
    const method = chunks.find(c => c.name === 'myMethod');
    expect(method).toBeDefined();
    expect(method?.kind).toBe('method');
    expect(method?.parentName).toBe('MyClass');

    const arrow = chunks.find(c => c.name === 'myVar');
    expect(arrow).toBeDefined();
    expect(arrow?.kind).toBe('const');

    const exported = chunks.find(c => c.name === 'exportedVar');
    expect(exported).toBeDefined();
    expect(exported?.kind).toBe('export');
  });

  it('should return stable chunk IDs', () => {
    const tsFile: FileInput = {
        path: 'src/test.ts',
        language: 'typescript',
        fileHash: 'testhash123',
        content: `
function helloWorld() {
    console.log("This is a function to ensure it is long enough to be a chunk.");
}
        `,
      };

    const chunks1 = chunker.chunk(tsFile);
    const chunks2 = chunker.chunk(tsFile);
    
    expect(chunks1).toHaveLength(1);
    expect(chunks2).toHaveLength(1);
    expect(chunks1[0].chunkId).toBe(chunks2[0].chunkId);

    const tsFileChanged = { ...tsFile, fileHash: 'newhash' };
    const chunks3 = chunker.chunk(tsFileChanged);
    expect(chunks3[0].chunkId).not.toBe(chunks1[0].chunkId);
  });

  it('should not create chunk for small nodes', () => {
    const tsFile: FileInput = {
        path: 'src/test.ts',
        language: 'typescript',
        fileHash: 'testhash123',
        content: `function a(){}`,
      };
    const chunks = chunker.chunk(tsFile);
    expect(chunks).toHaveLength(0);
  });
});
