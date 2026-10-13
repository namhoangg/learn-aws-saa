import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Monitor, Moon, ShieldQuestionMark, Sun, Trash2, Upload } from 'lucide-react';
import { exportProgress, importProgress, resetProgress, setSetting, setTheme, useProgress, type Theme } from '../state/store';
import { overallProgress, useCounts } from '../lib/progress';
import { collectVerify } from '../lib/verify';
import { Segmented } from '../components/Segmented';

const SHORTCUTS: [string, string][] = [
  ['Ctrl / ⌘ + K', 'Open search (always on)'],
  ['/', 'Open search'],
  ['Space', 'Flip a flashcard'],
  ['1 / 2 or ← / →', 'Rate a flashcard Hard / Easy'],
  ['A–F or 1–6', 'Choose a quiz option'],
  ['Enter', 'Check the answer, then go to the next question'],
  ['N / P', 'Exam: next / previous question'],
  ['F', 'Exam: flag the question for review'],
  ['Esc', 'Close search, dialogs and the menu'],
];

export function SettingsPage() {
  const progress = useProgress();
  const counts = useCounts();
  const overall = overallProgress(progress, counts);
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');
  const [verifyCount, setVerifyCount] = useState<number | null>(null);
  const shortcuts = progress.settings.shortcuts !== false;

  useEffect(() => {
    collectVerify().then((v) => setVerifyCount(v.length));
  }, []);

  const download = () => {
    const blob = new Blob([exportProgress()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `saa-c03-progress-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    try {
      importProgress(await file.text());
      setMessage('Progress imported.');
    } catch (e) {
      setMessage(`Import failed: ${(e as Error).message}`);
    }
  };

  const themes: { id: Theme; label: string; Icon: typeof Sun }[] = [
    { id: 'light', label: 'Light', Icon: Sun },
    { id: 'dark', label: 'Dark', Icon: Moon },
    { id: 'system', label: 'Match system', Icon: Monitor },
  ];

  return (
    <div className="page settings">
      <header className="page-head">
        <p className="eyebrow">Your data stays in this browser</p>
        <h1>Progress &amp; settings</h1>
      </header>

      <section className="card">
        <h2>Appearance</h2>
        <Segmented<Theme>
          label="Theme"
          value={progress.settings.theme}
          onChange={setTheme}
          options={themes.map(({ id, label, Icon }) => ({ value: id, label, icon: <Icon size={16} aria-hidden /> }))}
        />
      </section>

      <section className="card">
        <h2>Keyboard</h2>
        <label className="check">
          <input type="checkbox" checked={shortcuts} onChange={(e) => setSetting('shortcuts', e.target.checked)} />
          Single-key shortcuts
        </label>
        <table className="shortcut-table">
          <tbody>
            {SHORTCUTS.map(([k, what]) => (
              <tr key={k} className={!shortcuts && !k.startsWith('Ctrl') && k !== 'Esc' ? 'is-off' : ''}>
                <th scope="row">
                  <kbd className="kbd">{k}</kbd>
                </th>
                <td>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Needs verification</h2>
        <p className="muted">Content facts that could not be confirmed on AWS documentation. Check them before you rely on them.</p>
        <Link className="btn btn--secondary" to="/verify">
          <ShieldQuestionMark size={18} aria-hidden /> {verifyCount === null ? 'Open the list' : `${verifyCount} open item${verifyCount === 1 ? '' : 's'}`}
        </Link>
      </section>

      <section className="card">
        <h2>What is stored</h2>
        <ul className="plain-list">
          <li>{overall.lessonsRead} lessons marked as read</li>
          <li>{Object.keys(progress.cards).length} flashcards with a review schedule</li>
          <li>{progress.attempts.length} quiz and exam attempts</li>
          <li>{Object.keys(progress.questions).length} questions answered at least once</li>
          <li>{overall.labsDone} labs completed</li>
        </ul>
        <p className="muted">Everything is saved in this browser (localStorage). Export a backup before clearing browser data or moving to another machine.</p>
        <div className="button-row">
          <button type="button" className="btn btn--secondary" onClick={download}>
            <Download size={18} aria-hidden /> Export progress
          </button>
          <button type="button" className="btn btn--secondary" onClick={() => fileRef.current?.click()}>
            <Upload size={18} aria-hidden /> Import progress
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => upload(e.target.files?.[0])} />
        </div>
        {message && <p role="status">{message}</p>}
      </section>

      <section className="card">
        <h2>Content check</h2>
        <p className="muted">After editing files in content/, render every section to catch broken diagrams or Markdown.</p>
        <Link className="btn btn--secondary" to="/check">
          Open content check
        </Link>
      </section>

      <section className="card card--danger">
        <h2>Reset</h2>
        <p className="muted">Deletes lessons read, quiz history, flashcard schedules and lab checklists. Your settings are kept.</p>
        <button
          type="button"
          className="btn btn--danger"
          onClick={() => {
            if (confirm('Delete all progress? Export a backup first if you might want it back.')) {
              resetProgress();
              setMessage('Progress reset.');
            }
          }}
        >
          <Trash2 size={18} aria-hidden /> Reset all progress
        </button>
      </section>
    </div>
  );
}
