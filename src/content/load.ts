// Loads everything under content/. Metadata is bundled eagerly (sidebar, home, map);
// lessons, cards, quizzes and labs load on demand per section.
import { parse as parseYaml } from 'yaml';
import courseJson from '../../content/course.json';
import servicesJson from '../../content/services.json';
import type { Course, Flashcard, Lab, LabFrontMatter, QuizQuestion, SectionMeta, Service, WithSection } from './types';

export const course = courseJson as Course;

const metaModules = import.meta.glob<SectionMeta>('/content/*/meta.json', { eager: true, import: 'default' });
const lessonModules = import.meta.glob<string>('/content/*/lesson.md', { query: '?raw', import: 'default' });
const cardModules = import.meta.glob<{ cards: Flashcard[] }>('/content/*/flashcards.json', { import: 'default' });
const quizModules = import.meta.glob<{ questions: QuizQuestion[] }>('/content/*/quiz.json', { import: 'default' });
const labModules = import.meta.glob<string>('/content/*/labs/*.md', { query: '?raw', import: 'default' });

const sectionIdOf = (path: string) => path.split('/')[2];

const metaById = new Map<string, SectionMeta>();
for (const [path, meta] of Object.entries(metaModules)) metaById.set(sectionIdOf(path), meta);

export interface SectionEntry {
  id: string;
  order: number;
  partId: string;
  partTitle: string;
  /** Present once the section's content exists. */
  meta?: SectionMeta;
}

/** Every section in course order, including ones whose content is not written yet. */
export const sections: SectionEntry[] = course.parts.flatMap((part) =>
  part.sections.map((id) => ({ id, order: 0, partId: part.id, partTitle: part.title, meta: metaById.get(id) })),
);
sections.forEach((s, i) => (s.order = i + 1));

export const availableSections = sections.filter((s) => s.meta);

export function getSection(id: string): SectionEntry | undefined {
  return sections.find((s) => s.id === id);
}

export function sectionTitle(id: string): string {
  return metaById.get(id)?.title ?? id;
}

/** Catalog plus services declared by sections in newServices. */
export const services: Service[] = (() => {
  const list = [...(servicesJson as { services: Service[] }).services];
  const seen = new Set(list.map((s) => s.id));
  for (const meta of metaById.values()) {
    for (const s of meta.newServices ?? []) {
      if (!seen.has(s.id)) {
        list.push(s);
        seen.add(s.id);
      }
    }
  }
  return list;
})();
export const serviceById = new Map(services.map((s) => [s.id, s]));

export async function loadLesson(id: string): Promise<string | undefined> {
  return lessonModules[`/content/${id}/lesson.md`]?.();
}

export async function loadFlashcards(id: string): Promise<WithSection<Flashcard>[]> {
  const mod = await cardModules[`/content/${id}/flashcards.json`]?.();
  return (mod?.cards ?? []).map((c) => ({ ...c, sectionId: id }));
}

export async function loadQuiz(id: string): Promise<WithSection<QuizQuestion>[]> {
  const mod = await quizModules[`/content/${id}/quiz.json`]?.();
  return (mod?.questions ?? []).map((q) => ({ ...q, sectionId: id }));
}

export function parseLab(file: string, raw: string): Lab {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) throw new Error(`${file}: missing front matter`);
  const fm = parseYaml(m[1]) as LabFrontMatter;
  return { ...fm, services: fm.services ?? [], file, body: m[2] };
}

export async function loadLabs(id: string): Promise<Lab[]> {
  const entries = Object.entries(labModules)
    .filter(([p]) => p.startsWith(`/content/${id}/labs/`))
    .sort(([a], [b]) => a.localeCompare(b));
  return Promise.all(entries.map(async ([p, load]) => parseLab(p.split('/').pop()!, await load())));
}

export async function loadAllFlashcards(): Promise<WithSection<Flashcard>[]> {
  const all = await Promise.all(availableSections.map((s) => loadFlashcards(s.id)));
  return all.flat();
}

export async function loadAllQuestions(): Promise<WithSection<QuizQuestion>[]> {
  const all = await Promise.all(availableSections.map((s) => loadQuiz(s.id)));
  return all.flat();
}

/** Static counts for dashboards, loaded once. */
export async function loadCounts(): Promise<Record<string, { cards: number; questions: number; labs: number }>> {
  const out: Record<string, { cards: number; questions: number; labs: number }> = {};
  await Promise.all(
    availableSections.map(async (s) => {
      const [cards, questions] = await Promise.all([loadFlashcards(s.id), loadQuiz(s.id)]);
      out[s.id] = { cards: cards.length, questions: questions.length, labs: labCount(s.id) };
    }),
  );
  return out;
}

export function labCount(id: string): number {
  return Object.keys(labModules).filter((p) => p.startsWith(`/content/${id}/labs/`)).length;
}

export async function loadAllLabs(): Promise<WithSection<Lab>[]> {
  const all = await Promise.all(availableSections.map(async (s) => (await loadLabs(s.id)).map((l) => ({ ...l, sectionId: s.id }))));
  return all.flat();
}

export async function loadAllLessons(): Promise<{ sectionId: string; markdown: string }[]> {
  const all = await Promise.all(availableSections.map(async (s) => ({ sectionId: s.id, markdown: (await loadLesson(s.id)) ?? '' })));
  return all;
}
