---
id: 16-storage-extras-lab-01
title: Copy data between two S3 buckets with AWS DataSync
objective: Create DataSync locations and a Basic mode task that copies a prefix from one S3 bucket to another without an agent, rerun it to see incremental copies, and set up then pause an hourly schedule.
estimatedTime: 35 minutes
cost: "Well under USD 0.01: DataSync Basic mode charges USD 0.0125 per GB copied (this lab copies about 10 MB) plus a few cents' worth of S3 requests and storage at most. DataSync is Paid-plan only on accounts created on or after 15 July 2025, where remaining sign-up credits can cover it; there is no Always Free DataSync allowance."
freeTier: partial
services: [datasync, s3, iam-roles]
---

> [!COST]
> DataSync has no Always Free tier. In Basic mode it charges **USD 0.0125 per GB** copied (us-east-1); Enhanced mode costs USD 0.015 per GB **plus USD 0.55 per task execution**, which is why this lab uses Basic mode. S3 storage and requests for a few megabytes cost fractions of a cent. If you enable the optional hourly schedule, pause it in the same session so it does not keep running.
>
> DataSync is not open to the credit-based **Free plan** (accounts created on or after 15 July 2025 that have not upgraded): the [AWS Free Tier page](https://aws.amazon.com/free/) marks it **Paid plan exclusive**. Upgrade to the **Paid plan** first (remaining sign-up credits still pay for this lab) or use an account created before 15 July 2025. {{updated: Checked 2026-10-04 on the AWS Free Tier page. Accounts made through the limited-rollout Sign up for AWS (new) experience are the exception: AWS includes DataSync in their free tier, without cross-Region transfers, which this single-Region lab does not need.}}

DataSync is usually shown moving data from an on-premises NAS, which needs an agent VM. Between AWS storage services no agent is required, so a bucket-to-bucket copy is the quickest way to see how locations, tasks, task executions, incremental transfers and schedules work. The same task concepts apply when the source is an NFS or SMB server.

## Prerequisites

- An AWS account on the **Paid plan**, or one created before 15 July 2025; DataSync is not open to the Free plan (see the COST note).
- Permissions for DataSync, S3 and IAM (for example `AWSDataSyncFullAccess`, `AmazonS3FullAccess` and permission to create IAM roles).
- A Region where you will do everything; the examples use `us-east-1`.
- **AWS CloudShell** (opened from the console toolbar) to create sample files. It already has the AWS CLI configured. Keep the same CloudShell tab open: later CLI commands reuse shell variables.

## Steps

### Step 1: Create the source and destination buckets with sample data

You need two buckets: a source with a `projects/` prefix of sample files, and an empty destination.

:::console
1. Open CloudShell and run the commands in the CLI tab (the console has no quick way to generate test files). They create both buckets with unique names, about 50 small text files and one 10 MB file.
2. Open the **S3** console, choose **General purpose buckets**, and confirm both buckets exist. Open the source bucket and the `projects/` folder to see the files.
:::

:::cli
```bash
REGION=${AWS_REGION:-us-east-1}
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
SUFFIX=$RANDOM
SRC_BUCKET=ds-lab-src-$ACCOUNT_ID-$SUFFIX
DST_BUCKET=ds-lab-dst-$ACCOUNT_ID-$SUFFIX
aws s3 mb "s3://$SRC_BUCKET" --region "$REGION"
aws s3 mb "s3://$DST_BUCKET" --region "$REGION"

mkdir -p ds-lab/projects
for i in $(seq 1 50); do echo "Quarterly report number $i" > "ds-lab/projects/report-$i.txt"; done
head -c 10M /dev/urandom > ds-lab/projects/large-file.bin
aws s3 sync ds-lab/projects "s3://$SRC_BUCKET/projects/"
echo "Source: $SRC_BUCKET  Destination: $DST_BUCKET"
```
:::

> [!CHECK]
> `aws s3 ls "s3://$SRC_BUCKET/projects/" | wc -l` prints `51`, and `aws s3 ls "s3://$DST_BUCKET"` prints nothing.

### Step 2: Create the source location

A **location** tells DataSync where data lives and which IAM role it assumes to reach it. The console can generate the role for you; the CLI tab creates one role that can read the source and write the destination.

:::console
1. Open the **AWS DataSync** console. In the left navigation pane, expand **Data transfer**, choose **Locations**, then **Create location**.
2. For **Location type**, choose **Amazon S3**, then choose **General purpose bucket**.
3. For **S3 URI**, choose your `ds-lab-src-...` bucket and add the prefix so it reads `s3://ds-lab-src-.../projects/`.
4. Leave **S3 storage class when used as a destination** at its default (it only matters when this location is a destination).
5. For **IAM role**, choose **Autogenerate**.
6. Choose **Create location**.
:::

:::cli
```bash
cat > ds-trust.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "datasync.amazonaws.com" },
    "Action": "sts:AssumeRole",
    "Condition": {
      "StringEquals": { "aws:SourceAccount": "$ACCOUNT_ID" },
      "ArnLike": { "aws:SourceArn": "arn:aws:datasync:$REGION:$ACCOUNT_ID:*" }
    }
  }]
}
EOF

cat > ds-s3-access.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetBucketLocation", "s3:ListBucket", "s3:ListBucketMultipartUploads"],
      "Resource": ["arn:aws:s3:::$SRC_BUCKET", "arn:aws:s3:::$DST_BUCKET"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:AbortMultipartUpload", "s3:DeleteObject", "s3:GetObject", "s3:GetObjectTagging",
                 "s3:GetObjectVersion", "s3:GetObjectVersionTagging", "s3:ListMultipartUploadParts",
                 "s3:PutObject", "s3:PutObjectTagging"],
      "Resource": ["arn:aws:s3:::$SRC_BUCKET/*", "arn:aws:s3:::$DST_BUCKET/*"]
    }
  ]
}
EOF

ROLE_ARN=$(aws iam create-role --role-name ds-lab-s3-role \
  --assume-role-policy-document file://ds-trust.json --query Role.Arn --output text)
aws iam put-role-policy --role-name ds-lab-s3-role --policy-name ds-lab-s3-access \
  --policy-document file://ds-s3-access.json
sleep 15   # give IAM a moment to propagate the new role

SRC_LOC=$(aws datasync create-location-s3 \
  --s3-bucket-arn "arn:aws:s3:::$SRC_BUCKET" \
  --subdirectory /projects \
  --s3-config "BucketAccessRoleArn=$ROLE_ARN" \
  --query LocationArn --output text)
echo "$SRC_LOC"
```
:::

> [!CHECK]
> The **Locations** page lists an Amazon S3 location whose URI ends in `/projects/`. If you used **Autogenerate**, IAM now has a new role created by DataSync for this bucket (search **Roles** for `DataSync`).

### Step 3: Create the destination location

:::console
1. Back on **Locations**, choose **Create location** again.
2. For **Location type**, choose **Amazon S3**, then **General purpose bucket**.
3. For **S3 URI**, choose your `ds-lab-dst-...` bucket with the prefix `backup/`.
4. For **S3 storage class when used as a destination**, keep **S3 Standard**. (In a real archive job you could pick S3 Glacier Deep Archive here and skip a lifecycle rule.)
5. For **IAM role**, choose **Autogenerate**, then **Create location**.
:::

:::cli
```bash
DST_LOC=$(aws datasync create-location-s3 \
  --s3-bucket-arn "arn:aws:s3:::$DST_BUCKET" \
  --subdirectory /backup \
  --s3-storage-class STANDARD \
  --s3-config "BucketAccessRoleArn=$ROLE_ARN" \
  --query LocationArn --output text)
echo "$DST_LOC"
```
:::

### Step 4: Create a Basic mode task

:::console
1. In the navigation pane, under **Data transfer**, choose **Tasks**, then **Create task**.
2. On **Configure source location**, choose the existing source location you created (`.../projects/`) and choose **Next**.
3. On **Configure destination location**, choose the existing destination location (`.../backup/`) and choose **Next**.
4. On **Configure settings**, for the task name enter `ds-lab-copy`, and for **Task mode** choose **Basic**.
5. For verification, choose **Verify only the data transferred**.
6. For **Transfer mode**, keep **Transfer only data that has changed**. Leave **Keep deleted files** and **Overwrite files** at their defaults (both selected).
7. Under schedule **Frequency**, keep **Not scheduled**.
8. For **Log level**, choose **Don't generate logs** (this avoids creating a CloudWatch log group for the lab).
9. Choose **Next**, review the settings, and choose **Create task**.
:::

:::cli
```bash
TASK_ARN=$(aws datasync create-task \
  --source-location-arn "$SRC_LOC" \
  --destination-location-arn "$DST_LOC" \
  --name ds-lab-copy \
  --task-mode BASIC \
  --options TransferMode=CHANGED,VerifyMode=ONLY_FILES_TRANSFERRED,PreserveDeletedFiles=PRESERVE,OverwriteMode=ALWAYS,LogLevel=OFF \
  --query TaskArn --output text)
aws datasync describe-task --task-arn "$TASK_ARN" --query Status --output text
```
:::

> [!CHECK]
> The task status is **Available** (`AVAILABLE`). No agent was needed because both locations are AWS storage services.

### Step 5: Run the task and verify the copy

:::console
1. On **Tasks**, select `ds-lab-copy`, choose **Actions**, then **Start**.
2. Choose **See execution details** and watch the status move through **Launching**, **Preparing**, **Transferring** and **Verifying** to **Success** (a few minutes; preparing takes the longest for such a small job).
3. Note the number of files and bytes transferred on the execution page.
4. Open the destination bucket in the S3 console and browse to `backup/`.
:::

:::cli
```bash
EXEC_ARN=$(aws datasync start-task-execution --task-arn "$TASK_ARN" \
  --query TaskExecutionArn --output text)
while true; do
  S=$(aws datasync describe-task-execution --task-execution-arn "$EXEC_ARN" --query Status --output text)
  echo "$(date +%T) $S"
  if [ "$S" = "SUCCESS" ] || [ "$S" = "ERROR" ]; then break; fi
  sleep 15
done
aws datasync describe-task-execution --task-execution-arn "$EXEC_ARN" \
  --query '{Status:Status,FilesTransferred:FilesTransferred,BytesTransferred:BytesTransferred}'
aws s3 ls "s3://$DST_BUCKET/backup/" | wc -l
```
:::

> [!CHECK]
> The execution ends in **Success** with 51 files (the count can include the folder itself) and about 10.5 MB transferred, and the destination's `backup/` prefix holds the same 51 files. The `wc -l` count may show 52 if DataSync also wrote an empty `backup/` folder object.

### Step 6: Change the source and rerun to see an incremental copy

Recurring DataSync runs compare source and destination and copy only differences. Deleted source files are kept at the destination unless you clear **Keep deleted files**.

:::console
1. In CloudShell, run the CLI commands below up to (not including) `start-task-execution`: they add one new file, change one file and delete one file in the source.
2. Start the task again (**Actions** → **Start**) and open the new execution's details.
3. Compare the files transferred with the first run, then list `backup/` in the destination bucket.
:::

:::cli
```bash
echo "Brand new report" > ds-lab/new-report.txt
aws s3 cp ds-lab/new-report.txt "s3://$SRC_BUCKET/projects/new-report.txt"
echo "Quarterly report number 1, revised" > ds-lab/report-1.txt
aws s3 cp ds-lab/report-1.txt "s3://$SRC_BUCKET/projects/report-1.txt"
aws s3 rm "s3://$SRC_BUCKET/projects/report-2.txt"

EXEC2_ARN=$(aws datasync start-task-execution --task-arn "$TASK_ARN" \
  --query TaskExecutionArn --output text)
while true; do
  S=$(aws datasync describe-task-execution --task-execution-arn "$EXEC2_ARN" --query Status --output text)
  echo "$(date +%T) $S"
  if [ "$S" = "SUCCESS" ] || [ "$S" = "ERROR" ]; then break; fi
  sleep 15
done
aws datasync describe-task-execution --task-execution-arn "$EXEC2_ARN" \
  --query '{FilesTransferred:FilesTransferred,BytesTransferred:BytesTransferred}'
aws s3 ls "s3://$DST_BUCKET/backup/report-2.txt"
```
:::

> [!CHECK]
> The second run transfers only the **2** new or changed files (a few bytes, plus possibly a folder entry) instead of 51, and `report-2.txt` still exists in the destination because **Keep deleted files** was on. This is the behavior you want for nightly syncs before a migration cutover.

### Step 7 (optional): Add an hourly schedule, then pause it

:::console
1. On **Tasks**, select `ds-lab-copy` and choose **Edit**.
2. In the schedule section, set **Frequency** to **Hourly** and pick a minute, then choose **Save changes**.
3. Notice that the fastest schedule DataSync allows is once per hour.
4. Choose **Edit** again, turn off **Enable schedule**, and choose **Save changes**.
:::

:::cli
```bash
aws datasync update-task --task-arn "$TASK_ARN" \
  --schedule '{"ScheduleExpression": "rate(1 hour)"}'
aws datasync describe-task --task-arn "$TASK_ARN" --query Schedule

aws datasync update-task --task-arn "$TASK_ARN" \
  --schedule '{"ScheduleExpression": "rate(1 hour)", "Status": "DISABLED"}'
aws datasync describe-task --task-arn "$TASK_ARN" --query Schedule
```
:::

> [!CHECK]
> The **Schedule** column on the **Tasks** page shows the schedule as disabled, and `describe-task` returns `"Status": "DISABLED"` with `"DisabledBy": "USER"`.

## Cleanup

Delete everything in this order:

- [ ] **Task `ds-lab-copy`**: **Tasks** → select it → **Actions** → **Delete**, then confirm. CLI: `aws datasync delete-task --task-arn "$TASK_ARN"`.
- [ ] **Both DataSync locations**: **Locations** → select each S3 location → **Delete**, then confirm. CLI: `aws datasync delete-location --location-arn "$SRC_LOC"` and `aws datasync delete-location --location-arn "$DST_LOC"`.
- [ ] **Destination bucket**: S3 console → select `ds-lab-dst-...` → **Empty** (type `permanently delete`), then **Delete** (type the bucket name). CLI: `aws s3 rb "s3://$DST_BUCKET" --force`.
- [ ] **Source bucket**: same steps for `ds-lab-src-...`. CLI: `aws s3 rb "s3://$SRC_BUCKET" --force`.
- [ ] **IAM roles**: console path: IAM → **Roles** → search `DataSync` and delete the roles DataSync autogenerated for the two buckets. CLI path: `aws iam delete-role-policy --role-name ds-lab-s3-role --policy-name ds-lab-s3-access` then `aws iam delete-role --role-name ds-lab-s3-role`.
- [ ] **CloudShell files**: `rm -rf ds-lab ds-trust.json ds-s3-access.json`.
- [ ] **Final check**: the DataSync **Tasks** and **Locations** pages are empty in this Region, no `ds-lab-*` buckets remain, and the next day **Billing and Cost Management** → **Bills** shows at most a fraction of a cent for DataSync.

## Progress checklist

- [ ] Step 1: Created source and destination buckets and uploaded sample files
- [ ] Step 2: Created the source S3 location and its IAM role
- [ ] Step 3: Created the destination S3 location
- [ ] Step 4: Created a Basic mode task with no agent
- [ ] Step 5: Ran the task and verified 51 objects in the destination
- [ ] Step 6: Saw an incremental run copy only changed files and keep a deleted file
- [ ] Step 7 (optional): Added an hourly schedule and paused it
- [ ] Cleanup done
