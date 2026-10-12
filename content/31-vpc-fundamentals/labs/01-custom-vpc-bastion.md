---
id: 31-vpc-fundamentals-lab-01
title: Build a custom VPC with public and private subnets and a bastion host
objective: Create a VPC from scratch with two public and two private subnets, make the public ones reachable through an internet gateway and route tables, then reach a private instance by hopping through a bastion host.
estimatedTime: 60 minutes
cost: "About USD 0.03 per hour in us-east-1 (two t3.micro instances at USD 0.0104/h each, one public IPv4 address at USD 0.005/h, two small gp3 root volumes); a few cents if you clean up within an hour. The VPC, subnets, route tables, internet gateway, security groups and key pair are free. Covered by Free Tier credits (accounts from 15 July 2025) or the legacy 12-month Free Tier."
freeTier: partial
services: [vpc, subnet, internet-gateway, security-groups, bastion-host, ec2, cloudshell]
---

> [!COST]
> The network pieces you build here (VPC, subnets, route tables, internet gateway, security groups) cost nothing. What bills is compute and addressing: two `t3.micro` instances (USD 0.0104 per hour each, On-Demand in us-east-1), one public IPv4 address on the bastion (USD 0.005 per hour) and two 8 GB gp3 root volumes (USD 0.08 per GB-month, a fraction of a cent per hour). New accounts pay from Free Tier credits; legacy Free Tier accounts stay within the 750-hour allowances. Labs 02 and 03 reuse everything built here, so skip the **Cleanup** section only if you continue straight away.

You will build the network that the lesson describes, one piece at a time, and test each piece as you go. The target design:

| Name | CIDR | AZ | Route table | Purpose |
|---|---|---|---|---|
| `demo-vpc` | `10.0.0.0/16` | all | main (local only) | The VPC |
| `demo-public-a` | `10.0.0.0/24` | first AZ | `demo-public-rt` | Bastion host (later a NAT device) |
| `demo-public-b` | `10.0.1.0/24` | second AZ | `demo-public-rt` | Second public subnet for high availability |
| `demo-private-a` | `10.0.16.0/20` | first AZ | `demo-private-rt` | Private application instance |
| `demo-private-b` | `10.0.32.0/20` | second AZ | `demo-private-rt` | Second private subnet |

All SSH commands run in **AWS CloudShell**, so the steps are the same on Windows, macOS and Linux.

## Prerequisites

- An AWS account and an IAM identity that can manage VPC and EC2 resources (for example the `AmazonEC2FullAccess` managed policy, which covers both) and use CloudShell (`AWSCloudShellFullAccess`). The CLI path also looks up the latest Amazon Linux 2023 AMI in the public Systems Manager parameter store, which needs `ssm:GetParameters`; `AmazonEC2FullAccess` does not include it, so add it (for example with the `AmazonSSMReadOnlyAccess` managed policy) or use an identity with broader rights such as `AdministratorAccess`.
- A Region where CloudShell is available. The examples use `us-east-1`; any Region with at least two AZs works.
- Fewer than 5 VPCs in that Region (the default quota), because this lab creates one more.
- AWS CloudShell open in the same Region (choose the **CloudShell** icon in the console navigation bar). It has the AWS CLI v2, `curl` and an OpenSSH client preinstalled. Keep the same CloudShell tab for the whole lab, because later commands reuse shell variables; if the session restarts, the reload block at the top of lab 02 restores them.

## Steps

### Step 1: Create the VPC

:::console
1. Open the **VPC** console and choose **Create VPC** on the VPC dashboard (or **Your VPCs** → **Create VPC**).
2. For **Resources to create**, choose **VPC only**.
3. For **Name tag**, enter `demo-vpc`.
4. For **IPv4 CIDR block**, keep **IPv4 CIDR manual input** and enter `10.0.0.0/16`.
5. Keep **No IPv6 CIDR block** and **Tenancy** **Default**, then choose **Create VPC**.
6. On the new VPC's page, choose **Actions** → **Edit VPC settings**, select **Enable** for **DNS hostnames**, and choose **Save changes**.
:::

