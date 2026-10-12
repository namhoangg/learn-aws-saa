# PROGRESS

Single source of truth for build status. Plan: [PLAN.md](PLAN.md).
Update only through `python tools/progress.py ...` (it locks the file and re-renders it).
On a restart: resume at the first section that is not `done`; never redo `done` work.

Last update: 2026-10-04 03:20 UTC · Sections done: **36/36** · Flashcards: **1060** · Quiz questions: **529** · Labs: **96**

## Milestones

| Milestone | Status | Note |
|---|---|---|
| Extract slide text and renders in batches of 50 (tools/extract_pdf.py) | ✅ done | 876 slides -> _extract/text (18 batch files) + _extract/pages (876 jpg) |
| PLAN.md with sections and slide ranges | ✅ done | 36 sections |
| Content format: content/README.md, course.json, services.json, validator | ✅ done | content/README.md, course.json (13 parts), services.json (189 services), tools/validate_content.mjs, tools/check_verbatim.py |
| UI design on the design canvas | ✅ done | Canvas 'Quiet Blueprint' (16 artboards) + design/DESIGN_SPEC.md; implemented in src/styles |
| App shell: Vite + React + TS, routing, sidebar, theme, layout | ✅ done | Top bar + course sidebar + drawer below 1024px; exam focus mode; light/dark |
| Lesson page with Lesson / Flashcards / Quiz / Lab tabs, Mermaid, callouts | ✅ done | Tabs Lesson/Flashcards/Quiz/Lab, Mermaid figures, callouts, badges, tables, TOC, sources |
| Spaced-repetition flashcards (Easy / Hard) | ✅ done | Easy/Hard SRS (src/lib/srs.ts); Hard requeues after 3 cards and returns in 10 min |
| Quiz modes: per section, mixed review | ✅ done | Per section + mixed review (sections, size, domain, unseen/missed filters) |
| Exam simulation: 65 questions, 130 minutes | ✅ done | 65 questions weighted by domain, 130-min timer, flag/navigator, results by domain and section |
| Weak areas page | ✅ done | Missed questions until 2 right in a row; cards rated Hard repeatedly |
| Home: knowledge map + progress dashboard | ✅ done | Dashboard tiles, continue card, part progress, grid knowledge map with hover card |
| Full-text search | ✅ done | MiniSearch over lessons (per heading), cards, questions, labs; Ctrl+K palette + results page |
| Progress in localStorage + export/import | ✅ done | localStorage learnaws:v1 with export/import/reset; settings for theme, shortcuts, lab mode |
| Final QA: build, browser sweep of every section, totals | ✅ done | 36/36 sections: validator 0 errors/0 warnings, verbatim 0 spans, build ok, /check 36 sections 226 diagrams 0 problems; app code review findings fixed |

## Sections

| # | Id | Title | Slides | Status | Cards | Questions | Labs | Open issues |
|---|---|---|---|---|---|---|---|---|
| 1 | `01-getting-started` | Getting Started with AWS | 1-23 | ✅ done | 26 | 14 | 2 | 1 |
| 2 | `02-iam` | IAM & AWS CLI | 24-40 | ✅ done | 30 | 15 | 3 | 0 |
| 3 | `03-ec2-basics` | EC2 Fundamentals | 41-63 | ✅ done | 30 | 14 | 3 | 1 |
| 4 | `04-ec2-purchasing` | EC2 Purchasing Options | 64-77 | ✅ done | 29 | 14 | 3 | 0 |
| 5 | `05-ec2-associate` | EC2 Networking & Placement | 78-92 | ✅ done | 30 | 14 | 3 | 0 |
| 6 | `06-ec2-storage` | EC2 Instance Storage | 93-117 | ✅ done | 30 | 15 | 3 | 1 |
| 7 | `07-elb` | Elastic Load Balancing | 118-150 | ✅ done | 28 | 15 | 3 | 1 |
| 8 | `08-asg` | Auto Scaling Groups | 151-159 | ✅ done | 30 | 14 | 2 | 1 |
| 9 | `09-rds-aurora-elasticache` | RDS, Aurora & ElastiCache | 160-192 | ✅ done | 30 | 15 | 3 | 5 |
| 10 | `10-route53` | Route 53 | 193-226 | ✅ done | 30 | 15 | 2 | 2 |
| 11 | `11-classic-architectures` | Classic Solutions Architecture | 227-266 | ✅ done | 30 | 15 | 2 | 1 |
| 12 | `12-s3-fundamentals` | Amazon S3 Fundamentals | 267-292 | ✅ done | 30 | 15 | 2 | 0 |
| 13 | `13-s3-advanced` | Amazon S3 Advanced | 293-312 | ✅ done | 30 | 15 | 3 | 3 |
| 14 | `14-s3-security` | Amazon S3 Security | 313-334 | ✅ done | 30 | 15 | 3 | 1 |
| 15 | `15-cloudfront-global-accelerator` | CloudFront & Global Accelerator | 335-349 | ✅ done | 29 | 13 | 2 | 2 |
| 16 | `16-storage-extras` | AWS Storage Extras | 350-374 | ✅ done | 30 | 15 | 3 | 2 |
| 17 | `17-sqs-sns` | Decoupling with SQS & SNS | 375-404 | ✅ done | 30 | 15 | 3 | 0 |
| 18 | `18-kinesis-mq` | Streaming with Kinesis & Amazon MQ | 405-413 | ✅ done | 30 | 13 | 3 | 2 |
| 19 | `19-containers` | Containers on AWS | 414-437 | ✅ done | 30 | 15 | 2 | 1 |
| 20 | `20-lambda` | Serverless & AWS Lambda | 438-465 | ✅ done | 30 | 15 | 2 | 0 |
| 21 | `21-dynamodb-apigw-cognito` | DynamoDB, API Gateway, Step Functions & Cognito | 466-490 | ✅ done | 30 | 15 | 3 | 1 |
| 22 | `22-serverless-architectures` | Serverless Architectures | 491-512 | ✅ done | 28 | 15 | 2 | 2 |
| 23 | `23-databases` | Databases in AWS | 513-526 | ✅ done | 30 | 15 | 2 | 1 |
| 24 | `24-data-analytics` | Data & Analytics | 527-559 | ✅ done | 29 | 15 | 3 | 2 |
| 25 | `25-machine-learning` | Machine Learning | 560-574 | ✅ done | 30 | 15 | 3 | 3 |
| 26 | `26-cloudwatch-eventbridge` | Monitoring with CloudWatch & EventBridge | 575-604 | ✅ done | 30 | 15 | 3 | 0 |
| 27 | `27-cloudtrail-config` | Auditing with CloudTrail & Config | 605-618 | ✅ done | 28 | 14 | 2 | 2 |
| 28 | `28-advanced-identity` | Advanced Identity | 619-647 | ✅ done | 30 | 15 | 3 | 1 |
| 29 | `29-encryption-secrets` | Encryption, Keys & Secrets | 648-681 | ✅ done | 29 | 15 | 3 | 0 |
| 30 | `30-threat-protection` | Threat Protection & Detection | 682-696 | ✅ done | 30 | 15 | 3 | 2 |
| 31 | `31-vpc-fundamentals` | VPC Fundamentals | 697-728 | ✅ done | 28 | 14 | 3 | 2 |
| 32 | `32-vpc-connectivity` | VPC Connectivity & Network Costs | 729-774 | ✅ done | 30 | 15 | 3 | 2 |
| 33 | `33-disaster-recovery-migrations` | Disaster Recovery & Migrations | 775-801 | ✅ done | 28 | 15 | 3 | 1 |
| 34 | `34-more-architectures` | More Solutions Architecture | 802-823 | ✅ done | 30 | 15 | 3 | 2 |
| 35 | `35-other-services` | Other Services | 824-851 | ✅ done | 28 | 15 | 3 | 2 |
| 36 | `36-well-architected-exam` | Well-Architected & Exam Preparation | 852-876 | ✅ done | 30 | 15 | 2 | 2 |

## Section details

### 01-getting-started — Getting Started with AWS
- Status: done (updated 2026-10-04 03:15 UTC)
- Files: `content/01-getting-started/meta.json`, `content/01-getting-started/lesson.md`, `content/01-getting-started/flashcards.json`, `content/01-getting-started/quiz.json`, `content/01-getting-started/labs/01-console-regions-azs.md`, `content/01-getting-started/labs/02-zero-spend-budget.md`
- Open issues:
  - Lab 02 Step 3: Monthly cost budget template default thresholds (85%/100% actual, 100% forecast) are not on AWS docs; confirm in the console
- Notes:
  - authored; awaiting review
  - reviewed: fixed Q4 stem (us-west-2 is not the Region nearest LA), Q8 option relying on a 4th London AZ, Q3 wording; lesson AZ counts (London has 3, 7th us-east-1 AZ coming), WAF Regional list, GA control plane in us-west-2, customer-count VERIFY resolved; lab01 Alt+S is Search not Services, Builder Center statuses softened; lab02 CLI now mirrors 3 template alerts; meta ESC link fixed, 6 sources added, lastVerified 2026-10-04
  - QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok
  - verification pass 2026-10-04: 0 items resolved, 1 kept

### 02-iam — IAM & AWS CLI
- Status: done (updated 2026-10-04 01:31 UTC)
- Files: `content/02-iam/meta.json`, `content/02-iam/lesson.md`, `content/02-iam/flashcards.json`, `content/02-iam/quiz.json`, `content/02-iam/labs/01-users-groups-policies.md`, `content/02-iam/labs/02-password-policy-mfa-reports.md`, `content/02-iam/labs/03-access-keys-cli-roles.md`
- Open issues: none
- Notes:
  - authored; awaiting review
  - reviewed: verified 20+ claims on AWS docs (all numbers held); fixed centralized-root-access wording, 400-day tracking period, aws login permissions, Sign up for AWS (new/advanced) limits; redrew group diagram (was slide topology); replaced 2 implausible quiz distractors, added q15 (IAM global/DR); lab fixes: alias rules, credential report columns, MFA tab step, CloudShell QR download, admin-profile note, aws logout cleanup; added 3 sources, lastVerified 2026-10-04
  - QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok

### 03-ec2-basics — EC2 Fundamentals
- Status: done (updated 2026-10-04 03:15 UTC)
- Files: `content/03-ec2-basics/meta.json`, `content/03-ec2-basics/lesson.md`, `content/03-ec2-basics/flashcards.json`, `content/03-ec2-basics/quiz.json`, `content/03-ec2-basics/labs/01-web-server-user-data.md`, `content/03-ec2-basics/labs/02-connect-ssh-instance-connect.md`, `content/03-ec2-basics/labs/03-security-group-referencing.md`
- Open issues:
  - VERIFY kept: t8i.micro/t8i.small Free Tier eligibility differs between the EC2 burstable-instances page and the Free Tier usage page / aws.amazon.com/free
- Notes:
  - authored; awaiting review
  - reviewed: fixed legacy Free Tier claims (t3.micro free only where t2.micro absent) in lesson and 3 labs; Q04 now has a cost requirement (i4i.16xlarge also has 512 GiB); EIC Endpoint wording fixed; lab CLI Region lookup fixed (configure get ignores env vars); removed --associate-public-ip-address; added EBS bandwidth, AMI/user-data nuance, Windows persist tag; 20+ claims checked on AWS docs
  - QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok
  - verification pass 2026-10-04: 0 items resolved, 2 kept

### 04-ec2-purchasing — EC2 Purchasing Options
- Status: done (updated 2026-10-04 00:42 UTC)
- Files: `content/04-ec2-purchasing/meta.json`, `content/04-ec2-purchasing/lesson.md`, `content/04-ec2-purchasing/flashcards.json`, `content/04-ec2-purchasing/quiz.json`, `content/04-ec2-purchasing/labs/01-compare-purchasing-prices.md`, `content/04-ec2-purchasing/labs/02-spot-request-lifecycle.md`, `content/04-ec2-purchasing/labs/03-capacity-reservation.md`
- Open issues: none
- Notes:
  - authored; awaiting review
  - reviewed: fixed decision tree (Convertible RI cannot change Region), Spot persistent-request/stop-interruption behaviour and state diagram, max-price wording, future-dated CR cancellation and Capacity Block wording, ASG has no diversified strategy (q09), q04/q06 explanations, fc-05/17/29; verified EC2 Instance SP, Convertible RI, Compute SP and Spot prices for m7i.large from AWS price data
  - reviewed: fixed decision tree (Convertible RI cannot change Region), Spot persistent-request stop-interruption behaviour and state diagram, max-price wording, future-dated CR cancellation and Capacity Block wording, ASG has no diversified strategy (q09), q04/q06 explanations, fc-05/17/29; verified EC2 Instance SP, Convertible RI, Compute SP and Spot prices for m7i.large from AWS price data
  - QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok

### 05-ec2-associate — EC2 Networking & Placement
- Status: done (updated 2026-10-04 01:31 UTC)
- Files: `content/05-ec2-associate/meta.json`, `content/05-ec2-associate/lesson.md`, `content/05-ec2-associate/flashcards.json`, `content/05-ec2-associate/quiz.json`, `content/05-ec2-associate/labs/01-public-ip-eip-eni.md`, `content/05-ec2-associate/labs/02-placement-groups.md`, `content/05-ec2-associate/labs/03-hibernate-instance.md`
- Open issues: none
- Notes:
  - authored; awaiting review
  - reviewed: verified 8+ claims on AWS docs (all held); rewrote q05 (MAC cannot move between ENIs), q08 (requirement made decisive), q12 (clearer stem); softened cluster correlated-failure claim; added peered-VPC, same-subnet ENI and 9th-gen hibernate details; fixed false CLI comment and used --count 2 in lab 2; added EIP/eth0 note and routing tip to lab 1; +2 flashcards; lastVerified 2026-10-04
  - QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok

