---
id: 07-elb-lab-01
title: Put an Application Load Balancer in front of two EC2 instances
objective: Launch two web servers in different Availability Zones, lock them down with security group chaining, balance traffic across them with an internet-facing ALB, and watch health checks react to a failure.
estimatedTime: 45 minutes
cost: "About USD 0.07 per hour in us-east-1 (ALB hourly + a fraction of an LCU, four public IPv4 addresses, two t3.micro instances); roughly USD 0.10 if you clean up within an hour. Free Tier credits (new accounts) or the legacy 12-month Free Tier can cover most of it."
freeTier: partial
services: [alb, elb, ec2, security-groups]
---

> [!COST]
> An ALB bills from the moment it is created until you delete it: USD 0.0225 per hour plus LCU usage (negligible for this test traffic) in us-east-1. Each public IPv4 address (two on the ALB, one per instance) costs USD 0.005 per hour. Two `t3.micro` instances add about USD 0.02 per hour unless Free Tier credits or the legacy Free Tier cover them. Do the **Cleanup** section as soon as you finish; a forgotten ALB costs about USD 16 per month.

This lab builds the classic highly available web tier: two instances in two AZs, an ALB spread across the same AZs, and instances that accept traffic **only** from the ALB. Labs 02 and 03 reuse these resources, so if you plan to continue, skip the Cleanup section for now and come back to it.

## Prerequisites

- An AWS account with permissions for EC2 and Elastic Load Balancing (for example the `AmazonEC2FullAccess` managed policy, which includes ELB).
- A Region with a **default VPC** (every Region has one unless it was deleted). The steps use `us-east-1`; any Region works.
- For the CLI tabs: AWS CLI v2 configured with `aws configure` (or use AWS CloudShell, which needs no setup), and a Bash shell. Keep the same terminal open for the whole lab because later commands reuse shell variables.
- A web browser, plus `curl` and `nslookup` for the CLI tabs. `curl` is ready in CloudShell; if `nslookup` is not found there, install it for the session with `sudo dnf install -y bind-utils`.

## Steps

### Step 1: Create two security groups

You need one security group for the load balancer and one for the instances. The instance group will reference the load balancer group by ID.

:::console
1. Open the **EC2** console and choose **Security Groups** under **Network & Security** in the navigation pane, then **Create security group**.
2. For **Security group name** enter `demo-alb-sg`, for **Description** enter `ALB: HTTP from anywhere`, and keep the default **VPC**.
3. Under **Inbound rules**, choose **Add rule**, set **Type** to **HTTP** and **Source** to **Anywhere-IPv4** (`0.0.0.0/0`). Choose **Create security group**.
4. Choose **Create security group** again. Name it `demo-web-sg` with description `Web: HTTP only from the ALB`, default VPC.
5. Under **Inbound rules**, choose **Add rule**, set **Type** to **HTTP**, **Source** to **Custom**, and in the search box pick `demo-alb-sg`. Choose **Create security group**.
:::

:::cli
```bash
VPC_ID=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true \
  --query 'Vpcs[0].VpcId' --output text)

ALB_SG=$(aws ec2 create-security-group --group-name demo-alb-sg \
  --description "ALB: HTTP from anywhere" --vpc-id "$VPC_ID" \
  --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$ALB_SG" \
  --protocol tcp --port 80 --cidr 0.0.0.0/0

WEB_SG=$(aws ec2 create-security-group --group-name demo-web-sg \
  --description "Web: HTTP only from the ALB" --vpc-id "$VPC_ID" \
  --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$WEB_SG" \
  --protocol tcp --port 80 --source-group "$ALB_SG"
echo "ALB SG: $ALB_SG  Web SG: $WEB_SG"
```
:::

> [!CHECK]
> `demo-web-sg` has one inbound rule whose source is a security group ID (`sg-...`) labelled `demo-alb-sg`, not an IP range.

### Step 2: Launch two web servers in different Availability Zones

Both instances run the same user data script. It installs Apache, writes a page that shows the instance ID and AZ (so you can see which server answered), a `/health` page for the load balancer, and an `/api/` page used in lab 02.

User data script (copy it exactly):