:::cli
```bash
# Two AZs in this Region that offer t3.micro (not every AZ does).
read AZ_A AZ_B <<< "$(aws ec2 describe-instance-type-offerings --location-type availability-zone \
  --filters Name=instance-type,Values=t3.micro \
  --query 'sort(InstanceTypeOfferings[].Location)[0:2]' --output text)"
echo "Using $AZ_A and $AZ_B"

VPC_ID=$(aws ec2 create-vpc --cidr-block 10.0.0.0/16 \
  --tag-specifications 'ResourceType=vpc,Tags=[{Key=Name,Value=demo-vpc}]' \
  --query Vpc.VpcId --output text)
aws ec2 modify-vpc-attribute --vpc-id "$VPC_ID" --enable-dns-hostnames '{"Value":true}'
echo "$VPC_ID"
```
:::

> [!CHECK]
> Open the VPC's **Resource map** tab: AWS has already created a **main route table** with a single `10.0.0.0/16 → local` route, plus a default network ACL and a default security group, even though you asked for "VPC only". Before your edit, **DNS hostnames** showed **Disabled**: only default VPCs have it on, and without it instances get no public DNS name.

### Step 2: Create four subnets in two AZs

:::console
1. In the navigation pane choose **Subnets** → **Create subnet**.
2. For **VPC ID**, choose `demo-vpc`.
3. For **Subnet name** enter `demo-public-a`, for **Availability Zone** pick the first AZ (for example `us-east-1a`), and for **IPv4 CIDR block** keep **Manual input** and enter `10.0.0.0/24`. Choose **Create subnet**.
4. Repeat for the other three subnets:
   - `demo-public-b`, second AZ (for example `us-east-1b`), `10.0.1.0/24`
   - `demo-private-a`, first AZ, `10.0.16.0/20`
   - `demo-private-b`, second AZ, `10.0.32.0/20`
5. Select `demo-public-a`, choose **Actions** → **Edit subnet settings**, select **Enable auto-assign public IPv4 address**, and choose **Save**. Do the same for `demo-public-b`. Leave the private subnets unchanged.
:::

:::cli
```bash
mk_subnet() {  # name, CIDR, AZ
  aws ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block "$2" --availability-zone "$3" \
    --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=$1}]" \
    --query Subnet.SubnetId --output text
}
PUB_A=$(mk_subnet demo-public-a 10.0.0.0/24 "$AZ_A")
PUB_B=$(mk_subnet demo-public-b 10.0.1.0/24 "$AZ_B")
PRIV_A=$(mk_subnet demo-private-a 10.0.16.0/20 "$AZ_A")
PRIV_B=$(mk_subnet demo-private-b 10.0.32.0/20 "$AZ_B")

aws ec2 modify-subnet-attribute --subnet-id "$PUB_A" --map-public-ip-on-launch
aws ec2 modify-subnet-attribute --subnet-id "$PUB_B" --map-public-ip-on-launch

aws ec2 describe-subnets --filters Name=vpc-id,Values="$VPC_ID" \
  --query 'Subnets[].[Tags[?Key==`Name`]|[0].Value,CidrBlock,AvailabilityZone,AvailableIpAddressCount,MapPublicIpOnLaunch]' \
  --output table
```
:::

> [!CHECK]
> The **Available IPv4 addresses** column shows **251** for each `/24` and **4091** for each `/20`: 256 − 5 and 4,096 − 5, because AWS keeps five addresses in every subnet. At this point all four subnets are *private*: they use the main route table, which has only the local route, so "public" in their names is just a label for now.

### Step 3: Create and attach an internet gateway

:::console
1. In the navigation pane choose **Internet gateways** → **Create internet gateway**.
2. For **Name tag** enter `demo-igw` and choose **Create internet gateway**.
3. In the banner at the top choose **Attach to a VPC** (or **Actions** → **Attach to VPC**), select `demo-vpc`, and choose **Attach internet gateway**.
:::

