"""Fold services that sections declared in meta.json "newServices" into content/services.json.

The site already merges them at runtime; this keeps the catalog file complete for editing.
Each merged service is removed from the section's newServices list.

Usage: python tools/merge_new_services.py [--dry-run]
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"


def main() -> None:
    dry = "--dry-run" in sys.argv
    catalog_path = CONTENT / "services.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    known = {s["id"] for s in catalog["services"]}
    added = []
    for meta_path in sorted(CONTENT.glob("*/meta.json")):
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        new = meta.get("newServices") or []
        if not new:
            continue
        for s in new:
            if s["id"] not in known:
                catalog["services"].append({
                    "id": s["id"],
                    "name": s["name"],
                    "category": s["category"],
                    "core": bool(s.get("core", False)),
                    "summary": s["summary"],
                })
                known.add(s["id"])
                added.append(f"{s['id']} (from {meta['id']})")
        meta["newServices"] = []
        if not dry:
            meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    if not dry:
        catalog_path.write_text(json.dumps(catalog, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{'would add' if dry else 'added'} {len(added)} services:")
    for a in added:
        print(f"  {a}")


if __name__ == "__main__":
    main()
