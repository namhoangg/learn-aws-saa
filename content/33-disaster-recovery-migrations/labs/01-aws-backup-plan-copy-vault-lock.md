---
id: 33-disaster-recovery-migrations-lab-01
title: Protect an EBS volume with AWS Backup, restore it, copy it to a DR Region and lock the vault
objective: Build the backup-and-restore building blocks of a DR plan with AWS Backup - two vaults in two Regions, a tag-based daily plan with a cross-Region copy rule, an on-demand backup, a restore, a manual cross-Region copy - and see how Vault Lock refuses early deletion.
estimatedTime: 60 minutes
cost: "Well under USD 0.10 if you clean up the same day: two 1 GiB gp3 volumes (USD 0.08 per GB-month, prorated by the hour), snapshot storage for an almost empty volume in two Regions, and at most a cent of cross-Region data transfer. Vault Lock itself is free."
freeTier: partial
services: [aws-backup, ebs, ebs-snapshots, iam, kms]
---

> [!COST]
> AWS Backup charges for backup storage (for EBS this is the snapshot price, USD 0.05 per GB-month in us-east-1) and for cross-Region data transfer of copies. An empty 1 GiB volume produces snapshots of almost nothing, so the whole lab costs pennies. The two EBS volumes are billed per GB-month until you delete them. The risk is forgetting: a backup plan keeps creating recovery points every day until you delete it, so finish the **Cleanup** section.

> [!WARNING] Never pick compliance mode in this lab
> Step 7 uses Vault Lock in **governance** mode, which you can remove. A **compliance**-mode lock becomes permanent after its grace time (at least 3 days): nobody, not even AWS, can then delete the vault or shorten retention. If you choose it by mistake, delete the lock before the grace time ends.

The lab uses **us-east-1** as the primary Region and **us-west-2** as the DR Region. Any two Regions where AWS Backup supports cross-Region copy work; replace the names everywhere if you change them.

## Prerequisites

- An AWS account with permissions for AWS Backup, Amazon EC2 and IAM (for example the `AWSBackupFullAccess` and `AmazonEC2FullAccess` managed policies, plus permission to create a role the first time AWS Backup creates its default role).
- No EC2 instance is needed: you back up a stand-alone EBS volume.
- For the CLI tabs: AWS CLI v2 with credentials, or **AWS CloudShell** in us-east-1. Use one terminal for the whole lab because later commands reuse shell variables.

## Steps

### Step 1: Create a small tagged EBS volume

The tag `backup=daily` is what the backup plan will use to find the volume in Step 3.

:::console
1. Open the **EC2** console in **US East (N. Virginia)** and choose **Volumes** under **Elastic Block Store**, then **Create volume**.
2. Set **Volume type** to **General Purpose SSD (gp3)**, **Size (GiB)** to **1** and **Availability Zone** to **us-east-1a**. Keep the default IOPS and throughput.
3. Under **Tags**, choose **Add tag** twice: `Name` = `demo-backup-vol` and `backup` = `daily`.
4. Choose **Create volume**.
:::

:::cli
```bash
REGION=us-east-1
DR_REGION=us-west-2
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

VOL_ID=$(aws ec2 create-volume --region "$REGION" \
  --availability-zone "${REGION}a" --size 1 --volume-type gp3 \
  --tag-specifications 'ResourceType=volume,Tags=[{Key=Name,Value=demo-backup-vol},{Key=backup,Value=daily}]' \
  --query VolumeId --output text)
aws ec2 wait volume-available --region "$REGION" --volume-ids "$VOL_ID"
echo "Volume: $VOL_ID"
```
:::

> [!CHECK]
> The volume `demo-backup-vol` shows **Available** in us-east-1a and has both tags. It is not attached to anything, which is fine for this lab.

### Step 2: Create a backup vault in each Region

A vault is the container for recovery points. Keeping a second vault in another Region is what turns local backups into a DR copy.

