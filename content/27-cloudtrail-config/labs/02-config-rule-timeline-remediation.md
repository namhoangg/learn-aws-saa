---
id: 27-cloudtrail-config-lab-02
title: Detect and auto-remediate open SSH with an AWS Config rule
objective: Turn on AWS Config for security groups only, add the restricted-ssh managed rule, read a non-compliant resource's timeline (configuration, compliance and CloudTrail events), then fix it with an SSM Automation remediation, first manually and then automatically with retries.
estimatedTime: 60 minutes
cost: "About USD 0.10 to 0.25 if cleaned up the same day: a few dozen configuration items at USD 0.003 each, a few dozen rule evaluations at USD 0.001 each, a handful of SSM Automation steps at USD 0.002 each and a few KB in S3. AWS Config has no free tier."
freeTier: no
services: [config, systems-manager, security-groups, ec2, s3, iam, cloudtrail]
---

> [!COST] What this lab bills
> AWS Config charges for every **configuration item** it records (USD 0.003 each with continuous recording) and every **rule evaluation** (USD 0.001 each for the first 100,000 a month), and Systems Manager Automation charges USD 0.002 per runbook step (us-east-1 prices, October 2026). To keep this to cents, the lab records **only two resource types** (security groups and rule compliance history) instead of everything. Do the Cleanup the same day: a recorder left on keeps recording, and recording all resource types in a busy account can cost dollars per day.

You will reproduce the most common Config scenario on the exam: a security group gets SSH opened to the whole internet, Config flags it as `NON_COMPLIANT` within minutes, you see exactly what changed and who did it on the resource timeline, and an SSM Automation runbook removes the bad rule, first when you ask, then on its own.

> [!WARNING] Remediation changes every non-compliant security group in the Region
> When you turn on **automatic** remediation (Step 7), Config runs the runbook against **every** security group in the Region that allows SSH from `0.0.0.0/0` or `::/0`, not only the test group. The runbook documentation says its step removes the rules allowing TCP port 22 from each group it is given, so check those groups' other SSH rules too. If you rely on such a rule (for example to reach a lab instance), either do this lab in a Region you do not otherwise use, or stop after Step 6 (manual remediation of the test group only).

## Prerequisites

- An AWS account and an IAM user or role with permissions for AWS Config, IAM, S3, EC2 and Systems Manager (for example `AdministratorAccess` in a learning account).
- AWS Config **not yet set up** in the chosen Region (open the Config console: if it shows a dashboard instead of **Get started** / **1-click setup**, Config is already on; in that case skip Step 1, note that your existing recorder must record `AWS::EC2::SecurityGroup`, and skip the recorder items in Cleanup).
- One Region for the whole lab, for example `us-east-1`.
- For the CLI tabs: **AWS CloudShell** in the same Region, or a Bash shell with AWS CLI v2 configured. Keep one terminal open; later commands reuse shell variables.

## Steps

### Step 1: Set up AWS Config for security groups only

Use **Get started** (not **1-click setup**, which records all resource types) so you control what is recorded.

:::console
1. Open the **AWS Config** console in your lab Region and choose **Get started**.
2. In **Recording method**, choose **Specific resource types**. Add **AWS EC2 SecurityGroup** with frequency **Continuous**, then add **AWS Config ResourceCompliance** (also **Continuous**; it stores the compliance history shown on the timeline).
3. In **Data governance**, keep the default **Data retention period** (7 years) and, for **IAM role for AWS Config**, choose **Use an existing AWS Config service-linked role** (the recommended option) rather than a role from your account. If the console says the role `AWSServiceRoleForConfig` does not exist, run the `create-service-linked-role` line from the CLI tab in CloudShell, then reload the page.
4. In **Delivery method**, choose **Create a bucket** and enter a unique **S3 bucket name**, for example `config-lab-<account-id>`. Leave the **Amazon SNS topic** option unselected.
5. Choose **Next**. On **Rules**, do not add any rule yet; choose **Next**.
6. On **Review**, choose **Confirm**.
:::

