# PLAN — AWS SAA-C03 interactive study site

Source: `AWS Certified Solutions Architect Slides v48.pdf` (876 slides, SAA-C03 course).
Goal: a local Vite + React + TypeScript site with lessons, Mermaid diagrams, comparison tables,
exam tips, flashcards (spaced repetition), scenario quizzes, an exam simulator and hands-on labs,
all written in our own words and checked against docs.aws.amazon.com.

Status of every item lives in [PROGRESS.md](PROGRESS.md) (single source of truth).
On a restart: read PLAN.md and PROGRESS.md, then resume at the first section that is not `done`.

## Phases

1. **Extract** — `tools/extract_pdf.py` reads the PDF in batches of 50 slides into
   `_extract/text/slides_NNNN-MMMM.md` (text) and `_extract/pages/pNNNN.jpg` (renders, for
   reading diagrams). `_extract/` is local working data and is never shown in the site.
2. **Plan** — this file: sections, slide ranges, course order.
3. **Content format** — `content/README.md` (authoring guide), `content/course.json`
   (order and parts), `content/services.json` (service catalog for the knowledge map) and
   `tools/validate_content.mjs` (quality gate).
4. **Site** — UI designed on a design canvas first, then built in `src/`. Features: home
   knowledge map + progress dashboard, course-ordered sidebar, lesson pages with
   Lesson / Flashcards / Quiz / Lab tabs, spaced-repetition flashcards (Easy / Hard), quiz
   modes (per section, mixed review, 65-question / 130-minute exam simulation), weak areas,
   localStorage progress, full-text search, dark mode, mobile layout.
5. **Content** — one subagent per section (parallel), then an independent reviewer per
   section. Each section is `done` only when the validator passes, the site builds and the
   section renders without errors.
6. **Final QA** — full build, browser sweep of every section, totals and the list of
   "Needs verification" items.

## Content rules (summary; full rules in `content/README.md`)

- Own words only, never slide text verbatim (`tools/check_verbatim.py` flags long overlaps).
- Diagrams are original Mermaid; slide images are only read for understanding.
- Time-sensitive facts (limits, pricing, instance types, console UI, renamed or retired
  services, new features) are checked on docs.aws.amazon.com. Changes get an **Updated**
  badge with a note; anything not confirmable gets **Needs verification**. No guessing.
- Per section: summary + key concepts, Mermaid diagrams, comparison tables, exam tips,
  common traps, 10–30 flashcards, 5–15 scenario questions (each option explained), and a
  lab where the topic allows (objective, prerequisites, time, cost / Free Tier, console
  steps + CLI, checks, mandatory cleanup, checklist, warning if not Free Tier).

## Sections (course order)

Slide ranges are inclusive. Large course sections are split into two lessons so each gets
enough flashcards and questions; the course section is shown in the "Course section" column.