:::console
1. Open the **AWS Backup** console in **US East (N. Virginia)** and choose **Backup vaults** in the navigation pane. (The console may also create a vault named **Default** the first time; leave it alone.)
2. Choose **Create backup vault**, enter `demo-vault` as the name, keep the default AWS Backup KMS key (`aws/backup`), and choose **Create backup vault**.
3. Switch the console Region to **US West (Oregon)**, choose **Backup vaults** → **Create backup vault**, name it `demo-dr-vault`, keep the default key and create it.
4. Switch back to **US East (N. Virginia)**.
:::

:::cli
```bash
aws backup create-backup-vault --region "$REGION" --backup-vault-name demo-vault
aws backup create-backup-vault --region "$DR_REGION" --backup-vault-name demo-dr-vault
DR_VAULT_ARN=$(aws backup describe-backup-vault --region "$DR_REGION" \
  --backup-vault-name demo-dr-vault --query BackupVaultArn --output text)
echo "$DR_VAULT_ARN"
```
:::

> [!CHECK]
> **Backup vaults** lists `demo-vault` in us-east-1 and `demo-dr-vault` in us-west-2, each with 0 recovery points.

### Step 3: Create a daily backup plan that finds resources by tag and copies to the DR Region

:::console
1. In us-east-1, choose **Backup plans** → **Create backup plan** → **Build a new plan**. Enter `demo-daily-plan` as **Backup plan name**.
2. Under **Backup rule configuration**, enter `daily-5d` as **Backup rule name** and choose `demo-vault` as **Backup vault**.
3. Set **Backup frequency** to **Daily** and keep the default **Backup window** (start within 8 hours, complete within 7 days). Note the other choices offered: hourly, every 12 hours, weekly, monthly and a custom cron expression.
4. Under **Lifecycle**, leave cold storage off and set **Total retention period** to **5** days.
5. Under **Copy to destination**, choose **US West (Oregon)** and the destination vault `demo-dr-vault`. Leave the copy's lifecycle empty so the copy keeps the same 5-day retention.
6. Choose **Create plan**. On the plan page, choose **Assign resources**.
7. Enter `tagged-ebs` as **Resource assignment name** and keep **Default role** for the IAM role.
8. Under **Define resource selection**, choose **Include specific resource types** and select **EBS** in **Select resource types** (keep all volumes selected).
9. Under **Refine selection using tags**, set **Key** `backup`, **Condition for value** **Equals**, **Value** `daily`. Choose **Assign resources**.
:::

:::cli
```bash
# The console creates AWSBackupDefaultServiceRole for you; from the CLI, create your own role.
aws iam create-role --role-name demo-backup-role \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"backup.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
aws iam attach-role-policy --role-name demo-backup-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup
aws iam attach-role-policy --role-name demo-backup-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores
ROLE_ARN=$(aws iam get-role --role-name demo-backup-role --query Role.Arn --output text)
sleep 15   # give the new role a moment to propagate

cat > plan.json <<EOF
{
  "BackupPlanName": "demo-daily-plan",
  "Rules": [{
    "RuleName": "daily-5d",
    "TargetBackupVaultName": "demo-vault",
    "ScheduleExpression": "cron(0 5 ? * * *)",
    "StartWindowMinutes": 480,
    "CompletionWindowMinutes": 10080,
    "Lifecycle": { "DeleteAfterDays": 5 },
    "CopyActions": [{
      "DestinationBackupVaultArn": "$DR_VAULT_ARN",
      "Lifecycle": { "DeleteAfterDays": 5 }
    }]
  }]
}
EOF
PLAN_ID=$(aws backup create-backup-plan --region "$REGION" \
  --backup-plan file://plan.json --query BackupPlanId --output text)

cat > selection.json <<EOF
{
  "SelectionName": "tagged-ebs",
  "IamRoleArn": "$ROLE_ARN",
  "Resources": ["arn:aws:ec2:*:*:volume/*"],
  "Conditions": {
    "StringEquals": [ { "ConditionKey": "aws:ResourceTag/backup", "ConditionValue": "daily" } ]
  }
}
EOF
SEL_ID=$(aws backup create-backup-selection --region "$REGION" --backup-plan-id "$PLAN_ID" \
  --backup-selection file://selection.json --query SelectionId --output text)
echo "Plan: $PLAN_ID  Selection: $SEL_ID"
```
:::

