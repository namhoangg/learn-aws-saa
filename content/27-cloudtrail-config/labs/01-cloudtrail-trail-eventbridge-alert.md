---
id: 27-cloudtrail-config-lab-01
title: Investigate with Event history, archive with a trail and alert on security group changes
objective: Look up recent API activity in CloudTrail Event history, create a multi-Region trail with log file validation that archives events to S3, and build an EventBridge rule that emails you whenever someone adds an inbound rule to a security group.
estimatedTime: 50 minutes (plus an optional check about an hour later)
cost: "Effectively free: the first trail copy of management events has no CloudTrail charge, the few MB of log files in S3 cost well under USD 0.01, EventBridge delivers AWS service events at no charge and SNS email is inside the Always Free 1,000 emails per month. A second trail that also logs management events would be billed (USD 2.00 per 100,000 events)."
freeTier: yes
services: [cloudtrail, s3, eventbridge, sns, ec2, security-groups]
---

You will play both sides of an audit. First you use **Event history**, which every account has without any setup, to find out who did something. Then you build what a real account needs: a **trail** that keeps every management event in S3 beyond the 90-day window, with **log file integrity validation**, and an **EventBridge rule** that turns one specific API call (`AuthorizeSecurityGroupIngress`) into an email within a few minutes.

> [!WARNING] Check for an existing trail first
> Only the **first** copy of management events is free. If the **Trails** page of the CloudTrail console already lists a trail that logs management events (for example one created by AWS Control Tower or an earlier lab), a second trail is billed at USD 2.00 per 100,000 management events. In that case skip Step 2, use the existing trail for Steps 3 and 7, and do not delete it in Cleanup.

## Prerequisites

- An AWS account and an IAM user or role with permissions for CloudTrail, S3, EventBridge, SNS and EC2 (for example the `AdministratorAccess` managed policy in a learning account).
- One Region for the whole lab, for example `us-east-1`. The security group, the EventBridge rule and the SNS topic must all be in the same Region, because CloudTrail sends EC2 events to EventBridge in the Region where the call happened.
- An email address you can read during the lab.
- For the CLI tabs: **AWS CloudShell** in the same Region (AWS CLI v2 and GNU `date` preinstalled), or a Bash shell with AWS CLI v2 configured. Keep one terminal open; later commands reuse shell variables.

## Steps

### Step 1: Look up recent activity in Event history

Event history is on by default and shows the last 90 days of management events in the current Region. Find your own recent sign-in or any recent write call.

:::console
1. Open the **CloudTrail** console and choose **Event history** in the navigation pane.
2. Notice the default filter: **Read only** is set to **false**, so only write events are listed.
3. From the **Lookup attributes** list choose **Event name**, and enter `ConsoleLogin`.
4. Choose an event to open it. Read the **Event record** JSON: find `userIdentity`, `sourceIPAddress`, `eventTime` and `responseElements`.
5. Clear the filter (**X**) and set the time range to **1 day**. With no attribute filter, the list now shows every recent call in this Region, reads included; set **Read only** back to `false` if you only want changes.
:::

:::cli
```bash
REGION=$(aws configure get region); REGION=${REGION:-$AWS_REGION}
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "Region: $REGION  Account: $ACCOUNT_ID"

# Last 5 console sign-ins recorded in this Region
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=ConsoleLogin \
  --max-items 5 \
  --query 'Events[].{time:EventTime,user:Username,event:EventName}' --output table
```
:::

> [!CHECK]
> You see at least one `ConsoleLogin` event with your user name (if you signed in to the console in the last 90 days). The event record shows your source IP address and whether MFA was used (`additionalEventData.MFAUsed`). If the list is empty, IAM sign-in events may be recorded in another Region: try `us-east-1`, where events for global services are recorded.

### Step 2: Create a multi-Region trail with log file validation

The trail delivers every management event from all enabled Regions to a new S3 bucket. You turn off SSE-KMS so that the lab does not create a KMS key (a customer managed key costs USD 1 per month); the log files are still encrypted with SSE-S3.

:::console
1. In the CloudTrail console choose **Trails** → **Create trail**.
2. For **Trail name**, enter `ct-lab-trail`.
3. For **Storage location**, choose **Create new S3 bucket**. Accept the generated bucket name or enter a unique one, for example `ct-lab-logs-<account-id>`. Write the name down.
4. For **Log file SSE-KMS encryption**, clear **Enabled**. (The log files are then encrypted with SSE-S3.)
5. Under **Additional settings**, make sure **Log file validation** is **Enabled**. Leave **SNS notification delivery** disabled.
6. Leave **CloudWatch Logs** disabled. Choose **Next**.
7. On **Choose log events**, keep **Management events** selected with **API activity** **Read** and **Write** both checked. Do not select **Data events**, **Insights events** or **Network activity events** (they are billed). Choose **Next**.
8. On **Review and create**, check the settings and choose **Create trail**.
:::

