---
id: 13-s3-advanced-lab-02
title: React to uploads with S3 event notifications and Amazon EventBridge
objective: Send filtered S3 object-created events to an SQS queue, then turn on EventBridge for the bucket and route only large uploads to CloudWatch Logs with an event-pattern rule.
estimatedTime: 45 minutes
cost: "Under USD 0.01 if you clean up the same day. SQS requests and the small CloudWatch Logs ingestion fall inside Always Free allowances; S3 storage and requests are a fraction of a cent; EventBridge bills S3 events at USD 1.00 per million, so a few events cost nothing measurable."
freeTier: partial
services: [s3, sqs, eventbridge, cloudwatch-logs]
---

> [!COST]
> S3 storage and requests are billed (cents at most for a few MB), SQS gives 1 million requests per month under Always Free, and CloudWatch Logs ingestion of a few KB is negligible. S3 itself adds no charge for event notifications. S3 events delivered to EventBridge are billed by EventBridge as opt-in data events, USD 1.00 per million in us-east-1, and delivery to a target in the same account (the log group here) is free {{updated: Checked 2026-10-04 on the EventBridge pricing page: S3 events on the default bus are charged EventBridge ingestion; the "billed at the source" note there applies only to events forwarded to the new enhanced custom buses}}; for the handful of events in this lab that is a tiny fraction of a cent.

The lab builds both patterns from the lesson: a **native notification** (prefix and suffix filter, SQS destination, resource policy) and an **EventBridge rule** that filters on object size, something native notifications cannot do. The steps use `us-east-1`; any Region works as long as the bucket, queue, rule and log group are in the same Region.

## Prerequisites

- An AWS account with permissions for S3, SQS, EventBridge and CloudWatch Logs (for example `AmazonS3FullAccess`, `AmazonSQSFullAccess`, `AmazonEventBridgeFullAccess` and `CloudWatchLogsFullAccess`).
- For the CLI tabs: **AWS CloudShell** (it includes `jq`, used below to build JSON) or AWS CLI v2 with `jq` in a Bash shell. Keep the same terminal open for the whole lab.
- A globally unique bucket name, for example `lab-events-<your initials>-<random digits>`.

## Steps

### Step 1: Create a bucket

:::console
1. Open the **S3** console and choose **General purpose buckets** → **Create bucket**.
2. Enter your unique **Bucket name**, keep **Block all public access** on and the other defaults, and choose **Create bucket**.
:::

:::cli
```bash
export AWS_REGION=us-east-1
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET=lab-events-$RANDOM$RANDOM
aws s3api create-bucket --bucket "$BUCKET" --region "$AWS_REGION"
# Outside us-east-1 add: --create-bucket-configuration LocationConstraint=$AWS_REGION
echo "Bucket: $BUCKET  Account: $ACCOUNT_ID"
```
:::

### Step 2: Create an SQS standard queue that trusts S3

S3 delivers notifications only if the queue's access policy allows the `s3.amazonaws.com` service principal to send messages.

:::console
1. Open the **SQS** console and choose **Create queue**.
2. Keep **Type** set to **Standard** and enter the **Name** `s3-events-demo`.
3. Under **Access policy**, choose **Advanced** and replace the JSON with the policy below. Replace `REGION`, `ACCOUNT_ID` and `BUCKET_NAME` with your values (the account ID is shown in the console's top-right account menu).
4. Keep the default encryption and choose **Create queue**.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowS3ToSend",
      "Effect": "Allow",
      "Principal": { "Service": "s3.amazonaws.com" },
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:REGION:ACCOUNT_ID:s3-events-demo",
      "Condition": {
        "ArnLike": { "aws:SourceArn": "arn:aws:s3:*:*:BUCKET_NAME" },
        "StringEquals": { "aws:SourceAccount": "ACCOUNT_ID" }
      }
    }
  ]
}
```
:::

:::cli
```bash
QUEUE_URL=$(aws sqs create-queue --queue-name s3-events-demo --query QueueUrl --output text)
QUEUE_ARN=$(aws sqs get-queue-attributes --queue-url "$QUEUE_URL" \
  --attribute-names QueueArn --query Attributes.QueueArn --output text)

