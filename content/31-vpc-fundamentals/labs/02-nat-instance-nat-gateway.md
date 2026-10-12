---
id: 31-vpc-fundamentals-lab-02
title: Give private subnets outbound internet with a NAT instance, then a NAT gateway
objective: Build a NAT instance on Amazon Linux 2023, see why the source/destination check must be disabled, then replace it with a managed NAT gateway and (optionally) make outbound access zone-independent with one NAT gateway per AZ.
estimatedTime: 50 minutes
cost: "About USD 0.10 per hour in us-east-1 in total: lab 01 resources (about USD 0.03/h), a t3.micro NAT instance with a public IPv4 address (about USD 0.015/h), a NAT gateway (USD 0.045/h, each partial hour billed as a full hour, plus USD 0.045 per GB processed) and its Elastic IP (USD 0.005/h). The optional second NAT gateway adds about USD 0.05/h. Expect roughly USD 0.10-0.20 if you finish and clean up within an hour. NAT gateways are not covered by the legacy Free Tier; new accounts pay from Free Tier credits."
freeTier: partial
services: [nat-instance, nat-gateway, elastic-ip, internet-gateway, security-groups, vpc, ec2, cloudshell]
---

> [!COST]
> The NAT gateway is the expensive part of this lab: USD 0.045 for every hour or partial hour it exists, plus USD 0.045 per GB it processes (a few MB here), plus USD 0.005 per hour for its Elastic IP. A forgotten NAT gateway costs about USD 33 a month. The NAT instance is a `t3.micro` (USD 0.0104 per hour) with a public IPv4 address (USD 0.005 per hour). Lab 01's instances keep running too. Do the **Cleanup** section as soon as you finish; it removes everything from labs 01 and 02.

In lab 01 the private instance `demo-app` could not reach the internet. Here you give it outbound-only access twice: first the old way (a NAT instance you configure yourself), then the managed way (a NAT gateway). The final step builds the highly available pattern with one NAT gateway per AZ.

## Prerequisites

- Lab 01 completed **without** its cleanup: `demo-vpc`, its four subnets, `demo-public-rt`, `demo-private-rt`, `demo-igw`, `demo-bastion-sg`, `demo-app-sg`, the `demo-key` key pair (with `~/demo-key.pem` in CloudShell) and the running instances `demo-bastion` and `demo-app`.
- The same IAM permissions and Region as lab 01, and at least two Elastic IP addresses free in the Region (the default quota is five).
- AWS CloudShell in that Region. If you opened a new session since lab 01, reload the variables and the `hop` helper:

```bash
VPC_ID=$(aws ec2 describe-vpcs --filters Name=tag:Name,Values=demo-vpc --query 'Vpcs[0].VpcId' --output text)
subnet_id() { aws ec2 describe-subnets --filters Name=vpc-id,Values="$VPC_ID" Name=tag:Name,Values="$1" --query 'Subnets[0].SubnetId' --output text; }
PUB_A=$(subnet_id demo-public-a); PUB_B=$(subnet_id demo-public-b)
PRIV_A=$(subnet_id demo-private-a); PRIV_B=$(subnet_id demo-private-b)
rt_id() { aws ec2 describe-route-tables --filters Name=vpc-id,Values="$VPC_ID" Name=tag:Name,Values="$1" --query 'RouteTables[0].RouteTableId' --output text; }
PUB_RT=$(rt_id demo-public-rt); PRIV_RT=$(rt_id demo-private-rt)
IGW_ID=$(aws ec2 describe-internet-gateways --filters Name=attachment.vpc-id,Values="$VPC_ID" --query 'InternetGateways[0].InternetGatewayId' --output text)
sg_id() { aws ec2 describe-security-groups --filters Name=vpc-id,Values="$VPC_ID" Name=group-name,Values="$1" --query 'SecurityGroups[0].GroupId' --output text; }
BASTION_SG=$(sg_id demo-bastion-sg); APP_SG=$(sg_id demo-app-sg)
instance_id() { aws ec2 describe-instances --filters Name=tag:Name,Values="$1" Name=instance-state-name,Values=running --query 'Reservations[0].Instances[0].InstanceId' --output text; }
BASTION_ID=$(instance_id demo-bastion); APP_ID=$(instance_id demo-app)
BASTION_IP=$(aws ec2 describe-instances --instance-ids "$BASTION_ID" --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
APP_IP=$(aws ec2 describe-instances --instance-ids "$APP_ID" --query 'Reservations[0].Instances[0].PrivateIpAddress' --output text)
AMI=$(aws ssm get-parameters --names /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 --query 'Parameters[0].Value' --output text)
MY_IP=$(curl -s https://checkip.amazonaws.com)
aws ec2 authorize-security-group-ingress --group-id "$BASTION_SG" --protocol tcp --port 22 --cidr "$MY_IP/32" 2>/dev/null || echo "SSH rule for $MY_IP already present"
hop() {
  local target=$1; shift
  ssh -i ~/demo-key.pem -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 \
    -o ProxyCommand="ssh -i ~/demo-key.pem -o StrictHostKeyChecking=accept-new -W %h:%p ec2-user@$BASTION_IP" \
    ec2-user@"$target" "$@"
}
echo "$VPC_ID $PUB_A $PRIV_RT $BASTION_IP $APP_IP"
```

