---
id: 03-ec2-basics-lab-03
title: Allow traffic by security group reference instead of IP address
objective: Build a client and a server instance where the server accepts HTTP only from members of a client security group, then prove that access follows group membership, works only over private IPs, and keeps admin access in its own group.
estimatedTime: 35 minutes
cost: "About USD 0.03 per hour in us-east-1 (two t3.micro at USD 0.0104/h each plus two public IPv4 addresses at USD 0.005/h each, plus small gp3 root volumes); a few cents if you clean up within an hour. Covered by Free Tier credits (accounts from 15 July 2025). On the legacy 12-month Free Tier, launch t2.micro instead (t3.micro is free there only in Regions without t2.micro)."
freeTier: partial
services: [ec2, security-groups]
---

> [!COST]
> Two `t3.micro` instances (USD 0.0104 per hour each, On-Demand, us-east-1), two public IPv4
> addresses (USD 0.005 per hour each) and two gp3 root volumes (USD 0.08 per GB-month). New
> accounts pay this from Free Tier credits. On the legacy Free Tier, only `t2.micro` (or `t3.micro`
> in a Region without `t2.micro`) is free, so pick `t2.micro` in Step 2 where it is offered; the 750
> free hours a month are shared by everything you run, so two instances use them twice as fast. Do
> the **Cleanup** section as soon as you finish.

You will create three security groups, each with one job:

| Group | Attached to | Inbound rules | Purpose |
|---|---|---|---|
| `ec2-basics-admin-sg` | client | SSH 22 from the EC2 Instance Connect prefix list | Admin access only, kept separate from application rules |
| `ec2-basics-client-sg` | client | none | A "membership badge" that marks the instance as a client |
| `ec2-basics-server-sg` | server | HTTP 80 from `ec2-basics-client-sg` | The server accepts web traffic only from badge holders |

## Prerequisites

- An AWS account and an IAM identity that can manage EC2 and call `ec2-instance-connect:SendSSHPublicKey` (for example `AdministratorAccess` in a sandbox account).
- A Region with its default VPC. Examples use `us-east-1`.
- A web browser. For the CLI tabs: AWS CLI v2 configured with `aws configure`, or AWS CloudShell, and a Bash shell; keep one terminal open because later commands reuse variables.
- Labs 01 and 02 are helpful but not required.

## Steps

### Step 1: Create the three security groups

:::console
1. In the **EC2** console choose **Security Groups** → **Create security group**. Name `ec2-basics-admin-sg`, description `Lab 03: SSH from EC2 Instance Connect`, default **VPC**. Under **Inbound rules** choose **Add rule**: **Type** **SSH**, **Source** **Custom**, and pick the prefix list **com.amazonaws.<your-region>.ec2-instance-connect**. Choose **Create security group**.
2. Create `ec2-basics-client-sg` with description `Lab 03: client membership`, default **VPC**, and **no inbound rules**. Choose **Create security group**.
3. Create `ec2-basics-server-sg` with description `Lab 03: HTTP only from client-sg`, default **VPC**. Under **Inbound rules** choose **Add rule**: **Type** **HTTP**, **Source** **Custom**, and in the search box choose the security group `ec2-basics-client-sg` (it appears with its `sg-` ID). Choose **Create security group**.
:::

