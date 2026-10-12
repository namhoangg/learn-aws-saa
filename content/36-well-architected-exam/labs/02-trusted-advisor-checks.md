---
id: 36-well-architected-exam-lab-02
title: Find and fix a risky security group with AWS Trusted Advisor
objective: Explore the Trusted Advisor checks your support plan includes, trigger the free "Security Groups - Specific Ports Unrestricted" check with a deliberately open test security group, fix the rule, confirm the check turns green, and compare the service limits checks with Service Quotas.
estimatedTime: 30 minutes
cost: "USD 0. Trusted Advisor core checks are included with every support plan, and security groups are free. No instances are launched."
freeTier: yes
services: [trusted-advisor, security-groups, ec2, cli-sdk, cloudshell]
---

This lab works on the free Basic Support plan. You create one security group that allows SSH from anywhere, attach it to nothing, and let Trusted Advisor find it. If your account already has a Business Support+, Enterprise Support or Unified Operations plan, everything still works and you will also see the extra categories and API results.

> [!WARNING]
> The test security group opens port 22 to the whole internet. Do not attach it to any instance, and delete it in the Cleanup section. Do this lab in an account where you are allowed to create security groups.

## Prerequisites

- An AWS account and a user or role that can view and refresh Trusted Advisor checks (an administrator role, or an IAM policy allowing `trustedadvisor:Describe*`, `trustedadvisor:Get*`, `trustedadvisor:List*` and `trustedadvisor:RefreshCheck`, plus `support:DescribeTrustedAdvisorChecks` for the Support API call in Step 1), permissions to create, edit and delete EC2 security groups, and read access to Service Quotas (`servicequotas:List*`, `servicequotas:Get*`).
- A Region with a **default VPC**; the steps use `us-east-1`. Trusted Advisor itself is global and checks every Region.
- For the CLI tabs: AWS CLI v2 or AWS CloudShell, in one terminal session (later commands reuse shell variables).

## Steps

### Step 1: Tour the Trusted Advisor console

:::console
1. Open the **Trusted Advisor** console at `https://console.aws.amazon.com/trustedadvisor/home`. The **Trusted Advisor Recommendations** page opens.
2. Look at the summary: **Action recommended** (red), **Investigation recommended** (yellow) and **Checks with excluded items** (gray), plus **Checks summary**, **Potential monthly savings** and **Recent changes**.
3. In the navigation pane open each category in turn: **Cost optimization**, **Performance**, **Security**, **Fault tolerance**, **Service limits** and **Operational excellence**. Note which categories show checks and which tell you that a higher support plan is needed.
4. Open **Security** and find the checks your plan includes. On Basic Support expect **Amazon EBS Public Snapshots**, **Amazon RDS Public Snapshots**, **Amazon S3 Bucket Permissions**, **MFA on root account** and **Security Groups - Specific Ports Unrestricted** (the STS global endpoint check sits under **Fault tolerance**).
:::

:::cli
```bash
# The Trusted Advisor API and the AWS Support API need Business Support+,
# Enterprise Support or Unified Operations. On Basic Support both calls
# return an access or subscription error, which is the point of this step.
aws trustedadvisor list-checks --pillar security --region us-east-1 \
  --query 'checkSummaries[].name' --output text

aws support describe-trusted-advisor-checks --language en \
  --region us-east-1 --query 'checks[?category==`security`].name'
```
:::

> [!CHECK]
> On Basic Support the console shows the core security checks and all **Service limits** checks, while cost optimization, performance and operational excellence checks are locked. The CLI calls fail with an error that names the missing support plan (for example `AccessDeniedException` or `SubscriptionRequiredException`). On a paid plan the calls list the check names.

### Step 2: Create a deliberately open security group

:::console
1. Open the **EC2** console in **US East (N. Virginia)** and choose **Security Groups** under **Network & Security**, then **Create security group**.
2. Set **Security group name** to `ta-lab-open-ssh`, **Description** to `Trusted Advisor lab - delete me`, and keep the default **VPC**.
3. Under **Inbound rules** choose **Add rule**, set **Type** to **SSH** and **Source** to **Anywhere-IPv4** (`0.0.0.0/0`).
4. Choose **Create security group** and note its ID (`sg-...`).
:::

:::cli
```bash
export AWS_REGION=us-east-1
VPC_ID=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true \
  --query 'Vpcs[0].VpcId' --output text)

SG_ID=$(aws ec2 create-security-group --group-name ta-lab-open-ssh \
  --description "Trusted Advisor lab - delete me" --vpc-id "$VPC_ID" \
  --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$SG_ID" \
  --protocol tcp --port 22 --cidr 0.0.0.0/0
echo "Test security group: $SG_ID"
```
:::

> [!CHECK]
> `ta-lab-open-ssh` exists with one inbound rule: SSH (TCP 22) from `0.0.0.0/0`.

### Step 3: Refresh the check and read the finding

On Basic Support, Trusted Advisor does not refresh security checks automatically, so you refresh them yourself.

