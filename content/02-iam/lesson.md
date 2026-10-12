# IAM & AWS CLI

## Summary

AWS Identity and Access Management (IAM) is the free, global service that decides **who** can call AWS (authentication) and **what** they may do once signed in (authorization). You use it to protect the all-powerful root user, create identities (users, groups and roles), describe permissions as JSON **policies**, harden sign-in with a password policy and multi-factor authentication (MFA), and audit what has been granted with the credential report and last accessed data. Every way of reaching AWS, from the web console to the AWS CLI to code built with an AWS SDK, goes through IAM. On the exam, IAM is the default answer whenever a question asks how to give a person, an application or an AWS service the *least* access it needs; the classic pattern is "attach a role to the EC2 instance instead of storing access keys on it".

## Key concepts

- **IAM is global**: users, groups, roles and policies are not tied to a Region, and IAM itself has no charge.
- The **root user** (account email + password) can do everything; lock it away behind MFA and use it only for the few tasks that require it.
- An **IAM user** is a long-term identity for one person or workload; a **group** is a set of users and can only contain users, never other groups.
- A **policy** is a JSON document with `Version` and one or more `Statement` blocks, each holding `Effect`, `Action`, `Resource` and optionally `Condition`, `Sid` and (in resource-based policies) `Principal`.
- **Least privilege**: grant only the actions and resources a task needs, then trim further using access data.
- Evaluation rule: **everything is denied by default**, an explicit `Allow` grants access, and an explicit `Deny` anywhere always wins.
- **Managed policies** (AWS managed or customer managed) are reusable; **inline policies** belong to exactly one identity and die with it.
- A **password policy** sets length, character mix, expiry and reuse rules for IAM user passwords (not for the root user or access keys).
- **MFA** = something you know (password) + something you have (passkey, security key, authenticator app or hardware token).
- Three ways in: **Management Console** (password + MFA), **AWS CLI** and **AWS SDKs** (signed API calls using access keys or, better, temporary credentials).
- **Access keys** = access key ID (`AKIA...`) + secret access key; at most two per user; the secret is shown only once.
- An **IAM role** hands out **temporary credentials** to whoever is trusted to assume it; EC2 instances, Lambda functions and CloudFormation get permissions through roles.
- **Credential report** = account-wide CSV of every user's password, access key and MFA status; **last accessed data** (formerly Access Advisor) = per-identity list of allowed services and when they were last used.
- Modern guidance: people should sign in through **federation / IAM Identity Center** with temporary credentials; keep IAM users for the few cases that really need long-term credentials.

## IAM at a glance

IAM answers two questions for every request that reaches AWS:

1. **Authentication**: who is calling? The caller proves its identity with a password (console), a signature made with access keys (CLI, SDK, raw API) or temporary security credentials issued by AWS STS.
2. **Authorization**: is this identity allowed to perform this action on this resource right now? AWS evaluates every policy that applies and returns allow or deny.

A few properties matter for design questions:

| Property | What it means in practice |
|---|---|
| Global service | You create a user or role once and it works in every Region. The IAM console shows **Global** instead of a Region name. ARNs for IAM resources have an empty Region field, e.g. `arn:aws:iam::123456789012:user/priya`. |
| No additional charge | IAM, IAM Identity Center and STS are free. You pay only for the resources identities create. (Some IAM Access Analyzer features are billed; see the security tools section.) |
| Eventually consistent | A new user, role or policy change can take a few seconds to apply everywhere. Do not create IAM objects in the hot path of an application. |
| Deny by default | A brand-new user can do nothing at all until a policy grants something. |

### The root user

When an AWS account is created, its email address and password form the **root user**. It has unrestricted access, including billing and closing the account, and IAM policies cannot restrict it within the account. Treat it like the master key to a building:

- Use it only for root-only tasks, for example changing the account's root email or password in a standalone account, closing a standalone account, restoring permissions after the only IAM admin locked themselves out, enabling MFA Delete on an S3 bucket, unlocking an S3 bucket or SQS queue whose resource policy denies everyone, or registering as a seller in the Reserved Instance Marketplace.
- Never create access keys for it.
- Protect it with MFA (now mandatory, see below) and a strong, unique password.
- For daily work, sign in as an administrator identity instead (an IAM Identity Center user or, in a single learning account, an admin IAM user).

