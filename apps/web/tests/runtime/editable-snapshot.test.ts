// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  buildEditableSnapshotHtml,
  editableSnapshotFileName,
  isRejectedEditableSnapshotHtml,
  isReusableEditableSnapshotHtml,
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
        <meta http-equiv="Content-Security-Policy" content="style-src 'self' 'unsafe-inline'">
        <link rel="stylesheet" href="/_next/static/css/app.css">
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
    expect(html).not.toContain('Content-Security-Policy');
    expect(html).toContain('rel="stylesheet"');
    expect(isReusableEditableSnapshotHtml(html)).toBe(true);
  });

  it('serializes iframe documents with computed styles from the iframe realm', () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const frameDocument = frame.contentDocument;
    expect(frameDocument).not.toBeNull();
    frameDocument!.documentElement.innerHTML = `
      <head><title>Iframe app</title></head>
      <body>
        <main>
          <h1 style="color: rgb(12, 34, 56); padding: 6px;">Iframe content</h1>
        </main>
      </body>
    `;

    const html = buildEditableSnapshotHtml(frameDocument!, surface());

    expect(html).toContain('data-od-editable-snapshot="true"');
    expect(html).toContain('color: rgb(12, 34, 56)');
    expect(html).toContain('padding: 6px');
    expect(isReusableEditableSnapshotHtml(html)).toBe(true);
    frame.remove();
  });

  it('normalizes runtime reveal and intro animation states for static editing', () => {
    document.documentElement.innerHTML = `
      <head>
        <style>
          .reveal { opacity: 0; transform: translateY(20px); }
          .reveal.visible { opacity: 1; transform: none; }
          .animate-fade-up { animation: fadeUp 0.8s ease-out forwards; }
          .delay-100 { animation-delay: 0.1s; opacity: 0; }
        </style>
      </head>
      <body>
        <main>
          <section class="reveal"><h2>Below fold content</h2></section>
          <h1 class="animate-fade-up delay-100">Hero headline</h1>
        </main>
      </body>
    `;

    const html = buildEditableSnapshotHtml(document, surface());

    expect(html).toContain('class="reveal visible"');
    expect(html).toContain('data-od-snapshot-normalize="true"');
    expect(html).toContain('opacity: 1');
    expect(html).toContain('animation: none');
    expect(html).toContain('Below fold content');
    expect(html).toContain('Hero headline');
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

  it('rejects an empty app shell before saving a blank editable page', () => {
    document.documentElement.innerHTML = `
      <head><title>Vite app</title></head>
      <body>
        <div id="root"></div>
        <script type="module" src="/src/main.tsx"></script>
      </body>
    `;

    expect(buildEditableSnapshotHtml(document, surface({
      id: 'src-main-tsx',
      kind: 'react-app',
      framework: 'Vite',
      entryFile: 'src/main.tsx',
      previewPath: '/',
    }))).toBeNull();
  });

  it('rejects an empty iframe app shell before saving a blank editable page', () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const frameDocument = frame.contentDocument;
    expect(frameDocument).not.toBeNull();
    frameDocument!.documentElement.innerHTML = `
      <head><title>Vite app</title></head>
      <body>
        <div id="root"></div>
        <script type="module" src="/src/main.tsx"></script>
      </body>
    `;

    expect(buildEditableSnapshotHtml(frameDocument!, surface({
      id: 'src-main-tsx',
      kind: 'react-app',
      framework: 'Vite',
      entryFile: 'src/main.tsx',
      previewPath: '/',
    }))).toBeNull();
    frame.remove();
  });

  it('rejects marker-only editable snapshots without generated inline styles', () => {
    const rawSnapshot = `
      <!doctype html>
      <html data-od-editable-snapshot="true">
        <body><main><h1>Unstyled stale snapshot</h1></main></body>
      </html>
    `;

    expect(isRejectedEditableSnapshotHtml(rawSnapshot)).toBe(true);
    expect(isReusableEditableSnapshotHtml(rawSnapshot)).toBe(false);
  });

  it('rejects stale editable snapshots that copied runtime content security policy', () => {
    const cspSnapshot = `
      <!doctype html>
      <html data-od-editable-snapshot="true" style="display: block;">
        <head>
          <meta http-equiv="Content-Security-Policy" content="style-src 'self' 'unsafe-inline'">
        </head>
        <body><main><h1>Styled but CSP blocked</h1></main></body>
      </html>
    `;

    expect(isRejectedEditableSnapshotHtml(cspSnapshot)).toBe(true);
    expect(isReusableEditableSnapshotHtml(cspSnapshot)).toBe(false);
  });

  it('rejects stale editable snapshots that only contain an empty app mount', () => {
    const emptyAppSnapshot = `
      <!doctype html>
      <html data-od-editable-snapshot="true" style="display: block;">
        <body style="margin: 0;"><div id="root"></div></body>
      </html>
    `;

    expect(isRejectedEditableSnapshotHtml(emptyAppSnapshot)).toBe(true);
    expect(isReusableEditableSnapshotHtml(emptyAppSnapshot)).toBe(false);
  });
});
