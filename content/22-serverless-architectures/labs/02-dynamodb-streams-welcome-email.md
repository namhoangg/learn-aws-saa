---
id: 22-serverless-architectures-lab-02
title: Send welcome emails with DynamoDB Streams, Lambda and SES
objective: Build the MyBlog subscriber flow, a DynamoDB table with a stream, a Lambda trigger filtered to new items and an SES email to your verified address, then prove that updating a subscriber does not send a second email.
estimatedTime: 40 minutes
cost: "Under USD 0.01: two or three SES emails at USD 0.16 per 1,000 (Essentials plan, the default for new SES accounts) or USD 0.10 per 1,000 (a-la-carte pricing), a few on-demand DynamoDB writes, and Lambda invocations and stream reads that fall inside free allowances. Covered by Free Tier credits on accounts created on or after 15 July 2025."
freeTier: partial
services: [dynamodb, dynamodb-streams, lambda, ses, iam-roles, cloudwatch-logs]
---

> [!COST]
> Amazon SES has no Always Free email allowance any more. Outbound email costs USD 0.16 per 1,000 messages on the **Essentials** plan {{updated: SES now sells Essentials, Pro and Enterprise plans; new SES accounts, and Region pairs with no SES usage since June 2025, start on Essentials from 21 July 2026. You can switch to a-la-carte pricing at USD 0.10 per 1,000}}, or USD 0.10 per 1,000 on a-la-carte pricing, so this lab's two or three emails cost a tiny fraction of a cent either way. DynamoDB on-demand writes cost USD 0.625 per million, Lambda's monthly free requests cover the invocations, and stream reads made by a Lambda trigger are not charged. Nothing is billed by the hour, but delete everything at the end anyway.

This lab builds the welcome-email side flow from the MyBlog case study. The sign-up API is simulated with `put-item`; everything after that is event driven: DynamoDB writes a stream record, a Lambda event source mapping picks up only `INSERT` records, and the function sends the email through SES using permissions from its execution role.

## Prerequisites

- An AWS account and an IAM user or role that can manage DynamoDB, Lambda, IAM roles, Amazon SES and CloudWatch Logs.
- **AWS CloudShell** (AWS CLI v2, `jq` and `zip` preinstalled) in a Region where Amazon SES is available, such as `us-east-1` or `eu-west-1`. Use the same Region for every step.
- An email address you can read. New SES accounts are in the **sandbox**, which only delivers to verified addresses, so you will send from and to this same address.

## Steps

### Step 1: Verify your email address in SES

:::console
1. Open the **Amazon SES** console (if a set-up wizard opens for a new account, you can leave it and use the navigation pane). In the navigation pane, under **Configuration**, choose **Identities**.
2. Choose **Create identity**, select **Email address**, enter your address and choose **Create identity**.
3. Open the message from `no-reply-aws@amazon.com` (check spam) and click the link within 24 hours.
4. In CloudShell, store the address and some account details:

```bash
EMAIL="you@example.com"      # your verified address
REGION=${AWS_REGION:-$(aws configure get region)}
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
```
:::

:::cli
```bash
EMAIL="you@example.com"      # replace with your address
REGION=${AWS_REGION:-$(aws configure get region)}
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

aws sesv2 create-email-identity --email-identity "$EMAIL"
# click the link in the verification email, then:
aws sesv2 get-email-identity --email-identity "$EMAIL" \
  --query VerifiedForSendingStatus
```
:::

> [!CHECK]
> The identity shows **Identity status: Verified** in the console, and the CLI prints `true`. If your account is still in the sandbox, the **Account dashboard** shows a banner saying so; that is fine for this lab.

### Step 2: Create the subscribers table with a stream

