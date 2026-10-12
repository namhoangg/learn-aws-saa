---
id: 13-s3-advanced-lab-01
title: Tier, expire and clean up objects with S3 Lifecycle rules
objective: Build a versioned bucket, add lifecycle rules for current and noncurrent versions, watch an incomplete multipart upload and clean it up, set up Storage Class Analysis and switch the bucket to Requester Pays.
estimatedTime: 40 minutes
cost: "Well under USD 0.01 if you clean up the same day: a few MB of S3 Standard storage and a few hundred requests. Storage Class Analysis bills per million objects monitored, which rounds to zero for a handful of objects."
freeTier: partial
services: [s3, s3-glacier]
---

> [!COST]
> Everything here is tiny, but S3 storage, requests and Storage Class Analysis are billed services. New accounts' Free Tier credits (or the legacy 12-month Free Tier's 5 GB of S3 Standard) cover it. Lifecycle **transitions** would also be billed per 1,000 objects, but none will happen during the lab because the rules use 30 days or more. The real risk is forgetting the bucket: delete it in **Cleanup**.

You cannot wait 30 days for a transition in a lab, so this lab focuses on **building and verifying** the rules, and on the parts you can see immediately: versions, delete markers, an incomplete multipart upload and the bucket settings. The steps use `us-east-1`; any Region works.

## Prerequisites

- An AWS account and an IAM user or role with S3 permissions (for example the `AmazonS3FullAccess` managed policy).
- For the CLI tabs: **AWS CloudShell** (opened from the console toolbar) or AWS CLI v2 configured locally with a Bash shell. Keep one terminal open for the whole lab; later commands reuse shell variables.
- A globally unique bucket name. The examples use `lab-lifecycle-<your initials>-<random digits>`.

## Steps

### Step 1: Create a versioned bucket

:::console
1. Open the **S3** console and choose **General purpose buckets** → **Create bucket**.
2. For **Bucket name**, enter your unique name (for example `lab-lifecycle-nh-48213`). Keep **Block all public access** turned on.
3. Under **Bucket Versioning**, choose **Enable**.
4. Leave the other settings at their defaults and choose **Create bucket**.
:::

:::cli
```bash
export AWS_REGION=us-east-1
BUCKET=lab-lifecycle-$RANDOM$RANDOM
aws s3api create-bucket --bucket "$BUCKET" --region "$AWS_REGION"
# Outside us-east-1 add: --create-bucket-configuration LocationConstraint=$AWS_REGION
aws s3api put-bucket-versioning --bucket "$BUCKET" \
  --versioning-configuration Status=Enabled
echo "Bucket: $BUCKET"
```
:::

> [!CHECK]
> `aws s3api get-bucket-versioning --bucket "$BUCKET"` returns `"Status": "Enabled"`, and the bucket's **Properties** tab shows **Bucket Versioning: Enabled**.

### Step 2: Create objects, versions and a delete marker

You need a few objects in a `logs/` prefix, one overwritten object (so it has a noncurrent version) and one deleted object (so it has a delete marker).

:::console
1. On your computer, create three small text files: `app-1.log`, `app-2.log` and `notes.txt` (any content).
2. Open the bucket, choose **Create folder**, name it `logs`, and choose **Create folder**.
3. Open the `logs/` folder, choose **Upload**, add `app-1.log` and `app-2.log`, and choose **Upload**.
4. Go back to the bucket root and upload `notes.txt`.
5. Edit `notes.txt` on your computer (change its text) and upload it again to the bucket root. This creates a second version.
6. Select `logs/app-2.log`, choose **Delete**, type `delete` and confirm. With versioning on, this only adds a delete marker.
7. Turn on **Show versions** above the object list to see every version and the delete marker.
:::

