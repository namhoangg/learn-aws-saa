---
id: 01-getting-started-lab-01
title: Tour the console and map Regions, Availability Zones and global services
objective: Find your way around the AWS Management Console, switch Regions, list the Availability Zones and AZ IDs your account can use, see the difference between Regional and global services, and check where a service is available, from both the console and AWS CloudShell.
estimatedTime: 30 minutes
cost: "USD 0. The lab only reads information; it creates no billable resources. AWS CloudShell has no extra charge."
freeTier: yes
services: [console, cloudshell, cli-sdk, regions-azs, ec2, iam, vpc, lambda, cloudfront]
---

This lab turns the global infrastructure from the lesson into something you can see in your own account. You will not launch anything: every step reads information, so it is safe on a brand-new account.

## Prerequisites

- An AWS account you can sign in to. If you do not have one yet, follow the sign-up flow from the AWS Free Tier page (**Create free account**) and choose the **Free account plan** for learning.
- Sign in as the root user only if you have no other identity yet; the next lesson (IAM) shows how to create an administrator user and stop using root. Whoever signs in needs read access to EC2, IAM, Lambda, CloudFront, Account Management and Systems Manager, plus permission to use CloudShell (an administrator has all of these).
- A supported browser (recent Chrome, Firefox, Edge or Safari). CloudShell needs no local setup; the CLI tabs below are written for the Bash shell in CloudShell.
- The steps use **US East (N. Virginia) `us-east-1`** and **Asia Pacific (Sydney) `ap-southeast-2`**; any two Regions enabled by default work.

## Steps

### Step 1: Find your way around the navigation bar

:::console
1. Sign in at `https://console.aws.amazon.com/`. You land on **Console Home**.
2. Look at the navigation bar across the top. Find the **Services** menu and the **Search** box, then the icons for CloudShell, notifications, help and settings (gear), the Region selector and your account menu.
3. Open the **Services** menu and browse the categories (or choose **All services** for an A to Z list). Hover over **EC2** and select the star next to its name to add it to your favorites; it now appears in the favorites bar just below the navigation bar.
4. Press **Alt+S** (Windows) or **Option+S** (Mac) to jump to the **Search** box, or click it, and type `availability zones`. Notice that results are grouped by type: **Services**, **Features**, **Documentation**, **Blogs**, **Knowledge Articles** and more.
5. Open the account menu (your account name, top right) and note your 12-digit **Account ID**.
:::

:::cli
```bash
# Open CloudShell from the console first: choose the CloudShell icon in the navigation bar.
# Who am I, and in which account?
aws sts get-caller-identity
```
:::

> [!CHECK]
> `get-caller-identity` prints a JSON object whose `Account` field matches the Account ID in the account menu. If you signed in as root, the `Arn` ends in `:root`.

### Step 2: Switch Regions and list the Availability Zones

:::console
1. Use the **Search** box to open **EC2**. In the navigation bar, choose the name of the current Region and select **US East (N. Virginia)**.
2. On the **EC2 Dashboard**, find the **Service health** panel. Its zones list shows each **Zone name** (for example `us-east-1a`) next to its **Zone ID** (for example `use1-az4`). Write down two pairs.
3. Now choose the Region selector again and switch to **Asia Pacific (Sydney)**. Look at the browser address bar: the URL now contains `region=ap-southeast-2`.
4. Check the **Service health** panel again: you now see `ap-southeast-2a`, `ap-southeast-2b`, `ap-southeast-2c` with `apse2-az…` IDs.
:::

:::cli
```bash
# AZ names and IDs in N. Virginia (only real AZs, no Local or Wavelength Zones)
aws ec2 describe-availability-zones --region us-east-1 \
  --filters Name=zone-type,Values=availability-zone \
  --query "AvailabilityZones[].{Name:ZoneName,ID:ZoneId,State:State}" \
  --output table

# The same for Sydney
aws ec2 describe-availability-zones --region ap-southeast-2 \
  --filters Name=zone-type,Values=availability-zone \
  --query "AvailabilityZones[].{Name:ZoneName,ID:ZoneId,State:State}" \
  --output table
```
:::

> [!CHECK]
> N. Virginia lists up to six AZs and Sydney three. In N. Virginia, compare your name-to-ID pairs with a classmate's or a second account: in accounts created before November 2025 the same letter can map to a different ID. In Sydney, an account created before November 2025 may also show a mapping that differs from other accounts.

### Step 3: See that Regional resources really are per Region

Every Region in a new account comes with its own **default VPC** (a private network that EC2 uses unless you choose another). Comparing them shows that Regional resources do not cross Region boundaries.

:::console
1. With the Region selector on **Asia Pacific (Sydney)**, open the **VPC** console (use **Search**) and choose **Your VPCs**. Note the **VPC ID** of the VPC whose **Default VPC** column says **Yes**.
2. Switch the Region selector to **US East (N. Virginia)**. The list refreshes and shows a different default VPC with a different ID.
3. Open **EC2** → **Instances** in each Region. In a new account both lists are empty; if you ever launch an instance, it shows up only in the Region you launched it in.
:::

:::cli
```bash
for r in us-east-1 ap-southeast-2; do
  echo -n "$r default VPC: "
  aws ec2 describe-vpcs --region "$r" \
    --filters Name=is-default,Values=true \
    --query "Vpcs[0].VpcId" --output text
done
```
:::

> [!CHECK]
> You get two different `vpc-...` IDs, one per Region. If a Region prints `None`, its default VPC was deleted at some point; that does not affect the lab.

### Step 4: Compare with a global service

