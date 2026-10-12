import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldQuestionMark } from 'lucide-react';
import { collectVerify, type VerifyItem } from '../lib/verify';
import { getSection, sectionTitle } from '../content/load';

/** Every content item marked "Needs verification", grouped by section. */
export function VerifyPage() {
  const [items, setItems] = useState<VerifyItem[] | null>(null);

  useEffect(() => {
    collectVerify().then(setItems);
  }, []);

  const groups = new Map<string, VerifyItem[]>();
  for (const it of items ?? []) groups.set(it.sectionId, [...(groups.get(it.sectionId) ?? []), it]);
  const ordered = [...groups.entries()].sort((a, b) => (getSection(a[0])?.order ?? 0) - (getSection(b[0])?.order ?? 0));

  return (
    <div className="page verify-page">
      <header className="page-head">
        <p className="eyebrow">Open items</p>
        <h1>Needs verification</h1>
        <p className="muted">Facts that could not be confirmed on AWS documentation when the content was written. Check these before you rely on them.</p>
      </header>
      {items === null ? (
        <p className="muted">Loading…</p>
      ) : items.length === 0 ? (
        <div className="empty-state card">
          <ShieldQuestionMark size={32} aria-hidden />
          <h3>Nothing open</h3>
          <p>Every fact in the content was confirmed or updated.</p>
        </div>
      ) : (
        ordered.map(([sid, list]) => (
          <section key={sid} className="card">
            <h2>
              <Link to={`/section/${sid}`}>
                {String(getSection(sid)?.order ?? '').padStart(2, '0')} {sectionTitle(sid)}
              </Link>
            </h2>
            <ul className="verify-list">
              {list.map((it, i) => (
                <li key={i}>
                  <span className="badge badge--verify">
                    <ShieldQuestionMark size={12} strokeWidth={2.25} aria-hidden /> {it.where}
                  </span>
                  <Link to={it.path}>{it.text}</Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