## Steps

### Step 1: Create a security group for the NAT instance

A NAT instance, unlike a NAT gateway, has a security group you must design. It accepts web traffic from the private subnets, lets the bastion in for administration, and sends only HTTP and HTTPS out.

:::console
1. In the **EC2** console choose **Security Groups** → **Create security group**. Name `demo-nat-sg`, description `NAT instance: web traffic from private subnets`, **VPC** `demo-vpc`.
2. Under **Inbound rules**, add five rules with **Add rule**:
   - **HTTP**, **Source** **Custom** `10.0.16.0/20`
   - **HTTPS**, **Source** **Custom** `10.0.16.0/20`
   - **HTTP**, **Source** **Custom** `10.0.32.0/20`
   - **HTTPS**, **Source** **Custom** `10.0.32.0/20`
   - **SSH**, **Source** **Custom** → `demo-bastion-sg`
3. Under **Outbound rules**, choose **Delete** on the default **All traffic** rule, then add **HTTP** and **HTTPS**, each with **Destination** **Custom** `0.0.0.0/0`.
4. Choose **Create security group**.
:::

:::cli
```bash
NAT_SG=$(aws ec2 create-security-group --group-name demo-nat-sg \
  --description "NAT instance: web traffic from private subnets" --vpc-id "$VPC_ID" \
  --query GroupId --output text)
for CIDR in 10.0.16.0/20 10.0.32.0/20; do
  aws ec2 authorize-security-group-ingress --group-id "$NAT_SG" --protocol tcp --port 80 --cidr "$CIDR"
  aws ec2 authorize-security-group-ingress --group-id "$NAT_SG" --protocol tcp --port 443 --cidr "$CIDR"
done
aws ec2 authorize-security-group-ingress --group-id "$NAT_SG" --protocol tcp --port 22 --source-group "$BASTION_SG"

aws ec2 revoke-security-group-egress --group-id "$NAT_SG" \
  --ip-permissions 'IpProtocol=-1,IpRanges=[{CidrIp=0.0.0.0/0}]'
aws ec2 authorize-security-group-egress --group-id "$NAT_SG" \
  --ip-permissions 'IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0}]' \
                   'IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}]'
echo "$NAT_SG"
```
:::

> [!CHECK]
> `demo-nat-sg` has five inbound rules and exactly two outbound rules (TCP 80 and 443 to `0.0.0.0/0`). This matches the rule set AWS documents for a NAT instance (HTTP/HTTPS in from the private subnets, SSH in for administration, HTTP/HTTPS out to the internet), except that SSH comes from the bastion's security group instead of your network's public range.

### Step 2: Launch the NAT instance

AWS no longer offers a supported ready-made NAT AMI, so a user data script turns a plain Amazon Linux 2023 instance into a NAT device: it installs `iptables-services`, switches on IP forwarding, and adds a masquerade rule on the primary network interface.

User data script:

```bash
#!/bin/bash
dnf install -y iptables-services
systemctl enable --now iptables
echo "net.ipv4.ip_forward=1" > /etc/sysctl.d/custom-ip-forwarding.conf
sysctl -p /etc/sysctl.d/custom-ip-forwarding.conf
IFACE=$(ip route show default | awk '{print $5; exit}')
iptables -t nat -A POSTROUTING -o "$IFACE" -j MASQUERADE
iptables -F FORWARD
iptables-save > /etc/sysconfig/iptables
```

