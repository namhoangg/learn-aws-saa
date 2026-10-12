// Quality gate for content/. Checks every rule in content/README.md.
//
// Usage:
//   node tools/validate_content.mjs                 validate every section folder that exists
//   node tools/validate_content.mjs 07-elb 08-asg   validate only these sections
//   node tools/validate_content.mjs --list-verify   also print every "Needs verification" item
//   node tools/validate_content.mjs --json          machine-readable summary
// Exit code 1 when any error is found; warnings never fail.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { JSDOM } from 'jsdom';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = join(ROOT, 'content');

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const only = args.filter((a) => !a.startsWith('--'));

// Mermaid needs a DOM even to parse.
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
});
const { default: mermaid } = await import('mermaid');
mermaid.initialize({ startOnLoad: false });

const CALLOUTS = new Set(['EXAM', 'TRAP', 'TIP', 'NOTE', 'EXAMPLE', 'WARNING', 'UPDATED', 'VERIFY', 'CHECK', 'COST']);
const DOMAINS = new Set(['secure', 'resilient', 'performant', 'cost']);
const DIFFICULTY = new Set(['easy', 'medium', 'hard']);
const CATEGORIES = new Set(['compute', 'storage', 'database', 'networking', 'security', 'integration', 'analytics', 'ml', 'management', 'migration']);
const LESSON_HEADINGS = ['Summary', 'Key concepts', 'Exam tips', 'Common traps'];
const LAB_HEADINGS = ['Prerequisites', 'Steps', 'Cleanup', 'Progress checklist'];

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const words = (s) => (s || '').trim().split(/\s+/).filter(Boolean).length;

const course = readJson(join(CONTENT, 'course.json'));
const catalog = readJson(join(CONTENT, 'services.json')).services;
const serviceIds = new Set(catalog.map((s) => s.id));
const courseSections = course.parts.flatMap((p) => p.sections);

const report = { sections: {}, errors: 0, warnings: 0, verify: [], updated: 0, totals: { cards: 0, questions: 0, labs: 0, diagrams: 0 } };

function sectionReport(id) {
  report.sections[id] ??= { errors: [], warnings: [] };
  return report.sections[id];
}
const err = (id, msg) => { sectionReport(id).errors.push(msg); report.errors++; };
const warn = (id, msg) => { sectionReport(id).warnings.push(msg); report.warnings++; };

// Global checks
{
  const seen = new Set();
  for (const s of catalog) {
    if (seen.has(s.id)) err('_catalog', `duplicate service id ${s.id}`);
    seen.add(s.id);
    if (!CATEGORIES.has(s.category)) err('_catalog', `service ${s.id} has unknown category ${s.category}`);
    if (!s.name || !s.summary) err('_catalog', `service ${s.id} needs name and summary`);
  }
  if (new Set(courseSections).size !== courseSections.length) err('_course', 'a section id appears twice in course.json');
}

function stripFences(md) {
  // Remove fenced code blocks so markers inside code are not counted.
  return md.replace(/```[\s\S]*?```/g, '');
}

function mermaidBlocks(md) {
  const out = [];
  const re = /```mermaid\s*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(md))) out.push(m[1]);
  return out;
}

async function checkMermaid(id, file, md) {
  const blocks = mermaidBlocks(md);
  for (const [i, src] of blocks.entries()) {
    try {
      await mermaid.parse(src);
    } catch (e) {
      err(id, `${file}: mermaid diagram #${i + 1} does not parse: ${String(e?.message || e).split('\n').slice(0, 3).join(' ')}`);
    }
    if (!/^\s*%%\s*caption:/m.test(src)) warn(id, `${file}: mermaid diagram #${i + 1} has no "%% caption:" line`);
  }
  return blocks.length;
}

