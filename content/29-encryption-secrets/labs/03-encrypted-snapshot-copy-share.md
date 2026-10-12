---
id: 29-encryption-secrets-lab-03
title: Copy an encrypted EBS snapshot to another Region and prepare it for sharing
objective: Encrypt an EBS volume with your own KMS key, snapshot it, copy the snapshot to a second Region where it must be re-encrypted with a local key, and (optionally) share it with another account through the key policy.
estimatedTime: 35 minutes
cost: "About USD 0.01 if you clean up within an hour: a 1 GiB gp3 volume (USD 0.08 per GB-month, billed per second), snapshots of an empty volume that store almost no data, a customer managed KMS key at USD 1 per month prorated hourly until it is pending deletion, and negligible cross-Region transfer."
freeTier: partial
services: [ebs, ebs-snapshots, kms, cloudshell]
---

> [!COST]
> In us-east-1 a gp3 volume costs USD 0.08 per GB-month, billed per second, so the 1 GiB volume costs a fraction of a cent per hour. Snapshots bill USD 0.05 per GB-month for the data they actually hold, which is close to zero for a volume nothing has written to. A cross-Region copy is a full copy and pays EC2 data transfer for the bytes moved, again close to zero here. The customer managed KMS key costs USD 1 per month, prorated hourly, until you schedule it for deletion. Prices vary by Region; Free Tier credits on new accounts cover this lab.

This lab walks through the two diagrams that the exam loves: a snapshot that cannot simply "move" to another Region because KMS keys are Regional, and a snapshot that can only be shared once a customer managed key protects it. You do not need an EC2 instance: an empty volume is enough to see how encryption follows each copy.

## Prerequisites

- An AWS account and an IAM role or user with administrator access, or at least `AmazonEC2FullAccess` plus permission to create, use and schedule deletion of KMS keys.
- Source Region **US East (N. Virginia) `us-east-1`** and destination Region **US West (Oregon) `us-west-2`**. Any two Regions enabled in your account work if you change the commands to match.
- **AWS CloudShell** opened in us-east-1. Keep the same tab open, because later commands reuse shell variables.
- Optional for step 4: the 12-digit ID of a second AWS account you own (for example another account in your organization).

## Steps

### Step 1: Create a customer managed key for EBS

:::console
1. Open the **Key Management Service (KMS)** console in **us-east-1**, choose **Customer managed keys**, then **Create key**.
2. Choose **Symmetric** and **Encrypt and decrypt**, then **Next**.
3. Enter the alias `lab-ebs`, then **Next**.
4. Select your own role or user as key administrator, then **Next**. Select it again as key user, then **Next**.
5. Choose **Next** on the policy review and **Finish**.
6. In CloudShell, store the key ID and ARN for later steps: `KEY_ID=$(aws kms describe-key --key-id alias/lab-ebs --query KeyMetadata.KeyId --output text); KEY_ARN=$(aws kms describe-key --key-id alias/lab-ebs --query KeyMetadata.Arn --output text); echo "$KEY_ARN"`
:::

:::cli
```bash
KEY_ID=$(aws kms create-key --description "Lab key for EBS snapshot copy" \
  --query KeyMetadata.KeyId --output text)
aws kms create-alias --alias-name alias/lab-ebs --target-key-id "$KEY_ID"
KEY_ARN=$(aws kms describe-key --key-id "$KEY_ID" --query KeyMetadata.Arn --output text)
echo "$KEY_ARN"
```
:::

> [!CHECK]
> The key `lab-ebs` is **Enabled** in us-east-1. Its ARN contains `us-east-1`: that key can only be used in this Region.

### Step 2: Create a small volume encrypted with your key

:::console
1. Open the **EC2** console in us-east-1 and choose **Volumes** (under **Elastic Block Store**), then **Create volume**.
2. For **Volume type** keep **General Purpose SSD (gp3)**, set **Size** to `1` GiB, and keep the default **IOPS** and **Throughput**.
3. Pick any **Availability Zone** and keep **Snapshot ID** at **Don't create volume from a snapshot**.
4. Under **Encryption**, select **Encrypt this volume**, and for **KMS key** choose `lab-ebs`. (If your account has EBS encryption by default turned on, encryption is already forced; just pick the key.)
5. Under **Tags**, add `Name` = `lab-enc-vol`, then choose **Create volume**.
:::

:::cli
```bash
AZ=$(aws ec2 describe-availability-zones --query 'AvailabilityZones[0].ZoneName' --output text)
VOL_ID=$(aws ec2 create-volume --volume-type gp3 --size 1 --availability-zone "$AZ" \
  --encrypted --kms-key-id "$KEY_ARN" \
  --tag-specifications 'ResourceType=volume,Tags=[{Key=Name,Value=lab-enc-vol}]' \
  --query VolumeId --output text)
aws ec2 wait volume-available --volume-ids "$VOL_ID"
aws ec2 describe-volumes --volume-ids "$VOL_ID" \
  --query 'Volumes[0].[VolumeId,State,Encrypted,KmsKeyId]' --output table
```
:::

