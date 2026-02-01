import { describe, it, expect } from 'vitest';
import { getLanguageForFile, parseFileToTree, SupportedLanguage } from './tree-sitter';

describe('tree-sitter', () => {
    describe('getLanguageForFile', () => {
        it('should return the correct language for a given file extension', () => {
            expect(getLanguageForFile('test.ts')).toBe('typescript');
            expect(getLanguageForFile('test.tsx')).toBe('typescript');
            expect(getLanguageForFile('test.js')).toBe('javascript');
            expect(getLanguageForFile('test.jsx')).toBe('javascript');
            expect(getLanguageForFile('test.py')).toBe('python');
            expect(getLanguageForFile('test.go')).toBe('go');
            expect(getLanguageForFile('test.rs')).toBe('rust');
        });

        it('should return null for unsupported file extensions', () => {
            expect(getLanguageForFile('test.java')).toBeNull();
            expect(getLanguageForFile('test.cpp')).toBeNull();
        });
    });

    describe('parseFileToTree', () => {
        it('should parse a valid typescript file', async () => {
            const content = `
                import React from 'react';

                const MyComponent = () => {
                    return <div>Hello, world!</div>;
                };

                export default MyComponent;
            `;
            const result = await parseFileToTree(content, 'test.tsx');
            expect(result).not.toBeNull();
            expect(result?.language).toBe('typescript');
            expect(result?.errorsCount).toBe(0);
            expect(result?.rootNode).not.toBeNull();
        });

        it('should parse a valid javascript file', async () => {
            const content = `
                const x = 1;
                function y() { return 2; }
            `;
            const result = await parseFileToTree(content, 'test.js');
            expect(result).not.toBeNull();
            expect(result?.language).toBe('javascript');
            expect(result?.errorsCount).toBe(0);
        });

        it('should parse a valid python file', async () => {
            const content = `
                def my_func():
                    return 1
            `;
            const result = await parseFileToTree(content, 'test.py');
            expect(result).not.toBeNull();
            expect(result?.language).toBe('python');
            expect(result?.errorsCount).toBe(0);
        });

        it('should parse a valid go file', async () => {
            const content = `
                package main
                import "fmt"
                func main() {
                    fmt.Println("hello world")
                }
            `;
            const result = await parseFileToTree(content, 'test.go');
            expect(result).not.toBeNull();
            expect(result?.language).toBe('go');
            expect(result?.errorsCount).toBe(0);
        });

        it('should parse a valid rust file', async () => {
            const content = `
                fn main() {
                    println!("Hello, world!");
                }
            `;
            const result = await parseFileToTree(content, 'test.rs');
            expect(result).not.toBeNull();
            expect(result?.language).toBe('rust');
            expect(result?.errorsCount).toBe(0);
        });

        it('should return error count for invalid syntax', async () => {
            const content = `
                const x = 1;
                function y() { 
            `;
            const result = await parseFileToTree(content, 'test.js');
            expect(result).not.toBeNull();
            expect(result?.language).toBe('javascript');
            expect(result?.errorsCount).toBeGreaterThan(0);
        });

        it('should return null for unsupported file types', async () => {
            const content = `public class HelloWorld {}`;
            const result = await parseFileToTree(content, 'test.java');
            expect(result).toBeNull();
        });

        it('should handle timeout for large files', async () => {
            const content = 'const a = "'.repeat(500000) + '";';
            const result = await parseFileToTree(content, 'test.js');
            expect(result).not.toBeNull();
            if (result) {
                expect(result.errorsCount).toBe(-1);
                expect(result.rootNode).toBeNull();
            }
        }, 1000);
    });
});