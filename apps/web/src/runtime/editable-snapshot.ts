import type { ProjectUiSurface } from '../types';

const EDITABLE_SNAPSHOT_DIR = 'design-snapshots';

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
  if (isRejectedEditableSnapshotDocument(document, bodyText)) return null;

  const clone = document.documentElement.cloneNode(true) as HTMLElement;
  inlineComputedStyles(document, clone);
  syncResolvedResourceUrls(document, clone);
  syncFormState(document, clone);
  pruneRuntimeOnlyNodes(clone);
  prepareSnapshotHead(document, clone, surface);

  clone.setAttribute('data-od-editable-snapshot', 'true');
  clone.setAttribute('data-od-surface-id', surface.id || surface.entryFile);

  return `<!doctype html>\n${clone.outerHTML}`;
}

export function isRejectedEditableSnapshotHtml(html: string | null): boolean {
  if (!html) return false;
  if (!html.includes('data-od-editable-snapshot="true"')) return false;
  return rejectedSnapshotText(html);
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
    if (!(source instanceof win.HTMLElement) || !(target instanceof HTMLElement)) continue;
    const computed = win.getComputedStyle(source);
    for (let propertyIndex = 0; propertyIndex < computed.length; propertyIndex += 1) {
      const property = computed.item(propertyIndex);
      if (!property) continue;
      target.style.setProperty(
        property,
        computed.getPropertyValue(property),
        computed.getPropertyPriority(property),
      );
    }
  }
}

function syncResolvedResourceUrls(document: Document, clone: HTMLElement): void {
  const sourceElements = Array.from(document.documentElement.querySelectorAll('*'));
  const cloneElements = Array.from(clone.querySelectorAll('*'));
  for (let index = 0; index < sourceElements.length; index += 1) {
    const source = sourceElements[index];
    const target = cloneElements[index];
    if (!source || !target) continue;
    if (!(target instanceof HTMLElement)) continue;
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
}

function createHead(clone: HTMLElement): HTMLHeadElement {
  const head = clone.ownerDocument.createElement('head');
  clone.insertBefore(head, clone.firstChild);
  return head;
}
