"""Update PROGRESS.md, the single source of truth for build status.

PROGRESS.md embeds its own data as JSON in an HTML comment at the end of the file; this
script reads that block, applies one change under a lock file (several agents update it
in parallel), and re-renders the human-readable part. Counts of flashcards, questions and
labs are read from content/ at render time.

Usage:
  python tools/progress.py init
  python tools/progress.py section <id> <todo|in-progress|review|done|blocked> [--files a,b] [--issue TEXT] [--clear-issues] [--note TEXT]
  python tools/progress.py milestone <key> <todo|in-progress|done> [--note TEXT]
  python tools/progress.py render
"""
import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROGRESS = ROOT / "PROGRESS.md"
LOCK = ROOT / "PROGRESS.md.lock"
CONTENT = ROOT / "content"
DATA_RE = re.compile(r"<!-- progress-data\n(.*?)\n-->", re.S)

SECTIONS = [
    ("01-getting-started", "Getting Started with AWS", "1-23"),
    ("02-iam", "IAM & AWS CLI", "24-40"),
    ("03-ec2-basics", "EC2 Fundamentals", "41-63"),
    ("04-ec2-purchasing", "EC2 Purchasing Options", "64-77"),
    ("05-ec2-associate", "EC2 Networking & Placement", "78-92"),
    ("06-ec2-storage", "EC2 Instance Storage", "93-117"),
    ("07-elb", "Elastic Load Balancing", "118-150"),
    ("08-asg", "Auto Scaling Groups", "151-159"),
    ("09-rds-aurora-elasticache", "RDS, Aurora & ElastiCache", "160-192"),
    ("10-route53", "Route 53", "193-226"),
    ("11-classic-architectures", "Classic Solutions Architecture", "227-266"),
    ("12-s3-fundamentals", "Amazon S3 Fundamentals", "267-292"),
    ("13-s3-advanced", "Amazon S3 Advanced", "293-312"),
    ("14-s3-security", "Amazon S3 Security", "313-334"),
    ("15-cloudfront-global-accelerator", "CloudFront & Global Accelerator", "335-349"),
    ("16-storage-extras", "AWS Storage Extras", "350-374"),
    ("17-sqs-sns", "Decoupling with SQS & SNS", "375-404"),
    ("18-kinesis-mq", "Streaming with Kinesis & Amazon MQ", "405-413"),
    ("19-containers", "Containers on AWS", "414-437"),
    ("20-lambda", "Serverless & AWS Lambda", "438-465"),
    ("21-dynamodb-apigw-cognito", "DynamoDB, API Gateway, Step Functions & Cognito", "466-490"),
    ("22-serverless-architectures", "Serverless Architectures", "491-512"),
    ("23-databases", "Databases in AWS", "513-526"),
    ("24-data-analytics", "Data & Analytics", "527-559"),
    ("25-machine-learning", "Machine Learning", "560-574"),
    ("26-cloudwatch-eventbridge", "Monitoring with CloudWatch & EventBridge", "575-604"),
    ("27-cloudtrail-config", "Auditing with CloudTrail & Config", "605-618"),
    ("28-advanced-identity", "Advanced Identity", "619-647"),
    ("29-encryption-secrets", "Encryption, Keys & Secrets", "648-681"),
    ("30-threat-protection", "Threat Protection & Detection", "682-696"),
    ("31-vpc-fundamentals", "VPC Fundamentals", "697-728"),
    ("32-vpc-connectivity", "VPC Connectivity & Network Costs", "729-774"),
    ("33-disaster-recovery-migrations", "Disaster Recovery & Migrations", "775-801"),
    ("34-more-architectures", "More Solutions Architecture", "802-823"),
    ("35-other-services", "Other Services", "824-851"),
    ("36-well-architected-exam", "Well-Architected & Exam Preparation", "852-876"),
]

MILESTONES = [
    ("extract", "Extract slide text and renders in batches of 50 (tools/extract_pdf.py)"),
    ("plan", "PLAN.md with sections and slide ranges"),
    ("content-format", "Content format: content/README.md, course.json, services.json, validator"),
    ("design", "UI design on the design canvas"),
    ("app-shell", "App shell: Vite + React + TS, routing, sidebar, theme, layout"),
    ("lesson-page", "Lesson page with Lesson / Flashcards / Quiz / Lab tabs, Mermaid, callouts"),
    ("flashcards", "Spaced-repetition flashcards (Easy / Hard)"),
    ("quiz", "Quiz modes: per section, mixed review"),
    ("exam", "Exam simulation: 65 questions, 130 minutes"),
    ("weak-areas", "Weak areas page"),
    ("home", "Home: knowledge map + progress dashboard"),
    ("search", "Full-text search"),
    ("progress-store", "Progress in localStorage + export/import"),
    ("final-qa", "Final QA: build, browser sweep of every section, totals"),
]


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def acquire_lock() -> None:
    for _ in range(600):
        try:
            fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, str(os.getpid()).encode())
            os.close(fd)
            return
        except FileExistsError:
            try:
                if time.time() - LOCK.stat().st_mtime > 60:
                    LOCK.unlink(missing_ok=True)
                    continue
            except FileNotFoundError:
                continue
            time.sleep(0.1)
    sys.exit("could not acquire PROGRESS.md.lock")


def release_lock() -> None:
    LOCK.unlink(missing_ok=True)


