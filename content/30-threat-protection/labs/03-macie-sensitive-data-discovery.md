---
id: 30-threat-protection-lab-03
title: Find PII and secrets in S3 with an Amazon Macie discovery job
objective: Upload synthetic files to a private S3 bucket, add a custom data identifier for employee IDs, run a one-time Macie sensitive data discovery job, and read the findings it produces.
estimatedTime: 45 minutes (about 15 of them waiting for the job)
cost: "Under USD 0.01. The job analyzes a few kilobytes at about USD 1 per GB (a tiny fraction of a cent even if the 1 GB monthly free tier does not apply to jobs); bucket inventory and monitoring are covered by the 30-day Macie trial (otherwise USD 0.10 per bucket per month, prorated daily); storing three tiny files in S3 is negligible."
freeTier: partial
services: [macie, s3]
---

> [!COST]
> Macie bills three things: bucket inventory and monitoring (USD 0.10 per bucket per month, prorated daily), object monitoring for automated discovery, and the amount of data it analyzes (about USD 1 per GB). The 30-day trial in each Region covers bucket monitoring and automated discovery but **not** discovery jobs. The Macie user guide also describes a 1 GB monthly free tier for data analysis, but the pricing page examples apply it only to automated discovery, so assume the job is billed from its first byte. This lab analyzes only a few kilobytes with a job and turns automated discovery off, so the expected cost is a fraction of a cent. Disable Macie in the **Cleanup** section so the per-bucket monitoring fee does not start after the trial.

Macie answers the exam question "where in S3 do we store personal data or secrets?". In this lab you plant three small text files containing **made-up** sensitive values and let Macie find them. All values in the files are fictional; they were generated for this lab and are not linked to any person or working credential.

> [!NOTE] Why not use the classic example values?
> Macie deliberately ignores well-known fictitious values, such as the AWS documentation example secret keys and the card numbers that issuers publish for testing. That is why the files below use home-made values instead.

## Prerequisites

- An AWS account with permissions for Macie and S3 (for example the `AmazonMacieFullAccess` and `AmazonS3FullAccess` managed policies, or administrator access in a sandbox account).
- One Region for everything; the examples use `us-east-1`. Macie is Regional and only inventories buckets in the Region where it is enabled.
- If Macie is already enabled in this account and Region (for example by your organization), skip the enable step and do not disable it in Cleanup.
- For the CLI tabs: AWS CLI v2 in a Bash shell. **AWS CloudShell** works without setup; keep the same terminal open because later commands reuse shell variables. The console path also needs the three files on your computer, so create them in a local folder first (any text editor works).

## Steps

### Step 1: Create the test files and a private bucket

Create three files with exactly this content.

`customers.txt` (personal data, matched by the managed identifier for US Social Security numbers):

```text
Synthetic customer export for a Macie lab. Every value is fictional.
Customer: Jordan Testperson, SSN: 412-58-7193
Customer: Casey Example, SSN: 538-21-4096
Customer: Riley Placeholder, SSN: 627-04-8815
```

`app-config.txt` (credentials, matched by the managed identifiers for AWS secret keys and HTTP Basic authorization headers):

```text
# Fake configuration for a Macie lab. None of these values work anywhere.
aws_secret_access_key = byxKCtAjblqctqCXlvFL0yOLGgAigj0vMnQTl+pP
Authorization: Basic bGFidXNlcjpub3QtYS1yZWFsLXBhc3N3b3Jk
```

`hr-notes.txt` (a company-specific format that no managed identifier knows; you will add a custom data identifier for it in Step 4):

```text
Quarterly HR notes (synthetic).
Employee ID: EMP-482913 moved to the platform team.
Employee ID: EMP-730158 finished onboarding.
```

:::console
1. Open the **Amazon S3** console and choose **Create bucket**.
2. Keep **General purpose**, enter a globally unique **Bucket name** such as `macie-lab-<your-account-id>-<random-digits>`, and leave **Block all public access** turned on and default encryption as it is. Choose **Create bucket**.
3. Open the bucket, choose **Upload** → **Add files**, select the three files, and choose **Upload**.
:::

:::cli
```bash
REGION=${AWS_REGION:-$(aws configure get region)}
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET="macie-lab-$ACCOUNT_ID-$RANDOM"
mkdir -p macie-lab && cd macie-lab

cat > customers.txt <<'EOF'
Synthetic customer export for a Macie lab. Every value is fictional.
Customer: Jordan Testperson, SSN: 412-58-7193
Customer: Casey Example, SSN: 538-21-4096
Customer: Riley Placeholder, SSN: 627-04-8815
EOF
cat > app-config.txt <<'EOF'
# Fake configuration for a Macie lab. None of these values work anywhere.
aws_secret_access_key = byxKCtAjblqctqCXlvFL0yOLGgAigj0vMnQTl+pP
Authorization: Basic bGFidXNlcjpub3QtYS1yZWFsLXBhc3N3b3Jk
EOF
cat > hr-notes.txt <<'EOF'
Quarterly HR notes (synthetic).
Employee ID: EMP-482913 moved to the platform team.
Employee ID: EMP-730158 finished onboarding.
EOF

aws s3 mb "s3://$BUCKET" --region "$REGION"
aws s3 cp . "s3://$BUCKET/" --recursive
aws s3 ls "s3://$BUCKET/"
echo "$BUCKET"
```
:::

