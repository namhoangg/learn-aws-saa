---
id: 08-asg-lab-01
title: Build a self-healing Auto Scaling group behind an Application Load Balancer
objective: Create a launch template, an ALB and a two-AZ Auto Scaling group that registers its instances automatically, then watch the group replace a failed instance and rebalance after a manual resize.
estimatedTime: 50 minutes
cost: "About USD 0.07 per hour in us-east-1 (ALB hourly + a fraction of an LCU, four public IPv4 addresses, two t3.micro instances); roughly USD 0.10 if you clean up within an hour. Free Tier credits (new accounts) or the legacy 12-month Free Tier can cover most of it."
freeTier: partial
services: [asg, ec2, alb, elb, security-groups, ami, cloudshell]
---

> [!COST]
> EC2 Auto Scaling itself is free, but what it launches is not. In us-east-1 the ALB costs USD 0.0225 per hour plus LCU usage (negligible for this test traffic), each public IPv4 address costs USD 0.005 per hour (two on the ALB, one per instance), and each `t3.micro` costs USD 0.0104 per hour unless Free Tier credits or the legacy Free Tier cover it. With two instances that is about USD 0.07 per hour. An Auto Scaling group keeps relaunching instances until you delete the **group**, so terminating instances by hand does not stop the bill. Do the **Cleanup** section as soon as you finish (or after lab 02).

You will build the standard elastic web tier: a launch template that describes one web server, an Application Load Balancer as the single entry point, and an Auto Scaling group across two Availability Zones that keeps two healthy instances registered behind it. Lab 02 adds scaling policies to the same resources, so if you plan to continue, skip this lab's Cleanup.

## Prerequisites

- An AWS account and an IAM identity allowed to manage EC2, Elastic Load Balancing, EC2 Auto Scaling and CloudWatch (an administrator role in a personal sandbox account is simplest).
- A Region with a **default VPC**. The steps use `us-east-1`; any Region works.
- For the CLI tabs: **AWS CloudShell** (no setup needed, and you will use it in lab 02) or AWS CLI v2 configured with `aws configure` in a Bash shell. Keep the same terminal open for the whole lab because later commands reuse shell variables.
- A web browser.

## Steps

### Step 1: Create the security groups

The load balancer accepts HTTP from anywhere; the instances accept HTTP only from the load balancer's security group.

:::console
1. Open the **EC2** console, choose **Security Groups** under **Network & Security**, then **Create security group**.
2. **Security group name** `demo-asg-alb-sg`, **Description** `ALB: HTTP from anywhere`, keep the default **VPC**.
3. Under **Inbound rules** choose **Add rule**: **Type** **HTTP**, **Source** **Anywhere-IPv4**. Choose **Create security group**.
4. Create a second group named `demo-asg-web-sg` with description `Web: HTTP only from the ALB` in the default VPC.
5. Add an inbound rule: **Type** **HTTP**, **Source** **Custom**, and pick `demo-asg-alb-sg` in the search box. Choose **Create security group**.
:::

:::cli
```bash
REGION=${AWS_REGION:-$(aws configure get region)}
VPC_ID=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true \
  --query 'Vpcs[0].VpcId' --output text)

ALB_SG=$(aws ec2 create-security-group --group-name demo-asg-alb-sg \
  --description "ALB: HTTP from anywhere" --vpc-id "$VPC_ID" \
  --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$ALB_SG" \
  --protocol tcp --port 80 --cidr 0.0.0.0/0

WEB_SG=$(aws ec2 create-security-group --group-name demo-asg-web-sg \
  --description "Web: HTTP only from the ALB" --vpc-id "$VPC_ID" \
  --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$WEB_SG" \
  --protocol tcp --port 80 --source-group "$ALB_SG"
echo "Region: $REGION  VPC: $VPC_ID  ALB SG: $ALB_SG  Web SG: $WEB_SG"
```
:::

> [!CHECK]
> `demo-asg-web-sg` has one inbound rule on port 80 whose source is the security group `demo-asg-alb-sg`, not an IP range.

### Step 2: Create the target group and the load balancer

