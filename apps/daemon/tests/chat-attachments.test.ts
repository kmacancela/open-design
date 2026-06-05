import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  renderEditableSnapshotTargetHint,
  renderProjectFilesListBlock,
  resolveSafeProjectAttachments,
} from '../src/server.js';

describe('resolveSafeProjectAttachments', () => {
  it('keeps Windows attachments when root and attachment path use different separators and drive casing', () => {
    const existing = new Set([
      'C:\\Users\\Designer\\Open Design\\m5-logo.png',
      'c:\\users\\designer\\open design\\assets\\mark.png',
    ]);

    const safe = resolveSafeProjectAttachments(
      'C:/Users/Designer/Open Design/',
      [
        'm5-logo.png',
        'c:/users/designer/open design/assets/mark.png',
        'C:/Users/Designer/Open Design Adjacent/secret.png',
        '..\\secret.png',
      ],
      {
        existsSync: (target: string) => existing.has(target),
        pathImpl: path.win32,
      },
    );

    expect(safe).toEqual([
      'm5-logo.png',
      'c:/users/designer/open design/assets/mark.png',
    ]);
  });
});

describe('renderProjectFilesListBlock', () => {
  it('lists every file for small projects', () => {
    const block = renderProjectFilesListBlock([
      { name: 'index.html' },
      { name: 'assets/logo.svg' },
    ]);

    expect(block).toContain('- index.html');
    expect(block).toContain('- assets/logo.svg');
    expect(block).not.toContain('compact sample');
  });

  it('summarizes huge imported project file lists and keeps attached files visible', () => {
    const activeSnapshot = 'design-snapshots/search-apps-web-src-app-main-search-page-tsx.html';
    const files = [
      { name: 'apps/web/src/app/main/search/page.tsx' },
      { name: activeSnapshot },
      ...Array.from({ length: 9_500 }, (_, index) => ({
        name: `apps/web/src/generated/component-${index}.tsx`,
      })),
    ];

    const block = renderProjectFilesListBlock(files, {
      priorityNames: [activeSnapshot],
      maxEntries: 80,
      maxChars: 12_000,
    });

    expect(block.length).toBeLessThan(14_000);
    expect(block).toContain('Project has 9502 files');
    expect(block).toContain(`\`${activeSnapshot}\``);
    expect(block).toContain(`- ${activeSnapshot}`);
    expect(block).toContain('more files omitted');
    expect(block).not.toContain('component-9499.tsx');
  });

  it('does not duplicate priority files in the representative sample', () => {
    const block = renderProjectFilesListBlock(
      [
        { name: 'design-snapshots/home.html' },
        { name: 'index.html' },
        ...Array.from({ length: 20 }, (_, index) => ({
          name: `src/file-${index}.tsx`,
        })),
      ],
      {
        priorityNames: ['design-snapshots/home.html'],
        maxEntries: 5,
        maxChars: 1_000,
      },
    );

    expect(block.match(/design-snapshots\/home\.html/g)).toHaveLength(2);
  });
});

describe('renderEditableSnapshotTargetHint', () => {
  it('directs design edits to the attached rendered snapshot html', () => {
    const hint = renderEditableSnapshotTargetHint([
      'design-snapshots/scheduling-book-apps-web-src-app-main-scheduling-book-page-tsx.html',
      'apps/web/src/app/main/scheduling/book/page.tsx',
      'apps/web/src/app/globals.css',
    ]);

    expect(hint).toContain(
      'Primary editable design snapshot: `design-snapshots/scheduling-book-apps-web-src-app-main-scheduling-book-page-tsx.html`.',
    );
    expect(hint).toContain('edit this HTML file directly');
    expect(hint).toContain('currently rendered in Preview');
    expect(hint).toContain('do not apply the requested design change to TSX, JSX, Vue, Svelte, CSS, or other original app source');
    expect(hint).toContain('User-facing updates must describe the design/rendered preview change only');
    expect(hint).toContain('Do not mention inline styles, computed styles, generated HTML, srcDoc, snapshot internals');
  });

  it('stays silent when no editable snapshot is attached', () => {
    expect(renderEditableSnapshotTargetHint([
      'apps/web/src/app/main/scheduling/book/page.tsx',
      'apps/web/src/app/globals.css',
    ])).toBe('');
  });
});