> [!CHECK]
> The bucket lists three objects (`app-config.txt`, `customers.txt`, `hr-notes.txt`), and its **Permissions** tab shows **Block all public access: On**.

### Step 2: Enable Macie and keep its scope to this lab

:::console
1. Open the **Amazon Macie** console, confirm the Region in the upper-right corner, choose **Get started**, then **Enable Macie**. Macie creates its service-linked role and starts building an inventory of your general purpose buckets.
2. In the navigation pane, under **Settings**, choose **Automated sensitive data discovery**. If the **Status** is enabled, choose **Disable** so Macie only analyses what your job asks for. (In real accounts, automated discovery is the cheap way to get broad, continuous visibility by sampling objects; you are turning it off only to keep this lab small.)
3. Choose **S3 buckets** in the navigation pane. If your new bucket is missing, choose the refresh button; Macie normally refreshes bucket metadata daily.
:::

:::cli
```bash
aws macie2 enable-macie
aws macie2 update-automated-discovery-configuration --status DISABLED
aws macie2 get-automated-discovery-configuration --query status --output text
aws macie2 describe-buckets \
  --criteria "{\"bucketName\":{\"eq\":[\"$BUCKET\"]}}" \
  --query 'buckets[].[bucketName,publicAccess.effectivePermission]' --output text
```
:::

> [!CHECK]
> Automated discovery shows `DISABLED`, and your bucket appears in the Macie bucket inventory with an effective permission of **Not public** (`NOT_PUBLIC`). This bucket-level security monitoring starts as soon as Macie is enabled, without any job. If `describe-buckets` prints nothing right after `enable-macie`, the first inventory is still being built: wait a minute or two and run it again.

### Step 3: Explore sample findings to learn the two finding categories

:::console
1. In the navigation pane choose **Settings** and, under **Sample findings**, choose **Generate sample findings**.
2. Choose **Findings**. Entries whose type begins with **[SAMPLE]** are examples with placeholder data.
3. Open one **policy finding**, such as `Policy:IAMUser/S3BucketPublic` or `Policy:IAMUser/S3BlockPublicAccessDisabled`: it reports a bucket whose settings became less secure.
4. Open one **sensitive data finding**, such as `SensitiveData:S3Object/Financial`: it reports sensitive content inside a specific object.
:::

:::cli
```bash
aws macie2 create-sample-findings
aws macie2 get-findings \
  --finding-ids $(aws macie2 list-findings --query 'findingIds' --output text) \
  --query 'findings[].[type,category,severity.description,sample]' --output table
```
:::

> [!CHECK]
> You see two categories: **policy** findings (type `Policy:...`, category `POLICY`) about bucket security, and **sensitive data** findings (type `SensitiveData:S3Object/...`, category `CLASSIFICATION`) about object contents. All of them are marked as samples.

### Step 4: Create a custom data identifier for employee IDs

Managed data identifiers cover common data such as credentials, card numbers and national ID numbers. A **custom data identifier** adds your own pattern: a regular expression plus optional keywords that must appear nearby.

:::console
1. In the navigation pane, under **Settings**, choose **Custom data identifiers**, then **Create**.
2. **Name**: `lab-employee-id`. **Regular expression**: `EMP-[0-9]{6}`.
3. **Keywords**: `employee id, employee`. **Maximum match distance**: `20`. Keep **Severity** at **Use Medium severity for any number of matches (default)**.
4. Under **Evaluate**, paste `Employee ID: EMP-482913 and order number EMP-999` into **Sample data** and choose **Test**.
5. Choose **Submit**. A custom data identifier cannot be edited after it is created, which keeps job results reproducible.
:::

:::cli
```bash
aws macie2 test-custom-data-identifier --regex 'EMP-[0-9]{6}' \
  --keywords '["employee id","employee"]' --maximum-match-distance 20 \
  --sample-text 'Employee ID: EMP-482913 and order number EMP-999'

CDI_ID=$(aws macie2 create-custom-data-identifier --name lab-employee-id \
  --regex 'EMP-[0-9]{6}' --keywords '["employee id","employee"]' \
  --maximum-match-distance 20 --query customDataIdentifierId --output text)
echo "$CDI_ID"
```
:::

> [!CHECK]
> The test reports **1** match: `EMP-482913` follows the keyword within 20 characters, while `EMP-999` does not have six digits.

### Step 5: Run a one-time sensitive data discovery job

