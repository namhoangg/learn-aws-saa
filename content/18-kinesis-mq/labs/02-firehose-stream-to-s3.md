---
id: 18-kinesis-mq-lab-02
title: Deliver a Kinesis data stream to Amazon S3 with Amazon Data Firehose
objective: Attach a Firehose stream to the lab 01 data stream, tune its buffer to 1 MiB / 60 seconds, send records, and find the batched, newline-delimited objects in an S3 bucket.
estimatedTime: 35 minutes
cost: "About USD 0.02-0.05 in us-east-1 if deleted within an hour: the Kinesis shard-hours from lab 01 (USD 0.015 each) plus Firehose ingestion at USD 0.029 per GB (each record billed as at least 5 KB, so a few hundred test records cost far less than a cent). S3 storage for a few KB is a fraction of a cent (taken from credits on the Free plan). Accounts from the newer project-based sign-up (Sign up for AWS (new)) must upgrade to the Paid Plan to use Kinesis Data Streams and Firehose; credits still apply after upgrading."
freeTier: "no"
services: [data-firehose, kinesis-data-streams, s3, iam, cloudshell]
---

> [!COST]
> Firehose has no hourly charge here: you pay per GB ingested (USD 0.029 per GB in us-east-1, each record rounded up to 5 KB). The real running cost is the Kinesis data stream from lab 01, billed per shard-hour until you delete it. Amazon S3 and the IAM role cost nothing measurable. Neither Kinesis Data Streams nor Firehose has an Always Free allowance; on the credit-based Free plan the charges come out of your credits. If you signed up through AWS's newer project-based sign-up (**Sign up for AWS (new)**), both services are **Paid Plan** services there, so you must upgrade to the Paid Plan first; remaining credits still apply after the upgrade. Finish with **Cleanup**, which removes the resources from both labs.

> [!VERIFY] Can a Free plan account from the standard sign-up use Firehose?
> Checked on 2026-10-04. AWS's [supported services list for Sign up for AWS (new)](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html) puts Amazon Data Firehose and Kinesis Data Streams under the Paid Plan, but that page applies only to the newer, limited-release project-based sign-up. For a credit-based Free plan account from the standard sign-up, [Choosing a plan](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html) and the [Free Tier terms](https://aws.amazon.com/free/terms/) say only that some services need a Paid plan, without naming Firehose. If creating the Firehose stream is blocked or the console asks you to upgrade, choose **Upgrade plan** (remaining credits carry over), or read through the lab without running it.

This is the classic "stream to data lake" pattern from the lesson: producers write to Kinesis Data Streams, and Firehose consumes the stream and lands batched files in S3 without any consumer code.

## Prerequisites

- Lab 01 completed **without** its cleanup, so `demo-stream` exists and is **Active**. If you deleted it, recreate it with Step 1 of lab 01 (one provisioned shard is enough).
- An account plan that allows Kinesis Data Streams and Firehose: on the newer project-based sign-up (Sign up for AWS (new)) that means the **Paid Plan**. For a Free plan account from the standard sign-up, see the **Needs verification** note above.
- IAM permissions for Kinesis, Firehose, S3 and IAM role creation (for a sandbox: `AmazonKinesisFullAccess`, `AmazonKinesisFirehoseFullAccess`, `AmazonS3FullAccess` and `IAMFullAccess`).
- The same Region as lab 01 and an AWS CloudShell session. Set these variables first; later CLI tabs use them.

```bash
REGION=${AWS_REGION:-$(aws configure get region)}
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET="demo-firehose-$ACCOUNT_ID-$REGION"
STREAM_ARN=$(aws kinesis describe-stream-summary --stream-name demo-stream \
  --query StreamDescriptionSummary.StreamARN --output text)
echo "$REGION $BUCKET $STREAM_ARN"
```

## Steps

### Step 1: Create the destination S3 bucket

:::console
1. Open the **S3** console and choose **Create bucket**.
2. Keep the bucket type **General purpose** and enter a globally unique name such as `demo-firehose-<account-id>-<region>`.
3. Leave **Block all public access** turned on and the other defaults, then choose **Create bucket**.
:::

:::cli
```bash
aws s3 mb "s3://$BUCKET" --region "$REGION"
aws s3 ls | grep "$BUCKET"
```
:::

