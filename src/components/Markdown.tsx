import { memo, useEffect, useMemo, useRef, type InputHTMLAttributes, type ReactNode } from 'react';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import type { Element, ElementContent } from 'hast';
import { Monitor, Terminal, Trash } from 'lucide-react';
import { Mermaid } from './Mermaid';
import { Callout } from './Callout';
import { Badge } from './Badge';
import { CodeBlock } from './CodeBlock';
import { DataTable } from './DataTable';
import {
  remarkCallouts,
  remarkHeadingIds,
  remarkInlineBadges,
  remarkLabSections,
  remarkLabTabs,
  remarkTaskKeys,
  taskKey,
  type CalloutType,
  type TocEntry,
} from '../lib/remark';
import { setLabItem, setSetting, useProgress } from '../state/store';
import { Segmented } from './Segmented';

function textOf(node: Element | ElementContent | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.value;
  if ('children' in node) return node.children.map((c) => textOf(c as ElementContent)).join('');
  return '';
}

function LabTabs({ node, children }: { node?: Element; children: ReactNode }) {
  const progress = useProgress();
  const tabs = (node?.children ?? [])
    .filter((c): c is Element => c.type === 'element')
    .map((c) => String(c.properties?.dataTab ?? ''))
    .filter(Boolean);
  // The Console / CLI choice is remembered and applies to every lab.
  const preferred = progress.settings.labMode ?? 'console';
  const active = tabs.includes(preferred) ? preferred : (tabs[0] ?? 'console');
  if (tabs.length < 2) return <div className="lab-tabs lab-tabs--single">{children}</div>;
  return (
    <div className="lab-tabs" data-active={active}>
      <Segmented<string>
        label="Show steps for"
        size="sm"
        value={active}
        onChange={(t) => setSetting('labMode', t as 'console' | 'cli')}
        options={tabs.map((t) => ({
          value: t,
          label: t === 'cli' ? 'AWS CLI' : 'Console',
          icon: t === 'cli' ? <Terminal size={16} aria-hidden /> : <Monitor size={16} aria-hidden />,
        }))}
      />
      {children}
    </div>
  );
}

function TaskItem({ labId, node, children, className, danger }: { labId?: string; node?: Element; children: ReactNode; className?: string; danger?: boolean }) {
  const progress = useProgress();
  const key = String(node?.properties?.dataTaskKey ?? taskKey(textOf(node).trim()));
  const checked = !!(labId && progress.labs[labId]?.checked[key]);
  if (!labId) return <li className={className}>{children}</li>;
  return (
    <li className={`task-item${checked ? ' task-item--done' : ''}${danger ? ' task-item--danger' : ''}`}>
      <label>
        <input type="checkbox" checked={checked} onChange={(e) => setLabItem(labId, key, e.target.checked)} />
        <span className="task-item__box" aria-hidden>
          <svg viewBox="0 0 16 16" width="16" height="16">
            <path d="M3.5 8.5l3 3 6-6.5" />
          </svg>
        </span>
        <span className="task-item__text">{children}</span>
      </label>
    </li>
  );
}

interface Props {
  markdown: string;
  /** When set, task-list items become checkboxes saved under this lab id. */
  labId?: string;
  /** Lab bodies get step cards and the required cleanup box. */
  variant?: 'lab';
  onToc?: (toc: TocEntry[]) => void;
  className?: string;
}