:::cli
```bash
IGW_ID=$(aws ec2 create-internet-gateway \
  --tag-specifications 'ResourceType=internet-gateway,Tags=[{Key=Name,Value=demo-igw}]' \
  --query InternetGateway.InternetGatewayId --output text)
aws ec2 attach-internet-gateway --internet-gateway-id "$IGW_ID" --vpc-id "$VPC_ID"
aws ec2 describe-internet-gateways --internet-gateway-ids "$IGW_ID" \
  --query 'InternetGateways[0].Attachments' --output table
```
:::

> [!CHECK]
> The gateway's **State** is **Attached**, and its **VPC ID** column shows `demo-vpc`. That pairing is exclusive: a VPC takes only one internet gateway at a time, and a gateway attaches to only one VPC. Attaching changed no routes, so the subnets are still private.

### Step 4: Create a public and a private route table

:::console
1. In the navigation pane choose **Route tables** → **Create route table**. For **Name** enter `demo-public-rt`, for **VPC** choose `demo-vpc`, and choose **Create route table**.
2. On the **Routes** tab choose **Edit routes** → **Add route**. For **Destination** enter `0.0.0.0/0`; for **Target** choose **Internet Gateway** and then `demo-igw`. Choose **Save changes**.
3. On the **Subnet associations** tab choose **Edit subnet associations**, select `demo-public-a` and `demo-public-b`, and choose **Save associations**.
4. Choose **Route tables** → **Create route table** again. Name it `demo-private-rt`, VPC `demo-vpc`, and choose **Create route table**. Do not add any route.
5. On its **Subnet associations** tab choose **Edit subnet associations**, select `demo-private-a` and `demo-private-b`, and choose **Save associations**.
:::

:::cli
```bash
mk_rt() {
  aws ec2 create-route-table --vpc-id "$VPC_ID" \
    --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=$1}]" \
    --query RouteTable.RouteTableId --output text
}
PUB_RT=$(mk_rt demo-public-rt)
aws ec2 create-route --route-table-id "$PUB_RT" --destination-cidr-block 0.0.0.0/0 --gateway-id "$IGW_ID"
aws ec2 associate-route-table --route-table-id "$PUB_RT" --subnet-id "$PUB_A"
aws ec2 associate-route-table --route-table-id "$PUB_RT" --subnet-id "$PUB_B"

PRIV_RT=$(mk_rt demo-private-rt)
aws ec2 associate-route-table --route-table-id "$PRIV_RT" --subnet-id "$PRIV_A"
aws ec2 associate-route-table --route-table-id "$PRIV_RT" --subnet-id "$PRIV_B"

aws ec2 describe-route-tables --route-table-ids "$PUB_RT" "$PRIV_RT" \
  --query 'RouteTables[].[Tags[?Key==`Name`]|[0].Value,Routes[].[DestinationCidrBlock,GatewayId]]' --output json
```
:::

> [!CHECK]
> `demo-public-rt` has two routes (`10.0.0.0/16 → local` and `0.0.0.0/0 → igw-…`) and two explicit subnet associations; `demo-private-rt` has only the local route. The VPC's **Resource map** now draws the public subnets flowing to the internet gateway. The main route table still has no explicit associations, which is the recommended state: any subnet you forget to associate stays private.

### Step 5: Prepare CloudShell (key pair and your IP address)

Create the key pair from CloudShell so the private key lands where you will run `ssh`, and record the public address CloudShell connects from.

```bash
aws ec2 create-key-pair --key-name demo-key --key-type ed25519 \
  --query KeyMaterial --output text > ~/demo-key.pem
chmod 400 ~/demo-key.pem
MY_IP=$(curl -s https://checkip.amazonaws.com)
echo "CloudShell connects from $MY_IP"
```

