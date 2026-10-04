/**
 * A small XML reader for TOM's .tdf files.
 *
 * TOM writes plain, well-formed XML: one declaration, elements, attributes and
 * text, with no namespaces, CDATA or DTDs. The browser has DOMParser but a
 * Worker does not, and `shared/` runs in both, so the tree is read here. It
 * refuses what it does not understand rather than guessing, so a file that
 * reads is one the writer can put back.
 */

export interface XmlElement {
  name: string;
  /** In document order, which the writer keeps. */
  attrs: [string, string][];
  children: XmlElement[];
  /** The element's own text, trimmed; TOM never mixes text with child elements. */
  text: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** `&amp;` and friends, and numeric references, back to the characters they stand for. */
export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref.startsWith('#x') || ref.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(ref.slice(2), 16));
    }
    if (ref.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(ref.slice(1), 10));
    }
    return ENTITIES[ref.toLowerCase()] ?? whole;
  });
}

/** Text or an attribute value made safe to write between tags or inside double quotes. */
export function encodeEntities(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&apos;')
    .replace(/"/g, '&quot;');
}

const ATTR_RE = /([A-Za-z_][\w.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function readAttrs(source: string): [string, string][] {
  const attrs: [string, string][] = [];
  for (const match of source.matchAll(ATTR_RE)) {
    attrs.push([match[1] ?? '', decodeEntities(match[2] ?? match[3] ?? '')]);
  }
  return attrs;
}

const TAG_RE = /<(\/?)([A-Za-z_][\w.-]*)([^>]*?)(\/?)>/y;

interface Cursor {
  source: string;
  at: number;
}

/** Skips declarations, comments and processing instructions; true if it moved. */
function skipMarkup(state: Cursor): boolean {
  const { source, at } = state;
  const pairs: [string, string][] = [
    ['<?', '?>'],
    ['<!--', '-->'],
    ['<!', '>']
  ];
  for (const [open, close] of pairs) {
    if (source.startsWith(open, at)) {
      const end = source.indexOf(close, at + open.length);
      if (end === -1) {
        throw new Error(`Unclosed ${open} at ${at}`);
      }
      state.at = end + close.length;
      return true;
    }
  }
  return false;
}

interface Tag {
  closing: boolean;
  name: string;
  attrs: string;
  selfClosing: boolean;
}

function readTag(state: Cursor): Tag {
  TAG_RE.lastIndex = state.at;
  const match = TAG_RE.exec(state.source);
  if (!match) {
    throw new Error(`Malformed tag at ${state.at}`);
  }
  state.at = TAG_RE.lastIndex;
  return { closing: match[1] === '/', name: match[2] ?? '', attrs: match[3] ?? '', selfClosing: match[4] === '/' };
}

function appendText(node: XmlElement | undefined, raw: string): void {
  const text = decodeEntities(raw).trim();
  if (text && node) {
    node.text += text;
  }
}

function closeElement(stack: XmlElement[], name: string, at: number): XmlElement | null {
  const open = stack.pop();
  if (!open || open.name !== name) {
    throw new Error(`Unexpected </${name}> at ${at}`);
  }
  return stack.length === 0 ? open : null;
}

function openElement(stack: XmlElement[], tag: Tag): XmlElement | null {
  const element: XmlElement = { name: tag.name, attrs: readAttrs(tag.attrs), children: [], text: '' };
  stack.at(-1)?.children.push(element);
  if (tag.selfClosing) {
    return stack.length === 0 ? element : null;
  }
  stack.push(element);
  return null;
}

/** Reads one XML document into its root element. Throws on anything malformed. */
export function parseXml(source: string): XmlElement {
  const cursor: Cursor = { source: source.replace(/^\uFEFF/, ''), at: 0 };
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  while (cursor.at < cursor.source.length && !root) {
    const next = cursor.source.indexOf('<', cursor.at);
    if (next === -1) {
      break;
    }
    appendText(stack.at(-1), cursor.source.slice(cursor.at, next));
    cursor.at = next;
    if (skipMarkup(cursor)) {
      continue;
    }
    const tag = readTag(cursor);
    root = tag.closing ? closeElement(stack, tag.name, next) : openElement(stack, tag);
  }
  if (!root) {
    throw new Error('No root element');
  }
  return root;
}

/** The first child element with this name, if there is one. */
export function child(element: XmlElement | undefined, name: string): XmlElement | undefined {
  return element?.children.find(candidate => candidate.name === name);
}

/** Every child element with this name. */
export function children(element: XmlElement | undefined, name: string): XmlElement[] {
  return element?.children.filter(candidate => candidate.name === name) ?? [];
}

/** A child element's text, or '' when it is absent. */
export function childText(element: XmlElement | undefined, name: string): string {
  return child(element, name)?.text ?? '';
}

/** An attribute's value, or '' when it is absent. */
export function attr(element: XmlElement | undefined, name: string): string {
  return element?.attrs.find(([key]) => key === name)?.[1] ?? '';
}