:::cli
```bash
BUCKET="ct-lab-logs-${ACCOUNT_ID}-${REGION}"
TRAIL=ct-lab-trail

# Create the bucket (us-east-1 does not accept a LocationConstraint)
if [ "$REGION" = "us-east-1" ]; then
  aws s3api create-bucket --bucket "$BUCKET"
else
  aws s3api create-bucket --bucket "$BUCKET" \
    --create-bucket-configuration LocationConstraint="$REGION"
fi

# Bucket policy that lets only this trail write its log files
cat > ct-bucket-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AWSCloudTrailAclCheck",
      "Effect": "Allow",
      "Principal": {"Service": "cloudtrail.amazonaws.com"},
      "Action": "s3:GetBucketAcl",
      "Resource": "arn:aws:s3:::${BUCKET}",
      "Condition": {"StringEquals": {"aws:SourceArn": "arn:aws:cloudtrail:${REGION}:${ACCOUNT_ID}:trail/${TRAIL}"}}
    },
    {
      "Sid": "AWSCloudTrailWrite",
      "Effect": "Allow",
      "Principal": {"Service": "cloudtrail.amazonaws.com"},
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::${BUCKET}/AWSLogs/${ACCOUNT_ID}/*",
      "Condition": {"StringEquals": {
        "s3:x-amz-acl": "bucket-owner-full-control",
        "aws:SourceArn": "arn:aws:cloudtrail:${REGION}:${ACCOUNT_ID}:trail/${TRAIL}"
      }}
    }
  ]
}
EOF
aws s3api put-bucket-policy --bucket "$BUCKET" --policy file://ct-bucket-policy.json

# Multi-Region trail with digest files; the CLI default would be single-Region
TRAIL_ARN=$(aws cloudtrail create-trail --name "$TRAIL" --s3-bucket-name "$BUCKET" \
  --is-multi-region-trail --enable-log-file-validation \
  --query TrailARN --output text)

# CLI-created trails do not log until you start them (the console starts them for you)
aws cloudtrail start-logging --name "$TRAIL"
echo "Trail: $TRAIL_ARN"
```
:::

> [!CHECK]
> The **Trails** page lists `ct-lab-trail` with **Multi-region trail** = **Yes** and **Status** = **Logging**. In the CLI, `aws cloudtrail get-trail-status --name ct-lab-trail` shows `"IsLogging": true`, and `aws cloudtrail describe-trails --trail-name-list ct-lab-trail` shows `"IsMultiRegionTrail": true` and `"LogFileValidationEnabled": true`.

### Step 3: Find the first log files in S3

CloudTrail delivers log files on average about 5 minutes after the API calls. While you wait, continue with Step 4 and come back here.

:::console
1. Open the **S3** console and choose the trail's bucket.
2. Open the prefixes `AWSLogs/` → your account ID → `CloudTrail/` → a Region → year → month → day.
3. Select a `.json.gz` file and choose **Download** (or **Open**) to look at the compressed JSON. Each file holds a `Records` array of events.
4. Go back to `AWSLogs/<account-id>/` and notice the separate `CloudTrail-Digest/` prefix (the first digest file appears about an hour after logging starts).
:::

:::cli
```bash
# List the first delivered log files (repeat after a few minutes if empty)
aws s3 ls "s3://${BUCKET}/AWSLogs/${ACCOUNT_ID}/CloudTrail/" --recursive | head -20

# Show which event names are in the newest file
KEY=$(aws s3 ls "s3://${BUCKET}/AWSLogs/${ACCOUNT_ID}/CloudTrail/" --recursive \
  | sort | tail -1 | awk '{print $4}')
aws s3 cp "s3://${BUCKET}/${KEY}" - | gunzip | grep -o '"eventName":"[A-Za-z]*"' | sort | uniq -c
```
:::

> [!CHECK]
> You see folders for several Regions (a multi-Region trail writes one folder per Region with activity), and the decompressed file shows event names such as `CreateTrail`, `StartLogging` or `PutBucketPolicy` from the setup you just did.

### Step 4: Create an SNS topic and subscribe your email

:::console
1. Open the **Amazon SNS** console and choose **Topics** → **Create topic**.
2. For **Type**, choose **Standard**. For **Name**, enter `ct-lab-alerts`. Leave encryption off (EventBridge cannot publish to a topic encrypted with the AWS managed SNS key). Choose **Create topic**.
3. On the topic page choose **Create subscription**. For **Protocol** choose **Email**, for **Endpoint** enter your email address, and choose **Create subscription**.
4. Open the email from AWS Notifications and choose **Confirm subscription**.
:::