> [!UPDATED] Root MFA is now enforced, and Organizations can remove root credentials
> AWS now requires MFA on the root user of every account type (standalone, management and member accounts); if it is not set up, it must be registered within 35 days of the first sign-in attempt. In AWS Organizations you can also **centralize root access**: delete the root password, keys and MFA from member accounts and run a few privileged root tasks (such as unlocking a bucket or queue policy that denies everyone) from the management account or a delegated administrator via `sts:AssumeRoot`. Once this feature is enabled, new accounts you create in the organization start with no root credentials at all.

## Users and groups

An **IAM user** represents one person or one application that needs long-term credentials. A user can have a console password, up to two access keys, MFA devices and permissions. A **user group** is simply a container for users so that you manage permissions once for many people.

Rules worth memorising:

- A group contains **only users**: groups cannot be nested inside groups.
- A user **does not have to** be in a group, and can be in **several** groups (up to **10**).
- There is **no built-in "all users" group**; create one yourself if you need it.
- A group is **not an identity**: you cannot sign in as a group, and a group cannot appear as the `Principal` of a resource-based policy.

| Identity | Credentials | Typical use | Exam signal |
|---|---|---|---|
| Root user | Email + password (+ MFA) | Account-level tasks only | "Which tasks require the root user?" |
| IAM user | Password and/or access keys (long-term) | Break-glass admin, tools that cannot use roles | "One person needs console access to one account" (older questions) |
| User group | None (not an identity) | Attach policies once for many users | "Give all developers the same permissions" |
| IAM role | Temporary credentials via STS | AWS services, cross-account access, federated users | "EC2 needs to read from S3", "avoid long-term keys" |

### How permissions add up across groups

Each user's effective permissions are the union of everything attached to them: policies of every group they belong to, managed policies attached directly, and inline policies embedded in the user. An explicit deny in any of those cancels the matching allows.

```mermaid
%% caption: Three ways a user collects permissions - group membership, a directly attached managed policy, and an inline policy
flowchart LR
  PD["Managed policy:<br/>developer tools"] --> GD[Group: Developers]
  PA["Managed policy:<br/>read-only audit"] --> GA[Group: Auditors]
  GD --> U1[Priya]
  GD --> U2[Marco]
  GA --> U2
  GA --> U3[Sam]
  PB["Managed policy:<br/>billing read-only"] -->|"attached directly"| U3
  PI["Inline policy"] -->|"embedded"| U4["Zoe - no group"]
```

> [!EXAMPLE] Reading the diagram
> Marco is in both groups, so he gets the developer tools policy **plus** the read-only audit policy. Sam gets the audit policy through his group and a billing policy attached straight to his user. Zoe belongs to no group; her only permissions come from an inline policy embedded in her user. If someone added a statement to the audit policy that explicitly denied `ec2:TerminateInstances`, Marco would lose that action even though the developer tools policy allows it.

## Policies: how permissions are written

