---
id: 21-dynamodb-apigw-cognito-lab-01
title: Explore DynamoDB keys, queries, TTL, Streams and backups
objective: Create an on-demand DynamoDB table, write schemaless items, compare Query with Scan, expire items with TTL, read change records from DynamoDB Streams, then protect the table with point-in-time recovery and an on-demand backup and restore it into a new table.
estimatedTime: 50 minutes
cost: "Under USD 0.01 if you clean up the same day: a few hundred on-demand requests plus PITR, one on-demand backup and one restore of a table of a few KB. New accounts are covered by Free Tier credits."
freeTier: partial
services: [dynamodb, dynamodb-streams, cloudshell]
---

You will build a small `demo-workouts` table for a fitness app: each athlete (partition key) logs workouts identified by date (sort key). Along the way you will see the features from the lesson working on real data: flexible attributes, cheap Query versus expensive Scan, TTL, change streams, PITR and backups.

> [!COST]
> On-demand reads and writes are not part of the Always Free DynamoDB allowance (that covers 25 provisioned RCU and WCU and 25 GB of storage), but this lab makes only a few hundred requests: well under one cent at USD 0.625 per million writes and USD 0.125 per million reads (us-east-1). PITR (USD 0.20 per GB-month), the on-demand backup (USD 0.10 per GB-month) and the restore (USD 0.15 per GB) are charged on a table of a few kilobytes. On-demand backups keep being billed until you delete them, even after the table is gone, so do not skip the cleanup.

## Prerequisites

- An AWS account and an IAM identity allowed to manage DynamoDB (for example the `AmazonDynamoDBFullAccess` managed policy).
- One Region for the whole lab; the commands use the Region of your shell.
- For the CLI tabs: **AWS CloudShell** (recommended: AWS CLI v2 is preinstalled) or a Bash shell with AWS CLI v2 configured. Keep one terminal open, because later commands reuse shell variables. Step 5 needs the CLI even if you use the console for everything else.

## Steps

### Step 1: Create the table

The primary key is fixed at creation: `AthleteId` (partition key) groups all workouts of one athlete, and `WorkoutDate` (sort key) keeps them in date order.

:::console
1. Open the **DynamoDB** console and choose **Tables** in the left navigation pane, then **Create table**.
2. For **Table name**, enter `demo-workouts`.
3. For **Partition key**, enter `AthleteId` and leave the type as **String**.
4. For **Sort key**, enter `WorkoutDate` and leave the type as **String**.
5. For **Table settings**, choose **Customize settings**.
6. Keep **Table class** as **DynamoDB Standard**. Under **Read/write capacity settings**, choose **On-demand**.
7. Leave everything else at its default, choose **Create table**, and wait until the status is **Active**.
:::

:::cli
```bash
aws dynamodb create-table \
  --table-name demo-workouts \
  --attribute-definitions AttributeName=AthleteId,AttributeType=S AttributeName=WorkoutDate,AttributeType=S \
  --key-schema AttributeName=AthleteId,KeyType=HASH AttributeName=WorkoutDate,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST

aws dynamodb wait table-exists --table-name demo-workouts
aws dynamodb describe-table --table-name demo-workouts \
  --query 'Table.{Status:TableStatus,Mode:BillingModeSummary.BillingMode,Keys:KeySchema}'
```
:::

> [!CHECK]
> The table is **Active** with partition key `AthleteId` and sort key `WorkoutDate`. The CLI shows `"Mode": "PAY_PER_REQUEST"`, and the **Read/write capacity** section of the table's **Additional settings** tab shows the on-demand capacity mode.

> [!VERIFY] Which capacity mode the console's Default settings use
> AWS's own pages disagree (checked 2026-10-04). The [throughput capacity](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/capacity-mode.html) and [on-demand](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/on-demand-capacity-mode.html) pages call on-demand the default and recommended mode, but the [console auto scaling page](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/AutoScaling.Console.html) still says a table created with **Default settings** gets auto scaling, which exists only in provisioned mode. The [getting-started guide](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/getting-started-step-1.html) keeps **Default settings** without naming a mode, and the February 2025 [document history](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DocumentHistory.html) entry that switches default settings to on-demand is about NoSQL Workbench, not the console. So which mode the console picks today is still unconfirmed. Choosing **Customize settings** → **On-demand** as above sidesteps the question and keeps the lab billed per request. If you ever keep **Default settings**, open the table's **Additional settings** tab afterwards to see which mode you got.

### Step 2: Write items with different attributes