:::cli
```bash
REGION=$(aws configure get region); REGION=${REGION:-$AWS_REGION}
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
CFG_BUCKET="config-lab-${ACCOUNT_ID}-${REGION}"

# Service-linked role (an error saying it already exists is fine)
aws iam create-service-linked-role --aws-service-name config.amazonaws.com || true
SLR_ARN="arn:aws:iam::${ACCOUNT_ID}:role/aws-service-role/config.amazonaws.com/AWSServiceRoleForConfig"

# Delivery bucket and the policy Config needs to write to it
if [ "$REGION" = "us-east-1" ]; then
  aws s3api create-bucket --bucket "$CFG_BUCKET"
else
  aws s3api create-bucket --bucket "$CFG_BUCKET" --create-bucket-configuration LocationConstraint="$REGION"
fi
cat > cfg-bucket-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {"Sid": "AWSConfigBucketPermissionsCheck", "Effect": "Allow",
     "Principal": {"Service": "config.amazonaws.com"}, "Action": "s3:GetBucketAcl",
     "Resource": "arn:aws:s3:::${CFG_BUCKET}",
     "Condition": {"StringEquals": {"AWS:SourceAccount": "${ACCOUNT_ID}"}}},
    {"Sid": "AWSConfigBucketExistenceCheck", "Effect": "Allow",
     "Principal": {"Service": "config.amazonaws.com"}, "Action": "s3:ListBucket",
     "Resource": "arn:aws:s3:::${CFG_BUCKET}",
     "Condition": {"StringEquals": {"AWS:SourceAccount": "${ACCOUNT_ID}"}}},
    {"Sid": "AWSConfigBucketDelivery", "Effect": "Allow",
     "Principal": {"Service": "config.amazonaws.com"}, "Action": "s3:PutObject",
     "Resource": "arn:aws:s3:::${CFG_BUCKET}/AWSLogs/${ACCOUNT_ID}/Config/*",
     "Condition": {"StringEquals": {"s3:x-amz-acl": "bucket-owner-full-control",
                                    "AWS:SourceAccount": "${ACCOUNT_ID}"}}}
  ]
}
EOF
aws s3api put-bucket-policy --bucket "$CFG_BUCKET" --policy file://cfg-bucket-policy.json

# Recorder: only security groups and compliance history, continuous recording
aws configservice put-configuration-recorder \
  --configuration-recorder name=default,roleARN="$SLR_ARN" \
  --recording-group '{"allSupported":false,"includeGlobalResourceTypes":false,
    "resourceTypes":["AWS::EC2::SecurityGroup","AWS::Config::ResourceCompliance"],
    "recordingStrategy":{"useOnly":"INCLUSION_BY_RESOURCE_TYPES"}}'

aws configservice put-delivery-channel \
  --delivery-channel name=default,s3BucketName="$CFG_BUCKET"

aws configservice start-configuration-recorder --configuration-recorder-name default
```
:::

> [!CHECK]
> **Settings** → **Customer managed recorder** shows recording **on** with the two resource types and continuous frequency. After a few minutes, **Resources** (resource inventory) lists the security groups of the Region, including each VPC's `default` group. In the CLI, `aws configservice describe-configuration-recorder-status` shows `"recording": true` and `"lastStatus": "SUCCESS"`.

### Step 2: Create a security group with SSH open to the world

The group is not attached to anything, so opening port 22 exposes nothing; it only gives Config something to flag.

:::console
1. Open the **EC2** console → **Security Groups** → **Create security group**.
2. **Security group name** `config-lab-sg`, **Description** `Config lab`, default VPC.
3. **Inbound rules** → **Add rule**: **Type** **SSH**, **Source** **Anywhere-IPv4** (`0.0.0.0/0`).
4. Choose **Create security group** and note its ID (`sg-...`).
:::

:::cli
```bash
SG_ID=$(aws ec2 create-security-group --group-name config-lab-sg \
  --description "Config lab" --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$SG_ID" \
  --protocol tcp --port 22 --cidr 0.0.0.0/0
echo "Security group: $SG_ID"
```
:::

> [!CHECK]
> The group shows one inbound rule, SSH from `0.0.0.0/0`. Within a few minutes it also appears in the Config **Resources** list (resource type `EC2 SecurityGroup`).

### Step 3: Add the restricted-ssh managed rule

`restricted-ssh` (identifier `INCOMING_SSH_DISABLED`) is `NON_COMPLIANT` when a security group allows inbound SSH from `0.0.0.0/0` or `::/0`. It runs on configuration changes and periodically.