> [!CHECK]
> The bucket appears in the bucket list in your Region and is empty.

### Step 2: Create the Firehose stream with the data stream as its source

:::console
1. Open the **Amazon Data Firehose** console and choose **Create Firehose stream**.
2. For the source choose **Amazon Kinesis Data Streams**; for the destination choose **Amazon S3**.
3. Under **Source settings**, pick `demo-stream` in the **Kinesis data stream** list (or paste its ARN).
4. For **Firehose stream name**, enter `demo-firehose`.
5. Leave **Transform and convert records** turned off (no Lambda function, record format conversion **Disabled**).
6. Under **Destination settings**, choose your bucket for **S3 bucket** and set **New line delimiter** to **Enabled** so every record starts a new line. Leave **Dynamic partitioning** disabled and the prefixes empty (Firehose then uses a `YYYY/MM/dd/HH/` time prefix).
7. Expand the section that holds **Buffering hints** and compression, set **Buffer size** to `1` MiB and **Buffer interval** to `60` seconds, and leave **S3 compression** disabled so you can read the files directly.
8. Under **Advanced settings**, keep the default that lets the console create a new IAM role for the stream.
9. Choose **Create Firehose stream** and wait until the status is **Active** (a minute or two).
:::

:::cli
```bash
cat > firehose-trust.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Principal": { "Service": "firehose.amazonaws.com" }, "Action": "sts:AssumeRole" }
  ]
}
EOF
aws iam create-role --role-name demo-firehose-role \
  --assume-role-policy-document file://firehose-trust.json --query Role.Arn --output text

cat > firehose-perms.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow",
      "Action": ["s3:AbortMultipartUpload", "s3:GetBucketLocation", "s3:GetObject",
                 "s3:ListBucket", "s3:ListBucketMultipartUploads", "s3:PutObject"],
      "Resource": ["arn:aws:s3:::$BUCKET", "arn:aws:s3:::$BUCKET/*"] },
    { "Effect": "Allow",
      "Action": ["kinesis:DescribeStream", "kinesis:GetShardIterator",
                 "kinesis:GetRecords", "kinesis:ListShards"],
      "Resource": "$STREAM_ARN" }
  ]
}
EOF
aws iam put-role-policy --role-name demo-firehose-role \
  --policy-name demo-firehose-access --policy-document file://firehose-perms.json
ROLE_ARN=$(aws iam get-role --role-name demo-firehose-role --query Role.Arn --output text)
sleep 15   # give IAM a moment to propagate the new role

cat > s3-destination.json <<EOF
{
  "RoleARN": "$ROLE_ARN",
  "BucketARN": "arn:aws:s3:::$BUCKET",
  "BufferingHints": { "SizeInMBs": 1, "IntervalInSeconds": 60 },
  "CompressionFormat": "UNCOMPRESSED",
  "ProcessingConfiguration": {
    "Enabled": true,
    "Processors": [ { "Type": "AppendDelimiterToRecord" } ]
  }
}
EOF
aws firehose create-delivery-stream --delivery-stream-name demo-firehose \
  --delivery-stream-type KinesisStreamAsSource \
  --kinesis-stream-source-configuration "KinesisStreamARN=$STREAM_ARN,RoleARN=$ROLE_ARN" \
  --extended-s3-destination-configuration file://s3-destination.json

until [ "$(aws firehose describe-delivery-stream --delivery-stream-name demo-firehose \
  --query DeliveryStreamDescription.DeliveryStreamStatus --output text)" = "ACTIVE" ]; do
  echo "waiting..."; sleep 10
done; echo "demo-firehose is ACTIVE"
```
:::

> [!CHECK]
> `demo-firehose` shows status **Active**, source `demo-stream` and destination your S3 bucket. In the API the resource is still called a "delivery stream" (`create-delivery-stream`), even though the console now says "Firehose stream".

### Step 3: Send records into the data stream

Firehose starts reading the data stream at its **latest** position, so records written before the Firehose stream existed (such as those from lab 01) are not delivered. Write new ones now.

:::cli
```bash
for i in $(seq 1 50); do
  truck="truck-$(( (i % 5) + 1 ))"
  aws kinesis put-record --stream-name demo-stream --partition-key "$truck" \
    --data "{\"truck\":\"$truck\",\"reading\":$i,\"speed\":$(( 30 + i % 40 ))}" \
    --cli-binary-format raw-in-base64-out --query ShardId --output text >/dev/null
done
echo "sent 50 records at $(date -u +%H:%M:%S) UTC"
```
:::

