import { RefreshCw, ShieldQuestionMark } from 'lucide-react';

/** "Updated" / "Needs verification" marker with its note as tooltip and screen-reader text. */
export function Badge({ kind, note }: { kind: 'updated' | 'verify'; note?: string }) {
  const label = kind === 'updated' ? 'Updated' : 'Needs verification';
  const Icon = kind === 'updated' ? RefreshCw : ShieldQuestionMark;
  return (
    <span className={`badge badge--${kind}${note ? ' badge--has-note' : ''}`} title={note || undefined} tabIndex={note ? 0 : undefined}>
      <Icon size={12} strokeWidth={2.25} aria-hidden />
      {label}
      {note && <span className="sr-only">: {note}</span>}
    </span>
  );
}

/** Badge plus visible note, for flashcards and quiz questions. */
export function BadgeNote({ kind, note }: { kind: 'updated' | 'verify'; note: string }) {
  return (
    <p className={`badge-note badge-note--${kind}`}>
      <Badge kind={kind} /> <span>{note}</span>
    </p>
  );
}