:::console
1. In the Config console choose **Rules** → **Add rule**.
2. On **Specify rule type**, keep **Add AWS managed rule**, search for `restricted-ssh`, select it and choose **Next**.
3. On **Configure rule**, keep the name `restricted-ssh`. Look at the **Evaluation mode** and trigger settings (configuration changes on `AWS::EC2::SecurityGroup`, plus a periodic frequency) and keep the defaults. Choose **Next**.
4. On **Review and create**, choose **Save**.
:::

:::cli
```bash
cat > restricted-ssh.json <<'EOF'
{
  "ConfigRuleName": "restricted-ssh",
  "Description": "Security groups must not allow SSH from 0.0.0.0/0 or ::/0",
  "Scope": {"ComplianceResourceTypes": ["AWS::EC2::SecurityGroup"]},
  "Source": {"Owner": "AWS", "SourceIdentifier": "INCOMING_SSH_DISABLED"}
}
EOF
aws configservice put-config-rule --config-rule file://restricted-ssh.json
```
:::

> [!CHECK]
> After a minute or two (refresh the page), the rule's **Compliance** shows **Noncompliant** and the **Resources in scope** list, filtered to **Noncompliant**, includes `config-lab-sg`. CLI: `aws configservice get-compliance-details-by-config-rule --config-rule-name restricted-ssh --compliance-types NON_COMPLIANT --query 'EvaluationResults[].EvaluationResultIdentifier.EvaluationResultQualifier.ResourceId'` returns your group ID. Write down every other group ID in that list: those are the groups automatic remediation would change in Step 7.

### Step 4: Read the resource timeline

This is the view that answers "what changed, when, who did it, and did it break a rule" in one place.

:::console
1. In the Config console choose **Resources**, filter on resource type **AWS EC2 SecurityGroup**, and open `config-lab-sg`.
2. Choose **Resource Timeline**.
3. Use the filters: **Configuration events** shows the configuration item with the inbound rule; **Compliance events** shows the change to `NON_COMPLIANT` for `restricted-ssh`; **CloudTrail events** shows `CreateSecurityGroup` and `AuthorizeSecurityGroupIngress` with your user name.
4. Expand a configuration change to see the before/after difference of `ipPermissions`.
:::

:::cli
```bash
# Configuration history of the group, newest first
aws configservice get-resource-config-history \
  --resource-type AWS::EC2::SecurityGroup --resource-id "$SG_ID" \
  --query 'configurationItems[].{captured:configurationItemCaptureTime,status:configurationItemStatus}' \
  --output table

# Compliance of this one resource
aws configservice get-compliance-details-by-resource \
  --resource-type AWS::EC2::SecurityGroup --resource-id "$SG_ID" \
  --query 'EvaluationResults[].{rule:EvaluationResultIdentifier.EvaluationResultQualifier.ConfigRuleName,result:ComplianceType}'
```
:::

> [!CHECK]
> The timeline shows the three kinds of events lined up in time: the API calls (CloudTrail), the resulting configuration (Config) and the compliance verdict. The CLI shows at least one configuration item (`ResourceDiscovered` or `OK`) and `NON_COMPLIANT` for `restricted-ssh`.

### Step 5: Create the role that remediation uses

Systems Manager Automation needs a role it can assume to change the security group. The role trusts `ssm.amazonaws.com` and may only describe security groups and revoke ingress rules.