A policy is a JSON document. Identity-based policies are attached to users, groups or roles; resource-based policies are attached to a resource such as an S3 bucket, an SQS queue or a KMS key (an IAM role's **trust policy** is also resource-based).

Here is an identity-based policy that lets someone list one bucket and download objects from it, but only over HTTPS:

```json
{
  "Version": "2012-10-17",
  "Id": "ReportsBucketReadOnly",
  "Statement": [
    {
      "Sid": "ListTheReportsBucket",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::example-reports"
    },
    {
      "Sid": "ReadReportObjects",
      "Effect": "Allow",
      "Action": ["s3:GetObject"],
      "Resource": "arn:aws:s3:::example-reports/*",
      "Condition": { "Bool": { "aws:SecureTransport": "true" } }
    }
  ]
}
```

| Element | Required? | Purpose | Notes |
|---|---|---|---|
| `Version` | Strongly recommended | Policy language version | Use `2012-10-17`. The older `2008-10-17` (or no version) disables features such as policy variables like `${aws:username}`. |
| `Id` | Optional | Name for the whole policy | Some services (e.g. SQS, SNS) like a unique value. |
| `Statement` | Required | One or more permission statements | A single object or an array. |
| `Sid` | Optional | Label for one statement | Handy for readability and troubleshooting. |
| `Effect` | Required | `Allow` or `Deny` | Deny always overrides allow. |
| `Principal` | Only in resource-based policies | Who the statement applies to (account, user, role, service, `*`) | **Not allowed** in identity-based policies: there the principal is implicitly the identity the policy is attached to. |
| `Action` / `NotAction` | One of them | API actions, e.g. `s3:GetObject`, wildcards like `ec2:Describe*` | |
| `Resource` / `NotResource` | One of them (identity-based) | ARNs the actions apply to, or `*` | |
| `Condition` | Optional | When the statement applies | e.g. source IP, MFA present, TLS used, tags, time. |

A resource-based policy names the principal explicitly. This S3 bucket policy lets another account read objects:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "LetPartnerAccountRead",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::111122223333:root" },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::example-reports/*"
    }
  ]
}
```

### Managed versus inline policies

| Type | Who writes it | Reusable? | Editable by you? | When to use |
|---|---|---|---|---|
| AWS managed (e.g. `AdministratorAccess`, `ReadOnlyAccess`, `IAMReadOnlyAccess`, `AmazonS3ReadOnlyAccess`) | AWS | Yes, across all accounts | No; AWS updates it when services change | Quick start, job-function permissions |
| Customer managed | You | Yes, within your account | Yes, with up to 5 stored versions | Least-privilege permissions you reuse |
| Inline | You | No, strict one-to-one with a user, group or role | Yes | A permission that must never be attached anywhere else; it is deleted with the identity |

AWS recommends starting from AWS managed policies and moving to customer managed policies that grant exactly what each workload needs. Size and count limits apply: a user can have **10** managed policies attached (adjustable to 20), a group **10**, a role **20** (adjustable to 25); a managed policy can be up to 6,144 characters.

### How AWS evaluates a request

Inside one account, AWS gathers every applicable policy (identity-based, resource-based, plus guardrails such as SCPs or permissions boundaries, covered in the Advanced Identity lesson) and applies this logic:

```mermaid
%% caption: Simplified policy evaluation inside a single AWS account
flowchart TD
  R[Request arrives] --> D{"Explicit Deny<br/>in any applicable policy?"}
  D -- Yes --> DENY1[Denied]
  D -- No --> A{"Explicit Allow in an identity-based<br/>or resource-based policy?"}
  A -- Yes --> G{"Guardrails such as SCPs or<br/>permissions boundaries also allow it?"}
  G -- Yes --> ALLOW[Allowed]
  G -- No --> DENY2[Denied]
  A -- No --> DENY3["Denied - implicit deny"]
