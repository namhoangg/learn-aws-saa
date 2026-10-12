import { useMemo, useState } from 'react';
import { CircleCheck, Clock, DollarSign, ExternalLink, OctagonAlert, Target, Terminal, TriangleAlert } from 'lucide-react';
import type { Lab } from '../content/types';
import { acknowledgeLabCost, setLabComplete, useProgress } from '../state/store';
import { serviceById } from '../content/load';
import { taskKeys } from '../lib/remark';
import { Markdown } from './Markdown';

const FREE_TIER: Record<Lab['freeTier'], { label: string; cls: string }> = {
  yes: { label: 'Free Tier eligible', cls: 'chip--free' },
  partial: { label: 'Partly Free Tier', cls: 'chip--verify' },
  no: { label: 'Not Free Tier', cls: 'chip--notfree' },
};

/** Splits off the "## Progress checklist" section so it can sit in the side panel. */
function splitChecklist(body: string): { main: string; checklist: string } {
  const m = body.match(/^##\s+Progress checklist\s*$/im);
  if (!m || m.index === undefined) return { main: body, checklist: '' };
  const rest = body.slice(m.index + m[0].length);
  const next = rest.search(/^##\s+/m);
  const checklist = next >= 0 ? rest.slice(0, next) : rest;
  const main = body.slice(0, m.index) + (next >= 0 ? rest.slice(next) : '');
  return { main, checklist };
}

/** A pricing link for the services a lab uses, when one is obvious. */
function pricingUrl(lab: Lab): string {
  const first = lab.services[0];
  const slug: Record<string, string> = { ec2: 'ec2', alb: 'elasticloadbalancing', nlb: 'elasticloadbalancing', elb: 'elasticloadbalancing', rds: 'rds', s3: 's3', vpc: 'vpc', 'nat-gateway': 'vpc' };
  return `https://aws.amazon.com/${slug[first] ?? first ?? ''}/pricing/`.replace(/\/\/pricing/, '/pricing');
}

export function LabView({ labs, initialLabId }: { labs: Lab[]; sectionId: string; initialLabId?: string }) {
  const progress = useProgress();
  const [activeId, setActiveId] = useState(() => labs.find((l) => l.id === initialLabId)?.id ?? labs[0].id);
  const [understood, setUnderstood] = useState(false);
  const lab = labs.find((l) => l.id === activeId) ?? labs[0];
  const index = labs.indexOf(lab);
  const state = progress.labs[lab.id];
  const { main, checklist } = useMemo(() => splitChecklist(lab.body), [lab.body]);
  const refs = useMemo(() => taskKeys(lab.body), [lab.body]);
  const cleanupKeys = refs.filter((r) => /^clean/i.test(r.section)).map((r) => r.key);
  const checklistKeys = refs.filter((r) => /^progress checklist/i.test(r.section)).map((r) => r.key);
  const cleanupDone = cleanupKeys.filter((k) => state?.checked[k]).length;
  const checklistDone = checklistKeys.filter((k) => state?.checked[k]).length;
  const complete = !!state?.completedAt;
  const ft = FREE_TIER[lab.freeTier] ?? FREE_TIER.no;
  const gated = lab.freeTier === 'no' && !state?.costAcknowledgedAt;
  const canComplete = cleanupDone === cleanupKeys.length;

  return (
    <div className="lab">
      {labs.length > 1 && (
        <div className="lab__picker" role="tablist" aria-label="Labs in this section">
          {labs.map((l, i) => (
            <button
              key={l.id}
              type="button"
              role="tab"
              aria-selected={l.id === lab.id}
              className={`lab__pick${l.id === lab.id ? ' lab__pick--active' : ''}`}
              onClick={() => {
                setActiveId(l.id);
                setUnderstood(false);
              }}
            >
              <span className="mono-label">Lab {String(i + 1).padStart(2, '0')}</span>
              <span className="lab__pick-title">{l.title}</span>
              {progress.labs[l.id]?.completedAt && <CircleCheck size={16} className="lab__pick-done" aria-label="completed" />}
            </button>
          ))}
        </div>
      )}

      <div className="lab__layout">
        <div className="lab__main">
          <header className="lab__head">
            <div className="lab__chips">
              <span className="mono-label">Lab {String(index + 1).padStart(2, '0')}</span>
              <span className={`chip ${ft.cls}`}>
                {lab.freeTier === 'no' ? <OctagonAlert size={14} strokeWidth={2} aria-hidden /> : lab.freeTier === 'yes' ? <CircleCheck size={14} strokeWidth={2} aria-hidden /> : <TriangleAlert size={14} strokeWidth={2} aria-hidden />}
                {ft.label}
              </span>
              <span className="chip chip--neutral">
                <Terminal size={14} strokeWidth={2} aria-hidden /> Console + CLI
              </span>
            </div>
            <h2 className="lab__title">{lab.title}</h2>

            {lab.freeTier === 'no' && (
              <div className="cost-banner" role="alert">
                <span className="cost-banner__icon" aria-hidden>
                  <OctagonAlert size={22} />
                </span>
                <div className="cost-banner__body">
                  <p className="cost-banner__title">Not Free Tier: this lab costs money</p>
                  <p>{lab.cost}</p>
                  {gated ? (
                    <>
                      <label className="check check--danger">
                        <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
                        <span>I understand the cost and will run the cleanup at the end.</span>
                      </label>
                      <div className="button-row">
                        <button type="button" className="btn btn--primary" aria-disabled={!understood} onClick={() => understood && acknowledgeLabCost(lab.id)}>
                          Show steps
                        </button>
                        <a className="btn btn--ghost" href={pricingUrl(lab)} target="_blank" rel="noopener noreferrer">
                          <ExternalLink size={18} aria-hidden /> Pricing page
                        </a>
                      </div>
                    </>
                  ) : (
                    <p className="cost-banner__ack">Cost acknowledged. Run the cleanup section as soon as you finish.</p>
                  )}
                </div>
              </div>
            )}
            {lab.freeTier === 'partial' && (
              <div className="callout callout--warning lab__partial" role="note">
                <span className="callout__icon" aria-hidden>
                  <TriangleAlert size={18} strokeWidth={2} />
                </span>
                <div className="callout__content">
                  <div className="callout__label">
                    <span>Parts of this lab are billed</span>
                  </div>
                  <div className="callout__body">
                    <p>{lab.cost} Follow the cleanup section as soon as you finish.</p>
                  </div>
                </div>
              </div>
            )}

            <div className="lab__meta">
              <div className="meta-tile">
                <Target size={20} aria-hidden />
                <span className="mono-label">Objective</span>
                <span className="meta-tile__value">{lab.objective}</span>
              </div>
              <div className="meta-tile">
                <Clock size={20} aria-hidden />
                <span className="mono-label">Estimated time</span>
                <span className="meta-tile__value">{lab.estimatedTime}</span>
              </div>
              <div className="meta-tile">
                <DollarSign size={20} aria-hidden />
                <span className="mono-label">Estimated cost</span>
                <span className="meta-tile__value">{lab.cost}</span>
              </div>
            </div>
            {lab.services.length > 0 && (
              <div className="lab__services">
                {lab.services.map((s) => (
                  <span key={s} className="chip chip--neutral">
                    {serviceById.get(s)?.name ?? s}
                  </span>
                ))}
              </div>
            )}
          </header>

          {gated ? (
            <p className="lab__gated muted">Confirm the cost above to see the steps. The cleanup section is always shown below.</p>
          ) : null}
          <Markdown markdown={gated ? cleanupOnly(main) : main} labId={lab.id} variant="lab" className={`lab__body${gated ? ' lab__body--gated' : ''}`} />

          <div className="lab__complete">
            <button
              type="button"
              className={`btn btn--lg ${complete ? 'btn--secondary' : 'btn--primary'}`}
              aria-disabled={!complete && !canComplete}
              aria-pressed={complete}
              onClick={() => (complete ? setLabComplete(lab.id, false) : canComplete && setLabComplete(lab.id, true))}
            >
              <CircleCheck size={18} aria-hidden /> {complete ? 'Lab complete' : 'Mark lab complete'}
            </button>
            {complete ? (
              <span className="chip chip--free">
                <CircleCheck size={14} strokeWidth={2} aria-hidden /> Counted on your dashboard
              </span>
            ) : (
              <span className="muted">
                {canComplete
                  ? 'Cleanup done. You can mark the lab complete.'
                  : `Finish the cleanup checklist (${cleanupDone} of ${cleanupKeys.length} done) to complete this lab.`}
              </span>
            )}
          </div>
        </div>

        {checklist && (
          <aside className="lab__panel" aria-label="Your progress">
            <div className="lab__panel-head">
              <span className="mono-label">Your progress</span>
              <span className="lab__panel-count">
                {checklistDone} / {checklistKeys.length}
              </span>
            </div>
            <span className="progress-bar progress-bar--sm" role="progressbar" aria-label="Lab progress" aria-valuemin={0} aria-valuemax={checklistKeys.length} aria-valuenow={checklistDone}>
              <span style={{ width: `${checklistKeys.length ? (checklistDone / checklistKeys.length) * 100 : 0}%` }} />
            </span>
            <Markdown markdown={checklist} labId={lab.id} className="lab__panel-list" />
          </aside>
        )}
      </div>
    </div>
  );
}

/** Before a paid lab is acknowledged, show only its cleanup section (so nothing can be missed). */
function cleanupOnly(body: string): string {
  const m = body.match(/^##\s+Clean\s*-?\s*up\b.*$/im);
  if (!m || m.index === undefined) return '';
  const rest = body.slice(m.index);
  const next = rest.slice(m[0].length).search(/^##\s+/m);
  return next >= 0 ? rest.slice(0, m[0].length + next) : rest;
}
