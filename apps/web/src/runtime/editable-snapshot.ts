import type { ProjectUiSurface } from '../types';

const EDITABLE_SNAPSHOT_DIR = 'design-snapshots';
const MIN_STYLED_SNAPSHOT_DESCENDANT_RATIO = 0.45;
const MIN_RICH_STYLED_SNAPSHOT_DESCENDANTS = 4;
const SNAPSHOT_STYLE_PROPERTIES = [
  'background',
  'background-color',
  'background-image',
  'background-position',
  'background-repeat',
  'background-size',
  'border',
  'border-color',
  'border-radius',
  'border-style',
  'border-width',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'box-shadow',
  'box-sizing',
  'color',
  'color-scheme',
  'column-gap',
  'display',
  'fill',
  'flex',
  'flex-basis',
  'flex-direction',
  'flex-grow',
  'flex-shrink',
  'flex-wrap',
  'font',
  'font-family',
  'font-size',
  'font-weight',
  'gap',
  'grid-auto-columns',
  'grid-auto-flow',
  'grid-auto-rows',
  'grid-template-columns',
  'grid-template-rows',
  'height',
  'inset',
  'justify-content',
  'align-content',
  'justify-items',
  'align-items',
  'letter-spacing',
  'line-height',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'max-height',
  'max-width',
  'min-height',
  'min-width',
  'object-fit',
  'object-position',
  'opacity',
  'outline',
  'outline-color',
  'outline-offset',
  'outline-style',
  'outline-width',
  'overflow',
  'overflow-x',
  'overflow-y',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'position',
  'right',
  'row-gap',
  'stroke',
  'stroke-width',
  'text-align',
  'text-decoration',
  'text-transform',
  'text-rendering',
  'top',
  'transform',
  'vertical-align',
  'visibility',
  'white-space',
  'width',
  'z-index',
  '-webkit-font-smoothing',
] as const;

export function editableSnapshotFileName(surface: ProjectUiSurface): string {
  const slug = slugifySnapshotName(surface.id)
    || slugifySnapshotName(surface.label)
    || slugifySnapshotName(surface.route ?? '')
    || slugifySnapshotName(surface.entryFile)
    || 'screen';
  return `${EDITABLE_SNAPSHOT_DIR}/${slug}.html`;
}

export function buildEditableSnapshotHtml(
  document: Document,
  surface: ProjectUiSurface,
): string | null {
  if (!document.documentElement || !document.body) return null;
  const bodyText = document.body.textContent?.trim() ?? '';
  if (document.body.children.length === 0 && bodyText.length === 0) return null;
  if (hasOnlyEmptyAppMount(document.body)) return null;
  if (isRejectedEditableSnapshotDocument(document, bodyText)) return null;

  const clone = document.documentElement.cloneNode(true) as HTMLElement;
  inlineComputedStyles(document, clone);
  syncResolvedResourceUrls(document, clone);
  syncFormState(document, clone);
  normalizeFrozenSnapshotState(document, clone);
  pruneRuntimeOnlyNodes(clone);
  prepareSnapshotHead(document, clone, surface);

  clone.setAttribute('data-od-editable-snapshot', 'true');
  clone.setAttribute('data-od-surface-id', surface.id || surface.entryFile);

  return `<!doctype html>\n${clone.outerHTML}`;
}

export function isRejectedEditableSnapshotHtml(html: string | null): boolean {
  if (!html) return false;
  if (!html.includes('data-od-editable-snapshot="true"')) return false;
  return (
    rejectedSnapshotText(html) ||
    !hasGeneratedInlineStyles(html) ||
    hasCopiedContentSecurityPolicy(html) ||
    hasEmptyAppMountSnapshot(html)
  );
}

export function isReusableEditableSnapshotHtml(html: string | null): boolean {
  if (!html) return false;
  if (!html.includes('data-od-editable-snapshot="true"')) return false;
  return !isRejectedEditableSnapshotHtml(html);
}

function slugifySnapshotName(value: string | null): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function isRejectedEditableSnapshotDocument(document: Document, bodyText: string): boolean {
  const contentType = document.contentType;
  if (contentType && !/(?:^|\/)(?:html|xhtml|xml)\b/i.test(contentType)) return true;
  return rejectedSnapshotText(bodyText);
}