The target group starts empty: the Auto Scaling group will fill it.

:::console
1. Choose **Target Groups** (under **Load Balancing**) → **Create target group**.
2. **Choose a target type**: **Instances**. **Target group name** `demo-asg-tg`, **Protocol** `HTTP`, **Port** `80`, default **VPC**.
3. Under **Health checks** set **Health check path** to `/health`. Expand **Advanced health check settings** and set **Healthy threshold** to `2` and **Interval** to `10` seconds.
4. Choose **Next**, register **no** targets, and choose **Create target group**.
5. Choose **Load Balancers** → **Create load balancer** → **Application Load Balancer** → **Create**.
6. **Load balancer name** `demo-asg-alb`, **Scheme** **Internet-facing**, **IP address type** **IPv4**.
7. Under **Network mapping** select two AZs, for example `us-east-1a` and `us-east-1b`, with their default subnets. Note which two AZs you picked; the Auto Scaling group will use the same ones.
8. Under **Security groups** remove `default` and select `demo-asg-alb-sg`.
9. Under **Listeners and routing**, keep **HTTP : 80** and set the default action to forward to `demo-asg-tg`. Choose **Create load balancer**.
:::

:::cli
```bash
# Default subnets in the "a" and "b" AZs of the Region (the default VPC has one per AZ).
read SUBNET_A SUBNET_B <<< "$(aws ec2 describe-subnets \
  --filters Name=vpc-id,Values="$VPC_ID" Name=default-for-az,Values=true \
            Name=availability-zone,Values="${REGION}a","${REGION}b" \
  --query 'Subnets[].SubnetId' --output text)"

TG_ARN=$(aws elbv2 create-target-group --name demo-asg-tg \
  --protocol HTTP --port 80 --vpc-id "$VPC_ID" --target-type instance \
  --health-check-path /health --health-check-interval-seconds 10 \
  --healthy-threshold-count 2 \
  --query 'TargetGroups[0].TargetGroupArn' --output text)

ALB_ARN=$(aws elbv2 create-load-balancer --name demo-asg-alb --type application \
  --scheme internet-facing --subnets "$SUBNET_A" "$SUBNET_B" \
  --security-groups "$ALB_SG" \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text)
aws elbv2 create-listener --load-balancer-arn "$ALB_ARN" --protocol HTTP --port 80 \
  --default-actions Type=forward,TargetGroupArn="$TG_ARN" > /dev/null
aws elbv2 wait load-balancer-available --load-balancer-arns "$ALB_ARN"
DNS=$(aws elbv2 describe-load-balancers --load-balancer-arns "$ALB_ARN" \
  --query 'LoadBalancers[0].DNSName' --output text)
echo "Subnets: $SUBNET_A $SUBNET_B  DNS: $DNS"
```
:::

> [!CHECK]
> The load balancer reaches the **Active** state. Opening `http://<DNS name>` now returns **503 Service Temporarily Unavailable**, because the target group has no targets yet.

### Step 3: Create the launch template

Every instance the group launches will run this user data script. It installs Apache and writes a page that shows the instance ID and AZ, plus a `/health` page for the load balancer.

```bash
#!/bin/bash
dnf install -y httpd
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 300")
ID=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)
AZ=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/placement/availability-zone)
echo "<h1>Served by $ID in $AZ</h1>" > /var/www/html/index.html
echo "OK" > /var/www/html/health
systemctl enable --now httpd
```

:::console
1. In the EC2 console choose **Launch Templates** (under **Instances**) → **Create launch template**.
2. **Launch template name** `demo-asg-lt`, **Template version description** `v1 Apache demo`.
3. Under **Auto Scaling guidance**, select the check box so the console flags settings that do not suit Auto Scaling.
4. **Application and OS Images (Amazon Machine Image)**: choose **Quick Start** → **Amazon Linux** → **Amazon Linux 2023 AMI**.
5. **Instance type**: `t3.micro`.
6. **Key pair (login)**: choose **Don't include in launch template** (you will not log in).
7. **Network settings**: leave **Subnet** as **Don't include in launch template**; for **Firewall (security groups)** choose **Select existing security group** and pick `demo-asg-web-sg`.
8. **Resource tags**: add **Key** `Name`, **Value** `demo-asg-web`, **Resource types** **Instances**.
9. Expand **Advanced details**, scroll to **User data** and paste the script above.
10. Choose **Create launch template**.
:::