:::console
1. Open the **DynamoDB** console, choose **Tables**, then **Create table**.
2. Enter the **Table name** `blog-subscribers` and the **Partition key** `email` (type **String**).
3. For **Table settings**, choose **Customize settings**, set **Read/write capacity settings** to **On-demand** (the same mode the CLI path and the cost note use), and choose **Create table**. Wait until the status is **Active**.
4. Open the table, choose the **Exports and streams** tab, and under **DynamoDB stream details** choose **Turn on**.
5. Select **New image** and choose **Turn on stream**.
6. In CloudShell, store the stream ARN (Step 5's CLI path uses it):

```bash
STREAM_ARN=$(aws dynamodb describe-table --table-name blog-subscribers \
  --query Table.LatestStreamArn --output text)
```
:::

:::cli
```bash
aws dynamodb create-table --table-name blog-subscribers \
  --attribute-definitions AttributeName=email,AttributeType=S \
  --key-schema AttributeName=email,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --stream-specification StreamEnabled=true,StreamViewType=NEW_IMAGE

aws dynamodb wait table-exists --table-name blog-subscribers

STREAM_ARN=$(aws dynamodb describe-table --table-name blog-subscribers \
  --query Table.LatestStreamArn --output text)
echo "$STREAM_ARN"
```
:::

> [!CHECK]
> The table is **Active** and the **Exports and streams** tab shows the stream turned on with view type **New image**. The stream ARN ends in `/stream/<timestamp>`. Stream records are kept for 24 hours.

### Step 3: Create the Lambda execution role

The function needs to read the stream and write logs (the AWS managed policy `AWSLambdaDynamoDBExecutionRole` covers both) and to send email (an inline policy for `ses:SendEmail`). No access keys appear anywhere in the code.

:::console
1. Open the **IAM** console, choose **Roles**, then **Create role**.
2. For **Trusted entity type** choose **AWS service**, for **Use case** choose **Lambda**, then **Next**.
3. Search for and select **AWSLambdaDynamoDBExecutionRole**, then choose **Next**.
4. Enter the **Role name** `blog-welcome-email-role` and choose **Create role**.
5. Open the role, choose **Add permissions**, then **Create inline policy**, switch to **JSON**, and paste the policy below with your Region and account ID. Choose **Next**, name it `ses-send-welcome`, and choose **Create policy**.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ses:SendEmail",
      "Resource": "arn:aws:ses:REGION:ACCOUNT_ID:identity/*"
    }
  ]
}
```

6. In CloudShell, store the role ARN (Step 4's CLI path uses it):

```bash
ROLE_ARN=$(aws iam get-role --role-name blog-welcome-email-role --query Role.Arn --output text)
```
:::

:::cli
```bash
cat > lambda-trust.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Service": "lambda.amazonaws.com"},
    "Action": "sts:AssumeRole"
  }]
}
EOF

ROLE_ARN=$(aws iam create-role --role-name blog-welcome-email-role \
  --assume-role-policy-document file://lambda-trust.json \
  --query Role.Arn --output text)

aws iam attach-role-policy --role-name blog-welcome-email-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaDynamoDBExecutionRole

jq -n --arg r "arn:aws:ses:$REGION:$ACCOUNT_ID:identity/*" '{
  Version: "2012-10-17",
  Statement: [{Effect: "Allow", Action: "ses:SendEmail", Resource: $r}]
}' > ses-send.json

aws iam put-role-policy --role-name blog-welcome-email-role \
  --policy-name ses-send-welcome --policy-document file://ses-send.json
```
:::

> [!CHECK]
> The role's **Permissions** tab lists `AWSLambdaDynamoDBExecutionRole` (managed) and `ses-send-welcome` (inline), and its **Trust relationships** tab trusts `lambda.amazonaws.com`. The SES resource covers all identities in the Region because, in the sandbox, SES also checks permission on the verified recipient identity.

### Step 4: Create the welcome-email function

The code skips anything that is not an `INSERT` as a safety net, so even without the filter in Step 5 an update would never send a second email.

```python
import os

import boto3

ses = boto3.client("sesv2")
SENDER = os.environ["SENDER_EMAIL"]


def lambda_handler(event, context):
    for record in event["Records"]:
        if record["eventName"] != "INSERT":
            print(f"Skipping {record['eventName']} record")
            continue
        item = record["dynamodb"]["NewImage"]
        to_address = item["email"]["S"]
        name = item.get("name", {}).get("S", "there")
        ses.send_email(
            FromEmailAddress=SENDER,
            Destination={"ToAddresses": [to_address]},
            Content={
                "Simple": {
                    "Subject": {"Data": "Welcome to MyBlog"},
                    "Body": {"Text": {"Data": f"Hi {name}, thanks for subscribing to MyBlog."}},
                }
            },
        )
        print(f"Welcome email sent to {to_address}")
    return {"records": len(event["Records"])}