> [!CHECK]
> The loop finishes without `ProvisionedThroughputExceededException` errors: 50 small records over several seconds is far below one shard's 1,000 records per second.

### Step 4: Find the delivered objects in S3

Wait about 60 to 90 seconds: the 1 MiB buffer will not fill with 50 tiny records, so the 60-second interval triggers the delivery.

:::console
1. In the S3 console open your bucket and drill into the `YYYY/` → `MM/` → `dd/` → `HH/` folders.
2. Select the object (its name starts with `demo-firehose-`) and choose **Open** or **Download** to view it.
:::

:::cli
```bash
aws s3 ls "s3://$BUCKET/" --recursive
KEY=$(aws s3api list-objects-v2 --bucket "$BUCKET" --query 'Contents[0].Key' --output text)
aws s3 cp "s3://$BUCKET/$KEY" - | head -n 5
aws s3 cp "s3://$BUCKET/$KEY" - | wc -l
```
:::

> [!CHECK]
> One or a few objects appear under a UTC date/hour prefix. Each line is one JSON record, thanks to the newline delimiter, and the line count across the objects adds up to 50. Firehose batched many stream records into few S3 objects, which is exactly what makes S3 and Athena efficient. If the bucket is still empty after two minutes, check that you wrote the records after the Firehose stream became **Active**.

### Step 5: See that Direct PUT is disabled for a stream-sourced Firehose

:::cli
```bash
aws firehose put-record --delivery-stream-name demo-firehose \
  --record Data="$(echo '{"direct":"put"}' | base64)"
```
:::

> [!CHECK]
> The call is rejected with an error. When a Kinesis data stream is the source, Firehose accepts data only from that stream; producers must keep writing to Kinesis Data Streams with `PutRecord` / `PutRecords`.

## Cleanup

Delete in this order (this also removes the lab 01 stream):

- [ ] **Note the IAM role** used by `demo-firehose`: open the Firehose stream's configuration and copy the role name shown under service access (CLI path: `demo-firehose-role`).
- [ ] **Firehose stream `demo-firehose`**: Firehose console → select it → **Delete**, then confirm. CLI: `aws firehose delete-delivery-stream --delivery-stream-name demo-firehose`.
- [ ] **Data stream `demo-stream`**: Kinesis console → select → **Actions** → **Delete** and confirm. CLI: `aws kinesis delete-stream --stream-name demo-stream`.
- [ ] **S3 objects and bucket**: S3 console → select the bucket → **Empty** (type the confirmation), then **Delete** (type the bucket name). CLI: `aws s3 rb "s3://$BUCKET" --force`.
- [ ] **IAM role**: IAM console → **Roles** → select the role you noted → **Delete**. CLI: `aws iam delete-role-policy --role-name demo-firehose-role --policy-name demo-firehose-access` then `aws iam delete-role --role-name demo-firehose-role`. If the console created the role, also delete the customer managed policy it attached (shown on the role's **Permissions** tab) from **Policies**.
- [ ] **CloudWatch log group** for Firehose error logging, if the console created one (look for `/aws/kinesisfirehose/demo-firehose` under CloudWatch → **Log groups**): select → **Actions** → **Delete log group(s)**. CLI: `aws logs delete-log-group --log-group-name /aws/kinesisfirehose/demo-firehose`.
- [ ] **Local files** in CloudShell: `rm -f firehose-trust.json firehose-perms.json s3-destination.json`.
- [ ] **Final check**: `aws firehose list-delivery-streams` and `aws kinesis list-streams` return empty lists in this Region, the bucket is gone, and the next day **Billing and Cost Management** → **Bills** shows no new Kinesis or Firehose usage.

## Progress checklist

- [ ] Step 1: Created the destination S3 bucket
- [ ] Step 2: Created `demo-firehose` with `demo-stream` as source and a 1 MiB / 60 s buffer
- [ ] Step 3: Sent 50 records into the data stream
- [ ] Step 4: Found newline-delimited batch files under a date/hour prefix in S3
- [ ] Step 5: Saw Direct PUT rejected for a stream-sourced Firehose
- [ ] Cleanup done for labs 01 and 02
