# Build summary: SAA-C03 study site

Finished 2026-10-04. All 36 sections in [PLAN.md](PLAN.md) are `done` in [PROGRESS.md](PROGRESS.md).
Run `npm install` then `npm run dev` and open http://localhost:5173.

## Totals

| What | Count |
|---|---|
| Sections (lessons) | 36, covering all 876 slides |
| Flashcards | 1,060 |
| Quiz questions | 529 (434 single-answer, 95 multi-select, every option explained) |
| Hands-on labs | 96: 25 Free Tier, 68 partly billed, 3 not Free Tier (each with a cost warning and a cleanup checklist) |
| Mermaid diagrams | 226 (209 in lessons, the rest in labs) |
| "Updated" markers (content newer than the slides) | 598 |
| "Needs verification" markers | 18, down from 50 after the fact-check pass below (also on the site at Settings → Needs verification) |
| Services in the knowledge-map catalog | 210 |

## Quality gates (all 36 sections)

- `node tools/validate_content.mjs`: 0 errors, 0 warnings (structure, exactly-one-correct quiz keys or marked multi-select, lab cleanup + checklist present, every Mermaid diagram parses).
- `python tools/check_verbatim.py`: 0 runs of 10+ words shared with the slides.
- `npm run build`: passes.
- In-app render check (`/check`): 36 sections, 226 diagrams, 0 problems.
- Every section was written by one agent and then reviewed by a second, independent agent that re-answered every quiz question, checked facts on docs.aws.amazon.com and fixed what it found.

## App code review

Two independent reviewers (rendering pipeline, UI and accessibility) reported 21 findings. All 21 were confirmed and fixed, then re-checked in the browser. The main ones:

- The Copy button stripped `#!/bin/bash`, which would have broken about 12 user-data labs.
- Hidden duplicate checkboxes blocked ticks in 6 cleanup lists.
- Lab and exam pages overflowed on phones.
- Keyboard shortcuts died once a quiz radio had focus.
- The drawer, dialogs and search palette did not trap or restore focus.
- Radio groups had no arrow keys, and the map had no single Tab stop.

The third reviewer (logic) hit the usage limit, so I reviewed scoring, the timer, the SRS and the weak-area rules myself; I only found and removed dead code.

The Cursor review was skipped because this folder is not a git repository, so there is no base to diff against.

## Differences from the design spec (deliberate)

- Below 1024px the sidebar becomes a drawer; the spec's 72px tablet rail with flyouts was not built.
- Callouts use GitHub-alert syntax (`> [!EXAM]`), not the spec's `:::` directives, so lesson files still read well in any Markdown viewer.
- Lab steps are always expanded cards, not collapsible.
- Weak areas list a question after one miss until it is answered right twice in a row (the spec said two misses), so single mistakes are not lost.
- Progress is stored in browser localStorage, with export and import on the Settings page; no backend or SQLite was needed.
- Slide images were extracted only so the agents could read the diagrams. The site uses original Mermaid diagrams and never shows slide images.

## Fact-check pass on the "Needs verification" items (2026-10-04)

The 50 open items went through two independent checks:

1. **Cursor** (GPT-5.6 Terra Extra High, headless `cursor-agent` with web search) researched each item on
   AWS sources and returned a verdict with the page and a short quote: 22 confirmed, 22 corrected,
   6 unresolvable.
2. **Claude agents** re-opened every cited page and only then edited content. They accepted 28 verdicts,
   accepted 20 partly and rejected 2.

Result: **32 resolved** (18 confirmed and the marker removed, 14 corrected and rewritten with an
"Updated" note and source), **18 kept** with a rewritten note saying what was checked and what to do.
Other places in each section that repeated a corrected claim (quiz options, flashcards, lab prerequisites
and cost notes) were fixed too. Examples of corrections:

- Kinesis Data Streams and Data Firehose labs now say a paid plan is needed on new-style accounts.
- Snowmobile's shutdown date is now the official 14 March 2024.
- The flat "Aurora costs 20% more" claim was replaced with actual us-east-1 price ratios.
- ElastiCache Memcached is now stated to have no built-in authentication (the slides' SASL claim is gone).
- The EFS lab now turns automatic backups off the documented way.

Gates after the pass: validator 0 errors / 0 warnings, verbatim 0 spans, build passes, render check
36 sections / 226 diagrams / 0 problems.

## Needs verification (18 items still open)

Each note on the site links the AWS pages that were checked. They stay open for one of three reasons.

**AWS's own pages contradict each other** (the lesson follows the newest source and names the conflict):

- t8i.micro / t8i.small Free Tier eligibility (03, lesson and flashcard fc-15)
- Route 53 calculated health check: 255 or 256 child checks (10)
- SCP Allow statements with resource ARNs (28)
- Amazon Inspector's default EC2 scan mode for new accounts (30)
- Whether Macie's 1 GB monthly free tier covers discovery jobs (30)
- Which capacity mode the DynamoDB console's "Default settings" use (21 lab 1)
- Auto Scaling group wizard page titles (08 lab 1)

**Console labels and details AWS does not document**:

- Monthly cost budget template default thresholds (01 lab 2)
- Beanstalk `LoadBalancerType` on a single-instance environment, CLI path (11 lab 1)
- CloudFront create-distribution wizard: pay-as-you-go choice and WAF opt-out wording (15 lab 1, 2 items)
- Amazon MQ public-access label in the create-broker wizard (18 lab 3)
- DocumentDB "Connect to cluster" security groups and their cleanup (23 lab 2)
- Admin rights for a Redshift Serverless namespace created with the CLI (24 lab 3)

**Free plan entitlements not stated publicly** (accounts created on or after 15 July 2025):

- Kinesis Data Streams and Firehose from the standard sign-up (18 labs 1 and 2; new-style sign-up accounts are confirmed to need the paid plan)
- Elastic Disaster Recovery (33 lab 3)

These can only be settled in the AWS console of your own account. The exact wording of each item is in
the content files (search for `[!VERIFY]` or `{{verify:`) and in
`node tools/validate_content.mjs --list-verify`.
