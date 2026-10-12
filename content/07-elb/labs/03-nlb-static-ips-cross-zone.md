---
id: 07-elb-lab-03
title: Network Load Balancer with Elastic IPs and cross-zone load balancing
objective: Front the lab 01 web servers with an internet-facing NLB that uses one Elastic IP per AZ, confirm the fixed addresses, and see how cross-zone load balancing changes which AZ addresses DNS returns.
estimatedTime: 40 minutes
cost: "About USD 0.04 per hour for the NLB and its two Elastic IPs (USD 0.0225 NLB hourly + NLCU usage + 2 x USD 0.005 public IPv4) on top of about USD 0.07 per hour for the lab 01 resources in us-east-1; roughly USD 0.10-0.15 if you clean up within an hour. Inter-AZ data while cross-zone is on is a fraction of a cent for test traffic."
freeTier: partial
services: [nlb, elb, ec2, elastic-ip, security-groups]
---

> [!COST]
> The NLB bills USD 0.0225 per hour plus NLCU usage from creation until deletion, and each Elastic IP address costs USD 0.005 per hour whether attached or idle, so release them in **Cleanup**. Turning on cross-zone load balancing on an NLB adds regional data transfer charges for traffic crossing AZs (negligible here). The lab 01 instances and any remaining ALB keep billing too. NLB usage is not covered by the legacy Free Tier; new accounts pay from Free Tier credits.

An NLB is the answer whenever a scenario needs fixed IP addresses or layer 4 performance. In this lab you will see those fixed addresses for yourself and use DNS to observe what cross-zone load balancing does.

## Prerequisites

- Lab 01 completed without its cleanup: `web-a` and `web-b` are running in two AZs with security group `demo-web-sg`. (The ALB from lab 01 is not needed; you may delete it first to save money.)
- IAM permissions for EC2 (including Elastic IPs) and Elastic Load Balancing, in the same Region as lab 01.
- Your account must have at least two Elastic IP addresses available (the default quota is five per Region).
- `nslookup` (on CloudShell, run `sudo dnf install -y bind-utils` first if the command is not found).
- For the CLI tabs, a Bash shell such as CloudShell. Reload the lab 01 variables if you opened a new terminal:

```bash
VPC_ID=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)
I1=$(aws ec2 describe-instances --filters Name=tag:Name,Values=web-a Name=instance-state-name,Values=running --query 'Reservations[0].Instances[0].InstanceId' --output text)
I2=$(aws ec2 describe-instances --filters Name=tag:Name,Values=web-b Name=instance-state-name,Values=running --query 'Reservations[0].Instances[0].InstanceId' --output text)
SUBNET_A=$(aws ec2 describe-instances --instance-ids "$I1" --query 'Reservations[0].Instances[0].SubnetId' --output text)
SUBNET_B=$(aws ec2 describe-instances --instance-ids "$I2" --query 'Reservations[0].Instances[0].SubnetId' --output text)
WEB_SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=demo-web-sg Name=vpc-id,Values="$VPC_ID" --query 'SecurityGroups[0].GroupId' --output text)
echo "$I1 $I2 $SUBNET_A $SUBNET_B $WEB_SG"
```

## Steps

### Step 1: Allocate two Elastic IP addresses

:::console
1. In the EC2 console choose **Elastic IPs** (under **Network & Security**) → **Allocate Elastic IP address**.
2. Keep **Amazon's pool of IPv4 addresses** and the default network border group, then choose **Allocate**.
3. Repeat once more so you have two addresses. Optionally tag them `demo-nlb-a` and `demo-nlb-b`.
:::

:::cli
```bash
EIP_A=$(aws ec2 allocate-address --domain vpc --query AllocationId --output text)
EIP_B=$(aws ec2 allocate-address --domain vpc --query AllocationId --output text)
aws ec2 describe-addresses --allocation-ids "$EIP_A" "$EIP_B" \
  --query 'Addresses[].[AllocationId,PublicIp]' --output table
```
:::

> [!CHECK]
> Two new Elastic IPs are listed with no **Associated instance ID**. Write down both public IPs; you will meet them again in Step 4.

### Step 2: Create the NLB security group and allow it on the instances

NLBs support security groups only if you attach one when you create the load balancer, so prepare it now.

:::console
1. Choose **Security Groups** → **Create security group**. Name `demo-nlb-sg`, description `NLB: TCP 80 from anywhere`, default **VPC**.
2. **Inbound rules** → **Add rule**: **Type** **HTTP** (TCP 80), **Source** **Anywhere-IPv4**. Choose **Create security group**.
3. Open `demo-web-sg` → **Inbound rules** tab → **Edit inbound rules** → **Add rule**: **Type** **HTTP**, **Source** **Custom**, pick `demo-nlb-sg`. Choose **Save rules**.
:::

:::cli
```bash
NLB_SG=$(aws ec2 create-security-group --group-name demo-nlb-sg \
  --description "NLB: TCP 80 from anywhere" --vpc-id "$VPC_ID" \
  --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$NLB_SG" \
  --protocol tcp --port 80 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id "$WEB_SG" \
  --protocol tcp --port 80 --source-group "$NLB_SG"
```
:::