function rejectedSnapshotText(text: string): boolean {
  return /(?:preview proxy error|preview runtime not found|parse error:|content-length can't be present with transfer-encoding)/i.test(text);
}

function hasGeneratedInlineStyles(html: string): boolean {
  return hasDocumentShellInlineStyles(html) && hasBodyDescendantInlineStyleCoverage(html);
}

function hasDocumentShellInlineStyles(html: string): boolean {
  return /<html\b[^>]*\sstyle\s*=/i.test(html) || /<body\b[^>]*\sstyle\s*=/i.test(html);
}

function hasBodyDescendantInlineStyleCoverage(html: string): boolean {
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? '';
  const tags = Array.from(body.matchAll(/<([a-z][\w:-]*)\b([^>]*)>/giu))
    .map((match) => ({
      tag: match[1] ?? '',
      attrs: match[2] ?? '',
    }))
    .filter(({ tag }) => !/^(?:script|style|link|meta|base|template|noscript)$/iu.test(tag));
  if (tags.length === 0) return false;
  const styledCount = tags.filter(({ attrs }) => /\sstyle\s*=/iu.test(attrs)).length;
  if (tags.length <= MIN_RICH_STYLED_SNAPSHOT_DESCENDANTS) return styledCount > 0;
  const requiredStyledCount = Math.max(
    MIN_RICH_STYLED_SNAPSHOT_DESCENDANTS,
    Math.ceil(tags.length * MIN_STYLED_SNAPSHOT_DESCENDANT_RATIO),
  );
  return styledCount >= requiredStyledCount;
}

function hasCopiedContentSecurityPolicy(html: string): boolean {
  return /<meta\b[^>]*\bhttp-equiv\s*=\s*["']?\s*content-security-policy(?:-report-only)?\b/i.test(html);
}

function hasEmptyAppMountSnapshot(html: string): boolean {
  return /<body\b[^>]*>\s*(?:<!--[\s\S]*?-->\s*)*<div\b(?=[^>]*(?:\bid\s*=\s*["']?(?:root|app|__next|app-root|root-app)\b|\bdata-v-app\b))[^>]*>\s*<\/div>\s*(?:<!--[\s\S]*?-->\s*)*<\/body>/i.test(html);
}

function hasOnlyEmptyAppMount(body: HTMLElement): boolean {
  const win = body.ownerDocument.defaultView;
  if (!win) return false;
  const children = Array.from(body.children).filter((child) => !isRuntimeOnlyElement(child));
  if (children.length !== 1) return false;
  const mount = children[0];
  if (!(mount instanceof win.HTMLElement)) return false;
  if (mount.textContent?.trim()) return false;
  if (mount.children.length > 0) return false;
  return isAppMountElement(mount);
}

function isRuntimeOnlyElement(element: Element): boolean {
  return /^(?:SCRIPT|STYLE|LINK|META|BASE|TEMPLATE|NOSCRIPT)$/u.test(element.tagName);
}

function isAppMountElement(element: HTMLElement): boolean {
  const id = element.getAttribute('id')?.toLowerCase() ?? '';
  if (['root', 'app', '__next', 'app-root', 'root-app'].includes(id)) return true;
  return element.hasAttribute('data-v-app');
}

function inlineComputedStyles(document: Document, clone: HTMLElement): void {
  const win = document.defaultView;
  if (!win) return;
  const sourceElements = [
    document.documentElement,
    ...Array.from(document.documentElement.querySelectorAll('*')),
  ];
  const cloneElements = [
    clone,
    ...Array.from(clone.querySelectorAll('*')),
  ];
  for (let index = 0; index < sourceElements.length; index += 1) {
    const source = sourceElements[index];
    const target = cloneElements[index];
    if (!source || !target) continue;
    copySelectedComputedStyles(win, source, target);
  }
}

function copySelectedComputedStyles(
  win: Window & typeof globalThis,
  source: Element,
  target: Element,
): void {
  if (!(source instanceof win.Element) || !(target instanceof win.Element)) return;
  const styleTarget = target as Element & { style?: CSSStyleDeclaration };
  if (!styleTarget.style) return;
  const computed = win.getComputedStyle(source);
  for (const property of SNAPSHOT_STYLE_PROPERTIES) {
    const value = computed.getPropertyValue(property);
    if (!value) continue;
    styleTarget.style.setProperty(property, value, computed.getPropertyPriority(property));
  }
}

function syncResolvedResourceUrls(document: Document, clone: HTMLElement): void {
  const sourceElements = Array.from(document.documentElement.querySelectorAll('*'));
  const cloneElements = Array.from(clone.querySelectorAll('*'));
  const win = document.defaultView;
  if (!win) return;
  for (let index = 0; index < sourceElements.length; index += 1) {
    const source = sourceElements[index];
    const target = cloneElements[index];
    if (!source || !target) continue;
    if (!(target instanceof win.HTMLElement)) continue;
    syncResolvedUrl(source, target, 'src');
    syncResolvedUrl(source, target, 'href');
    syncResolvedUrl(source, target, 'poster');
    syncResolvedSrcset(source, target);
  }
}

function syncResolvedUrl(source: Element, target: HTMLElement, attr: 'src' | 'href' | 'poster'): void {
  if (!source.hasAttribute(attr)) return;
  const value = (source as Element & Record<typeof attr, unknown>)[attr];
  if (typeof value !== 'string' || value.length === 0) return;
  target.setAttribute(attr, value);
}

function syncResolvedSrcset(source: Element, target: HTMLElement): void {
  if (!source.hasAttribute('srcset')) return;
  const currentSrc = (source as HTMLImageElement).currentSrc;
  if (typeof currentSrc === 'string' && currentSrc.length > 0) {
    target.setAttribute('src', currentSrc);
    target.removeAttribute('srcset');
  }
}

function normalizeFrozenSnapshotState(document: Document, clone: HTMLElement): void {
  const win = document.defaultView;
  if (!win) return;
  const sourceElements = [
    document.documentElement,
    ...Array.from(document.documentElement.querySelectorAll('*')),
  ];
  const cloneElements = [
    clone,
    ...Array.from(clone.querySelectorAll('*')),
  ];
  for (let index = 0; index < sourceElements.length; index += 1) {
    const source = sourceElements[index];
    const target = cloneElements[index];
    if (!(source instanceof win.HTMLElement) || !(target instanceof win.HTMLElement)) continue;
    if (source.classList.contains('reveal')) {
      target.classList.add('visible');
      target.style.setProperty('opacity', '1');
      target.style.setProperty('transform', 'none');
      target.style.setProperty('visibility', 'visible');
    }
    if (source.classList.contains('reveal-arrow')) {
      target.classList.add('visible');
    }
    if (hasSnapshotIntroAnimation(source)) {
      target.style.setProperty('opacity', '1');
      target.style.setProperty('animation', 'none');
      target.style.setProperty('transform', 'none');
      target.style.setProperty('visibility', 'visible');
    }
  }
}

function hasSnapshotIntroAnimation(element: Element): boolean {
  return ['animate-fade-up', 'animate-fade-in', 'animate-slide-left'].some((className) =>
    element.classList.contains(className),
  );
}

function syncFormState(document: Document, clone: HTMLElement): void {
  const win = document.defaultView;
  if (!win) return;
  const sourceElements = Array.from(document.documentElement.querySelectorAll('input, textarea, option'));
  const cloneElements = Array.from(clone.querySelectorAll('input, textarea, option'));
  for (let index = 0; index < sourceElements.length; index += 1) {
    const source = sourceElements[index];
    const target = cloneElements[index];
    if (source instanceof win.HTMLInputElement && target instanceof win.HTMLInputElement) {
      target.setAttribute('value', source.value);
      if (source.checked) target.setAttribute('checked', '');
      else target.removeAttribute('checked');
    } else if (source instanceof win.HTMLTextAreaElement && target instanceof win.HTMLTextAreaElement) {
      target.textContent = source.value;
    } else if (source instanceof win.HTMLOptionElement && target instanceof win.HTMLOptionElement) {
      if (source.selected) target.setAttribute('selected', '');
      else target.removeAttribute('selected');
    }
  }
}

function pruneRuntimeOnlyNodes(clone: HTMLElement): void {
  clone.querySelectorAll('script, base, link[rel="modulepreload"], link[rel="preload"][as="script"]').forEach((node) => {
    node.remove();
  });
  clone.querySelectorAll('meta[http-equiv]').forEach((node) => {
    const httpEquiv = node.getAttribute('http-equiv')?.toLowerCase() ?? '';
    if (httpEquiv === 'content-security-policy' || httpEquiv === 'content-security-policy-report-only') {
      node.remove();
    }
  });
}

function prepareSnapshotHead(
  document: Document,
  clone: HTMLElement,
  surface: ProjectUiSurface,
): void {
  const head = clone.querySelector('head') ?? createHead(clone);
  if (!head.querySelector('meta[charset]')) {
    const meta = clone.ownerDocument.createElement('meta');
    meta.setAttribute('charset', 'utf-8');
    head.prepend(meta);
  }
  if (!head.querySelector('meta[name="viewport"]')) {
    const meta = clone.ownerDocument.createElement('meta');
    meta.setAttribute('name', 'viewport');
    meta.setAttribute('content', 'width=device-width, initial-scale=1');
    head.append(meta);
  }
  const title = head.querySelector('title') ?? clone.ownerDocument.createElement('title');
  title.textContent = `${surface.label || document.title || 'Screen'} editable snapshot`;
  if (!title.parentElement) head.append(title);
  if (!head.querySelector('style[data-od-snapshot-normalize]')) {
    const style = clone.ownerDocument.createElement('style');
    style.setAttribute('data-od-snapshot-normalize', 'true');
    style.textContent = `
      [data-od-editable-snapshot] .reveal {
        opacity: 1 !important;
        transform: none !important;
        visibility: visible !important;
      }
      [data-od-editable-snapshot] .reveal-arrow.visible {
        opacity: 0.15 !important;
      }
      [data-od-editable-snapshot] .animate-fade-up,
      [data-od-editable-snapshot] .animate-fade-in,
      [data-od-editable-snapshot] .animate-slide-left {
        opacity: 1 !important;
        animation: none !important;
        transform: none !important;
        visibility: visible !important;
      }
    `;
    head.append(style);
  }
}

function createHead(clone: HTMLElement): HTMLHeadElement {
  const head = clone.ownerDocument.createElement('head');
  clone.insertBefore(head, clone.firstChild);
  return head;
}