```bash
#!/bin/bash
dnf install -y httpd
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 300")
ID=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)
AZ=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/placement/availability-zone)
echo "<h1>Hello from $ID in $AZ</h1>" > /var/www/html/index.html
echo "OK" > /var/www/html/health
mkdir -p /var/www/html/api
echo "API answer from $ID in $AZ" > /var/www/html/api/index.html
systemctl enable --now httpd
```

:::console
1. In the EC2 console choose **Instances** → **Launch instances**.
2. Under **Name and tags**, enter `web-a`.
3. Under **Application and OS Images (Amazon Machine Image)**, keep **Amazon Linux 2023** (the Quick Start default).
4. Under **Instance type**, choose **t3.micro**.
5. Under **Key pair (login)**, choose **Proceed without a key pair (not recommended)**; you will not log in to these servers.
6. Under **Network settings**, choose **Edit**. Keep the default VPC, pick a **Subnet** in the first AZ (for example `us-east-1a`), keep **Auto-assign public IP** set to **Enable**, and for **Firewall (security groups)** choose **Select existing security group** and pick `demo-web-sg`.
7. Expand **Advanced details**, scroll to **User data** and paste the script above.
8. In the **Summary** panel choose **Launch instance**.
9. Repeat steps 1–8 for a second instance named `web-b`, choosing a **Subnet** in a **different** AZ (for example `us-east-1b`).
:::

:::cli
```bash
# Save the user data script above as user-data.sh in the current directory first.
AMI=$(aws ssm get-parameters \
  --names /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --query 'Parameters[0].Value' --output text)

# t3.micro is not offered in every AZ, so list the AZs that have it first.
AZS=$(aws ec2 describe-instance-type-offerings --location-type availability-zone \
  --filters Name=instance-type,Values=t3.micro \
  --query 'InstanceTypeOfferings[].Location' --output text | tr '\t' ',')
# Two default subnets in those AZs: the default VPC has one per AZ, so they are in different AZs.
read SUBNET_A SUBNET_B <<< "$(aws ec2 describe-subnets \
  --filters Name=vpc-id,Values="$VPC_ID" Name=default-for-az,Values=true \
            Name=availability-zone,Values="$AZS" \
  --query 'Subnets[0:2].SubnetId' --output text)"

I1=$(aws ec2 run-instances --image-id "$AMI" --instance-type t3.micro \
  --subnet-id "$SUBNET_A" --security-group-ids "$WEB_SG" --associate-public-ip-address \
  --user-data file://user-data.sh \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=web-a}]' \
  --query 'Instances[0].InstanceId' --output text)
I2=$(aws ec2 run-instances --image-id "$AMI" --instance-type t3.micro \
  --subnet-id "$SUBNET_B" --security-group-ids "$WEB_SG" --associate-public-ip-address \
  --user-data file://user-data.sh \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=web-b}]' \
  --query 'Instances[0].InstanceId' --output text)
aws ec2 wait instance-running --instance-ids "$I1" "$I2"
aws ec2 describe-instances --instance-ids "$I1" "$I2" \
  --query 'Reservations[].Instances[].[Tags[?Key==`Name`]|[0].Value,Placement.AvailabilityZone,PublicIpAddress]' \
  --output table
```
:::

> [!CHECK]
> Both instances show **Running** in different AZs. Copy one instance's **Public IPv4 address** and open `http://<that-ip>` in a browser: the request should **time out**. That is the security group chaining working, since only `demo-alb-sg` may reach port 80.

### Step 3: Create a target group with a custom health check

:::console
1. In the EC2 console choose **Target Groups** (under **Load Balancing**) → **Create target group**.
2. For **Choose a target type**, select **Instances**.
3. For **Target group name** enter `demo-web-tg`. Keep **Protocol** `HTTP`, **Port** `80`, **IP address type** **IPv4**, the default **VPC**, and **Protocol version** **HTTP1**.
4. In **Health checks**, keep **Health check protocol** `HTTP` and set **Health check path** to `/health`.
5. Expand **Advanced health check settings** and set **Healthy threshold** to `2` and **Interval** to `10` seconds (so the lab moves faster). Keep the other defaults.
6. Choose **Next**. Under **Available instances**, select `web-a` and `web-b`, keep port `80`, and choose **Include as pending below**.
7. Choose **Create target group**.
:::