Only the key attributes are mandatory. The four workouts below each carry different extra attributes, including a string set and a map.

| AthleteId | WorkoutDate | Other attributes |
|---|---|---|
| ana | 2026-09-28 | Activity = run, DurationMin = 42, Calories = 410, Tags = string set {outdoor, tempo} |
| ana | 2026-09-30 | Activity = swim, DurationMin = 35, Pool = map {LengthM: 25, Laps: 56} |
| ben | 2026-09-29 | Activity = cycle, DurationMin = 90, Calories = 880 |
| ben | 2026-10-01 | Activity = yoga, DurationMin = 30, Notes = "recovery day" |

:::console
1. Choose the `demo-workouts` table, then **Explore table items**.
2. In the **Items returned** section, choose **Create item**.
3. Enter `ana` for **AthleteId** and `2026-09-28` for **WorkoutDate**.
4. Choose **Add new attribute** and pick the type for each extra attribute in the first row of the table above (String for `Activity`, Number for `DurationMin` and `Calories`, String set for `Tags`), then fill in the values.
5. Choose **Create item**.
6. Repeat for the other three rows. For `Pool`, choose the **Map** type and add `LengthM` and `Laps` as Number entries inside it.
:::

:::cli
```bash
cat > workouts.json <<'EOF'
{
  "demo-workouts": [
    {"PutRequest": {"Item": {"AthleteId": {"S": "ana"}, "WorkoutDate": {"S": "2026-09-28"},
      "Activity": {"S": "run"}, "DurationMin": {"N": "42"}, "Calories": {"N": "410"},
      "Tags": {"SS": ["outdoor", "tempo"]}}}},
    {"PutRequest": {"Item": {"AthleteId": {"S": "ana"}, "WorkoutDate": {"S": "2026-09-30"},
      "Activity": {"S": "swim"}, "DurationMin": {"N": "35"},
      "Pool": {"M": {"LengthM": {"N": "25"}, "Laps": {"N": "56"}}}}}},
    {"PutRequest": {"Item": {"AthleteId": {"S": "ben"}, "WorkoutDate": {"S": "2026-09-29"},
      "Activity": {"S": "cycle"}, "DurationMin": {"N": "90"}, "Calories": {"N": "880"}}}},
    {"PutRequest": {"Item": {"AthleteId": {"S": "ben"}, "WorkoutDate": {"S": "2026-10-01"},
      "Activity": {"S": "yoga"}, "DurationMin": {"N": "30"}, "Notes": {"S": "recovery day"}}}}
  ]
}
EOF

aws dynamodb batch-write-item --request-items file://workouts.json
```
:::

> [!CHECK]
> **Explore table items** lists four items. The `Tags`, `Pool` and `Notes` columns are filled for only one item each: DynamoDB stored every item with its own set of attributes and no schema change. The CLI returns `"UnprocessedItems": {}`.

### Step 3: Compare Query with Scan

A Query reads only one partition; a Scan reads every item and filters afterwards. Watch the scanned count and the consumed capacity.

:::console
1. In **Explore table items**, under **Scan or query items**, choose **Query**.
2. Enter `ana` as the **AthleteId** partition key value and choose **Run**. Note the items returned.
3. Switch to **Scan**, add a filter on attribute `Activity` (String) **Equal to** `cycle`, and choose **Run**.
:::

:::cli
```bash
# Query: one partition, optional sort key condition
aws dynamodb query --table-name demo-workouts \
  --key-condition-expression "AthleteId = :a AND begins_with(WorkoutDate, :m)" \
  --expression-attribute-values '{":a": {"S": "ana"}, ":m": {"S": "2026-09"}}' \
  --return-consumed-capacity TOTAL \
  --query '{Count:Count,Scanned:ScannedCount,Capacity:ConsumedCapacity.CapacityUnits}'

# Scan with a filter: reads every item, then discards non-matching ones
aws dynamodb scan --table-name demo-workouts \
  --filter-expression "Activity = :act" \
  --expression-attribute-values '{":act": {"S": "cycle"}}' \
  --return-consumed-capacity TOTAL \
  --query '{Count:Count,Scanned:ScannedCount,Capacity:ConsumedCapacity.CapacityUnits}'
```
:::

> [!CHECK]
> The Query returns 2 items and scans 2. The Scan returns only 1 item but its `ScannedCount` is 4: you pay for reading the whole table to find one match. On a table of millions of items this is why access patterns should use Query on a well-chosen key (or an index) instead of Scan.