:::cli
```bash
# Save the user data script above as user-data.sh in the current directory first.
AMI=$(aws ssm get-parameters \
  --names /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --query 'Parameters[0].Value' --output text)
USERDATA=$(base64 -w0 user-data.sh)

cat > lt-data.json <<EOF
{
  "ImageId": "$AMI",
  "InstanceType": "t3.micro",
  "SecurityGroupIds": ["$WEB_SG"],
  "UserData": "$USERDATA",
  "TagSpecifications": [
    { "ResourceType": "instance", "Tags": [ { "Key": "Name", "Value": "demo-asg-web" } ] }
  ]
}
EOF
aws ec2 create-launch-template --launch-template-name demo-asg-lt \
  --version-description "v1 Apache demo" \
  --launch-template-data file://lt-data.json \
  --query 'LaunchTemplate.[LaunchTemplateId,LatestVersionNumber]' --output text
```
:::

> [!CHECK]
> **Launch Templates** lists `demo-asg-lt` with **Default version** 1 and **Latest version** 1. Nothing is running yet: a template launches nothing by itself.

### Step 4: Create the Auto Scaling group

> [!VERIFY] Which wizard page titles the console shows
> Checked on 2026-10-04: AWS pages disagree, and none shows the current console itself. The [launch template procedure](https://docs.aws.amazon.com/autoscaling/ec2/userguide/create-asg-launch-template.html), which also covers newer options such as VPC Lattice and zonal shift, names the page after the network settings **Integrate with other services** and the sizing page **Configure group size and scaling**. The [launch configuration procedure](https://docs.aws.amazon.com/autoscaling/ec2/userguide/create-asg-launch-configuration.html) uses **Configure advanced options** and **Configure group size and scaling policies**, and the [load-balanced application tutorial](https://docs.aws.amazon.com/autoscaling/ec2/userguide/tutorial-ec2-auto-scaling-load-balancer.html) and the [attach a load balancer](https://docs.aws.amazon.com/autoscaling/ec2/userguide/attach-load-balancer-asg.html) page still say **Configure advanced options** even when you start from a launch template. This lab uses a launch template, so expect the first pair. If your console shows the other names, carry on: every field label used below (**Load balancing**, **Health checks**, **Desired capacity**, **Scaling limits**) appears under both versions.

:::console
1. Choose **Auto Scaling Groups** (at the bottom of the EC2 navigation pane) → **Create Auto Scaling group**.
2. On **Choose launch template or configuration**: **Auto Scaling group name** `demo-asg`, **Launch template** `demo-asg-lt`, **Launch template version** **Latest**. Choose **Next**.
3. **Choose instance launch options**: keep the default **VPC**. Under **Availability Zones and subnets**, pick the default subnets of the **same two AZs** as the load balancer. Keep **Availability Zone distribution** at **Balanced best effort** and do not override the launch template's instance type. Choose **Next**.
4. On the integration page, under **Load balancing**, choose **Attach to an existing load balancer**, then **Choose from your load balancer target groups**, and select `demo-asg-tg`.
5. Under **Health checks**, **Additional health check types**, select **Turn on Elastic Load Balancing health checks**. Set **Health check grace period** to `90` seconds. Choose **Next**.
6. On the group size page, set **Desired capacity** `2`; under **Scaling limits** set **Min desired capacity** `1` and **Max desired capacity** `4`. Under **Automatic scaling** keep **No scaling policies** (lab 02 adds one).
7. Under **Additional settings**: in **Monitoring**, turn on group metrics collection within CloudWatch; select the **default instance warmup** option and enter `60` seconds; leave **Auto Scaling group deletion protection** at **None**. Choose **Next**.
8. Skip **Add notifications** and **Add tags** with **Next**, review, and choose **Create Auto Scaling group**.
:::

:::cli
```bash
aws autoscaling create-auto-scaling-group --auto-scaling-group-name demo-asg \
  --launch-template LaunchTemplateName=demo-asg-lt,Version='$Latest' \
  --min-size 1 --max-size 4 --desired-capacity 2 \
  --vpc-zone-identifier "$SUBNET_A,$SUBNET_B" \
  --target-group-arns "$TG_ARN" \
  --health-check-type ELB --health-check-grace-period 90 \
  --default-instance-warmup 60
aws autoscaling enable-metrics-collection --auto-scaling-group-name demo-asg \
  --granularity "1Minute"
```
:::

> [!CHECK]
> Select `demo-asg`. The **Activity** tab shows two **Launching a new EC2 instance** activities that become **Successful**. On **Instance management**, two instances move from `Pending` to `InService`, one in each AZ, with **Health status** `Healthy`. CLI: `aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names demo-asg --query 'AutoScalingGroups[0].Instances[].[InstanceId,AvailabilityZone,LifecycleState,HealthStatus]' --output table`.

> [!TIP]
> If an activity fails because `t3.micro` is not supported in one of your AZs, the default **Balanced best effort** distribution launches in the other AZ instead. For a clean two-AZ setup, delete the group and recreate it (and the load balancer's subnet mapping) with a different AZ.

### Step 5: Confirm automatic registration with the load balancer

:::console
1. Open **Target Groups** → `demo-asg-tg` → **Targets**. You never registered anything by hand, yet two instances are listed.
2. Wait until both show **Healthy** (about a minute after the user data finishes).
3. Open `http://<ALB DNS name>` in a browser and refresh several times.
:::

:::cli
```bash
aws elbv2 describe-target-health --target-group-arn "$TG_ARN" \
  --query 'TargetHealthDescriptions[].[Target.Id,TargetHealth.State]' --output table
for i in 1 2 3 4 5 6; do curl -s "http://$DNS/"; echo; done
```
:::

> [!CHECK]
> Both targets are **healthy** and the page alternates between two instance IDs in two different AZs. The group did the registration for you.

### Step 6: Simulate an instance failure and watch the group heal

You terminate one instance outside Auto Scaling, the way a hardware failure or a mistaken click would.

:::console
1. Go to **Instances**, select one `demo-asg-web` instance, and choose **Instance state** → **Terminate (delete) instance** → **Terminate (delete)**.
2. Return to **Auto Scaling Groups** → `demo-asg` → **Activity** and refresh every 30 seconds.
3. Keep refreshing the ALB DNS name in your browser while this happens.
:::

:::cli
```bash
VICTIM=$(aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names demo-asg \
  --query 'AutoScalingGroups[0].Instances[0].InstanceId' --output text)
aws ec2 terminate-instances --instance-ids "$VICTIM" > /dev/null
echo "Terminated $VICTIM"
sleep 120
aws autoscaling describe-scaling-activities --auto-scaling-group-name demo-asg \
  --max-items 4 --query 'Activities[].[StartTime,StatusCode,Description]' --output table
for i in 1 2 3 4; do curl -s "http://$DNS/"; echo; done
```
:::

> [!CHECK]
> Within a minute or two the **Activity history** shows the terminated instance being taken out of service and a **Launching a new EC2 instance** activity in the same AZ. Meanwhile the site keeps answering from the surviving instance. After a few minutes a new instance ID appears in the target group as **healthy** and responses alternate between two instances again. The desired capacity never changed: the group simply restored it.

### Step 7: Scale manually and see which instance is removed

:::console
1. Select `demo-asg`, open the **Details** tab, choose **Group details** → **Edit**, set **Desired capacity** to `3` and choose **Update**.
2. Watch **Instance management** until three instances are `InService` (two in one AZ, one in the other).
3. Edit **Group details** again and set **Desired capacity** back to `2`.
4. On the **Activity** tab, read the termination activity and note which AZ lost an instance.
:::

:::cli
```bash
aws autoscaling set-desired-capacity --auto-scaling-group-name demo-asg --desired-capacity 3
sleep 150
aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names demo-asg \
  --query 'AutoScalingGroups[0].Instances[].[InstanceId,AvailabilityZone,LifecycleState]' --output table

aws autoscaling set-desired-capacity --auto-scaling-group-name demo-asg --desired-capacity 2
sleep 90
aws autoscaling describe-scaling-activities --auto-scaling-group-name demo-asg \
  --max-items 2 --query 'Activities[].[StatusCode,Description,Cause]' --output text
```
:::

> [!CHECK]
> On scale-in, the group removes an instance from the AZ that had **two** instances, leaving one per AZ. That is the default termination policy keeping AZs balanced before anything else. The instance is deregistered from the target group (and drained) before it terminates, so the termination activity can stay **In progress** for up to 5 minutes, the target group's default deregistration delay. If the CLI output still shows it in progress, run the last command again a little later.

## Cleanup

Skip this section if you are continuing to lab 02; its Cleanup removes everything from both labs. Otherwise delete in this order (deleting the group first stops it relaunching instances):

- [ ] **Auto Scaling group `demo-asg`**: **Auto Scaling Groups** → select it → **Actions** → **Delete**, type `delete`, choose **Delete**. This terminates its instances. CLI: `aws autoscaling delete-auto-scaling-group --auto-scaling-group-name demo-asg --force-delete`. Wait until the group disappears and no `demo-asg-web` instance is running (`aws ec2 describe-instances --filters Name=tag:Name,Values=demo-asg-web Name=instance-state-name,Values=pending,running --query 'Reservations[].Instances[].InstanceId'` returns `[]`).
- [ ] **Launch template `demo-asg-lt`**: **Launch Templates** → select it → **Actions** → **Delete template**, type `Delete`, choose **Delete**. CLI: `aws ec2 delete-launch-template --launch-template-name demo-asg-lt`.
- [ ] **Load balancer `demo-asg-alb`**: **Load Balancers** → select it → **Actions** → **Delete load balancer**, confirm. CLI: `aws elbv2 delete-load-balancer --load-balancer-arn "$ALB_ARN"` (its listener is deleted with it).
- [ ] **Target group `demo-asg-tg`** (after the load balancer is gone): **Target Groups** → select it → **Actions** → **Delete**, confirm. CLI: `aws elbv2 delete-target-group --target-group-arn "$TG_ARN"`.
- [ ] **Security group `demo-asg-web-sg`** (first, because it references the ALB group): **Security Groups** → select → **Actions** → **Delete security groups**. CLI: `aws ec2 delete-security-group --group-id "$WEB_SG"`.
- [ ] **Security group `demo-asg-alb-sg`**: same steps; if it reports a dependency, wait a few minutes for the ALB's network interfaces to disappear and retry. CLI: `aws ec2 delete-security-group --group-id "$ALB_SG"`.
- [ ] **Local files `user-data.sh` and `lt-data.json`** (CLI path): delete them if you no longer need them.
- [ ] **Service-linked role `AWSServiceRoleForAutoScaling`**: created automatically with your first group. It is free and can stay; delete it in IAM only if you use no Auto Scaling groups in any Region.
- [ ] **Final check**: no Auto Scaling groups, load balancers, `demo-asg-*` target groups or running instances remain in this Region; the next day, **Billing and Cost Management** → **Bills** shows no new Elastic Load Balancing or EC2 charges.

## Progress checklist

- [ ] Step 1: Created `demo-asg-alb-sg` and `demo-asg-web-sg` with the security group reference
- [ ] Step 2: Created the empty target group `demo-asg-tg` and the ALB `demo-asg-alb`
- [ ] Step 3: Created launch template `demo-asg-lt` with the user data script
- [ ] Step 4: Created `demo-asg` (min 1, desired 2, max 4) with ELB health checks
- [ ] Step 5: Saw instances registered automatically and traffic alternate across two AZs
- [ ] Step 6: Terminated an instance and watched the group replace it
- [ ] Step 7: Scaled to 3 and back to 2 and saw AZ balance decide the terminated instance
- [ ] Cleanup done (or deferred to lab 02)
