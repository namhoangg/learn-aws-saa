"""Extract slide text and page renders from the course PDF in batches of 50 pages.

Outputs (all under _extract/, which is local-only working data):
  text/slides_NNNN-MMMM.md   text of each slide in the batch, with "=== Slide N ===" headers
  pages/pNNNN.jpg            a render of each slide, for reading diagrams
  index.json                 per-slide title guess, word count and image count
"""
import json
import re
import sys
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent
PDF = ROOT / "AWS Certified Solutions Architect Slides v48.pdf"
OUT = ROOT / "_extract"
BATCH = 50

# Every slide carries this footer/watermark; it is noise for study notes.
NOISE = [
    re.compile(r"^\W*Stephane Maarek\s*$"),
    re.compile(r"^NOT FOR DISTRIBUTION.*$"),
]


def clean(text: str) -> list[str]:
    lines = []
    for raw in text.splitlines():
        line = raw.replace("", "-").replace("•", "-").strip()
        if not line or any(p.match(line) for p in NOISE):
            continue
        lines.append(line)
    return lines


def main() -> None:
    (OUT / "text").mkdir(parents=True, exist_ok=True)
    (OUT / "pages").mkdir(parents=True, exist_ok=True)
    render = "--no-render" not in sys.argv
    with pymupdf.open(PDF) as probe:
        total = probe.page_count
    index = []
    for start in range(0, total, BATCH):
        end = min(start + BATCH, total)
        chunks = []
        # Re-open per batch so only one batch of pages is ever held in memory.
        with pymupdf.open(PDF) as doc:
            for i in range(start, end):
                page = doc[i]
                n = i + 1
                lines = clean(page.get_text("text"))
                chunks.append(f"=== Slide {n} ===\n" + "\n".join(lines) + "\n")
                index.append({
                    "slide": n,
                    "title": lines[0] if lines else "",
                    "words": sum(len(l.split()) for l in lines),
                    "images": len(page.get_images(full=False)),
                })
                if render:
                    pix = page.get_pixmap(matrix=pymupdf.Matrix(1.0, 1.0))
                    (OUT / "pages" / f"p{n:04d}.jpg").write_bytes(pix.tobytes("jpeg", jpg_quality=70))
        name = f"slides_{start + 1:04d}-{end:04d}.md"
        (OUT / "text" / name).write_text("\n".join(chunks), encoding="utf-8")
        print(f"batch {name} done", flush=True)
    (OUT / "index.json").write_text(json.dumps(index, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"{total} slides extracted")


if __name__ == "__main__":
    main()