### Step 4: Expire draft workouts with TTL

The app saves unfinished "draft" workouts that should disappear after a while. You will store an expiry time in epoch seconds and let TTL delete expired drafts for free.

:::console
1. Open the table's **Additional settings** tab. In the **Time to Live (TTL)** section, choose **Turn on**.
2. Enter `ExpiresAt` as the TTL attribute name (it is case sensitive) and confirm.
3. Go back to **Explore table items** and create an item with **AthleteId** `ana`, **WorkoutDate** `DRAFT#1`, a String attribute `Status` = `DRAFT` and a Number attribute `ExpiresAt` set to a time in the past. Get one by running `date -d '-1 hour' +%s` in CloudShell (for example `1790000000`).
:::

:::cli
```bash
aws dynamodb update-time-to-live --table-name demo-workouts \
  --time-to-live-specification "Enabled=true, AttributeName=ExpiresAt"

PAST=$(date -d '-1 hour' +%s)
aws dynamodb put-item --table-name demo-workouts --item '{
  "AthleteId": {"S": "ana"}, "WorkoutDate": {"S": "DRAFT#1"},
  "Status": {"S": "DRAFT"}, "ExpiresAt": {"N": "'"$PAST"'"}}'

aws dynamodb describe-time-to-live --table-name demo-workouts

# The expired draft is probably still there; hide it with a filter on the TTL attribute
NOW=$(date +%s)
aws dynamodb query --table-name demo-workouts \
  --key-condition-expression "AthleteId = :a" \
  --filter-expression "attribute_not_exists(ExpiresAt) OR ExpiresAt > :now" \
  --expression-attribute-values '{":a": {"S": "ana"}, ":now": {"N": "'"$NOW"'"}}' \
  --query 'Items[].WorkoutDate.S'
```
:::

> [!CHECK]
> `describe-time-to-live` reports `ENABLED` (or `ENABLING` for up to about an hour) on attribute `ExpiresAt`, and the console marks the attribute with a **TTL** label. The expired draft is still readable right now: TTL deletes expired items in the background, typically within a few days. The filtered query returns only the two real workout dates.

### Step 5: Capture changes with DynamoDB Streams

Turn on a stream that records the item before and after every change, make a change, then read the stream records. Reading records needs the CLI (in real applications a Lambda trigger does this).

:::console
1. Open the table's **Exports and streams** tab.
2. In the **DynamoDB stream details** section, choose **Turn on**.
3. Select **New and old images** and choose **Turn on stream**.
4. In **Explore table items**, open the item `ana` / `2026-09-28`, change `DurationMin` from 42 to `45`, and save the change.
5. Open CloudShell and run the commands in the CLI tab from `STREAM_ARN=` onward to read the records.
:::

:::cli
```bash
aws dynamodb update-table --table-name demo-workouts \
  --stream-specification StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES
aws dynamodb wait table-exists --table-name demo-workouts

aws dynamodb update-item --table-name demo-workouts \
  --key '{"AthleteId": {"S": "ana"}, "WorkoutDate": {"S": "2026-09-28"}}' \
  --update-expression "SET DurationMin = :d" \
  --expression-attribute-values '{":d": {"N": "45"}}'

STREAM_ARN=$(aws dynamodb describe-table --table-name demo-workouts \
  --query Table.LatestStreamArn --output text)

for SHARD in $(aws dynamodbstreams describe-stream --stream-arn "$STREAM_ARN" \
    --query 'StreamDescription.Shards[].ShardId' --output text); do
  ITER=$(aws dynamodbstreams get-shard-iterator --stream-arn "$STREAM_ARN" \
    --shard-id "$SHARD" --shard-iterator-type TRIM_HORIZON \
    --query ShardIterator --output text)
  aws dynamodbstreams get-records --shard-iterator "$ITER" \
    --query 'Records[].[eventName, dynamodb.Keys.WorkoutDate.S, dynamodb.OldImage.DurationMin.N, dynamodb.NewImage.DurationMin.N]' \
    --output table
done
```
:::

> [!CHECK]
> You see a `MODIFY` record for `2026-09-28` with old value `42` and new value `45`. Only changes made *after* the stream was turned on appear; the earlier inserts are not in the stream. If the table is empty, wait a few seconds and run the loop again. Records stay readable for 24 hours.

### Step 6: Turn on PITR and take an on-demand backup

