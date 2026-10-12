// Full-text search across lessons (one document per ## / ### heading), flashcards, quiz
// questions and labs. The index is built on first use from all content.
import MiniSearch from 'minisearch';
import GithubSlugger from 'github-slugger';
import { loadAllFlashcards, loadAllLabs, loadAllLessons, loadAllQuestions, sectionTitle } from '../content/load';
import { stripMarkdown } from './remark';

export type ResultKind = 'lesson' | 'flashcard' | 'question' | 'lab';

export interface SearchDoc {
  id: string;
  kind: ResultKind;
  sectionId: string;
  title: string;
  text: string;
  path: string;
}

let indexPromise: Promise<MiniSearch<SearchDoc>> | null = null;

function splitLesson(sectionId: string, md: string): SearchDoc[] {
  const docs: SearchDoc[] = [];
  const slugger = new GithubSlugger();
  const body = md.replace(/```[\s\S]*?```/g, (m) => m.replace(/^#/gm, ' #'));
  const parts = body.split(/^(?=#{2,3}\s)/m);
  parts.forEach((part, i) => {
    const heading = part.match(/^#{2,3}\s+(.+)$/m)?.[1]?.trim();
    const title = heading ? heading.replace(/\{\{[^}]*\}\}/g, '').trim() : sectionTitle(sectionId);
    const anchor = heading ? slugger.slug(title) : '';
    docs.push({
      id: `lesson:${sectionId}:${i}`,
      kind: 'lesson',
      sectionId,
      title,
      text: stripMarkdown(part.replace(/^#{2,3}\s+.+$/m, '')),
      path: `/section/${sectionId}${anchor ? `#${anchor}` : ''}`,
    });
  });
  return docs;
}

async function build(): Promise<MiniSearch<SearchDoc>> {
  const [lessons, cards, questions, labs] = await Promise.all([loadAllLessons(), loadAllFlashcards(), loadAllQuestions(), loadAllLabs()]);
  const docs: SearchDoc[] = [
    ...lessons.flatMap((l) => splitLesson(l.sectionId, l.markdown)),
    ...cards.map((c) => ({
      id: `card:${c.id}`,
      kind: 'flashcard' as const,
      sectionId: c.sectionId,
      title: stripMarkdown(c.front),
      text: stripMarkdown(c.back),
      path: `/section/${c.sectionId}/flashcards?card=${encodeURIComponent(c.id)}`,
    })),
    ...questions.map((q) => ({
      id: `question:${q.id}`,
      kind: 'question' as const,
      sectionId: q.sectionId,
      title: stripMarkdown(q.question),
      text: stripMarkdown([q.explanation, ...q.options.map((o) => `${o.text} ${o.explanation}`)].join(' ')),
      path: `/section/${q.sectionId}/quiz?q=${encodeURIComponent(q.id)}`,
    })),
    ...labs.map((l) => ({
      id: `lab:${l.id}`,
      kind: 'lab' as const,
      sectionId: l.sectionId,
      title: l.title,
      text: stripMarkdown(`${l.objective} ${l.body}`),
      path: `/section/${l.sectionId}/lab?lab=${encodeURIComponent(l.id)}`,
    })),
  ];
  const index = new MiniSearch<SearchDoc>({
    fields: ['title', 'text'],
    storeFields: ['kind', 'sectionId', 'title', 'text', 'path'],
    searchOptions: { boost: { title: 3 }, prefix: true, fuzzy: 0.15, combineWith: 'AND' },
  });
  index.addAll(docs);
  return index;
}

export function getIndex(): Promise<MiniSearch<SearchDoc>> {
  indexPromise ??= build();
  return indexPromise;
}

export interface SearchHit extends SearchDoc {
  score: number;
  terms: string[];
}

export async function search(query: string, limit = 40): Promise<SearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const index = await getIndex();
  let hits = index.search(q);
  if (!hits.length) hits = index.search(q, { combineWith: 'OR' });
  return hits.slice(0, limit).map((h) => ({
    id: String(h.id),
    kind: h.kind,
    sectionId: h.sectionId,
    title: h.title,
    text: h.text,
    path: h.path,
    score: h.score,
    terms: h.terms,
  }));
}

/** A short excerpt of `text` around the first matched term. */
export function snippet(text: string, terms: string[], size = 160): string {
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t.toLowerCase());
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return text.slice(0, size) + (text.length > size ? '…' : '');
  const start = Math.max(0, at - Math.floor(size / 3));
  const end = Math.min(text.length, start + size);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}
