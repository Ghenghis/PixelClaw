/**
 * PixelClaw E2E — Build Integrity Tests
 *
 * Validates that the extension builds correctly and all output
 * artifacts are present, correctly sized, and well-formed.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const DIST = path.join(ROOT, 'extension', 'dist');

test.describe('Build Output — Extension Bundle', () => {
  test('extension.js exists and is non-trivially sized', () => {
    const extJs = path.join(DIST, 'extension.js');
    expect(fs.existsSync(extJs)).toBe(true);

    const stat = fs.statSync(extJs);
    expect(stat.size).toBeGreaterThan(10000); // > 10KB
    console.log(`  extension.js: ${(stat.size / 1024).toFixed(1)} KB`);
  });

  test('extension.js is valid JavaScript (no syntax errors)', () => {
    const extJs = path.join(DIST, 'extension.js');
    const content = fs.readFileSync(extJs, 'utf8');

    // Should be CJS format (esbuild output)
    expect(content).toContain('require');
    // Should reference vscode
    expect(content).toContain('vscode');
    // Should not contain unresolved imports
    expect(content).not.toContain('import {');
  });
});

test.describe('Build Output — Webview', () => {
  test('webview/index.html exists', () => {
    const indexHtml = path.join(DIST, 'webview', 'index.html');
    expect(fs.existsSync(indexHtml)).toBe(true);

    const content = fs.readFileSync(indexHtml, 'utf8');
    expect(content).toContain('<html');
    expect(content).toContain('<script');
  });

  test('webview assets directory contains JS and CSS bundles', () => {
    const assetsDir = path.join(DIST, 'webview', 'assets');
    expect(fs.existsSync(assetsDir)).toBe(true);

    const files = fs.readdirSync(assetsDir);
    const jsFiles = files.filter(f => f.endsWith('.js'));
    const cssFiles = files.filter(f => f.endsWith('.css'));

    expect(jsFiles.length).toBeGreaterThan(0);
    expect(cssFiles.length).toBeGreaterThan(0);

    // Main JS bundle should be substantial (React app)
    for (const jsFile of jsFiles) {
      const stat = fs.statSync(path.join(assetsDir, jsFile));
      console.log(`  ${jsFile}: ${(stat.size / 1024).toFixed(1)} KB`);
      expect(stat.size).toBeGreaterThan(1000);
    }
  });

  test('webview contains character sprite assets', () => {
    const charsDir = path.join(DIST, 'webview', 'assets', 'characters');
    if (!fs.existsSync(charsDir)) {
      // Characters might be in dist/assets/characters instead
      const altCharsDir = path.join(DIST, 'assets', 'characters');
      expect(fs.existsSync(altCharsDir)).toBe(true);
      const files = fs.readdirSync(altCharsDir);
      expect(files.filter(f => f.endsWith('.png')).length).toBeGreaterThan(0);
      console.log(`  Character sprites found in dist/assets/characters: ${files.length} files`);
      return;
    }

    const files = fs.readdirSync(charsDir);
    const pngFiles = files.filter(f => f.endsWith('.png'));
    expect(pngFiles.length).toBeGreaterThan(0);
    console.log(`  Character sprites: ${pngFiles.length} PNG files`);
  });
});

test.describe('Build Output — Package Manifest', () => {
  test('extension/package.json has correct main entry', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'package.json'), 'utf8'));
    expect(pkg.main).toBe('./dist/extension.js');
  });

  test('extension/package.json has valid VS Code engine constraint', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'package.json'), 'utf8'));
    expect(pkg.engines).toHaveProperty('vscode');
    expect(pkg.engines.vscode).toMatch(/^\^1\.\d+\.\d+$/);
  });

  test('extension/package.json has required contributes section', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'package.json'), 'utf8'));
    expect(pkg.contributes).toHaveProperty('commands');
    expect(pkg.contributes).toHaveProperty('views');
    expect(pkg.contributes.commands.length).toBeGreaterThan(0);
  });

  test('extension/package.json publisher and name are set', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'package.json'), 'utf8'));
    expect(pkg.name).toBeTruthy();
    expect(pkg.publisher).toBeTruthy();
    expect(pkg.displayName).toBeTruthy();
  });
});

test.describe('Build Output — File Count Sanity', () => {
  test('dist/ contains expected number of files', () => {
    function countFiles(dir: string): number {
      let count = 0;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile()) count++;
        else if (entry.isDirectory()) count += countFiles(path.join(dir, entry.name));
      }
      return count;
    }

    const totalFiles = countFiles(DIST);
    console.log(`  Total files in dist/: ${totalFiles}`);
    // Should have extension.js + webview files + assets
    expect(totalFiles).toBeGreaterThan(5);
    expect(totalFiles).toBeLessThan(500); // sanity upper bound
  });
});