> [!CHECK]
> The volume is `available`, **Encryption** shows `Encrypted`, and the **KMS key ARN** matches the `lab-ebs` key. Behind the scenes EBS asked KMS for a data key protected by `lab-ebs`. A few minutes later you can find that request in CloudTrail **Event history** under event source `kms.amazonaws.com`, made by EBS on your behalf.

### Step 3: Snapshot the volume

:::console
1. Choose **Snapshots** → **Create snapshot**.
2. For **Resource type** choose **Volume**, and for **Volume ID** choose `lab-enc-vol`. Note that the **Encryption** field is fixed: it follows the volume.
3. For **Description** enter `lab encrypted snapshot` and choose **Create snapshot**.
4. Wait until the snapshot's status is **Completed** (about a minute for an empty volume).
:::

:::cli
```bash
SNAP_ID=$(aws ec2 create-snapshot --volume-id "$VOL_ID" \
  --description "lab encrypted snapshot" --query SnapshotId --output text)
aws ec2 wait snapshot-completed --snapshot-ids "$SNAP_ID"
aws ec2 describe-snapshots --snapshot-ids "$SNAP_ID" \
  --query 'Snapshots[0].[SnapshotId,State,Encrypted,KmsKeyId]' --output table
```
:::

> [!CHECK]
> The snapshot is `completed`, `Encrypted` is `true`, and its KMS key is the same `lab-ebs` key as the volume. A snapshot always inherits the encryption of its volume; to change the key you must copy it.

### Step 4 (optional): Prepare the snapshot for another account

Skip this step if you do not have a second account. Two things are needed: the key policy must trust the other account, and the snapshot must be shared with it. Public sharing is never possible for an encrypted snapshot.

:::console
1. In the **KMS** console open `lab-ebs`. On the **Key policy** tab (default view), scroll to **Other AWS accounts**, choose **Add other AWS accounts**, enter the second account's ID and choose **Save changes**.
2. In the **EC2** console choose **Snapshots**, select `lab encrypted snapshot`, then **Actions** → **Modify permissions**.
3. Choose **Private**, then under **Sharing accounts** choose **Add account**, enter the same account ID and choose **Save changes**.
4. In the second account (same Region), open **Snapshots**, filter on **Private snapshots**, select the shared snapshot and choose **Actions** → **Copy snapshot**, picking a KMS key that the second account owns. Then that account no longer depends on your key.
:::

:::cli
```bash
OTHER_ACCOUNT=111122223333        # replace with your second account ID

# 1. Add two statements to the key policy (key policies need the key ID or ARN, not the alias).
aws kms get-key-policy --key-id "$KEY_ID" --policy-name default --output text > policy.json
jq --arg acct "arn:aws:iam::${OTHER_ACCOUNT}:root" '.Statement += [
  {"Sid":"AllowOtherAccountUseOfKey","Effect":"Allow","Principal":{"AWS":$acct},
   "Action":["kms:Decrypt","kms:DescribeKey","kms:ReEncrypt*","kms:GenerateDataKey*"],"Resource":"*"},
  {"Sid":"AllowOtherAccountGrantsForAwsResources","Effect":"Allow","Principal":{"AWS":$acct},
   "Action":["kms:CreateGrant","kms:ListGrants","kms:RevokeGrant"],"Resource":"*",
   "Condition":{"Bool":{"kms:GrantIsForAWSResource":"true"}}}]' policy.json > policy-new.json
aws kms put-key-policy --key-id "$KEY_ID" --policy-name default --policy file://policy-new.json

# 2. Share the snapshot privately.
aws ec2 modify-snapshot-attribute --snapshot-id "$SNAP_ID" \
  --attribute createVolumePermission --operation-type add --user-ids "$OTHER_ACCOUNT"
aws ec2 describe-snapshot-attribute --snapshot-id "$SNAP_ID" --attribute createVolumePermission

# 3. In the SECOND account (its own credentials, same Region), copy it under its own key:
# aws ec2 copy-snapshot --source-region us-east-1 --source-snapshot-id <snap-id> \
#   --encrypted --kms-key-id alias/<their-key> --description "my own copy"
```
:::

> [!CHECK]
> `describe-snapshot-attribute` lists the second account under `CreateVolumePermissions`. In the second account the snapshot shows up under **Private snapshots**, and its copy is encrypted with that account's own key. Had the snapshot used `aws/ebs`, the share would be refused: AWS managed keys cannot be shared.

### Step 5: Copy the snapshot to another Region