function checkCallouts(id, file, md) {
  const body = stripFences(md);
  const re = /^>\s*\[!([A-Za-z]+)\](.*)$/gm;
  let m;
  const found = [];
  while ((m = re.exec(body))) {
    const type = m[1].toUpperCase();
    if (!CALLOUTS.has(type)) err(id, `${file}: unknown callout type [!${m[1]}]`);
    found.push(type);
    if (type === 'VERIFY') report.verify.push({ section: id, file, text: calloutText(body, m.index) });
    if (type === 'UPDATED') report.updated++;
  }
  const inline = /\{\{\s*(\w+)\s*:\s*([^}]*)\}\}/g;
  while ((m = inline.exec(body))) {
    const kind = m[1].toLowerCase();
    if (kind !== 'updated' && kind !== 'verify') err(id, `${file}: unknown inline marker {{${m[1]}: ...}}`);
    if (!m[2].trim()) err(id, `${file}: inline marker {{${m[1]}:}} needs a note`);
    if (kind === 'verify') report.verify.push({ section: id, file, text: m[2].trim() });
    if (kind === 'updated') report.updated++;
  }
  if (/\{\{(?![^}]*\}\})/.test(body)) warn(id, `${file}: unclosed "{{" marker`);
  return found;
}

function calloutText(body, index) {
  const lines = body.slice(index).split('\n');
  const out = [];
  for (const line of lines) {
    if (!line.startsWith('>')) break;
    out.push(line.replace(/^>\s?/, '').replace(/^\[![A-Za-z]+\]\s*/, ''));
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

function headings(md, level) {
  const body = stripFences(md);
  const re = new RegExp(`^${'#'.repeat(level)}\\s+(.+?)\\s*$`, 'gm');
  const out = [];
  let m;
  while ((m = re.exec(body))) out.push({ text: m[1], index: m.index });
  return out;
}

function sectionBody(md, title) {
  const body = stripFences(md);
  const hs = headings(md, 2);
  const i = hs.findIndex((h) => h.text.toLowerCase() === title.toLowerCase());
  if (i < 0) return null;
  const start = hs[i].index;
  const end = i + 1 < hs.length ? hs[i + 1].index : body.length;
  return body.slice(start, end).replace(/^##[^\n]*\n/, '');
}

function checkMeta(id, dir) {
  const p = join(dir, 'meta.json');
  if (!existsSync(p)) return err(id, 'meta.json missing'), null;
  let meta;
  try { meta = readJson(p); } catch (e) { return err(id, `meta.json is not valid JSON: ${e.message}`), null; }
  for (const k of ['id', 'order', 'title', 'courseSection', 'slides', 'estimatedMinutes', 'summary', 'services', 'relations', 'examDomains', 'lastVerified', 'sources']) {
    if (meta[k] === undefined) err(id, `meta.json missing "${k}"`);
  }
  if (meta.id !== id) err(id, `meta.json id "${meta.id}" does not match folder`);
  const order = courseSections.indexOf(id) + 1;
  if (meta.order !== order) err(id, `meta.json order ${meta.order} should be ${order}`);
  if (!Array.isArray(meta.slides) || meta.slides.length !== 2 || !meta.slides.every(Number.isInteger)) err(id, 'meta.json slides must be [first, last]');
  const local = new Set((meta.newServices || []).map((s) => s.id));
  for (const s of meta.newServices || []) {
    if (serviceIds.has(s.id)) warn(id, `newServices: ${s.id} already exists in services.json`);
    if (!CATEGORIES.has(s.category)) err(id, `newServices: ${s.id} has unknown category ${s.category}`);
    if (!s.name || !s.summary) err(id, `newServices: ${s.id} needs name and summary`);
  }
  const known = (sid) => serviceIds.has(sid) || local.has(sid);
  for (const s of meta.services || []) if (!known(s)) err(id, `meta.json services: unknown service id "${s}"`);
  const rel = meta.relations || [];
  if (rel.length < 3 || rel.length > 15) warn(id, `meta.json has ${rel.length} relations (expected 3-15)`);
  for (const r of rel) {
    if (!known(r.from)) err(id, `relation from unknown service "${r.from}"`);
    if (!known(r.to)) err(id, `relation to unknown service "${r.to}"`);
    if (!r.label) err(id, `relation ${r.from}->${r.to} needs a label`);
  }
  for (const d of meta.examDomains || []) if (!DOMAINS.has(d)) err(id, `meta.json examDomains: unknown "${d}"`);
  const sources = meta.sources || [];
  if (!sources.length) err(id, 'meta.json sources is empty: list the AWS docs pages you checked');
  for (const s of sources) if (!s.title || !/^https:\/\//.test(s.url || '')) err(id, `meta.json source needs title and https url: ${JSON.stringify(s)}`);
  if (sources.length && !sources.some((s) => /docs\.aws\.amazon\.com/.test(s.url))) warn(id, 'no source on docs.aws.amazon.com');
  if (words(meta.summary) > 80) warn(id, 'meta.json summary is long (> 80 words)');
  return meta;
}

async function checkLesson(id, dir) {
  const p = join(dir, 'lesson.md');
  if (!existsSync(p)) return err(id, 'lesson.md missing');
  const md = readFileSync(p, 'utf8');
  const h2 = headings(md, 2).map((h) => h.text);
  let last = -1;
  for (const want of LESSON_HEADINGS) {
    const i = h2.findIndex((t) => t.toLowerCase() === want.toLowerCase());
    if (i < 0) err(id, `lesson.md missing "## ${want}"`);
    else if (i < last) err(id, `lesson.md "## ${want}" is out of order`);
    else last = i;
  }
  const kc = h2.findIndex((t) => t.toLowerCase() === 'key concepts');
  const et = h2.findIndex((t) => t.toLowerCase() === 'exam tips');
  if (kc >= 0 && et >= 0 && et - kc < 2) err(id, 'lesson.md needs topic sections between "Key concepts" and "Exam tips"');
  for (const t of ['Exam tips', 'Common traps', 'Summary', 'Key concepts']) {
    const b = sectionBody(md, t);
    if (b !== null && words(b) < 15) err(id, `lesson.md "## ${t}" is nearly empty`);
  }
  const diagrams = await checkMermaid(id, 'lesson.md', md);
  report.totals.diagrams += diagrams;
  if (diagrams < 2) err(id, `lesson.md has ${diagrams} mermaid diagrams (need at least 2)`);
  if (!/^\|.*\|\s*\n\|\s*:?-{3,}/m.test(stripFences(md))) warn(id, 'lesson.md has no comparison table');
  const types = checkCallouts(id, 'lesson.md', md);
  for (const bad of ['CHECK', 'COST']) if (types.includes(bad)) warn(id, `lesson.md uses lab-only callout [!${bad}]`);
  if (words(stripFences(md)) < 600) warn(id, `lesson.md is short (${words(stripFences(md))} words)`);
}

function checkFlashcards(id, dir) {
  const p = join(dir, 'flashcards.json');
  if (!existsSync(p)) return err(id, 'flashcards.json missing');
  let data;
  try { data = readJson(p); } catch (e) { return err(id, `flashcards.json is not valid JSON: ${e.message}`); }
  if (data.section !== id) err(id, 'flashcards.json "section" does not match folder');
  const cards = data.cards || [];
  report.totals.cards += cards.length;
  if (cards.length < 10 || cards.length > 30) err(id, `flashcards.json has ${cards.length} cards (need 10-30)`);
  const ids = new Set();
  for (const c of cards) {
    if (!new RegExp(`^${id}-fc-\\d{2,3}$`).test(c.id || '')) err(id, `flashcard id "${c.id}" should look like ${id}-fc-01`);
    if (ids.has(c.id)) err(id, `duplicate flashcard id ${c.id}`);
    ids.add(c.id);
    if (!c.front?.trim() || !c.back?.trim()) err(id, `flashcard ${c.id} needs front and back`);
    if (words(c.back) > 90) warn(id, `flashcard ${c.id} back is long (${words(c.back)} words)`);
    if (c.verify) report.verify.push({ section: id, file: 'flashcards.json', text: `${c.id}: ${c.verify}` });
    if (c.updated) report.updated++;
  }
}

function checkQuiz(id, dir) {
  const p = join(dir, 'quiz.json');
  if (!existsSync(p)) return err(id, 'quiz.json missing');
  let data;
  try { data = readJson(p); } catch (e) { return err(id, `quiz.json is not valid JSON: ${e.message}`); }
  if (data.section !== id) err(id, 'quiz.json "section" does not match folder');
  const qs = data.questions || [];
  report.totals.questions += qs.length;
  if (qs.length < 5 || qs.length > 15) err(id, `quiz.json has ${qs.length} questions (need 5-15)`);
  const ids = new Set();
  const letters = {};
  let multi = 0;
  for (const q of qs) {
    const tag = q.id || '(no id)';
    if (!new RegExp(`^${id}-q\\d{2,3}$`).test(q.id || '')) err(id, `question id "${q.id}" should look like ${id}-q01`);
    if (ids.has(q.id)) err(id, `duplicate question id ${q.id}`);
    ids.add(q.id);
    if (!q.question?.trim()) err(id, `${tag}: empty question`);
    if (!DOMAINS.has(q.domain)) err(id, `${tag}: domain must be one of ${[...DOMAINS].join(', ')}`);
    if (!DIFFICULTY.has(q.difficulty)) err(id, `${tag}: difficulty must be easy, medium or hard`);
    if (!q.explanation?.trim()) err(id, `${tag}: missing question-level explanation`);
    const opts = q.options || [];
    const optIds = opts.map((o) => o.id);
    const expected = 'ABCDEF'.slice(0, opts.length).split('');
    if (optIds.join('') !== expected.join('')) err(id, `${tag}: option ids must be ${expected.join(', ')} in order`);
    for (const o of opts) {
      if (!o.text?.trim()) err(id, `${tag}: option ${o.id} has no text`);
      if (typeof o.correct !== 'boolean') err(id, `${tag}: option ${o.id} needs "correct": true/false`);
      if (words(o.explanation) < 6) err(id, `${tag}: option ${o.id} needs an explanation of why it is right or wrong`);
    }
    const correct = opts.filter((o) => o.correct === true);
    if (q.type === 'single') {
      if (opts.length !== 4) err(id, `${tag}: single-answer questions need exactly 4 options`);
      if (correct.length !== 1) err(id, `${tag}: single-answer question has ${correct.length} correct options (need exactly 1)`);
      if (/\(Select (TWO|THREE)\.?\)/i.test(q.question)) err(id, `${tag}: says "Select TWO/THREE" but type is single`);
      if (correct[0]) letters[correct[0].id] = (letters[correct[0].id] || 0) + 1;
    } else if (q.type === 'multi') {
      multi++;
      const ok2 = opts.length === 5 && correct.length === 2 && /\(Select TWO\.\)\s*$/.test(q.question.trim());
      const ok3 = opts.length === 6 && correct.length === 3 && /\(Select THREE\.\)\s*$/.test(q.question.trim());
      if (!ok2 && !ok3) err(id, `${tag}: multi questions need 5 options/2 correct ending "(Select TWO.)" or 6 options/3 correct ending "(Select THREE.)" (has ${opts.length} options, ${correct.length} correct)`);
    } else {
      err(id, `${tag}: type must be "single" or "multi"`);
    }
    if (q.verify) report.verify.push({ section: id, file: 'quiz.json', text: `${q.id}: ${q.verify}` });
    if (q.updated) report.updated++;
  }
  if (qs.length && multi > Math.ceil(qs.length / 3)) warn(id, `${multi} of ${qs.length} questions are multi-select (keep it to about a third)`);
  const singles = qs.filter((q) => q.type === 'single').length;
  for (const [l, n] of Object.entries(letters)) if (singles >= 5 && n / singles > 0.5) warn(id, `correct answer is "${l}" in ${n} of ${singles} single-answer questions`);
}

async function checkLabs(id, dir) {
  const labsDir = join(dir, 'labs');
  if (!existsSync(labsDir)) return 0;
  const files = readdirSync(labsDir).filter((f) => f.endsWith('.md'));
  const ids = new Set();
  for (const f of files) {
    const rel = `labs/${f}`;
    if (!/^\d{2}-[a-z0-9-]+\.md$/.test(f)) err(id, `${rel}: name labs like 01-short-slug.md`);
    const raw = readFileSync(join(labsDir, f), 'utf8');
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!m) { err(id, `${rel}: missing YAML front matter`); continue; }
    let fm;
    try { fm = parseYaml(m[1]); } catch (e) { err(id, `${rel}: front matter is not valid YAML: ${e.message}`); continue; }
    const body = m[2];
    for (const k of ['id', 'title', 'objective', 'estimatedTime', 'cost', 'freeTier', 'services']) if (fm[k] === undefined || fm[k] === '') err(id, `${rel}: front matter missing "${k}"`);
    if (fm.id && !new RegExp(`^${id}-lab-\\d{2}$`).test(fm.id)) err(id, `${rel}: id should look like ${id}-lab-01`);
    if (ids.has(fm.id)) err(id, `${rel}: duplicate lab id ${fm.id}`);
    ids.add(fm.id);
    if (!['yes', 'partial', 'no'].includes(fm.freeTier)) err(id, `${rel}: freeTier must be yes, partial or no`);
    for (const s of fm.services || []) if (!serviceIds.has(s)) warn(id, `${rel}: unknown service id "${s}"`);
    const h2 = headings(body, 2).map((h) => h.text);
    let last = -1;
    for (const want of LAB_HEADINGS) {
      const i = h2.findIndex((t) => t.toLowerCase() === want.toLowerCase());
      if (i < 0) err(id, `${rel}: missing "## ${want}"`);
      else if (i < last) err(id, `${rel}: "## ${want}" is out of order`);
      else last = i;
    }
    const cleanup = sectionBody(body, 'Cleanup');
    if (cleanup !== null && !/^\s*[-*]\s+\[ \]\s+\S/m.test(cleanup)) err(id, `${rel}: "## Cleanup" needs a task list (- [ ] ...) of every resource to delete`);
    const checklist = sectionBody(body, 'Progress checklist');
    if (checklist !== null && (checklist.match(/^\s*[-*]\s+\[ \]\s+\S/gm) || []).length < 2) err(id, `${rel}: "## Progress checklist" needs task items`);
    const steps = headings(body, 3).filter((h) => /^Step \d+/i.test(h.text));
    if (steps.length < 2) err(id, `${rel}: needs "### Step N: ..." headings (found ${steps.length})`);
    const types = checkCallouts(id, rel, body);
    if (fm.freeTier !== 'yes' && !types.includes('COST')) err(id, `${rel}: freeTier is "${fm.freeTier}", add a > [!COST] callout explaining what is billed`);
    if (!types.includes('CHECK')) warn(id, `${rel}: no > [!CHECK] callouts (what to observe after key steps)`);
    const opens = (stripFences(body).match(/^:::(console|cli)\s*$/gm) || []).length;
    const closes = (stripFences(body).match(/^:::\s*$/gm) || []).length;
    if (opens !== closes) err(id, `${rel}: ${opens} ":::console/:::cli" openings but ${closes} ":::" closings`);
    if (!/:::cli/.test(body) && !/```(bash|sh|shell)/.test(body)) warn(id, `${rel}: no AWS CLI equivalent`);
    await checkMermaid(id, rel, body);
  }
  report.totals.labs += files.length;
  return files.length;
}

const existing = readdirSync(CONTENT).filter((d) => statSync(join(CONTENT, d)).isDirectory() && /^\d{2}-/.test(d));
for (const d of existing) if (!courseSections.includes(d)) err(d, 'folder is not listed in course.json');
const targets = only.length ? only : existing;

for (const id of targets) {
  const dir = join(CONTENT, id);
  sectionReport(id);
  if (!existsSync(dir)) { err(id, 'section folder does not exist'); continue; }
  checkMeta(id, dir);
  await checkLesson(id, dir);
  checkFlashcards(id, dir);
  checkQuiz(id, dir);
  await checkLabs(id, dir);
}

if (flags.has('--json')) {
  console.log(JSON.stringify(report, null, 1));
} else {
  for (const [id, r] of Object.entries(report.sections)) {
    const status = r.errors.length ? 'FAIL' : 'ok  ';
    console.log(`${status} ${id}${r.warnings.length ? ` (${r.warnings.length} warnings)` : ''}`);
    for (const e of r.errors) console.log(`   ERROR  ${e}`);
    for (const w of r.warnings) console.log(`   warn   ${w}`);
  }
  const t = report.totals;
  console.log(`\n${targets.length} sections checked: ${report.errors} errors, ${report.warnings} warnings`);
  console.log(`cards ${t.cards} · questions ${t.questions} · labs ${t.labs} · diagrams ${t.diagrams} · updated markers ${report.updated} · needs-verification ${report.verify.length}`);
  if (flags.has('--list-verify')) {
    console.log('\nNeeds verification:');
    for (const v of report.verify) console.log(`- [${v.section}] ${v.file}: ${v.text}`);
  }
}
process.exit(report.errors ? 1 : 0);