cat > queue-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowS3ToSend",
      "Effect": "Allow",
      "Principal": { "Service": "s3.amazonaws.com" },
      "Action": "sqs:SendMessage",
      "Resource": "$QUEUE_ARN",
      "Condition": {
        "ArnLike": { "aws:SourceArn": "arn:aws:s3:*:*:$BUCKET" },
        "StringEquals": { "aws:SourceAccount": "$ACCOUNT_ID" }
      }
    }
  ]
}
EOF
# The Policy attribute must be a JSON string, so wrap the file with jq.
jq -n --arg policy "$(cat queue-policy.json)" '{Policy: $policy}' > queue-attrs.json
aws sqs set-queue-attributes --queue-url "$QUEUE_URL" --attributes file://queue-attrs.json
echo "Queue: $QUEUE_ARN"
```
:::

> [!CHECK]
> On the queue's **Queue policies** tab you see a statement with principal `s3.amazonaws.com` and action `sqs:SendMessage`, limited to your bucket and account.

### Step 3: Create a filtered event notification

Only `.jpg` files uploaded under `images/` should produce a message.

:::console
1. In the S3 console, open your bucket and choose **Properties**.
2. In the **Event Notifications** section, choose **Create event notification**.
3. For **Event name** enter `jpg-uploads`, for **Prefix** enter `images/`, and for **Suffix** enter `.jpg`.
4. In **Event types**, under object creation, select **All object create events** (`s3:ObjectCreated:*`).
5. In **Destination**, choose **SQS Queue**, then pick `s3-events-demo` from the list.
6. Choose **Save changes**.
:::

:::cli
```bash
cat > notification.json <<EOF
{
  "QueueConfigurations": [
    {
      "Id": "jpg-uploads",
      "QueueArn": "$QUEUE_ARN",
      "Events": ["s3:ObjectCreated:*"],
      "Filter": {
        "Key": {
          "FilterRules": [
            { "Name": "prefix", "Value": "images/" },
            { "Name": "suffix", "Value": ".jpg" }
          ]
        }
      }
    }
  ]
}
EOF
aws s3api put-bucket-notification-configuration --bucket "$BUCKET" \
  --notification-configuration file://notification.json
```
:::

> [!CHECK]
> The save succeeds and S3 sends an `s3:TestEvent` message to the queue. In the SQS console open `s3-events-demo` → **Send and receive messages** → **Poll for messages**, or run:
>
> `aws sqs receive-message --queue-url "$QUEUE_URL" --wait-time-seconds 10 --query 'Messages[].Body' --output text`
>
> If saving fails with a destination validation error, the queue policy in Step 2 has a wrong ARN, bucket name or account ID.

### Step 4: Upload matching and non-matching files

:::console
1. Create three small local files and name them `cat.jpg`, `readme.txt` and `dog.jpg` (any content works; S3 does not check that a `.jpg` is a real image).
2. In the bucket, create a folder `images` and upload `cat.jpg` and `readme.txt` into it.
3. Create a folder `docs` and upload `dog.jpg` into it.
4. In the SQS console, choose **Poll for messages** again and open each new message to read its body.
:::

:::cli
```bash
echo "pretend image" > cat.jpg
echo "not an image" > readme.txt
echo "another pretend image" > dog.jpg
aws s3 cp cat.jpg    "s3://$BUCKET/images/cat.jpg"
aws s3 cp readme.txt "s3://$BUCKET/images/readme.txt"
aws s3 cp dog.jpg    "s3://$BUCKET/docs/dog.jpg"
sleep 10
aws sqs receive-message --queue-url "$QUEUE_URL" --max-number-of-messages 10 \
  --wait-time-seconds 10 --query 'Messages[].Body' --output text \
  | jq -r '.Event // (.Records[0].eventName + "  " + .Records[0].s3.object.key + "  " + (.Records[0].s3.object.size|tostring) + " bytes")'