### 06-ec2-storage — EC2 Instance Storage
- Status: done (updated 2026-10-04 03:15 UTC)
- Files: `content/06-ec2-storage/meta.json`, `content/06-ec2-storage/lesson.md`, `content/06-ec2-storage/flashcards.json`, `content/06-ec2-storage/quiz.json`, `content/06-ec2-storage/labs/01-ebs-volume-snapshot-encrypt.md`, `content/06-ec2-storage/labs/02-custom-ami.md`, `content/06-ec2-storage/labs/03-efs-shared-file-system.md`
- Open issues:
  - Lab 03 step 2: EFS custom-create docs do not list an automatic-backups checkbox (only the General edit page toggle is documented); VERIFY marker kept with a post-create fallback
- Notes:
  - authored; awaiting review
  - reviewed: verified 30+ claims on AWS docs (gp3 64 TiB/80k IOPS, io2 BX, Multi-Attach, DeleteOnTermination table, Elastic Volumes 4/24h, volume copy, Archive, Recycle Bin, FSR, PRVI, encryption, EFS perf/prices/lifecycle, instance store IOPS); fixed lab 1 list-snapshots-in-recycle-bin flag (--snapshot-ids) and tag-level rule lock wording, AZ-safe t3.micro subnet pick in all 3 labs, archived-snapshot Recycle Bin recovery path (diagram + text), EFS storage-class latency/price table, DeleteOnTermination callout, multi-select keys spread (B/D, C/E, B/E), q05/q07 explanations; added Elastic Volumes flashcard, CHECKs in labs 2-3, 5 sources
  - QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok
  - verification pass 2026-10-04: 1 items resolved, 0 kept

### 07-elb — Elastic Load Balancing
- Status: done (updated 2026-10-04 03:18 UTC)
- Files: `content/07-elb/meta.json`, `content/07-elb/lesson.md`, `content/07-elb/flashcards.json`, `content/07-elb/quiz.json`, `content/07-elb/labs/01-alb-two-instances.md`, `content/07-elb/labs/02-alb-rules-stickiness-draining.md`, `content/07-elb/labs/03-nlb-static-ips-cross-zone.md`
- Open issues:
  - Lab 03 step 4 console labels 'Assigned by AWS' / 'Use an Elastic IP address' are only in a re:Post article, not the ELB user guide (VERIFY marker kept)
- Notes:
  - authored; awaiting review
  - reviewed: verified 20+ claims on AWS docs (all held); fixed NACL and UDP client-IP quiz explanations, ALB cross-zone/HTTP2/weighted-random wording, IP target ranges, NLB SG+QUIC caveat, UDP/QUIC health checks; labs: AZ-safe t3.micro subnet pick, nslookup install note, sticky cookie expiry and NLB curl CHECK wording; 8 sources added
  - QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok
  - verification pass 2026-10-04: 1 items resolved, 0 kept

### 08-asg — Auto Scaling Groups
- Status: done (updated 2026-10-04 03:18 UTC)
- Files: `content/08-asg/meta.json`, `content/08-asg/lesson.md`, `content/08-asg/flashcards.json`, `content/08-asg/quiz.json`, `content/08-asg/labs/01-asg-behind-alb.md`, `content/08-asg/labs/02-scaling-policies.md`
- Open issues:
  - Lab 01 step 4: AWS docs disagree on the ASG wizard page titles ('Integrate with other services' vs 'Configure advanced options'; 'Configure group size and scaling' vs '...scaling policies'); VERIFY marker kept, field labels are consistent
- Notes:
  - authored; awaiting review
  - reviewed: verified 25+ claims on AWS docs (all held); fixed target tracking rounding wording, metric publishing, cooldown-at-creation and root-volume wording, SQS metric-math group-metrics note, lifecycle ABANDON/default-result path and diagram; added max instance lifetime, suspended processes, mixed-instances termination step, 2 flashcards; quiz: Q09 max-capacity premise, multi answers rebalanced off A+C; labs: realistic scale-in wait (lab 02), draining delay CHECK (lab 01); 3 sources added
  - QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok
  - verification pass 2026-10-04: 0 items resolved, 1 kept

### 09-rds-aurora-elasticache — RDS, Aurora & ElastiCache
- Status: done (updated 2026-10-04 03:18 UTC)
- Files: `content/09-rds-aurora-elasticache/meta.json`, `content/09-rds-aurora-elasticache/lesson.md`, `content/09-rds-aurora-elasticache/flashcards.json`, `content/09-rds-aurora-elasticache/quiz.json`, `content/09-rds-aurora-elasticache/labs/01-rds-mysql-replica-snapshot.md`, `content/09-rds-aurora-elasticache/labs/02-aurora-endpoints-failover-clone.md`, `content/09-rds-aurora-elasticache/labs/03-elasticache-valkey-patterns.md`
- Open issues:
  - VERIFY: Aurora ~20% per-hour premium over RDS (slide claim) not stated on current pricing pages
  - VERIFY: Aurora volume growth increment of 10 GB (slide claim) not documented
  - VERIFY: SASL authentication for ElastiCache Memcached not described in current ElastiCache docs
  - VERIFY: whether Free plan accounts can create RDS for MySQL read replicas (Lab 01 Step 5)
  - VERIFY: whether ElastiCache Serverless is available on the Free plan (Lab 03)
- Notes:
  - authored; awaiting review
  - reviewed: fixed Lab 02 console cleanup (empty Aurora cluster kept billing), flagged Free plan can't run Lab 02 (Aurora = PG express only), fixed Free Tier engine/class detail, Backtrack enable rule, Valkey durability scope, custom-endpoint quota, leaderboard code block, Lab 01 cost/storage label, Lab 03 timing; spread multi-select answers; tightened 5 flashcards; added ZDP/Aurora features coverage; 15+ claims checked on AWS docs
  - QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok
  - verification pass 2026-10-04: 5 items resolved, 0 kept

### 10-route53 — Route 53
- Status: done (updated 2026-10-04 03:17 UTC)
- Files: `content/10-route53/meta.json`, `content/10-route53/lesson.md`, `content/10-route53/flashcards.json`, `content/10-route53/quiz.json`, `content/10-route53/labs/01-private-zone-records-routing.md`, `content/10-route53/labs/02-health-checks-failover.md`
- Open issues:
  - VERIFY: number of Route 53 health checkers per endpoint (slides say about 15; AWS docs give no count)
  - VERIFY: calculated health check child limit (API/console 256 vs quotas page 255)
- Notes:
  - authored; awaiting review
  - reviewed: fixed lab cleanup claim (Route 53 does not block deleting in-use health checks), legacy Free Tier t2.micro note in both labs, DNS-flow diagram that implied Route 53 forwards traffic, added NOT-via-invert for calculated checks, CloudWatch alarm limits, accelerated recovery opt-in, health check billing for calculated/alarm checks, shuffled multi-select answers off A+B, trimmed 3 flashcards; 2 VERIFY markers remain
  - QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok
  - verification pass 2026-10-04: 1 items resolved, 1 kept

### 11-classic-architectures — Classic Solutions Architecture
- Status: done (updated 2026-10-04 03:17 UTC)
- Files: `content/11-classic-architectures/meta.json`, `content/11-classic-architectures/lesson.md`, `content/11-classic-architectures/flashcards.json`, `content/11-classic-architectures/quiz.json`, `content/11-classic-architectures/labs/01-beanstalk-web-app.md`, `content/11-classic-architectures/labs/02-shared-uploads-efs.md`
- Open issues:
  - Lab 01 CLI path: docs do not confirm that LoadBalancerType=application is accepted at creation for a single-instance environment (API default is classic); VERIFY marker kept with a fallback
- Notes:
  - authored; awaiting review
  - reviewed: fixed lab-01 legacy Free Tier claim (ALB hours are included) and IPv4/cost estimate, env URL format, single-instance events and tail-log CHECK; corrected worker-tier queue-depth scaling (built-in trigger cannot watch SQS); made q03 read-replica distractor plausible; tightened q02-D; lab-02 subnet pick now filters AZs offering t3.micro; added 2 flashcards (fixed-at-creation settings, three-tier subnets); 5 sources added, lastVerified 2026-10-04
  - QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok
  - verification pass 2026-10-04: 0 items resolved, 1 kept

### 12-s3-fundamentals — Amazon S3 Fundamentals
- Status: done (updated 2026-10-04 01:31 UTC)
- Files: `content/12-s3-fundamentals/meta.json`, `content/12-s3-fundamentals/lesson.md`, `content/12-s3-fundamentals/flashcards.json`, `content/12-s3-fundamentals/quiz.json`, `content/12-s3-fundamentals/labs/01-bucket-objects-static-website.md`, `content/12-s3-fundamentals/labs/02-versioning-and-crr.md`
- Open issues: none
- Notes:
  - authored; awaiting review
  - reviewed: q09 rewritten (object size + lifecycle target so One Zone-IA is the only answer), q03/q12 explanations fixed, storage-class decision tree label fixed, website 403-masks-404 confirmed (VERIFY removed, diagram + KC source), versioning 15-min wording per docs, Express One Zone 80%/50% docs note, annotations/replication details, lab 01 console steps + CHECK fixes, lab 02 versioning wait; 47 sources, lastVerified 2026-10-04
  - QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok

### 13-s3-advanced — Amazon S3 Advanced
- Status: done (updated 2026-10-04 03:17 UTC)
- Files: `content/13-s3-advanced/meta.json`, `content/13-s3-advanced/lesson.md`, `content/13-s3-advanced/flashcards.json`, `content/13-s3-advanced/quiz.json`, `content/13-s3-advanced/labs/01-lifecycle-rules.md`, `content/13-s3-advanced/labs/02-event-notifications.md`, `content/13-s3-advanced/labs/03-performance-batch-storage-lens.md`
- Open issues:
  - S3 events delivered to EventBridge: per-event charge not confirmed on S3 or EventBridge pricing pages (VERIFY in lesson and lab 02)
  - Lab 03: label of the console button that confirms a suspended Batch Operations job not confirmed in docs (inline verify)
  - Storage Lens free metric count (slides say about 28) not stated in current docs (VERIFY in lesson)
- Notes:
  - authored; awaiting review
  - reviewed: Requester Pays 403 billing corrected, Storage Lens CloudWatch publishing limited to account/bucket level (lesson, Q12, new trap), Q05 ordering premise fixed, Q13 answers moved to B/D, CLI-only lab steps wrapped in cli blocks, unsafe grep -m1 pipe fixed, Batch Ops console/CLI steps tightened, fc-22/23 trimmed to one fact, sources + lastVerified updated
  - QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok
  - verification pass 2026-10-04: 4 items resolved, 0 kept

### 14-s3-security — Amazon S3 Security
- Status: done (updated 2026-10-04 03:18 UTC)
- Files: `content/14-s3-security/meta.json`, `content/14-s3-security/lesson.md`, `content/14-s3-security/flashcards.json`, `content/14-s3-security/quiz.json`, `content/14-s3-security/labs/01-encryption-https-presigned.md`, `content/14-s3-security/labs/02-cors-access-logs.md`, `content/14-s3-security/labs/03-object-lock-access-points.md`
- Open issues:
  - Glacier vault service closure date (15 Dec 2025) appears only in search snippets; current docs pages give no date, so it stays a VERIFY marker
- Notes:
  - authored; awaiting review
  - reviewed: verified 14 claims on AWS docs (SSE-C default block, CW Logs delivery, KMS quotas, variable retention, presigned limits, access point limits, Object Lambda/Glacier closures); fixed SSE-KMS TLS-and-SigV4 wording, Vault Lock 24h wording, access point HTTPS/ops wording, decision-tree label, best-effort log wording; split two multi-fact flashcards and added 2 cards; reworded q07, fixed q13 NAT explanation, spread multi-select answers; honest Free Tier cost lines and corrected CORS preflight explanation in labs
  - QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok
  - verification pass 2026-10-04: 1 items resolved, 0 kept

### 15-cloudfront-global-accelerator — CloudFront & Global Accelerator
- Status: done (updated 2026-10-04 03:18 UTC)
- Files: `content/15-cloudfront-global-accelerator/meta.json`, `content/15-cloudfront-global-accelerator/lesson.md`, `content/15-cloudfront-global-accelerator/flashcards.json`, `content/15-cloudfront-global-accelerator/quiz.json`, `content/15-cloudfront-global-accelerator/labs/01-cloudfront-s3-oac.md`, `content/15-cloudfront-global-accelerator/labs/02-global-accelerator-two-regions.md`
- Open issues:
  - Lab 01: CloudFront create-distribution wizard wording for the pay-as-you-go choice and the WAF opt-out option is not shown in docs (two inline verify markers remain)
  - Lab 02: could not confirm from AWS docs whether Global Accelerator is available on Free account plan (post-15 July 2025) accounts; VERIFY callout added
