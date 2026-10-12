---
id: 15-cloudfront-global-accelerator-lab-02
title: Route users to two Regions with AWS Global Accelerator and test failover
objective: Put one web server in each of two Regions behind a standard accelerator, reach them through two static anycast IPs, shift traffic with a traffic dial, and watch health checks fail over when a Region goes down.
estimatedTime: 50 minutes
cost: "About USD 0.08 for one hour: accelerator USD 0.025 per (partial) hour, its two static IPv4 addresses USD 0.01 per hour, two t3.micro instances about USD 0.02 per hour, two instance public IPv4 addresses USD 0.01 per hour, plus negligible DT-Premium for a few KB. Global Accelerator has no free tier and is Paid-plan only on accounts created on or after 15 July 2025, where remaining sign-up credits can offset the charges."
freeTier: partial
services: [global-accelerator, ec2, security-groups, edge-locations]
---

> [!COST]
> Global Accelerator bills **USD 0.025 for every full or partial hour** an accelerator exists, whether enabled or disabled, and its two static IPv4 addresses are billed as in-use public IPv4 addresses (USD 0.005 per hour each). The two `t3.micro` instances cost roughly USD 0.01 per hour each, and each instance's public IPv4 address another USD 0.005 per hour. Data Transfer-Premium for the few kilobytes in this lab rounds to zero. Delete the accelerator and terminate both instances as soon as you finish; a forgotten accelerator costs about USD 26 a month including its IPs. This lab needs a **Paid-plan** account (see the next note); remaining sign-up credits offset these charges.

