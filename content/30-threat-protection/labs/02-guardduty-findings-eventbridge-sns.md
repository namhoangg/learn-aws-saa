---
id: 30-threat-protection-lab-02
title: Turn GuardDuty findings into email alerts with EventBridge and SNS
objective: Enable Amazon GuardDuty, see which data sources it reads without any logging setup, and build an EventBridge rule that emails you only when a cryptocurrency-mining finding appears, tested with sample findings.
estimatedTime: 35 minutes
cost: "USD 0 while the GuardDuty 30-day free trial for this Region is running. EventBridge does not charge for AWS service events on the default bus, and the first 1,000 SNS email notifications each month are free. If this Region's GuardDuty trial is already used up, GuardDuty bills by the volume of events and logs it analyses, which is small in a quiet lab account, until you disable it in Cleanup."
freeTier: partial
services: [guardduty, eventbridge, sns]
---

> [!COST]
> GuardDuty is not part of Always Free: it offers a **30-day free trial per Region** the first time you enable it there (most protection plans included). After the trial, it charges for the CloudTrail events, VPC Flow Log and DNS log volume and protection-plan data it analyses. Sample findings cost nothing. To stop all GuardDuty charges, **disable** (or suspend) it in the Cleanup section.

> [!WARNING]
> If GuardDuty is already enabled in this account and Region, for example by your organization's security team through a delegated administrator, skip Step 1 and do **not** disable GuardDuty during Cleanup. Use a personal sandbox account if you are unsure.

## Prerequisites

- An AWS account with permissions for GuardDuty, EventBridge and SNS (administrator access in a sandbox account is simplest).
- An email address you can open during the lab, to confirm the SNS subscription and receive alerts.
- One Region for everything; the examples use `us-east-1`. GuardDuty, EventBridge rules and SNS topics are all Regional.
- For the CLI tabs: AWS CLI v2 in a Bash shell. **AWS CloudShell** works without setup. Keep the same terminal open, because later commands reuse shell variables.

## Steps

### Step 1: Enable GuardDuty

:::console
1. Open the **GuardDuty** console in your chosen Region.
2. Select the **Amazon GuardDuty - All features** option and choose **Get started**.
3. On the **Welcome to GuardDuty** page, read the service terms and choose **Enable GuardDuty**.
4. In the navigation pane choose **Settings** and note the **Detector ID**; the CLI calls it `detectorId`.
:::

:::cli
```bash
REGION=${AWS_REGION:-$(aws configure get region)}
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
aws guardduty create-detector --enable
DETECTOR_ID=$(aws guardduty list-detectors --query 'DetectorIds[0]' --output text)
echo "$DETECTOR_ID"
```
:::

> [!CHECK]
> The console opens the **Summary** page (probably with no findings yet) and `list-detectors` returns one 32-character detector ID. GuardDuty also created the service-linked role `AWSServiceRoleForAmazonGuardDuty` in IAM.

### Step 2: See what GuardDuty is watching

Notice what you did **not** have to do: you created no CloudTrail trail, no VPC flow log and no Route 53 query logging. GuardDuty reads its own independent copy of CloudTrail management events, VPC Flow Logs and DNS logs as soon as it is enabled, and your own logging settings are left untouched.

:::console
1. In the navigation pane, look at the protection plans listed under the GuardDuty menu (for example **S3 Protection**, **EKS Protection**, **Runtime Monitoring**, **Malware Protection**, **RDS Protection**, **Lambda Protection**).
2. Open two or three of them and read their status. On a first-time enable, GuardDuty turns on the plans available in the Region (S3, EKS, RDS and Lambda Protection, and Malware Protection for EC2 scans triggered by findings) and includes them in the free trial. **Runtime Monitoring** needs a security agent and stays off until you enable it; Malware Protection for S3 and for AWS Backup are configured per bucket or backup plan and are not on by default. The CLI `create-detector` call in Step 1 follows the same defaults.
:::

:::cli
```bash
aws guardduty get-detector --detector-id "$DETECTOR_ID" \
  --query 'Features[].[Name,Status]' --output table
```
:::

> [!CHECK]
> You can see which optional features are `ENABLED` and which are `DISABLED`. The foundational sources (CloudTrail management events, VPC Flow Logs, DNS logs) have no switch at all: they are always analysed while the detector is enabled.

### Step 3: Create an SNS topic with an email subscription

:::console
1. Open the **Amazon SNS** console and choose **Topics** → **Create topic**.
2. For **Type** choose **Standard**, for **Name** enter `guardduty-lab-alerts`, and choose **Create topic**.
3. In the topic's **Subscriptions** section choose **Create subscription**. For **Protocol** choose **Email**, for **Endpoint** enter your email address, and choose **Create subscription**.
4. Open the email from AWS Notifications and choose **Confirm subscription**.
:::

:::cli
```bash
TOPIC_ARN=$(aws sns create-topic --name guardduty-lab-alerts --query TopicArn --output text)
aws sns subscribe --topic-arn "$TOPIC_ARN" --protocol email \
  --notification-endpoint you@example.com    # replace with your address
# After clicking the link in the confirmation email:
aws sns list-subscriptions-by-topic --topic-arn "$TOPIC_ARN" \
  --query 'Subscriptions[].[Protocol,SubscriptionArn]' --output text
```
:::