:::cli
```bash
TOPIC_ARN=$(aws sns create-topic --name ct-lab-alerts --query TopicArn --output text)
aws sns subscribe --topic-arn "$TOPIC_ARN" --protocol email \
  --notification-endpoint you@example.com   # replace with your address, then confirm the email
```
:::

> [!CHECK]
> The subscription's **Status** changes from **Pending confirmation** to **Confirmed** after you click the link in the email (`aws sns list-subscriptions-by-topic --topic-arn "$TOPIC_ARN"` shows a real subscription ARN instead of `PendingConfirmation`).

### Step 5: Create the EventBridge rule for security group ingress changes

The rule matches the CloudTrail event for `AuthorizeSecurityGroupIngress` on the **default** event bus and sends the event to the topic.

:::console
1. Open the **Amazon EventBridge** console, choose **Rules** → **Create rule**, and choose **Advanced Builder**.
2. For **Name**, enter `ct-lab-sg-ingress`. For **Event bus**, choose **AWS default event bus**. For **Rule type**, choose **Rule with an event pattern**. Choose **Next**.
3. For **Event source**, choose **AWS events or EventBridge partner events**.
4. Under **Creation method**, choose **Custom pattern (JSON editor)** and paste the pattern below. Choose **Next**.
5. For **Target type**, choose **AWS service**. For **Select a target**, choose **SNS topic**, and for **Topic** choose `ct-lab-alerts`. If an **Execution role** option appears, keep its default. Either way the console grants EventBridge permission to publish, normally by adding a statement to the topic's access policy. Choose **Next**.
6. Skip tags (**Next**), review, and choose **Create rule**.

```json
{
  "source": ["aws.ec2"],
  "detail-type": ["AWS API Call via CloudTrail"],
  "detail": {
    "eventSource": ["ec2.amazonaws.com"],
    "eventName": ["AuthorizeSecurityGroupIngress"]
  }
}
```
:::

:::cli
```bash
cat > sg-pattern.json <<'EOF'
{
  "source": ["aws.ec2"],
  "detail-type": ["AWS API Call via CloudTrail"],
  "detail": {
    "eventSource": ["ec2.amazonaws.com"],
    "eventName": ["AuthorizeSecurityGroupIngress"]
  }
}
EOF
RULE_ARN=$(aws events put-rule --name ct-lab-sg-ingress \
  --event-pattern file://sg-pattern.json --state ENABLED \
  --query RuleArn --output text)

# Allow this rule (and only this rule) to publish to the topic, keeping owner access
cat > topic-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "OwnerFullAccess",
      "Effect": "Allow",
      "Principal": {"AWS": "arn:aws:iam::${ACCOUNT_ID}:root"},
      "Action": "sns:*",
      "Resource": "${TOPIC_ARN}"
    },
    {
      "Sid": "AllowEventBridgeRule",
      "Effect": "Allow",
      "Principal": {"Service": "events.amazonaws.com"},
      "Action": "sns:Publish",
      "Resource": "${TOPIC_ARN}",
      "Condition": {"ArnEquals": {"aws:SourceArn": "${RULE_ARN}"}}
    }
  ]
}
EOF
aws sns set-topic-attributes --topic-arn "$TOPIC_ARN" \
  --attribute-name Policy --attribute-value file://topic-policy.json

aws events put-targets --rule ct-lab-sg-ingress --targets "Id"="sns-alerts","Arn"="$TOPIC_ARN"
```
:::

> [!CHECK]
> The rule `ct-lab-sg-ingress` shows **Status** **Enabled** on the default event bus, with one target, the SNS topic. `aws events list-targets-by-rule --rule ct-lab-sg-ingress` returns the topic ARN.

### Step 6: Trigger the rule by adding an inbound rule

Create a throwaway security group in the default VPC and allow SSH from a single documentation address (`203.0.113.10/32`, a range reserved for examples), so nothing is actually exposed.

:::console
1. Open the **EC2** console and choose **Security Groups** → **Create security group**.
2. For **Security group name**, enter `ct-lab-sg`; for **Description**, enter `CloudTrail lab`; keep the default VPC.
3. Under **Inbound rules**, choose **Add rule**: **Type** **SSH**, **Source** **Custom**, `203.0.113.10/32`.
4. Choose **Create security group**.
:::

:::cli
```bash
SG_ID=$(aws ec2 create-security-group --group-name ct-lab-sg \
  --description "CloudTrail lab" --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$SG_ID" \
  --protocol tcp --port 22 --cidr 203.0.113.10/32
echo "Security group: $SG_ID"
```
:::

> [!CHECK]
> Within a few minutes you receive an email whose body is the JSON event: `detail.eventName` is `AuthorizeSecurityGroupIngress`, `detail.userIdentity` is you, and `detail.requestParameters` contains the group ID and `203.0.113.10/32`. If no email arrives after 10 minutes, check that the trail is **Logging**, that the rule and the security group are in the same Region, and that the topic's **Access policy** allows `events.amazonaws.com` to publish.