function MarkdownImpl({ markdown, labId, variant, onToc, className }: Props) {
  // The TOC is collected during the transform (which runs inside render) and reported from an
  // effect, because setting a parent's state while rendering is not allowed.
  const tocRef = useRef<TocEntry[]>([]);
  const remarkPlugins = useMemo(
    () => [
      remarkGfm,
      remarkDirective,
      remarkTaskKeys,
      ...(variant === 'lab' ? [remarkLabSections] : []),
      remarkLabTabs,
      // Ids come from the raw heading text, before {{updated: ...}} markers turn into badges.
      remarkHeadingIds((toc) => (tocRef.current = toc)),
      remarkCallouts,
      remarkInlineBadges,
    ],
    [variant],
  );
  useEffect(() => {
    onToc?.(tocRef.current);
  }, [markdown, onToc]);
  const components = useMemo<Components>(() => {
    const inCleanup = new WeakSet<object>();
    return {
      aside({ node, children }: { children?: ReactNode } & ExtraProps) {
        const type = String(node?.properties?.dataCallout ?? 'note') as Lowercase<CalloutType>;
        return <Callout type={type}>{children}</Callout>;
      },
      span({ node, children, ...rest }: { children?: ReactNode } & ExtraProps) {
        const kind = node?.properties?.dataBadge;
        if (kind === 'updated' || kind === 'verify') return <Badge kind={kind} note={String(node?.properties?.dataNote ?? '')} />;
        return <span {...rest}>{children}</span>;
      },
      section({ node, children }: { children?: ReactNode } & ExtraProps) {
        if (node?.properties?.dataLabCleanup) {
          // Mark every list item in the cleanup box so its checkboxes use the danger style.
          const mark = (n: ElementContent) => {
            if (n.type === 'element') {
              if (n.tagName === 'li') inCleanup.add(n);
              n.children.forEach(mark);
            }
          };
          node.children.forEach(mark);
          return (
            <section className="lab-cleanup" aria-label="Cleanup, required">
              <span className="lab-cleanup__icon" aria-hidden>
                <Trash size={20} />
              </span>
              <div className="lab-cleanup__body">
                <p className="lab-cleanup__sub">Delete everything you created so nothing keeps billing.</p>
                {children}
              </div>
            </section>
          );
        }
        if (node?.properties?.dataLabStep) return <section className="lab-step">{children}</section>;
        return <section>{children}</section>;
      },
      div({ node, children, className: cls }: { children?: ReactNode; className?: string } & ExtraProps) {
        if (node?.properties?.dataTabs) return <LabTabs node={node}>{children}</LabTabs>;
        const tab = node?.properties?.dataTab;
        if (tab)
          return (
            <div className="lab-tab" data-tab={String(tab)}>
              {children}
            </div>
          );
        return <div className={cls}>{children}</div>;
      },
      pre({ node }: ExtraProps) {
        const code = node?.children.find((c): c is Element => c.type === 'element' && c.tagName === 'code');
        const cls = (code?.properties?.className as string[] | undefined) ?? [];
        const lang = cls.find((c) => c.startsWith('language-'))?.slice(9) ?? '';
        const text = textOf(code).replace(/\n$/, '');
        if (lang === 'mermaid') return <Mermaid code={text} />;
        return <CodeBlock code={text} lang={lang} />;
      },
      table({ node, children }: { children?: ReactNode } & ExtraProps) {
        const head = node?.children.find((c): c is Element => c.type === 'element' && c.tagName === 'thead');
        return <DataTable label={textOf(head).replace(/\s+/g, ' ').trim()}>{children}</DataTable>;
      },
      a({ href, children }: { href?: string; children?: ReactNode }) {
        const external = !!href && /^https?:\/\//.test(href);
        return (
          <a href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
            {children}
          </a>
        );
      },
      input({ node: _node, ...props }: InputHTMLAttributes<HTMLInputElement> & ExtraProps) {
        // remark-gfm's static task checkbox (inside the <li>, or inside its first <p> in a loose
        // list). In labs TaskItem draws the real one, so drop it wherever it landed.
        if (labId && props.type === 'checkbox' && props.disabled) return null;
        return <input {...props} />;
      },
      li({ node, children, className: cls }: { children?: ReactNode; className?: string } & ExtraProps) {
        if (cls?.includes('task-list-item'))
          return (
            <TaskItem labId={labId} node={node} className={cls} danger={!!node && inCleanup.has(node)}>
              {children}
            </TaskItem>
          );
        return <li className={cls}>{children}</li>;
      },
    };
  }, [labId]);
  return (
    <div className={`prose ${className ?? ''}`}>
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);

/** Small inline Markdown (flashcards, quiz text): same extensions, no headings TOC. */
export function InlineMarkdown({ markdown }: { markdown: string }) {
  return <Markdown markdown={markdown} className="prose--compact" />;
}
