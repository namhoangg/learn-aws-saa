/** Wraps occurrences of the search terms in <mark>. */
export function Highlight({ text, terms }: { text: string; terms: string[] }) {
  const clean = terms.filter((t) => t.length > 1).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!clean.length) return <>{text}</>;
  const re = new RegExp(`(${clean.join('|')})`, 'gi');
  const parts = text.split(re);
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>))}
    </>
  );
}
