/**
 * The version the application states and the version it publishes are one
 * number.
 *
 * The page shows it in the footer and the health endpoint returns it, both from
 * a single declaration. That declaration still has to agree with the package
 * manifest, and nothing but this checks that it does — a version printed on
 * screen that disagrees with the one released is worse than none at all.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { AUTHOR, VERSION } from '../packages/contracts/src/index';

describe('the version this release states', () => {
  it('is the version the package publishes', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(VERSION).toBe(manifest.version);
  });

  it('names who made it', () => {
    expect(AUTHOR).toBe('Riccardo Sapuppo');
  });
});