:::cli
```bash
echo "first log line" > app-1.log
echo "second log line" > app-2.log
echo "version one" > notes.txt
aws s3 cp app-1.log "s3://$BUCKET/logs/app-1.log"
aws s3 cp app-2.log "s3://$BUCKET/logs/app-2.log"
aws s3 cp notes.txt "s3://$BUCKET/notes.txt"
echo "version two" > notes.txt
aws s3 cp notes.txt "s3://$BUCKET/notes.txt"
aws s3 rm "s3://$BUCKET/logs/app-2.log"      # adds a delete marker
aws s3api list-object-versions --bucket "$BUCKET" \
  --query '{Versions: Versions[].[Key,IsLatest], DeleteMarkers: DeleteMarkers[].[Key,IsLatest]}'
```
:::

> [!CHECK]
> With **Show versions** on (or in the CLI output) you see two versions of `notes.txt` (only the newest is current), one version of `logs/app-1.log`, and for `logs/app-2.log` a noncurrent version plus a **Delete marker** that is current. With **Show versions** off, `app-2.log` seems to be gone.

### Step 3: Add a rule that tiers and expires current log files

Rule `logs-tiering`: objects under `logs/` move to Standard-IA after 30 days, to Glacier Flexible Retrieval after 90 days, and are deleted after 365 days.

:::console
1. In the bucket, open the **Management** tab and choose **Create lifecycle rule**.
2. For **Lifecycle rule name**, enter `logs-tiering`.
3. Under the rule scope, choose **Limit the scope to specific prefixes or tags** and enter `logs/` in **Prefix**.
4. Under **Lifecycle rule actions**, select **Transition current versions of objects between storage classes** and **Expire current versions of objects**.
5. In **Transition current versions of objects between storage classes**, choose **S3 Standard-IA** with **Days after object creation** `30`. Choose **Add transition**, then **S3 Glacier Flexible Retrieval** with `90` days. Acknowledge the transition-cost check box if the console shows one.
6. In **Expire current versions of objects**, set **Number of days after object creation** to `365`.
7. Review the timeline summary at the bottom and choose **Create rule**.
:::

:::cli
```bash
# Both rules (this step and the next) go in one file, because the API
# replaces the whole lifecycle configuration on every put.
cat > lifecycle.json <<'EOF'
{
  "Rules": [
    {
      "ID": "logs-tiering",
      "Filter": { "Prefix": "logs/" },
      "Status": "Enabled",
      "Transitions": [
        { "Days": 30, "StorageClass": "STANDARD_IA" },
        { "Days": 90, "StorageClass": "GLACIER" }
      ],
      "Expiration": { "Days": 365 }
    }
  ]
}
EOF
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" \
  --lifecycle-configuration file://lifecycle.json
```
:::

> [!CHECK]
> The **Management** tab lists `logs-tiering` with status **Enabled**. The rule's timeline shows day 0 upload, day 30 Standard-IA, day 90 Glacier Flexible Retrieval, day 365 expiration. Your test logs are tiny (under 128 KB), so the default size rule means lifecycle would not transition them; it would still expire them on day 365.

### Step 4: Add a rule for old versions, delete markers and abandoned uploads

Rule `versions-and-cleanup` (whole bucket): noncurrent versions move to Standard-IA after 30 days and are permanently deleted 90 days after becoming noncurrent, except the 3 newest; expired delete markers are removed; multipart uploads still incomplete after 7 days are aborted.

:::console
1. On the **Management** tab, choose **Create lifecycle rule** again and name it `versions-and-cleanup`.
2. Choose **This rule applies to *all* objects in the bucket** and select **I acknowledge that this rule applies to all objects in the bucket**.
3. Under **Lifecycle rule actions**, select **Transition noncurrent versions of objects between storage classes**, **Permanently delete noncurrent versions of objects** and **Delete expired delete markers or incomplete multipart uploads**.
4. In the noncurrent transition section, choose **S3 Standard-IA** with **Days after objects become noncurrent** `30`.
5. In **Permanently delete noncurrent versions of objects**, set **Days after objects become noncurrent** to `90` and **Number of newer versions to retain** to `3`.
6. Select **Delete expired object delete markers** and **Delete incomplete multipart uploads**, and set the number of days for incomplete uploads to `7`.
7. Choose **Create rule**.
:::

