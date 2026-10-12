---
id: 18-kinesis-mq-lab-01
title: Produce, read and replay records in a Kinesis data stream
objective: Create a one-shard provisioned data stream, write records with partition keys from CloudShell, read them back with shard iterators and the console Data Viewer, replay them, and watch a reshard split the stream into two shards.
estimatedTime: 40 minutes
cost: "About USD 0.02-0.05 in us-east-1 if deleted within an hour: USD 0.015 per shard-hour (one shard, then two after Step 5) plus a negligible PUT payload charge. Kinesis Data Streams has no Always Free or legacy 12-month Free Tier allowance; on the credit-based Free plan the charge is taken from your credits. Accounts from the newer project-based sign-up (Sign up for AWS (new)) must upgrade to the Paid Plan to use Kinesis Data Streams; credits still apply after upgrading."
freeTier: "no"
services: [kinesis-data-streams, cloudshell, iam]
---

> [!COST]
> Kinesis Data Streams is billed from the moment the stream exists, whether or not data flows: USD 0.015 per shard-hour in provisioned mode in us-east-1, plus USD 0.014 per million 25 KB PUT payload units. This lab uses one shard (two after Step 5) for under an hour, so expect a few US cents. Do not leave the stream running: a forgotten two-shard stream costs about USD 22 a month. If you plan to continue with lab 02, keep the stream and clean up at the end of lab 02 instead.
>
> Account plan: if you signed up through AWS's newer project-based sign-up (**Sign up for AWS (new)**, managed in **AWS Settings**), Kinesis Data Streams and Amazon Data Firehose are **Paid Plan** services there, so you must upgrade to the Paid Plan before you can create a stream. Remaining Free Tier credits still apply to the charges after you upgrade.

> [!VERIFY] Can a Free plan account from the standard sign-up create a data stream?
> Checked on 2026-10-04. AWS's [supported services list for Sign up for AWS (new)](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html) places Kinesis Data Streams and Firehose under the Paid Plan, but that page covers only the newer, limited-release project-based sign-up. For a credit-based Free plan account created through the standard sign-up, [Choosing a plan](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html) and the [Free Tier terms](https://aws.amazon.com/free/terms/) only say that some services need a Paid plan, and the list they point to does not name Kinesis. If **Create data stream** is blocked or the console asks you to upgrade, choose **Upgrade plan** in the console (your remaining credits carry over), or stop here and study the lab without running it.

You will see the core behaviours from the lesson with your own eyes: records grouped by partition key, sequence numbers, the fact that reading does not delete anything, and replay from an earlier position.

## Prerequisites

- An AWS account and an IAM user or role allowed to use Kinesis Data Streams (for a sandbox, the AWS managed policy `AmazonKinesisFullAccess` is enough).
- An account plan that allows Kinesis Data Streams: on the newer project-based sign-up (Sign up for AWS (new)) that means the **Paid Plan**. For a Free plan account from the standard sign-up, see the **Needs verification** note above.
- A Region where you will work for both labs; the examples use **US East (N. Virginia) `us-east-1`**.
- **AWS CloudShell** (the terminal icon in the console navigation bar), which already has AWS CLI v2 and `base64`. Any Bash shell with AWS CLI v2 configured also works.
- Throughout the lab, AWS CLI v2 expects binary parameters in base64. The commands add `--cli-binary-format raw-in-base64-out` so you can type plain text.

## Steps

### Step 1: Create a provisioned stream with one shard

:::console
1. Open the **Kinesis** console and confirm the Region selector shows the Region you chose.
2. Choose **Create data stream**.
3. On the **Create Kinesis stream** page, enter `demo-stream` as the data stream name.
4. Under capacity mode choose **Provisioned** (the default is **On-demand**) and set the number of provisioned shards to `1`.
5. Leave the other settings at their defaults and choose **Create Kinesis stream**.
6. Wait until the stream's **Status** changes from **Creating** to **Active**, then open the stream to see its details page.
:::

:::cli
```bash
aws kinesis create-stream --stream-name demo-stream \
  --stream-mode-details StreamMode=PROVISIONED --shard-count 1
aws kinesis wait stream-exists --stream-name demo-stream
aws kinesis describe-stream-summary --stream-name demo-stream \
  --query 'StreamDescriptionSummary.[StreamStatus,OpenShardCount,RetentionPeriodHours,StreamModeDetails.StreamMode]'
```
:::

> [!CHECK]
> The stream is **Active** with **1** open shard, a retention period of **24** hours and capacity mode **PROVISIONED**. One shard means this stream accepts at most 1 MB/s or 1,000 records per second.

### Step 2: Write records with partition keys

Send three readings for each of two trucks. The partition key is the truck ID, so each truck's readings stay in order.

:::cli
```bash
for truck in truck-17 truck-42; do
  for n in 1 2 3; do
    aws kinesis put-record --stream-name demo-stream \
      --partition-key "$truck" \
      --data "{\"truck\":\"$truck\",\"reading\":$n,\"speed\":$((40 + n * 5))}" \
      --cli-binary-format raw-in-base64-out \
      --query '[ShardId,SequenceNumber]' --output text
  done
done
```
:::

> [!CHECK]
> Each of the six calls prints `shardId-000000000000` (the only shard) and a long sequence number. The sequence numbers grow with every write: Kinesis assigns them, the producer does not.

### Step 3: Read the records back