:::cli
```bash
TG_ARN=$(aws elbv2 create-target-group --name demo-web-tg \
  --protocol HTTP --port 80 --vpc-id "$VPC_ID" --target-type instance \
  --health-check-path /health --health-check-interval-seconds 10 \
  --healthy-threshold-count 2 \
  --query 'TargetGroups[0].TargetGroupArn' --output text)
aws elbv2 register-targets --target-group-arn "$TG_ARN" \
  --targets Id="$I1" Id="$I2"
```
:::

> [!CHECK]
> On the target group's **Targets** tab both instances are listed. Their health shows **Unused** with a note that the target group is not configured to receive traffic: no load balancer uses it yet.

### Step 4: Create the Application Load Balancer

:::console
1. Choose **Load Balancers** → **Create load balancer**. Under **Application Load Balancer**, choose **Create**.
2. **Basic configuration**: **Load balancer name** `demo-alb`, **Scheme** **Internet-facing**, **Load balancer IP address type** **IPv4**.
3. **Network mapping**: keep the default **VPC**. Under **Availability Zones and subnets**, select the two AZs where `web-a` and `web-b` run, with their default subnets.
4. **Security groups**: remove the preselected `default` group and select `demo-alb-sg`.
5. **Listeners and routing**: keep **Protocol** `HTTP` and **Port** `80`; for **Default action** choose to forward to `demo-web-tg`.
6. Review the **Summary** and choose **Create load balancer**. Then choose **View load balancer**.
:::

:::cli
```bash
ALB_ARN=$(aws elbv2 create-load-balancer --name demo-alb --type application \
  --scheme internet-facing --subnets "$SUBNET_A" "$SUBNET_B" \
  --security-groups "$ALB_SG" \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text)
aws elbv2 wait load-balancer-available --load-balancer-arns "$ALB_ARN"
LISTENER_ARN=$(aws elbv2 create-listener --load-balancer-arn "$ALB_ARN" \
  --protocol HTTP --port 80 \
  --default-actions Type=forward,TargetGroupArn="$TG_ARN" \
  --query 'Listeners[0].ListenerArn' --output text)
DNS=$(aws elbv2 describe-load-balancers --load-balancer-arns "$ALB_ARN" \
  --query 'LoadBalancers[0].DNSName' --output text)
echo "$DNS"
```
:::

> [!CHECK]
> The load balancer **State** changes from **Provisioning** to **Active** after a few minutes. On `demo-web-tg` → **Targets**, both instances move from **Initial** to **Healthy** (about 20–30 seconds with your settings). CLI: `aws elbv2 describe-target-health --target-group-arn "$TG_ARN" --query 'TargetHealthDescriptions[].[Target.Id,TargetHealth.State]' --output table`.

### Step 5: Test load balancing across the two AZs

:::console
1. On the load balancer's details page, copy the **DNS name** (for example `demo-alb-1234567890.us-east-1.elb.amazonaws.com`).
2. Open `http://<DNS name>` in a browser and refresh several times.
3. Open `http://<DNS name>/health` and `http://<DNS name>/api/` to confirm the other pages work too.
:::

:::cli
```bash
for i in 1 2 3 4 5 6; do curl -s "http://$DNS/"; echo; done
nslookup "$DNS"
```
:::

> [!CHECK]
> Responses come from both instance IDs and AZs. Each ALB node runs its own round robin, so the order is not always strictly alternating. `nslookup` returns **two** IP addresses, one for each ALB node; these can change over time, which is why you always use the DNS name.

### Step 6: Simulate an instance failure

:::console
1. Go to **Instances**, select `web-a`, and choose **Instance state** → **Stop instance** → **Stop**.
2. Return to `demo-web-tg` → **Targets** and refresh until `web-a` changes state.
3. Refresh the ALB DNS name in your browser several times.
4. Start `web-a` again (**Instance state** → **Start instance**) and watch its target health return to **Healthy**.
:::