```

Three consequences to remember:

- **Implicit deny**: silence means no. A user with no policies cannot even list S3 buckets.
- **Explicit deny wins**: if a group allows `s3:*` but an inline policy on the user denies `s3:DeleteBucket`, the delete fails.
- Within one account, an allow in **either** the identity-based policy or the resource-based policy is usually enough (they are combined as a union), unless a deny or guardrail blocks it. Role trust policies and KMS key policies are notable exceptions that must grant access themselves.

### Least privilege in practice

Least privilege means giving only the permissions needed for a task, for example `s3:GetObject` on one bucket instead of `s3:*` on `*`. A practical path: start with an AWS managed job-function policy while you explore, use last accessed data or IAM Access Analyzer policy generation to see what was actually used, then replace the broad policy with a tight customer managed policy.

## Protecting sign-in: password policy and MFA

### Password policy

If you do nothing, IAM users must meet the **default AWS password policy**: 8 to 128 characters, at least three of the four character types (uppercase, lowercase, digits, symbols), not equal to the account name or email, and no expiry. A **custom password policy** (IAM console → **Account settings** → **Password policy**) lets you tighten that:

| Setting | Allowed values | Example choice |
|---|---|---|
| Minimum length | 6 to 128 characters | 14 |
| Required character types | Any mix of: uppercase A–Z, lowercase a–z, digit, non-alphanumeric symbol | All four |
| Password expiration | 1 to 1,095 days | 90 days |
| Expired password needs an admin reset | On / off | Off (users renew it themselves) |
| Users may change their own password | On / off (grants `iam:ChangePassword` on themselves) | On |
| Prevent reuse | Remember the last 1 to 24 passwords | 5 |

Know the edges: the policy applies to **IAM user passwords only**, not to the root user and not to access keys (an IAM user whose password has expired can still use valid access keys). Length and character rules apply at the next password change; an expiry period applies immediately. IAM has **no lockout-after-N-failed-attempts** option, which is one more reason to add MFA.

### Multi-factor authentication (MFA)

MFA combines something you **know** (the password) with something you **have** (a device). If the password leaks through phishing or reuse, the attacker still cannot sign in without the device. Every user with console access, and above all the root user and administrators, should have MFA.

| MFA type | How it works | Strengths | Watch out for |
|---|---|---|---|
| **Passkey or security key** (FIDO2 / WebAuthn) | Synced passkey in a credential manager (Apple, Google, Microsoft, 1Password and others) or a device-bound hardware key such as a YubiKey | Phishing-resistant; AWS's recommended option; one security key can protect several root and IAM users | Can be registered only in the console, not via CLI or API; cannot be passed to STS calls (use `aws login` instead) |
| **Virtual authenticator app** (TOTP) | Phone app generates a 6-digit code every 30 seconds (e.g. Google Authenticator, Microsoft Authenticator, Duo Mobile, Authy, Symantec VIP) | Free, quick; one app holds many accounts' tokens | Codes can be phished; back up or sync the app |
| **Hardware TOTP token** | Key fob or display card showing 6-digit codes | No phone needed | Must be bought from AWS-approved sources (Thales/SafeNet in standard Regions; Hypersecu for AWS GovCloud (US)) |

Each root user and IAM user can register **up to eight MFA devices** of any mix, and needs only one of them to sign in, so register a backup.

> [!UPDATED] MFA options renamed and modernised
> The slides list U2F security keys, a Gemalto key fob and a SurePassID fob for GovCloud. Today AWS documents three MFA types: **passkeys and security keys** (FIDO2/WebAuthn; U2F is deprecated and new registrations use WebAuthn), **virtual authenticator apps**, and **hardware TOTP tokens** sold by **Thales (SafeNet)** for standard Regions and **Hypersecu** for AWS GovCloud (US). AWS also **ended support for enabling SMS text-message MFA**, and each identity can now hold up to **8** MFA devices instead of a single one.

## Ways to access AWS: console, CLI and SDKs

Every action in AWS is an API call. The three access paths differ only in how the call is made and how the caller proves who it is.

| Access method | Who uses it | How you authenticate | Example |
|---|---|---|---|
| AWS Management Console | People in a browser | Password + MFA (IAM user), or federated sign-in (IAM Identity Center) | Clicking **Create user** in IAM |
| AWS CLI | Admins, scripts, CI jobs | Access keys, or temporary credentials (`aws login`, IAM Identity Center, a role) | `aws iam list-users` |
| AWS SDKs | Application code | Same credential sources as the CLI, discovered automatically | A Python app calling `s3.get_object()` with Boto3 |

```mermaid
%% caption: Three ways to reach the same AWS APIs, each with its own way of proving identity
flowchart LR
  P[Person in a browser] -->|"password + MFA<br/>or federated sign-in"| C[Management Console]
  S[Shell or script] -->|"access keys or<br/>temporary credentials"| CLI[AWS CLI]
  A[Application code] -->|"credentials found by<br/>the SDK credential chain"| SDK[AWS SDK]
  C --> API[AWS service APIs]
  CLI --> API
  SDK --> API
  API --> IAMC{"IAM checks<br/>authentication and policies"}