> [!CHECK]
> The plan `demo-daily-plan` shows one rule (`daily-5d`, daily, 5 days, copy to us-west-2) and one resource assignment (`tagged-ebs`). **Protected resources** is still empty: a scheduled plan only creates its first job in the next backup window. Any volume you tag `backup=daily` later is picked up automatically, with no change to the plan.

### Step 4: Take an on-demand backup

You do not want to wait for tonight's window, so start a one-off backup now, as you would before a risky change.

:::console
1. Choose **Protected resources** → **Create on-demand backup**.
2. Set **Resource type** to **EBS** and choose the volume ID of `demo-backup-vol`.
3. Keep **Create backup now**, set **Total retention period** to **5** days, choose `demo-vault` as **Backup vault** and keep **Default role**.
4. Choose **Create on-demand backup**. The **Jobs** page opens on **Backup jobs**.
5. Refresh until the job status is **Completed** (usually a few minutes for an empty volume).
:::

:::cli
```bash
JOB_ID=$(aws backup start-backup-job --region "$REGION" \
  --backup-vault-name demo-vault \
  --resource-arn "arn:aws:ec2:${REGION}:${ACCOUNT_ID}:volume/${VOL_ID}" \
  --iam-role-arn "$ROLE_ARN" \
  --lifecycle DeleteAfterDays=5 \
  --query BackupJobId --output text)

# Run this until State is COMPLETED
aws backup describe-backup-job --region "$REGION" --backup-job-id "$JOB_ID" \
  --query '{State:State,RecoveryPoint:RecoveryPointArn}'

RP_ARN=$(aws backup describe-backup-job --region "$REGION" --backup-job-id "$JOB_ID" \
  --query RecoveryPointArn --output text)
echo "$RP_ARN"
```
:::

> [!CHECK]
> The backup job is **Completed**, `demo-vault` now holds 1 recovery point, and **Protected resources** lists the volume. For EBS the recovery point ARN is a snapshot ARN (`arn:aws:ec2:us-east-1::snapshot/snap-...`); you can also see that snapshot under **EC2** → **Snapshots**.

### Step 5: Restore the backup to a new volume in another Availability Zone

A backup you have never restored is only a hope. Restoring into a different AZ also shows how snapshots let you move data around a Region.

:::console
1. Choose **Protected resources** and then the volume ID of `demo-backup-vol`.
2. In the **Backups** pane, select the recovery point and choose **Restore**.
3. For **Resource type** keep **EBS volume**. Set **Volume type** to **gp3**, **Size (GiB)** to **1** and **Availability zone** to **us-east-1b**.
4. Keep **Default role** as **Restore role** and choose **Restore backup**.
5. Open **Jobs** → **Restore jobs** and wait for **Completed**. Open the job to see the ID of the new volume.
:::

:::cli
```bash
RESTORE_ID=$(aws backup start-restore-job --region "$REGION" \
  --recovery-point-arn "$RP_ARN" --iam-role-arn "$ROLE_ARN" --resource-type EBS \
  --metadata '{"availabilityZone":"us-east-1b","volumeType":"gp3","volumeSize":"1"}' \
  --query RestoreJobId --output text)

# Run until Status is COMPLETED
aws backup describe-restore-job --region "$REGION" --restore-job-id "$RESTORE_ID" \
  --query '{Status:Status,Created:CreatedResourceArn}'

RESTORED_ARN=$(aws backup describe-restore-job --region "$REGION" \
  --restore-job-id "$RESTORE_ID" --query CreatedResourceArn --output text)
RESTORED_VOL=${RESTORED_ARN##*/}
echo "Restored volume: $RESTORED_VOL"
```
:::

