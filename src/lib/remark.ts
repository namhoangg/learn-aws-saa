// remark plugins for the content/ Markdown extensions described in content/README.md:
// callout blockquotes (> [!EXAM] Title), inline {{updated: ...}} / {{verify: ...}} markers,
// :::console / :::cli containers, and heading ids for the table of contents.
import GithubSlugger from 'github-slugger';
import { visit, SKIP } from 'unist-util-visit';
import { unified, type Plugin } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import { toString } from 'mdast-util-to-string';
import type { Root, Blockquote, Paragraph, Text, Heading, ListItem, PhrasingContent, RootContent } from 'mdast';

export const CALLOUT_TYPES = ['EXAM', 'TRAP', 'TIP', 'NOTE', 'EXAMPLE', 'WARNING', 'UPDATED', 'VERIFY', 'CHECK', 'COST'] as const;
export type CalloutType = (typeof CALLOUT_TYPES)[number];

interface HastData {
  hName?: string;
  hProperties?: Record<string, unknown>;
}

function setData(node: { data?: unknown }, data: HastData) {
  node.data = { ...((node.data as object) ?? {}), ...data };
}

/**
 * `> [!TYPE] Optional title` blockquotes become <aside data-callout="type">. The rest of the
 * first line (inline formatting kept) becomes a leading <div class="callout-title">.
 */
export const remarkCallouts: Plugin<[], Root> = () => (tree) => {
  visit(tree, 'blockquote', (node: Blockquote) => {
    const first = node.children[0];
    if (!first || first.type !== 'paragraph') return;
    const lead = first.children[0];
    if (!lead || lead.type !== 'text') return;
    const m = lead.value.match(/^\[!([A-Za-z]+)\][ \t]*/);
    if (!m) return;
    const type = m[1].toUpperCase();
    if (!(CALLOUT_TYPES as readonly string[]).includes(type)) return;
    lead.value = lead.value.slice(m[0].length);
    const title: PhrasingContent[] = [];
    while (first.children.length) {
      const child = first.children[0];
      if (child.type === 'break') {
        first.children.shift();
        break;
      }
      if (child.type === 'text') {
        const nl = child.value.indexOf('\n');
        if (nl >= 0) {
          if (nl > 0) title.push({ type: 'text', value: child.value.slice(0, nl) });
          child.value = child.value.slice(nl + 1);
          if (!child.value) first.children.shift();
          break;
        }
      }
      title.push(first.children.shift()!);
    }
    if (first.children.length === 0) node.children.shift();
    if (title.some((t) => t.type !== 'text' || t.value.trim())) {
      const titleNode: Paragraph = { type: 'paragraph', children: title };
      setData(titleNode, { hName: 'div', hProperties: { className: ['callout-title'] } });
      node.children.unshift(titleNode);
    }
    setData(node, { hName: 'aside', hProperties: { dataCallout: type.toLowerCase() } });
  });
};

const MARKER = /\{\{\s*(updated|verify)\s*:\s*([^}]+?)\s*\}\}/gi;

/** `{{updated: note}}` and `{{verify: note}}` become <span data-badge="updated" data-note="…">. */
export const remarkInlineBadges: Plugin<[], Root> = () => (tree) => {
  visit(tree, 'text', (node: Text, index, parent) => {
    if (!parent || index === undefined || !MARKER.test(node.value)) return;
    MARKER.lastIndex = 0;
    const out: PhrasingContent[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = MARKER.exec(node.value))) {
      if (m.index > last) out.push({ type: 'text', value: node.value.slice(last, m.index) });
      const badge: Text = { type: 'text', value: m[1].toLowerCase() === 'updated' ? 'Updated' : 'Needs verification' };
      const span = { type: 'emphasis', children: [badge] } as PhrasingContent;
      setData(span, { hName: 'span', hProperties: { dataBadge: m[1].toLowerCase(), dataNote: m[2] } });
      out.push(span);
      last = m.index + m[0].length;
    }
    if (last < node.value.length) out.push({ type: 'text', value: node.value.slice(last) });
    (parent.children as PhrasingContent[]).splice(index, 1, ...out);
    return [SKIP, index + out.length];
  });
};

interface ContainerDirective {
  type: 'containerDirective' | 'leafDirective' | 'textDirective';
  name: string;
  children: RootContent[];
  data?: unknown;
}

/**
 * `:::console` / `:::cli` containers become <div data-tab="console|cli">; consecutive ones are
 * wrapped in <div data-tabs> so the renderer can show them as a Console / CLI toggle.
 * Unknown directives are turned back into plain text so stray colons never vanish.
 */