:::cli
```bash
cat > lifecycle.json <<'EOF'
{
  "Rules": [
    {
      "ID": "logs-tiering",
      "Filter": { "Prefix": "logs/" },
      "Status": "Enabled",
      "Transitions": [
        { "Days": 30, "StorageClass": "STANDARD_IA" },
        { "Days": 90, "StorageClass": "GLACIER" }
      ],
      "Expiration": { "Days": 365 }
    },
    {
      "ID": "versions-and-cleanup",
      "Filter": { "Prefix": "" },
      "Status": "Enabled",
      "NoncurrentVersionTransitions": [
        { "NoncurrentDays": 30, "StorageClass": "STANDARD_IA" }
      ],
      "NoncurrentVersionExpiration": { "NoncurrentDays": 90, "NewerNoncurrentVersions": 3 },
      "Expiration": { "ExpiredObjectDeleteMarker": true },
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 }
    }
  ]
}
EOF
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" \
  --lifecycle-configuration file://lifecycle.json
aws s3api get-bucket-lifecycle-configuration --bucket "$BUCKET"
```
:::

> [!CHECK]
> `get-bucket-lifecycle-configuration` returns **two** rules. If you had put only the second rule in the file, the first would have disappeared: every put replaces the whole configuration. In the console, both rules are listed on the **Management** tab.

> [!TIP]
> Try to add a tag filter to `versions-and-cleanup` in the console. The delete-marker and incomplete-upload options become unavailable, because those two actions cannot be used in tag-filtered rules.

### Step 5: Watch an incomplete multipart upload (CLI only)

Incomplete uploads are invisible in the normal object list but still cost money. This step creates one on purpose. There is no console equivalent; use CloudShell.

:::cli
```bash
dd if=/dev/urandom of=part1.bin bs=1M count=5
UPLOAD_ID=$(aws s3api create-multipart-upload --bucket "$BUCKET" \
  --key uploads/big.bin --checksum-algorithm CRC32 \
  --query UploadId --output text)
aws s3api upload-part --bucket "$BUCKET" --key uploads/big.bin \
  --part-number 1 --body part1.bin --upload-id "$UPLOAD_ID" \
  --checksum-algorithm CRC32
aws s3api list-multipart-uploads --bucket "$BUCKET" \
  --query 'Uploads[].[Key,UploadId,Initiated]'
aws s3 ls "s3://$BUCKET/uploads/"          # shows nothing
```
:::

> [!CHECK]
> `list-multipart-uploads` shows `uploads/big.bin` with an upload ID, but `aws s3 ls` and the console object list show no `uploads/` object. Those 5 MB are billed until the upload is completed or aborted.

Your lifecycle rule would abort the upload after 7 days. Abort it now by hand:

:::cli
```bash
aws s3api abort-multipart-upload --bucket "$BUCKET" --key uploads/big.bin \
  --upload-id "$UPLOAD_ID"
aws s3api list-multipart-uploads --bucket "$BUCKET"   # no Uploads left
```
:::

> [!CHECK]
> The second `list-multipart-uploads` call returns no `Uploads` entry, so nothing is left to bill.

### Step 6: Configure Storage Class Analysis for the logs prefix

:::console
1. In the bucket, open the **Metrics** tab.
2. Under **Storage Class Analysis**, choose **Create analytics configuration**.
3. Enter the name `logs-analysis` and the **Prefix** `logs/`. Leave **Export CSV** disabled.
4. Choose **Create Configuration**.
:::

:::cli
```bash
aws s3api put-bucket-analytics-configuration --bucket "$BUCKET" --id logs-analysis \
  --analytics-configuration '{"Id":"logs-analysis","Filter":{"Prefix":"logs/"},"StorageClassAnalysis":{}}'
aws s3api list-bucket-analytics-configurations --bucket "$BUCKET"
```
:::

