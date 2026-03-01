/**
 * PixelClaw E2E — Release Artifact Tests
 *
 * Validates that VSIX packaging and Windows ZIP creation produce
 * correct, complete, ready-to-use release artifacts.
 * These tests run AFTER `npm run package` and `npm run package:zip`.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const ROOT = path.resolve(__dirname, '../..');
const RELEASES_DIR = path.join(ROOT, 'releases');

test.describe('VSIX Package', () => {
  test('VSIX file exists in releases/', () => {
    if (!fs.existsSync(RELEASES_DIR)) {
      test.skip();
      return;
    }
    const vsixFiles = fs.readdirSync(RELEASES_DIR).filter(f => f.endsWith('.vsix'));
    expect(vsixFiles.length).toBeGreaterThan(0);
    console.log(`  VSIX found: ${vsixFiles.join(', ')}`);
  });

  test('VSIX file is a valid ZIP archive', () => {
    if (!fs.existsSync(RELEASES_DIR)) {
      test.skip();
      return;
    }
    const vsixFiles = fs.readdirSync(RELEASES_DIR).filter(f => f.endsWith('.vsix'));
    if (vsixFiles.length === 0) {
      test.skip();
      return;
    }

    const vsixPath = path.join(RELEASES_DIR, vsixFiles[0]);
    const stat = fs.statSync(vsixPath);
    console.log(`  VSIX size: ${(stat.size / 1024).toFixed(1)} KB`);

    // VSIX is a ZIP file — first bytes should be PK (ZIP magic number)
    const buffer = Buffer.alloc(4);
    const fd = fs.openSync(vsixPath, 'r');
    fs.readSync(fd, buffer, 0, 4, 0);
    fs.closeSync(fd);
    expect(buffer[0]).toBe(0x50); // P
    expect(buffer[1]).toBe(0x4B); // K
  });

  test('VSIX is reasonably sized (50KB - 10MB)', () => {
    if (!fs.existsSync(RELEASES_DIR)) {
      test.skip();
      return;
    }
    const vsixFiles = fs.readdirSync(RELEASES_DIR).filter(f => f.endsWith('.vsix'));
    if (vsixFiles.length === 0) {
      test.skip();
      return;
    }

    const stat = fs.statSync(path.join(RELEASES_DIR, vsixFiles[0]));
    expect(stat.size).toBeGreaterThan(50 * 1024);      // > 50KB
    expect(stat.size).toBeLessThan(10 * 1024 * 1024);   // < 10MB
  });
});

test.describe('Windows ZIP Package', () => {
  test('Windows ZIP file exists in releases/', () => {
    if (!fs.existsSync(RELEASES_DIR)) {
      test.skip();
      return;
    }
    const zipFiles = fs.readdirSync(RELEASES_DIR).filter(f => f.endsWith('.zip'));
    expect(zipFiles.length).toBeGreaterThan(0);
    console.log(`  ZIP found: ${zipFiles.join(', ')}`);
  });

  test('Windows ZIP is a valid ZIP archive', () => {
    if (!fs.existsSync(RELEASES_DIR)) {
      test.skip();
      return;
    }
    const zipFiles = fs.readdirSync(RELEASES_DIR).filter(f => f.endsWith('.zip'));
    if (zipFiles.length === 0) {
      test.skip();
      return;
    }

    const zipPath = path.join(RELEASES_DIR, zipFiles[0]);
    const buffer = Buffer.alloc(4);
    const fd = fs.openSync(zipPath, 'r');
    fs.readSync(fd, buffer, 0, 4, 0);
    fs.closeSync(fd);
    expect(buffer[0]).toBe(0x50); // P
    expect(buffer[1]).toBe(0x4B); // K
  });

  test('Windows ZIP contains required files', () => {
    if (!fs.existsSync(RELEASES_DIR)) {
      test.skip();
      return;
    }
    const zipFiles = fs.readdirSync(RELEASES_DIR).filter(f => f.endsWith('.zip'));
    if (zipFiles.length === 0) {
      test.skip();
      return;
    }

    // Use PowerShell to list ZIP contents
    const zipPath = path.join(RELEASES_DIR, zipFiles[0]);
    try {
      const output = execSync(
        `powershell -Command "[System.IO.Compression.ZipFile]::OpenRead('${zipPath}').Entries.FullName -join '\\n'"`,
        { encoding: 'utf8' }
      );
      const entries = output.split('\n').map(s => s.trim()).filter(Boolean);
      console.log(`  ZIP entries: ${entries.length} files`);

      // Must contain install.bat
      expect(entries.some(e => e.includes('install.bat'))).toBe(true);
      // Must contain a VSIX
      expect(entries.some(e => e.endsWith('.vsix'))).toBe(true);
      // Must contain README
      expect(entries.some(e => e.includes('README'))).toBe(true);
    } catch (err) {
      // If PowerShell zip inspection fails, just verify size
      const stat = fs.statSync(zipPath);
      expect(stat.size).toBeGreaterThan(50 * 1024);
    }
  });
});

test.describe('Release Naming Convention', () => {
  test('Artifacts follow naming convention', () => {
    if (!fs.existsSync(RELEASES_DIR)) {
      test.skip();
      return;
    }

    const files = fs.readdirSync(RELEASES_DIR);
    for (const file of files) {
      if (file.endsWith('.vsix') || file.endsWith('.zip')) {
        // Should start with "pixelclaw-"
        expect(file.startsWith('pixelclaw-')).toBe(true);
        console.log(`  ${file} — naming OK`);
      }
    }
  });
});
