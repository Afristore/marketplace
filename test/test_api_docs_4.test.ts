// Tests for API documentation module 4 — Afristore/marketplace
const fs = require('fs');
const path = require('path');

describe('Docs Module 4', () => {
    const docsDir = path.join(__dirname, '..', 'docs');
    const docFile = path.join(docsDir, 'api-reference-4.md');

    test('documentation file exists', () => {
        expect(fs.existsSync(docFile)).toBe(true);
    });

    test('documentation has substantial content', () => {
        const content = fs.readFileSync(docFile, 'utf-8');
        expect(content.length).toBeGreaterThan(500);
    });

    test('documentation contains overview', () => {
        const content = fs.readFileSync(docFile, 'utf-8');
        expect(content).toContain('## Overview');
    });

    test('documentation contains configuration', () => {
        const content = fs.readFileSync(docFile, 'utf-8');
        expect(content).toContain('Configuration');
    });

    test('documentation contains error codes', () => {
        const content = fs.readFileSync(docFile, 'utf-8');
        expect(content).toMatch(/error/i);
    });

    test('documentation contains testing section', () => {
        const content = fs.readFileSync(docFile, 'utf-8');
        expect(content).toMatch(/test/i);
    });

    test('documentation contains deployment', () => {
        const content = fs.readFileSync(docFile, 'utf-8');
        expect(content).toMatch(/deploy/i);
    });

    test('documentation is markdown', () => {
        expect(docFile.endsWith('.md')).toBe(true);
    });

    test('health endpoint is documented', () => {
        const content = fs.readFileSync(docFile, 'utf-8');
        expect(content).toMatch(/health/i);
    });

    test('metrics endpoint is documented', () => {
        const content = fs.readFileSync(docFile, 'utf-8');
        expect(content).toMatch(/metrics/i);
    });
});