:::console
1. Back in the Trusted Advisor console open **Security**.
2. Find **Security Groups - Specific Ports Unrestricted** and choose its refresh icon (or choose **Refresh all checks** on the Recommendations page). Wait a minute and reload the page.
3. Choose the check name to expand it. Read the **Alert Criteria** (red for high-risk ports such as 20, 21, 22, 1433, 3306, 3389 and 5432; yellow for other ports; green for 25, 80, 443 and 465) and the **Recommended Action**.
4. In the table of affected items, find `ta-lab-open-ssh` with port 22 and the Region `us-east-1`.
5. Optional: choose the download icon to save this check's results as an `.xls` file.
:::

> [!CHECK]
> The check shows **Action recommended** (red) and lists your test security group with port 22. If it is not listed yet, wait a few minutes and refresh again; results can lag behind changes.

> [!TIP]
> The recommended action also suggests Systems Manager Session Manager instead of opening SSH or RDP at all. That is the answer the exam expects for "administer instances without opening port 22".

### Step 4: Fix the rule and confirm the check turns green

:::console
1. In the EC2 console select `ta-lab-open-ssh`, choose **Actions** → **Edit inbound rules**.
2. Change the SSH rule's **Source** from **Anywhere-IPv4** to **My IP** (a single `/32` address) and choose **Save rules**.
3. Return to the **Security** category in Trusted Advisor and refresh **Security Groups - Specific Ports Unrestricted** again.
:::

:::cli
```bash
MY_IP=$(curl -s https://checkip.amazonaws.com)
aws ec2 revoke-security-group-ingress --group-id "$SG_ID" \
  --protocol tcp --port 22 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id "$SG_ID" \
  --protocol tcp --port 22 --cidr "${MY_IP}/32"
aws ec2 describe-security-groups --group-ids "$SG_ID" \
  --query 'SecurityGroups[0].IpPermissions[].IpRanges[].CidrIp'
```
:::

> [!CHECK]
> The security group now allows SSH only from one `/32` address. After the refresh, `ta-lab-open-ssh` is no longer listed; the check is green unless other security groups in the account also have risky open ports (worth fixing too).

### Step 5: Compare service limits with Service Quotas

:::console
1. In Trusted Advisor open **Service limits** and expand the **VPC** check. Note the **Limit Amount** and **Current Usage** per Region, and the alert rule: yellow at 80 % of a limit, red at 100 %.
2. Open the **Service Quotas** console, choose **AWS services** → **Amazon Virtual Private Cloud (Amazon VPC)**, and find **VPCs per Region**. Compare the applied quota with the Trusted Advisor value.
3. Notice that increases are requested from Service Quotas (select the quota, then **Request increase at account-level**), not from Trusted Advisor. Do not submit a request.
:::

:::cli
```bash
aws service-quotas list-service-quotas --service-code vpc \
  --query "Quotas[?QuotaName=='VPCs per Region'].[QuotaName,Value]" --output table
aws ec2 describe-vpcs --query 'length(Vpcs)'
```
:::

> [!CHECK]
> Both consoles report the same VPC quota for the Region (5 unless it was raised), and your current usage matches the number of VPCs returned by the CLI.

### Step 6: Look at notifications and the root MFA check

:::console
1. In Trusted Advisor open **Security** and look at **MFA on root account**. If it is red, plan to enable MFA on the root user (do not change it as part of this lab unless you own the account).
2. In the navigation pane under **Preferences** choose **Notifications**. See who receives the weekly summary email and in which language. Leave the settings unchanged (or choose **Save your preferences** only if you deliberately changed something).
:::

> [!CHECK]
> You know which account contacts get the weekly Trusted Advisor summary and whether the root user is protected by MFA.

## Cleanup

- [ ] **Security group `ta-lab-open-ssh`**: EC2 console → **Security Groups** → select it → **Actions** → **Delete security groups** → **Delete**. CLI: `aws ec2 delete-security-group --group-id "$SG_ID"`.
- [ ] **Downloaded check results** (`.xls` file from Step 3, if you saved one): delete it from your computer.
- [ ] **Notification preferences**: if you changed anything in **Preferences** → **Notifications**, set it back and choose **Save your preferences**.
- [ ] **Final check**: refresh **Security Groups - Specific Ports Unrestricted** once more; `ta-lab-open-ssh` must not appear, and the EC2 console lists no security group with that name in `us-east-1`. No charges are expected.

## Progress checklist

- [ ] Step 1: Toured the Trusted Advisor categories and saw which checks my plan includes
- [ ] Step 2: Created the open test security group `ta-lab-open-ssh`
- [ ] Step 3: Refreshed the check and saw the red finding for port 22
- [ ] Step 4: Restricted the rule to my IP and saw the finding disappear
- [ ] Step 5: Compared the Service limits check with Service Quotas
- [ ] Step 6: Checked root MFA status and the notification preferences
- [ ] Cleanup done: test security group deleted