:::console
1. Open the **IAM** console → **Roles** → **Create role**.
2. **Trusted entity type**: **AWS service**. **Service or use case**: **Systems Manager**, use case **Systems Manager**. Choose **Next**.
3. Do not attach a managed policy; choose **Next**. **Role name** `ConfigLabRemediationRole`. Choose **Create role**.
4. Open the new role → **Add permissions** → **Create inline policy** → **JSON**, paste the policy below, choose **Next**, name it `RevokeSshIngress`, and choose **Create policy**.
5. Copy the role **ARN**.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["ec2:DescribeSecurityGroups", "ec2:RevokeSecurityGroupIngress"],
      "Resource": "*"
    }
  ]
}
```
:::

:::cli
```bash
cat > ssm-trust.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{"Effect": "Allow", "Principal": {"Service": "ssm.amazonaws.com"}, "Action": "sts:AssumeRole"}]
}
EOF
cat > revoke-ssh.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{"Effect": "Allow",
                 "Action": ["ec2:DescribeSecurityGroups", "ec2:RevokeSecurityGroupIngress"],
                 "Resource": "*"}]
}
EOF
REM_ROLE_ARN=$(aws iam create-role --role-name ConfigLabRemediationRole \
  --assume-role-policy-document file://ssm-trust.json --query Role.Arn --output text)
aws iam put-role-policy --role-name ConfigLabRemediationRole \
  --policy-name RevokeSshIngress --policy-document file://revoke-ssh.json
echo "Remediation role: $REM_ROLE_ARN"
```
:::

> [!CHECK]
> The role's **Trust relationships** tab shows `ssm.amazonaws.com` as the trusted principal and **Permissions** lists the inline policy `RevokeSshIngress`.

### Step 6: Attach a manual remediation and fix the test group

Manual remediation lets you choose exactly which resource to fix.

:::console
1. In the Config console open **Rules** → `restricted-ssh` → **Actions** → **Manage remediation**.
2. Choose **Manual remediation**. For **Remediation action**, choose `AWS-DisableIncomingSSHOnPort22`.
3. For **Resource ID parameter**, choose `SecurityGroupIds` (Config passes each non-compliant group's ID into this parameter).
4. Under **Parameters**, set **AutomationAssumeRole** to the ARN of `ConfigLabRemediationRole`. Choose **Save**.
5. Back on the rule page, in **Resources in scope**, select only `config-lab-sg` and choose **Remediate**.
:::

:::cli
```bash
cat > remediation-manual.json <<EOF
[
  {
    "ConfigRuleName": "restricted-ssh",
    "TargetType": "SSM_DOCUMENT",
    "TargetId": "AWS-DisableIncomingSSHOnPort22",
    "Parameters": {
      "AutomationAssumeRole": {"StaticValue": {"Values": ["${REM_ROLE_ARN}"]}},
      "SecurityGroupIds": {"ResourceValue": {"Value": "RESOURCE_ID"}}
    },
    "Automatic": false
  }
]
EOF
aws configservice put-remediation-configurations \
  --remediation-configurations file://remediation-manual.json

# Remediate only the test group
aws configservice start-remediation-execution --config-rule-name restricted-ssh \
  --resource-keys resourceType=AWS::EC2::SecurityGroup,resourceId="$SG_ID"

# Watch the execution
aws configservice describe-remediation-execution-status --config-rule-name restricted-ssh \
  --resource-keys resourceType=AWS::EC2::SecurityGroup,resourceId="$SG_ID" \
  --query 'RemediationExecutionStatuses[].{state:State,updated:LastUpdatedTime}'
```
:::

> [!CHECK]
> The remediation status shown for the group on the rule page changes to a successful execution (CLI state `SUCCEEDED`). In EC2, `config-lab-sg` no longer has the SSH rule. A few minutes later the rule re-evaluates the change and shows the group as **Compliant**. In **Systems Manager** → **Automation** you can open the execution of `AWS-DisableIncomingSSHOnPort22` and see the step that called `RevokeSecurityGroupIngress`. If the execution failed with an access error, check the role ARN and its trust policy.

### Step 7: Switch to automatic remediation with retries

Read the warning at the top of the lab and the list of non-compliant groups you noted in Step 3 before you do this step.

:::console
1. Open **Rules** → `restricted-ssh` → **Actions** → **Manage remediation**.
2. Choose **Automatic remediation**. Keep `AWS-DisableIncomingSSHOnPort22`, the **Resource ID parameter** `SecurityGroupIds` and the **AutomationAssumeRole** value.
3. Under the retry settings, enter **5** retries within **300** seconds. Choose **Save**.
4. In the EC2 console, add the inbound rule **SSH** from **Anywhere-IPv4** to `config-lab-sg` again.
5. Wait a few minutes, then refresh the security group's inbound rules.
:::

:::cli
```bash
cat > remediation-auto.json <<EOF
[
  {
    "ConfigRuleName": "restricted-ssh",
    "TargetType": "SSM_DOCUMENT",
    "TargetId": "AWS-DisableIncomingSSHOnPort22",
    "Parameters": {
      "AutomationAssumeRole": {"StaticValue": {"Values": ["${REM_ROLE_ARN}"]}},
      "SecurityGroupIds": {"ResourceValue": {"Value": "RESOURCE_ID"}}
    },
    "Automatic": true,
    "MaximumAutomaticAttempts": 5,
    "RetryAttemptSeconds": 300
  }
]
EOF
aws configservice put-remediation-configurations \
  --remediation-configurations file://remediation-auto.json

# Re-open SSH to the world and let Config fix it
aws ec2 authorize-security-group-ingress --group-id "$SG_ID" \
  --protocol tcp --port 22 --cidr 0.0.0.0/0

# After a few minutes the rule should be gone again
aws ec2 describe-security-groups --group-ids "$SG_ID" --query 'SecurityGroups[0].IpPermissions'
```
:::

> [!CHECK]
> Without you doing anything, the SSH rule disappears again within a few minutes (`IpPermissions` becomes `[]`), the resource timeline shows a new `NON_COMPLIANT` event followed by `COMPLIANT`, and **Systems Manager** → **Automation** shows a second execution. This is detect-and-correct, not prevention: the bad rule existed for a few minutes. Blocking it outright would need an IAM policy or SCP.

## Cleanup

Delete in this order, in the lab Region. Deleting the recorder is CLI-only, so use CloudShell for that item.

- [ ] **Remediation configuration** on `restricted-ssh`: Config console → **Rules** → `restricted-ssh` → **Actions** → **Manage remediation** → remove the action (CLI: `aws configservice delete-remediation-configuration --config-rule-name restricted-ssh`).
- [ ] **Config rule** `restricted-ssh`: **Rules** → select → **Actions** → **Delete rule** (CLI: `aws configservice delete-config-rule --config-rule-name restricted-ssh`).
- [ ] **Security group** `config-lab-sg`: EC2 console → **Security Groups** → select → **Actions** → **Delete security groups** (CLI: `aws ec2 delete-security-group --group-id "$SG_ID"`).
- [ ] **Stop the configuration recorder**: Config console → **Settings** → **Customer managed recorder** → **Stop recording** → **Confirm** (CLI: `aws configservice stop-configuration-recorder --configuration-recorder-name default`).
- [ ] **Delivery channel** (CLI only): `aws configservice delete-delivery-channel --delivery-channel-name default`.
- [ ] **Configuration recorder** (CLI only): `aws configservice delete-configuration-recorder --configuration-recorder-name default`.
- [ ] **Retention configuration**, only if you set a custom data retention period in Step 1: `aws configservice delete-retention-configuration --retention-configuration-name default`.
- [ ] **S3 bucket** `config-lab-...`: S3 console → select → **Empty** → **Delete** (CLI: `aws s3 rb "s3://${CFG_BUCKET}" --force`).
- [ ] **IAM role** `ConfigLabRemediationRole`: IAM console → **Roles** → select → **Delete** (CLI: `aws iam delete-role-policy --role-name ConfigLabRemediationRole --policy-name RevokeSshIngress`, then `aws iam delete-role --role-name ConfigLabRemediationRole`).
- [ ] **Local files**: `rm -f cfg-bucket-policy.json restricted-ssh.json ssm-trust.json revoke-ssh.json remediation-manual.json remediation-auto.json`.
- [ ] The service-linked role `AWSServiceRoleForConfig` costs nothing and can stay. If you want it gone, delete it in IAM after the recorder is deleted.
- [ ] Final check: the Config console shows **Get started** again (no recorder) in the lab Region, `aws configservice describe-configuration-recorders` returns an empty list, and **Billing and Cost Management** → **Bills** shows only cents for **Config** and **Systems Manager**.

## Progress checklist

- [ ] Step 1: Config recording security groups and compliance history to S3
- [ ] Step 2: Test security group with SSH open to 0.0.0.0/0 created
- [ ] Step 3: `restricted-ssh` rule added and the group shown as non-compliant
- [ ] Step 4: Resource timeline read (configuration, compliance and CloudTrail events)
- [ ] Step 5: Remediation role for SSM Automation created
- [ ] Step 6: Manual remediation fixed the test group
- [ ] Step 7: Automatic remediation with retries fixed it again without help
- [ ] Cleanup done: remediation, rule, group, recorder, delivery channel, bucket and role deleted