> [!CHECK]
> **EC2** → **Volumes** shows a second 1 GiB gp3 volume in **us-east-1b**. The original volume in us-east-1a is untouched: a restore always creates a new resource.

### Step 6: Copy the recovery point to the DR Region

The plan from Step 3 will copy future scheduled backups automatically. Here you copy today's on-demand backup by hand.

:::console
1. Choose **Backup vaults** → `demo-vault`.
2. In the **Backups** section, select the recovery point, then choose **Actions** → **Copy**.
3. Set **Copy to destination** to **US West (Oregon)** and **Destination Backup vault** to `demo-dr-vault`. Leave cold storage off, set the **Retention period** to **5** days and keep the **Default** IAM role.
4. Choose **Copy**, then watch **Jobs** → **Copy jobs** until the job is **Completed**.
5. Switch to **US West (Oregon)** and open **Backup vaults** → `demo-dr-vault`. Switch back to us-east-1 when done.
:::

:::cli
```bash
COPY_ID=$(aws backup start-copy-job --region "$REGION" \
  --recovery-point-arn "$RP_ARN" --source-backup-vault-name demo-vault \
  --destination-backup-vault-arn "$DR_VAULT_ARN" \
  --iam-role-arn "$ROLE_ARN" --lifecycle DeleteAfterDays=5 \
  --query CopyJobId --output text)

# Run until State is COMPLETED
aws backup describe-copy-job --region "$REGION" --copy-job-id "$COPY_ID" \
  --query 'CopyJob.{State:State,Destination:DestinationRecoveryPointArn}'

aws backup list-recovery-points-by-backup-vault --region "$DR_REGION" \
  --backup-vault-name demo-dr-vault --query 'RecoveryPoints[].RecoveryPointArn'
```
:::

> [!CHECK]
> `demo-dr-vault` in us-west-2 holds one recovery point whose ARN starts with `arn:aws:ec2:us-west-2::snapshot/`. If us-east-1 became unavailable, you could restore this copy in us-west-2: that is the core of the backup-and-restore DR strategy.

### Step 7: Lock the primary vault and watch an early delete fail

:::console
1. In us-east-1, open **Backup vaults** and choose **Vault locks** (listed under Backup vaults in the navigation pane), then **Create vault lock**.
2. Under **Vault lock details**, choose `demo-vault`.
3. For **Vault lock mode**, choose **Governance mode**.
4. Under **Retention period**, set the minimum to **1** day and the maximum to **7** days. (New backup and copy jobs into this vault must now use a retention inside that range.)
5. Choose **Create vault lock** and complete the confirmation the console asks for.
6. Go to **Backup vaults** → `demo-vault`, select the recovery point and choose **Actions** → **Delete**, then confirm. Read the error message.
7. Return to **Vault locks**, select the lock for `demo-vault`, choose **Manage vault lock** → **Delete vault lock** and confirm. Governance mode lets a user with the right IAM permissions do this.
:::

:::cli
```bash
# Governance mode: do NOT pass --changeable-for-days (that would create a compliance-mode lock)
aws backup put-backup-vault-lock-configuration --region "$REGION" \
  --backup-vault-name demo-vault --min-retention-days 1 --max-retention-days 7

aws backup describe-backup-vault --region "$REGION" --backup-vault-name demo-vault \
  --query '{Locked:Locked,Min:MinRetentionDays,Max:MaxRetentionDays,LockDate:LockDate}'

# Expected to FAIL while the vault is locked
aws backup delete-recovery-point --region "$REGION" \
  --backup-vault-name demo-vault --recovery-point-arn "$RP_ARN"

# Remove the governance-mode lock
aws backup delete-backup-vault-lock-configuration --region "$REGION" \
  --backup-vault-name demo-vault
```
:::

