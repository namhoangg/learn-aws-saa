---
id: 13-s3-advanced-lab-03
title: Multipart uploads, byte-range reads, Transfer Acceleration, Batch Operations and Storage Lens
objective: Upload a large file with multipart upload, read part of it with a byte-range GET, push a file through the Transfer Acceleration endpoint, re-tag a set of objects with one S3 Batch Operations job, and explore the Storage Lens default dashboard.
estimatedTime: 60 minutes
cost: "About USD 0.26: USD 0.25 for one Batch Operations job plus fractions of a cent for the generated object list, 100 MB of storage for an hour, requests and a few MB of accelerated transfer (USD 0.04 per GB). Free Tier credits on new accounts can cover it."
freeTier: partial
services: [s3, s3-transfer-acceleration, s3-batch-operations, s3-storage-lens, iam]
---

> [!COST]
> **S3 Batch Operations** charges per job (USD 0.25 in us-east-1 when checked) plus USD 1.00 per million objects processed, and letting S3 generate the object list adds a small charge based on the number of objects in the source bucket (a few dozen here). This lab's single job therefore costs about USD 0.25 and is the main charge. **Transfer Acceleration** adds USD 0.04 per GB (US, Europe and Japan edges) only when a transfer is actually accelerated; a 1 MB file costs a tiny fraction of a cent. The 100 MB test object costs well under a cent if deleted within a day. Storage Lens **free metrics** cost nothing; do not upgrade the dashboard to advanced metrics, which is billed per object monitored. Run **Cleanup** when you finish.

The steps use `us-east-1` (Transfer Acceleration is only available in some Regions; us-east-1 is one of them). A terminal is required for Steps 1–3 because the console cannot show multipart details or make range requests; **AWS CloudShell** is the easiest choice.

## Prerequisites

- An AWS account with permissions for S3, S3 Batch Operations and IAM role creation (for example `AmazonS3FullAccess` plus `IAMFullAccess`, or an administrator role in a sandbox account).
- **AWS CloudShell** or AWS CLI v2 with a Linux Bash shell. Keep one terminal open for the whole lab.
- A bucket name that is globally unique, DNS-compliant and contains **no dots** (Transfer Acceleration rejects dotted names), for example `lab-perf-<your initials>-<random digits>`.
- To view Storage Lens dashboards you must sign in as an IAM user or role, not the root user.

## Steps

### Step 1: Create a bucket and a 100 MB test file

:::console
1. Open the **S3** console, choose **General purpose buckets** → **Create bucket**, enter your bucket name (no dots), keep the defaults and choose **Create bucket**.
2. Open **CloudShell** from the console toolbar for the next steps.
:::

:::cli
```bash
export AWS_REGION=us-east-1
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET=lab-perf-$RANDOM$RANDOM
aws s3api create-bucket --bucket "$BUCKET" --region "$AWS_REGION"
dd if=/dev/urandom of=big.bin bs=1M count=100
ls -lh big.bin
```
:::

### Step 2: Upload with multipart upload and inspect the parts

The high-level `aws s3 cp` command switches to multipart upload above its 8 MB threshold and sends 8 MB parts in parallel (10 concurrent requests by default).

:::cli
```bash
aws s3 cp big.bin "s3://$BUCKET/video/big.bin"
aws s3api head-object --bucket "$BUCKET" --key video/big.bin --query '{Size:ContentLength,ETag:ETag}'
aws s3api head-object --bucket "$BUCKET" --key video/big.bin --part-number 1 \
  --query '{PartSize:ContentLength,PartsCount:PartsCount}'
```
:::

> [!CHECK]
> The object is 104857600 bytes. Its **ETag ends with a dash and a number**, the sign of a multipart object: with the default 8 MB part size that is `-13` (100 MB in 8 MB parts, the last one smaller), and the second `head-object` reports `PartsCount: 13` with a first part of 8388608 bytes. If your CLI picked a different part size the count differs, but the dash is always there. A single PUT would have produced a plain ETag with no dash.

> [!TIP]
> To see the low-level flow, look back at lab 01 Step 5: `create-multipart-upload`, `upload-part` and then `complete-multipart-upload` (or `abort-multipart-upload`). The CLI and SDK transfer managers do all of this, plus retries of failed parts, for you.