```
:::

> [!CHECK]
> You get exactly one new object event, `ObjectCreated:Put  images/cat.jpg`. `images/readme.txt` fails the suffix filter and `docs/dog.jpg` fails the prefix filter. The `s3:TestEvent` from Step 3 may show up again too: receiving a message does not delete it, it only hides it for the queue's 30-second visibility timeout. For the same reason, wait before polling again if something seems missing. Remember that delivery is at least once: a duplicate message would not be an error.

### Step 5: Turn on Amazon EventBridge for the bucket

:::console
1. In the bucket's **Properties** tab, scroll to **Event Notifications** and find the **Amazon EventBridge** subsection. Choose **Edit**.
2. Under **Send notifications to Amazon EventBridge for all events in this bucket**, choose **On**, then **Save changes**.
:::

:::cli
```bash
# put-bucket-notification-configuration REPLACES the whole configuration,
# so keep the SQS configuration and add EventBridge to it.
jq '. + {EventBridgeConfiguration: {}}' notification.json > notification-eb.json
aws s3api put-bucket-notification-configuration --bucket "$BUCKET" \
  --notification-configuration file://notification-eb.json
aws s3api get-bucket-notification-configuration --bucket "$BUCKET"
```
:::

> [!CHECK]
> The bucket shows **Amazon EventBridge: On** and the `jpg-uploads` notification is still listed (the CLI output contains both `QueueConfigurations` and `EventBridgeConfiguration`). The change can take about five minutes to take effect.

### Step 6: Create an EventBridge rule for uploads larger than 1 MB

The rule sends matching events to a CloudWatch Logs log group so you can read them. Event pattern (replace `BUCKET_NAME` in the console version):

```json
{
  "source": ["aws.s3"],
  "detail-type": ["Object Created"],
  "detail": {
    "bucket": { "name": ["BUCKET_NAME"] },
    "object": { "size": [{ "numeric": [">", 1048576] }] }
  }
}
```

:::console
1. Open the **Amazon EventBridge** console, choose **Rules** in the navigation pane, then **Create rule**.
2. On the rule builder selection page, choose **Advanced Builder**.
3. Enter the **Name** `s3-large-uploads`. For **Event bus** choose **AWS default event bus**, for **Rule type** choose **Rule with an event pattern**, then choose **Next**.
4. For **Event source**, choose **AWS events or EventBridge partner events**.
5. Under **Creation method**, choose **Custom pattern (JSON editor)**, paste the pattern above with your bucket name, and choose **Next**.
6. For **Target type**, choose **AWS service**. For **Select a target**, choose **CloudWatch log group**, and enter the log group name `s3-large-uploads` (the console adds the `/aws/events/` prefix and creates the group and its resource policy for you).
7. Choose **Next**, **Next** again (no tags), review, and choose **Create rule**.
:::

:::cli
```bash
LOG_GROUP=/aws/events/s3-large-uploads
aws logs create-log-group --log-group-name "$LOG_GROUP"
# EventBridge writes to CloudWatch Logs through a Logs resource policy (no IAM role).
aws logs put-resource-policy --policy-name lab-s3-events-to-logs --policy-document \
  "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":[\"events.amazonaws.com\",\"delivery.logs.amazonaws.com\"]},\"Action\":[\"logs:CreateLogStream\",\"logs:PutLogEvents\"],\"Resource\":\"arn:aws:logs:$AWS_REGION:$ACCOUNT_ID:log-group:$LOG_GROUP:*\"}]}"

cat > pattern.json <<EOF
{
  "source": ["aws.s3"],
  "detail-type": ["Object Created"],
  "detail": {
    "bucket": { "name": ["$BUCKET"] },
    "object": { "size": [{ "numeric": [">", 1048576] }] }
  }
}
EOF
aws events put-rule --name s3-large-uploads --event-pattern file://pattern.json
aws events put-targets --rule s3-large-uploads \
  --targets "Id=logs,Arn=arn:aws:logs:$AWS_REGION:$ACCOUNT_ID:log-group:$LOG_GROUP"
```
:::

> [!CHECK]
> The rule `s3-large-uploads` shows status **Enabled** with one CloudWatch log group target. `aws events list-targets-by-rule --rule s3-large-uploads` returns the log group ARN.

### Step 7: Test the size filter

:::console
1. Create a file larger than 1 MB (for example any photo or PDF of 2 MB or more) and a small text file.
2. Upload both to a new folder `videos` in the bucket.
3. Wait a minute, then open **CloudWatch** → **Log groups** → `/aws/events/s3-large-uploads`, open the newest log stream and expand the event.
:::

:::cli
```bash
dd if=/dev/urandom of=big.bin bs=1M count=2
echo "tiny" > small.txt
aws s3 cp big.bin   "s3://$BUCKET/videos/big.bin"
aws s3 cp small.txt "s3://$BUCKET/videos/small.txt"
sleep 60
aws logs filter-log-events --log-group-name "$LOG_GROUP" \
  --query 'events[].message' --output text \
  | jq -r '.["detail-type"] + "  " + .detail.object.key + "  " + (.detail.object.size|tostring) + " bytes  reason=" + .detail.reason'
```
:::

> [!CHECK]
> Only the large file appears, as `Object Created  videos/big.bin  2097152 bytes  reason=PutObject`. The small file did not match the numeric size filter. Neither upload reached SQS, because they are not `.jpg` files under `images/`: the two delivery paths are independent. If the log group stays empty, wait a few more minutes (Step 5 can take about five minutes to apply) and upload the big file again.

## Cleanup

- [ ] **EventBridge rule** `s3-large-uploads`. Console: **EventBridge** → **Rules** → select it → **Delete** and confirm. CLI: `aws events remove-targets --rule s3-large-uploads --ids logs`, then `aws events delete-rule --name s3-large-uploads`.
- [ ] **Log group** `/aws/events/s3-large-uploads`. Console: **CloudWatch** → **Log groups** → select it → **Actions** → **Delete log group(s)**. CLI: `aws logs delete-log-group --log-group-name /aws/events/s3-large-uploads`.
- [ ] **CloudWatch Logs resource policy** (CLI path only): `aws logs delete-resource-policy --policy-name lab-s3-events-to-logs`. If you used the console, run `aws logs describe-resource-policies` and delete the policy the console created only if no other EventBridge rule writes to `/aws/events/` log groups.
- [ ] **Bucket notification and EventBridge settings** (removed with the bucket; to remove them first, CLI: `aws s3api put-bucket-notification-configuration --bucket "$BUCKET" --notification-configuration '{}'`).
- [ ] **SQS queue** `s3-events-demo`. Console: **SQS** → select it → **Delete** → type `confirm`. CLI: `aws sqs delete-queue --queue-url "$QUEUE_URL"`.
- [ ] **Objects and bucket**. Console: select the bucket → **Empty** → type `permanently delete`; then **Delete** → type the bucket name. CLI: `aws s3 rm "s3://$BUCKET" --recursive` then `aws s3api delete-bucket --bucket "$BUCKET"`.
- [ ] **Local files**: `rm -f cat.jpg readme.txt dog.jpg big.bin small.txt queue-policy.json queue-attrs.json notification.json notification-eb.json pattern.json`.
- [ ] **Final check**: the bucket, queue, rule and log group no longer appear in their consoles for the Region you used.

## Progress checklist

- [ ] Step 1: Bucket created
- [ ] Step 2: SQS queue with an S3 access policy created
- [ ] Step 3: Filtered event notification saved and test event received
- [ ] Step 4: Only the matching upload produced a message
- [ ] Step 5: EventBridge turned on without losing the SQS notification
- [ ] Step 6: EventBridge rule with a size filter created
- [ ] Step 7: Only the large upload reached CloudWatch Logs
- [ ] Cleanup done