> [!CHECK]
> The subscription status changes from **Pending confirmation** to **Confirmed** (the CLI shows a full subscription ARN instead of `PendingConfirmation`).

### Step 4: Create an EventBridge rule for crypto-mining findings only

Every GuardDuty finding reaches the default EventBridge bus as an event with `source` `aws.guardduty` and `detail-type` `GuardDuty Finding`. Instead of mailing yourself every finding, you will match only finding types that begin with `CryptoCurrency:`, the family GuardDuty uses for mining activity.

Event pattern used in this step:

```json
{
  "source": ["aws.guardduty"],
  "detail-type": ["GuardDuty Finding"],
  "detail": {
    "type": [{ "prefix": "CryptoCurrency:" }]
  }
}
```

:::console
1. Open the **Amazon EventBridge** console. In the navigation pane, under **Buses**, choose **Rules**, then **Create rule**.
2. **Name**: `gd-crypto-to-sns`. **Event bus**: **default**, with **Enable the rule on the selected event bus** turned on. **Rule type**: **Rule with an event pattern**. Choose **Next**.
3. For **Event source** choose **AWS events or EventBridge partner events**. Under **Event pattern**, set **Creation method** to **Custom pattern (JSON editor)** and paste the pattern above. Choose **Next**.
4. For **Target types** choose **AWS service**; for **Select a target** choose **SNS topic**; if a **Target location** choice appears, keep the topic in this account; for **Topic** choose `guardduty-lab-alerts`.
5. Expand **Additional settings**. For **Configure target input** choose **Input transformer**, then **Configure input transformer**.
6. In **Input path**, paste:

   ```json
   {"severity":"$.detail.severity","type":"$.detail.type","region":"$.region","title":"$.detail.title","id":"$.detail.id"}
   ```

7. In **Template**, paste this single line (keeping the message inside one JSON key avoids invalid JSON when a finding title contains unusual characters):

   ```json
   {"message":"GuardDuty severity <severity> finding <type> in <region>: <title>. Open https://console.aws.amazon.com/guardduty/home?region=<region>#/findings?search=id%3D<id>"}
   ```

8. Choose **Confirm**, then **Next**, skip tags with **Next**, review, and choose **Create rule**. The console adds a statement to the topic's access policy so that EventBridge may publish to it.
:::

:::cli
```bash
cat > pattern.json <<'EOF'
{
  "source": ["aws.guardduty"],
  "detail-type": ["GuardDuty Finding"],
  "detail": { "type": [{ "prefix": "CryptoCurrency:" }] }
}
EOF
RULE_ARN=$(aws events put-rule --name gd-crypto-to-sns \
  --event-pattern file://pattern.json --query RuleArn --output text)

# Allow this rule (and only this rule) to publish to the topic.
cat > topic-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "AllowEventBridgeRule",
    "Effect": "Allow",
    "Principal": { "Service": "events.amazonaws.com" },
    "Action": "sns:Publish",
    "Resource": "$TOPIC_ARN",
    "Condition": { "ArnEquals": { "aws:SourceArn": "$RULE_ARN" } }
  }]
}
EOF
aws sns set-topic-attributes --topic-arn "$TOPIC_ARN" \
  --attribute-name Policy --attribute-value file://topic-policy.json

cat > targets.json <<'EOF'
[
  {
    "Id": "email-security-team",
    "Arn": "TOPIC_ARN_PLACEHOLDER",
    "InputTransformer": {
      "InputPathsMap": {
        "severity": "$.detail.severity",
        "type": "$.detail.type",
        "region": "$.region",
        "title": "$.detail.title"
      },
      "InputTemplate": "{\"message\": \"GuardDuty severity <severity> finding <type> in <region>: <title>\"}"
    }
  }
]
EOF
sed -i "s|TOPIC_ARN_PLACEHOLDER|$TOPIC_ARN|" targets.json
aws events put-targets --rule gd-crypto-to-sns --targets file://targets.json
aws events list-targets-by-rule --rule gd-crypto-to-sns --query 'Targets[].Arn'
```
:::

> [!CHECK]
> The rule `gd-crypto-to-sns` shows **State: Enabled**, its event pattern contains the `prefix` filter, and its only target is the `guardduty-lab-alerts` topic.

### Step 5: Generate sample findings and receive the alert

Sample findings are fake findings with placeholder resources. They flow through EventBridge exactly like real ones, which makes them perfect for testing alert rules.

:::console
1. In the GuardDuty console choose **Settings** and, under **Sample findings**, choose **Generate sample findings**. GuardDuty creates one sample of every finding type it supports.
2. Choose **Findings**. The sample findings appear on the **Current findings** page with titles starting with **[SAMPLE]**.
3. Check your inbox. Because the rule matches only `CryptoCurrency:` types, you receive a handful of emails (one per cryptocurrency finding type) rather than one per finding type.
:::

