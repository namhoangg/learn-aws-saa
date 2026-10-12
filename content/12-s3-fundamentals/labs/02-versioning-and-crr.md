---
id: 12-s3-fundamentals-lab-02
title: Versioning, delete markers and Cross-Region Replication
objective: Use S3 Versioning to recover overwritten and deleted objects, then replicate a bucket from us-east-1 to us-west-2 and observe which writes and deletes are copied.
estimatedTime: 45 minutes
cost: "Well under USD 0.01: a few KB stored in two buckets (one copy in Standard-IA with its 128 KB and 30-day minimums), a few dozen requests and a few KB of inter-Region transfer at USD 0.02 per GB."
freeTier: partial
services: [s3, iam, iam-roles]
---

> [!COST]
> S3 storage and requests here fit in Free Tier credits or the legacy Free Tier, but two items are billed outside the classic free allowances: **inter-Region data transfer** for replication (USD 0.02 per GB from us-east-1 to us-west-2) and **Standard-IA** replicas, which are billed as at least 128 KB for at least 30 days. With the tiny text files in this lab the total stays far below one cent. Do not upload large files, and finish the **Cleanup** section; versioned buckets keep every version until you delete them.

This lab follows the slides' versioning and replication demos: you overwrite and "delete" a file and get it back, then set up CRR and test the replication rules that exam questions love (existing objects, delete markers, version-specific deletes).

## Prerequisites

- An AWS account and an IAM identity that can manage S3 buckets and replication, and create IAM roles (for example `AmazonS3FullAccess` plus `IAMFullAccess`, or administrator access in a sandbox account). Creating a replication rule also requires `iam:PassRole`.
- Regions **US East (N. Virginia) `us-east-1`** (source) and **US West (Oregon) `us-west-2`** (destination), both enabled in the account.
- For the CLI tabs: AWS CLI v2 configured, or AWS CloudShell in us-east-1, with a Bash shell.

## Steps

### Step 1: Create a versioned source bucket in us-east-1

:::console
1. Open the **Amazon S3** console in **US East (N. Virginia)**. Choose **General purpose buckets** → **Create bucket**.
2. **Bucket name**: `s3-lab-crr-src-<random digits>`. Keep **Object Ownership** and **Block Public Access** at their defaults.
3. Under **Bucket Versioning**, choose **Enable**.
4. Choose **Create bucket**.
:::

:::cli
```bash
export AWS_REGION=us-east-1
SUFFIX=$(date +%s)
SRC="s3-lab-crr-src-$SUFFIX"
DST="s3-lab-crr-dst-$SUFFIX"
echo "Source: $SRC  Destination: $DST"
aws s3api create-bucket --bucket "$SRC" --region us-east-1
aws s3api put-bucket-versioning --bucket "$SRC" --versioning-configuration Status=Enabled
aws s3api get-bucket-versioning --bucket "$SRC"
```
:::

> [!CHECK]
> On the bucket's **Properties** tab, **Bucket Versioning** shows **Enabled**; the CLI prints `"Status": "Enabled"`. AWS recommends waiting 15 minutes after first enabling versioning before the first `PUT` or `DELETE` on the bucket, so create the destination bucket in step 2, then let 15 minutes pass (counted from this step) before you start step 3.

### Step 2: Create a versioned destination bucket in us-west-2

:::console
1. In the navigation bar, switch the Region to **US West (Oregon)**, then choose **General purpose buckets** → **Create bucket**.
2. **Bucket name**: `s3-lab-crr-dst-<same digits>`. Make sure the bucket's **AWS Region** is `us-west-2`.
3. Under **Bucket Versioning**, choose **Enable**, then **Create bucket**.
:::

:::cli
```bash
aws s3api create-bucket --bucket "$DST" --region us-west-2 \
  --create-bucket-configuration LocationConstraint=us-west-2
aws s3api put-bucket-versioning --bucket "$DST" --region us-west-2 \
  --versioning-configuration Status=Enabled
aws s3api get-bucket-location --bucket "$DST" --region us-west-2
```
:::

> [!CHECK]
> The bucket list shows two buckets in different Regions, both with versioning enabled. `get-bucket-location` returns `us-west-2`.