> [!CHECK]
> The **Metrics** tab lists `logs-analysis`. Charts appear only after 24–48 hours, and a recommendation needs about 30 days of access data, so in a real project you would come back later and use the suggested age for the Standard-IA transition in `logs-tiering`.

### Step 7: Switch the bucket to Requester Pays

:::console
1. Open the bucket's **Properties** tab.
2. Under **Requester pays**, choose **Edit**, choose **Enable**, then **Save changes**.
:::

:::cli
```bash
aws s3api put-bucket-request-payment --bucket "$BUCKET" \
  --request-payment-configuration Payer=Requester
aws s3api get-bucket-request-payment --bucket "$BUCKET"
# A download that acknowledges the charge (another account must always send this):
aws s3api get-object --bucket "$BUCKET" --key logs/app-1.log \
  --request-payer requester app-1-copy.log
```
:::

> [!CHECK]
> `get-bucket-request-payment` returns `"Payer": "Requester"` and **Properties** shows **Requester pays: Enabled**. Your own download works with or without `--request-payer` because bucket owners are exempt; a user from another account who leaves it out gets **403 Access Denied**, and anonymous requests are always refused.

## Cleanup

Delete in this order. The console's **Empty** action removes every version and delete marker for you.

- [ ] **Abort leftover multipart uploads** (if Step 5 was interrupted). CLI: `aws s3api list-multipart-uploads --bucket "$BUCKET"`, then `abort-multipart-upload` for each upload ID.
- [ ] **Storage Class Analysis configuration** `logs-analysis`. Console: **Metrics** tab → **Storage Class Analysis** → select it → **Delete**. CLI: `aws s3api delete-bucket-analytics-configuration --bucket "$BUCKET" --id logs-analysis`.
- [ ] **Requester Pays** (optional, the bucket is deleted next). CLI: `aws s3api put-bucket-request-payment --bucket "$BUCKET" --request-payment-configuration Payer=BucketOwner`.
- [ ] **Lifecycle configuration** (both rules). Console: **Management** tab → select each rule → **Delete**. CLI: `aws s3api delete-bucket-lifecycle --bucket "$BUCKET"`.
- [ ] **All object versions and delete markers**. Console: select the bucket → **Empty** → type `permanently delete` → **Empty**. CLI:

```bash
aws s3api delete-objects --bucket "$BUCKET" --delete "$(aws s3api list-object-versions \
  --bucket "$BUCKET" --query '{Objects: Versions[].{Key:Key,VersionId:VersionId}}' --output json)"
aws s3api delete-objects --bucket "$BUCKET" --delete "$(aws s3api list-object-versions \
  --bucket "$BUCKET" --query '{Objects: DeleteMarkers[].{Key:Key,VersionId:VersionId}}' --output json)"
```

  If one of the two commands fails because there is nothing of that kind left (for example no delete markers), skip it.

- [ ] **The bucket**. Console: select it → **Delete** → type the bucket name → **Delete bucket**. CLI: `aws s3api delete-bucket --bucket "$BUCKET"`.
- [ ] **Local files** in CloudShell: `rm -f app-1.log app-2.log app-1-copy.log notes.txt part1.bin lifecycle.json`.
- [ ] **Final check**: `aws s3api head-bucket --bucket "$BUCKET"` returns a 404 (Not Found) error, and the bucket is gone from **General purpose buckets**.

## Progress checklist

- [ ] Step 1: Versioned bucket created
- [ ] Step 2: Objects, a noncurrent version and a delete marker created
- [ ] Step 3: `logs-tiering` rule created
- [ ] Step 4: `versions-and-cleanup` rule created and both rules verified
- [ ] Step 5: Incomplete multipart upload found and aborted
- [ ] Step 6: Storage Class Analysis configured
- [ ] Step 7: Requester Pays enabled and tested
- [ ] Cleanup done