```

### Access keys

An **access key** is a long-term credential pair for an IAM user (or, against advice, the root user):

- **Access key ID**: like a user name, e.g. `AKIAIOSFODNN7EXAMPLE` (long-term keys start with `AKIA`; temporary STS keys start with `ASIA`).
- **Secret access key**: like a password, e.g. `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`. It is shown **only once**, at creation. Lose it and you must create a new key.

Rules and habits:

- At most **two** access keys per user, which allows rotation (create the new key, switch applications, deactivate and delete the old one).
- Never paste keys into code, commit them to Git, or share them with anyone, including people claiming to be AWS support.
- The CLI stores keys **in plain text** in `~/.aws/credentials` (`%UserProfile%\.aws\credentials` on Windows).
- A deactivated key still counts toward the two-key limit.

> [!UPDATED] AWS now steers you away from long-term access keys
> When you choose **Create access key**, the console first shows an **Access key best practices & alternatives** page and asks for your use case. Recommended alternatives: **AWS CloudShell** (a browser shell that is already signed in with your console credentials), **IAM Identity Center** with `aws configure sso`, IAM roles for workloads, and since November 2025 the **`aws login`** command (AWS CLI 2.32.0 or later), which turns your console sign-in into short-lived credentials that are refreshed automatically for up to 12 hours. IAM users and roles need the permissions in the `SignInLocalDevelopmentAccess` managed policy (an identity with `AdministratorAccess` already has them); the root user needs nothing extra.

### The AWS CLI

The **AWS Command Line Interface** is an open-source tool (github.com/aws/aws-cli) that calls the public AWS APIs from your terminal. Anything you can click in the console for infrastructure services can be scripted, which makes the CLI the natural tool for repeatable tasks and automation. It is built on **botocore**, the same core library as the AWS SDK for Python (Boto3).

Core commands and files:

```bash
aws --version                      # e.g. aws-cli/2.x.x Python/3.x ...
aws configure                      # prompts: access key ID, secret, default Region, output format
aws configure --profile dev        # a second, named profile
aws sts get-caller-identity        # "who am I?" - account, user/role ARN
aws iam list-users --output table  # output formats: json, yaml, yaml-stream, text, table, off
aws s3 ls --profile dev            # use a named profile for one command
```

- `~/.aws/config` holds Region and output settings (`[default]`, `[profile dev]`).
- `~/.aws/credentials` holds keys (`[default]`, `[dev]`: no word "profile" here).
- Precedence, simplified: command-line options beat environment variables, which beat the files.

> [!UPDATED] AWS CLI v1 is in maintenance mode
> AWS CLI version 1 entered maintenance mode on **15 July 2026** (critical fixes only, no new services or Regions) and reaches end of support on **15 July 2027**. Use **AWS CLI v2**, installed from the official bundled installers or the new one-line install script, and updated with `aws update`.

### AWS SDKs

An **SDK** (software development kit) is a set of language-specific libraries that you embed in your application to call AWS. The SDK signs every request and finds credentials automatically through its **credential provider chain**: environment variables, shared config/credentials files (including `aws login` and SSO sessions), and finally the IAM role of the compute service the code runs on (EC2 instance profile, Lambda execution role, ECS task role).

| SDK family | Languages / platforms |
|---|---|
| General-purpose SDKs (generally available) | C++, Go (v2), Java (2.x), JavaScript (v3, incl. Node.js), Kotlin, .NET (4.x), PHP (3.x), Python (Boto3), Ruby (3.x), Rust, Swift, SAP ABAP |
| Mobile | AWS Amplify libraries for Android, Swift (iOS), Flutter and JavaScript |
| IoT | AWS IoT Device SDKs (e.g. Embedded C, C++, Java, Python) |

> [!UPDATED] SDK line-up has changed
> Newer SDKs (Kotlin, Rust, Swift, SAP ABAP) are generally available, while older major versions such as AWS SDK for Java 1.x, JavaScript v2, Go v1 and .NET 3.x have reached end of support. The standalone **AWS SDK for Android** and **AWS SDK for iOS** entered maintenance on 1 August 2025 and reached end of support on 1 August 2026; AWS now points mobile developers to the **AWS Amplify** libraries.

```mermaid
%% caption: Choosing credentials - prefer temporary credentials whenever you can
flowchart TD
  Q{Who or what needs access?} -->|"Person, many accounts"| IC["IAM Identity Center<br/>federated, temporary"]
  Q -->|"Person, quick CLI use"| L["aws login or<br/>AWS CloudShell"]
  Q -->|"Code on EC2, Lambda, ECS"| R["IAM role attached<br/>to the compute"]
  Q -->|"Code outside AWS"| X["IAM Roles Anywhere,<br/>OIDC or SAML federation"]
  Q -->|"Tool that only accepts keys"| K["IAM user access key<br/>least privilege, rotate"]