:::console
1. In the EC2 console choose **Instances** → **Launch instances**.
2. **Name** `demo-nat`, **Amazon Linux 2023**, **t3.micro**, **Key pair (login)** `demo-key`.
3. Under **Network settings** choose **Edit**: **VPC** `demo-vpc`, **Subnet** `demo-public-a`, **Auto-assign public IP** **Enable**, **Firewall (security groups)** → **Select existing security group** → `demo-nat-sg`.
4. Expand **Advanced details**, paste the script above into **User data**, and choose **Launch instance**.
:::

:::cli
```bash
cat > nat-user-data.sh <<'EOF'
#!/bin/bash
dnf install -y iptables-services
systemctl enable --now iptables
echo "net.ipv4.ip_forward=1" > /etc/sysctl.d/custom-ip-forwarding.conf
sysctl -p /etc/sysctl.d/custom-ip-forwarding.conf
IFACE=$(ip route show default | awk '{print $5; exit}')
iptables -t nat -A POSTROUTING -o "$IFACE" -j MASQUERADE
iptables -F FORWARD
iptables-save > /etc/sysconfig/iptables
EOF

NAT_ID=$(aws ec2 run-instances --image-id "$AMI" --instance-type t3.micro \
  --key-name demo-key --subnet-id "$PUB_A" --security-group-ids "$NAT_SG" \
  --user-data file://nat-user-data.sh \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=demo-nat}]' \
  --query 'Instances[0].InstanceId' --output text)
aws ec2 wait instance-running --instance-ids "$NAT_ID"
NAT_PRIV_IP=$(aws ec2 describe-instances --instance-ids "$NAT_ID" \
  --query 'Reservations[0].Instances[0].PrivateIpAddress' --output text)
NAT_PUB_IP=$(aws ec2 describe-instances --instance-ids "$NAT_ID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
echo "NAT instance $NAT_ID: private $NAT_PRIV_IP, public $NAT_PUB_IP"
```
:::

