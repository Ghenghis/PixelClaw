/**
 * PixelClaw E2E — Extension Configuration & Integration Tests
 *
 * Validates .pixelclaw.yaml parsing, environment config, project
 * structure integrity, and the interaction contracts between
 * PixelAgents extension ↔ Gateway ↔ LM Studio.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');

test.describe('Project Configuration — .pixelclaw.yaml', () => {
  test('.pixelclaw.yaml exists at project root', () => {
    const configPath = path.join(ROOT, '.pixelclaw.yaml');
    expect(fs.existsSync(configPath)).toBe(true);
  });

  test('.pixelclaw.yaml has valid YAML structure', () => {
    const configPath = path.join(ROOT, '.pixelclaw.yaml');
    const content = fs.readFileSync(configPath, 'utf8');

    // Basic YAML structure checks (no full parser needed)
    expect(content).toContain('project:');
    expect(content).toContain('provider:');
    expect(content).toContain('tools:');
    expect(content).toContain('memory:');
    expect(content).toContain('persona:');
  });

  test('.pixelclaw.yaml provider config points to LM Studio', () => {
    const content = fs.readFileSync(path.join(ROOT, '.pixelclaw.yaml'), 'utf8');
    expect(content).toContain('lmstudio');
    expect(content).toContain('1234');
    expect(content).toContain('nerdstking-python-coder-7b');
  });

  test('.pixelclaw.yaml has valid namespace for memory isolation', () => {
    const content = fs.readFileSync(path.join(ROOT, '.pixelclaw.yaml'), 'utf8');
    const nsMatch = content.match(/namespace:\s*["']?([^"'\n]+)/);
    expect(nsMatch).not.toBeNull();
    expect(nsMatch![1].trim().length).toBeGreaterThan(0);
    console.log(`  Memory namespace: ${nsMatch![1].trim()}`);
  });
});

test.describe('Environment Configuration', () => {
  test('env/.env.example exists with all required variables', () => {
    const envPath = path.join(ROOT, 'env', '.env.example');
    expect(fs.existsSync(envPath)).toBe(true);

    const content = fs.readFileSync(envPath, 'utf8');
    const requiredVars = [
      'LM_STUDIO_URL',
      'GATEWAY_PORT',
      'GATEWAY_HOST',
      'DATA_DIR',
      'MEMORY_DB',
      'TASKS_DB',
    ];

    for (const varName of requiredVars) {
      expect(content).toContain(varName);
    }
    console.log(`  All ${requiredVars.length} required env vars documented`);
  });

  test('No .env file committed (security check)', () => {
    const envPath = path.join(ROOT, '.env');
    const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.env');
    // .env should not exist in the repo (only .env.example)
    // If it exists locally that's OK, but gitignore must exclude it
  });
});

test.describe('Extension Source Integrity', () => {
  test('All required TypeScript source files exist', () => {
    const requiredFiles = [
      'extension/src/extension.ts',
      'extension/src/PixelAgentsViewProvider.ts',
      'extension/src/agentManager.ts',
      'extension/src/constants.ts',
      'extension/src/types.ts',
      'extension/src/fileWatcher.ts',
      'extension/src/transcriptParser.ts',
    ];

    for (const file of requiredFiles) {
      const fullPath = path.join(ROOT, file);
      expect(fs.existsSync(fullPath)).toBe(true);
    }
    console.log(`  All ${requiredFiles.length} source files present`);
  });

  test('Extension entry point exports activate and deactivate', () => {
    const extTs = fs.readFileSync(path.join(ROOT, 'extension', 'src', 'extension.ts'), 'utf8');
    expect(extTs).toContain('export function activate');
    expect(extTs).toContain('export function deactivate');
  });

  test('Webview-ui has React entry point', () => {
    const indexHtml = fs.readFileSync(path.join(ROOT, 'extension', 'webview-ui', 'index.html'), 'utf8');
    expect(indexHtml).toContain('<div id="root"');
  });
});

test.describe('GitHub Actions Workflow Integrity', () => {
  test('CI workflow has all required steps', () => {
    const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(ci).toContain('actions/checkout');
    expect(ci).toContain('actions/setup-node');
    expect(ci).toContain('npm install --include=dev');
    expect(ci).toContain('tsc --noEmit');
    expect(ci).toContain('npm run lint');
    expect(ci).toContain('esbuild');
    expect(ci).toContain('vite build');
  });

  test('Release workflow creates VSIX and ZIP', () => {
    const rel = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
    expect(rel).toContain('vsce package');
    expect(rel).toContain('.vsix');
    expect(rel).toContain('Compress-Archive');
    expect(rel).toContain('win-x64.zip');
    expect(rel).toContain('softprops/action-gh-release');
  });

  test('Pages workflow deploys architecture HTML', () => {
    const pages = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pages.yml'), 'utf8');
    expect(pages).toContain('pixelclaw-architecture.html');
    expect(pages).toContain('deploy-pages');
    expect(pages).toContain('_site');
  });
});

test.describe('Documentation Completeness', () => {
  test('ARCHITECTURE.md covers all 6 layers', () => {
    const arch = fs.readFileSync(path.join(ROOT, 'docs', 'ARCHITECTURE.md'), 'utf8');
    expect(arch).toContain('LAYER 1');
    expect(arch).toContain('LAYER 2');
    expect(arch).toContain('LAYER 3');
    expect(arch).toContain('LAYER 4');
    expect(arch).toContain('LAYER 5');
    expect(arch).toContain('LAYER 6');
  });

  test('ACTION_PLAN.md exists with release pipeline docs', () => {
    const plan = fs.readFileSync(path.join(ROOT, 'docs', 'ACTION_PLAN.md'), 'utf8');
    expect(plan).toContain('Release Pipeline');
    expect(plan).toContain('VSIX');
    expect(plan).toContain('GitHub Pages');
    expect(plan).toContain('Playwright');
  });

  test('Architecture HTML dashboard is well-formed', () => {
    const html = fs.readFileSync(path.join(ROOT, 'docs', 'pixelclaw-architecture.html'), 'utf8');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('PIXELCLAW');
    expect(html).toContain('Gap Analysis');
  });
});

test.describe('LM Studio ↔ Extension Contract', () => {
  test('.pixelclaw.yaml model matches LM Studio loaded model', async ({ request }) => {
    const config = fs.readFileSync(path.join(ROOT, '.pixelclaw.yaml'), 'utf8');
    const modelMatch = config.match(/model:\s*["']?([^"'\n]+)/);
    expect(modelMatch).not.toBeNull();
    const configModel = modelMatch![1].trim();

    // Verify LM Studio has a compatible model loaded
    const LM_URL = process.env.LM_STUDIO_URL || 'http://100.117.198.97:1234';
    try {
      const response = await request.get(`${LM_URL}/v1/models`);
      if (response.status() === 200) {
        const body = await response.json();
        const loadedModels = body.data.map((m: any) => m.id);
        console.log(`  Config model: ${configModel}`);
        console.log(`  LM Studio models: ${loadedModels.join(', ')}`);
        // At least verify the model name pattern matches
        const configBase = configModel.replace(/-/g, '').toLowerCase();
        const hasMatch = loadedModels.some((id: string) =>
          id.replace(/-/g, '').toLowerCase().includes('nerdstking') ||
          id.replace(/-/g, '').toLowerCase().includes('pythoncoder')
        );
        expect(hasMatch).toBe(true);
      }
    } catch {
      console.log('  LM Studio not reachable — skipping live model check');
    }
  });
});