> [!NOTE]
> If you prefer the console, create an ED25519 key pair named `demo-key` in **EC2** → **Key Pairs** → **Create key pair** with format **.pem**, then upload the downloaded file with CloudShell's **Actions** → **Upload file** and run `chmod 400 ~/demo-key.pem`. The CloudShell address can change when the environment restarts; if SSH suddenly times out later, re-run the `MY_IP` line and update the bastion's security group rule.

> [!CHECK]
> `ls -l ~/demo-key.pem` shows `-r--------`, and `MY_IP` holds one IPv4 address. You will allow SSH from exactly that `/32`.

### Step 6: Create the bastion and application security groups

:::console
1. Open the **EC2** console and choose **Security Groups** → **Create security group**.
2. Name `demo-bastion-sg`, description `Bastion: SSH from one admin IP`, **VPC** `demo-vpc`.
3. Under **Inbound rules** choose **Add rule**: **Type** **SSH**, **Source** **Custom**, and enter the CloudShell address from Step 5 followed by `/32`. Choose **Create security group**.
4. Choose **Create security group** again. Name `demo-app-sg`, description `App: SSH only from the bastion`, **VPC** `demo-vpc`.
5. Under **Inbound rules** choose **Add rule**: **Type** **SSH**, **Source** **Custom**, and pick `demo-bastion-sg` from the list. Choose **Create security group**.
:::

:::cli
```bash
BASTION_SG=$(aws ec2 create-security-group --group-name demo-bastion-sg \
  --description "Bastion: SSH from one admin IP" --vpc-id "$VPC_ID" \
  --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$BASTION_SG" \
  --protocol tcp --port 22 --cidr "$MY_IP/32"

APP_SG=$(aws ec2 create-security-group --group-name demo-app-sg \
  --description "App: SSH only from the bastion" --vpc-id "$VPC_ID" \
  --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$APP_SG" \
  --protocol tcp --port 22 --source-group "$BASTION_SG"
echo "$BASTION_SG $APP_SG"
```
:::

> [!CHECK]
> `demo-bastion-sg` allows TCP 22 from a single `/32`, never `0.0.0.0/0`. `demo-app-sg` allows TCP 22 from a security group ID (`sg-…`), so any replacement bastion that carries `demo-bastion-sg` keeps working without editing IP addresses.

### Step 7: Launch the bastion host and the private instance

:::console
1. In the EC2 console choose **Instances** → **Launch instances**.
2. **Name**: `demo-bastion`. Keep **Amazon Linux 2023** and choose **t3.micro**. Under **Key pair (login)** choose `demo-key`.
3. Under **Network settings** choose **Edit**: **VPC** `demo-vpc`, **Subnet** `demo-public-a`, **Auto-assign public IP** **Enable** (already preselected because of the subnet setting), **Firewall (security groups)** → **Select existing security group** → `demo-bastion-sg`. Choose **Launch instance**.
4. Launch a second instance the same way with these differences: **Name** `demo-app`, **Subnet** `demo-private-a`, **Auto-assign public IP** **Disable**, security group `demo-app-sg`.
5. Wait until both show **Running**, then note the bastion's **Public IPv4 address** and the app instance's **Private IPv4 addresses**.
:::

:::cli
```bash
AMI=$(aws ssm get-parameters \
  --names /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --query 'Parameters[0].Value' --output text)

BASTION_ID=$(aws ec2 run-instances --image-id "$AMI" --instance-type t3.micro \
  --key-name demo-key --subnet-id "$PUB_A" --security-group-ids "$BASTION_SG" \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=demo-bastion}]' \
  --query 'Instances[0].InstanceId' --output text)
APP_ID=$(aws ec2 run-instances --image-id "$AMI" --instance-type t3.micro \
  --key-name demo-key --subnet-id "$PRIV_A" --security-group-ids "$APP_SG" \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=demo-app}]' \
  --query 'Instances[0].InstanceId' --output text)
aws ec2 wait instance-running --instance-ids "$BASTION_ID" "$APP_ID"

BASTION_IP=$(aws ec2 describe-instances --instance-ids "$BASTION_ID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
APP_IP=$(aws ec2 describe-instances --instance-ids "$APP_ID" \
  --query 'Reservations[0].Instances[0].PrivateIpAddress' --output text)
aws ec2 describe-instances --instance-ids "$BASTION_ID" "$APP_ID" \
  --query 'Reservations[].Instances[].[Tags[?Key==`Name`]|[0].Value,SubnetId,PrivateIpAddress,PublicIpAddress]' \
  --output table
```
:::