> [!NOTE]
> The NLB preserves the client's IP for instance targets, so the packets reaching your instances carry the user's address, not the NLB's. Referencing the NLB security group in `demo-web-sg` still works: AWS documents that targets accept NLB traffic through such a reference even with client IP preservation on.

### Step 3: Create a TCP target group

:::console
1. Choose **Target Groups** → **Create target group**.
2. **Choose a target type**: **Instances**. **Target group name**: `demo-nlb-tg`. **Protocol**: **TCP**, **Port**: `80`, default **VPC**.
3. Under **Health checks**, set **Health check protocol** to **HTTP** and **Health check path** to `/health`.
4. Choose **Next**, select `web-a` and `web-b`, choose **Include as pending below**, then **Create target group**.
5. Open `demo-nlb-tg` → **Attributes** tab → **Edit**, set **Deregistration delay** to `30` seconds (so Step 5 does not take 5 minutes) and choose **Save changes**.
:::

:::cli
```bash
NLB_TG_ARN=$(aws elbv2 create-target-group --name demo-nlb-tg \
  --protocol TCP --port 80 --vpc-id "$VPC_ID" --target-type instance \
  --health-check-protocol HTTP --health-check-path /health \
  --query 'TargetGroups[0].TargetGroupArn' --output text)
aws elbv2 register-targets --target-group-arn "$NLB_TG_ARN" --targets Id="$I1" Id="$I2"
aws elbv2 modify-target-group-attributes --target-group-arn "$NLB_TG_ARN" \
  --attributes Key=deregistration_delay.timeout_seconds,Value=30
aws elbv2 describe-target-group-attributes --target-group-arn "$NLB_TG_ARN" \
  --query 'Attributes[?Key==`preserve_client_ip.enabled` || Key==`load_balancing.cross_zone.enabled`]' --output table
```
:::

> [!CHECK]
> On the **Attributes** tab, **Preserve client IP addresses** is on (the default for instance targets) and cross-zone load balancing is set to inherit the load balancer setting.

### Step 4: Create the internet-facing NLB with Elastic IPs

:::console
1. Choose **Load Balancers** → **Create load balancer**. Under **Network Load Balancer**, choose **Create**.
2. **Basic configuration**: **Load balancer name** `demo-nlb`, **Scheme** **Internet-facing**, **Load balancer IP address type** **IPv4**.
3. **Network mapping**: default **VPC**; under **Availability Zones and subnets** select the two AZs and subnets where `web-a` and `web-b` run. For each subnet, change the **IPv4 address** setting from **Assigned by AWS** to **Use an Elastic IP address** and pick one of your two Elastic IPs.
4. **Security groups**: remove `default` and select `demo-nlb-sg`. Do not skip this: an NLB created without a security group can never get one.
5. **Listeners and routing**: **Protocol** **TCP**, **Port** `80`, **Default action** forward to `demo-nlb-tg`.
6. Choose **Create load balancer** and wait until **State** is **Active**.
:::

:::cli
```bash
NLB_ARN=$(aws elbv2 create-load-balancer --name demo-nlb --type network \
  --scheme internet-facing --security-groups "$NLB_SG" \
  --subnet-mappings SubnetId="$SUBNET_A",AllocationId="$EIP_A" SubnetId="$SUBNET_B",AllocationId="$EIP_B" \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text)
aws elbv2 wait load-balancer-available --load-balancer-arns "$NLB_ARN"
aws elbv2 create-listener --load-balancer-arn "$NLB_ARN" --protocol TCP --port 80 \
  --default-actions Type=forward,TargetGroupArn="$NLB_TG_ARN"
NLB_DNS=$(aws elbv2 describe-load-balancers --load-balancer-arns "$NLB_ARN" \
  --query 'LoadBalancers[0].DNSName' --output text)
aws elbv2 describe-load-balancers --load-balancer-arns "$NLB_ARN" \
  --query 'LoadBalancers[0].AvailabilityZones[].[ZoneName,LoadBalancerAddresses[0].IpAddress]' --output table
```
:::

> [!CHECK]
> The load balancer's **Network mapping** shows each AZ with exactly the Elastic IP you chose. After both targets in `demo-nlb-tg` are **Healthy**, `nslookup <NLB DNS name>` returns precisely your two Elastic IPs, and these never change, unlike the ALB's addresses in lab 01.

### Step 5: Test, then remove the only target in one AZ

:::console
1. Open `http://<NLB DNS name>` in a browser (or `http://<Elastic IP>` directly) and refresh a few times. Browsers reuse TCP connections, so you may keep seeing one instance; that is normal for a layer 4 load balancer.
2. In `demo-nlb-tg` → **Targets**, select `web-b`, choose **Deregister** and confirm.
3. Wait about 2–3 minutes (30 seconds of draining, then DNS updates with a 60-second TTL) and run `nslookup <NLB DNS name>` again.
:::