```

## IAM roles for AWS services

Many AWS services act on your behalf: an EC2 instance's application reads S3, a Lambda function writes to DynamoDB, CloudFormation creates resources. Instead of copying access keys onto those resources, you give the service an **IAM role**.

A role has two policies:

- a **trust policy** (who may assume the role), for example the EC2 service principal `ec2.amazonaws.com`;
- one or more **permissions policies** (what the role may do once assumed).

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "ec2.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

When the role is used, **AWS STS** issues temporary credentials (access key ID beginning `ASIA`, secret and session token) that expire and are rotated automatically. Nothing long-term is stored on the server.

```mermaid
%% caption: How an application on EC2 gets temporary credentials from an instance role
sequenceDiagram
  participant Admin
  participant IAM
  participant EC2 as EC2 instance
  participant IMDS as Instance metadata service
  participant S3 as Amazon S3
  Admin->>IAM: Create role, trust ec2.amazonaws.com, attach S3 read policy
  IAM-->>Admin: Console also creates a same-name instance profile
  Admin->>EC2: Launch instance with that instance profile
  EC2->>IMDS: SDK asks for credentials
  IMDS-->>EC2: Temporary keys and session token, auto-rotated
  EC2->>S3: GetObject signed with temporary keys
  S3-->>EC2: Object returned if the role policy allows it
```

| Term | Meaning | Example |
|---|---|---|
| Service role | A role you create and manage that a service assumes | `app-server-role` for EC2, a Lambda execution role, a CloudFormation service role |
| Instance profile | Container that carries exactly **one** role to an EC2 instance; the console creates it automatically with the role's name | `aws iam create-instance-profile` when using the CLI |
| Service-linked role | A role predefined and owned by a service; you can view but not edit its permissions | `AWSServiceRoleForAutoScaling` |

> [!TIP] Changing an instance's permissions
> Edit the role's permissions policy and the change applies to running instances within moments; you do not need to restart anything or touch the instance. You can also attach or replace the instance profile on a running instance.

## IAM security tools

Two built-in tools help you audit and tighten permissions, and both are free.

| Tool | Scope | What it shows | Typical use |
|---|---|---|---|
| **Credential report** (IAM → **Access reports** → **Credential report**) | Whole account | A CSV with one row per user (and the root user): password enabled and last used, last password change, next rotation, MFA active, status, rotation date and last use (date, Region, service) of the first two access keys, signing certificates | Find users without MFA, keys older than 90 days, users who never sign in. Regenerated at most once every **4 hours**. |
| **Last accessed data** (the **Last Accessed** tab on a user, group, role or policy; formerly **Access Advisor**) | One identity or policy | Every service the identity's policies allow and when it was last used (tracking period at least 400 days); for some services (S3, EC2, IAM, Lambda and a growing list) also individual management actions | Remove permissions that are never used, i.e. move toward least privilege. Data appears within about 4 hours. |

```mermaid
%% caption: Account-level versus identity-level auditing
flowchart LR
  subgraph AcctLevel[Account level]
    CR[Credential report CSV]
  end
  subgraph IdLevel[Identity level]
    LA[Last Accessed tab]
  end
  CR --> F1["Who has no MFA?<br/>Whose keys are old or unused?"]
  LA --> F2["Which allowed services<br/>were never used?"]
  F1 --> FIX[Disable, rotate or delete credentials]
  F2 --> TRIM[Trim policies to least privilege]