```

:::console
1. Open the **Lambda** console, choose **Create function**, and select **Author from scratch**.
2. Enter the **Function name** `blog-welcome-email` and choose the **Runtime** **Python 3.14**.
3. Expand **Change default execution role**, choose **Use an existing role**, and pick `blog-welcome-email-role`. Choose **Create function**.
4. On the **Code** tab, replace the contents of `lambda_function.py` with the code above and choose **Deploy**.
5. Choose the **Configuration** tab, then **Environment variables** → **Edit** → **Add environment variable**. Enter the key `SENDER_EMAIL` and your verified address as the value, then **Save**.
:::

:::cli
```bash
mkdir -p welcome
cat > welcome/lambda_function.py <<'EOF'
import os

import boto3

ses = boto3.client("sesv2")
SENDER = os.environ["SENDER_EMAIL"]


def lambda_handler(event, context):
    for record in event["Records"]:
        if record["eventName"] != "INSERT":
            print(f"Skipping {record['eventName']} record")
            continue
        item = record["dynamodb"]["NewImage"]
        to_address = item["email"]["S"]
        name = item.get("name", {}).get("S", "there")
        ses.send_email(
            FromEmailAddress=SENDER,
            Destination={"ToAddresses": [to_address]},
            Content={
                "Simple": {
                    "Subject": {"Data": "Welcome to MyBlog"},
                    "Body": {"Text": {"Data": f"Hi {name}, thanks for subscribing to MyBlog."}},
                }
            },
        )
        print(f"Welcome email sent to {to_address}")
    return {"records": len(event["Records"])}
EOF
(cd welcome && zip -q ../welcome.zip lambda_function.py)

sleep 10   # a newly created role can take a few seconds to become usable by Lambda

aws lambda create-function --function-name blog-welcome-email \
  --runtime python3.14 --handler lambda_function.lambda_handler \
  --role "$ROLE_ARN" --zip-file fileb://welcome.zip --timeout 15 \
  --environment "Variables={SENDER_EMAIL=$EMAIL}"

aws lambda wait function-active-v2 --function-name blog-welcome-email
```
:::

> [!CHECK]
> The function page shows runtime **Python 3.14**, the role `blog-welcome-email-role`, and the environment variable `SENDER_EMAIL`. The function has no triggers yet.

### Step 5: Connect the stream to the function with an INSERT filter

The event filter makes the event source mapping drop `MODIFY` and `REMOVE` records before they reach the function, so you are not billed for invocations that would do nothing.

:::console
1. On the function page, under **Function overview**, choose **Add trigger**.
2. Choose **DynamoDB** as the source and select the table `blog-subscribers`.
3. Set **Batch size** to `10` and **Starting position** to **Latest**.
4. Expand **Additional settings**. Under **Filter criteria**, choose **Add** and enter `{ "eventName": ["INSERT"] }`.
5. Choose **Add**. Wait until the trigger's state is **Enabled** (about a minute).
6. In CloudShell, store the trigger's UUID (the CLI cleanup uses it):

```bash
ESM_UUID=$(aws lambda list-event-source-mappings --function-name blog-welcome-email \
  --query 'EventSourceMappings[0].UUID' --output text)
```
:::

:::cli
```bash
ESM_UUID=$(aws lambda create-event-source-mapping \
  --function-name blog-welcome-email \
  --event-source-arn "$STREAM_ARN" \
  --starting-position LATEST --batch-size 10 \
  --filter-criteria '{"Filters": [{"Pattern": "{\"eventName\": [\"INSERT\"]}"}]}' \
  --query UUID --output text)

# repeat until it prints Enabled
aws lambda get-event-source-mapping --uuid "$ESM_UUID" --query State --output text
```
:::

> [!CHECK]
> **Configuration** → **Triggers** lists the DynamoDB trigger with state **Enabled** and the filter `{"eventName": ["INSERT"]}`.

> [!NOTE] Why the filter can use eventName
> A Lambda filter pattern can match a record's **metadata** fields as well as its data. For DynamoDB, `dynamodb` is the key that holds the item data (`Keys`, `NewImage`, `OldImage`), while top-level fields such as `eventName` and `userIdentity` are metadata. The DynamoDB guide names `eventName` as a metadata property in its filtering tutorial and filters on `userIdentity` to catch TTL deletes, so `{"eventName": ["INSERT"]}` drops `MODIFY` and `REMOVE` records before any invocation.

### Step 6: Add a subscriber and receive the email

:::console
1. In the **DynamoDB** console, open `blog-subscribers` and choose **Explore table items**, then **Create item**.
2. Set `email` to your verified address. Choose **Add new attribute** → **String**, name it `name` and enter `Sam`.
3. Choose **Create item**.
4. Wait about 30 seconds, then open your inbox (and spam folder). In the Lambda console, choose **Monitor** → **View CloudWatch logs** to see the log stream.
:::

:::cli
```bash
aws dynamodb put-item --table-name blog-subscribers \
  --item "{\"email\": {\"S\": \"$EMAIL\"}, \"name\": {\"S\": \"Sam\"}}"

