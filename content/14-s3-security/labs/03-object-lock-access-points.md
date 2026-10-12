---
id: 14-s3-security-lab-03
title: Protect object versions with Object Lock and scope access with an access point
objective: Create an Object Lock bucket, lock one version in governance mode and another with a legal hold, see which deletes succeed and which fail, then put an access point with its own policy in front of the bucket.
estimatedTime: 40 minutes
cost: "Effectively USD 0.00: a few KB in S3 Standard and a few dozen requests (fractions of a cent, covered by Free Tier credits on accounts from 15 July 2025 or the legacy 12-month Free Tier). Object Lock and access points have no extra charge."
freeTier: yes
services: [s3, s3-object-lock, s3-access-points, iam-policies]
---

> [!WARNING] Never pick compliance mode in a practice account
> A version locked in **compliance** mode cannot be deleted by anyone, including the root user, until its retain-until date passes; the only way out is closing the AWS account. This lab uses **governance** mode only and **no default retention** on the bucket. Read each step before you click.

You will use one bucket with three objects:

| Object | Protection you will add | What it teaches |
|---|---|---|
| `finance/report.txt` | Governance retention until tomorrow | Who can and cannot delete a locked version |
| `finance/budget.txt` | None | Normal reads through the access point |
| `sales/pipeline.txt` | Legal hold | A hold that even a governance bypass cannot override |

## Prerequisites

- An AWS account and an IAM identity with full S3 permissions in a sandbox account, including `s3:PutObjectRetention`, `s3:PutObjectLegalHold`, `s3:BypassGovernanceRetention`, `s3:CreateAccessPoint` and `s3:PutAccessPointPolicy` (`AdministratorAccess` covers them).
- Region **US East (N. Virginia) us-east-1**.
- **AWS CloudShell** (or AWS CLI v2 with GNU `date`) for the CLI tabs. Steps 4 and 6 need the CLI, because the console sends the governance bypass header automatically.
- Run this first (if you create the bucket in the console instead, set `BUCKET` to its name):

```bash
export AWS_REGION=us-east-1
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET="lock-lab-${ACCOUNT_ID}-${RANDOM}"
TOMORROW=$(date -u -d '+1 day' +%Y-%m-%dT%H:%M:%SZ)
echo "$BUCKET $TOMORROW"
echo "Q3 revenue report" > report.txt
echo "2027 budget draft" > budget.txt
echo "open deals list"   > pipeline.txt
```

## Steps

### Step 1: Create a bucket with Object Lock enabled

:::console
1. In the **S3** console choose **General purpose buckets** → **Create bucket**.
2. Enter a unique **Bucket name** starting with `lock-lab-`.
3. Under **Bucket Versioning**, choose **Enabled**.
4. Expand **Advanced settings**, find **Object Lock**, choose **Enable**, and select the acknowledgement that objects in this bucket can be locked permanently.
5. Choose **Create bucket**.
6. Open the bucket's **Properties** tab and check the **Object Lock** section: leave **Default retention** disabled.
:::

:::cli
```bash
# us-east-1 needs no LocationConstraint; other Regions add
# --create-bucket-configuration LocationConstraint=<region>
aws s3api create-bucket --bucket "$BUCKET" --object-lock-enabled-for-bucket
aws s3api get-bucket-versioning --bucket "$BUCKET"
aws s3api get-object-lock-configuration --bucket "$BUCKET"
```
:::

> [!CHECK]
> Versioning shows **Enabled** (S3 turns it on with Object Lock) and the Object Lock configuration shows `"ObjectLockEnabled": "Enabled"` with **no** `Rule`, meaning no default retention. From now on you can never disable Object Lock or suspend versioning on this bucket.

### Step 2: Upload the three objects

:::console
1. On the **Objects** tab choose **Create folder** and create `finance`, then `sales`.
2. Upload `report.txt` and `budget.txt` into `finance/`, and `pipeline.txt` into `sales/`.
:::

:::cli
```bash
aws s3 cp report.txt   "s3://$BUCKET/finance/report.txt"
aws s3 cp budget.txt   "s3://$BUCKET/finance/budget.txt"
aws s3 cp pipeline.txt "s3://$BUCKET/sales/pipeline.txt"
REPORT_VID=$(aws s3api head-object --bucket "$BUCKET" --key finance/report.txt --query VersionId --output text)
PIPE_VID=$(aws s3api head-object --bucket "$BUCKET" --key sales/pipeline.txt --query VersionId --output text)
echo "$REPORT_VID $PIPE_VID"
```
:::

### Step 3: Lock report.txt in governance mode until tomorrow