def load() -> dict:
    if not PROGRESS.exists():
        return fresh()
    m = DATA_RE.search(PROGRESS.read_text(encoding="utf-8"))
    if not m:
        sys.exit("PROGRESS.md has no progress-data block; run init only on a missing file")
    data = json.loads(m.group(1))
    # Sections or milestones added to the lists above after init get a todo entry.
    for sid, title, slides in SECTIONS:
        data["sections"].setdefault(sid, {"status": "todo", "files": [], "issues": [], "notes": [], "updated": None})
    for key, _ in MILESTONES:
        data["milestones"].setdefault(key, {"status": "todo", "note": "", "updated": None})
    return data


def fresh() -> dict:
    return {
        "sections": {sid: {"status": "todo", "files": [], "issues": [], "notes": [], "updated": None} for sid, _, _ in SECTIONS},
        "milestones": {key: {"status": "todo", "note": "", "updated": None} for key, _ in MILESTONES},
    }


def counts(sid: str) -> tuple[int, int, int]:
    d = CONTENT / sid
    cards = questions = labs = 0
    try:
        cards = len(json.loads((d / "flashcards.json").read_text(encoding="utf-8"))["cards"])
    except Exception:
        pass
    try:
        questions = len(json.loads((d / "quiz.json").read_text(encoding="utf-8"))["questions"])
    except Exception:
        pass
    if (d / "labs").is_dir():
        labs = len(list((d / "labs").glob("*.md")))
    return cards, questions, labs


def render(data: dict) -> str:
    icon = {"todo": "⬜", "in-progress": "🔄", "review": "🔍", "done": "✅", "blocked": "⛔"}
    secs = data["sections"]
    done = sum(1 for s in secs.values() if s["status"] == "done")
    totals = [0, 0, 0]
    rows = []
    for i, (sid, title, slides) in enumerate(SECTIONS, 1):
        s = secs[sid]
        c = counts(sid)
        totals = [a + b for a, b in zip(totals, c)]
        rows.append(f"| {i} | `{sid}` | {title} | {slides} | {icon.get(s['status'], '')} {s['status']} | {c[0]} | {c[1]} | {c[2]} | {len(s['issues'])} |")
    out = [
        "# PROGRESS",
        "",
        "Single source of truth for build status. Plan: [PLAN.md](PLAN.md).",
        "Update only through `python tools/progress.py ...` (it locks the file and re-renders it).",
        "On a restart: resume at the first section that is not `done`; never redo `done` work.",
        "",
        f"Last update: {now()} · Sections done: **{done}/{len(SECTIONS)}** · "
        f"Flashcards: **{totals[0]}** · Quiz questions: **{totals[1]}** · Labs: **{totals[2]}**",
        "",
        "## Milestones",
        "",
        "| Milestone | Status | Note |",
        "|---|---|---|",
    ]
    for key, label in MILESTONES:
        m = data["milestones"][key]
        out.append(f"| {label} | {icon.get(m['status'], '')} {m['status']} | {m['note']} |")
    out += [
        "",
        "## Sections",
        "",
        "| # | Id | Title | Slides | Status | Cards | Questions | Labs | Open issues |",
        "|---|---|---|---|---|---|---|---|---|",
        *rows,
        "",
        "## Section details",
        "",
    ]
    for sid, title, slides in SECTIONS:
        s = secs[sid]
        out.append(f"### {sid} — {title}")
        out.append(f"- Status: {s['status']}" + (f" (updated {s['updated']})" if s["updated"] else ""))
        out.append("- Files: " + (", ".join(f"`{f}`" for f in s["files"]) if s["files"] else "none yet"))
        if s["issues"]:
            out.append("- Open issues:")
            out += [f"  - {x}" for x in s["issues"]]
        else:
            out.append("- Open issues: none")
        if s["notes"]:
            out.append("- Notes:")
            out += [f"  - {x}" for x in s["notes"]]
        out.append("")
    out.append("<!-- progress-data\n" + json.dumps(data, indent=1, ensure_ascii=False) + "\n-->")
    return "\n".join(out) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init")
    sub.add_parser("render")
    sp = sub.add_parser("section")
    sp.add_argument("id")
    sp.add_argument("status", choices=["todo", "in-progress", "review", "done", "blocked"])
    sp.add_argument("--files", default=None, help="comma-separated paths; replaces the list")
    sp.add_argument("--issue", action="append", default=[])
    sp.add_argument("--clear-issues", action="store_true")
    sp.add_argument("--note", action="append", default=[])
    mp = sub.add_parser("milestone")
    mp.add_argument("key")
    mp.add_argument("status", choices=["todo", "in-progress", "done"])
    mp.add_argument("--note", default=None)
    args = ap.parse_args()

    acquire_lock()
    try:
        if args.cmd == "init":
            if PROGRESS.exists():
                sys.exit("PROGRESS.md already exists")
            data = fresh()
        else:
            data = load()
        if args.cmd == "section":
            if args.id not in data["sections"]:
                sys.exit(f"unknown section {args.id}")
            s = data["sections"][args.id]
            s["status"] = args.status
            s["updated"] = now()
            if args.files is not None:
                s["files"] = [f.strip() for f in args.files.split(",") if f.strip()]
            if args.clear_issues:
                s["issues"] = []
            s["issues"] += args.issue
            s["notes"] += args.note
        elif args.cmd == "milestone":
            if args.key not in data["milestones"]:
                sys.exit(f"unknown milestone {args.key}")
            m = data["milestones"][args.key]
            m["status"] = args.status
            m["updated"] = now()
            if args.note is not None:
                m["note"] = args.note
        tmp = PROGRESS.with_suffix(".md.tmp")
        tmp.write_text(render(data), encoding="utf-8")
        os.replace(tmp, PROGRESS)
    finally:
        release_lock()


if __name__ == "__main__":
    main()