:::console
1. Use **Search** to open **IAM**.
2. Look at the Region selector in the navigation bar: it no longer offers a Region choice and shows **Global**. IAM users, groups, roles and policies apply to every Region.
3. Open **CloudFront** the same way and notice the same global scope. Then open **Lambda** and see that the Region selector is back, because Lambda is Regional.
:::

:::cli
```bash
# A global service gives the same answer whichever Region you ask
aws iam get-account-summary --region us-east-1 --query "SummaryMap.Users"
aws iam get-account-summary --region ap-southeast-2 --query "SummaryMap.Users"

# A Regional service gives a separate answer per Region
aws lambda list-functions --region us-east-1 --query "length(Functions)"
aws lambda list-functions --region ap-southeast-2 --query "length(Functions)"
```
:::

> [!CHECK]
> Both IAM calls return the same user count. The Lambda calls each count only the functions in that Region (probably `0` in a new account).

### Step 5: Explore Regions, opt-in status and AZ IDs in AWS Global View

:::console
1. Use **Search** to open **AWS Global View** and choose **Regions and Zones** in the navigation pane.
2. On the **Regions** tab, look at the **Status** column: Regions are **Enabled by default**, **Enabled** or **Disabled**. Find a disabled opt-in Region such as **Europe (Milan)** or **Asia Pacific (Malaysia)**. Do **not** choose **Enable Region**; just note that it exists.
3. Select **Asia Pacific (Sydney)** and choose **View details**. On the **Zones** tab, rows with **Zone type** **Availability zone** show the **Zone ID** column. You may also see Local Zones or Wavelength Zones for other Regions.
:::

:::cli
```bash
# Every Region and whether it needs opt-in for this account
aws ec2 describe-regions --all-regions \
  --query "Regions[].{Region:RegionName,OptIn:OptInStatus}" \
  --output table

# Only the Regions you can use right now
aws account list-regions \
  --region-opt-status-contains ENABLED_BY_DEFAULT ENABLED \
  --query "Regions[*].RegionName"

# Opt-in status of one Region
aws account get-region-opt-status --region-name eu-south-1
```
:::

> [!CHECK]
> `describe-regions` lists the commercial Regions (34 as of October 2026). The 17 older ones show `opt-in-not-required`; newer ones show `not-opted-in` (or `opted-in` if someone enabled them, which the sign-up flow can suggest for a Region in your country). `get-region-opt-status` for `eu-south-1` returns `DISABLED` unless Milan was enabled.

### Step 6: Check whether a service is available in a Region

Not every service exists in every Region. Use this before you choose a Region for a design.

:::console
1. Open `https://builder.aws.com/build/capabilities` (**AWS Capabilities by Region** in AWS Builder Center).
2. Pick two Regions to compare, for example **US East (N. Virginia)** and **Asia Pacific (Sydney)**, and search for a service such as **Amazon Rekognition** or **Amazon Bedrock**.
3. Note what the tool shows for each Region: whether the service is available there now or, if not, whether a launch is planned (sometimes with a target timeframe). The exact status labels can change as AWS updates the tool.
:::

:::cli
```bash
# Regions where Amazon Rekognition is offered (public Systems Manager parameters).
# The global-infrastructure path is answered from a set of supported Regions, so ask us-east-1.
aws ssm get-parameters-by-path --region us-east-1 \
  --path /aws/service/global-infrastructure/services/rekognition/regions \
  --query "Parameters[].Value" --output text | tr '\t' '\n' | sort

# Friendly name of a Region code
aws ssm get-parameters-by-path --region us-east-1 \
  --path /aws/service/global-infrastructure/regions/ap-southeast-2 \
  --query "Parameters[?contains(Name, 'longName')].Value" --output text
```
:::

> [!CHECK]
> The first command prints a sorted list of Region codes, noticeably shorter than the full list from Step 5: Rekognition is not offered everywhere. The second prints `Asia Pacific (Sydney)`.

### Step 7: Set your default Region

So that the console always opens where you work, set a default Region.

:::console
1. In the navigation bar, choose the gear icon, then **See all user settings** to open **Unified Settings**.
2. Choose **Edit** next to **Localization and default Region**.
3. In **Default Region**, choose the Region you will use for this course (for example **US East (N. Virginia)**) and choose **Save settings**.
:::

> [!CHECK]
> Switch to another Region, then open `https://console.aws.amazon.com/` in a new browser tab: Console Home opens in your chosen default Region, not in the Region you visited last.

## Cleanup

This lab created no AWS resources and no charges. Tidy up the few things you changed:

- [ ] **EC2 favorite** (Step 1): optional. To remove it, open the **Services** menu and select the star next to **EC2** again.
- [ ] **Default Region setting** (Step 7): keep it, or open **Unified Settings** → **Localization and default Region** → **Edit** and set it back to your previous choice.
- [ ] **CloudShell session**: close the CloudShell pane. You created no files in its home directory; if you did, remove them with `rm` or use **Actions** → **Delete** in CloudShell to wipe the home directory for that Region.
- [ ] **Opt-in Regions**: confirm you did not enable any. Run `aws account list-regions --region-opt-status-contains ENABLING ENABLED` and expect an empty list (unless they were enabled before this lab).
- [ ] **Final check**: open **Billing and Cost Management** → **Bills** (or the cost widget on Console Home) and confirm no charges from this lab.

## Progress checklist

- [ ] Step 1: Navigated the Services menu, Search and account menu; ran `get-caller-identity`
- [ ] Step 2: Listed AZ names and AZ IDs in two Regions
- [ ] Step 3: Saw a different default VPC in each Region
- [ ] Step 4: Compared global IAM with Regional Lambda
- [ ] Step 5: Found opt-in Regions and AZ IDs in AWS Global View
- [ ] Step 6: Checked a service's Regional availability
- [ ] Step 7: Set a default Region
- [ ] Cleanup done