:::console
1. Open `finance/report.txt`.
2. On the object's **Properties** page, find the **Object Lock retention** section and choose **Edit**.
3. Under **Retention**, choose **Enable**.
4. Under **Retention mode**, choose **Governance mode** (not compliance).
5. Under **Retain until date**, pick **tomorrow's** date and choose **Save changes**.
:::

:::cli
```bash
aws s3api put-object-retention --bucket "$BUCKET" --key finance/report.txt \
  --retention "{\"Mode\":\"GOVERNANCE\",\"RetainUntilDate\":\"${TOMORROW}\"}"
aws s3api get-object-retention --bucket "$BUCKET" --key finance/report.txt
```
:::

> [!CHECK]
> The object shows retention mode **GOVERNANCE** and a retain-until date of tomorrow.

### Step 4: Try to delete the locked object

First a simple delete (no version ID), then a delete of the specific version without and with the bypass.

:::console
1. With **Show versions** turned off, select `finance/report.txt` and choose **Delete**. Type `delete` and confirm.
2. Turn **Show versions** on. You see the original version plus a new **Delete marker**.
3. Do the version-specific delete from the CLI tab: as an administrator the console would add the bypass header for you and simply succeed.
:::

:::cli
```bash
# If you uploaded with the console, look up the version ID first.
REPORT_VID=${REPORT_VID:-$(aws s3api head-object --bucket "$BUCKET" --key finance/report.txt --query VersionId --output text)}

# 1. Simple delete: succeeds, but only adds a delete marker.
aws s3api delete-object --bucket "$BUCKET" --key finance/report.txt
aws s3api list-object-versions --bucket "$BUCKET" --prefix finance/report.txt \
  --query '{Versions:Versions[].VersionId,Markers:DeleteMarkers[].VersionId}'

# 2. Permanent delete of the locked version without bypass: refused.
aws s3api delete-object --bucket "$BUCKET" --key finance/report.txt --version-id "$REPORT_VID"
```
:::

> [!CHECK]
> The simple delete returns success and creates a delete marker; the locked version is still listed. The version-specific delete fails with **AccessDenied** because the version is under governance retention. Object Lock protects versions; it does not stop delete markers.

Now prove that governance mode can be overridden by someone with `s3:BypassGovernanceRetention`:

:::cli
```bash
aws s3api delete-object --bucket "$BUCKET" --key finance/report.txt \
  --version-id "$REPORT_VID" --bypass-governance-retention
aws s3api list-object-versions --bucket "$BUCKET" --prefix finance/report.txt \
  --query '{Versions:Versions[].VersionId,Markers:DeleteMarkers[].VersionId}'
```
:::

> [!CHECK]
> With the bypass header the delete succeeds and only the delete marker is left. In compliance mode this command would have failed for every user, including root.

### Step 5: Put a legal hold on sales/pipeline.txt

:::console
1. Open `sales/pipeline.txt`.
2. On its **Properties** page, find **Object Lock legal hold** and choose **Edit**.
3. Choose **Enable** and **Save changes**.
:::

:::cli
```bash
aws s3api put-object-legal-hold --bucket "$BUCKET" --key sales/pipeline.txt --legal-hold Status=ON
aws s3api get-object-legal-hold --bucket "$BUCKET" --key sales/pipeline.txt
```
:::

### Step 6: Show that a legal hold ignores the governance bypass

:::cli
```bash
PIPE_VID=${PIPE_VID:-$(aws s3api head-object --bucket "$BUCKET" --key sales/pipeline.txt --query VersionId --output text)}
aws s3api delete-object --bucket "$BUCKET" --key sales/pipeline.txt \
  --version-id "$PIPE_VID" --bypass-governance-retention
```
:::

> [!CHECK]
> The delete fails with **AccessDenied** even with the bypass flag: a legal hold has no expiry and stays until someone with `s3:PutObjectLegalHold` removes it. Leave the hold on for now; you remove it in the cleanup.

### Step 7: Create an access point that blocks the sales prefix

In this single-account lab your administrator identity already has full S3 access, so an `Allow` statement in an access point policy would not visibly change anything. A `Deny` statement does: it shows that requests through this access point are limited by its own policy, while direct bucket access is unaffected.