### Step 3: Read only part of the object with byte-range fetches

:::cli
```bash
# First 1 KB only (for example a file header)
aws s3api get-object --bucket "$BUCKET" --key video/big.bin \
  --range bytes=0-1023 header.bin --query '{ContentRange:ContentRange,Length:ContentLength}'
ls -l header.bin

# Two ranges that a downloader could fetch in parallel, then join
aws s3api get-object --bucket "$BUCKET" --key video/big.bin --range bytes=0-52428799 half1.bin > /dev/null &
aws s3api get-object --bucket "$BUCKET" --key video/big.bin --range bytes=52428800-104857599 half2.bin > /dev/null &
wait
cat half1.bin half2.bin | cmp - big.bin && echo "Reassembled file is identical"
```
:::

> [!CHECK]
> The first call returns `ContentRange: bytes 0-1023/104857600` and `header.bin` is exactly 1024 bytes. The two halves, downloaded at the same time, join into a file identical to the original, which is how download managers and the SDKs speed up large GETs.

### Step 4: Enable Transfer Acceleration and upload through the edge network

:::console
1. In the S3 console, open the bucket and choose **Properties**.
2. Under **Transfer acceleration**, choose **Edit**, choose **Enable** and **Save changes**.
3. Back on **Properties**, note the **Accelerated endpoint** shown under **Transfer acceleration** (`<bucket>.s3-accelerate.amazonaws.com`).
4. Optional: open the **Amazon S3 Transfer Acceleration Speed Comparison** tool linked from the S3 documentation to compare accelerated and direct upload speeds from your browser to several Regions.
:::

:::cli
```bash
aws s3api put-bucket-accelerate-configuration --bucket "$BUCKET" \
  --accelerate-configuration Status=Enabled
aws s3api get-bucket-accelerate-configuration --bucket "$BUCKET"

# Send this CLI's S3 requests to the accelerate endpoint, upload, then switch back
dd if=/dev/urandom of=accel.bin bs=1M count=1
aws configure set default.s3.use_accelerate_endpoint true
# grep reads the whole debug log (no early exit), so the upload is never cut short
aws s3api put-object --bucket "$BUCKET" --key accel/accel.bin --body accel.bin --debug 2>&1 \
  | grep -o "$BUCKET.s3-accelerate.amazonaws.com" | sort -u
aws configure set default.s3.use_accelerate_endpoint false
```
:::

> [!CHECK]
> `get-bucket-accelerate-configuration` returns `"Status": "Enabled"`, the debug output shows the request going to `<bucket>.s3-accelerate.amazonaws.com`, and `aws s3 ls "s3://$BUCKET/accel/"` lists `accel.bin` (the pipe hides error messages, so if the object is missing, wait a minute after enabling acceleration and rerun the last three commands with the `--debug` pipe removed to see the error). Speed gains can take up to 20 minutes to appear after enabling, and from CloudShell (already inside an AWS Region) you will not see a big difference: acceleration pays off for clients far from the bucket's Region. Make sure you switched `use_accelerate_endpoint` back to `false`, or later commands against other buckets will fail.

### Step 5: Create objects to process and an IAM role for Batch Operations

Create 20 small "report" objects, then a role that the Batch Operations service can assume.

:::console
1. Create a few small local files, create a folder `reports` in the bucket and upload them into it (the CLI tab creates 20 in one go).
2. You do not need to create the role by hand: in Step 6 the console can create one for a job that uses a generated object list.
:::

:::cli
```bash
for i in $(seq -w 1 20); do echo "report $i" > "report-$i.txt"; done
aws s3 cp . "s3://$BUCKET/reports/" --recursive --exclude "*" --include "report-*.txt"

aws iam create-role --role-name lab-s3-batch-tagging --assume-role-policy-document '{
  "Version": "2012-10-17",
  "Statement": [{ "Effect": "Allow",
    "Principal": { "Service": "batchoperations.s3.amazonaws.com" },
    "Action": "sts:AssumeRole" }]
}'
cat > batch-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow",
      "Action": ["s3:PutObjectTagging", "s3:PutObjectVersionTagging"],
      "Resource": "arn:aws:s3:::$BUCKET/reports/*" },
    { "Effect": "Allow",
      "Action": ["s3:PutInventoryConfiguration", "s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": "arn:aws:s3:::$BUCKET" },
    { "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"],
      "Resource": "arn:aws:s3:::$BUCKET/batch/*" }
  ]
}
EOF
aws iam put-role-policy --role-name lab-s3-batch-tagging \
  --policy-name lab-s3-batch-tagging --policy-document file://batch-policy.json
ROLE_ARN=$(aws iam get-role --role-name lab-s3-batch-tagging --query Role.Arn --output text)
echo "$ROLE_ARN"
```
:::