:::cli
```bash
# Single quotes matter: an unquoted or double-quoted ! triggers Bash history expansion.
aws guardduty create-sample-findings --detector-id "$DETECTOR_ID" \
  --finding-types 'CryptoCurrency:EC2/BitcoinTool.B!DNS' 'UnauthorizedAccess:EC2/SSHBruteForce'
```
With the CLI you create just two samples: one that matches the rule and one that does not.
:::

> [!CHECK]
> Within a few minutes an email arrives whose text names a `CryptoCurrency:` finding type, for example `CryptoCurrency:EC2/BitcoinTool.B!DNS` (an instance querying a domain linked to cryptocurrency activity). No email arrives for `UnauthorizedAccess:EC2/SSHBruteForce` or any other non-crypto type, even though GuardDuty shows them in the findings list.

### Step 6: Investigate and archive the findings

:::console
1. On the **Findings** page, choose the sample `CryptoCurrency:EC2/BitcoinTool.B!DNS` finding. In the details panel, read its **Severity**, the **Resource affected** section (a placeholder instance) and the action that triggered it.
2. Choose the finding ID at the top of the panel to view the full JSON; this is the same document that EventBridge received as the event `detail`.
3. Use the filter bar to add a criterion such as **Finding type** equals the crypto type, then remove it again.
4. Select the check box at the top of the list to select all sample findings, open **Actions** and choose **Archive**. Archived findings disappear from **Current** and stay visible under **Archived**.
:::

:::cli
```bash
IDS=$(aws guardduty list-findings --detector-id "$DETECTOR_ID" \
  --finding-criteria '{"Criterion":{"type":{"Eq":["CryptoCurrency:EC2/BitcoinTool.B!DNS","UnauthorizedAccess:EC2/SSHBruteForce"]}}}' \
  --query 'FindingIds' --output text)
aws guardduty get-findings --detector-id "$DETECTOR_ID" --finding-ids $IDS \
  --query 'Findings[].[Type,Severity,Title]' --output table
aws guardduty archive-findings --detector-id "$DETECTOR_ID" --finding-ids $IDS
```
:::

> [!CHECK]
> The crypto finding carries the default **High** severity (score band 7.0 to 8.9). The SSH brute-force type is rated **Low** when your instance is the target of the attack and **High** when your instance is the one attacking others, so its sample's severity depends on the resource role shown in the details. After archiving, the **Current findings** list no longer shows those samples.

> [!TIP]
> For automatic remediation you would add a second target to the same rule: a Lambda function that reads `detail.resource.instanceDetails.instanceId` from the event and swaps the instance's security groups for an isolation group. Same trigger, different action.

## Cleanup

- [ ] **EventBridge rule `gd-crypto-to-sns`**: EventBridge console → **Rules** → select the rule → **Delete** and confirm. CLI: `aws events remove-targets --rule gd-crypto-to-sns --ids email-security-team` then `aws events delete-rule --name gd-crypto-to-sns`.
- [ ] **SNS topic `guardduty-lab-alerts`** (deleting the topic also deletes its email subscription): SNS console → **Topics** → select → **Delete**, type `delete me`, choose **Delete**. CLI: `aws sns delete-topic --topic-arn "$TOPIC_ARN"`.
- [ ] **GuardDuty detector** (skip if GuardDuty was enabled before this lab): GuardDuty console → **Settings** → in the **Suspend GuardDuty** section choose **Disable GuardDuty** → **Confirm**. Disabling deletes all findings and settings in this Region; choose **Suspend GuardDuty** instead if you want to keep them (no charges while suspended). CLI: `aws guardduty delete-detector --detector-id "$DETECTOR_ID"` (or suspend with `aws guardduty update-detector --detector-id "$DETECTOR_ID" --no-enable`).
- [ ] **Service-linked roles** `AWSServiceRoleForAmazonGuardDuty` and `AWSServiceRoleForAmazonGuardDutyMalwareProtection` (optional, they cost nothing): after GuardDuty is disabled you may delete them in the IAM console → **Roles**.
- [ ] **Local files** (CLI path): `rm pattern.json topic-policy.json targets.json`.
- [ ] **Final check**: `aws guardduty list-detectors` returns an empty list (if you disabled it), `aws events list-rules --name-prefix gd-crypto` returns nothing, and `aws sns list-topics` no longer shows `guardduty-lab-alerts`. Later, **Billing and Cost Management** → **Bills** shows no GuardDuty charges for this Region.

## Progress checklist

- [ ] Step 1: Enabled GuardDuty and noted the detector ID
- [ ] Step 2: Confirmed GuardDuty needed no trail or flow log, and reviewed which protection plans are on
- [ ] Step 3: Created and confirmed the email subscription on `guardduty-lab-alerts`
- [ ] Step 4: Created `gd-crypto-to-sns` with a prefix filter and an input transformer
- [ ] Step 5: Generated sample findings and received alerts only for crypto-mining types
- [ ] Step 6: Investigated a finding's details and JSON, then archived the samples
- [ ] Cleanup done