export const remarkLabTabs: Plugin<[], Root> = () => (tree) => {
  visit(tree, (node, index, parent) => {
    const n = node as unknown as ContainerDirective;
    if (n.type === 'textDirective' || n.type === 'leafDirective') {
      if (!parent || index === undefined) return;
      // "re:Post" or "s3:GetObject" parse as directives; put the original text back, label included.
      const label = n.children?.length ? `[${toString(n as unknown as Root)}]` : '';
      const text: Text = { type: 'text', value: `${n.type === 'leafDirective' ? '::' : ':'}${n.name}${label}` };
      const replacement: Paragraph | Text = n.type === 'leafDirective' ? { type: 'paragraph', children: [text] } : text;
      (parent.children as unknown[]).splice(index, 1, replacement);
      return SKIP;
    }
    if (n.type !== 'containerDirective') return;
    // Containers built by other plugins (lab steps, cleanup) already say how to render.
    if ((n.data as HastData | undefined)?.hName) return;
    if (n.name === 'console' || n.name === 'cli') setData(n, { hName: 'div', hProperties: { dataTab: n.name } });
    else setData(n, { hName: 'div', hProperties: { dataDirective: n.name } });
  });
  // Restored directives leave split text nodes; join them so text-based plugins
  // (inline {{updated: ...}} markers) see continuous text.
  visit(tree, (node) => {
    const kids = (node as { children?: RootContent[] }).children;
    if (!kids) return;
    for (let i = kids.length - 1; i > 0; i--) {
      const a = kids[i - 1];
      const b = kids[i];
      if (a.type === 'text' && b.type === 'text') {
        a.value += b.value;
        kids.splice(i, 1);
      }
    }
  });
  // Group adjacent console/cli containers. A group is never regrouped, or this would nest forever.
  visit(tree, (node) => {
    if ((node as unknown as ContainerDirective).name === 'tabs') return SKIP;
    const parent = node as unknown as { children?: RootContent[] };
    if (!parent.children) return;
    const kids = parent.children;
    for (let i = 0; i < kids.length; i++) {
      const isTab = (k: RootContent | undefined) => {
        const d = k as unknown as ContainerDirective | undefined;
        return d?.type === 'containerDirective' && (d.name === 'console' || d.name === 'cli');
      };
      if (!isTab(kids[i])) continue;
      let j = i;
      while (isTab(kids[j + 1])) j++;
      const group = { type: 'containerDirective', name: 'tabs', children: kids.slice(i, j + 1) } as unknown as RootContent;
      setData(group as { data?: unknown }, { hName: 'div', hProperties: { dataTabs: 'true' } });
      kids.splice(i, j - i + 1, group);
    }
  });
};

/** Stable key for a checklist item: a short hash of its text, so ticks survive edits elsewhere. */
export function taskKey(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const taskText = (node: ListItem) => toString(node.children[0] ?? node).trim();

/** Tags every task-list item with data-task-key so the renderer can save its tick. */
export const remarkTaskKeys: Plugin<[], Root> = () => (tree) => {
  visit(tree, 'listItem', (node: ListItem) => {
    if (node.checked === null || node.checked === undefined) return;
    setData(node, { hProperties: { dataTaskKey: taskKey(taskText(node)) } });
  });
};

export interface TaskRef {
  key: string;
  /** Text of the nearest ## heading above the item, e.g. "Cleanup". */
  section: string;
}

/** The keys remarkTaskKeys assigns in a document, in order, with the ## section each sits in. */
export function taskKeys(markdown: string): TaskRef[] {
  const tree = unified().use(remarkParse).use(remarkGfm).use(remarkDirective).parse(markdown);
  const out: TaskRef[] = [];
  let section = '';
  for (const block of tree.children) {
    if (block.type === 'heading' && block.depth === 2) {
      section = toString(block).trim();
      continue;
    }
    visit(block, 'listItem', (node: ListItem) => {
      if (node.checked !== null && node.checked !== undefined) out.push({ key: taskKey(taskText(node)), section });
    });
  }
  return out;
}

const isStepHeading = (n: RootContent) => n.type === 'heading' && n.depth === 3 && /^step\s+\d+/i.test(toString(n));
const isCleanupHeading = (n: RootContent) => n.type === 'heading' && n.depth === 2 && /^clean\s*-?\s*up/i.test(toString(n));

/**
 * Labs only: wraps each "### Step N" heading and its content in <section data-lab-step> and the
 * "## Cleanup" section in <section data-lab-cleanup>, so they render as step cards and the
 * required cleanup box.
 */
export const remarkLabSections: Plugin<[], Root> = () => (tree) => {
  const out: RootContent[] = [];
  const kids = tree.children;
  let i = 0;
  while (i < kids.length) {
    const node = kids[i];
    if (isStepHeading(node) || isCleanupHeading(node)) {
      const cleanup = isCleanupHeading(node);
      let j = i + 1;
      while (j < kids.length) {
        const n = kids[j];
        if (n.type === 'heading' && (n.depth <= 2 || (!cleanup && n.depth === 3))) break;
        j++;
      }
      const group = { type: 'containerDirective', name: cleanup ? 'cleanup' : 'step', children: kids.slice(i, j) } as unknown as RootContent;
      setData(group as { data?: unknown }, { hName: 'section', hProperties: cleanup ? { dataLabCleanup: 'true' } : { dataLabStep: 'true' } });
      out.push(group);
      i = j;
    } else {
      out.push(node);
      i++;
    }
  }
  tree.children = out;
};

export interface TocEntry {
  id: string;
  text: string;
  depth: number;
}

function headingText(node: Heading): string {
  let out = '';
  visit(node, (n) => {
    if (n.type === 'text' || n.type === 'inlineCode') out += (n as Text).value;
  });
  return out.replace(MARKER, '').trim();
}

/** Adds GitHub-style ids to h2/h3 and reports them so the page can build "On this page". */
export function remarkHeadingIds(onToc?: (toc: TocEntry[]) => void): Plugin<[], Root> {
  return () => (tree) => {
    const slugger = new GithubSlugger();
    const toc: TocEntry[] = [];
    visit(tree, 'heading', (node: Heading) => {
      const text = headingText(node);
      const id = slugger.slug(text);
      setData(node, { hProperties: { id } });
      if (node.depth === 2 || node.depth === 3) toc.push({ id, text, depth: node.depth });
    });
    onToc?.(toc);
  };
}

/** Plain-text extraction used by search. */
export function stripMarkdown(md: string): string {
  return md
    .replace(/```mermaid[\s\S]*?```/g, ' ')
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*/g, ' '))
    .replace(/\{\{\s*(updated|verify)\s*:\s*([^}]+)\}\}/gi, ' $2 ')
    .replace(/^>\s*\[![A-Z]+\]/gm, ' ')
    .replace(/^:::\w*\s*$/gm, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