- Notes:
  - authored; awaiting review
  - reviewed: fixed Price Class 200 regions, CRR timing (no guarantee without RTC), REC skip for same-Region S3, GA established-connection behaviour, tag invalidation opt-in; rebuilt decision diagram; tightened q02/q08/q11/q13; added price-class card; lab fixes (invalidation count, GA wizard verify resolved, Free plan VERIFY, t3.micro AZ tip)
  - QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok
  - verification pass 2026-10-04: 1 items resolved, 2 kept

### 16-storage-extras — AWS Storage Extras
- Status: done (updated 2026-10-04 03:18 UTC)
- Files: `content/16-storage-extras/meta.json`, `content/16-storage-extras/lesson.md`, `content/16-storage-extras/flashcards.json`, `content/16-storage-extras/quiz.json`, `content/16-storage-extras/labs/01-datasync-s3-to-s3.md`, `content/16-storage-extras/labs/02-transfer-family-sftp.md`, `content/16-storage-extras/labs/03-s3-file-gateway-ec2.md`
- Open issues:
  - Free plan availability of DataSync, Transfer Family and Storage Gateway not confirmable on AWS docs (VERIFY markers in labs 1-3)
  - Snowmobile retirement date (April 2024) only in press reports, not AWS docs (VERIFY marker kept)
- Notes:
  - authored; awaiting review
  - reviewed: verified 20+ claims on AWS docs (all core numbers held); fixed lab 3 Free-plan blocker (m5.xlarge needs Paid plan) and fragile list-local-disks query, lab 2 sftp batch abort on cd, lab 1 object-count CHECK; quiz: rebalanced multi answers (q11 B/D, q15 C/E), replaced weak q15 distractor with Lustre Multi-AZ trap, de-risked q13 capacity and q01/q04 wording; flashcards split fc-26 into fc-26/29/30 and trimmed fc-07 overlap; lesson: Enhanced-mode scope, FSx Windows regional limits, Outposts 7-day DDIL, Lustre Intelligent-Tiering throughput; meta sources + lastVerified 2026-10-04
  - QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok
  - verification pass 2026-10-04: 4 items resolved, 0 kept

### 17-sqs-sns — Decoupling with SQS & SNS
- Status: done (updated 2026-10-04 01:31 UTC)
- Files: `content/17-sqs-sns/meta.json`, `content/17-sqs-sns/lesson.md`, `content/17-sqs-sns/flashcards.json`, `content/17-sqs-sns/quiz.json`, `content/17-sqs-sns/labs/01-sqs-queue-visibility-dlq.md`, `content/17-sqs-sns/labs/02-sqs-fifo-ordering-dedup.md`, `content/17-sqs-sns/labs/03-sns-fanout-filtering.md`
- Open issues: none
- Notes:
  - authored; awaiting review
  - reviewed: SQS latency corrected to tens-hundreds ms (FAQ), SSE-SQS default scoped to new queues with both 2022 dates, added SQS FIFO cannot subscribe to standard SNS topic (lesson, trap, Q11, new card), Lambda as SNS publisher, Q05/Q09 deciding requirements, split SNS limits card, lab console poll fixes, sources + lastVerified
  - QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok

### 18-kinesis-mq — Streaming with Kinesis & Amazon MQ
- Status: done (updated 2026-10-04 03:17 UTC)
- Files: `content/18-kinesis-mq/meta.json`, `content/18-kinesis-mq/lesson.md`, `content/18-kinesis-mq/flashcards.json`, `content/18-kinesis-mq/quiz.json`, `content/18-kinesis-mq/labs/01-kinesis-produce-consume-replay.md`, `content/18-kinesis-mq/labs/02-firehose-stream-to-s3.md`, `content/18-kinesis-mq/labs/03-amazon-mq-activemq-broker.md`
- Open issues:
  - Free plan availability of Kinesis Data Streams and Firehose not confirmed (labs 01-02 carry VERIFY)
  - Amazon MQ create-broker Network and security labels and ActiveMQ web console labels not confirmable from docs (lab 03 VERIFY)
- Notes:
  - authored; awaiting review
  - reviewed: verified 20+ claims on AWS docs/price list (all numbers held); fixed misleading shard-to-consumer and decision-tree diagrams, mq.m7g wrongly listed for ActiveMQ, EFO cost row, added on-demand 4,000 records/s, Firehose payload formats, SNS FIFO archive nuance, 2 flashcards, tightened Q08, lab console labels (Edit provisioned shards, Data Viewer), Free plan notes, lab 02 freeTier no, :::console blocks in lab 03
  - QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok
  - verification pass 2026-10-04: 1 items resolved, 3 kept

### 19-containers — Containers on AWS
- Status: done (updated 2026-10-04 03:17 UTC)
- Files: `meta.json`, `lesson.md`, `flashcards.json`, `quiz.json`, `labs/01-ecr-build-push-scan.md`, `labs/02-ecs-fargate-alb-autoscaling.md`
- Open issues:
  - ECR 500 MB/month private-storage Free Tier is listed for new customers for one year; could not confirm whether it applies to accounts on the post-15-July-2025 Free plan (VERIFY marker kept in lesson)
- Notes:
  - authored; awaiting review
  - reviewed: verified 20+ claims on AWS docs (Fargate sizes/prices, Managed Instances, LB types, storage, S3 Files, App Runner/Express Mode, ECR scanning/pricing, EKS Fargate/Auto Mode/pricing, ECS Anywhere); fixed execution-role overstatement, basic-scanning default, Managed Instances lifetime wording, isolation warning, added Docker volumes row; resolved lab 01 basic-scanning VERIFY, made lab 01 Dockerfile use uname -n and start a scan for console users, removed unconfirmed GovCloud claim; lab 02 cleanup adds CloudFormation check; quiz q07/q11 explanations and wording tightened; flashcards fc-23/26/29 made single-fact
  - QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok
  - verification pass 2026-10-04: 1 items resolved, 0 kept

### 20-lambda — Serverless & AWS Lambda
- Status: done (updated 2026-10-04 03:17 UTC)
- Files: `content/20-lambda/meta.json`, `content/20-lambda/lesson.md`, `content/20-lambda/flashcards.json`, `content/20-lambda/quiz.json`, `content/20-lambda/labs/01-lambda-throttling-async-destinations.md`, `content/20-lambda/labs/02-s3-trigger-dynamodb-scheduler.md`
- Open issues: none
- Notes:
  - authored; awaiting review
  - reviewed: verified 20+ claims on AWS docs (all lesson numbers held); fixed wrong q05 option-B reason (origin-response edits are cached), replaced weak q06 distractor, added VPC context to q10, respread multi-select keys; split two-fact flashcards (+2 cards, 30 total); qualified 10x RPS cap as synchronous-only; added Managed Instances 90-min note; lab 01 Step 7 queue read now lists all records (old 2001 message reappears), get-queue-url tip, exact console labels; labs now clean up console-created customer managed IAM policies; softened Scheduler free-tier wording
  - QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok
  - verification pass 2026-10-04: 1 items resolved, 0 kept

### 21-dynamodb-apigw-cognito — DynamoDB, API Gateway, Step Functions & Cognito
- Status: done (updated 2026-10-04 03:16 UTC)
- Files: `content/21-dynamodb-apigw-cognito/meta.json`, `content/21-dynamodb-apigw-cognito/lesson.md`, `content/21-dynamodb-apigw-cognito/flashcards.json`, `content/21-dynamodb-apigw-cognito/quiz.json`, `content/21-dynamodb-apigw-cognito/labs/01-dynamodb-table-features.md`, `content/21-dynamodb-apigw-cognito/labs/02-serverless-crud-api.md`, `content/21-dynamodb-apigw-cognito/labs/03-step-functions-order-workflow.md`
- Open issues:
  - Lab 01: DynamoDB docs disagree on which capacity mode the console's Default settings applies (capacity-mode page says on-demand is default; auto scaling console page says Default settings enable auto scaling). Labs pick On-demand explicitly; VERIFY marker kept.
- Notes:
  - authored; awaiting review
  - reviewed: verified 20+ claims on AWS docs (capacity modes, pricing, global tables MRSC, PITR, export/import, DAX, Streams, API Gateway quotas/endpoints, Step Functions quotas, Cognito plans, Lambda runtimes); fixed MRSC Streams wording, on-demand free-tier row, Cognito email MFA plans, parallel branch in state diagram, quiz q05/q14 wording, flashcards fc-26/fc-28, lab 01 restore waiter note
  - QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok
  - verification pass 2026-10-04: 0 items resolved, 1 kept

### 22-serverless-architectures — Serverless Architectures
- Status: done (updated 2026-10-04 03:16 UTC)
- Files: `content/22-serverless-architectures/meta.json`, `content/22-serverless-architectures/lesson.md`, `content/22-serverless-architectures/flashcards.json`, `content/22-serverless-architectures/quiz.json`, `content/22-serverless-architectures/labs/01-cognito-per-user-s3-folders.md`, `content/22-serverless-architectures/labs/02-dynamodb-streams-welcome-email.md`
- Open issues:
  - Lab 01 step 2: Cognito console label 'Mobile app' for the application type is still unconfirmed in AWS docs (VERIFY marker kept)
  - Lab 02 step 5: Lambda guide says DynamoDB ESMs filter only on the dynamodb key, DynamoDB guide and AWS re:Post say eventName works; VERIFY kept, function code guards INSERT anyway
- Notes:
  - authored; awaiting review
  - reviewed: verified 15+ claims on AWS docs (all held); split fc-12 into TTL card + new fc-28; Q03 given a response size under the 1 MB cache limit; lesson adds 1 MB cached-response limit, clarifies cache keys, Lambda invoke via identity pool role and authorizer billing wording; lab 02 console paths now capture STREAM_ARN/ROLE_ARN/ESM_UUID; lab 01 offers SPA as alternative app type
  - QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok
  - verification pass 2026-10-04: 2 items resolved, 0 kept

### 23-databases — Databases in AWS
- Status: done (updated 2026-10-04 03:16 UTC)
- Files: `content/23-databases/meta.json`, `content/23-databases/lesson.md`, `content/23-databases/flashcards.json`, `content/23-databases/quiz.json`, `content/23-databases/labs/01-keyspaces-iot-readings.md`, `content/23-databases/labs/02-documentdb-json-catalog.md`
- Open issues:
  - Lab 02: names of the security groups or ingress rules that DocumentDB Connect to cluster (CloudShell) creates, and whether deleting the CloudShell VPC environment removes them, are not documented by AWS
- Notes:
  - authored; awaiting review
  - reviewed: resolved DocumentDB price VERIFY via AWS Price List (USD 0.078/h), added --storage-encrypted to lab 02 CLI and fixed DocumentDB encryption claim, QuickSight to Amazon Quick Sight UPDATED marker, ElastiCache backup wording, Glacier Vault Lock, fc-02 OLTP scope, new fc-30 (ElastiCache no PITR), Q05 payer-account ambiguity, Q13 option D explanation
  - QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok
  - verification pass 2026-10-04: 0 items resolved, 1 kept

### 24-data-analytics — Data & Analytics
- Status: done (updated 2026-10-04 03:18 UTC)
- Files: `meta.json`, `lesson.md`, `flashcards.json`, `quiz.json`, `labs/01-athena-partitions-parquet.md`, `labs/02-glue-crawler-etl-bookmarks.md`, `labs/03-redshift-serverless-copy-spectrum.md`
- Open issues:
  - Glue crawler 10-minute minimum billed duration not visible on the rendered Glue pricing page (third-party sources only); VERIFY marker kept in lesson
  - Lab 03: docs confirm the creator-is-admin behaviour only for console-created Redshift Serverless namespaces; CLI path keeps a VERIFY with a console fallback
- Notes:
  - authored; awaiting review
  - reviewed: confirmed key limits/prices on AWS docs; resolved Quick pricing and Glue 6.0 price verifies; added Athena 10 MB minimum; fixed Parquet cost example; MSK KRaft/Kafka 4 note; softened Flink AZ claim; fixed q11 D explanation; lab 03 CLI-admin fallback and console labels; lab 02 cleanup of logs-v2 and sparkHistoryLogs
  - QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok
  - verification pass 2026-10-04: 1 items resolved, 1 kept
  - verification pass 2026-10-04: 1 items resolved, 1 kept

### 25-machine-learning — Machine Learning
- Status: done (updated 2026-10-04 03:18 UTC)
- Files: `content/25-machine-learning/meta.json`, `content/25-machine-learning/lesson.md`, `content/25-machine-learning/flashcards.json`, `content/25-machine-learning/quiz.json`, `content/25-machine-learning/labs/01-vision-documents-text-apis.md`, `content/25-machine-learning/labs/02-polly-transcribe-speech.md`, `content/25-machine-learning/labs/03-lex-chatbot-from-example.md`
- Open issues:
  - Lab 03: confirm in a live run whether OrderFlowers ends in Fulfilled or ReadyForFulfillment with no Lambda (lab accepts either)
  - Lab 03: Lex pricing page does not say whether console test-window / TSTALIASID messages are billed as text requests
  - Lab 02: Transcribe console labels (Browse S3, Service-managed S3 bucket) and Polly Engine/Voice selectors come from doc text, not screenshots