### Step 3: Overwrite a file and read an older version

Create a local file `notes.txt` containing `version 1 - original`.

:::console
1. Open the **source** bucket, choose **Upload** → **Add files**, select `notes.txt`, and choose **Upload**.
2. Edit the local file so it says `version 2 - edited by mistake`, and upload it again with the same name.
3. In the **Objects** tab, turn on the **Show versions** switch. Two versions of `notes.txt` appear, each with its own **Version ID**; the newest is the current one.
4. Select the older version and choose **Download** (from **Actions** if needed); open the file to confirm it contains version 1.
:::

:::cli
```bash
mkdir -p s3-lab-crr && cd s3-lab-crr
echo "version 1 - original" > notes.txt
aws s3 cp notes.txt "s3://$SRC/notes.txt"
echo "version 2 - edited by mistake" > notes.txt
aws s3 cp notes.txt "s3://$SRC/notes.txt"

aws s3api list-object-versions --bucket "$SRC" --prefix notes.txt \
  --query 'Versions[].[VersionId,IsLatest,LastModified]' --output table
V1=$(aws s3api list-object-versions --bucket "$SRC" --prefix notes.txt \
  --query 'Versions[?IsLatest==`false`].VersionId | [0]' --output text)
aws s3api get-object --bucket "$SRC" --key notes.txt --version-id "$V1" v1.txt > /dev/null
cat v1.txt
```
:::

> [!CHECK]
> Two versions exist. A plain download returns version 2, but asking for the older version ID returns `version 1 - original`. Both versions are billed as full objects.

### Step 4: Delete the file and undelete it

:::console
1. Turn **Show versions** off. Select `notes.txt`, choose **Delete**, type the confirmation text the page asks for, and choose **Delete objects**. The object disappears from the list.
2. Turn **Show versions** on. A **Delete marker** is now the latest entry for `notes.txt`, above both data versions.
3. Select only the **delete marker**, choose **Delete**, enter `permanently delete` when asked, and choose **Delete objects**.
4. Turn **Show versions** off: `notes.txt` is back, with the version 2 content.
:::

:::cli
```bash
aws s3 rm "s3://$SRC/notes.txt"          # no version ID: adds a delete marker
aws s3 ls "s3://$SRC/"                    # notes.txt is no longer listed
aws s3api list-object-versions --bucket "$SRC" --prefix notes.txt \
  --query '{Versions:Versions[].VersionId,DeleteMarkers:DeleteMarkers[].VersionId}'
DM=$(aws s3api list-object-versions --bucket "$SRC" --prefix notes.txt \
  --query 'DeleteMarkers[?IsLatest==`true`].VersionId | [0]' --output text)
aws s3api delete-object --bucket "$SRC" --key notes.txt --version-id "$DM"   # remove the marker
aws s3 cp "s3://$SRC/notes.txt" -        # prints version 2 again
```
:::

> [!CHECK]
> Deleting without a version ID only hid the object behind a delete marker; nothing was lost. Removing the marker (a delete **with** a version ID) brought it back. `notes.txt` now exists in the source **before** any replication rule, which matters in step 6.

### Step 5: Create a Cross-Region Replication rule

:::console
1. Open the **source** bucket and choose the **Management** tab. Scroll to **Replication rules** and choose **Create replication rule**.
2. **Replication rule name**: `crr-to-west`. Keep **Status** **Enabled**.
3. Under **Source bucket**, choose **Apply to all objects in the bucket**.
4. Under **Destination**, choose **Choose a bucket in this account** and browse to the `s3-lab-crr-dst-...` bucket.
5. Under **IAM role**, choose **Create new role**.
6. Under **Destination storage class**, select **Change the storage class for the replicated objects** and choose **Standard-IA**.
7. Under **Additional replication options**, select **Delete marker replication**. Leave **Replication Time Control (RTC)** and **Replication metrics and events** cleared (they cost extra).
8. Choose **Save**. If the console offers to replicate existing objects with a Batch Operations job, decline it for this lab.
9. Open the new rule and write down the **IAM role** name it shows; you delete that role during cleanup.
:::