| # | Section id | Lesson title | Slides | Course section | Main services |
|---|---|---|---|---|---|
| 1 | `01-getting-started` | Getting Started with AWS | 1–23 | Intro + Getting Started | Regions, AZs, edge locations, console |
| 2 | `02-iam` | IAM & AWS CLI | 24–40 | AWS IAM | IAM users/groups/roles/policies, MFA, CLI, SDK |
| 3 | `03-ec2-basics` | EC2 Fundamentals | 41–63 | Amazon EC2 – Basics | EC2, instance types, user data, security groups, SSH, Instance Connect |
| 4 | `04-ec2-purchasing` | EC2 Purchasing Options | 64–77 | Amazon EC2 – Basics | On-Demand, RIs, Savings Plans, Spot, Dedicated, Capacity Reservations, Spot Fleet |
| 5 | `05-ec2-associate` | EC2 Networking & Placement | 78–92 | Amazon EC2 – Associate | Public/private IP, Elastic IP, placement groups, ENI, hibernate |
| 6 | `06-ec2-storage` | EC2 Instance Storage | 93–117 | Amazon EC2 – Instance Storage | EBS, snapshots, AMI, instance store, EFS |
| 7 | `07-elb` | Elastic Load Balancing | 118–150 | High Availability & Scalability | ALB, NLB, GWLB, CLB, sticky sessions, cross-zone, SSL/SNI, draining |
| 8 | `08-asg` | Auto Scaling Groups | 151–159 | High Availability & Scalability | EC2 Auto Scaling, launch templates, scaling policies, cooldowns |
| 9 | `09-rds-aurora-elasticache` | RDS, Aurora & ElastiCache | 160–192 | RDS, Aurora & ElastiCache | RDS, Aurora, RDS Proxy, ElastiCache |
| 10 | `10-route53` | Route 53 | 193–226 | Amazon Route 53 | DNS, records, alias, routing policies, health checks, Resolver |
| 11 | `11-classic-architectures` | Classic Solutions Architecture | 227–266 | Classic Solutions Architecture | Stateless/stateful web apps, Elastic Beanstalk |
| 12 | `12-s3-fundamentals` | Amazon S3 Fundamentals | 267–292 | Amazon S3 | Buckets, objects, policies, website, versioning, replication, storage classes |
| 13 | `13-s3-advanced` | Amazon S3 Advanced | 293–312 | Amazon S3 – Advanced | Lifecycle, requester pays, event notifications, performance, Batch Ops, Storage Lens |
| 14 | `14-s3-security` | Amazon S3 Security | 313–334 | Amazon S3 – Security | Encryption, CORS, MFA Delete, access logs, pre-signed URLs, Object Lock, access points, Object Lambda |
| 15 | `15-cloudfront-global-accelerator` | CloudFront & Global Accelerator | 335–349 | CloudFront & Global Accelerator | CloudFront, origins, geo restriction, invalidation, Global Accelerator |
| 16 | `16-storage-extras` | AWS Storage Extras | 350–374 | AWS Storage Extras | Snow Family, FSx, Storage Gateway, Transfer Family, DataSync |
| 17 | `17-sqs-sns` | Decoupling with SQS & SNS | 375–404 | AWS Integration & Messaging | SQS (standard/FIFO), SNS, fan-out, filtering |
| 18 | `18-kinesis-mq` | Streaming with Kinesis & Amazon MQ | 405–413 | AWS Integration & Messaging | Kinesis Data Streams, Data Firehose, Amazon MQ |
| 19 | `19-containers` | Containers on AWS | 414–437 | Containers on AWS | Docker, ECS, Fargate, ECR, EKS |
| 20 | `20-lambda` | Serverless & AWS Lambda | 438–465 | Serverless Overview | Lambda, concurrency, SnapStart, CloudFront Functions, Lambda@Edge, RDS Proxy |
| 21 | `21-dynamodb-apigw-cognito` | DynamoDB, API Gateway, Step Functions & Cognito | 466–490 | Serverless Overview | DynamoDB, DAX, Streams, Global Tables, API Gateway, Step Functions, Cognito |
| 22 | `22-serverless-architectures` | Serverless Architectures | 491–512 | Serverless Architectures | Mobile app, serverless website, microservices, software distribution |
| 23 | `23-databases` | Databases in AWS | 513–526 | Databases in AWS | Choosing a database, DocumentDB, Neptune, Keyspaces, Timestream |
| 24 | `24-data-analytics` | Data & Analytics | 527–559 | Data & Analytics | Athena, Redshift, OpenSearch, EMR, QuickSight, Glue, Lake Formation, Flink, MSK |
| 25 | `25-machine-learning` | Machine Learning | 560–574 | Machine Learning | Rekognition, Transcribe, Polly, Translate, Lex, Connect, Comprehend, SageMaker AI, Kendra, Personalize, Textract |
| 26 | `26-cloudwatch-eventbridge` | Monitoring with CloudWatch & EventBridge | 575–604 | AWS Monitoring, Audit & Performance | CloudWatch metrics/logs/alarms/insights, EventBridge |
| 27 | `27-cloudtrail-config` | Auditing with CloudTrail & Config | 605–618 | AWS Monitoring, Audit & Performance | CloudTrail, Config, CloudWatch vs CloudTrail vs Config |
| 28 | `28-advanced-identity` | Advanced Identity | 619–647 | Advanced Identity in AWS | Organizations, SCPs, IAM conditions, permission boundaries, Identity Center, Directory Service, Control Tower |
| 29 | `29-encryption-secrets` | Encryption, Keys & Secrets | 648–681 | AWS Security & Encryption | KMS, SSM Parameter Store, Secrets Manager, ACM, CloudHSM |
| 30 | `30-threat-protection` | Threat Protection & Detection | 682–696 | AWS Security & Encryption | WAF, Shield, Firewall Manager, DDoS best practices, GuardDuty, Inspector, Macie |
| 31 | `31-vpc-fundamentals` | VPC Fundamentals | 697–728 | Amazon VPC | CIDR, subnets, IGW, route tables, bastion, NAT, NACL vs SG |
| 32 | `32-vpc-connectivity` | VPC Connectivity & Network Costs | 729–774 | Amazon VPC | Peering, endpoints, flow logs, Site-to-Site VPN, Direct Connect, Transit Gateway, IPv6, network costs, Network Firewall |
| 33 | `33-disaster-recovery-migrations` | Disaster Recovery & Migrations | 775–801 | Disaster Recovery & Migrations | DR strategies, Elastic Disaster Recovery, DMS, SCT, AWS Backup, MGN, Application Discovery |
| 34 | `34-more-architectures` | More Solutions Architecture | 802–823 | More Solutions Architecture | Event patterns, caching, blocking IPs, HPC, highly available EC2 |
| 35 | `35-other-services` | Other Services | 824–851 | Other Services | CloudFormation, SES, Pinpoint, Systems Manager, Cost Explorer, Outposts, Batch, AppFlow, Amplify |
| 36 | `36-well-architected-exam` | Well-Architected & Exam Preparation | 852–876 | White Papers & Architectures + Exam Preparation | Well-Architected Framework & Tool, Trusted Advisor, exam strategy |

## Labs planned (where the topic allows)

Labs are decided per section by the content author; planned candidates:
IAM users/groups/MFA/CLI · launch EC2 with user data + SSH/Instance Connect · Elastic IP /
placement group / hibernate · EBS volume, snapshot, AMI, EFS · ALB with two targets · ASG with
launch template · RDS instance · Route 53 records and routing policies · Elastic Beanstalk app ·
S3 website, versioning, replication · lifecycle + event notifications · S3 encryption,
pre-signed URL, CORS · CloudFront with S3 origin (OAC) · SQS + SNS fan-out · Kinesis to
Firehose to S3 · ECS on Fargate · Lambda function · serverless API (API Gateway + Lambda +
DynamoDB) · Athena over S3 · ML APIs from the console · CloudWatch alarm + EventBridge rule ·
CloudTrail + Config rule · SCPs in Organizations · KMS + Secrets Manager · WAF web ACL ·
custom VPC with public/private subnets · VPC peering + gateway endpoint + flow logs ·
AWS Backup plan · CloudFormation stack + Session Manager.

## Site architecture

- `content/` — all course content (JSON + Markdown), editable without touching code.
- `src/` — Vite + React + TypeScript app that loads `content/` with `import.meta.glob`.
- State: browser localStorage (lessons read, quiz attempts, lab checklists, flashcard
  schedule) with export/import to a JSON file. No backend is needed for one local user.
- Run: `npm install`, then `npm run dev`.