> [!CHECK]
> While the lock is active, the vault shows **Locked: true** with min 1 / max 7 days and no lock date (governance mode has no grace time), and the delete is refused. After you delete the lock, `Locked` is false again. In **compliance** mode the delete would also be refused, but you could not remove the lock once its grace time had passed.

## Cleanup

Delete in this order. Recovery point deletion is asynchronous, so wait until a vault shows 0 recovery points before deleting it. If a scheduled backup ran in the meantime, there may be more than one recovery point per vault; delete them all.

- [ ] Make sure the vault lock on `demo-vault` is gone (**Vault locks** list is empty for it).
- [ ] Delete the resource assignment, then the plan: **Backup plans** → `demo-daily-plan` → select `tagged-ebs` under **Resource assignments** → **Delete**; then **Delete** the plan itself.
- [ ] Delete every recovery point in `demo-vault` (us-east-1): **Backup vaults** → `demo-vault` → select all → **Actions** → **Delete**.
- [ ] Delete every recovery point in `demo-dr-vault` (us-west-2) the same way.
- [ ] Delete the vaults: open each vault and choose **Delete vault**, then type its name to confirm.
- [ ] Delete the restored volume (us-east-1b) and `demo-backup-vol` (us-east-1a): **EC2** → **Volumes** → select → **Actions** → **Delete volume**.
- [ ] CLI path only: detach both policies from `demo-backup-role` and delete the role.
- [ ] Optional: the console-created role `AWSBackupDefaultServiceRole` and the **Default** vault cost nothing; keep them for later labs or delete the role in IAM.

:::cli
```bash
aws backup delete-backup-selection --region "$REGION" --backup-plan-id "$PLAN_ID" --selection-id "$SEL_ID"
aws backup delete-backup-plan --region "$REGION" --backup-plan-id "$PLAN_ID"

for RP in $(aws backup list-recovery-points-by-backup-vault --region "$REGION" \
    --backup-vault-name demo-vault --query 'RecoveryPoints[].RecoveryPointArn' --output text); do
  aws backup delete-recovery-point --region "$REGION" --backup-vault-name demo-vault --recovery-point-arn "$RP"
done
for RP in $(aws backup list-recovery-points-by-backup-vault --region "$DR_REGION" \
    --backup-vault-name demo-dr-vault --query 'RecoveryPoints[].RecoveryPointArn' --output text); do
  aws backup delete-recovery-point --region "$DR_REGION" --backup-vault-name demo-dr-vault --recovery-point-arn "$RP"
done

# Re-run the two list commands until both return nothing, then:
aws backup delete-backup-vault --region "$REGION" --backup-vault-name demo-vault
aws backup delete-backup-vault --region "$DR_REGION" --backup-vault-name demo-dr-vault

aws ec2 delete-volume --region "$REGION" --volume-id "$RESTORED_VOL"
aws ec2 delete-volume --region "$REGION" --volume-id "$VOL_ID"

aws iam detach-role-policy --role-name demo-backup-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup
aws iam detach-role-policy --role-name demo-backup-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores
aws iam delete-role --role-name demo-backup-role
```
:::

> [!CHECK]
> Final check: **AWS Backup** → **Backup plans** has no `demo-daily-plan`; **Backup vaults** in both Regions no longer list `demo-vault` or `demo-dr-vault`; **EC2** → **Volumes** and **Snapshots** in us-east-1 and us-west-2 show nothing from this lab. Check **Billing and Cost Management** → **Bills** the next day.

## Progress checklist

- [ ] Step 1: Tagged 1 GiB gp3 volume created
- [ ] Step 2: Vaults created in us-east-1 and us-west-2
- [ ] Step 3: Daily plan with a cross-Region copy rule and a tag-based assignment created
- [ ] Step 4: On-demand backup completed
- [ ] Step 5: Backup restored to a new volume in another AZ
- [ ] Step 6: Recovery point copied to the DR Region
- [ ] Step 7: Governance-mode Vault Lock blocked an early delete, then removed
- [ ] Cleanup done