:::cli
```bash
ROLE=s3-lab-crr-role
cat > trust.json <<'EOF'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"s3.amazonaws.com"},"Action":"sts:AssumeRole"}]}
EOF
cat > perms.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {"Effect": "Allow", "Action": ["s3:GetReplicationConfiguration", "s3:ListBucket"],
     "Resource": "arn:aws:s3:::$SRC"},
    {"Effect": "Allow", "Action": ["s3:GetObjectVersionForReplication", "s3:GetObjectVersionAcl", "s3:GetObjectVersionTagging"],
     "Resource": "arn:aws:s3:::$SRC/*"},
    {"Effect": "Allow", "Action": ["s3:ReplicateObject", "s3:ReplicateDelete", "s3:ReplicateTags"],
     "Resource": "arn:aws:s3:::$DST/*"}
  ]
}
EOF
ROLE_ARN=$(aws iam create-role --role-name "$ROLE" \
  --assume-role-policy-document file://trust.json --query Role.Arn --output text)
aws iam put-role-policy --role-name "$ROLE" --policy-name s3-lab-crr-policy \
  --policy-document file://perms.json
sleep 15   # let the new role propagate

cat > replication.json <<EOF
{
  "Role": "$ROLE_ARN",
  "Rules": [
    {
      "ID": "crr-to-west",
      "Status": "Enabled",
      "Priority": 1,
      "Filter": {"Prefix": ""},
      "DeleteMarkerReplication": {"Status": "Enabled"},
      "Destination": {"Bucket": "arn:aws:s3:::$DST", "StorageClass": "STANDARD_IA"}
    }
  ]
}
EOF
aws s3api put-bucket-replication --bucket "$SRC" --replication-configuration file://replication.json
aws s3api get-bucket-replication --bucket "$SRC" --query 'ReplicationConfiguration.Rules[0].[ID,Status]'
```
:::

> [!CHECK]
> The **Replication rules** table lists `crr-to-west` as **Enabled** with the destination bucket and Region `us-west-2`. If versioning were off on either bucket, the console would refuse the rule (and offer an **Enable versioning** button).

### Step 6: Upload a new object and confirm the replica

:::console
1. In the source bucket, upload a new local file `report.txt` (any text).
2. Open `report.txt` → **Properties**. Under **Object management overview**, **Replication status** shows **PENDING**, then **COMPLETED** after a refresh (usually within a minute).
3. Open the destination bucket. `report.txt` is there; its **Replication status** is **REPLICA**, its **Storage class** is **Standard-IA**, and with **Show versions** on its **Version ID** matches the source.
4. Note that `notes.txt` is **not** in the destination.
:::

:::cli
```bash
echo "quarterly report" > report.txt
aws s3 cp report.txt "s3://$SRC/report.txt"
sleep 30
aws s3api head-object --bucket "$SRC" --key report.txt \
  --query '{Status:ReplicationStatus,Version:VersionId}'
aws s3api head-object --bucket "$DST" --region us-west-2 --key report.txt \
  --query '{Status:ReplicationStatus,Version:VersionId,Class:StorageClass}'
aws s3 ls "s3://$DST/" --region us-west-2
```
:::

> [!CHECK]
> Source status `COMPLETED`, destination status `REPLICA`, identical version IDs, destination class `STANDARD_IA`. Only `report.txt` replicated: `notes.txt` existed before the rule, and live replication never copies existing objects (that is what S3 Batch Replication is for). If you overwrite `notes.txt` now, that new version will replicate.

### Step 7: Test which deletes replicate

:::console
1. In the source bucket (versions hidden), delete `report.txt`. Wait about a minute, then look in the destination bucket: `report.txt` is hidden there too, and **Show versions** reveals a replicated **delete marker**.
2. Back in the source, turn on **Show versions**, select the **delete marker** of `report.txt`, and permanently delete it. `report.txt` reappears in the source.
3. Check the destination again after a minute: `report.txt` is **still hidden** behind its delete marker.
:::