> [!CHECK]
> `aws s3 ls "s3://$BUCKET/reports/"` lists 20 objects. The role trusts `batchoperations.s3.amazonaws.com` and may tag objects under `reports/`, generate the object list for the bucket, and write the manifest and report under `batch/`.

### Step 6: Run a Batch Operations job that replaces the tags on every report

:::console
1. In the S3 console, choose **Batch Operations** in the navigation pane, then **Create job**.
2. Under **Choose Region and scope**, keep your bucket's Region. Under **Object list**, choose **Generate an object list**.
3. For **Source account**, keep your own account. For **Source**, enter `s3://<your-bucket>`. Under **Object filters**, add an object key filter that matches the prefix `reports/` so only the report objects are included.
4. Under **Choose operation**, select **Replace all object tags** and choose **Next**. On the next page, add the tag key `project` with the value `archive-2026`.
5. In **Configure additional options**, enable the **Completion report** for **All tasks** with the destination `s3://<your-bucket>/batch/`. Under **Permissions**, let S3 create a role for you, or choose the existing role `lab-s3-batch-tagging` if you created it with the CLI. Choose **Next**.
6. Review and choose **Submit job**. Jobs created in the console wait for confirmation (API status **Suspended**, shown in the console as **Awaiting your confirmation**). When the job reaches that state, select the option button next to its job ID and choose **Run job**, check the settings on the next page, then choose **Run job** again.
7. Refresh the job page until the status is **Complete**.
:::

:::cli
```bash
sleep 15   # give the new IAM role a few seconds to propagate before the job assumes it
JOB_ID=$(aws s3control create-job --region "$AWS_REGION" --account-id "$ACCOUNT_ID" \
  --operation '{"S3PutObjectTagging":{"TagSet":[{"Key":"project","Value":"archive-2026"}]}}' \
  --manifest-generator "{\"S3JobManifestGenerator\":{\"ExpectedBucketOwner\":\"$ACCOUNT_ID\",\"SourceBucket\":\"arn:aws:s3:::$BUCKET\",\"EnableManifestOutput\":true,\"ManifestOutputLocation\":{\"ExpectedManifestBucketOwner\":\"$ACCOUNT_ID\",\"Bucket\":\"arn:aws:s3:::$BUCKET\",\"ManifestPrefix\":\"batch/manifests\",\"ManifestFormat\":\"S3InventoryReport_CSV_20211130\"},\"Filter\":{\"KeyNameConstraint\":{\"MatchAnyPrefix\":[\"reports/\"]}}}}" \
  --report "{\"Bucket\":\"arn:aws:s3:::$BUCKET\",\"Prefix\":\"batch/reports\",\"Format\":\"Report_CSV_20180820\",\"Enabled\":true,\"ReportScope\":\"AllTasks\"}" \
  --priority 10 --role-arn "$ROLE_ARN" --client-request-token "$(cat /proc/sys/kernel/random/uuid)" \
  --description "lab: tag reports" --no-confirmation-required \
  --query JobId --output text)
echo "Job: $JOB_ID"
# Poll until Status is Complete (usually a few minutes)
aws s3control describe-job --region "$AWS_REGION" --account-id "$ACCOUNT_ID" --job-id "$JOB_ID" \
  --query 'Job.{Status:Status,Total:ProgressSummary.TotalNumberOfTasks,Succeeded:ProgressSummary.NumberOfTasksSucceeded,Failed:ProgressSummary.NumberOfTasksFailed}'
```
:::

> [!CHECK]
> The job reaches **Complete** with 20 tasks succeeded and 0 failed. `aws s3api get-object-tagging --bucket "$BUCKET" --key reports/report-01.txt` returns `project = archive-2026`, and a completion report (CSV, one line per object) appears under `batch/reports/`. Objects outside `reports/`, such as `video/big.bin`, were not touched. If the job fails, the failure reason on the job page usually points to a missing permission in the role.