- Notes:
  - authored; awaiting review
  - reviewed: quiz key confirmed (15/15); added Rekognition Streaming Video/Bulk Image Analysis closure (30 Apr 2026) callout + fc-30; flat Transcribe batch rate note; Ground Truth/Model Monitor maintenance markers; Polly unsupported-SSML error scoped to standard/neural/long-form (lesson, q09); lab 02 redaction CHECK (DATE_TIME/PIN), service-managed bucket cleanup wording, langid job CLI cleanup; lab 03 Assisted NLU note; lab 01 targeted-sentiment hedge; 6 sources added
  - QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok
  - verification pass 2026-10-04: 1 items resolved, 0 kept
  - verification pass 2026-10-04: 1 items resolved, 0 kept

### 26-cloudwatch-eventbridge — Monitoring with CloudWatch & EventBridge
- Status: done (updated 2026-10-04 00:42 UTC)
- Files: `content/26-cloudwatch-eventbridge/meta.json`, `content/26-cloudwatch-eventbridge/lesson.md`, `content/26-cloudwatch-eventbridge/flashcards.json`, `content/26-cloudwatch-eventbridge/quiz.json`, `content/26-cloudwatch-eventbridge/labs/01-log-metric-filter-alarm.md`, `content/26-cloudwatch-eventbridge/labs/02-cloudwatch-agent-ec2-recovery.md`, `content/26-cloudwatch-eventbridge/labs/03-eventbridge-rules-archive-replay.md`
- Open issues: none
- Notes:
  - authored; awaiting review
  - reviewed: verified 20+ claims on AWS docs; resolved high-res alarm price (USD 0.30), fixed EC2 aggregate-metric claim, removed unconfirmed IMDSv2 claim for old agent, recover alarm uses Minimum per AWS procedure, softened basic-monitoring period rule, noted docs conflict on 5 vs 2 subscription filters, refined new Custom Event Bus pricing/Regions, q10 wording, q05/q03 explanations, lab 03 classic-bus type choice, lab 01 graph CHECK, 5 sources added
  - QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok

### 27-cloudtrail-config — Auditing with CloudTrail & Config
- Status: done (updated 2026-10-04 00:42 UTC)
- Files: `meta.json`, `lesson.md`, `flashcards.json`, `quiz.json`, `labs/01-cloudtrail-trail-eventbridge-alert.md`, `labs/02-config-rule-timeline-remediation.md`
- Open issues:
  - Lesson is about 5,700 words (including tables and code), above the 1,500-4,500 guideline; not trimmed
  - Lab 01 Step 5: whether the EventBridge console grants the SNS target through the topic access policy or an execution role depends on account settings (role manager); the lab covers both cases but this was not checked in a live account
- Notes:
  - authored; awaiting review
  - reviewed: lab01 lookup-events uses documented --max-items; quiz q11/q13 distractors rewritten, q02/q05 explanations fixed; lesson notes proactive mode now limited to 2 managed rules, remediation role needed for manual and automatic, Guard rules trigger on changes only; diagram notes trail requirement for EventBridge; 3 sources added
  - QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok

### 28-advanced-identity — Advanced Identity
- Status: done (updated 2026-10-04 03:18 UTC)
- Files: `content/28-advanced-identity/meta.json`, `content/28-advanced-identity/lesson.md`, `content/28-advanced-identity/flashcards.json`, `content/28-advanced-identity/quiz.json`, `content/28-advanced-identity/labs/01-organization-ou-scp.md`, `content/28-advanced-identity/labs/02-identity-center-sso.md`, `content/28-advanced-identity/labs/03-boundary-conditions-simulator.md`
- Open issues:
  - SCP syntax page still says Allow statements may use only Resource "*", contradicting the Sep 2025 announcement of resource ARN support; lesson keeps a VERIFY marker
- Notes:
  - authored; awaiting review
  - reviewed: 12+ claims checked on AWS docs (all confirmed); fixed evaluation-order key concept, PrincipalOrgID service-principal wording, cross-account table, added RCP limits, custom SAML app setup, Control Tower Identity Center opt-out, Free plan + Control Tower note; quiz q11 explanation and q12 deciding requirement; fc-28; lab 01 quota CHECK and disable-SCP label, lab 02 CLI prompt and password CHECK, lab 03 MFA CHECK hedge; 7 sources added
  - QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok
  - verification pass 2026-10-04: 0 items resolved, 1 kept
  - verification pass 2026-10-04: 0 items resolved, 1 kept

### 29-encryption-secrets — Encryption, Keys & Secrets
- Status: done (updated 2026-10-04 00:42 UTC)
- Files: `content/29-encryption-secrets/meta.json`, `content/29-encryption-secrets/lesson.md`, `content/29-encryption-secrets/flashcards.json`, `content/29-encryption-secrets/quiz.json`, `content/29-encryption-secrets/labs/01-kms-envelope-encryption.md`, `content/29-encryption-secrets/labs/02-parameter-store-secrets-manager.md`, `content/29-encryption-secrets/labs/03-encrypted-snapshot-copy-share.md`
- Open issues: none
- Notes:
  - authored; awaiting review
  - reviewed: confirmed on AWS pages and resolved all 5 VERIFY items (Secrets Manager replicas billed as distinct secrets, KMS quota table values, CloudHSM USD 1.60/h, Redshift direct HSM = CloudHSM Classic only); quiz q09 and q05 given deciding requirements, q07 D explanation fixed; lab 1 IAM prerequisites completed, lab 3 console path now sets KEY_ARN, lab 2 replica console labels matched to docs; SSE-C April 2026 block added to S3 replication table; 6 sources added
  - QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok

### 30-threat-protection — Threat Protection & Detection
- Status: done (updated 2026-10-04 03:16 UTC)
- Files: `content/30-threat-protection/meta.json`, `content/30-threat-protection/lesson.md`, `content/30-threat-protection/flashcards.json`, `content/30-threat-protection/quiz.json`, `content/30-threat-protection/labs/01-waf-web-acl-api-gateway.md`, `content/30-threat-protection/labs/02-guardduty-findings-eventbridge-sns.md`, `content/30-threat-protection/labs/03-macie-sensitive-data-discovery.md`
- Open issues:
  - Inspector default EC2 scan mode: scanning-ec2 doc says hybrid on first activation in one paragraph and agent-based default in another (VERIFY kept)
  - Macie 1 GB monthly free tier: user guide applies it to jobs and automated discovery, pricing page examples only to automated discovery (VERIFY added)
- Notes:
  - authored; awaiting review
  - reviewed: verified 15+ claims on AWS docs (WAF quotas/rate windows, Shield pricing/SRT/Anti-DDoS AMR, FMS policy types/pricing, GuardDuty defaults/severity/EventBridge, Inspector scan modes/pricing, Macie trial/free tier/MDIs); fixed GuardDuty default-plan wording, Macie trial/free-tier claims, Security Hub vs Security Hub CSPM note, rate-limit precision, Anti-DDoS inclusion; split two-fact flashcard (fc-09 replaced by fc-31); reworded q11, spread multi-answer letters; lab fixes (WAF console label, EventBridge target location, Macie job loop/cost)
  - QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok
  - verification pass 2026-10-04: 0 items resolved, 2 kept

### 31-vpc-fundamentals — VPC Fundamentals
- Status: done (updated 2026-10-04 03:16 UTC)
- Files: `meta.json`, `lesson.md`, `flashcards.json`, `quiz.json`, `labs/01-custom-vpc-bastion.md`, `labs/02-nat-instance-nat-gateway.md`, `labs/03-nacl-ephemeral-ports.md`
- Open issues:
  - Regional NAT gateway: docs and launch blog imply but do not state that the VPC needs an attached internet gateway (VERIFY marker kept)
  - Labs not run end to end in a live account; the AL2023 NAT user data and the CloudShell ProxyCommand hop are checked against docs only, and NACL/SG rules locked to the CloudShell IP must be refreshed if that IP changes
- Notes:
  - authored; awaiting review
  - reviewed: quiz answered blind (14/14 match); fixed lab 01 missing ssm:GetParameters prerequisite, removed lab 01 prompt to create an uncleaned second IGW, corrected Linux ephemeral range to 32768-60999 (dropped false updated badge), reworded regional NAT IP claim to match docs, fixed 'dashed box' text, clarified lab 03 NAT port note and lab 02 SG check, spread multi-select answers (q12 BE, q13 BDF), added 3 sources
  - QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok
  - verification pass 2026-10-04: 1 items resolved, 0 kept

### 32-vpc-connectivity — VPC Connectivity & Network Costs
- Status: done (updated 2026-10-04 03:16 UTC)
- Files: `meta.json`, `lesson.md`, `flashcards.json`, `quiz.json`, `labs/01-vpc-peering-flow-logs.md`, `labs/02-s3-gateway-endpoint.md`, `labs/03-ipv6-egress-only-igw.md`
- Open issues:
  - Direct Connect end-to-end lead time ('weeks, often more than a month') is not documented by AWS; only the 72-business-hour port provisioning is (lesson VERIFY + fc-31)
  - Slides' '7x cheaper S3 requests with CloudFront' does not match current list prices (lesson VERIFY callout)
- Notes:
  - authored; awaiting review
  - reviewed: quiz answers all confirmed (q09 D and q11 B tightened); DX dev/test SLA corrected (95% single-connection SLA), PrivateLink bandwidth corrected (10 Gbps per AZ, scales to 100), private-DNS label fixed; flashcards made one-fact (fc-09 retired, fc-31 DX lead time added); lab 02/03 cleanup reordered so instances terminate before the IAM role, lab 03 IPv6 query fixed; 5 sources added
  - QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok
  - verification pass 2026-10-04: 3 items resolved, 0 kept

### 33-disaster-recovery-migrations — Disaster Recovery & Migrations
- Status: done (updated 2026-10-04 03:16 UTC)
- Files: `content/33-disaster-recovery-migrations/meta.json`, `content/33-disaster-recovery-migrations/lesson.md`, `content/33-disaster-recovery-migrations/flashcards.json`, `content/33-disaster-recovery-migrations/quiz.json`, `content/33-disaster-recovery-migrations/labs/01-aws-backup-plan-copy-vault-lock.md`, `content/33-disaster-recovery-migrations/labs/02-dms-mysql-full-load-cdc.md`, `content/33-disaster-recovery-migrations/labs/03-drs-cross-region-drill.md`
- Open issues:
  - Lab 03: could not confirm on AWS docs whether accounts on the credit-based Free plan can initialize Elastic Disaster Recovery (VERIFY callout kept)
- Notes:
  - authored; awaiting review
  - reviewed: Lab 03 pinned to AL2023 kernel 6.12 AMI (default 6.18 unsupported by DRS) + kernel headers + DRS init in both Regions + role count fixed; Lab 02 Free-plan VERIFY resolved, Sandbox template label, DMS engine >=3.5.4; q03 given a cost requirement; MGN rename note no longer claims unconfirmed API facts; Vault Lock key concept and Auto Scaling note reworded; 8 new sources
  - QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok
  - verification pass 2026-10-04: 0 items resolved, 1 kept

### 34-more-architectures — More Solutions Architecture
- Status: done (updated 2026-10-04 03:16 UTC)
- Files: `content/34-more-architectures/meta.json`, `content/34-more-architectures/lesson.md`, `content/34-more-architectures/flashcards.json`, `content/34-more-architectures/quiz.json`, `content/34-more-architectures/labs/01-lambda-failures-sqs-fifo-sns.md`, `content/34-more-architectures/labs/02-apigw-kinesis-firehose-ingest.md`, `content/34-more-architectures/labs/03-ha-single-instance-eip-nacl.md`
- Open issues:
  - Snowmobile retirement still unconfirmed on docs.aws.amazon.com (press reports April 2024; Snowball page only says no Snow Family devices for new customers); VERIFY marker kept
  - Lab console labels for Firehose, EC2 launch template and Elastic IP pages checked against docs procedures only, not a live console screenshot
- Notes:
  - authored; awaiting review
  - reviewed: verified 20+ claims on AWS docs (all held); fixed Lambda DLQ vs destination wording (DLQ gets error attributes) in lesson, fc-06 and q03; fixed q07 Streams explanation; tightened fc-14; fixed lab 01 shell-variable tip and role cleanup; added 7 sources
  - QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok
  - verification pass 2026-10-04: 1 items resolved, 0 kept

### 35-other-services — Other Services
- Status: done (updated 2026-10-04 00:42 UTC)
- Files: `content/35-other-services/meta.json`, `content/35-other-services/lesson.md`, `content/35-other-services/flashcards.json`, `content/35-other-services/quiz.json`, `content/35-other-services/labs/01-cloudformation-stack-service-role.md`, `content/35-other-services/labs/02-systems-manager-session-run-patch.md`, `content/35-other-services/labs/03-cost-explorer-anomaly-detection.md`
- Open issues:
  - Lab 03 cleanup: console Delete for Cost Anomaly Detection subscriptions/monitors is not documented (docs show Edit only); steps now fall back to the confirmed CLI delete commands
  - Lab 01 step 6: whether CloudFormation is listed under IAM 'Service or use case' is unconfirmed; step now offers Custom trust policy as a fallback
- Notes:
  - authored; awaiting review
  - reviewed: multi-select answers moved off A+B, weak q10 distractor replaced, q15 endpoint SG note, service-role swap nuance (lesson+fc-04), Pinpoint tense, Cost Explorer +1M/daily and hourly-data pricing, multi-year 38 months, Outposts install wording, IAM 'Service or use case' labels with custom-trust fallback, lab cost wording, 8 sources added
  - QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok

### 36-well-architected-exam — Well-Architected & Exam Preparation
- Status: done (updated 2026-10-04 03:16 UTC)
- Files: `content/36-well-architected-exam/meta.json`, `content/36-well-architected-exam/lesson.md`, `content/36-well-architected-exam/flashcards.json`, `content/36-well-architected-exam/quiz.json`, `content/36-well-architected-exam/labs/01-well-architected-tool-review.md`, `content/36-well-architected-exam/labs/02-trusted-advisor-checks.md`
- Open issues:
  - Which official AWS Skill Builder practice resources (practice question set, practice exam) are free vs subscription is not stated on the exam page; VERIFY marker kept
  - Well-Architected Agent is preview; scope, Regions and plan eligibility may change before GA; VERIFY marker kept
- Notes:
  - authored; awaiting review
  - reviewed: verified ~30 claims on AWS docs (TA plans/checks/EventBridge/org view, support plans, WA framework revision/trade-offs/lenses/Agent, SAA-C03 format, cert line-up); fixed unsupported 'global results' claim for TA API, flash-sale wording, org-view plan requirement, TA history claim; added exam-day rules and flag/review rows; rebalanced multi-select answer letters; lab 1 CLI now targets the identities question; lab 2 IAM prereqs completed
  - QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok
  - verification pass 2026-10-04: 2 items resolved, 0 kept