:::cli
```bash
for i in 1 2 3 4; do curl -s "http://$NLB_DNS/"; echo; done
aws elbv2 deregister-targets --target-group-arn "$NLB_TG_ARN" --targets Id="$I2"
for i in 1 2 3 4 5 6; do date +%T; nslookup "$NLB_DNS" | awk '/^Address/ && !/#53/ {print "  " $2}'; sleep 30; done
```
:::

> [!CHECK]
> Before the deregistration, each `curl` opens a new connection to whichever node IP DNS listed first, and each node uses only its own AZ's instance, so you usually see both instances across the four requests. After it, with cross-zone **off** (the NLB default), the AZ where `web-b` lived has no targets, so after a couple of minutes `nslookup` returns **only the Elastic IP of `web-a`'s AZ**: the empty AZ's node can only send to its own AZ, so the NLB withdraws its address from DNS. If the old answer persists, your resolver may be caching; wait another minute and retry.

### Step 6: Turn on cross-zone load balancing

:::console
1. Choose **Load Balancers** → `demo-nlb` → **Attributes** tab → **Edit**.
2. On the **Edit load balancer attributes** page, turn **Cross-zone load balancing** on and choose **Save changes**.
3. Wait 2–3 minutes and run `nslookup <NLB DNS name>` again; then load the page through the Elastic IP of the AZ that has no target (`http://<that Elastic IP>`).
4. Register `web-b` again in `demo-nlb-tg` (**Targets** → **Register targets** → select it → **Include as pending below** → **Register pending targets**).
:::

:::cli
```bash
aws elbv2 modify-load-balancer-attributes --load-balancer-arn "$NLB_ARN" \
  --attributes Key=load_balancing.cross_zone.enabled,Value=true
for i in 1 2 3 4 5 6; do date +%T; nslookup "$NLB_DNS" | awk '/^Address/ && !/#53/ {print "  " $2}'; sleep 30; done
EIP_B_IP=$(aws ec2 describe-addresses --allocation-ids "$EIP_B" --query 'Addresses[0].PublicIp' --output text)
curl -s "http://$EIP_B_IP/"; echo
aws elbv2 register-targets --target-group-arn "$NLB_TG_ARN" --targets Id="$I2"
```
:::

> [!CHECK]
> With cross-zone **on**, the node in the empty AZ may forward to `web-a` in the other AZ, so within a few minutes its Elastic IP should return to the DNS answer, and a request sent straight to that Elastic IP is answered by `web-a`. This is exactly the trade-off from the lesson: better use of all targets, at the cost of inter-AZ data charges on an NLB.

## Cleanup

Delete in this order. This also removes the lab 01 resources; skip those lines only if you deliberately keep them for another lab.

- [ ] **Load balancer `demo-nlb`** (and its TCP:80 listener): **Load Balancers** → select → **Actions** → **Delete load balancer**, enter `confirm`, choose **Delete**. CLI: `aws elbv2 delete-load-balancer --load-balancer-arn "$NLB_ARN"`.
- [ ] **Target group `demo-nlb-tg`**: **Target Groups** → select → **Actions** → **Delete** → **Delete**. CLI: `aws elbv2 delete-target-group --target-group-arn "$NLB_TG_ARN"`.
- [ ] **Elastic IPs** (only after the NLB is fully deleted, otherwise release fails): **Elastic IPs** → select both → **Actions** → **Release Elastic IP addresses** → **Release**. CLI: `aws ec2 release-address --allocation-id "$EIP_A"` and `aws ec2 release-address --allocation-id "$EIP_B"`.
- [ ] **Lab 01 ALB and target group, if they still exist**: delete `demo-alb`, then `demo-web-tg` (and `demo-api-tg` from lab 02), as described in the lab 01 and lab 02 cleanup lists.
- [ ] **Instances `web-a` and `web-b`**: **Instances** → select both → **Instance state** → **Terminate (delete) instance**. CLI: `aws ec2 terminate-instances --instance-ids "$I1" "$I2"`, then `aws ec2 wait instance-terminated --instance-ids "$I1" "$I2"`.
- [ ] **Security groups** in this order: `demo-web-sg` (it references the others), then `demo-nlb-sg`, then `demo-alb-sg`. **Security Groups** → select → **Actions** → **Delete security groups**; retry after a few minutes if a load balancer network interface is still being removed. CLI: `aws ec2 delete-security-group --group-id <id>` for each.
- [ ] **Final check**: **Elastic IPs** is empty (idle Elastic IPs keep billing), no load balancers or `demo-*` target groups remain, no instances are running in this Region; next day, **Billing and Cost Management** → **Bills** shows no new ELB or public IPv4 charges.

## Progress checklist

- [ ] Step 1: Allocated two Elastic IPs
- [ ] Step 2: Created `demo-nlb-sg` and allowed it in `demo-web-sg`
- [ ] Step 3: Created the TCP target group `demo-nlb-tg` with client IP preservation on
- [ ] Step 4: Created `demo-nlb` and saw DNS return exactly my Elastic IPs
- [ ] Step 5: Saw the empty AZ's IP leave DNS with cross-zone off
- [ ] Step 6: Turned cross-zone on and saw the empty AZ's IP serve traffic again
- [ ] Cleanup done, Elastic IPs released
