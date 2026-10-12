import { useEffect, useState } from 'react';
import type { TocEntry } from '../lib/remark';

/** "On this page" list that highlights the heading currently in view. */
export function Toc({ entries }: { entries: TocEntry[] }) {
  const [active, setActive] = useState<string>('');

  useEffect(() => {
    if (!entries.length) return;
    const observer = new IntersectionObserver(
      (items) => {
        const visible = items.filter((i) => i.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-80px 0px -70% 0px' },
    );
    for (const e of entries) {
      const el = document.getElementById(e.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [entries]);

  if (!entries.length) return <aside className="toc" aria-hidden />;
  return (
    <aside className="toc" aria-label="On this page">
      <p className="toc__title">On this page</p>
      <ol>
        {entries.map((e) => (
          <li key={e.id} className={`toc__item toc__item--h${e.depth}${active === e.id ? ' toc__item--active' : ''}`}>
            <a href={`#${e.id}`} onClick={(ev) => {
              ev.preventDefault();
              document.getElementById(e.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              history.replaceState(null, '', `#${e.id}`);
              setActive(e.id);
            }}>
              {e.text}
            </a>
          </li>
        ))}
      </ol>
    </aside>
  );
}