:::console
1. In the S3 console's left navigation pane, choose **Access Points** → **Create access point**.
2. **Access point name**: `finance-ap`.
3. **Data source**: choose **Choose a bucket in this account** and select your `lock-lab-...` bucket.
4. **Network origin**: **Internet**.
5. Keep all **Block Public Access settings for this Access Point** enabled.
6. Under **Access Point policy - optional**, paste the policy below with your account ID, then choose **Create access point**.
7. Open `finance-ap` and note its alias and ARN.
:::

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "DenySalesThroughFinanceAp",
    "Effect": "Deny",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:us-east-1:ACCOUNT_ID:accesspoint/finance-ap/object/sales/*"
  }]
}
```

:::cli
```bash
aws s3control create-access-point --account-id "$ACCOUNT_ID" --name finance-ap --bucket "$BUCKET"
AP_ARN="arn:aws:s3:${AWS_REGION}:${ACCOUNT_ID}:accesspoint/finance-ap"
aws s3control put-access-point-policy --account-id "$ACCOUNT_ID" --name finance-ap --policy "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Sid\": \"DenySalesThroughFinanceAp\",
    \"Effect\": \"Deny\",
    \"Principal\": \"*\",
    \"Action\": \"s3:GetObject\",
    \"Resource\": \"${AP_ARN}/object/sales/*\"
  }]
}"
aws s3control get-access-point --account-id "$ACCOUNT_ID" --name finance-ap \
  --query '{Origin:NetworkOrigin,Alias:Alias}'
```
:::

### Step 8: Read through the access point and directly

:::console
1. Open `finance-ap` from **Access Points**; on its **Objects** tab, open `finance/` and download `budget.txt`.
2. Still inside the access point, try to download `sales/pipeline.txt`.
3. Go back to the bucket itself (**General purpose buckets** → your bucket) and download `sales/pipeline.txt` there.
:::

:::cli
```bash
aws s3api get-object --bucket "$AP_ARN" --key finance/budget.txt budget-via-ap.txt && cat budget-via-ap.txt
aws s3api get-object --bucket "$AP_ARN" --key sales/pipeline.txt pipeline-via-ap.txt
aws s3api get-object --bucket "$BUCKET" --key sales/pipeline.txt pipeline-direct.txt && cat pipeline-direct.txt
```
:::

> [!CHECK]
> `finance/budget.txt` downloads through the access point. `sales/pipeline.txt` fails with **AccessDenied** through `finance-ap`, but downloads fine directly from the bucket: an access point policy only governs requests made through that access point. In production you would also delegate the bucket policy to access points and remove direct access, so each team can only use its own access point.

## Cleanup

Delete in this order:

- [ ] **Access point `finance-ap`** (its policy goes with it): **Access Points** → `finance-ap` → **Delete**, type the name, choose **Delete**. CLI: `aws s3control delete-access-point --account-id "$ACCOUNT_ID" --name finance-ap`.
- [ ] **Legal hold** on `sales/pipeline.txt`: object **Properties** → **Object Lock legal hold** → **Edit** → **Disable** → **Save changes**. CLI: `aws s3api put-object-legal-hold --bucket "$BUCKET" --key sales/pipeline.txt --legal-hold Status=OFF`.
- [ ] **All object versions and delete markers** in the bucket (governance retention is bypassed; nothing in this bucket is in compliance mode): in the console turn **Show versions** on, select everything, choose **Delete** and type `permanently delete` (the console adds the bypass header). CLI:

  ```bash
  for KIND in Versions DeleteMarkers; do
    aws s3api list-object-versions --bucket "$BUCKET" \
      --query "${KIND}[].[Key,VersionId]" --output text |
    while read -r KEY VID; do
      [ "$KEY" = "None" ] && continue
      aws s3api delete-object --bucket "$BUCKET" --key "$KEY" --version-id "$VID" --bypass-governance-retention
    done
  done
  aws s3api list-object-versions --bucket "$BUCKET" --query '[Versions, DeleteMarkers]'
  ```

- [ ] **Bucket `lock-lab-...`**: **General purpose buckets** → select → **Delete**, enter the name. CLI: `aws s3api delete-bucket --bucket "$BUCKET"`.
- [ ] **Local files**: `rm -f report.txt budget.txt pipeline.txt budget-via-ap.txt pipeline-via-ap.txt pipeline-direct.txt`.
- [ ] **Final check**: `aws s3 ls | grep lock-lab` and `aws s3control list-access-points --account-id "$ACCOUNT_ID"` show nothing from this lab.

## Progress checklist

- [ ] Step 1: Created a bucket with Object Lock (no default retention)
- [ ] Step 2: Uploaded three objects under `finance/` and `sales/`
- [ ] Step 3: Locked `finance/report.txt` in governance mode
- [ ] Step 4: Saw a delete marker succeed, a version delete fail, and a bypass delete succeed
- [ ] Step 5: Put a legal hold on `sales/pipeline.txt`
- [ ] Step 6: Saw the legal hold block even a bypass delete
- [ ] Step 7: Created `finance-ap` with a Deny policy for `sales/*`
- [ ] Step 8: Compared reads through the access point and directly
- [ ] Cleanup done
