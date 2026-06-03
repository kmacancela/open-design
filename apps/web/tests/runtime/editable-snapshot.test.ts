// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  buildEditableSnapshotHtml,
  editableSnapshotFileName,
  isRejectedEditableSnapshotHtml,
} from '../../src/runtime/editable-snapshot';
import type { ProjectUiSurface } from '../../src/types';

function surface(overrides: Partial<ProjectUiSurface> = {}): ProjectUiSurface {
  return {
    id: 'messages',
    label: 'Messages screen',
    route: '/messages/preview',
    kind: 'next-route',
    confidence: 'high',
    framework: 'Next.js',
    entryFile: 'app/messages/page.tsx',
    previewFile: null,
    previewRuntimeRoot: '',
    previewPath: '/messages/preview',
    previewStatus: 'source-mapped',
    sourceFiles: [],
    styleFiles: [],
    scriptFiles: [],
    assetFiles: [],
    fontFiles: [],
    externalDependencies: [],
    reasons: [],
    mtime: 1,
    ...overrides,
  };
}

describe('editable snapshots', () => {
  it('uses a stable generated HTML file name for a discovered surface', () => {
    expect(editableSnapshotFileName(surface())).toBe('design-snapshots/messages.html');
  });

  it('serializes the rendered page as script-free editable HTML', () => {
    document.documentElement.innerHTML = `
      <head>
        <base href="/api/projects/project-1/ui-preview/proxy/token/">
        <title>Runtime app</title>
        <script>window.__runtime = true;</script>
      </head>
      <body>
        <main>
          <h1 style="color: rgb(210, 75, 42); padding: 4px;">Hello</h1>
          <input id="name" value="Initial">
        </main>
      </body>
    `;
    const input = document.getElementById('name') as HTMLInputElement;
    input.value = 'Karina';

    const html = buildEditableSnapshotHtml(document, surface());

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('data-od-editable-snapshot="true"');
    expect(html).toContain('Messages screen editable snapshot');
    expect(html).toContain('color: rgb(210, 75, 42)');
    expect(html).toContain('value="Karina"');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<base');
  });

  it('rejects a proxy error document instead of saving a blank editable page', () => {
    document.documentElement.innerHTML = `
      <head><title>Bad Gateway</title></head>
      <body><pre>Parse Error: Content-Length can't be present with Transfer-Encoding</pre></body>
    `;

    expect(buildEditableSnapshotHtml(document, surface())).toBeNull();
    expect(isRejectedEditableSnapshotHtml(`
      <!doctype html>
      <html data-od-editable-snapshot="true">
        <body><pre>Parse Error: Content-Length can't be present with Transfer-Encoding</pre></body>
      </html>
    `)).toBe(true);
  });
});