:::cli
```bash
# The Region the CLI is actually using. aws configure get region reads only the config file, so it
# can come back empty in CloudShell, which sets the Region through environment variables.
REGION=$(aws ec2 describe-availability-zones --query 'AvailabilityZones[0].RegionName' --output text)
VPC_ID=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true \
  --query 'Vpcs[0].VpcId' --output text)
PL_ID=$(aws ec2 describe-managed-prefix-lists \
  --filters Name=prefix-list-name,Values=com.amazonaws.$REGION.ec2-instance-connect \
  --query 'PrefixLists[0].PrefixListId' --output text)

ADMIN_SG=$(aws ec2 create-security-group --group-name ec2-basics-admin-sg \
  --description "Lab 03: SSH from EC2 Instance Connect" --vpc-id "$VPC_ID" \
  --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$ADMIN_SG" \
  --ip-permissions "IpProtocol=tcp,FromPort=22,ToPort=22,PrefixListIds=[{PrefixListId=$PL_ID}]"

CLIENT_SG=$(aws ec2 create-security-group --group-name ec2-basics-client-sg \
  --description "Lab 03: client membership" --vpc-id "$VPC_ID" \
  --query GroupId --output text)

SERVER_SG=$(aws ec2 create-security-group --group-name ec2-basics-server-sg \
  --description "Lab 03: HTTP only from client-sg" --vpc-id "$VPC_ID" \
  --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$SERVER_SG" \
  --protocol tcp --port 80 --source-group "$CLIENT_SG"
echo "admin=$ADMIN_SG client=$CLIENT_SG server=$SERVER_SG"
```
:::

> [!CHECK]
> On `ec2-basics-server-sg` → **Inbound rules**, the source of the HTTP rule is a security group
> ID (`sg-...` / `ec2-basics-client-sg`), not a CIDR block.

### Step 2: Launch the server and the client

The server installs Apache with this user data:

```bash
#!/bin/bash
dnf install -y httpd
echo "<h1>Secret page from the server</h1>" > /var/www/html/index.html
systemctl enable --now httpd
```

:::console
1. Choose **Instances** → **Launch instances**. **Name**: `ec2-basics-server`. Keep **Amazon Linux 2023 AMI**, **Instance type** **t3.micro** (or **t2.micro** on a legacy Free Tier account), and choose **Proceed without a key pair (Not recommended)** under **Key pair (login)**.
2. Under **Network settings**, choose **Select existing security group** and pick only `ec2-basics-server-sg`. Keep the default subnet with **Auto-assign public IP** enabled.
3. Expand **Advanced details**, paste the user data above into **User data**, and choose **Launch instance**.
4. Launch a second instance: **Name** `ec2-basics-client`, same AMI and type, **Proceed without a key pair (Not recommended)**, and under **Network settings** → **Select existing security group** pick **both** `ec2-basics-admin-sg` and `ec2-basics-client-sg`. No user data. Choose **Launch instance**.
5. When both are **Running**, note the server's **Private IPv4 addresses** and **Public IPv4 address**.
:::

:::cli
```bash
# Save the server user data above as server-data.sh first.
AMI=$(aws ssm get-parameters \
  --names /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --query 'Parameters[0].Value' --output text)
# No --subnet-id: EC2 picks a default subnet, which assigns a public IPv4 address automatically.
SERVER_ID=$(aws ec2 run-instances --image-id "$AMI" --instance-type t3.micro \
  --security-group-ids "$SERVER_SG" \
  --user-data file://server-data.sh \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=ec2-basics-server}]' \
  --query 'Instances[0].InstanceId' --output text)
CLIENT_ID=$(aws ec2 run-instances --image-id "$AMI" --instance-type t3.micro \
  --security-group-ids "$ADMIN_SG" "$CLIENT_SG" \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=ec2-basics-client}]' \
  --query 'Instances[0].InstanceId' --output text)
aws ec2 wait instance-status-ok --instance-ids "$SERVER_ID" "$CLIENT_ID"
read SERVER_PRIV SERVER_PUB <<< "$(aws ec2 describe-instances --instance-ids "$SERVER_ID" \
  --query 'Reservations[0].Instances[0].[PrivateIpAddress,PublicIpAddress]' --output text)"
echo "server private=$SERVER_PRIV public=$SERVER_PUB"
```
:::

> [!CHECK]
> Open `http://<server-public-ip>` in your browser: it **times out**. Your laptop is not a member
> of `ec2-basics-client-sg`, so the server's security group drops the request (CLI:
> `curl -m 10 -sS "http://$SERVER_PUB/"` fails after 10 seconds).

### Step 3: Reach the server from the client over its private IP