> [!CHECK]
> `demo-bastion` has a private address such as `10.0.0.x` **and** a public IPv4 address; `demo-app` has only a private address in `10.0.16.0/20` (its public column is empty or `None`). The CLI did not ask for a public IP: the bastion got one from the subnet's auto-assign setting, and the private subnet left it off.

### Step 8: SSH to the bastion, then hop to the private instance

Wait about a minute after the instances start, then run these in CloudShell. The `hop` helper sends SSH through the bastion with `ProxyCommand`, so the private key never has to be copied onto the bastion.

```bash
# 1. Direct login to the bastion: show its addresses and the address the internet sees.
ssh -i ~/demo-key.pem -o StrictHostKeyChecking=accept-new ec2-user@"$BASTION_IP" \
  'ip -4 -br addr; echo "Internet sees me as: $(curl -s -m 5 https://checkip.amazonaws.com)"'

# 2. Try the private instance directly from CloudShell: this must fail.
ssh -i ~/demo-key.pem -o ConnectTimeout=10 ec2-user@"$APP_IP" hostname || echo "No path from the internet to a private address"

# 3. Reach it through the bastion.
hop() {
  local target=$1; shift
  ssh -i ~/demo-key.pem -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 \
    -o ProxyCommand="ssh -i ~/demo-key.pem -o StrictHostKeyChecking=accept-new -W %h:%p ec2-user@$BASTION_IP" \
    ec2-user@"$target" "$@"
}
hop "$APP_IP" 'ip -4 -br addr; curl -s -m 10 https://checkip.amazonaws.com || echo "no internet access"'
```

Run `hop "$APP_IP"` with no command to get an interactive shell on the private instance; type `exit` to leave.

> [!CHECK]
> 1. On the bastion, `ip` lists only the private `10.0.0.x` address, yet `checkip` reports the bastion's public IPv4 address: the internet gateway translates one to the other, and the instance never sees its public address.
> 2. The direct attempt times out: `10.0.16.x` is a private address with no route from the internet.
> 3. Through the bastion you land on `demo-app`, but its `curl` prints **no internet access**, because `demo-private-rt` has only the local route. Lab 02 fixes that with NAT.

### Step 9 (optional): Remove the internet route and watch the bastion go dark

:::console
1. Open **Route tables** → `demo-public-rt` → **Routes** → **Edit routes**, choose **Remove** next to the `0.0.0.0/0` route, and choose **Save changes**.
2. In CloudShell run `ssh -i ~/demo-key.pem -o ConnectTimeout=10 ec2-user@"$BASTION_IP" hostname`.
3. Add the route back: **Edit routes** → **Add route**, **Destination** `0.0.0.0/0`, **Target** **Internet Gateway** → `demo-igw`, **Save changes**. Run the SSH command again.
:::

:::cli
```bash
aws ec2 delete-route --route-table-id "$PUB_RT" --destination-cidr-block 0.0.0.0/0
ssh -i ~/demo-key.pem -o ConnectTimeout=10 ec2-user@"$BASTION_IP" hostname || echo "Timed out: subnet is private again"
aws ec2 create-route --route-table-id "$PUB_RT" --destination-cidr-block 0.0.0.0/0 --gateway-id "$IGW_ID"
ssh -i ~/demo-key.pem -o ConnectTimeout=10 ec2-user@"$BASTION_IP" hostname
```
:::