sleep 30
aws logs tail /aws/lambda/blog-welcome-email --since 10m
```
:::

> [!CHECK]
> An email with the subject **Welcome to MyBlog** arrives, and the log shows `Welcome email sent to ...` followed by a `REPORT` line. If the log shows `AccessDenied` for `ses:SendEmail`, recheck the inline policy's Region and account ID; if it shows `MessageRejected` about an unverified address, finish Step 1.

### Step 7: Update the subscriber and confirm no second email

:::console
1. In **Explore table items**, select the item, change `name` to `Samantha` and choose **Save changes**.
2. Wait about 30 seconds and look at the inbox and the function's CloudWatch logs again.
:::

:::cli
```bash
aws dynamodb update-item --table-name blog-subscribers \
  --key "{\"email\": {\"S\": \"$EMAIL\"}}" \
  --update-expression "SET #n = :n" \
  --expression-attribute-names '{"#n": "name"}' \
  --expression-attribute-values '{":n": {"S": "Samantha"}}'

sleep 30
aws logs tail /aws/lambda/blog-welcome-email --since 2m
```
:::

> [!CHECK]
> No second email arrives, and the log shows **no new invocation**: the event filter dropped the `MODIFY` record. If you see `Skipping MODIFY record` instead, the trigger is running without the filter (check under **Configuration** → **Triggers** that the filter criteria were saved) and the code guard did the work. Either way, exactly one welcome email was sent per subscriber.

## Cleanup

Delete in this order (the CLI lines reuse the variables from your CloudShell session).

- [ ] **Event source mapping** (the DynamoDB trigger): console **Lambda** → function → **Configuration** → **Triggers** → select it → **Delete**. CLI: `aws lambda delete-event-source-mapping --uuid "$ESM_UUID"`
- [ ] **Lambda function** `blog-welcome-email`: console **Actions** → **Delete**, type `confirm`. CLI: `aws lambda delete-function --function-name blog-welcome-email`
- [ ] **CloudWatch log group** `/aws/lambda/blog-welcome-email`: console **CloudWatch** → **Log groups** → select → **Actions** → **Delete log group(s)**. CLI: `aws logs delete-log-group --log-group-name /aws/lambda/blog-welcome-email`
- [ ] **IAM role** `blog-welcome-email-role`: console **IAM** → **Roles** → select → **Delete**. CLI:

```bash
aws iam delete-role-policy --role-name blog-welcome-email-role --policy-name ses-send-welcome
aws iam detach-role-policy --role-name blog-welcome-email-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaDynamoDBExecutionRole
aws iam delete-role --role-name blog-welcome-email-role
```

- [ ] **DynamoDB table** `blog-subscribers` (its stream goes with it): console **DynamoDB** → **Tables** → select → **Delete**. CLI: `aws dynamodb delete-table --table-name blog-subscribers`
- [ ] **SES email identity**: console **SES** → **Configuration** → **Identities** → select → **Delete**. CLI: `aws sesv2 delete-email-identity --email-identity "$EMAIL"`
- [ ] **Local files** in CloudShell: `rm -rf welcome welcome.zip lambda-trust.json ses-send.json`
- [ ] **Final check**: `aws lambda list-event-source-mappings --function-name blog-welcome-email` returns an error that the function does not exist, `aws dynamodb list-tables` no longer shows `blog-subscribers`, and **Billing and Cost Management** → **Bills** shows no new running charges.

## Progress checklist

- [ ] Step 1: email address verified in SES
- [ ] Step 2: blog-subscribers table with a New image stream
- [ ] Step 3: execution role with stream, logs and ses:SendEmail permissions
- [ ] Step 4: blog-welcome-email function deployed with SENDER_EMAIL
- [ ] Step 5: DynamoDB trigger enabled with the INSERT filter
- [ ] Step 6: welcome email received for a new subscriber
- [ ] Step 7: update produced no second email
- [ ] Cleanup complete and final check passed
