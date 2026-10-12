"""Flag text in content/<section> that copies the slides word for word.

Compares every run of N consecutive words (default 10) in a section's lesson, flashcards,
quiz and labs with the extracted slide text for that section's slide range, and prints
each overlapping span. Exit code 1 when any span is found.

Usage:
  python tools/check_verbatim.py                 all sections that exist
  python tools/check_verbatim.py 07-elb 08-asg   only these
  python tools/check_verbatim.py --n 8 07-elb    stricter window
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
TEXT = ROOT / "_extract" / "text"
SLIDE_RE = re.compile(r"^=== Slide (\d+) ===$", re.M)


def norm_words(text: str) -> list[str]:
    text = text.lower().replace("’", "'").replace("–", "-").replace("—", "-")
    return re.findall(r"[a-z0-9][a-z0-9'./:-]*", text)


def slide_texts() -> dict[int, str]:
    out: dict[int, str] = {}
    for f in sorted(TEXT.glob("slides_*.md")):
        raw = f.read_text(encoding="utf-8")
        parts = SLIDE_RE.split(raw)
        for i in range(1, len(parts), 2):
            out[int(parts[i])] = parts[i + 1]
    return out


def content_text(d: Path) -> list[tuple[str, str]]:
    items: list[tuple[str, str]] = []
    if (d / "lesson.md").exists():
        md = (d / "lesson.md").read_text(encoding="utf-8")
        items.append(("lesson.md", re.sub(r"```mermaid[\s\S]*?```", "", md)))
    if (d / "flashcards.json").exists():
        for c in json.loads((d / "flashcards.json").read_text(encoding="utf-8")).get("cards", []):
            items.append((f"flashcards {c.get('id')}", f"{c.get('front', '')}\n{c.get('back', '')}"))
    if (d / "quiz.json").exists():
        for q in json.loads((d / "quiz.json").read_text(encoding="utf-8")).get("questions", []):
            parts = [q.get("question", ""), q.get("explanation", "")]
            for o in q.get("options", []):
                parts += [o.get("text", ""), o.get("explanation", "")]
            items.append((f"quiz {q.get('id')}", "\n".join(parts)))
    for lab in sorted((d / "labs").glob("*.md")) if (d / "labs").is_dir() else []:
        items.append((f"labs/{lab.name}", lab.read_text(encoding="utf-8")))
    return items


def check(section: str, slides: dict[int, str], n: int) -> int:
    d = CONTENT / section
    meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
    first, last = meta["slides"]
    source = norm_words("\n".join(slides.get(i, "") for i in range(first, last + 1)))
    grams = {tuple(source[i:i + n]) for i in range(len(source) - n + 1)}
    hits = 0
    for name, text in content_text(d):
        w = norm_words(text)
        i = 0
        while i <= len(w) - n:
            if tuple(w[i:i + n]) in grams:
                j = i + n
                while j < len(w) and tuple(w[j - n + 1:j + 1]) in grams:
                    j += 1
                print(f"  {section} {name}: \"{' '.join(w[i:j])}\" ({j - i} words)")
                hits += 1
                i = j
            else:
                i += 1
    return hits


def main() -> None:
    args = sys.argv[1:]
    n = 10
    if "--n" in args:
        k = args.index("--n")
        n = int(args[k + 1])
        del args[k:k + 2]
    sections = args or sorted(p.name for p in CONTENT.iterdir() if p.is_dir() and re.match(r"\d{2}-", p.name) and (p / "meta.json").exists())
    slides = slide_texts()
    total = 0
    for s in sections:
        hits = check(s, slides, n)
        print(f"{'FLAG' if hits else 'ok  '} {s}: {hits} span(s) of {n}+ words shared with the slides")
        total += hits
    sys.exit(1 if total else 0)


if __name__ == "__main__":
    main()
