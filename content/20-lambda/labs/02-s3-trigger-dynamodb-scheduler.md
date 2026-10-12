---
id: 20-lambda-lab-02
title: Build an event-driven indexer and a serverless cron job with Lambda
objective: Trigger a Lambda function from S3 uploads to record each object's metadata in DynamoDB, then invoke the same function every minute with EventBridge Scheduler, the two classic Lambda patterns from the lesson.
estimatedTime: 45 minutes
cost: "Well under USD 0.01: a few S3 PUT requests and kilobytes of storage, a few dozen DynamoDB writes. Lambda (Always Free), EventBridge Scheduler (free tier of 14 million invocations per month) and CloudWatch Logs stay inside their free allowances. New accounts' Free Tier credits cover all of it."
freeTier: partial
services: [lambda, s3, dynamodb, eventbridge, iam-roles, cloudwatch-logs]
---

You will build the serverless "metadata indexer" pattern: every file uploaded to a bucket fires an S3 event notification, Lambda receives the event asynchronously and writes the object's key, size and time into a DynamoDB table. Then you will attach a schedule so the same function also runs every minute and writes a heartbeat item, which is the serverless cron pattern. No server runs between events.

> [!COST]
> The Lambda, EventBridge Scheduler and CloudWatch Logs usage here fits inside their free allowances (even past Scheduler's free tier, a few dozen invocations would cost a tiny fraction of a cent). Amazon S3 requests and storage, and DynamoDB on-demand writes (about USD 0.625 per million in US East), are billed in accounts without Free Tier credits, but this lab makes only a few dozen of them, so the total is a small fraction of a cent. Delete the schedule promptly: it keeps invoking the function every minute until you remove it.

## Prerequisites

- An AWS account and an IAM user or role allowed to manage Lambda, S3, DynamoDB, EventBridge Scheduler and IAM roles.
- One Region for the whole lab. The bucket, table, function and schedule must all be in the same Region.
- **AWS CloudShell** in that Region for the CLI tabs (AWS CLI v2 is preinstalled). Keep one tab open; later commands reuse shell variables.
- A small file to upload (any image or text file).

## Steps

### Step 1: Create the DynamoDB table

:::console
1. Open the **DynamoDB** console and choose **Tables** in the left navigation pane, then **Create table**.
2. For **Table name**, enter `demo-uploads`.
3. For **Partition key**, enter `pk` and leave the type as **String**. Leave **Sort key** empty.
4. For **Table settings**, keep **Default settings** and choose **Create table**.
:::

:::cli
```bash
aws dynamodb create-table --table-name demo-uploads \
  --attribute-definitions AttributeName=pk,AttributeType=S \
  --key-schema AttributeName=pk,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST
aws dynamodb wait table-exists --table-name demo-uploads
TABLE_ARN=$(aws dynamodb describe-table --table-name demo-uploads \
  --query Table.TableArn --output text); echo "$TABLE_ARN"
```
:::

> [!CHECK]
> The table `demo-uploads` reaches the **Active** status with partition key `pk (String)`.

### Step 2: Create the S3 bucket

Bucket names are global, so add something unique such as your account ID and a random number.

:::console
1. Open the **Amazon S3** console, choose **General purpose buckets**, then **Create bucket**.
2. Keep **Bucket type** as **General purpose** and enter a unique **Bucket name**, for example `demo-uploads-<account-id>-<random>`.
3. Leave the other settings at their defaults (Block Public Access stays on) and choose **Create bucket**.
:::

:::cli
```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET="demo-uploads-$ACCOUNT_ID-$RANDOM"
aws s3 mb "s3://$BUCKET"
echo "$BUCKET"
```
:::

> [!CHECK]
> The new bucket appears in the bucket list in your lab Region and is empty.

### Step 3: Create the function and let it write to the table

The handler distinguishes the two event shapes: S3 events carry a `Records` list, the scheduled event you will send later does not.

:::console
1. Open the **Lambda** console, choose **Create function** and select **Author from scratch**.
2. For **Function name**, enter `demo-upload-indexer`. For **Runtime**, choose **Python 3.14**; leave **Architecture** as **x86_64** and the default execution role. Choose **Create function**.
3. On the **Code** tab, replace `lambda_function.py` with the code below and choose **Deploy**.
4. Choose **Configuration** → **Environment variables** → **Edit** → **Add environment variable**. Enter the key `TABLE_NAME` and the value `demo-uploads`, then choose **Save**.
5. Choose **Configuration** → **Permissions** and choose the **Role name** link. In IAM choose **Add permissions** → **Create inline policy**, select **JSON**, paste the policy below (replace the Region and account ID), choose **Next**, enter the name `put-demo-uploads` and choose **Create policy**.

```python
import os
import urllib.parse
from datetime import datetime, timezone

import boto3

TABLE = boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])  # created once per environment


def lambda_handler(event, context):
    records = event.get("Records", [])
    if not records:
        # Scheduled run (or a manual test without Records): write a heartbeat item
        now = datetime.now(timezone.utc).isoformat()
        TABLE.put_item(Item={"pk": f"heartbeat#{now}", "source": event.get("source", "manual")})
        print(f"heartbeat written at {now}")
        return {"written": 1, "kind": "heartbeat"}

    for record in records:
        key = urllib.parse.unquote_plus(record["s3"]["object"]["key"])
        TABLE.put_item(Item={
            "pk": f"object#{key}",
            "bucket": record["s3"]["bucket"]["name"],
            "sizeBytes": record["s3"]["object"].get("size", 0),
            "eventName": record["eventName"],
            "eventTime": record["eventTime"],
        })
        print(f"indexed {key}")
    return {"written": len(records), "kind": "s3"}
```

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "dynamodb:PutItem",
    "Resource": "arn:aws:dynamodb:REGION:ACCOUNT_ID:table/demo-uploads"
  }]
}
```
:::

:::cli
```bash
mkdir -p ~/demo-indexer && cd ~/demo-indexer
cat > lambda_function.py <<'EOF'
import os
import urllib.parse
from datetime import datetime, timezone