> [!UPDATED] Global Accelerator needs a Paid-plan account
> Accounts on the credit-based **Free plan** (created on or after 15 July 2025 and not upgraded) cannot use Global Accelerator: the [AWS Free Tier page](https://aws.amazon.com/free/), which the [Billing guide](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html) names as the list of services open to the Free plan, marks it **Paid plan exclusive**. Before this lab, check your plan in **Billing and Cost Management** and choose **Upgrade plan** only if you accept the charges above; remaining sign-up credits still apply to them. If you signed up through the newer, limited-rollout **Sign up for AWS (new)** experience, a Paid plan is not enough: AWS lists Global Accelerator as unsupported there until you [activate advanced AWS features](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html). Accounts created before 15 July 2025 (legacy Free Tier) can run the lab at the normal rates.

You will build a small multi-Region application: a web page in **US East (N. Virginia)** and the same page in **Europe (Ireland)**, both behind one accelerator. Each page prints the Region that served it, so you can see where Global Accelerator sends you.

## Prerequisites

- An AWS account on the **Paid plan**, or one created before 15 July 2025; Free plan accounts cannot create accelerators (see the note above).
- Permissions for EC2 and Global Accelerator (for example `AmazonEC2FullAccess` plus `GlobalAcceleratorFullAccess`).
- A **default VPC** in `us-east-1` and `eu-west-1` (every Region has one unless it was deleted). Any two Regions supported by Global Accelerator work; adjust the names if you pick others.
- For the CLI tabs: AWS CloudShell (opened in `us-east-1`) or a local Bash shell with AWS CLI v2. All Global Accelerator commands must use `--region us-west-2`, because its control plane lives in US West (Oregon), even though the accelerator itself is global. Keep one terminal open for the whole lab.
- `curl` (available in CloudShell) or just a browser.

## Steps

### Step 1: Launch a web server in us-east-1

Both instances use the same user data script. It installs Apache and writes a page showing the instance ID and Region.

User data script (copy it exactly):

```bash
#!/bin/bash
dnf install -y httpd
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 300")
ID=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)
REGION=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/placement/region)
echo "Hello from $ID in $REGION" > /var/www/html/index.html
systemctl enable --now httpd
```

The security group allows HTTP from anywhere for two reasons: Global Accelerator **preserves the client's IP address** for EC2 endpoints (so packets arrive from real user IPs), and its health checks come from Route 53 health checker addresses. The public IP on the instance is only there so `dnf` can download Apache; you will not browse it directly.

:::console
1. Switch the console to **US East (N. Virginia)** `us-east-1`. Open the **EC2** console and choose **Security Groups** → **Create security group**.
2. Name it `ga-lab-web-sg`, description `GA lab: HTTP from anywhere`, keep the default **VPC**. Under **Inbound rules**, choose **Add rule**, **Type** **HTTP**, **Source** **Anywhere-IPv4**. Choose **Create security group**.
3. Choose **Instances** → **Launch instances**. Name it `ga-lab-web`.
4. Keep **Amazon Linux 2023** under **Application and OS Images (Amazon Machine Image)** and choose **t3.micro** as the **Instance type**.
5. Under **Key pair (login)**, choose **Proceed without a key pair (not recommended)**.
6. Under **Network settings**, choose **Edit**, keep the default VPC and subnet, keep **Auto-assign public IP** on **Enable**, choose **Select existing security group** and pick `ga-lab-web-sg`.
7. Expand **Advanced details** and paste the script into **User data**. Choose **Launch instance**.
:::

:::cli
```bash
# Save the user data script above as user-data.sh first.
launch_web () {
  local R=$1
  local VPC SG AMI ID
  VPC=$(aws ec2 describe-vpcs --region "$R" --filters Name=is-default,Values=true \
    --query 'Vpcs[0].VpcId' --output text)
  SG=$(aws ec2 create-security-group --region "$R" --group-name ga-lab-web-sg \
    --description "GA lab: HTTP from anywhere" --vpc-id "$VPC" --query GroupId --output text)
  aws ec2 authorize-security-group-ingress --region "$R" --group-id "$SG" \
    --protocol tcp --port 80 --cidr 0.0.0.0/0 > /dev/null
  AMI=$(aws ssm get-parameters --region "$R" \
    --names /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
    --query 'Parameters[0].Value' --output text)
  # The default subnets assign a public IPv4 address automatically.
  ID=$(aws ec2 run-instances --region "$R" --image-id "$AMI" --instance-type t3.micro \
    --security-group-ids "$SG" --user-data file://user-data.sh \
    --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=ga-lab-web}]' \
    --query 'Instances[0].InstanceId' --output text)
  echo "$SG $ID"
}

R1=us-east-1
read SG1 I1 <<< "$(launch_web $R1)"
echo "us-east-1: SG $SG1 instance $I1"
```
:::

> [!TIP]
> If the launch fails with an error saying `t3.micro` is not supported in the requested Availability Zone, choose a default subnet in a different AZ (console: **Network settings** → **Edit** → **Subnet**; CLI: add `--subnet-id` with a default subnet from another AZ) and launch again.

### Step 2: Launch the same web server in eu-west-1

:::console
1. Switch the console Region to **Europe (Ireland)** `eu-west-1`.
2. Repeat every action from Step 1 (security group `ga-lab-web-sg`, then instance `ga-lab-web` with the same user data).
:::

:::cli
```bash
R2=eu-west-1
read SG2 I2 <<< "$(launch_web $R2)"
echo "eu-west-1: SG $SG2 instance $I2"

aws ec2 wait instance-running --region $R1 --instance-ids "$I1"
aws ec2 wait instance-running --region $R2 --instance-ids "$I2"
```
:::

> [!CHECK]
> Each Region shows one **Running** instance named `ga-lab-web`. Give the user data two or three minutes to install Apache before the next step.

### Step 3: Create a standard accelerator with two endpoint groups

:::console
1. Open the **Global Accelerator** console (it opens in the US West (Oregon) Region automatically) and choose **Create accelerator**.
2. Enter the name `ga-lab`. For **Accelerator type** choose **Standard**, for **IP address type** choose **IPv4**. Choose **Next**.
3. On the **Add listener** page, enter port `80`, choose protocol **TCP**, keep client affinity **None**, and choose **Next**.
4. On the **Add endpoint groups** page, choose **Region** `us-east-1` and keep **Traffic dial** at `100`. Choose **Configure health checks** and set the protocol to **HTTP**, path `/`, interval **10** seconds and threshold count **3**.
5. Choose **Add endpoint group** and repeat for **Region** `eu-west-1` with the same health check settings. Choose **Next**.
6. On the **Create endpoints** page, in the `us-east-1` group choose the EC2 instance `ga-lab-web` as the **Endpoint** (keep **Weight** `128`); in the `eu-west-1` group choose that Region's `ga-lab-web` instance. Client IP preservation is always on for EC2 endpoints.
7. Choose **Next**. That creates the accelerator: the dashboard shows it as in progress, and its status turns **Active** after a few minutes.
8. Open the accelerator and note its two static IPv4 addresses and its DNS name.
:::

:::cli
```bash
GA="aws globalaccelerator --region us-west-2"

GA_ARN=$($GA create-accelerator --name ga-lab --ip-address-type IPV4 \
  --query Accelerator.AcceleratorArn --output text)

LISTENER_ARN=$($GA create-listener --accelerator-arn "$GA_ARN" \
  --port-ranges FromPort=80,ToPort=80 --protocol TCP --client-affinity NONE \
  --query Listener.ListenerArn --output text)

EG1=$($GA create-endpoint-group --listener-arn "$LISTENER_ARN" \
  --endpoint-group-region $R1 --endpoint-configurations EndpointId=$I1,Weight=128 \
  --health-check-protocol HTTP --health-check-path / \
  --health-check-interval-seconds 10 --threshold-count 3 \
  --query EndpointGroup.EndpointGroupArn --output text)

EG2=$($GA create-endpoint-group --listener-arn "$LISTENER_ARN" \
  --endpoint-group-region $R2 --endpoint-configurations EndpointId=$I2,Weight=128 \
  --health-check-protocol HTTP --health-check-path / \
  --health-check-interval-seconds 10 --threshold-count 3 \
  --query EndpointGroup.EndpointGroupArn --output text)

until [ "$($GA describe-accelerator --accelerator-arn "$GA_ARN" \
  --query Accelerator.Status --output text)" = "DEPLOYED" ]; do sleep 15; done

GA_IP=$($GA describe-accelerator --accelerator-arn "$GA_ARN" \
  --query 'Accelerator.IpSets[0].IpAddresses[0]' --output text)
$GA describe-accelerator --accelerator-arn "$GA_ARN" \
  --query 'Accelerator.[DnsName,IpSets[0].IpAddresses]' --output text
```
:::

> [!CHECK]
> The accelerator status is **Active** (CLI: `DEPLOYED`) and it has exactly **two static IPv4 addresses** plus a DNS name ending in `awsglobalaccelerator.com`. Open each endpoint group: both endpoints show **Healthy** (CLI: `$GA describe-endpoint-group --endpoint-group-arn "$EG1" --query 'EndpointGroup.EndpointDescriptions[].HealthState'`). If an endpoint is unhealthy, wait for Apache to finish installing.

### Step 4: Reach the application through the static IPs

1. Open `http://<first-static-IP>/` in your browser, then `http://<second-static-IP>/`.
2. Note which Region answers. Global Accelerator sends you to the closest healthy Region: users near Europe land in `eu-west-1`, users in the Americas or in CloudShell `us-east-1` land in `us-east-1`.

:::cli
```bash
for i in $(seq 1 10); do curl -s "http://$GA_IP/"; done | sort | uniq -c
```
:::

> [!CHECK]
> All ten requests return the same Region, the one nearest to where you ran them. Both static IPs reach the same application: they are two independent anycast entry points for redundancy.

### Step 5: Drain your nearest Region with the traffic dial

Pretend you are about to patch the Region that served you. Instead of touching DNS or clients, dial its traffic down to zero.

:::console
1. In the Global Accelerator console, open `ga-lab` → the listener → the endpoint group for the Region that answered in Step 4.
2. Choose **Edit**, set **Traffic dial** to `0`, and save.
3. Reload `http://<static-IP>/` a few times (a private window avoids reusing an old connection).
4. Set the traffic dial back to `100` when you are done.
:::

:::cli
```bash
NEAR_EG=$EG1   # use $EG2 instead if eu-west-1 answered in Step 4
$GA update-endpoint-group --endpoint-group-arn "$NEAR_EG" --traffic-dial-percentage 0 \
  --query EndpointGroup.TrafficDialPercentage
sleep 30
for i in $(seq 1 10); do curl -s "http://$GA_IP/"; done | sort | uniq -c

$GA update-endpoint-group --endpoint-group-arn "$NEAR_EG" --traffic-dial-percentage 100 \
  --query EndpointGroup.TrafficDialPercentage
```
:::

> [!CHECK]
> With the dial at 0, new requests are answered by the **other** Region, while the IP addresses you use never change. Setting values between 0 and 100 shifts only part of the traffic, which is how teams do gradual blue/green moves between Regions.

### Step 6: Simulate a Region failure and watch health-based failover

:::console
1. Switch the EC2 console to the Region that normally serves you, select its `ga-lab-web` instance and choose **Instance state** → **Stop instance**.
2. In the Global Accelerator console, watch that Region's endpoint turn **Unhealthy** (about 30 seconds with 10-second checks and a threshold of 3).
3. Reload `http://<static-IP>/`: the other Region answers.
4. Start the instance again (**Instance state** → **Start instance**). Apache starts on boot, and the endpoint returns to **Healthy** after three passing checks; traffic moves back.
:::

:::cli
```bash
NEAR_R=$R1; NEAR_I=$I1   # use $R2 and $I2 if eu-west-1 is your nearest Region
aws ec2 stop-instances --region $NEAR_R --instance-ids "$NEAR_I" > /dev/null
aws ec2 wait instance-stopped --region $NEAR_R --instance-ids "$NEAR_I"
sleep 40
$GA describe-endpoint-group --endpoint-group-arn "$NEAR_EG" \
  --query 'EndpointGroup.EndpointDescriptions[].[EndpointId,HealthState]' --output text
for i in $(seq 1 5); do curl -s "http://$GA_IP/"; done | sort | uniq -c

aws ec2 start-instances --region $NEAR_R --instance-ids "$NEAR_I" > /dev/null
aws ec2 wait instance-running --region $NEAR_R --instance-ids "$NEAR_I"
```
:::

> [!CHECK]
> While the instance is stopped, its endpoint is **Unhealthy** and every request is served by the other Region through the **same static IPs**. No DNS record changed, so no client had to wait for a TTL. After the restart the endpoint becomes healthy again and your requests return to the nearest Region.

## Cleanup

Delete the accelerator first (it bills by the hour), then the instances and security groups in **both** Regions.

- [ ] **Accelerator `ga-lab`** (its listener and both endpoint groups go with it in the console): Global Accelerator console → select `ga-lab` → **Edit** → **Disable accelerator** → **Save**; wait until the status is no longer in progress; select it again → **Delete accelerator** → **Delete**.
- [ ] **EC2 instance `ga-lab-web` in us-east-1**: EC2 console (us-east-1) → select → **Instance state** → **Terminate (delete) instance**.
- [ ] **EC2 instance `ga-lab-web` in eu-west-1**: same, in eu-west-1.
- [ ] **Security group `ga-lab-web-sg` in us-east-1**: after the instance has terminated, **Security Groups** → select → **Actions** → **Delete security groups**.
- [ ] **Security group `ga-lab-web-sg` in eu-west-1**: same, in eu-west-1.
- [ ] Local file `user-data.sh` (CLI path).

:::cli
```bash
# The API requires removing endpoint groups and listeners, and disabling, before deletion
$GA delete-endpoint-group --endpoint-group-arn "$EG1"
$GA delete-endpoint-group --endpoint-group-arn "$EG2"
$GA delete-listener --listener-arn "$LISTENER_ARN"
$GA update-accelerator --accelerator-arn "$GA_ARN" --no-enabled > /dev/null
until [ "$($GA describe-accelerator --accelerator-arn "$GA_ARN" \
  --query Accelerator.Status --output text)" = "DEPLOYED" ]; do sleep 15; done
$GA delete-accelerator --accelerator-arn "$GA_ARN"

# Terminate the instances, then delete the security groups in both Regions
aws ec2 terminate-instances --region $R1 --instance-ids "$I1" > /dev/null
aws ec2 terminate-instances --region $R2 --instance-ids "$I2" > /dev/null
aws ec2 wait instance-terminated --region $R1 --instance-ids "$I1"
aws ec2 wait instance-terminated --region $R2 --instance-ids "$I2"
aws ec2 delete-security-group --region $R1 --group-id "$SG1"
aws ec2 delete-security-group --region $R2 --group-id "$SG2"
rm -f user-data.sh
```
:::

> [!CHECK]
> The Global Accelerator console lists no accelerators (CLI: `$GA list-accelerators` returns an empty list), and neither `us-east-1` nor `eu-west-1` shows running instances or the `ga-lab-web-sg` group. Next day, **Billing and Cost Management** → **Bills** shows at most one or two hours of Global Accelerator charges.

## Progress checklist

- [ ] Step 1: web server and security group running in us-east-1
- [ ] Step 2: web server and security group running in eu-west-1
- [ ] Step 3: accelerator active with two static IPs and two healthy endpoint groups
- [ ] Step 4: reached the nearest Region through both static IPs
- [ ] Step 5: drained the nearest Region with the traffic dial and restored it
- [ ] Step 6: stopped an instance, saw failover to the other Region, then recovered
- [ ] Cleanup: accelerator deleted, both instances terminated, both security groups deleted