:::console
1. Open the table's **Backups** tab.
2. In the **Point-in-time recovery (PITR)** section, choose **Edit**, choose **Turn on point-in-time recovery**, set the recovery period to `7` days, and choose **Save changes**.
3. Still on the **Backups** tab, choose **Create backup**. Check that the table name is `demo-workouts`, enter `demo-workouts-backup-1` as the backup name, and choose **Create backup**.
:::

:::cli
```bash
aws dynamodb update-continuous-backups --table-name demo-workouts \
  --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true,RecoveryPeriodInDays=7

BACKUP_ARN=$(aws dynamodb create-backup --table-name demo-workouts \
  --backup-name demo-workouts-backup-1 \
  --query BackupDetails.BackupArn --output text)

aws dynamodb describe-continuous-backups --table-name demo-workouts \
  --query 'ContinuousBackupsDescription.PointInTimeRecoveryDescription'
aws dynamodb describe-backup --backup-arn "$BACKUP_ARN" \
  --query 'BackupDescription.BackupDetails.BackupStatus'
```
:::

> [!CHECK]
> PITR shows status **Enabled** (CLI: `"PointInTimeRecoveryStatus": "ENABLED"`, `"RecoveryPeriodInDays": 7`) with an earliest and a latest restorable time. The backup appears in the **Backups** list and moves from **Creating** to **Available**.

### Step 7: Restore to a new table

Wait about five minutes after Step 6 so that a restore point exists, then restore. A restore never overwrites the source table: it always creates a new one.

:::console
1. On the **Backups** tab of `demo-workouts`, in the **Point-in-time recovery (PITR)** section, choose **Restore**.
2. For the new table name, enter `demo-workouts-restored`.
3. Choose the latest restorable time, keep the other defaults, and choose **Restore**.
4. In **Tables**, wait until `demo-workouts-restored` changes from **Restoring** to **Active** (a few minutes for a table this small).
:::

:::cli
```bash
aws dynamodb restore-table-to-point-in-time \
  --source-table-name demo-workouts \
  --target-table-name demo-workouts-restored \
  --use-latest-restorable-time

# The waiter gives up after about 8 minutes; restores can take longer, so rerun it if it times out
aws dynamodb wait table-exists --table-name demo-workouts-restored
aws dynamodb scan --table-name demo-workouts-restored --select COUNT
aws dynamodb describe-time-to-live --table-name demo-workouts-restored
aws dynamodb describe-table --table-name demo-workouts-restored \
  --query 'Table.StreamSpecification'
```
:::

> [!CHECK]
> The restored table contains the same items as the source at the restore time (the CLI `Count` is 5 unless TTL has already removed the draft). Its TTL status is `DISABLED` and it has no stream: a restore copies data, indexes, capacity and encryption settings, but you must reconfigure TTL, Streams, PITR, auto scaling, alarms and tags yourself.

## Cleanup

Delete in this order. On-demand backups are not deleted with the table and are billed until removed.

- [ ] Delete the restored table `demo-workouts-restored` (console: **Tables** → select it → **Delete** → confirm; CLI: `aws dynamodb delete-table --table-name demo-workouts-restored`).
- [ ] Delete the on-demand backup `demo-workouts-backup-1` (console: **Backups** in the left navigation pane → select it → **Delete** → confirm; CLI: `aws dynamodb delete-backup --backup-arn "$BACKUP_ARN"`, or find the ARN with `aws dynamodb list-backups --table-name demo-workouts`).
- [ ] Delete the table `demo-workouts` (console: **Tables** → select it → **Delete** → confirm; CLI: `aws dynamodb delete-table --table-name demo-workouts`). Its stream and TTL setting go with it. Because PITR was on, DynamoDB keeps a free system backup named `demo-workouts$DeletedTableBackup` for 35 days; it is not billed and expires on its own.
- [ ] Remove the local helper file: `rm -f workouts.json`.
- [ ] Final check: `aws dynamodb list-tables` no longer shows either table, and `aws dynamodb list-backups --backup-type USER` shows no `demo-workouts` backups in the Region you used.

## Progress checklist

- [ ] Step 1: on-demand table created with a composite primary key
- [ ] Step 2: four items with different attributes written
- [ ] Step 3: compared Query (2 scanned) with Scan (4 scanned)
- [ ] Step 4: TTL enabled and expired draft filtered out
- [ ] Step 5: read a MODIFY record with old and new images from the stream
- [ ] Step 6: PITR enabled (7 days) and on-demand backup available
- [ ] Step 7: restored into a new table and saw which settings were not copied
- [ ] Cleanup done