import boto3

TABLE = boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])  # created once per environment


def lambda_handler(event, context):
    records = event.get("Records", [])
    if not records:
        # Scheduled run (or a manual test without Records): write a heartbeat item
        now = datetime.now(timezone.utc).isoformat()
        TABLE.put_item(Item={"pk": f"heartbeat#{now}", "source": event.get("source", "manual")})
        print(f"heartbeat written at {now}")
        return {"written": 1, "kind": "heartbeat"}

    for record in records:
        key = urllib.parse.unquote_plus(record["s3"]["object"]["key"])
        TABLE.put_item(Item={
            "pk": f"object#{key}",
            "bucket": record["s3"]["bucket"]["name"],
            "sizeBytes": record["s3"]["object"].get("size", 0),
            "eventName": record["eventName"],
            "eventTime": record["eventTime"],
        })
        print(f"indexed {key}")
    return {"written": len(records), "kind": "s3"}
EOF
zip function.zip lambda_function.py

cat > trust.json <<'EOF'
{"Version": "2012-10-17",
 "Statement": [{"Effect": "Allow",
                "Principal": {"Service": "lambda.amazonaws.com"},
                "Action": "sts:AssumeRole"}]}
EOF
ROLE_ARN=$(aws iam create-role --role-name demo-upload-indexer-role \
  --assume-role-policy-document file://trust.json --query Role.Arn --output text)
aws iam attach-role-policy --role-name demo-upload-indexer-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
cat > put-policy.json <<EOF
{"Version": "2012-10-17",
 "Statement": [{"Effect": "Allow", "Action": "dynamodb:PutItem", "Resource": "$TABLE_ARN"}]}
EOF
aws iam put-role-policy --role-name demo-upload-indexer-role \
  --policy-name put-demo-uploads --policy-document file://put-policy.json
sleep 10   # let IAM propagate the new role

FUNCTION_ARN=$(aws lambda create-function --function-name demo-upload-indexer \
  --runtime python3.14 --handler lambda_function.lambda_handler \
  --role "$ROLE_ARN" --zip-file fileb://function.zip --timeout 10 \
  --environment "Variables={TABLE_NAME=demo-uploads}" \
  --query FunctionArn --output text)
aws lambda wait function-active-v2 --function-name demo-upload-indexer
echo "$FUNCTION_ARN"
```
:::

> [!CHECK]
> The function shows the environment variable `TABLE_NAME = demo-uploads`, and its execution role lists two permission policies: the basic logging policy and the inline policy allowing `dynamodb:PutItem` on the table only (least privilege).

### Step 4: Test with an empty event before wiring the trigger

:::console
1. On the **Code** tab, under **TEST EVENTS**, choose **Create test event**, name it `manual`, set the JSON to `{}` and choose **Save**.
2. In **TEST EVENTS**, choose the run icon next to `manual`.
3. Open **DynamoDB** → **Tables** → `demo-uploads` → **Explore table items**.
:::

:::cli
```bash
aws lambda invoke --function-name demo-upload-indexer \
  --cli-binary-format raw-in-base64-out --payload '{}' out.json && cat out.json; echo
aws dynamodb scan --table-name demo-uploads --query 'Items[].pk.S'
```
:::

> [!CHECK]
> The response is `{"written": 1, "kind": "heartbeat"}` and the table contains one item whose `pk` starts with `heartbeat#`. If you see `AccessDeniedException`, the inline policy is missing or names the wrong table ARN.

### Step 5: Add the S3 trigger

Adding the trigger does two things: it adds a statement to the function's **resource-based policy** that lets `s3.amazonaws.com` invoke it, and it creates an **event notification** on the bucket.

:::console
1. In the function's **Function overview** pane, choose **Add trigger**.
2. Select **S3**. Under **Bucket**, choose your bucket.
3. Under **Event types**, keep **All object create events**.
4. Under **Recursive invocation**, select the check box to acknowledge the warning (this function writes to DynamoDB, never back to the bucket, so there is no loop).
5. Choose **Add**.
:::

:::cli
```bash
aws lambda add-permission --function-name demo-upload-indexer \
  --statement-id s3-invoke --action lambda:InvokeFunction \
  --principal s3.amazonaws.com \
  --source-arn "arn:aws:s3:::$BUCKET" --source-account "$ACCOUNT_ID"

cat > notification.json <<EOF
{"LambdaFunctionConfigurations": [
  {"Id": "index-uploads",
   "LambdaFunctionArn": "$FUNCTION_ARN",
   "Events": ["s3:ObjectCreated:*"]}
]}
EOF
aws s3api put-bucket-notification-configuration --bucket "$BUCKET" \
  --notification-configuration file://notification.json
```
:::

> [!CHECK]
> The **Function overview** diagram now shows **S3** as a trigger. Under **Configuration** → **Permissions** → **Resource-based policy statements**, a statement allows the S3 service to call `lambda:InvokeFunction` for your bucket.

### Step 6: Upload files and watch the index fill

:::console
1. In the S3 console open your bucket, choose **Upload** → **Add files**, pick one or two files and choose **Upload**.
2. Return to **DynamoDB** → `demo-uploads` → **Explore table items** and refresh.
3. Open the **CloudWatch** console, choose **Log groups**, select `/aws/lambda/demo-upload-indexer` and open the newest log stream.
:::

:::cli
```bash
echo "hello lambda" > hello.txt
aws s3 cp hello.txt "s3://$BUCKET/reports/hello world.txt"
sleep 10
aws dynamodb scan --table-name demo-uploads \
  --query 'Items[].[pk.S, sizeBytes.N, eventName.S]' --output table
```
:::

> [!CHECK]
> One new item appears per uploaded file, for example `object#reports/hello world.txt` with its size and the event name `ObjectCreated:Put`. The key is stored with a real space because the code URL-decodes it (S3 sends `hello+world.txt`). The log shows an `indexed ...` line for each file. S3 invoked the function asynchronously: the upload finished without waiting for Lambda.

### Step 7: Run the same function on a schedule with EventBridge Scheduler

A rate of 1 minute keeps the lab short. Real cron jobs usually run hourly or daily.

:::console
1. Open the **Amazon EventBridge** console and, under **Scheduler**, choose **Schedules** → **Create schedule**.
2. For **Schedule name**, enter `demo-heartbeat`. Leave **Schedule group** as `default`.
3. Under **Schedule pattern**, choose **Recurring schedule**, then **Rate-based schedule**; enter `1` for **Value** and choose `minutes` for **Unit**.
4. Set **Flexible time window** to **Off** and choose **Next**.
5. Under **Select target**, choose **Templated targets** and pick the AWS Lambda **Invoke** target. Choose `demo-upload-indexer` as the function and enter `{"source": "scheduler"}` as the payload. Choose **Next**.
6. On **Settings**, leave the schedule enabled. Under **Permissions**, choose **Create new role for this schedule** and accept the suggested role name. Choose **Next**, review, then **Create schedule**.
:::

:::cli
```bash
cat > scheduler-trust.json <<'EOF'
{"Version": "2012-10-17",
 "Statement": [{"Effect": "Allow",
                "Principal": {"Service": "scheduler.amazonaws.com"},
                "Action": "sts:AssumeRole"}]}
EOF
SCHED_ROLE_ARN=$(aws iam create-role --role-name demo-heartbeat-scheduler-role \
  --assume-role-policy-document file://scheduler-trust.json --query Role.Arn --output text)
cat > invoke-policy.json <<EOF
{"Version": "2012-10-17",
 "Statement": [{"Effect": "Allow", "Action": "lambda:InvokeFunction", "Resource": "$FUNCTION_ARN"}]}
EOF
aws iam put-role-policy --role-name demo-heartbeat-scheduler-role \
  --policy-name invoke-demo-upload-indexer --policy-document file://invoke-policy.json
sleep 10

aws scheduler create-schedule --name demo-heartbeat \
  --schedule-expression 'rate(1 minute)' \
  --flexible-time-window '{"Mode": "OFF"}' \
  --target "{\"RoleArn\": \"$SCHED_ROLE_ARN\", \"Arn\": \"$FUNCTION_ARN\", \"Input\": \"{\\\"source\\\": \\\"scheduler\\\"}\"}"
```
:::

> [!CHECK]
> The **Schedules** page lists `demo-heartbeat` with status **Enabled**. After two or three minutes, **Explore table items** (or the `scan` command from Step 6) shows new `heartbeat#...` items with `source` = `scheduler`, about one per minute. Unlike the Lambda trigger in Step 5, EventBridge Scheduler uses its own **execution role** to call the function.

### Step 8: Stop the schedule

Do this as soon as you have seen a few heartbeat items.

:::console
1. In **EventBridge** → **Scheduler** → **Schedules**, select `demo-heartbeat`, choose **Delete** and confirm.
:::

:::cli
```bash
aws scheduler delete-schedule --name demo-heartbeat
aws scheduler list-schedules --query 'Schedules[].Name'
```
:::

> [!CHECK]
> `demo-heartbeat` no longer appears in the list, and no new heartbeat items arrive in the table after a couple of minutes.

## Cleanup

Delete in this order. Some resources (the bucket notification and the function's resource-based policy) disappear with their parent and need no separate step.

- [ ] **EventBridge schedule** `demo-heartbeat`, if not already deleted in Step 8. CLI: `aws scheduler delete-schedule --name demo-heartbeat`
- [ ] **Scheduler execution role**: the role the console created for the schedule (find it in IAM **Roles** by searching for "Scheduler") or `demo-heartbeat-scheduler-role` from the CLI. For a console-created role, note any **Customer managed** policy on its **Permissions** tab before you delete the role, then delete that policy under **Policies** (deleting a role does not delete managed policies). CLI: `aws iam delete-role-policy --role-name demo-heartbeat-scheduler-role --policy-name invoke-demo-upload-indexer && aws iam delete-role --role-name demo-heartbeat-scheduler-role`
- [ ] **S3 bucket** and its objects (this also removes the event notification): console **General purpose buckets** → select the bucket → **Empty**, enter the bucket name, choose **Empty**; then select it again → **Delete**, enter the bucket name, choose **Delete bucket**. CLI: `aws s3 rm "s3://$BUCKET" --recursive && aws s3 rb "s3://$BUCKET"`
- [ ] **Lambda function** `demo-upload-indexer` (this also removes its resource-based policy): **Actions** → **Delete**, type `confirm`, choose **Delete**. CLI: `aws lambda delete-function --function-name demo-upload-indexer`
- [ ] **DynamoDB table** `demo-uploads`: console **Tables** → select it → **Delete** and confirm. CLI: `aws dynamodb delete-table --table-name demo-uploads`
- [ ] **CloudWatch log group** `/aws/lambda/demo-upload-indexer`: **Log groups** → select → **Actions** → **Delete log group(s)** → **Delete**. CLI: `aws logs delete-log-group --log-group-name /aws/lambda/demo-upload-indexer`
- [ ] **Lambda execution role** (`demo-upload-indexer-role` or the console-generated `demo-upload-indexer-role-xxxx`) with its inline policy `put-demo-uploads`: IAM console → **Roles** → select it → **Delete**, enter the role name, choose **Delete**. If the Lambda console created the role, also delete any **Customer managed** policy that was attached to it (check its **Permissions** tab first, then IAM → **Policies**). CLI (for the CLI-created role):

```bash
aws iam delete-role-policy --role-name demo-upload-indexer-role --policy-name put-demo-uploads
aws iam detach-role-policy --role-name demo-upload-indexer-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
aws iam delete-role --role-name demo-upload-indexer-role
```

- [ ] **Local files** in CloudShell: `rm -rf ~/demo-indexer`
- [ ] Final check: no `demo-` bucket, table, function or schedule remains in the Region you used, and **Billing and Cost Management** → **Bills** shows no unexpected charges the next day.

## Progress checklist

- [ ] Step 1: DynamoDB table created
- [ ] Step 2: S3 bucket created
- [ ] Step 3: function deployed with environment variable and least-privilege write policy
- [ ] Step 4: manual test wrote a heartbeat item
- [ ] Step 5: S3 trigger added (resource-based policy + bucket notification)
- [ ] Step 6: uploads indexed in DynamoDB
- [ ] Step 7: EventBridge Scheduler invoked the function every minute
- [ ] Step 8: schedule deleted
- [ ] Cleanup completed