### Step 7: Explore the Storage Lens default dashboard

:::console
1. In the S3 console, choose **Storage Lens** → **Dashboards** in the navigation pane.
2. Open **default-account-dashboard**. The **Snapshot for** date shows the latest day with metrics; today's uploads appear only after the next daily update (up to about 48 hours for a new account).
3. In the snapshot, switch **Metrics categories** to **Cost optimization** and look for incomplete multipart upload bytes and noncurrent version bytes; then switch to **Data protection** to see how many buckets have versioning or SSE-KMS.
4. Use the **Buckets** tab to rank your buckets by total storage, and note which categories are greyed out because they need **advanced metrics** (for example **Activity**).
5. Open the dashboard's configuration and note that you can **disable** it or upgrade it, but there is no option to delete it. Do not upgrade it in this lab.
:::

:::cli
```bash
aws s3control list-storage-lens-configurations --account-id "$ACCOUNT_ID" --region "$AWS_REGION"
aws s3control get-storage-lens-configuration --account-id "$ACCOUNT_ID" --region "$AWS_REGION" \
  --config-id default-account-dashboard \
  --query 'StorageLensConfiguration.{Id:Id,Enabled:IsEnabled,ActivityMetrics:AccountLevel.ActivityMetrics.IsEnabled}'
```
:::

> [!CHECK]
> The list contains `default-account-dashboard`. Unless someone upgraded it, activity metrics are disabled or absent (free tier), which is why the **Activity** category is unavailable and only 14 days of history can be queried.

## Cleanup

- [ ] **Accelerate endpoint setting in your CLI**: make sure it is off: `aws configure set default.s3.use_accelerate_endpoint false`.
- [ ] **Transfer Acceleration on the bucket** (removed with the bucket; to suspend it first: Console **Properties** → **Transfer acceleration** → **Edit** → **Disable**; CLI `aws s3api put-bucket-accelerate-configuration --bucket "$BUCKET" --accelerate-configuration Status=Suspended`).
- [ ] **Batch Operations job**: nothing to delete; completed jobs stay in the job list and expire on their own. If a job is still waiting for confirmation, cancel it (console: select it → **Cancel job**; CLI `aws s3control update-job-status --account-id "$ACCOUNT_ID" --job-id "$JOB_ID" --requested-job-status Cancelled`).
- [ ] **IAM role** used by the job. CLI-created role: `aws iam delete-role-policy --role-name lab-s3-batch-tagging --policy-name lab-s3-batch-tagging`, then `aws iam delete-role --role-name lab-s3-batch-tagging`. Console-created role: **IAM** → **Roles** → search for the role name shown on the job's details page → **Delete**.
- [ ] **All objects** (video, accel, reports, batch manifests and reports). Console: select the bucket → **Empty** → type `permanently delete`. CLI: `aws s3 rm "s3://$BUCKET" --recursive`.
- [ ] **The bucket**. Console: **Delete** → type the bucket name. CLI: `aws s3api delete-bucket --bucket "$BUCKET"`.
- [ ] **Local files**: `rm -f big.bin header.bin half1.bin half2.bin accel.bin report-*.txt batch-policy.json`.
- [ ] **Storage Lens**: leave `default-account-dashboard` on the free tier (if you upgraded it, switch it back to free metrics to stop charges).
- [ ] **Final check**: the bucket is gone from **General purpose buckets**, `aws iam get-role --role-name lab-s3-batch-tagging` returns NoSuchEntity, and **Billing and Cost Management** → **Bills** shows only cents for S3 the next day.

## Progress checklist

- [ ] Step 1: Bucket and 100 MB test file created
- [ ] Step 2: Multipart upload confirmed by the ETag suffix and PartsCount
- [ ] Step 3: Byte-range reads tested and the file reassembled
- [ ] Step 4: Transfer Acceleration enabled and the accelerate endpoint used
- [ ] Step 5: Report objects and the Batch Operations role created
- [ ] Step 6: Batch Operations job completed and tags verified
- [ ] Step 7: Storage Lens default dashboard explored
- [ ] Cleanup done