A consumer first asks for a **shard iterator** (a bookmark), then calls `GetRecords` with it. `TRIM_HORIZON` starts at the oldest record still retained.

:::console
1. On the `demo-stream` details page, open the **Data Viewer** tab.
2. For the shard, choose `shardId-000000000000`.
3. For **Starting Position**, choose **Trim horizon**, then choose **Get records**.
4. Look at the records table: partition key, sequence number, arrival time and the decoded data.
:::

:::cli
```bash
ITER=$(aws kinesis get-shard-iterator --stream-name demo-stream \
  --shard-id shardId-000000000000 --shard-iterator-type TRIM_HORIZON \
  --query ShardIterator --output text)
aws kinesis get-records --shard-iterator "$ITER" \
  --query 'Records[].[PartitionKey,Data]' --output text |
while read -r key data; do
  echo "$key  $(echo "$data" | base64 --decode)"
done
```
:::

> [!CHECK]
> You see all six records. For each truck the `reading` values appear as 1, 2, 3: order is preserved per partition key. If the CLI returns an empty list, run `get-records` again with the same commands; a single call can come back empty even when records exist.

### Step 4: Read again to prove nothing was deleted, then replay from a timestamp

:::cli
```bash
# Same read again: the records are still there.
ITER=$(aws kinesis get-shard-iterator --stream-name demo-stream \
  --shard-id shardId-000000000000 --shard-iterator-type TRIM_HORIZON \
  --query ShardIterator --output text)
aws kinesis get-records --shard-iterator "$ITER" --query 'length(Records)'

# Note the time, write one more record, then replay only from that time.
START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
sleep 2
aws kinesis put-record --stream-name demo-stream --partition-key truck-17 \
  --data '{"truck":"truck-17","reading":4,"speed":70}' \
  --cli-binary-format raw-in-base64-out --output text
ITER=$(aws kinesis get-shard-iterator --stream-name demo-stream \
  --shard-id shardId-000000000000 --shard-iterator-type AT_TIMESTAMP \
  --timestamp "$START" --query ShardIterator --output text)
aws kinesis get-records --shard-iterator "$ITER" --query 'Records[].Data' --output text |
  tr '\t' '\n' | while read -r d; do echo "$d" | base64 --decode; echo; done
```
:::

:::console
1. In the **Data Viewer** tab choose **Get records** again with **Trim horizon**: the same six records are listed.
2. Change **Starting Position** to **At timestamp**, enter a time between your first batch and the extra record from the CLI tab, and choose **Get records**.
:::

> [!CHECK]
> The second `TRIM_HORIZON` read still returns 6 (or 7) records: unlike an SQS queue, consuming a stream does not remove data. The `AT_TIMESTAMP` read returns only the `reading 4` record. This is how a consumer replays from any point within the retention period.

### Step 5: Reshard from one to two shards

Doubling the shards doubles the write capacity. The old shard is closed (kept readable until its records expire) and two child shards take over its hash key range.

:::console
1. On the `demo-stream` details page, open the **Configuration** tab and choose **Edit provisioned shards**.
2. Enter `2` as the new shard count and save the change. The status shows **Updating** for a short time, then **Active**.
:::

:::cli
```bash
aws kinesis update-shard-count --stream-name demo-stream \
  --target-shard-count 2 --scaling-type UNIFORM_SCALING
aws kinesis wait stream-exists --stream-name demo-stream
aws kinesis list-shards --stream-name demo-stream \
  --query 'Shards[].[ShardId,ParentShardId,SequenceNumberRange.EndingSequenceNumber]' --output table

# Write records for several trucks and see which shard each key lands on.
for truck in truck-17 truck-42 truck-99 truck-7 truck-123; do
  aws kinesis put-record --stream-name demo-stream --partition-key "$truck" \
    --data "{\"truck\":\"$truck\"}" --cli-binary-format raw-in-base64-out \
    --query ShardId --output text | sed "s/^/$truck -> /"
done
```
:::

> [!CHECK]
> `list-shards` shows three shards: `shardId-000000000000` now has an ending sequence number (closed), and two new shards list it as their parent. New writes go only to the two open child shards, and the same truck always maps to the same child shard. If the status is still **Updating**, wait a minute and list the shards again.

## Cleanup

Skip this section if you are continuing straight to lab 02, which reuses `demo-stream` and cleans it up at the end.

- [ ] **Data stream `demo-stream`** (its shards and records are deleted with it): in the Kinesis console select the stream, choose **Actions** → **Delete**, type the confirmation text and confirm. CLI: `aws kinesis delete-stream --stream-name demo-stream`, then `aws kinesis describe-stream-summary --stream-name demo-stream` until it returns `ResourceNotFoundException`.
- [ ] **Final check**: the Kinesis console lists no data streams in the Region you used (`aws kinesis list-streams` returns an empty list), and the next day **Billing and Cost Management** → **Bills** shows no new Kinesis charges after today.

## Progress checklist

- [ ] Step 1: Created `demo-stream` in provisioned mode with one shard
- [ ] Step 2: Wrote six records with truck IDs as partition keys
- [ ] Step 3: Read the records with a `TRIM_HORIZON` iterator and the Data Viewer
- [ ] Step 4: Confirmed reads do not delete data and replayed from a timestamp
- [ ] Step 5: Resharded to two shards and saw parent and child shards
- [ ] Cleanup done (or deferred to lab 02)