### Step 7: Find the same call in Event history and in the trail

:::console
1. In the CloudTrail console, open **Event history**, choose **Lookup attributes** → **Event name**, and enter `AuthorizeSecurityGroupIngress`.
2. Open the event and compare it with the email: same event ID, same identity and parameters.
3. Choose **Resource name** as the filter instead and enter your security group ID to see every recorded call that referenced the group (`CreateSecurityGroup` and `AuthorizeSecurityGroupIngress`).
:::

:::cli
```bash
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=ResourceName,AttributeValue="$SG_ID" \
  --query 'Events[].{time:EventTime,user:Username,event:EventName}' --output table
```
:::

> [!CHECK]
> Both `CreateSecurityGroup` and `AuthorizeSecurityGroupIngress` appear with your user name. The same events will also be inside the trail's log files in S3 (Step 3) a few minutes later, where they stay after Event history forgets them at 90 days.

### Step 8 (optional, about an hour later): Validate log file integrity

Digest files are delivered once an hour, so wait at least an hour after Step 2. The command checks every log file against the signed digests.

:::console
1. Log file validation has no console view. In the CloudTrail console, open **Trails** → `ct-lab-trail` and confirm that **Log file validation** shows **Enabled**.
2. Open **CloudShell** from the console toolbar and run the CLI command from the other tab.
:::

:::cli
```bash
TRAIL_ARN=$(aws cloudtrail describe-trails --trail-name-list ct-lab-trail \
  --query 'trailList[0].TrailARN' --output text)
aws cloudtrail validate-logs --trail-arn "$TRAIL_ARN" \
  --start-time "$(date -u -d '-2 hours' +%Y-%m-%dT%H:%M:%SZ)" --verbose
```
:::

> [!CHECK]
> The summary reports digest files and log files as **valid** (for example "2/2 digest files valid, 14/14 log files valid"). If you delete or edit a log file in the bucket and run the command again, it reports that file as **INVALID** or not found; that is exactly how tampering is detected.

## Cleanup

Delete in this order (same Region as the lab). Skip the trail and bucket items if you reused an existing trail.

- [ ] **EventBridge rule** `ct-lab-sg-ingress`: EventBridge console → **Rules** → select → **Delete** (CLI: `aws events remove-targets --rule ct-lab-sg-ingress --ids sns-alerts` then `aws events delete-rule --name ct-lab-sg-ingress`).
- [ ] **Execution role**, only if the console created one in Step 5 (the rule's **Targets** tab names it): IAM console → **Roles** → select it → **Delete** (CLI: list its policies with `aws iam list-role-policies --role-name <role>` and `aws iam list-attached-role-policies --role-name <role>`, remove them with `aws iam delete-role-policy` or `aws iam detach-role-policy`, then `aws iam delete-role --role-name <role>`).
- [ ] **SNS topic** `ct-lab-alerts` and its email subscription: SNS console → **Topics** → select → **Delete** (CLI: `aws sns delete-topic --topic-arn "$TOPIC_ARN"`; this also removes the subscription).
- [ ] **Security group** `ct-lab-sg`: EC2 console → **Security Groups** → select → **Actions** → **Delete security groups** (CLI: `aws ec2 delete-security-group --group-id "$SG_ID"`).
- [ ] **Trail** `ct-lab-trail`: CloudTrail console → **Trails** → select → **Delete** (CLI: `aws cloudtrail delete-trail --name ct-lab-trail`). Delete the trail before the bucket, otherwise CloudTrail keeps trying (and charging) to deliver to a missing bucket for up to 30 days.
- [ ] **S3 bucket** with the log and digest files: S3 console → select the bucket → **Empty** → then **Delete** (CLI: `aws s3 rb "s3://${BUCKET}" --force`).
- [ ] **Local files** created by the CLI tab: `rm -f ct-bucket-policy.json sg-pattern.json topic-policy.json`.
- [ ] Final check: the CloudTrail **Trails** page no longer lists `ct-lab-trail`, the S3 bucket is gone, and **Billing and Cost Management** → **Bills** shows no CloudTrail charges for the month.

## Progress checklist

- [ ] Step 1: Found a recent event in Event history and read its identity and source IP
- [ ] Step 2: Created a multi-Region trail with log file validation, logging to S3
- [ ] Step 3: Found delivered log files for several Regions in the bucket
- [ ] Step 4: Created the SNS topic and confirmed the email subscription
- [ ] Step 5: Created the EventBridge rule on `AuthorizeSecurityGroupIngress`
- [ ] Step 6: Added an inbound rule and received the alert email
- [ ] Step 7: Found the same calls in Event history by resource name
- [ ] Step 8 (optional): Validated log file integrity with digest files
- [ ] Cleanup done: rule (and its execution role, if any), topic, security group, trail and bucket deleted