Wait about two minutes for the script to finish, then inspect the instance through the bastion (console users: set `NAT_ID`, `NAT_PRIV_IP` and `NAT_PUB_IP` in CloudShell from the instance's details page first):

```bash
hop "$NAT_PRIV_IP" 'sysctl net.ipv4.ip_forward; sudo iptables -t nat -S POSTROUTING'
```

> [!CHECK]
> The output shows `net.ipv4.ip_forward = 1` and a line like `-A POSTROUTING -o ens5 -j MASQUERADE` (the interface name may differ). The instance has both a private address in `10.0.0.0/24` and a public IPv4 address. The documentation accepts either an auto-assigned public IP or an Elastic IP for a NAT instance; an Elastic IP simply keeps the address stable across stops and starts.

### Step 3: Route the private subnets through the NAT instance

:::console
1. In the **VPC** console open **Route tables** → `demo-private-rt` → **Routes** → **Edit routes** → **Add route**.
2. **Destination** `0.0.0.0/0`; **Target** **Instance**, then choose `demo-nat`. Choose **Save changes**.
:::

:::cli
```bash
aws ec2 create-route --route-table-id "$PRIV_RT" --destination-cidr-block 0.0.0.0/0 --instance-id "$NAT_ID"
```
:::

Now test from the private instance:

```bash
hop "$APP_IP" 'curl -s -m 10 https://checkip.amazonaws.com || echo "no internet access"'
```

> [!CHECK]
> It still prints **no internet access**. The route is correct and the instance forwards packets in software, but EC2 itself drops them first: by default an instance may only send and receive traffic that it is the source or destination of, and these packets are addressed to `checkip.amazonaws.com`, not to `demo-nat`.

### Step 4: Disable the source/destination check

:::console
1. In the **EC2** console choose **Instances** and select `demo-nat`.
2. Choose **Actions** → **Networking** → **Change source/destination check**.
3. For **Source/destination checking**, select **Stop**, then choose **Save**.
:::

:::cli
```bash
aws ec2 modify-instance-attribute --instance-id "$NAT_ID" --source-dest-check '{"Value": false}'
aws ec2 describe-instances --instance-ids "$NAT_ID" \
  --query 'Reservations[0].Instances[0].SourceDestCheck'
```
:::

Repeat the test:

```bash
hop "$APP_IP" 'curl -s -m 10 https://checkip.amazonaws.com || echo "no internet access"'
echo "NAT instance public IP: $NAT_PUB_IP"
```

> [!CHECK]
> The private instance now prints the NAT instance's **public** IP address: the internet sees the NAT device, never `10.0.16.x`. `SourceDestCheck` reports `false`. You have now done every step that marks a NAT instance on the exam: public subnet, public or Elastic IP, a route from the private subnets, a security group you manage, and the source/destination check disabled. You also own its patching, its bandwidth (limited by `t3.micro`) and its failover.

### Step 5: Create a NAT gateway in the public subnet

:::console
1. In the **VPC** console choose **NAT gateways** → **Create NAT gateway**.
2. **Name** `demo-natgw-a`. For **Availability mode** choose **Zonal**.
3. **Subnet** `demo-public-a` (a public subnet, never a private one). **Connectivity type** **Public**.
4. For **Elastic IP allocation ID** choose **Allocate Elastic IP**.
5. Choose **Create NAT gateway** and wait until the **State** changes from **Pending** to **Available** (a few minutes).
:::

:::cli
```bash
EIP_A=$(aws ec2 allocate-address --domain vpc \
  --tag-specifications 'ResourceType=elastic-ip,Tags=[{Key=Name,Value=demo-natgw-a-eip}]' \
  --query AllocationId --output text)
NATGW_A=$(aws ec2 create-nat-gateway --subnet-id "$PUB_A" --allocation-id "$EIP_A" \
  --tag-specifications 'ResourceType=natgateway,Tags=[{Key=Name,Value=demo-natgw-a}]' \
  --query NatGateway.NatGatewayId --output text)
aws ec2 wait nat-gateway-available --nat-gateway-ids "$NATGW_A"
aws ec2 describe-nat-gateways --nat-gateway-ids "$NATGW_A" \
  --query 'NatGateways[0].[State,ConnectivityType,SubnetId,NatGatewayAddresses[0].PublicIp,NatGatewayAddresses[0].PrivateIp]' \
  --output table
```
:::

> [!CHECK]
> The NAT gateway is **Available** with a primary public IPv4 address (your new Elastic IP) and a private address from `10.0.0.0/24`. Look for a security group setting: there is none, because NAT gateways do not support security groups. In **EC2** → **Network Interfaces** you can find the requester-managed interface AWS created for it (its description contains the NAT gateway ID).

### Step 6: Switch the private route to the NAT gateway

:::console
1. In **Route tables** open `demo-private-rt` → **Routes** → **Edit routes**.
2. On the `0.0.0.0/0` row, change **Target** to **NAT Gateway** and choose `demo-natgw-a`. Choose **Save changes**.
3. In the **EC2** console select `demo-nat` and choose **Instance state** → **Stop instance** → **Stop**.
:::

:::cli
```bash
aws ec2 replace-route --route-table-id "$PRIV_RT" --destination-cidr-block 0.0.0.0/0 --nat-gateway-id "$NATGW_A"
aws ec2 stop-instances --instance-ids "$NAT_ID"
```
:::

Test from both the private instance and the bastion:

```bash
NATGW_IP=$(aws ec2 describe-nat-gateways --nat-gateway-ids "$NATGW_A" \
  --query 'NatGateways[0].NatGatewayAddresses[0].PublicIp' --output text)
echo "NAT gateway Elastic IP: $NATGW_IP   Bastion public IP: $BASTION_IP"
hop "$APP_IP" 'curl -s -m 10 https://checkip.amazonaws.com || echo "no internet access"'
ssh -i ~/demo-key.pem -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 ec2-user@"$BASTION_IP" 'curl -s -m 10 https://checkip.amazonaws.com'
```

(Console users: copy the NAT gateway ID into `NATGW_A` first.)

> [!CHECK]
> The private instance now reports the NAT gateway's **Elastic IP**, and it keeps working with `demo-nat` stopped. The bastion, which sits in the **same subnet** as the NAT gateway, still reports its **own** public IP: its subnet's route table sends `0.0.0.0/0` straight to the internet gateway, so instances in the NAT gateway's subnet never use it. The path for private traffic is private subnet → NAT gateway → internet gateway.

### Step 7 (optional): One NAT gateway per AZ

Right now both private subnets use `demo-natgw-a` in the first AZ. If that AZ failed, `demo-private-b` would lose internet access too. The resilient pattern gives each AZ its own NAT gateway and route table.

> [!COST]
> A second NAT gateway and Elastic IP add about USD 0.05 per hour, billed for at least one hour.

:::console
1. Create a second NAT gateway exactly as in Step 5, named `demo-natgw-b`, in subnet `demo-public-b`, with a newly allocated Elastic IP. Wait for **Available**.
2. In **Route tables** choose **Create route table**: **Name** `demo-private-rt-b`, **VPC** `demo-vpc`, **Create route table**.
3. **Routes** → **Edit routes** → **Add route**: **Destination** `0.0.0.0/0`, **Target** **NAT Gateway** → `demo-natgw-b`. **Save changes**.
4. **Subnet associations** → **Edit subnet associations** → select `demo-private-b` → **Save associations**. This moves the subnet off `demo-private-rt`.
:::

:::cli
```bash
EIP_B=$(aws ec2 allocate-address --domain vpc \
  --tag-specifications 'ResourceType=elastic-ip,Tags=[{Key=Name,Value=demo-natgw-b-eip}]' \
  --query AllocationId --output text)
NATGW_B=$(aws ec2 create-nat-gateway --subnet-id "$PUB_B" --allocation-id "$EIP_B" \
  --tag-specifications 'ResourceType=natgateway,Tags=[{Key=Name,Value=demo-natgw-b}]' \
  --query NatGateway.NatGatewayId --output text)
aws ec2 wait nat-gateway-available --nat-gateway-ids "$NATGW_B"

PRIV_RT_B=$(aws ec2 create-route-table --vpc-id "$VPC_ID" \
  --tag-specifications 'ResourceType=route-table,Tags=[{Key=Name,Value=demo-private-rt-b}]' \
  --query RouteTable.RouteTableId --output text)
aws ec2 create-route --route-table-id "$PRIV_RT_B" --destination-cidr-block 0.0.0.0/0 --nat-gateway-id "$NATGW_B"

# demo-private-b is already associated with demo-private-rt, so replace that association.
ASSOC_B=$(aws ec2 describe-route-tables --route-table-ids "$PRIV_RT" \
  --query "RouteTables[0].Associations[?SubnetId=='$PRIV_B'].RouteTableAssociationId | [0]" --output text)
aws ec2 replace-route-table-association --association-id "$ASSOC_B" --route-table-id "$PRIV_RT_B"
```
:::

> [!CHECK]
> The VPC **Resource map** shows `demo-private-a` → `demo-private-rt` → `demo-natgw-a` and `demo-private-b` → `demo-private-rt-b` → `demo-natgw-b`, each NAT gateway in its own AZ's public subnet. No failover logic is needed: if an AZ goes down, its instances go with it, and the other AZ keeps its own path out. (The newer **Regional** availability mode reaches the same goal with a single NAT gateway that needs no public subnet; it is described in the lesson.)

## Cleanup

This removes everything from labs 01 and 02. If your CloudShell session restarted, run the reload block from **Prerequisites** first, then these lookups (they print `None` for anything you did not create, such as the Step 7 resources):

```bash
NAT_ID=$(aws ec2 describe-instances --filters Name=tag:Name,Values=demo-nat Name=instance-state-name,Values=running,stopped --query 'Reservations[0].Instances[0].InstanceId' --output text)
NAT_SG=$(sg_id demo-nat-sg)
NATGW_A=$(aws ec2 describe-nat-gateways --filter Name=tag:Name,Values=demo-natgw-a Name=state,Values=available --query 'NatGateways[0].NatGatewayId' --output text)
NATGW_B=$(aws ec2 describe-nat-gateways --filter Name=tag:Name,Values=demo-natgw-b Name=state,Values=available --query 'NatGateways[0].NatGatewayId' --output text)
EIP_A=$(aws ec2 describe-addresses --filters Name=tag:Name,Values=demo-natgw-a-eip --query 'Addresses[0].AllocationId' --output text)
EIP_B=$(aws ec2 describe-addresses --filters Name=tag:Name,Values=demo-natgw-b-eip --query 'Addresses[0].AllocationId' --output text)
PRIV_RT_B=$(rt_id demo-private-rt-b)
echo "$NAT_ID $NAT_SG $NATGW_A $NATGW_B $EIP_A $EIP_B $PRIV_RT_B"
```

Delete in this order (in the CLI commands, leave out any ID that is empty or `None`):

- [ ] **NAT gateways `demo-natgw-a` and `demo-natgw-b`**: VPC console → **NAT gateways** → select one → **Actions** → **Delete NAT gateway** → type `delete` → **Delete**; repeat for the other. CLI: `aws ec2 delete-nat-gateway --nat-gateway-id "$NATGW_A"` (and `"$NATGW_B"`), then `aws ec2 wait nat-gateway-deleted --nat-gateway-ids "$NATGW_A" "$NATGW_B"` (drop `"$NATGW_B"` if you skipped Step 7). Deleted gateways stay visible with state **Deleted** for about an hour; that is normal and free.
- [ ] **Elastic IPs `demo-natgw-a-eip` and `demo-natgw-b-eip`** (only after the NAT gateways show **Deleted**; deleting a NAT gateway does not release its address, and an idle Elastic IP keeps billing): EC2 console → **Elastic IPs** → select → **Actions** → **Release Elastic IP addresses** → **Release**. CLI: `aws ec2 release-address --allocation-id "$EIP_A"` (and `"$EIP_B"`).
- [ ] **Instances `demo-nat`, `demo-bastion` and `demo-app`**: EC2 console → **Instances** → select all three → **Instance state** → **Terminate (delete) instance** → **Terminate (delete)**. CLI: `aws ec2 terminate-instances --instance-ids "$NAT_ID" "$BASTION_ID" "$APP_ID"` then `aws ec2 wait instance-terminated --instance-ids "$NAT_ID" "$BASTION_ID" "$APP_ID"`.
- [ ] **Key pair `demo-key`** and **local files**: EC2 console → **Key Pairs** → select → **Actions** → **Delete** → type `Delete` → **Delete**. CLI: `aws ec2 delete-key-pair --key-name demo-key`. In CloudShell: `rm -f ~/demo-key.pem nat-user-data.sh`.
- [ ] **Security groups `demo-nat-sg` and `demo-app-sg`, then `demo-bastion-sg`** (the first two reference the bastion group): EC2 console → **Security Groups** → select → **Actions** → **Delete security groups** → **Delete**. CLI: `aws ec2 delete-security-group --group-id "$NAT_SG"`, then `"$APP_SG"`, then `"$BASTION_SG"`. (Console users can skip this: deleting the VPC removes them.)
- [ ] **VPC `demo-vpc`** together with subnets `demo-public-a`, `demo-public-b`, `demo-private-a`, `demo-private-b`, route tables `demo-public-rt`, `demo-private-rt`, `demo-private-rt-b` and internet gateway `demo-igw`: VPC console → **Your VPCs** → select → **Actions** → **Delete VPC** → review the list → type `delete` → **Delete**. If it reports remaining dependencies, wait a few minutes for the NAT gateway interfaces to disappear and retry. CLI, in this order:

```bash
for S in "$PUB_A" "$PUB_B" "$PRIV_A" "$PRIV_B"; do aws ec2 delete-subnet --subnet-id "$S"; done
for RT in "$PUB_RT" "$PRIV_RT" "$PRIV_RT_B"; do
  if [ -n "$RT" ] && [ "$RT" != "None" ]; then aws ec2 delete-route-table --route-table-id "$RT"; fi
done
aws ec2 detach-internet-gateway --internet-gateway-id "$IGW_ID" --vpc-id "$VPC_ID"
aws ec2 delete-internet-gateway --internet-gateway-id "$IGW_ID"
aws ec2 delete-vpc --vpc-id "$VPC_ID"
```

- [ ] **Final check**: **NAT gateways** shows only **Deleted** entries, **Elastic IPs** lists none of the `demo-*` addresses, **Instances** shows no running `demo-*` instances and **Your VPCs** no longer lists `demo-vpc`. The next day, **Billing and Cost Management** → **Bills** shows no new NAT gateway hours.

## Progress checklist

- [ ] Step 1: Created `demo-nat-sg` with HTTP/HTTPS from the private subnets and HTTP/HTTPS out only
- [ ] Step 2: Launched `demo-nat` and confirmed IP forwarding and the masquerade rule
- [ ] Step 3: Routed `demo-private-rt` to the NAT instance and saw traffic still fail
- [ ] Step 4: Disabled the source/destination check and saw the NAT instance's public IP from `demo-app`
- [ ] Step 5: Created `demo-natgw-a` with an Elastic IP in `demo-public-a`
- [ ] Step 6: Switched the route to the NAT gateway, stopped the NAT instance, and saw the bastion bypass the NAT gateway
- [ ] Step 7 (optional): Built one NAT gateway and one private route table per AZ
- [ ] Cleanup done for labs 01 and 02