:::cli
```bash
aws ec2 stop-instances --instance-ids "$I1"
aws ec2 wait instance-stopped --instance-ids "$I1"
aws elbv2 describe-target-health --target-group-arn "$TG_ARN" \
  --query 'TargetHealthDescriptions[].[Target.Id,TargetHealth.State,TargetHealth.Reason]' --output table
for i in 1 2 3 4; do curl -s "http://$DNS/"; echo; done

aws ec2 start-instances --instance-ids "$I1"
aws ec2 wait instance-running --instance-ids "$I1"
```
:::

> [!CHECK]
> While `web-a` is stopped its target shows **Unused** with reason `Target.InvalidState`, and every response comes from `web-b`: users see no error. After the restart, `web-a` goes **Initial** → **Healthy** within about a minute and traffic alternates again.

### Step 7 (optional): See the load balancer fail open

:::console
1. Open `demo-web-tg`, choose the **Health checks** tab, and choose **Edit**.
2. Change **Health check path** to `/does-not-exist` and choose **Save changes**.
3. After about 30 seconds, check the **Targets** tab, then refresh the ALB DNS name in your browser.
4. Set the **Health check path** back to `/health` and save.
:::

:::cli
```bash
aws elbv2 modify-target-group --target-group-arn "$TG_ARN" --health-check-path /does-not-exist
sleep 40
aws elbv2 describe-target-health --target-group-arn "$TG_ARN" \
  --query 'TargetHealthDescriptions[].[Target.Id,TargetHealth.State,TargetHealth.Reason]' --output table
curl -s "http://$DNS/"; echo
aws elbv2 modify-target-group --target-group-arn "$TG_ARN" --health-check-path /health
```
:::

> [!CHECK]
> Both targets become **Unhealthy** with reason `Target.ResponseCodeMismatch` (the servers answer 404), yet the site still loads: with every target unhealthy, the ALB fails open and keeps routing to all of them. After you restore `/health`, both return to **Healthy**.

## Cleanup

Skip this section if you are continuing straight to lab 02 or lab 03; those labs end with a cleanup that covers everything. Otherwise delete in this order:

- [ ] **Load balancer `demo-alb`**: **Load Balancers** → select it → **Actions** → **Delete load balancer**, type `confirm`, choose **Delete**. CLI: `aws elbv2 delete-load-balancer --load-balancer-arn "$ALB_ARN"` (this also removes its listener).
- [ ] **Target group `demo-web-tg`**: **Target Groups** → select it → **Actions** → **Delete**, then confirm with **Delete**. CLI: `aws elbv2 delete-target-group --target-group-arn "$TG_ARN"` (wait until the load balancer deletion has finished).
- [ ] **Instances `web-a` and `web-b`**: **Instances** → select both → **Instance state** → **Terminate (delete) instance**. CLI: `aws ec2 terminate-instances --instance-ids "$I1" "$I2"` then `aws ec2 wait instance-terminated --instance-ids "$I1" "$I2"`.
- [ ] **Security group `demo-web-sg`** (delete it first because it references the ALB group): **Security Groups** → select → **Actions** → **Delete security groups**. CLI: `aws ec2 delete-security-group --group-id "$WEB_SG"`.
- [ ] **Security group `demo-alb-sg`**: same steps. If deletion fails with a dependency error, wait a few minutes for the ALB's network interfaces to disappear and retry. CLI: `aws ec2 delete-security-group --group-id "$ALB_SG"`.
- [ ] **Local file `user-data.sh`** (CLI path only): delete it if you no longer need it.
- [ ] **Final check**: the EC2 console shows no load balancers, no target groups named `demo-*`, and no running instances in this Region; the next day, **Billing and Cost Management** → **Bills** shows no new Elastic Load Balancing charges.

## Progress checklist

- [ ] Step 1: Created `demo-alb-sg` and `demo-web-sg` with the security group reference
- [ ] Step 2: Launched `web-a` and `web-b` in different AZs and confirmed direct access is blocked
- [ ] Step 3: Created `demo-web-tg` with a `/health` check and registered both instances
- [ ] Step 4: Created `demo-alb` and saw both targets become healthy
- [ ] Step 5: Saw responses alternate between instances and AZs
- [ ] Step 6: Stopped an instance and watched traffic shift without errors
- [ ] Step 7 (optional): Observed fail-open with every target unhealthy
- [ ] Cleanup done (or deferred to lab 02 / lab 03)