:::cli
```bash
aws s3 rm "s3://$SRC/report.txt"                     # delete marker in the source
sleep 30
aws s3 ls "s3://$DST/" --region us-west-2             # report.txt hidden in the destination too
aws s3api list-object-versions --bucket "$DST" --region us-west-2 --prefix report.txt \
  --query 'DeleteMarkers[].VersionId'

DM2=$(aws s3api list-object-versions --bucket "$SRC" --prefix report.txt \
  --query 'DeleteMarkers[?IsLatest==`true`].VersionId | [0]' --output text)
aws s3api delete-object --bucket "$SRC" --key report.txt --version-id "$DM2"   # version-specific delete
sleep 30
aws s3 ls "s3://$SRC/"                                # report.txt is back in the source
aws s3 ls "s3://$DST/" --region us-west-2             # still hidden in the destination
```
:::

> [!CHECK]
> The plain delete replicated as a delete marker because you enabled **delete marker replication**. Removing the marker in the source is a delete **with a version ID**, and those are never replicated, so the two buckets now disagree. This is the protection against malicious permanent deletes described in the lesson.

## Cleanup

Versioned buckets must be emptied of every version and delete marker before they can be deleted.

- [ ] **Replication rule `crr-to-west`**: source bucket → **Management** → **Replication rules** → select it → **Delete** (it also disappears when the bucket is deleted). CLI: `aws s3api delete-bucket-replication --bucket "$SRC"`.
- [ ] **All versions and delete markers in both buckets** (`notes.txt`, `report.txt`): **General purpose buckets** → select a bucket → **Empty** → type the confirmation text → **Empty**; repeat for the other bucket (the console's Empty removes all versions). CLI: run the function below for each bucket.

```bash
empty_versioned_bucket() {   # usage: empty_versioned_bucket <bucket> <region>
  aws s3api list-object-versions --bucket "$1" --region "$2" \
    --query '[Versions[].[Key,VersionId], DeleteMarkers[].[Key,VersionId]][]' --output text |
  while IFS=$'\t' read -r KEY VID; do
    [ -n "$KEY" ] && aws s3api delete-object --bucket "$1" --region "$2" \
      --key "$KEY" --version-id "$VID" > /dev/null
  done
}
empty_versioned_bucket "$SRC" us-east-1
empty_versioned_bucket "$DST" us-west-2
aws s3api list-object-versions --bucket "$SRC" --query '[length(Versions || `[]`), length(DeleteMarkers || `[]`)]'
```

- [ ] **Source bucket** `s3-lab-crr-src-...`: select → **Delete** → enter the bucket name → **Delete bucket**. CLI: `aws s3api delete-bucket --bucket "$SRC" --region us-east-1`.
- [ ] **Destination bucket** `s3-lab-crr-dst-...`: same steps. CLI: `aws s3api delete-bucket --bucket "$DST" --region us-west-2`.
- [ ] **IAM role for replication**: console path: **IAM** → **Roles** → search for the role name you noted in step 5 → before deleting, note any customer managed policy on its **Permissions** tab → **Delete** → confirm; then delete that customer managed policy under **IAM** → **Policies** if one was created for the role. CLI path: `aws iam delete-role-policy --role-name s3-lab-crr-role --policy-name s3-lab-crr-policy` then `aws iam delete-role --role-name s3-lab-crr-role`.
- [ ] **Local files**: delete the `s3-lab-crr` folder (`cd .. && rm -rf s3-lab-crr`), including `trust.json`, `perms.json` and `replication.json`.
- [ ] **Final check**: `aws s3 ls | grep s3-lab-crr` returns nothing, the role no longer appears in **IAM** → **Roles**, and the next day **Billing and Cost Management** → **Bills** shows no ongoing S3 charges for these buckets.

## Progress checklist

- [ ] Step 1: Versioned source bucket created in us-east-1
- [ ] Step 2: Versioned destination bucket created in us-west-2
- [ ] Step 3: Overwrote a file and read the older version
- [ ] Step 4: Deleted a file and undeleted it by removing the delete marker
- [ ] Step 5: CRR rule created with delete marker replication and Standard-IA replicas
- [ ] Step 6: New object replicated; pre-existing object did not
- [ ] Step 7: Delete marker replicated; version-specific delete did not
- [ ] Cleanup done