```

> [!UPDATED] Renamed tool and a newer companion
> The slides call the per-user tool **IAM Access Advisor**; the console and docs now call it **last accessed information** on the **Last Accessed** tab, and it covers users, groups, roles, policies and even AWS Organizations entities. **IAM Access Analyzer** adds external-access findings, policy validation and policy generation at no charge, plus paid features such as unused-access analysis (USD 0.20 per IAM role or user per month) and internal-access analysis.

> [!NOTE] Credential report limits
> The report includes passwords, MFA, signing certificates and only the **first two** access keys per user. Service-specific credentials (for example CodeCommit Git credentials or Amazon Bedrock API keys) are not in it.

## IAM best practices

The course's guidelines still hold, but AWS's current wording shifts the emphasis toward temporary credentials. Use both columns when you read exam questions: older questions follow the left column, newer ones the right.

| Classic guideline | Current AWS recommendation |
|---|---|
| Keep the root user for initial setup only | Same, plus MFA is enforced on root and Organizations can remove member-account root credentials entirely |
| Give each person their own IAM user | People should **federate** (IAM Identity Center or an external IdP) and get temporary credentials; IAM users only for break-glass access and tools that cannot use roles |
| Grant permissions through groups rather than user by user | Still valid for IAM users; Identity Center uses its own groups and permission sets |
| Strong password policy | Same, combined with MFA (no lockout option exists) |
| Require MFA for everyone | Prefer **phishing-resistant** passkeys or security keys; register more than one device |
| Give AWS services their permissions through roles | Same: workloads on AWS should always use roles (temporary credentials) |
| CLI and SDK work relies on access keys | Use temporary credentials first (`aws login`, SSO, roles, CloudShell); if keys are unavoidable, scope them tightly and rotate them |
| Audit regularly with the credential report and Access Advisor | Same, plus IAM Access Analyzer for unused and external access |
| Each user and each key belongs to exactly one person or app | Same |

> [!UPDATED] Human users should federate instead of getting IAM users
> AWS's IAM best-practices page now leads with "require human users to use federation with an identity provider" and recommends **IAM Identity Center** for workforce access. Creating one IAM user per person is still possible and still appears in exam questions, but the docs reserve IAM users for specific cases such as emergency access, third-party tools that need keys, and workloads that cannot use roles. Accounts created with the limited-release "Sign up for AWS (new)" experience cannot give IAM users console access at all (IAM users and roles there are for programmatic access only); the classic sign-up is now called "Sign up for AWS (advanced)".

## Exam tips

> [!EXAM] Roles beat keys
> "An application on EC2 (or Lambda, ECS) must access S3 / DynamoDB / SQS" → create an **IAM role** with the needed permissions and attach it (instance profile, execution role, task role). Any answer that stores access keys on the instance, in user data, in environment variables or in code is wrong.

> [!EXAM] Least privilege signals
> "Grant only the permissions required", "most secure" → a customer managed policy scoped to specific actions and resource ARNs, attached to a group or role. `AdministratorAccess` or `"Action": "*"` is almost never the answer.

> [!EXAM] Which audit tool?
> "List all users and the status of their passwords, keys and MFA" → **credential report** (account level). "Which services has this user or role actually used / which permissions are unused?" → **last accessed data** (Access Advisor) or IAM Access Analyzer unused access.

> [!EXAM] Explicit deny
> If a scenario combines an allow from a group with a deny from any other policy, the request is **denied**. With no matching allow at all, it is also denied (implicit deny).

- "Protect the root account" → enable **MFA**, delete or never create root access keys, use an admin identity day to day.
- "Users keep reusing weak passwords" → **custom password policy** (length, complexity, expiry, reuse prevention).
- "Stolen password must not be enough to sign in" → **MFA**.
- "Same permissions for every member of a team" → **group** with a managed policy.
- "Many accounts, single sign-on for the workforce" → **IAM Identity Center** (covered in the Advanced Identity lesson).
- "Script AWS from a terminal" → **AWS CLI**; "call AWS from application code" → **AWS SDK**; "run the CLI without installing or storing keys" → **CloudShell**.
- Policy that contains a `Principal` element → it is a **resource-based** policy (bucket policy, trust policy, queue policy), not one attached to a user.

## Common traps

> [!TRAP] Nesting groups
> An answer that adds a group to another group is impossible in IAM. Groups contain users only; to combine permissions, put the user in both groups or attach more policies.

> [!TRAP] Groups as principals
> You cannot name an IAM group in the `Principal` element of a bucket policy or trust policy. Name users, roles, accounts or services instead, or grant through identity-based policies on the group.

> [!TRAP] Password policy scope
> A password policy does not cover the root user and does nothing for access keys. An expired password blocks console sign-in but valid access keys keep working until you deactivate them.

> [!TRAP] Sharing one IAM user
> Several people (or an app plus a person) sharing one IAM user or one set of access keys breaks accountability in CloudTrail and makes rotation painful. Each person and each workload gets its own identity.

> [!TRAP] Access Advisor versus credential report
> Both are "IAM reports", so distractors swap them. Credential report = all users, credential status, CSV, account level. Last accessed / Access Advisor = one identity, services used and when.

> [!TRAP] Root user for daily admin work
> "Use the root user because it already has all permissions" is always wrong unless the task is one of the root-only tasks (e.g. closing a standalone account, changing the root email, enabling S3 MFA Delete).

- **Inline vs managed**: an inline policy is not "safer" or "more central"; it cannot be reused and disappears with its identity. Choose managed policies unless a strict one-to-one link is required.
- **IAM is not regional**: answers that "replicate IAM users to another Region for disaster recovery" are distractors; IAM is global already.
- **Secret key recovery**: there is no way to view a lost secret access key again; the fix is to create a new key and delete the old one.