<!-- progress-data
{
 "sections": {
  "01-getting-started": {
   "status": "done",
   "files": [
    "content/01-getting-started/meta.json",
    "content/01-getting-started/lesson.md",
    "content/01-getting-started/flashcards.json",
    "content/01-getting-started/quiz.json",
    "content/01-getting-started/labs/01-console-regions-azs.md",
    "content/01-getting-started/labs/02-zero-spend-budget.md"
   ],
   "issues": [
    "Lab 02 Step 3: Monthly cost budget template default thresholds (85%/100% actual, 100% forecast) are not on AWS docs; confirm in the console"
   ],
   "notes": [
    "authored; awaiting review",
    "reviewed: fixed Q4 stem (us-west-2 is not the Region nearest LA), Q8 option relying on a 4th London AZ, Q3 wording; lesson AZ counts (London has 3, 7th us-east-1 AZ coming), WAF Regional list, GA control plane in us-west-2, customer-count VERIFY resolved; lab01 Alt+S is Search not Services, Builder Center statuses softened; lab02 CLI now mirrors 3 template alerts; meta ESC link fixed, 6 sources added, lastVerified 2026-10-04",
    "QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok",
    "verification pass 2026-10-04: 0 items resolved, 1 kept"
   ],
   "updated": "2026-10-04 03:15 UTC"
  },
  "02-iam": {
   "status": "done",
   "files": [
    "content/02-iam/meta.json",
    "content/02-iam/lesson.md",
    "content/02-iam/flashcards.json",
    "content/02-iam/quiz.json",
    "content/02-iam/labs/01-users-groups-policies.md",
    "content/02-iam/labs/02-password-policy-mfa-reports.md",
    "content/02-iam/labs/03-access-keys-cli-roles.md"
   ],
   "issues": [],
   "notes": [
    "authored; awaiting review",
    "reviewed: verified 20+ claims on AWS docs (all numbers held); fixed centralized-root-access wording, 400-day tracking period, aws login permissions, Sign up for AWS (new/advanced) limits; redrew group diagram (was slide topology); replaced 2 implausible quiz distractors, added q15 (IAM global/DR); lab fixes: alias rules, credential report columns, MFA tab step, CloudShell QR download, admin-profile note, aws logout cleanup; added 3 sources, lastVerified 2026-10-04",
    "QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok"
   ],
   "updated": "2026-10-04 01:31 UTC"
  },
  "03-ec2-basics": {
   "status": "done",
   "files": [
    "content/03-ec2-basics/meta.json",
    "content/03-ec2-basics/lesson.md",
    "content/03-ec2-basics/flashcards.json",
    "content/03-ec2-basics/quiz.json",
    "content/03-ec2-basics/labs/01-web-server-user-data.md",
    "content/03-ec2-basics/labs/02-connect-ssh-instance-connect.md",
    "content/03-ec2-basics/labs/03-security-group-referencing.md"
   ],
   "issues": [
    "VERIFY kept: t8i.micro/t8i.small Free Tier eligibility differs between the EC2 burstable-instances page and the Free Tier usage page / aws.amazon.com/free"
   ],
   "notes": [
    "authored; awaiting review",
    "reviewed: fixed legacy Free Tier claims (t3.micro free only where t2.micro absent) in lesson and 3 labs; Q04 now has a cost requirement (i4i.16xlarge also has 512 GiB); EIC Endpoint wording fixed; lab CLI Region lookup fixed (configure get ignores env vars); removed --associate-public-ip-address; added EBS bandwidth, AMI/user-data nuance, Windows persist tag; 20+ claims checked on AWS docs",
    "QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok",
    "verification pass 2026-10-04: 0 items resolved, 2 kept"
   ],
   "updated": "2026-10-04 03:15 UTC"
  },
  "04-ec2-purchasing": {
   "status": "done",
   "files": [
    "content/04-ec2-purchasing/meta.json",
    "content/04-ec2-purchasing/lesson.md",
    "content/04-ec2-purchasing/flashcards.json",
    "content/04-ec2-purchasing/quiz.json",
    "content/04-ec2-purchasing/labs/01-compare-purchasing-prices.md",
    "content/04-ec2-purchasing/labs/02-spot-request-lifecycle.md",
    "content/04-ec2-purchasing/labs/03-capacity-reservation.md"
   ],
   "issues": [],
   "notes": [
    "authored; awaiting review",
    "reviewed: fixed decision tree (Convertible RI cannot change Region), Spot persistent-request/stop-interruption behaviour and state diagram, max-price wording, future-dated CR cancellation and Capacity Block wording, ASG has no diversified strategy (q09), q04/q06 explanations, fc-05/17/29; verified EC2 Instance SP, Convertible RI, Compute SP and Spot prices for m7i.large from AWS price data",
    "reviewed: fixed decision tree (Convertible RI cannot change Region), Spot persistent-request stop-interruption behaviour and state diagram, max-price wording, future-dated CR cancellation and Capacity Block wording, ASG has no diversified strategy (q09), q04/q06 explanations, fc-05/17/29; verified EC2 Instance SP, Convertible RI, Compute SP and Spot prices for m7i.large from AWS price data",
    "QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok"
   ],
   "updated": "2026-10-04 00:42 UTC"
  },
  "05-ec2-associate": {
   "status": "done",
   "files": [
    "content/05-ec2-associate/meta.json",
    "content/05-ec2-associate/lesson.md",
    "content/05-ec2-associate/flashcards.json",
    "content/05-ec2-associate/quiz.json",
    "content/05-ec2-associate/labs/01-public-ip-eip-eni.md",
    "content/05-ec2-associate/labs/02-placement-groups.md",
    "content/05-ec2-associate/labs/03-hibernate-instance.md"
   ],
   "issues": [],
   "notes": [
    "authored; awaiting review",
    "reviewed: verified 8+ claims on AWS docs (all held); rewrote q05 (MAC cannot move between ENIs), q08 (requirement made decisive), q12 (clearer stem); softened cluster correlated-failure claim; added peered-VPC, same-subnet ENI and 9th-gen hibernate details; fixed false CLI comment and used --count 2 in lab 2; added EIP/eth0 note and routing tip to lab 1; +2 flashcards; lastVerified 2026-10-04",
    "QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok"
   ],
   "updated": "2026-10-04 01:31 UTC"
  },
  "06-ec2-storage": {
   "status": "done",
   "files": [
    "content/06-ec2-storage/meta.json",
    "content/06-ec2-storage/lesson.md",
    "content/06-ec2-storage/flashcards.json",
    "content/06-ec2-storage/quiz.json",
    "content/06-ec2-storage/labs/01-ebs-volume-snapshot-encrypt.md",
    "content/06-ec2-storage/labs/02-custom-ami.md",
    "content/06-ec2-storage/labs/03-efs-shared-file-system.md"
   ],
   "issues": [
    "Lab 03 step 2: EFS custom-create docs do not list an automatic-backups checkbox (only the General edit page toggle is documented); VERIFY marker kept with a post-create fallback"
   ],
   "notes": [
    "authored; awaiting review",
    "reviewed: verified 30+ claims on AWS docs (gp3 64 TiB/80k IOPS, io2 BX, Multi-Attach, DeleteOnTermination table, Elastic Volumes 4/24h, volume copy, Archive, Recycle Bin, FSR, PRVI, encryption, EFS perf/prices/lifecycle, instance store IOPS); fixed lab 1 list-snapshots-in-recycle-bin flag (--snapshot-ids) and tag-level rule lock wording, AZ-safe t3.micro subnet pick in all 3 labs, archived-snapshot Recycle Bin recovery path (diagram + text), EFS storage-class latency/price table, DeleteOnTermination callout, multi-select keys spread (B/D, C/E, B/E), q05/q07 explanations; added Elastic Volumes flashcard, CHECKs in labs 2-3, 5 sources",
    "QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok",
    "verification pass 2026-10-04: 1 items resolved, 0 kept"
   ],
   "updated": "2026-10-04 03:15 UTC"
  },
  "07-elb": {
   "status": "done",
   "files": [
    "content/07-elb/meta.json",
    "content/07-elb/lesson.md",
    "content/07-elb/flashcards.json",
    "content/07-elb/quiz.json",
    "content/07-elb/labs/01-alb-two-instances.md",
    "content/07-elb/labs/02-alb-rules-stickiness-draining.md",
    "content/07-elb/labs/03-nlb-static-ips-cross-zone.md"
   ],
   "issues": [
    "Lab 03 step 4 console labels 'Assigned by AWS' / 'Use an Elastic IP address' are only in a re:Post article, not the ELB user guide (VERIFY marker kept)"
   ],
   "notes": [
    "authored; awaiting review",
    "reviewed: verified 20+ claims on AWS docs (all held); fixed NACL and UDP client-IP quiz explanations, ALB cross-zone/HTTP2/weighted-random wording, IP target ranges, NLB SG+QUIC caveat, UDP/QUIC health checks; labs: AZ-safe t3.micro subnet pick, nslookup install note, sticky cookie expiry and NLB curl CHECK wording; 8 sources added",
    "QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok",
    "verification pass 2026-10-04: 1 items resolved, 0 kept"
   ],
   "updated": "2026-10-04 03:18 UTC"
  },
  "08-asg": {
   "status": "done",
   "files": [
    "content/08-asg/meta.json",
    "content/08-asg/lesson.md",
    "content/08-asg/flashcards.json",
    "content/08-asg/quiz.json",
    "content/08-asg/labs/01-asg-behind-alb.md",
    "content/08-asg/labs/02-scaling-policies.md"
   ],
   "issues": [
    "Lab 01 step 4: AWS docs disagree on the ASG wizard page titles ('Integrate with other services' vs 'Configure advanced options'; 'Configure group size and scaling' vs '...scaling policies'); VERIFY marker kept, field labels are consistent"
   ],
   "notes": [
    "authored; awaiting review",
    "reviewed: verified 25+ claims on AWS docs (all held); fixed target tracking rounding wording, metric publishing, cooldown-at-creation and root-volume wording, SQS metric-math group-metrics note, lifecycle ABANDON/default-result path and diagram; added max instance lifetime, suspended processes, mixed-instances termination step, 2 flashcards; quiz: Q09 max-capacity premise, multi answers rebalanced off A+C; labs: realistic scale-in wait (lab 02), draining delay CHECK (lab 01); 3 sources added",
    "QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok",
    "verification pass 2026-10-04: 0 items resolved, 1 kept"
   ],
   "updated": "2026-10-04 03:18 UTC"
  },
  "09-rds-aurora-elasticache": {
   "status": "done",
   "files": [
    "content/09-rds-aurora-elasticache/meta.json",
    "content/09-rds-aurora-elasticache/lesson.md",
    "content/09-rds-aurora-elasticache/flashcards.json",
    "content/09-rds-aurora-elasticache/quiz.json",
    "content/09-rds-aurora-elasticache/labs/01-rds-mysql-replica-snapshot.md",
    "content/09-rds-aurora-elasticache/labs/02-aurora-endpoints-failover-clone.md",
    "content/09-rds-aurora-elasticache/labs/03-elasticache-valkey-patterns.md"
   ],
   "issues": [
    "VERIFY: Aurora ~20% per-hour premium over RDS (slide claim) not stated on current pricing pages",
    "VERIFY: Aurora volume growth increment of 10 GB (slide claim) not documented",
    "VERIFY: SASL authentication for ElastiCache Memcached not described in current ElastiCache docs",
    "VERIFY: whether Free plan accounts can create RDS for MySQL read replicas (Lab 01 Step 5)",
    "VERIFY: whether ElastiCache Serverless is available on the Free plan (Lab 03)"
   ],
   "notes": [
    "authored; awaiting review",
    "reviewed: fixed Lab 02 console cleanup (empty Aurora cluster kept billing), flagged Free plan can't run Lab 02 (Aurora = PG express only), fixed Free Tier engine/class detail, Backtrack enable rule, Valkey durability scope, custom-endpoint quota, leaderboard code block, Lab 01 cost/storage label, Lab 03 timing; spread multi-select answers; tightened 5 flashcards; added ZDP/Aurora features coverage; 15+ claims checked on AWS docs",
    "QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok",
    "verification pass 2026-10-04: 5 items resolved, 0 kept"
   ],
   "updated": "2026-10-04 03:18 UTC"
  },
  "10-route53": {
   "status": "done",
   "files": [
    "content/10-route53/meta.json",
    "content/10-route53/lesson.md",
    "content/10-route53/flashcards.json",
    "content/10-route53/quiz.json",
    "content/10-route53/labs/01-private-zone-records-routing.md",
    "content/10-route53/labs/02-health-checks-failover.md"
   ],
   "issues": [
    "VERIFY: number of Route 53 health checkers per endpoint (slides say about 15; AWS docs give no count)",
    "VERIFY: calculated health check child limit (API/console 256 vs quotas page 255)"
   ],
   "notes": [
    "authored; awaiting review",
    "reviewed: fixed lab cleanup claim (Route 53 does not block deleting in-use health checks), legacy Free Tier t2.micro note in both labs, DNS-flow diagram that implied Route 53 forwards traffic, added NOT-via-invert for calculated checks, CloudWatch alarm limits, accelerated recovery opt-in, health check billing for calculated/alarm checks, shuffled multi-select answers off A+B, trimmed 3 flashcards; 2 VERIFY markers remain",
    "QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok",
    "verification pass 2026-10-04: 1 items resolved, 1 kept"
   ],
   "updated": "2026-10-04 03:17 UTC"
  },
  "11-classic-architectures": {
   "status": "done",
   "files": [
    "content/11-classic-architectures/meta.json",
    "content/11-classic-architectures/lesson.md",
    "content/11-classic-architectures/flashcards.json",
    "content/11-classic-architectures/quiz.json",
    "content/11-classic-architectures/labs/01-beanstalk-web-app.md",
    "content/11-classic-architectures/labs/02-shared-uploads-efs.md"
   ],
   "issues": [
    "Lab 01 CLI path: docs do not confirm that LoadBalancerType=application is accepted at creation for a single-instance environment (API default is classic); VERIFY marker kept with a fallback"
   ],
   "notes": [
    "authored; awaiting review",
    "reviewed: fixed lab-01 legacy Free Tier claim (ALB hours are included) and IPv4/cost estimate, env URL format, single-instance events and tail-log CHECK; corrected worker-tier queue-depth scaling (built-in trigger cannot watch SQS); made q03 read-replica distractor plausible; tightened q02-D; lab-02 subnet pick now filters AZs offering t3.micro; added 2 flashcards (fixed-at-creation settings, three-tier subnets); 5 sources added, lastVerified 2026-10-04",
    "QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok",
    "verification pass 2026-10-04: 0 items resolved, 1 kept"
   ],
   "updated": "2026-10-04 03:17 UTC"
  },
  "12-s3-fundamentals": {
   "status": "done",
   "files": [
    "content/12-s3-fundamentals/meta.json",
    "content/12-s3-fundamentals/lesson.md",
    "content/12-s3-fundamentals/flashcards.json",
    "content/12-s3-fundamentals/quiz.json",
    "content/12-s3-fundamentals/labs/01-bucket-objects-static-website.md",
    "content/12-s3-fundamentals/labs/02-versioning-and-crr.md"
   ],
   "issues": [],
   "notes": [
    "authored; awaiting review",
    "reviewed: q09 rewritten (object size + lifecycle target so One Zone-IA is the only answer), q03/q12 explanations fixed, storage-class decision tree label fixed, website 403-masks-404 confirmed (VERIFY removed, diagram + KC source), versioning 15-min wording per docs, Express One Zone 80%/50% docs note, annotations/replication details, lab 01 console steps + CHECK fixes, lab 02 versioning wait; 47 sources, lastVerified 2026-10-04",
    "QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok"
   ],
   "updated": "2026-10-04 01:31 UTC"
  },
  "13-s3-advanced": {
   "status": "done",
   "files": [
    "content/13-s3-advanced/meta.json",
    "content/13-s3-advanced/lesson.md",
    "content/13-s3-advanced/flashcards.json",
    "content/13-s3-advanced/quiz.json",
    "content/13-s3-advanced/labs/01-lifecycle-rules.md",
    "content/13-s3-advanced/labs/02-event-notifications.md",
    "content/13-s3-advanced/labs/03-performance-batch-storage-lens.md"
   ],
   "issues": [
    "S3 events delivered to EventBridge: per-event charge not confirmed on S3 or EventBridge pricing pages (VERIFY in lesson and lab 02)",
    "Lab 03: label of the console button that confirms a suspended Batch Operations job not confirmed in docs (inline verify)",
    "Storage Lens free metric count (slides say about 28) not stated in current docs (VERIFY in lesson)"
   ],
   "notes": [
    "authored; awaiting review",
    "reviewed: Requester Pays 403 billing corrected, Storage Lens CloudWatch publishing limited to account/bucket level (lesson, Q12, new trap), Q05 ordering premise fixed, Q13 answers moved to B/D, CLI-only lab steps wrapped in cli blocks, unsafe grep -m1 pipe fixed, Batch Ops console/CLI steps tightened, fc-22/23 trimmed to one fact, sources + lastVerified updated",
    "QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok",
    "verification pass 2026-10-04: 4 items resolved, 0 kept"
   ],
   "updated": "2026-10-04 03:17 UTC"
  },
  "14-s3-security": {
   "status": "done",
   "files": [
    "content/14-s3-security/meta.json",
    "content/14-s3-security/lesson.md",
    "content/14-s3-security/flashcards.json",
    "content/14-s3-security/quiz.json",
    "content/14-s3-security/labs/01-encryption-https-presigned.md",
    "content/14-s3-security/labs/02-cors-access-logs.md",
    "content/14-s3-security/labs/03-object-lock-access-points.md"
   ],
   "issues": [
    "Glacier vault service closure date (15 Dec 2025) appears only in search snippets; current docs pages give no date, so it stays a VERIFY marker"
   ],
   "notes": [
    "authored; awaiting review",
    "reviewed: verified 14 claims on AWS docs (SSE-C default block, CW Logs delivery, KMS quotas, variable retention, presigned limits, access point limits, Object Lambda/Glacier closures); fixed SSE-KMS TLS-and-SigV4 wording, Vault Lock 24h wording, access point HTTPS/ops wording, decision-tree label, best-effort log wording; split two multi-fact flashcards and added 2 cards; reworded q07, fixed q13 NAT explanation, spread multi-select answers; honest Free Tier cost lines and corrected CORS preflight explanation in labs",
    "QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok",
    "verification pass 2026-10-04: 1 items resolved, 0 kept"
   ],
   "updated": "2026-10-04 03:18 UTC"
  },
  "15-cloudfront-global-accelerator": {
   "status": "done",
   "files": [
    "content/15-cloudfront-global-accelerator/meta.json",
    "content/15-cloudfront-global-accelerator/lesson.md",
    "content/15-cloudfront-global-accelerator/flashcards.json",
    "content/15-cloudfront-global-accelerator/quiz.json",
    "content/15-cloudfront-global-accelerator/labs/01-cloudfront-s3-oac.md",
    "content/15-cloudfront-global-accelerator/labs/02-global-accelerator-two-regions.md"
   ],
   "issues": [
    "Lab 01: CloudFront create-distribution wizard wording for the pay-as-you-go choice and the WAF opt-out option is not shown in docs (two inline verify markers remain)",
    "Lab 02: could not confirm from AWS docs whether Global Accelerator is available on Free account plan (post-15 July 2025) accounts; VERIFY callout added"
   ],
   "notes": [
    "authored; awaiting review",
    "reviewed: fixed Price Class 200 regions, CRR timing (no guarantee without RTC), REC skip for same-Region S3, GA established-connection behaviour, tag invalidation opt-in; rebuilt decision diagram; tightened q02/q08/q11/q13; added price-class card; lab fixes (invalidation count, GA wizard verify resolved, Free plan VERIFY, t3.micro AZ tip)",
    "QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok",
    "verification pass 2026-10-04: 1 items resolved, 2 kept"
   ],
   "updated": "2026-10-04 03:18 UTC"
  },
  "16-storage-extras": {
   "status": "done",
   "files": [
    "content/16-storage-extras/meta.json",
    "content/16-storage-extras/lesson.md",
    "content/16-storage-extras/flashcards.json",
    "content/16-storage-extras/quiz.json",
    "content/16-storage-extras/labs/01-datasync-s3-to-s3.md",
    "content/16-storage-extras/labs/02-transfer-family-sftp.md",
    "content/16-storage-extras/labs/03-s3-file-gateway-ec2.md"
   ],
   "issues": [
    "Free plan availability of DataSync, Transfer Family and Storage Gateway not confirmable on AWS docs (VERIFY markers in labs 1-3)",
    "Snowmobile retirement date (April 2024) only in press reports, not AWS docs (VERIFY marker kept)"
   ],
   "notes": [
    "authored; awaiting review",
    "reviewed: verified 20+ claims on AWS docs (all core numbers held); fixed lab 3 Free-plan blocker (m5.xlarge needs Paid plan) and fragile list-local-disks query, lab 2 sftp batch abort on cd, lab 1 object-count CHECK; quiz: rebalanced multi answers (q11 B/D, q15 C/E), replaced weak q15 distractor with Lustre Multi-AZ trap, de-risked q13 capacity and q01/q04 wording; flashcards split fc-26 into fc-26/29/30 and trimmed fc-07 overlap; lesson: Enhanced-mode scope, FSx Windows regional limits, Outposts 7-day DDIL, Lustre Intelligent-Tiering throughput; meta sources + lastVerified 2026-10-04",
    "QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok",
    "verification pass 2026-10-04: 4 items resolved, 0 kept"
   ],
   "updated": "2026-10-04 03:18 UTC"
  },
  "17-sqs-sns": {
   "status": "done",
   "files": [
    "content/17-sqs-sns/meta.json",
    "content/17-sqs-sns/lesson.md",
    "content/17-sqs-sns/flashcards.json",
    "content/17-sqs-sns/quiz.json",
    "content/17-sqs-sns/labs/01-sqs-queue-visibility-dlq.md",
    "content/17-sqs-sns/labs/02-sqs-fifo-ordering-dedup.md",
    "content/17-sqs-sns/labs/03-sns-fanout-filtering.md"
   ],
   "issues": [],
   "notes": [
    "authored; awaiting review",
    "reviewed: SQS latency corrected to tens-hundreds ms (FAQ), SSE-SQS default scoped to new queues with both 2022 dates, added SQS FIFO cannot subscribe to standard SNS topic (lesson, trap, Q11, new card), Lambda as SNS publisher, Q05/Q09 deciding requirements, split SNS limits card, lab console poll fixes, sources + lastVerified",
    "QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok"
   ],
   "updated": "2026-10-04 01:31 UTC"
  },
  "18-kinesis-mq": {
   "status": "done",
   "files": [
    "content/18-kinesis-mq/meta.json",
    "content/18-kinesis-mq/lesson.md",
    "content/18-kinesis-mq/flashcards.json",
    "content/18-kinesis-mq/quiz.json",
    "content/18-kinesis-mq/labs/01-kinesis-produce-consume-replay.md",
    "content/18-kinesis-mq/labs/02-firehose-stream-to-s3.md",
    "content/18-kinesis-mq/labs/03-amazon-mq-activemq-broker.md"
   ],
   "issues": [
    "Free plan availability of Kinesis Data Streams and Firehose not confirmed (labs 01-02 carry VERIFY)",
    "Amazon MQ create-broker Network and security labels and ActiveMQ web console labels not confirmable from docs (lab 03 VERIFY)"
   ],
   "notes": [
    "authored; awaiting review",
    "reviewed: verified 20+ claims on AWS docs/price list (all numbers held); fixed misleading shard-to-consumer and decision-tree diagrams, mq.m7g wrongly listed for ActiveMQ, EFO cost row, added on-demand 4,000 records/s, Firehose payload formats, SNS FIFO archive nuance, 2 flashcards, tightened Q08, lab console labels (Edit provisioned shards, Data Viewer), Free plan notes, lab 02 freeTier no, :::console blocks in lab 03",
    "QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok",
    "verification pass 2026-10-04: 1 items resolved, 3 kept"
   ],
   "updated": "2026-10-04 03:17 UTC"
  },
  "19-containers": {
   "status": "done",
   "files": [
    "meta.json",
    "lesson.md",
    "flashcards.json",
    "quiz.json",
    "labs/01-ecr-build-push-scan.md",
    "labs/02-ecs-fargate-alb-autoscaling.md"
   ],
   "issues": [
    "ECR 500 MB/month private-storage Free Tier is listed for new customers for one year; could not confirm whether it applies to accounts on the post-15-July-2025 Free plan (VERIFY marker kept in lesson)"
   ],
   "notes": [
    "authored; awaiting review",
    "reviewed: verified 20+ claims on AWS docs (Fargate sizes/prices, Managed Instances, LB types, storage, S3 Files, App Runner/Express Mode, ECR scanning/pricing, EKS Fargate/Auto Mode/pricing, ECS Anywhere); fixed execution-role overstatement, basic-scanning default, Managed Instances lifetime wording, isolation warning, added Docker volumes row; resolved lab 01 basic-scanning VERIFY, made lab 01 Dockerfile use uname -n and start a scan for console users, removed unconfirmed GovCloud claim; lab 02 cleanup adds CloudFormation check; quiz q07/q11 explanations and wording tightened; flashcards fc-23/26/29 made single-fact",
    "QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok",
    "verification pass 2026-10-04: 1 items resolved, 0 kept"
   ],
   "updated": "2026-10-04 03:17 UTC"
  },
  "20-lambda": {
   "status": "done",
   "files": [
    "content/20-lambda/meta.json",
    "content/20-lambda/lesson.md",
    "content/20-lambda/flashcards.json",
    "content/20-lambda/quiz.json",
    "content/20-lambda/labs/01-lambda-throttling-async-destinations.md",
    "content/20-lambda/labs/02-s3-trigger-dynamodb-scheduler.md"
   ],
   "issues": [],
   "notes": [
    "authored; awaiting review",
    "reviewed: verified 20+ claims on AWS docs (all lesson numbers held); fixed wrong q05 option-B reason (origin-response edits are cached), replaced weak q06 distractor, added VPC context to q10, respread multi-select keys; split two-fact flashcards (+2 cards, 30 total); qualified 10x RPS cap as synchronous-only; added Managed Instances 90-min note; lab 01 Step 7 queue read now lists all records (old 2001 message reappears), get-queue-url tip, exact console labels; labs now clean up console-created customer managed IAM policies; softened Scheduler free-tier wording",
    "QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok",
    "verification pass 2026-10-04: 1 items resolved, 0 kept"
   ],
   "updated": "2026-10-04 03:17 UTC"
  },
  "21-dynamodb-apigw-cognito": {
   "status": "done",
   "files": [
    "content/21-dynamodb-apigw-cognito/meta.json",
    "content/21-dynamodb-apigw-cognito/lesson.md",
    "content/21-dynamodb-apigw-cognito/flashcards.json",
    "content/21-dynamodb-apigw-cognito/quiz.json",
    "content/21-dynamodb-apigw-cognito/labs/01-dynamodb-table-features.md",
    "content/21-dynamodb-apigw-cognito/labs/02-serverless-crud-api.md",
    "content/21-dynamodb-apigw-cognito/labs/03-step-functions-order-workflow.md"
   ],
   "issues": [
    "Lab 01: DynamoDB docs disagree on which capacity mode the console's Default settings applies (capacity-mode page says on-demand is default; auto scaling console page says Default settings enable auto scaling). Labs pick On-demand explicitly; VERIFY marker kept."
   ],
   "notes": [
    "authored; awaiting review",
    "reviewed: verified 20+ claims on AWS docs (capacity modes, pricing, global tables MRSC, PITR, export/import, DAX, Streams, API Gateway quotas/endpoints, Step Functions quotas, Cognito plans, Lambda runtimes); fixed MRSC Streams wording, on-demand free-tier row, Cognito email MFA plans, parallel branch in state diagram, quiz q05/q14 wording, flashcards fc-26/fc-28, lab 01 restore waiter note",
    "QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok",
    "verification pass 2026-10-04: 0 items resolved, 1 kept"
   ],
   "updated": "2026-10-04 03:16 UTC"
  },
  "22-serverless-architectures": {
   "status": "done",
   "files": [
    "content/22-serverless-architectures/meta.json",
    "content/22-serverless-architectures/lesson.md",
    "content/22-serverless-architectures/flashcards.json",
    "content/22-serverless-architectures/quiz.json",
    "content/22-serverless-architectures/labs/01-cognito-per-user-s3-folders.md",
    "content/22-serverless-architectures/labs/02-dynamodb-streams-welcome-email.md"
   ],
   "issues": [
    "Lab 01 step 2: Cognito console label 'Mobile app' for the application type is still unconfirmed in AWS docs (VERIFY marker kept)",
    "Lab 02 step 5: Lambda guide says DynamoDB ESMs filter only on the dynamodb key, DynamoDB guide and AWS re:Post say eventName works; VERIFY kept, function code guards INSERT anyway"
   ],
   "notes": [
    "authored; awaiting review",
    "reviewed: verified 15+ claims on AWS docs (all held); split fc-12 into TTL card + new fc-28; Q03 given a response size under the 1 MB cache limit; lesson adds 1 MB cached-response limit, clarifies cache keys, Lambda invoke via identity pool role and authorizer billing wording; lab 02 console paths now capture STREAM_ARN/ROLE_ARN/ESM_UUID; lab 01 offers SPA as alternative app type",
    "QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok",
    "verification pass 2026-10-04: 2 items resolved, 0 kept"
   ],
   "updated": "2026-10-04 03:16 UTC"
  },
  "23-databases": {
   "status": "done",
   "files": [
    "content/23-databases/meta.json",
    "content/23-databases/lesson.md",
    "content/23-databases/flashcards.json",
    "content/23-databases/quiz.json",
    "content/23-databases/labs/01-keyspaces-iot-readings.md",
    "content/23-databases/labs/02-documentdb-json-catalog.md"
   ],
   "issues": [
    "Lab 02: names of the security groups or ingress rules that DocumentDB Connect to cluster (CloudShell) creates, and whether deleting the CloudShell VPC environment removes them, are not documented by AWS"
   ],
   "notes": [
    "authored; awaiting review",
    "reviewed: resolved DocumentDB price VERIFY via AWS Price List (USD 0.078/h), added --storage-encrypted to lab 02 CLI and fixed DocumentDB encryption claim, QuickSight to Amazon Quick Sight UPDATED marker, ElastiCache backup wording, Glacier Vault Lock, fc-02 OLTP scope, new fc-30 (ElastiCache no PITR), Q05 payer-account ambiguity, Q13 option D explanation",
    "QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok",
    "verification pass 2026-10-04: 0 items resolved, 1 kept"
   ],
   "updated": "2026-10-04 03:16 UTC"
  },
  "24-data-analytics": {
   "status": "done",
   "files": [
    "meta.json",
    "lesson.md",
    "flashcards.json",
    "quiz.json",
    "labs/01-athena-partitions-parquet.md",
    "labs/02-glue-crawler-etl-bookmarks.md",
    "labs/03-redshift-serverless-copy-spectrum.md"
   ],
   "issues": [
    "Glue crawler 10-minute minimum billed duration not visible on the rendered Glue pricing page (third-party sources only); VERIFY marker kept in lesson",
    "Lab 03: docs confirm the creator-is-admin behaviour only for console-created Redshift Serverless namespaces; CLI path keeps a VERIFY with a console fallback"
   ],
   "notes": [
    "authored; awaiting review",
    "reviewed: confirmed key limits/prices on AWS docs; resolved Quick pricing and Glue 6.0 price verifies; added Athena 10 MB minimum; fixed Parquet cost example; MSK KRaft/Kafka 4 note; softened Flink AZ claim; fixed q11 D explanation; lab 03 CLI-admin fallback and console labels; lab 02 cleanup of logs-v2 and sparkHistoryLogs",
    "QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok",
    "verification pass 2026-10-04: 1 items resolved, 1 kept",
    "verification pass 2026-10-04: 1 items resolved, 1 kept"
   ],
   "updated": "2026-10-04 03:18 UTC"
  },
  "25-machine-learning": {
   "status": "done",
   "files": [
    "content/25-machine-learning/meta.json",
    "content/25-machine-learning/lesson.md",
    "content/25-machine-learning/flashcards.json",
    "content/25-machine-learning/quiz.json",
    "content/25-machine-learning/labs/01-vision-documents-text-apis.md",
    "content/25-machine-learning/labs/02-polly-transcribe-speech.md",
    "content/25-machine-learning/labs/03-lex-chatbot-from-example.md"
   ],
   "issues": [
    "Lab 03: confirm in a live run whether OrderFlowers ends in Fulfilled or ReadyForFulfillment with no Lambda (lab accepts either)",
    "Lab 03: Lex pricing page does not say whether console test-window / TSTALIASID messages are billed as text requests",
    "Lab 02: Transcribe console labels (Browse S3, Service-managed S3 bucket) and Polly Engine/Voice selectors come from doc text, not screenshots"
   ],
   "notes": [
    "authored; awaiting review",
    "reviewed: quiz key confirmed (15/15); added Rekognition Streaming Video/Bulk Image Analysis closure (30 Apr 2026) callout + fc-30; flat Transcribe batch rate note; Ground Truth/Model Monitor maintenance markers; Polly unsupported-SSML error scoped to standard/neural/long-form (lesson, q09); lab 02 redaction CHECK (DATE_TIME/PIN), service-managed bucket cleanup wording, langid job CLI cleanup; lab 03 Assisted NLU note; lab 01 targeted-sentiment hedge; 6 sources added",
    "QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok",
    "verification pass 2026-10-04: 1 items resolved, 0 kept",
    "verification pass 2026-10-04: 1 items resolved, 0 kept"
   ],
   "updated": "2026-10-04 03:18 UTC"
  },
  "26-cloudwatch-eventbridge": {
   "status": "done",
   "files": [
    "content/26-cloudwatch-eventbridge/meta.json",
    "content/26-cloudwatch-eventbridge/lesson.md",
    "content/26-cloudwatch-eventbridge/flashcards.json",
    "content/26-cloudwatch-eventbridge/quiz.json",
    "content/26-cloudwatch-eventbridge/labs/01-log-metric-filter-alarm.md",
    "content/26-cloudwatch-eventbridge/labs/02-cloudwatch-agent-ec2-recovery.md",
    "content/26-cloudwatch-eventbridge/labs/03-eventbridge-rules-archive-replay.md"
   ],
   "issues": [],
   "notes": [
    "authored; awaiting review",
    "reviewed: verified 20+ claims on AWS docs; resolved high-res alarm price (USD 0.30), fixed EC2 aggregate-metric claim, removed unconfirmed IMDSv2 claim for old agent, recover alarm uses Minimum per AWS procedure, softened basic-monitoring period rule, noted docs conflict on 5 vs 2 subscription filters, refined new Custom Event Bus pricing/Regions, q10 wording, q05/q03 explanations, lab 03 classic-bus type choice, lab 01 graph CHECK, 5 sources added",
    "QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok"
   ],
   "updated": "2026-10-04 00:42 UTC"
  },
  "27-cloudtrail-config": {
   "status": "done",
   "files": [
    "meta.json",
    "lesson.md",
    "flashcards.json",
    "quiz.json",
    "labs/01-cloudtrail-trail-eventbridge-alert.md",
    "labs/02-config-rule-timeline-remediation.md"
   ],
   "issues": [
    "Lesson is about 5,700 words (including tables and code), above the 1,500-4,500 guideline; not trimmed",
    "Lab 01 Step 5: whether the EventBridge console grants the SNS target through the topic access policy or an execution role depends on account settings (role manager); the lab covers both cases but this was not checked in a live account"
   ],
   "notes": [
    "authored; awaiting review",
    "reviewed: lab01 lookup-events uses documented --max-items; quiz q11/q13 distractors rewritten, q02/q05 explanations fixed; lesson notes proactive mode now limited to 2 managed rules, remediation role needed for manual and automatic, Guard rules trigger on changes only; diagram notes trail requirement for EventBridge; 3 sources added",
    "QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok"
   ],
   "updated": "2026-10-04 00:42 UTC"
  },
  "28-advanced-identity": {
   "status": "done",
   "files": [
    "content/28-advanced-identity/meta.json",
    "content/28-advanced-identity/lesson.md",
    "content/28-advanced-identity/flashcards.json",
    "content/28-advanced-identity/quiz.json",
    "content/28-advanced-identity/labs/01-organization-ou-scp.md",
    "content/28-advanced-identity/labs/02-identity-center-sso.md",
    "content/28-advanced-identity/labs/03-boundary-conditions-simulator.md"
   ],
   "issues": [
    "SCP syntax page still says Allow statements may use only Resource \"*\", contradicting the Sep 2025 announcement of resource ARN support; lesson keeps a VERIFY marker"
   ],
   "notes": [
    "authored; awaiting review",
    "reviewed: 12+ claims checked on AWS docs (all confirmed); fixed evaluation-order key concept, PrincipalOrgID service-principal wording, cross-account table, added RCP limits, custom SAML app setup, Control Tower Identity Center opt-out, Free plan + Control Tower note; quiz q11 explanation and q12 deciding requirement; fc-28; lab 01 quota CHECK and disable-SCP label, lab 02 CLI prompt and password CHECK, lab 03 MFA CHECK hedge; 7 sources added",
    "QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok",
    "verification pass 2026-10-04: 0 items resolved, 1 kept",
    "verification pass 2026-10-04: 0 items resolved, 1 kept"
   ],
   "updated": "2026-10-04 03:18 UTC"
  },
  "29-encryption-secrets": {
   "status": "done",
   "files": [
    "content/29-encryption-secrets/meta.json",
    "content/29-encryption-secrets/lesson.md",
    "content/29-encryption-secrets/flashcards.json",
    "content/29-encryption-secrets/quiz.json",
    "content/29-encryption-secrets/labs/01-kms-envelope-encryption.md",
    "content/29-encryption-secrets/labs/02-parameter-store-secrets-manager.md",
    "content/29-encryption-secrets/labs/03-encrypted-snapshot-copy-share.md"
   ],
   "issues": [],
   "notes": [
    "authored; awaiting review",
    "reviewed: confirmed on AWS pages and resolved all 5 VERIFY items (Secrets Manager replicas billed as distinct secrets, KMS quota table values, CloudHSM USD 1.60/h, Redshift direct HSM = CloudHSM Classic only); quiz q09 and q05 given deciding requirements, q07 D explanation fixed; lab 1 IAM prerequisites completed, lab 3 console path now sets KEY_ARN, lab 2 replica console labels matched to docs; SSE-C April 2026 block added to S3 replication table; 6 sources added",
    "QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok"
   ],
   "updated": "2026-10-04 00:42 UTC"
  },
  "30-threat-protection": {
   "status": "done",
   "files": [
    "content/30-threat-protection/meta.json",
    "content/30-threat-protection/lesson.md",
    "content/30-threat-protection/flashcards.json",
    "content/30-threat-protection/quiz.json",
    "content/30-threat-protection/labs/01-waf-web-acl-api-gateway.md",
    "content/30-threat-protection/labs/02-guardduty-findings-eventbridge-sns.md",
    "content/30-threat-protection/labs/03-macie-sensitive-data-discovery.md"
   ],
   "issues": [
    "Inspector default EC2 scan mode: scanning-ec2 doc says hybrid on first activation in one paragraph and agent-based default in another (VERIFY kept)",
    "Macie 1 GB monthly free tier: user guide applies it to jobs and automated discovery, pricing page examples only to automated discovery (VERIFY added)"
   ],
   "notes": [
    "authored; awaiting review",
    "reviewed: verified 15+ claims on AWS docs (WAF quotas/rate windows, Shield pricing/SRT/Anti-DDoS AMR, FMS policy types/pricing, GuardDuty defaults/severity/EventBridge, Inspector scan modes/pricing, Macie trial/free tier/MDIs); fixed GuardDuty default-plan wording, Macie trial/free-tier claims, Security Hub vs Security Hub CSPM note, rate-limit precision, Anti-DDoS inclusion; split two-fact flashcard (fc-09 replaced by fc-31); reworded q11, spread multi-answer letters; lab fixes (WAF console label, EventBridge target location, Macie job loop/cost)",
    "QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok",
    "verification pass 2026-10-04: 0 items resolved, 2 kept"
   ],
   "updated": "2026-10-04 03:16 UTC"
  },
  "31-vpc-fundamentals": {
   "status": "done",
   "files": [
    "meta.json",
    "lesson.md",
    "flashcards.json",
    "quiz.json",
    "labs/01-custom-vpc-bastion.md",
    "labs/02-nat-instance-nat-gateway.md",
    "labs/03-nacl-ephemeral-ports.md"
   ],
   "issues": [
    "Regional NAT gateway: docs and launch blog imply but do not state that the VPC needs an attached internet gateway (VERIFY marker kept)",
    "Labs not run end to end in a live account; the AL2023 NAT user data and the CloudShell ProxyCommand hop are checked against docs only, and NACL/SG rules locked to the CloudShell IP must be refreshed if that IP changes"
   ],
   "notes": [
    "authored; awaiting review",
    "reviewed: quiz answered blind (14/14 match); fixed lab 01 missing ssm:GetParameters prerequisite, removed lab 01 prompt to create an uncleaned second IGW, corrected Linux ephemeral range to 32768-60999 (dropped false updated badge), reworded regional NAT IP claim to match docs, fixed 'dashed box' text, clarified lab 03 NAT port note and lab 02 SG check, spread multi-select answers (q12 BE, q13 BDF), added 3 sources",
    "QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok",
    "verification pass 2026-10-04: 1 items resolved, 0 kept"
   ],
   "updated": "2026-10-04 03:16 UTC"
  },
  "32-vpc-connectivity": {
   "status": "done",
   "files": [
    "meta.json",
    "lesson.md",
    "flashcards.json",
    "quiz.json",
    "labs/01-vpc-peering-flow-logs.md",
    "labs/02-s3-gateway-endpoint.md",
    "labs/03-ipv6-egress-only-igw.md"
   ],
   "issues": [
    "Direct Connect end-to-end lead time ('weeks, often more than a month') is not documented by AWS; only the 72-business-hour port provisioning is (lesson VERIFY + fc-31)",
    "Slides' '7x cheaper S3 requests with CloudFront' does not match current list prices (lesson VERIFY callout)"
   ],
   "notes": [
    "authored; awaiting review",
    "reviewed: quiz answers all confirmed (q09 D and q11 B tightened); DX dev/test SLA corrected (95% single-connection SLA), PrivateLink bandwidth corrected (10 Gbps per AZ, scales to 100), private-DNS label fixed; flashcards made one-fact (fc-09 retired, fc-31 DX lead time added); lab 02/03 cleanup reordered so instances terminate before the IAM role, lab 03 IPv6 query fixed; 5 sources added",
    "QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok",
    "verification pass 2026-10-04: 3 items resolved, 0 kept"
   ],
   "updated": "2026-10-04 03:16 UTC"
  },
  "33-disaster-recovery-migrations": {
   "status": "done",
   "files": [
    "content/33-disaster-recovery-migrations/meta.json",
    "content/33-disaster-recovery-migrations/lesson.md",
    "content/33-disaster-recovery-migrations/flashcards.json",
    "content/33-disaster-recovery-migrations/quiz.json",
    "content/33-disaster-recovery-migrations/labs/01-aws-backup-plan-copy-vault-lock.md",
    "content/33-disaster-recovery-migrations/labs/02-dms-mysql-full-load-cdc.md",
    "content/33-disaster-recovery-migrations/labs/03-drs-cross-region-drill.md"
   ],
   "issues": [
    "Lab 03: could not confirm on AWS docs whether accounts on the credit-based Free plan can initialize Elastic Disaster Recovery (VERIFY callout kept)"
   ],
   "notes": [
    "authored; awaiting review",
    "reviewed: Lab 03 pinned to AL2023 kernel 6.12 AMI (default 6.18 unsupported by DRS) + kernel headers + DRS init in both Regions + role count fixed; Lab 02 Free-plan VERIFY resolved, Sandbox template label, DMS engine >=3.5.4; q03 given a cost requirement; MGN rename note no longer claims unconfirmed API facts; Vault Lock key concept and Auto Scaling note reworded; 8 new sources",
    "QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok",
    "verification pass 2026-10-04: 0 items resolved, 1 kept"
   ],
   "updated": "2026-10-04 03:16 UTC"
  },
  "34-more-architectures": {
   "status": "done",
   "files": [
    "content/34-more-architectures/meta.json",
    "content/34-more-architectures/lesson.md",
    "content/34-more-architectures/flashcards.json",
    "content/34-more-architectures/quiz.json",
    "content/34-more-architectures/labs/01-lambda-failures-sqs-fifo-sns.md",
    "content/34-more-architectures/labs/02-apigw-kinesis-firehose-ingest.md",
    "content/34-more-architectures/labs/03-ha-single-instance-eip-nacl.md"
   ],
   "issues": [
    "Snowmobile retirement still unconfirmed on docs.aws.amazon.com (press reports April 2024; Snowball page only says no Snow Family devices for new customers); VERIFY marker kept",
    "Lab console labels for Firehose, EC2 launch template and Elastic IP pages checked against docs procedures only, not a live console screenshot"
   ],
   "notes": [
    "authored; awaiting review",
    "reviewed: verified 20+ claims on AWS docs (all held); fixed Lambda DLQ vs destination wording (DLQ gets error attributes) in lesson, fc-06 and q03; fixed q07 Streams explanation; tightened fc-14; fixed lab 01 shell-variable tip and role cleanup; added 7 sources",
    "QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok",
    "verification pass 2026-10-04: 1 items resolved, 0 kept"
   ],
   "updated": "2026-10-04 03:16 UTC"
  },
  "35-other-services": {
   "status": "done",
   "files": [
    "content/35-other-services/meta.json",
    "content/35-other-services/lesson.md",
    "content/35-other-services/flashcards.json",
    "content/35-other-services/quiz.json",
    "content/35-other-services/labs/01-cloudformation-stack-service-role.md",
    "content/35-other-services/labs/02-systems-manager-session-run-patch.md",
    "content/35-other-services/labs/03-cost-explorer-anomaly-detection.md"
   ],
   "issues": [
    "Lab 03 cleanup: console Delete for Cost Anomaly Detection subscriptions/monitors is not documented (docs show Edit only); steps now fall back to the confirmed CLI delete commands",
    "Lab 01 step 6: whether CloudFormation is listed under IAM 'Service or use case' is unconfirmed; step now offers Custom trust policy as a fallback"
   ],
   "notes": [
    "authored; awaiting review",
    "reviewed: multi-select answers moved off A+B, weak q10 distractor replaced, q15 endpoint SG note, service-role swap nuance (lesson+fc-04), Pinpoint tense, Cost Explorer +1M/daily and hourly-data pricing, multi-year 38 months, Outposts install wording, IAM 'Service or use case' labels with custom-trust fallback, lab cost wording, 8 sources added",
    "QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok"
   ],
   "updated": "2026-10-04 00:42 UTC"
  },
  "36-well-architected-exam": {
   "status": "done",
   "files": [
    "content/36-well-architected-exam/meta.json",
    "content/36-well-architected-exam/lesson.md",
    "content/36-well-architected-exam/flashcards.json",
    "content/36-well-architected-exam/quiz.json",
    "content/36-well-architected-exam/labs/01-well-architected-tool-review.md",
    "content/36-well-architected-exam/labs/02-trusted-advisor-checks.md"
   ],
   "issues": [
    "Which official AWS Skill Builder practice resources (practice question set, practice exam) are free vs subscription is not stated on the exam page; VERIFY marker kept",
    "Well-Architected Agent is preview; scope, Regions and plan eligibility may change before GA; VERIFY marker kept"
   ],
   "notes": [
    "authored; awaiting review",
    "reviewed: verified ~30 claims on AWS docs (TA plans/checks/EventBridge/org view, support plans, WA framework revision/trade-offs/lenses/Agent, SAA-C03 format, cert line-up); fixed unsupported 'global results' claim for TA API, flash-sale wording, org-view plan requirement, TA history claim; added exam-day rules and flag/review rows; rebalanced multi-select answer letters; lab 1 CLI now targets the identities question; lab 2 IAM prereqs completed",
    "QA 2026-10-04: validator 0 errors, verbatim 0 spans, npm run build ok, /check render ok",
    "verification pass 2026-10-04: 2 items resolved, 0 kept"
   ],
   "updated": "2026-10-04 03:16 UTC"
  }
 },
 "milestones": {
  "extract": {
   "status": "done",
   "note": "876 slides -> _extract/text (18 batch files) + _extract/pages (876 jpg)",
   "updated": "2026-10-03 14:09 UTC"
  },
  "plan": {
   "status": "done",
   "note": "36 sections",
   "updated": "2026-10-03 14:09 UTC"
  },
  "content-format": {
   "status": "done",
   "note": "content/README.md, course.json (13 parts), services.json (189 services), tools/validate_content.mjs, tools/check_verbatim.py",
   "updated": "2026-10-03 14:19 UTC"
  },
  "design": {
   "status": "done",
   "note": "Canvas 'Quiet Blueprint' (16 artboards) + design/DESIGN_SPEC.md; implemented in src/styles",
   "updated": "2026-10-03 19:51 UTC"
  },
  "app-shell": {
   "status": "done",
   "note": "Top bar + course sidebar + drawer below 1024px; exam focus mode; light/dark",
   "updated": "2026-10-03 19:51 UTC"
  },
  "lesson-page": {
   "status": "done",
   "note": "Tabs Lesson/Flashcards/Quiz/Lab, Mermaid figures, callouts, badges, tables, TOC, sources",
   "updated": "2026-10-03 19:51 UTC"
  },
  "flashcards": {
   "status": "done",
   "note": "Easy/Hard SRS (src/lib/srs.ts); Hard requeues after 3 cards and returns in 10 min",
   "updated": "2026-10-03 19:51 UTC"
  },
  "quiz": {
   "status": "done",
   "note": "Per section + mixed review (sections, size, domain, unseen/missed filters)",
   "updated": "2026-10-03 19:51 UTC"
  },
  "exam": {
   "status": "done",
   "note": "65 questions weighted by domain, 130-min timer, flag/navigator, results by domain and section",
   "updated": "2026-10-03 19:51 UTC"
  },
  "weak-areas": {
   "status": "done",
   "note": "Missed questions until 2 right in a row; cards rated Hard repeatedly",
   "updated": "2026-10-03 19:51 UTC"
  },
  "home": {
   "status": "done",
   "note": "Dashboard tiles, continue card, part progress, grid knowledge map with hover card",
   "updated": "2026-10-03 19:51 UTC"
  },
  "search": {
   "status": "done",
   "note": "MiniSearch over lessons (per heading), cards, questions, labs; Ctrl+K palette + results page",
   "updated": "2026-10-03 19:51 UTC"
  },
  "progress-store": {
   "status": "done",
   "note": "localStorage learnaws:v1 with export/import/reset; settings for theme, shortcuts, lab mode",
   "updated": "2026-10-03 19:51 UTC"
  },
  "final-qa": {
   "status": "done",
   "note": "36/36 sections: validator 0 errors/0 warnings, verbatim 0 spans, build ok, /check 36 sections 226 diagrams 0 problems; app code review findings fixed",
   "updated": "2026-10-04 01:31 UTC"
  }
 }
}
-->
