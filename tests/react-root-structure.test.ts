import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import test from 'node:test';

const projectRoot = process.cwd();
const sourceRoot = join(projectRoot, 'src');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return ['.ts', '.tsx'].includes(extname(entry.name)) ? [path] : [];
  });
}

test('the application has one declarative React root and no legacy mount observers', () => {
  const files = sourceFiles(sourceRoot);
  const createRootSites: string[] = [];
  const observerSites: string[] = [];

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    if (/\bcreateRoot\s*\(/.test(content))
      createRootSites.push(relative(projectRoot, file).replace(/\\/g, '/'));
    if (/\bMutationObserver\b/.test(content))
      observerSites.push(relative(projectRoot, file).replace(/\\/g, '/'));
  }

  assert.deepEqual(createRootSites, ['src/main.tsx']);
  assert.deepEqual(observerSites, ['src/components/AccessibilityLayer.tsx']);

  const index = readFileSync(join(projectRoot, 'index.html'), 'utf8');
  const moduleScripts = [
    ...index.matchAll(/<script\s+type="module"\s+src="([^"]+)"/g),
  ].map((match) => match[1]);
  assert.deepEqual(moduleScripts, ['/src/main.tsx']);
});
