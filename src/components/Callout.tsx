import type { ReactNode } from 'react';
import { CircleCheck, DollarSign, Eye, Info, Lightbulb, RefreshCw, ShieldQuestionMark, TriangleAlert, Wrench } from 'lucide-react';
import type { CalloutType } from '../lib/remark';
import { Badge } from './Badge';

type Kind = Lowercase<CalloutType>;

/** Label, icon and palette per callout type (palettes in components.css). */
const META: Record<Kind, { label: string; Icon: typeof Info; badge?: 'updated' | 'verify' }> = {
  exam: { label: 'Exam tip', Icon: Lightbulb },
  trap: { label: 'Common trap', Icon: TriangleAlert },
  tip: { label: 'Tip', Icon: Wrench },
  note: { label: 'Note', Icon: Info },
  example: { label: 'Example', Icon: Eye },
  warning: { label: 'Warning', Icon: TriangleAlert },
  updated: { label: 'Updated', Icon: RefreshCw, badge: 'updated' },
  verify: { label: 'Needs verification', Icon: ShieldQuestionMark, badge: 'verify' },
  check: { label: 'What to verify', Icon: CircleCheck },
  cost: { label: 'Cost', Icon: DollarSign },
};

export function Callout({ type, children }: { type: Kind; children: ReactNode }) {
  const meta = META[type] ?? META.note;
  const { Icon } = meta;
  return (
    <aside className={`callout callout--${type}`} aria-label={meta.label}>
      <span className="callout__icon" aria-hidden>
        <Icon size={18} strokeWidth={2} />
      </span>
      <div className="callout__content">
        <div className="callout__label">{meta.badge ? <Badge kind={meta.badge} /> : <span>{meta.label}</span>}</div>
        <div className="callout__body">{children}</div>
      </div>
    </aside>
  );
}
