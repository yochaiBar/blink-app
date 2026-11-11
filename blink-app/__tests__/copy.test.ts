/**
 * User-facing copy rules, checked over the app's source string literals.
 */

import './setup';

import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..');
const SOURCE_DIRS = ['app', 'components', 'constants', 'hooks', 'services', 'utils', 'stores'];

function sourceFiles(): string[] {
  const out: string[] = [path.join(ROOT, 'app.config.ts')];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  for (const dir of SOURCE_DIRS) walk(path.join(ROOT, dir));
  return out;
}

/** String and template literals, and JSX text, in `text` (good enough for copy checks). */
function literals(text: string): string[] {
  const quoted = text.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? [];
  const jsxText = text.match(/>[^<>{}=;]*[A-Za-z][^<>{}=;]*</g) ?? [];
  return [...quoted, ...jsxText];
}

describe('copy', () => {
  it('calls the app "Blinks", never "Blink"', () => {
    const offenders = sourceFiles().flatMap((file) =>
      literals(fs.readFileSync(file, 'utf-8'))
        .filter((lit) => /\bBlink\b(?![A-Za-z])/.test(lit))
        .map((lit) => `${path.relative(ROOT, file)}: ${lit}`),
    );
    expect(offenders).toEqual([]);
  });

  it('counts streaks in challenges, never days', () => {
    const offenders = sourceFiles().flatMap((file) =>
      fs
        .readFileSync(file, 'utf-8')
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\/?\*)/.test(line))
        .filter((line) => /streak/i.test(line) && /(\s|-)days?\b/.test(line))
        .map((line) => `${path.relative(ROOT, file)}: ${line.trim()}`),
    );
    expect(offenders).toEqual([]);
  });
});
