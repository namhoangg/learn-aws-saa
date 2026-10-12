import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { availableSections, loadFlashcards, loadLabs, loadLesson, loadQuiz } from '../content/load';
import { Markdown } from '../components/Markdown';

interface Row {
  id: string;
  diagrams: number;
  diagramErrors: string[];
  renderError?: string;
  ms: number;
}

class Catch extends Component<{ onError: (e: Error) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Renders one section's lesson, labs, cards and questions off-screen and reports problems. */
function Probe({ id, onDone }: { id: string; onDone: (row: Row) => void }) {
  const [docs, setDocs] = useState<string[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const started = useRef(performance.now());
  const errorRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    Promise.all([loadLesson(id), loadLabs(id), loadFlashcards(id), loadQuiz(id)])
      .then(([lesson, labs, cards, qs]) => {
        setDocs([
          lesson ?? '',
          ...labs.map((l) => l.body),
          ...cards.flatMap((c) => [c.front, c.back]),
          ...qs.flatMap((q) => [q.question, q.explanation, ...q.options.flatMap((o) => [o.text, o.explanation])]),
        ]);
      })
      .catch((e) => {
        errorRef.current = String(e?.message ?? e);
        setDocs([]);
      });
  }, [id]);

  useEffect(() => {
    if (docs === null) return;
    // Wait until every diagram has either drawn or failed.
    const t = setInterval(() => {
      const root = ref.current;
      if (!root) return;
      const pending = root.querySelectorAll('.diagram__canvas[aria-busy="true"]').length;
      const elapsed = performance.now() - started.current;
      if (pending === 0 || elapsed > 30000) {
        clearInterval(t);
        const failed = [...root.querySelectorAll('[data-mermaid-error]')].map((el) => el.querySelector('figcaption')?.textContent ?? 'error');
        if (pending) failed.push(`${pending} diagram(s) still drawing after 30 s`);
        onDone({ id, diagrams: root.querySelectorAll('.diagram').length, diagramErrors: failed, renderError: errorRef.current, ms: Math.round(elapsed) });
      }
    }, 250);
    return () => clearInterval(t);
  }, [docs, id, onDone]);

  return (
    <div ref={ref} className="check-probe" aria-hidden>
      <Catch onError={(e) => (errorRef.current = e.message)}>
        {docs?.map((d, i) => <Markdown key={i} markdown={d} labId={i > 0 ? `__check-${id}` : undefined} />)}
      </Catch>
    </div>
  );
}

/** Content check: renders every section and lists diagram or render failures. */
export function CheckPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const index = rows.length;
  const current = running ? availableSections[index] : undefined;

  useEffect(() => {
    if (running && index >= availableSections.length) setRunning(false);
  }, [running, index]);

  const failures = rows.filter((r) => r.renderError || r.diagramErrors.length);
  const onDone = useCallback((row: Row) => setRows((rs) => [...rs, row]), []);

  return (
    <div className="page check">
      <header className="page-head">
        <p className="eyebrow">Maintenance</p>
        <h1>Content check</h1>
        <p className="muted">Renders every lesson, lab, flashcard and quiz question, waits for each Mermaid diagram, and reports anything that fails. Run it after editing files in content/.</p>
        <button type="button" className="btn btn--primary" disabled={running} onClick={() => { setRows([]); setRunning(true); }}>
          {running ? `Checking ${index + 1} of ${availableSections.length}…` : 'Run check'}
        </button>
      </header>
      {rows.length > 0 && (
        <p id="check-summary" role="status" data-done={!running} data-failures={failures.length}>
          {running ? 'Running' : 'Finished'}: {rows.length} sections, {rows.reduce((n, r) => n + r.diagrams, 0)} diagrams, {failures.length} section(s) with problems.
        </p>
      )}
      <table className="check__table">
        <thead>
          <tr>
            <th>Section</th>
            <th>Diagrams</th>
            <th>Problems</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.renderError || r.diagramErrors.length ? 'is-bad' : 'is-good'}>
              <td>{r.id}</td>
              <td>{r.diagrams}</td>
              <td>{[r.renderError, ...r.diagramErrors].filter(Boolean).join(' | ') || 'none'}</td>
              <td>{r.ms} ms</td>
            </tr>
          ))}
        </tbody>
      </table>
      {current && <Probe key={current.id} id={current.id} onDone={onDone} />}
    </div>
  );
}
