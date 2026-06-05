// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  buildEditableSnapshotHtml,
  editableSnapshotFileName,
  isEditableSnapshotRevisionFileName,
  isRejectedEditableSnapshotHtml,
  isReusableEditableSnapshotHtml,
  latestEditableSnapshotFileName,
  nextEditableSnapshotFileName,
  repairEditableSnapshotResourceUrls,
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

  it('allocates revision file names without overwriting saved editable snapshots', () => {
    expect(nextEditableSnapshotFileName('design-snapshots/messages.html', [])).toBe(
      'design-snapshots/messages.html',
    );
    expect(nextEditableSnapshotFileName('design-snapshots/messages.html', [
      'design-snapshots/messages.html',
      'design-snapshots/messages-2.html',
    ])).toBe('design-snapshots/messages-3.html');
    expect(latestEditableSnapshotFileName('design-snapshots/messages.html', [
      'design-snapshots/messages.html',
      'design-snapshots/messages-2.html',
      'design-snapshots/other.html',
    ])).toBe('design-snapshots/messages-2.html');
    expect(isEditableSnapshotRevisionFileName(
      'design-snapshots/messages.html',
      'design-snapshots/messages-2.html',
    )).toBe(true);
    expect(isEditableSnapshotRevisionFileName(
      'design-snapshots/messages.html',
      'design-snapshots/messages-extra.html',
    )).toBe(false);
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

  it('inlines per-element styles so mockup snapshots do not fall back to browser defaults', () => {
    document.documentElement.innerHTML = `
      <head>
        <style>
          .calendar-card {
            display: grid;
            grid-template-columns: repeat(7, minmax(0, 1fr));
            gap: 8px;
            width: 420px;
            padding: 24px;
            border-radius: 18px;
            background: rgb(239, 68, 68);
            color: rgb(255, 255, 255);
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
          }
          .calendar-card a {
            color: rgb(255, 255, 255);
            text-decoration: none;
            font-weight: 700;
          }
          .calendar-card button {
            border: 0;
            border-radius: 10px;
            background: rgba(255, 255, 255, 0.24);
            color: rgb(255, 255, 255);
            padding: 6px 10px;
          }
        </style>
      </head>
      <body>
        <section class="calendar-card">
          <a href="/calendar">June 2026</a>
          <button type="button">3</button>
        </section>
      </body>
    `;

    const html = buildEditableSnapshotHtml(document, surface());

    expect(html).toContain('class="calendar-card"');
    expect(html).toContain('display: grid');
    expect(html).toContain('background: rgb(239, 68, 68)');
    expect(html).toContain('border-radius: 18px');
    expect(html).toContain('color: rgb(255, 255, 255)');
    expect(html).toMatch(/<a\b[^>]*style="[^"]*color: rgb\(255, 255, 255\)/);
    expect(html).toMatch(/<button\b[^>]*style="[^"]*background: rgba\(255, 255, 255, 0\.24\)/);
    expect(isReusableEditableSnapshotHtml(html)).toBe(true);
  });

  it('rebases local media URLs to stable project raw URLs for saved mockups', () => {
    document.documentElement.innerHTML = `
      <head>
        <base href="/api/projects/project-1/ui-preview/proxy/token/">
      </head>
      <body>
        <main
          style="
            min-height: 100vh;
            background-image: url('/assets/hero image.jpg');
            background-size: cover;
            color: rgb(255, 255, 255);
          "
        >
          <img src="/assets/logo mark.png" alt="Logo">
          <video poster="/media/poster.jpg" autoplay>
            <source src="/media/intro video.mp4" type="video/mp4">
          </video>
        </main>
      </body>
    `;

    const html = buildEditableSnapshotHtml(document, surface({
      previewRuntimeRoot: 'apps/web',
    }), {
      projectId: 'project-1',
      projectFileNames: [
        'apps/web/public/assets/hero image.jpg',
        'apps/web/public/assets/logo mark.png',
        'apps/web/public/media/poster.jpg',
        'apps/web/public/media/intro video.mp4',
      ],
    });

    expect(html).toContain('/api/projects/project-1/raw/apps/web/public/assets/hero%20image.jpg');
    expect(html).toContain('src="/api/projects/project-1/raw/apps/web/public/assets/logo%20mark.png"');
    expect(html).toContain('poster="/api/projects/project-1/raw/apps/web/public/media/poster.jpg"');
    expect(html).toContain('src="/api/projects/project-1/raw/apps/web/public/media/intro%20video.mp4"');
    expect(html).toMatch(/<video\b[^>]*muted=""/iu);
    expect(html).toMatch(/<video\b[^>]*playsinline=""/iu);
    expect(html).not.toContain('autoplay');
    expect(isReusableEditableSnapshotHtml(html)).toBe(true);
  });

  it('leaves external and unmatched media URLs untouched while rebasing known local srcsets', () => {
    document.documentElement.innerHTML = `
      <head>
        <base href="/api/projects/project-1/ui-preview/proxy/token/">
      </head>
      <body>
        <main style="display: grid; color: rgb(255, 255, 255);">
          <img src="https://cdn.example.com/logo.png" alt="External">
          <img src="/missing.png" alt="Missing">
          <img
            src="/assets/fallback.png"
            srcset="/assets/card-small.png 1x, /assets/card-large.png 2x"
            alt="Cards"
          >
        </main>
      </body>
    `;

    const html = buildEditableSnapshotHtml(document, surface({
      previewRuntimeRoot: 'apps/web',
    }), {
      projectId: 'project-1',
      projectFileNames: [
        'apps/web/public/assets/fallback.png',
        'apps/web/public/assets/card-small.png',
        'apps/web/public/assets/card-large.png',
      ],
    });

    expect(html).toContain('https://cdn.example.com/logo.png');
    expect(html).toContain('/missing.png');
    expect(html).not.toContain('/api/projects/project-1/raw/missing.png');
    expect(html).toContain('/api/projects/project-1/raw/apps/web/public/assets/fallback.png');
    expect(html).toContain('/api/projects/project-1/raw/apps/web/public/assets/card-small.png 1x');
    expect(html).toContain('/api/projects/project-1/raw/apps/web/public/assets/card-large.png 2x');
  });

  it('preserves local font-face rules with stable project raw URLs', () => {
    document.documentElement.innerHTML = `
      <head>
        <base href="/api/projects/project-1/ui-preview/proxy/token/">
        <style>
          @font-face {
            font-family: "Kary";
            src: url("/assets/fonts/kary.woff2") format("woff2");
            font-weight: 400;
          }
        </style>
      </head>
      <body>
        <main style="display: block; color: rgb(255, 255, 255); font-family: Kary, serif;">
          Where fashion is made.
        </main>
      </body>
    `;

    const html = buildEditableSnapshotHtml(document, surface({
      previewRuntimeRoot: 'apps/web',
    }), {
      projectId: 'project-1',
      projectFileNames: [
        'apps/web/public/assets/fonts/kary.woff2',
      ],
    });

    expect(html).toContain('data-od-snapshot-fonts="true"');
    expect(html).toContain('@font-face');
    expect(html).toContain('/api/projects/project-1/raw/apps/web/public/assets/fonts/kary.woff2');
    expect(isReusableEditableSnapshotHtml(html)).toBe(true);
  });

  it('rebases local dev-server filesystem media URLs by project file suffix', () => {
    document.documentElement.innerHTML = `
      <head>
        <base href="http://127.0.0.1:5173/">
      </head>
      <body>
        <main style="display: block; color: rgb(255, 255, 255);">
          <img
            src="http://127.0.0.1:5173/@fs/Users/karina/site/src/assets/hero.jpg"
            alt="Hero"
          >
        </main>
      </body>
    `;

    const html = buildEditableSnapshotHtml(document, surface(), {
      projectId: 'project-1',
      projectFileNames: [
        'src/assets/hero.jpg',
      ],
    });

    expect(html).toContain('src="/api/projects/project-1/raw/src/assets/hero.jpg"');
    expect(html).not.toContain('@fs/Users/karina/site/src/assets/hero.jpg');
    expect(isReusableEditableSnapshotHtml(html)).toBe(true);
  });

  it('repairs saved snapshot media URLs without replacing edited content', () => {
    const editedSnapshot = `<!doctype html>
      <html data-od-editable-snapshot="true" style="display: block;">
        <head>
          <title>Edited mockup</title>
          <style>
            .hero { background-image: url("/assets/hero.jpg"); }
          </style>
        </head>
        <body style="display: block;">
          <main style="display: block; color: rgb(255, 255, 255);">
            <h1 style="display: block;">Edited headline that must stay</h1>
            <img src="/assets/logo.png" alt="Logo" style="display: block;">
            <video src="/assets/loop.mp4" autoplay style="display: block;"></video>
            <audio src="/assets/theme.mp3" autoplay style="display: block;"></audio>
          </main>
        </body>
      </html>`;

    const repaired = repairEditableSnapshotResourceUrls(editedSnapshot, surface({
      previewRuntimeRoot: 'apps/web',
    }), {
      baseUrl: 'http://127.0.0.1:50545/projects/project-1/conversations/c/files/design-snapshots/home.html',
      projectId: 'project-1',
      projectFileNames: [
        'apps/web/public/assets/hero.jpg',
        'apps/web/public/assets/logo.png',
        'apps/web/public/assets/loop.mp4',
        'apps/web/public/assets/theme.mp3',
      ],
    });

    expect(repaired).toContain('Edited headline that must stay');
    expect(repaired).toContain('/api/projects/project-1/raw/apps/web/public/assets/hero.jpg');
    expect(repaired).toContain('src="/api/projects/project-1/raw/apps/web/public/assets/logo.png"');
    expect(repaired).toContain('src="/api/projects/project-1/raw/apps/web/public/assets/loop.mp4"');
    expect(repaired).toContain('src="/api/projects/project-1/raw/apps/web/public/assets/theme.mp3"');
    expect(repaired).toMatch(/<video\b[^>]*muted=""/iu);
    expect(repaired).toMatch(/<video\b[^>]*playsinline=""/iu);
    expect(repaired).toMatch(/<audio\b[^>]*muted=""/iu);
    expect(repaired).not.toContain('autoplay');
    expect(isReusableEditableSnapshotHtml(repaired)).toBe(true);
  });

  it('normalizes snapshot shell widths without changing fixed inner components', () => {
    document.documentElement.setAttribute(
      'style',
      'display: block; width: 1280px; max-width: 1280px; min-width: 1280px;',
    );
    document.documentElement.innerHTML = `
      <head><title>Runtime app</title></head>
      <body style="display: block; width: 1280px; max-width: 1280px; min-width: 1280px;">
        <div id="root" style="display: block; width: 1280px; max-width: 1280px; min-width: 1280px;">
          <main class="root-main" style="display: block; width: 1280px; max-width: 1280px; min-width: 1280px;">
            <section class="card" style="display: block; width: 420px;">Client form</section>
          </main>
        </div>
        <div class="relative isolate min-h-screen overflow-x-clip" style="display: block; position: relative; width: 1280px; max-width: 1280px; min-width: 1280px;">
          <div class="pointer-events-none absolute inset-x-0 top-0" style="display: block; position: absolute; width: 1280px; max-width: 1280px;"></div>
          <header style="display: block; width: 1280px; max-width: 1280px;">Header</header>
          <main class="page-main" style="display: block; width: 1280px; max-width: 1280px;">
            <div class="mx-auto max-w-7xl" style="display: block; width: 1216px; max-width: 1280px;">Content rail</div>
            <section class="fixed-panel" style="display: block; width: 480px;">Fixed panel</section>
          </main>
          <footer style="display: block; width: 1280px; max-width: 1280px;">Footer</footer>
        </div>
      </body>
    `;

    const html = buildEditableSnapshotHtml(document, surface());
    expect(html).not.toBeNull();
    const generatedDocument = new DOMParser().parseFromString(html!, 'text/html');
    const generatedRoot = generatedDocument.querySelector('#root') as HTMLElement;
    const generatedRootMain = generatedDocument.querySelector('.root-main') as HTMLElement;
    const generatedCard = generatedDocument.querySelector('.card') as HTMLElement;
    const generatedShell = generatedDocument.querySelector('.min-h-screen') as HTMLElement;
    const generatedBackground = generatedDocument.querySelector('.inset-x-0') as HTMLElement;
    const generatedHeader = generatedDocument.querySelector('header') as HTMLElement;
    const generatedPageMain = generatedDocument.querySelector('.page-main') as HTMLElement;
    const generatedFooter = generatedDocument.querySelector('footer') as HTMLElement;
    const generatedContentRail = generatedDocument.querySelector('.max-w-7xl') as HTMLElement;
    const generatedFixedPanel = generatedDocument.querySelector('.fixed-panel') as HTMLElement;

    expect(generatedDocument.documentElement.style.width).toBe('100%');
    expect(generatedDocument.documentElement.style.maxWidth).toBe('none');
    expect(generatedDocument.documentElement.style.minWidth).toBe('0px');
    expect(generatedDocument.body.style.width).toBe('100%');
    expect(generatedDocument.body.style.maxWidth).toBe('none');
    expect(generatedDocument.body.style.minWidth).toBe('0px');
    expect(generatedRoot.style.width).toBe('100%');
    expect(generatedRoot.style.maxWidth).toBe('none');
    expect(generatedRoot.style.minWidth).toBe('0px');
    expect(generatedRootMain.style.width).toBe('100%');
    expect(generatedRootMain.style.maxWidth).toBe('none');
    expect(generatedRootMain.style.minWidth).toBe('0px');
    expect(generatedCard.style.width).toBe('420px');
    expect(generatedShell.style.width).toBe('100%');
    expect(generatedShell.style.maxWidth).toBe('none');
    expect(generatedShell.style.minWidth).toBe('0px');
    expect(generatedBackground.style.width).toBe('100%');
    expect(generatedBackground.style.maxWidth).toBe('none');
    expect(generatedHeader.style.width).toBe('100%');
    expect(generatedHeader.style.maxWidth).toBe('none');
    expect(generatedPageMain.style.width).toBe('100%');
    expect(generatedPageMain.style.maxWidth).toBe('none');
    expect(generatedFooter.style.width).toBe('100%');
    expect(generatedFooter.style.maxWidth).toBe('none');
    expect(generatedContentRail.style.width).toBe('1216px');
    expect(generatedContentRail.style.maxWidth).toBe('1280px');
    expect(generatedFixedPanel.style.width).toBe('480px');

    const repaired = repairEditableSnapshotResourceUrls(`
      <!doctype html>
      <html data-od-editable-snapshot="true" style="display: block; width: 1280px; max-width: 1280px; min-width: 1280px;">
        <body style="display: block; width: 1280px; max-width: 1280px; min-width: 1280px;">
          <div id="root" style="display: block; width: 1280px; max-width: 1280px; min-width: 1280px;">
            <main class="root-main" style="display: block; width: 1280px; max-width: 1280px; min-width: 1280px;">
              <section class="card" style="display: block; width: 420px;">Edited form copy</section>
            </main>
          </div>
          <div class="relative isolate min-h-screen overflow-x-clip" style="display: block; position: relative; width: 1280px; max-width: 1280px; min-width: 1280px;">
            <div class="pointer-events-none absolute inset-x-0 top-0" style="display: block; position: absolute; width: 1280px; max-width: 1280px;"></div>
            <header style="display: block; width: 1280px; max-width: 1280px;">Edited header</header>
            <main class="page-main" style="display: block; width: 1280px; max-width: 1280px;">
              <div class="mx-auto max-w-7xl" style="display: block; width: 1216px; max-width: 1280px;">Edited rail</div>
              <section class="fixed-panel" style="display: block; width: 480px;">Edited fixed panel</section>
            </main>
            <footer style="display: block; width: 1280px; max-width: 1280px;">Edited footer</footer>
          </div>
        </body>
      </html>
    `, surface());
    expect(repaired).toContain('Edited form copy');
    expect(repaired).toContain('Edited fixed panel');
    const repairedDocument = new DOMParser().parseFromString(repaired!, 'text/html');
    const repairedRoot = repairedDocument.querySelector('#root') as HTMLElement;
    const repairedRootMain = repairedDocument.querySelector('.root-main') as HTMLElement;
    const repairedCard = repairedDocument.querySelector('.card') as HTMLElement;
    const repairedShell = repairedDocument.querySelector('.min-h-screen') as HTMLElement;
    const repairedPageMain = repairedDocument.querySelector('.page-main') as HTMLElement;
    const repairedContentRail = repairedDocument.querySelector('.max-w-7xl') as HTMLElement;
    const repairedFixedPanel = repairedDocument.querySelector('.fixed-panel') as HTMLElement;

    expect(repairedDocument.documentElement.style.width).toBe('100%');
    expect(repairedDocument.documentElement.style.maxWidth).toBe('none');
    expect(repairedDocument.documentElement.style.minWidth).toBe('0px');
    expect(repairedDocument.body.style.width).toBe('100%');
    expect(repairedDocument.body.style.maxWidth).toBe('none');
    expect(repairedDocument.body.style.minWidth).toBe('0px');
    expect(repairedRoot.style.width).toBe('100%');
    expect(repairedRoot.style.maxWidth).toBe('none');
    expect(repairedRoot.style.minWidth).toBe('0px');
    expect(repairedRootMain.style.width).toBe('100%');
    expect(repairedRootMain.style.maxWidth).toBe('none');
    expect(repairedRootMain.style.minWidth).toBe('0px');
    expect(repairedCard.style.width).toBe('420px');
    expect(repairedShell.style.width).toBe('100%');
    expect(repairedShell.style.maxWidth).toBe('none');
    expect(repairedShell.style.minWidth).toBe('0px');
    expect(repairedPageMain.style.width).toBe('100%');
    expect(repairedPageMain.style.maxWidth).toBe('none');
    expect(repairedContentRail.style.width).toBe('1216px');
    expect(repairedContentRail.style.maxWidth).toBe('1280px');
    expect(repairedFixedPanel.style.width).toBe('480px');
    expect(isReusableEditableSnapshotHtml(repaired)).toBe(true);
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

  it('rejects old body-only snapshots that would reopen as botched mockups', () => {
    const bodyOnlySnapshot = `
      <!doctype html>
      <html data-od-editable-snapshot="true" style="display: block;">
        <body style="margin: 0; background: rgb(20, 10, 8);"><main><h1>Unstyled content</h1></main></body>
      </html>
    `;

    expect(isRejectedEditableSnapshotHtml(bodyOnlySnapshot)).toBe(true);
    expect(isReusableEditableSnapshotHtml(bodyOnlySnapshot)).toBe(false);
  });

  it('rejects partial snapshots where most body descendants lack inline styles', () => {
    const partialSnapshot = `
      <!doctype html>
      <html data-od-editable-snapshot="true" style="display: block;">
        <body style="margin: 0; background: rgb(20, 10, 8); color: rgb(255, 255, 255);">
          <header>
            <a href="/">FH</a>
            <a href="/resources">Resources</a>
            <button style="background: rgb(96, 96, 96);">Menu</button>
          </header>
          <main>
            <h1>Book with Manufacturer</h1>
            <p>Select a date, time, and provide details</p>
            <section>
              <button>1</button>
              <button>2</button>
              <button>3</button>
              <button>4</button>
              <button>5</button>
            </section>
          </main>
        </body>
      </html>
    `;

    expect(isRejectedEditableSnapshotHtml(partialSnapshot)).toBe(true);
    expect(isReusableEditableSnapshotHtml(partialSnapshot)).toBe(false);
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
