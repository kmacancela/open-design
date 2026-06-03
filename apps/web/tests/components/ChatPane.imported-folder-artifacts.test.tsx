// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { forwardRef, useImperativeHandle, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatPane } from '../../src/components/ChatPane';
import type { Conversation, ProjectFile, ProjectMetadata } from '../../src/types';

const composerMocks = vi.hoisted(() => ({
  focus: vi.fn(),
  restoreDraft: vi.fn(),
  setDraft: vi.fn(),
}));

vi.mock('../../src/i18n', () => ({
  useI18n: () => ({ locale: 'en', setLocale: () => undefined, t: (key: string) => key }),
  useT: () => (key: string) => key,
}));

vi.mock('../../src/components/ChatComposer', () => ({
  ChatComposer: forwardRef((_props, ref) => {
    useImperativeHandle(ref, () => ({
      focus: composerMocks.focus,
      restoreDraft: composerMocks.restoreDraft,
      setDraft: composerMocks.setDraft,
    }));
    return <output data-testid="composer" />;
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const conversations: Conversation[] = [
  { id: 'conv-1', projectId: 'project-1', title: 'Conversation 1', createdAt: 1, updatedAt: 1 },
];

function renderPane(extra: Partial<React.ComponentProps<typeof ChatPane>>) {
  return render(
    <ChatPane
      projectKindForTracking="prototype"
      messages={[]}
      streaming={false}
      error={null}
      projectId="project-1"
      projectFiles={[]}
      onEnsureProject={async () => 'project-1'}
      onSend={vi.fn()}
      onStop={vi.fn()}
      conversations={conversations}
      activeConversationId="conv-1"
      onSelectConversation={vi.fn()}
      onDeleteConversation={vi.fn()}
      projectMetadata={{ kind: 'prototype' }}
      {...extra}
    />,
  );
}

function file(name: string, kind: ProjectFile['kind'], mtime: number): ProjectFile {
  return {
    name,
    size: 128,
    mtime,
    kind,
    mime: kind === 'html' ? 'text/html' : kind === 'image' ? 'image/jpeg' : 'text/plain',
  };
}

describe('ChatPane imported folder surfaces', () => {
  it('does not flash imported asset cards while UI surfaces are loading', async () => {
    const metadata: ProjectMetadata = {
      kind: 'prototype',
      importedFrom: 'folder',
      entryFile: 'site/index.html',
    };
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));

    renderPane({
      projectMetadata: metadata,
      projectFiles: [
        file('site/index.html', 'html', 20),
        file('assets/hero-mockup.jpg', 'image', 10),
      ],
      onRequestOpenFile: vi.fn(),
    });

    expect(await screen.findByTestId('chat-ui-surfaces-loading')).toBeTruthy();
    expect(screen.queryByTestId('chat-design-artifacts')).toBeNull();
    expect(screen.queryByText('assets/hero-mockup.jpg')).toBeNull();
  });

  it('replaces empty starter prompts with discovered UI surfaces', async () => {
    const onRequestOpenFile = vi.fn();
    const metadata: ProjectMetadata = {
      kind: 'prototype',
      importedFrom: 'folder',
      entryFile: 'site/index.html',
    };
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (typeof url === 'string' && url.includes('/ui-surfaces')) {
        return json({
          surfaces: [
            {
              id: 'home',
              label: 'Home screen',
              route: '/',
              kind: 'static-html',
              confidence: 'high',
              framework: null,
              entryFile: 'site/index.html',
              previewFile: 'site/index.html',
              previewRuntimeRoot: null,
              previewPath: '/',
              previewStatus: 'live-preview',
              sourceFiles: ['site/index.html'],
              styleFiles: ['site/styles.css'],
              scriptFiles: ['site/app.js'],
              assetFiles: ['assets/hero-mockup.jpg'],
              fontFiles: ['fonts/Inter.woff2'],
              externalDependencies: [
                { packageName: 'lucide-react', importPath: 'lucide-react', kind: 'icons' },
              ],
              reasons: ['HTML screen file detected'],
              mtime: 20,
            },
          ],
          generatedAt: '2026-06-02T00:00:00.000Z',
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    renderPane({
      projectMetadata: metadata,
      projectFiles: [
        file('README.md', 'text', 30),
        file('site/index.html', 'html', 20),
        file('site/styles.css', 'code', 19),
        file('site/app.js', 'code', 18),
        file('assets/hero-mockup.jpg', 'image', 10),
        file('fonts/Inter.woff2', 'binary', 9),
        file('bundle.js.map', 'code', 40),
      ],
      onRequestOpenFile,
    });

    expect(screen.queryByText('chat.startTitle')).toBeNull();
    expect(screen.queryByText('chat.example1Title')).toBeNull();

    const surfaces = await screen.findByTestId('chat-ui-surfaces');
    expect(screen.queryByTestId('chat-design-artifacts')).toBeNull();
    expect(within(surfaces).getByText('Home screen')).toBeTruthy();
    expect(within(surfaces).getByText('/')).toBeTruthy();
    expect(within(surfaces).getByText('5 frontend files')).toBeTruthy();
    expect(within(surfaces).getByText('1 packages')).toBeTruthy();
    expect(within(surfaces).getByText('lucide-react')).toBeTruthy();

    const firstCard = screen.getByTestId('chat-ui-surface-0');
    expect(firstCard.querySelector('iframe')?.getAttribute('src')).toBe(
      '/api/projects/project-1/raw/site/index.html?v=20',
    );

    fireEvent.click(screen.getByTestId('chat-ui-surface-edit-0'));
    await waitFor(() => {
      expect(composerMocks.restoreDraft).toHaveBeenCalledTimes(1);
    });
    expect(composerMocks.restoreDraft).toHaveBeenCalledWith({
      text: expect.stringContaining('Edit this screen: Home screen.'),
      attachments: expect.arrayContaining([
        expect.objectContaining({ path: 'site/index.html' }),
        expect.objectContaining({ path: 'site/styles.css' }),
        expect.objectContaining({ path: 'site/app.js' }),
        expect.objectContaining({ path: 'assets/hero-mockup.jpg', kind: 'image' }),
        expect.objectContaining({ path: 'fonts/Inter.woff2' }),
      ]),
    });

    fireEvent.click(within(firstCard).getByRole('button', { name: 'Open' }));
    expect(onRequestOpenFile).toHaveBeenCalledTimes(1);
    expect(onRequestOpenFile).toHaveBeenCalledWith('site/index.html');
  });

  it('starts a managed runtime preview for source-mapped screens', async () => {
    const metadata: ProjectMetadata = {
      kind: 'prototype',
      importedFrom: 'folder',
      entryFile: 'app/page.tsx',
    };
    const fetchMock = vi.fn(async (url, init) => {
      if (typeof url === 'string' && url.includes('/ui-surfaces')) {
        return json({
          surfaces: [
            {
              id: 'messages',
              label: 'Messages screen',
              route: '/messages/:conversationId',
              kind: 'next-route',
              confidence: 'high',
              framework: 'Next.js',
              entryFile: 'app/messages/[conversationId]/page.tsx',
              previewFile: null,
              previewRuntimeRoot: '',
              previewPath: '/messages/preview',
              previewStatus: 'source-mapped',
              sourceFiles: ['app/messages/[conversationId]/page.tsx', 'app/layout.tsx'],
              styleFiles: ['app/globals.css'],
              scriptFiles: [],
              assetFiles: [],
              fontFiles: [],
              externalDependencies: [
                { packageName: 'next', importPath: 'next', kind: 'runtime' },
              ],
              reasons: ['Next.js route file detected'],
              mtime: 20,
            },
          ],
          generatedAt: '2026-06-02T00:00:00.000Z',
        });
      }
      if (typeof url === 'string' && url.includes('/ui-preview')) {
        expect(init).toEqual(expect.objectContaining({ method: 'POST' }));
        return json({
          status: 'ready',
          runtimeRoot: '',
          baseUrl: 'http://127.0.0.1:43210',
          url: 'http://127.0.0.1:43210/messages/preview',
          route: '/messages/preview',
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPane({
      projectMetadata: metadata,
      projectFiles: [
        file('app/messages/[conversationId]/page.tsx', 'code', 20),
        file('app/layout.tsx', 'code', 19),
        file('app/globals.css', 'code', 18),
      ],
      onRequestOpenFile: vi.fn(),
    });

    const surface = await screen.findByTestId('chat-ui-surface-0');
    await waitFor(() => {
      expect(surface.querySelector('iframe')?.getAttribute('src')).toBe(
        'http://127.0.0.1:43210/messages/preview',
      );
    });
    expect(within(surface).getByText('Live preview')).toBeTruthy();
    expect(screen.queryByText('No live preview')).toBeNull();
  });

  it('does not leave a runtime preview stuck when project files refresh mid-start', async () => {
    const metadata: ProjectMetadata = {
      kind: 'prototype',
      importedFrom: 'folder',
      entryFile: 'app/page.tsx',
    };
    let resolvePreview!: (response: Response) => void;
    const previewPromise = new Promise<Response>((resolve) => {
      resolvePreview = resolve;
    });
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (typeof url === 'string' && url.includes('/ui-surfaces')) {
        return json({
          surfaces: [
            {
              id: 'home',
              label: 'Home screen',
              route: '/',
              kind: 'next-route',
              confidence: 'high',
              framework: 'Next.js',
              entryFile: 'app/page.tsx',
              previewFile: null,
              previewRuntimeRoot: '',
              previewPath: '/',
              previewStatus: 'source-mapped',
              sourceFiles: ['app/page.tsx'],
              styleFiles: ['app/globals.css'],
              scriptFiles: [],
              assetFiles: [],
              fontFiles: [],
              externalDependencies: [
                { packageName: 'next', importPath: 'next', kind: 'runtime' },
              ],
              reasons: ['Next.js route file detected'],
              mtime: 20,
            },
          ],
          generatedAt: '2026-06-02T00:00:00.000Z',
        });
      }
      if (typeof url === 'string' && url.includes('/ui-preview')) {
        return await previewPromise;
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    function Harness() {
      const [files, setFiles] = useState([
        file('app/page.tsx', 'code', 20),
        file('app/globals.css', 'code', 18),
      ]);
      return (
        <>
          <button
            type="button"
            data-testid="refresh-files"
            onClick={() => setFiles((current) => [...current, file('README.md', 'text', 21)])}
          >
            refresh
          </button>
          <ChatPane
            projectKindForTracking="prototype"
            messages={[]}
            streaming={false}
            error={null}
            projectId="project-1"
            projectFiles={files}
            onEnsureProject={async () => 'project-1'}
            onSend={vi.fn()}
            onStop={vi.fn()}
            conversations={conversations}
            activeConversationId="conv-1"
            onSelectConversation={vi.fn()}
            onDeleteConversation={vi.fn()}
            projectMetadata={metadata}
          />
        </>
      );
    }

    render(<Harness />);
    const surface = await screen.findByTestId('chat-ui-surface-0');
    expect(surface.getAttribute('data-preview-status')).toBe('starting');

    fireEvent.click(screen.getByTestId('refresh-files'));
    resolvePreview(json({
      status: 'ready',
      runtimeRoot: '',
      baseUrl: 'http://127.0.0.1:43210',
      url: 'http://127.0.0.1:43210/',
      route: '/',
    }));

    await waitFor(() => {
      expect(surface.querySelector('iframe')?.getAttribute('src')).toBe('http://127.0.0.1:43210/');
    });
    expect(within(surface).getByText('Live preview')).toBeTruthy();
  });

  it('does not fall back to scattered asset cards when no UI surfaces are found', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (typeof url === 'string' && url.includes('/ui-surfaces')) {
        return json({ surfaces: [], generatedAt: '2026-06-02T00:00:00.000Z' });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    const metadata: ProjectMetadata = {
      kind: 'prototype',
      importedFrom: 'folder',
      entryFile: 'site/index.html',
    };

    renderPane({
      projectMetadata: metadata,
      projectFiles: [
        file('site/index.html', 'html', 10),
        file('site/about.html', 'html', 80),
        file('assets/latest-screenshot.jpg', 'image', 70),
        file('site/styleguide.html', 'html', 60),
        file('assets/hero-mockup.jpg', 'image', 50),
        file('docs/pitch.pdf', 'pdf', 40),
        file('docs/report.docx', 'document', 30),
        file('README.md', 'text', 90),
        file('bundle.js.map', 'code', 100),
      ],
      onRequestOpenFile: vi.fn(),
    });

    const empty = await screen.findByTestId('chat-ui-surfaces-empty');
    expect(within(empty).getByText('No UI screens found')).toBeTruthy();
    expect(screen.queryByTestId('chat-design-artifacts')).toBeNull();
    expect(screen.queryByText('assets/latest-screenshot.jpg')).toBeNull();
  });
});

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