:::console
1. In the **EC2** console (us-east-1) choose **Snapshots**, select `lab encrypted snapshot`, then **Actions** → **Copy snapshot**.
2. Keep the suggested **Description** or enter `DR copy of lab snapshot`.
3. For the destination choose **AWS Region** and select **US West (Oregon) us-west-2**. Leave **Enable time-based copy** cleared.
4. Encryption is forced because the source is encrypted. For **KMS key**, keep the default **aws/ebs** of the destination Region. Notice that `lab-ebs` is not offered: it lives in us-east-1.
5. Choose **Copy snapshot**, switch the console to **us-west-2**, and watch the copy under **Snapshots** until it is **Completed**.
:::

:::cli
```bash
COPY_ID=$(aws ec2 copy-snapshot --region us-west-2 --source-region us-east-1 \
  --source-snapshot-id "$SNAP_ID" --description "DR copy of lab snapshot" \
  --encrypted --kms-key-id alias/aws/ebs \
  --query SnapshotId --output text)
aws ec2 wait snapshot-completed --region us-west-2 --snapshot-ids "$COPY_ID"
aws ec2 describe-snapshots --region us-west-2 --snapshot-ids "$COPY_ID" \
  --query 'Snapshots[0].[SnapshotId,State,Encrypted,KmsKeyId]' --output table
aws kms describe-key --region us-west-2 --key-id alias/aws/ebs \
  --query 'KeyMetadata.[Arn,KeyManager]' --output text
```
:::

> [!CHECK]
> The copy in us-west-2 has a new snapshot ID, is `Encrypted`, and its KMS key ARN contains `us-west-2` and belongs to the AWS managed `aws/ebs` key there (`KeyManager` is `AWS`). EBS decrypted the data with `lab-ebs` in us-east-1 and re-encrypted it with a us-west-2 key during the copy. If you wanted to share the copy with another account from us-west-2, you would copy it again with a customer managed key that exists in us-west-2, because `aws/ebs` cannot be shared.

> [!NOTE]
> Copying across Regions, or under a different key, always produces a full (non-incremental) copy. For real disaster recovery, let Amazon Data Lifecycle Manager or AWS Backup schedule these cross-Region copies, and choose a customer managed key in the destination Region if you need control over who can use the copies.

## Cleanup

Delete the snapshots and volume before the key, so nothing is left that depends on it.

- [ ] **Snapshot copy in us-west-2**: switch the EC2 console to us-west-2, choose **Snapshots**, select the copy and choose **Actions** → **Delete snapshot** → **Delete**. CLI: `aws ec2 delete-snapshot --region us-west-2 --snapshot-id "$COPY_ID"`.
- [ ] **Sharing and the second account's copy** (only if you did step 4): in the second account delete its copy the same way. In your account, remove the share with **Modify permissions** (remove the account, **Save changes**) or `aws ec2 modify-snapshot-attribute --snapshot-id "$SNAP_ID" --attribute createVolumePermission --operation-type remove --user-ids "$OTHER_ACCOUNT"`.
- [ ] **Snapshot `lab encrypted snapshot` in us-east-1**: **Snapshots** → select → **Actions** → **Delete snapshot** → **Delete**. CLI: `aws ec2 delete-snapshot --snapshot-id "$SNAP_ID"`.
- [ ] **Volume `lab-enc-vol`**: **Volumes** → select → **Actions** → **Delete volume** → **Delete**. CLI: `aws ec2 delete-volume --volume-id "$VOL_ID"`.
- [ ] **Alias `alias/lab-ebs`**: KMS console → key → **Aliases** tab → select → **Delete**. CLI: `aws kms delete-alias --alias-name alias/lab-ebs`.
- [ ] **KMS key**: **Customer managed keys** → select → **Key actions** → **Schedule key deletion**, **Waiting period (in days)** `7`, confirm and choose **Schedule deletion**. CLI: `aws kms schedule-key-deletion --key-id "$KEY_ID" --pending-window-in-days 7`.
- [ ] **Local files** (step 4 CLI only): `rm -f policy.json policy-new.json`.
- [ ] **Final check**: in both us-east-1 and us-west-2, **Volumes** shows no `lab-enc-vol` and **Snapshots** (owned by me) shows no lab snapshots; the `lab-ebs` key is **Pending deletion**. The AWS managed `aws/ebs` key in us-west-2 remains; it is free and cannot be deleted.

## Progress checklist

- [ ] Step 1: Created the customer managed key `alias/lab-ebs` in us-east-1
- [ ] Step 2: Created a 1 GiB gp3 volume encrypted with that key
- [ ] Step 3: Created a snapshot and saw it inherit the volume's key
- [ ] Step 4 (optional): Trusted a second account in the key policy and shared the snapshot privately
- [ ] Step 5: Copied the snapshot to us-west-2 and saw it re-encrypted with a key from that Region
- [ ] Cleanup done: snapshots, volume, alias and key removed or pending deletion
