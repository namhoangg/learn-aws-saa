// Collects every "Needs verification" item in the content so it can be listed and reviewed.
import { loadAllFlashcards, loadAllLabs, loadAllLessons, loadAllQuestions } from '../content/load';

export interface VerifyItem {
  sectionId: string;
  where: string;
  text: string;
  path: string;
}

function fromMarkdown(md: string, sectionId: string, where: string, path: string): VerifyItem[] {
  const out: VerifyItem[] = [];
  const body = md.replace(/```[\s\S]*?```/g, '');
  const lines = body.split('\n');
  lines.forEach((line, i) => {
    if (/^>\s*\[!VERIFY\]/i.test(line)) {
      const parts = [line.replace(/^>\s*\[!VERIFY\]\s*/i, '')];
      for (let j = i + 1; j < lines.length && lines[j].startsWith('>'); j++) parts.push(lines[j].replace(/^>\s?/, ''));
      out.push({ sectionId, where, text: parts.join(' ').replace(/\s+/g, ' ').trim(), path });
    }
  });
  for (const m of body.matchAll(/\{\{\s*verify\s*:\s*([^}]+)\}\}/gi)) out.push({ sectionId, where, text: m[1].trim(), path });
  return out;
}

let cache: Promise<VerifyItem[]> | null = null;

export function collectVerify(): Promise<VerifyItem[]> {
  cache ??= Promise.all([loadAllLessons(), loadAllLabs(), loadAllFlashcards(), loadAllQuestions()]).then(([lessons, labs, cards, questions]) => [
    ...lessons.flatMap((l) => fromMarkdown(l.markdown, l.sectionId, 'Lesson', `/section/${l.sectionId}`)),
    ...labs.flatMap((l) => fromMarkdown(l.body, l.sectionId, `Lab: ${l.title}`, `/section/${l.sectionId}/lab?lab=${encodeURIComponent(l.id)}`)),
    ...cards.filter((c) => c.verify).map((c) => ({ sectionId: c.sectionId, where: 'Flashcard', text: c.verify!, path: `/section/${c.sectionId}/flashcards?card=${encodeURIComponent(c.id)}` })),
    ...questions.filter((q) => q.verify).map((q) => ({ sectionId: q.sectionId, where: 'Quiz question', text: q.verify!, path: `/section/${q.sectionId}/quiz?q=${encodeURIComponent(q.id)}` })),
  ]);
  return cache;
}