:::console
1. Select `ec2-basics-client`, choose **Connect** → **EC2 Instance Connect** → **Connect using a Public IP** → **Connect**.
2. In the browser terminal run `curl -m 5 http://<server-private-ip>/`.
3. Then run `curl -m 5 http://<server-public-ip>/`.
:::

:::cli
```bash
# The client's admin group admits SSH only from the EC2 Instance Connect service range, so open
# the session with the console steps; these lines print the exact commands to paste into it.
echo "curl -m 5 http://$SERVER_PRIV/"
echo "curl -m 5 http://$SERVER_PUB/"
```
:::

> [!CHECK]
> The private-IP request returns `<h1>Secret page from the server</h1>`. The public-IP request
> **times out**, even from the same client: traffic to a public address goes out through the internet
> gateway and comes back in with the client's *public* IP as its source, and security group references
> match only traffic between private addresses inside the VPC (or peered VPCs). Keep this terminal
> open.

### Step 4: Remove the membership and watch access disappear

:::console
1. In another browser tab, go to **Instances**, select `ec2-basics-client`, and choose **Actions** → **Security** → **Change security groups**.
2. Under **Associated security groups**, choose **Remove** next to `ec2-basics-client-sg` (keep `ec2-basics-admin-sg`) and choose **Save**.
3. Back in the client terminal, run `curl -m 5 http://<server-private-ip>/` again.
4. Repeat steps 1–2 but add `ec2-basics-client-sg` back (**Add security group**), save, and run the `curl` once more.
:::

:::cli
```bash
aws ec2 modify-instance-attribute --instance-id "$CLIENT_ID" --groups "$ADMIN_SG"
echo "Now run in the client session: curl -m 5 http://$SERVER_PRIV/   (expect a timeout)"
# ...after testing, restore both groups:
aws ec2 modify-instance-attribute --instance-id "$CLIENT_ID" --groups "$ADMIN_SG" "$CLIENT_SG"
echo "Run the curl again (expect the page)"
```
:::

> [!CHECK]
> With the client group removed, the request times out within seconds, while your SSH session stays
> up because admin access lives in `ec2-basics-admin-sg`. After you add `ec2-basics-client-sg`
> back, the page returns immediately: no restart and no change to the server's rules. Any new
> instance launched with `ec2-basics-client-sg` would get the same access automatically.

## Cleanup

Delete in this order (the server group references the client group, so it must go first):

- [ ] **Instances `ec2-basics-server` and `ec2-basics-client`**: **Instances** → select both → **Instance state** → **Terminate (delete) instance** → **Terminate (delete)**. CLI: `aws ec2 terminate-instances --instance-ids "$SERVER_ID" "$CLIENT_ID"` then `aws ec2 wait instance-terminated --instance-ids "$SERVER_ID" "$CLIENT_ID"`.
- [ ] **Security group `ec2-basics-server-sg`**: **Security Groups** → select it → **Actions** → **Delete security groups** → **Delete**. CLI: `aws ec2 delete-security-group --group-id "$SERVER_SG"`.
- [ ] **Security group `ec2-basics-client-sg`**: same steps. CLI: `aws ec2 delete-security-group --group-id "$CLIENT_SG"`. If it fails with a dependency error, the server group still exists or still references it.
- [ ] **Security group `ec2-basics-admin-sg`**: same steps. CLI: `aws ec2 delete-security-group --group-id "$ADMIN_SG"`.
- [ ] **Local file `server-data.sh`** (CLI path only): `rm server-data.sh`.
- [ ] **Final check**: no running `ec2-basics-*` instances and no `ec2-basics-*` security groups in the Region; the next day **Billing and Cost Management** → **Bills** shows no growing EC2 charges.

## Progress checklist

- [ ] Step 1: Created admin, client and server security groups, with the server rule referencing the client group
- [ ] Step 2: Launched both instances and saw the browser time out on the server
- [ ] Step 3: Reached the server from the client over the private IP, and saw the public IP fail
- [ ] Step 4: Removed and restored the client group and watched access follow membership
- [ ] Cleanup done