> [!CHECK]
> Without the route the SSH attempt times out even though the internet gateway is still attached, the instance still has its public IP and the security group still allows you. With the route back, `hostname` answers again. A subnet is public only because of its route table.

## Cleanup

Skip this section if you are continuing to lab 02 or lab 03; each of them ends with a cleanup that also removes everything listed here. If your CloudShell session restarted since you built the lab, first run the reload block from lab 02's **Prerequisites** to restore the shell variables. Otherwise delete in this order:

- [ ] **Instances `demo-bastion` and `demo-app`**: EC2 console → **Instances** → select both → **Instance state** → **Terminate (delete) instance** → confirm. CLI: `aws ec2 terminate-instances --instance-ids "$BASTION_ID" "$APP_ID"` then `aws ec2 wait instance-terminated --instance-ids "$BASTION_ID" "$APP_ID"`. Terminating also deletes their root volumes and releases the bastion's public IPv4 address.
- [ ] **Key pair `demo-key`**: EC2 console → **Key Pairs** → select → **Actions** → **Delete** → type `Delete` → **Delete**. CLI: `aws ec2 delete-key-pair --key-name demo-key`. Then remove the local copy in CloudShell: `rm -f ~/demo-key.pem`.
- [ ] **Security groups `demo-app-sg`, then `demo-bastion-sg`** (the first references the second): EC2 console → **Security Groups** → select → **Actions** → **Delete security groups** → **Delete**. CLI: `aws ec2 delete-security-group --group-id "$APP_SG"` then `aws ec2 delete-security-group --group-id "$BASTION_SG"`. (Console users can skip this item: deleting the VPC below removes them.)
- [ ] **VPC `demo-vpc` with its subnets, route tables and internet gateway**: VPC console → **Your VPCs** → select `demo-vpc` → **Actions** → **Delete VPC**. The dialog lists what it will remove with the VPC (subnets `demo-public-a`, `demo-public-b`, `demo-private-a`, `demo-private-b`, route tables `demo-public-rt` and `demo-private-rt`, internet gateway `demo-igw`, the default network ACL and security group). Type `delete` and choose **Delete**. CLI, in this order:

```bash
for S in "$PUB_A" "$PUB_B" "$PRIV_A" "$PRIV_B"; do aws ec2 delete-subnet --subnet-id "$S"; done
aws ec2 delete-route-table --route-table-id "$PUB_RT"
aws ec2 delete-route-table --route-table-id "$PRIV_RT"
aws ec2 detach-internet-gateway --internet-gateway-id "$IGW_ID" --vpc-id "$VPC_ID"
aws ec2 delete-internet-gateway --internet-gateway-id "$IGW_ID"
aws ec2 delete-vpc --vpc-id "$VPC_ID"
```

- [ ] **Final check**: **Your VPCs** no longer lists `demo-vpc`, **Instances** shows no running `demo-*` instances, and **EC2** → **Elastic IPs** is empty for this lab. The next day, **Billing and Cost Management** → **Bills** shows no new EC2 or VPC charges.

## Progress checklist

- [ ] Step 1: Created `demo-vpc` (`10.0.0.0/16`) and enabled DNS hostnames
- [ ] Step 2: Created two public and two private subnets and saw 251 / 4091 available addresses
- [ ] Step 3: Created and attached `demo-igw`
- [ ] Step 4: Built `demo-public-rt` (route to the IGW) and `demo-private-rt` (local only) with explicit associations
- [ ] Step 5: Created `demo-key` in CloudShell and recorded the CloudShell IP
- [ ] Step 6: Created `demo-bastion-sg` (SSH from one `/32`) and `demo-app-sg` (SSH from the bastion group)
- [ ] Step 7: Launched `demo-bastion` (public IP) and `demo-app` (private only)
- [ ] Step 8: Logged in to the bastion, hopped to the private instance, and confirmed it has no internet access
- [ ] Step 9 (optional): Removed and restored the internet route
- [ ] Cleanup done (or deferred to lab 02 / lab 03)