:::console
1. In the navigation pane choose **Jobs** → **Create job**.
2. **Choose S3 buckets**: **Select specific buckets**, tick your `macie-lab-...` bucket (choose refresh if it is not listed), and choose **Next**. On **Review S3 buckets**, check the estimated cost (effectively USD 0.00) and choose **Next**.
3. **Refine the scope**: choose **One-time job**, keep **Sampling depth** at 100%, and choose **Next**.
4. **Select managed data identifiers**: choose **Recommended**, then **Next**.
5. **Select custom data identifiers**: tick `lab-employee-id`, then **Next**. On **Select allow lists**, choose **Next**.
6. **Enter general settings**: **Job name** `macie-lab-job`, then **Next**.
7. On **Review and create**, choose **Submit**. If Macie warns that no **repository for sensitive data discovery results** is configured, select the checkbox that temporarily overrides the requirement and choose **Submit** again. (In production you would configure the repository, an S3 bucket encrypted with a customer managed KMS key, because Macie keeps detailed discovery results for only 90 days. The lab skips it to avoid creating a KMS key.)
8. On the **Jobs** page, wait until the job's **Status** changes to **Complete**. For a few tiny files this usually takes 10 to 20 minutes, most of it start-up time.
:::

:::cli
```bash
JOB_ID=$(aws macie2 create-classification-job --job-type ONE_TIME --name macie-lab-job \
  --managed-data-identifier-selector RECOMMENDED \
  --custom-data-identifier-ids "$CDI_ID" \
  --s3-job-definition "{\"bucketDefinitions\":[{\"accountId\":\"$ACCOUNT_ID\",\"buckets\":[\"$BUCKET\"]}]}" \
  --query jobId --output text)

while true; do
  STATUS=$(aws macie2 describe-classification-job --job-id "$JOB_ID" \
    --query jobStatus --output text)
  echo "$(date +%T) $STATUS"
  case "$STATUS" in COMPLETE|CANCELLED) break ;; esac   # CANCELLED: the job stopped and will not finish
  sleep 60
done
```
:::

> [!CHECK]
> The job reaches **Complete** (CLI: `COMPLETE`). Once created, a job's settings cannot be changed, which gives auditors an immutable record of what was scanned and how.

### Step 6: Review the job's findings

:::console
1. Choose **Findings** in the navigation pane. Ignore the **[SAMPLE]** entries and look for the three new findings on your bucket.
2. Choose each one and read the details panel: the **finding type**, the **severity**, the affected object key, and the sensitive data section that lists each detected data type with its number of occurrences.
:::

:::cli
```bash
aws macie2 get-findings \
  --finding-ids $(aws macie2 list-findings --query 'findingIds' --output text) \
  --query "findings[?sample==\`false\`].[type,severity.description,resourcesAffected.s3Object.key]" \
  --output table
```
:::

> [!CHECK]
> You find three sensitive data findings, one per file: `SensitiveData:S3Object/Personal` for `customers.txt` (US Social Security numbers), `SensitiveData:S3Object/Credentials` for `app-config.txt` (an AWS secret access key and an HTTP Basic authorization header), and `SensitiveData:S3Object/CustomIdentifier` for `hr-notes.txt` (two matches of `lab-employee-id`, at the default **Medium** severity). A file that mixed several categories would produce a single `SensitiveData:S3Object/Multiple` finding instead.

> [!TIP]
> Macie publishes every finding to EventBridge (`source` `aws.macie`), so the alerting pattern from lab 02 works here too: a rule can notify the data owner through SNS or trigger a Lambda function that tags or quarantines the object.

## Cleanup

- [ ] **S3 bucket `macie-lab-...` and its three objects**: S3 console → select the bucket → **Empty**, type `permanently delete`, confirm; then select it again → **Delete**, type the bucket name, confirm. CLI: `aws s3 rb "s3://$BUCKET" --force`.
- [ ] **Custom data identifier `lab-employee-id`** (optional if you disable Macie next, which deletes it too): Macie → **Custom data identifiers** → select it → **Actions** → **Delete**. CLI: `aws macie2 delete-custom-data-identifier --id "$CDI_ID"`.
- [ ] **Macie in this Region**, which also removes the job record, all findings (including the samples) and the settings: Macie → **Settings** → in the **Disable Macie** section choose **Disable Macie**, enter `Disable`, choose **Disable**. CLI: `aws macie2 disable-macie`. If you want to keep the findings, choose **Suspend Macie** instead; Macie does not charge while suspended.
- [ ] **Service-linked role `AWSServiceRoleForAmazonMacie`** (optional, it costs nothing): may be deleted in IAM after Macie is disabled.
- [ ] **Local files** (CLI path): `cd .. && rm -r macie-lab` (and delete the three files from your computer if you used the console).
- [ ] **Final check**: `aws s3 ls | grep macie-lab` prints nothing, and `aws macie2 get-macie-session` returns an error saying Macie is not enabled. Later, **Billing and Cost Management** → **Bills** shows no Macie charges for this Region.

## Progress checklist

- [ ] Step 1: Created the private bucket and uploaded the three synthetic files
- [ ] Step 2: Enabled Macie, turned off automated discovery and found the bucket in the inventory
- [ ] Step 3: Compared sample policy findings with sample sensitive data findings
- [ ] Step 4: Created and tested the `lab-employee-id` custom data identifier
- [ ] Step 5: Ran the one-time job `macie-lab-job` to completion
- [ ] Step 6: Read the Personal, Credentials and CustomIdentifier findings
- [ ] Cleanup done
