---
id: 03-ec2-basics-lab-01
title: Launch a web server with user data and test its security group
objective: Launch an Amazon Linux 2023 instance that configures itself with a user data script, then use it to see a security group timeout, a connection refused, a public IP change on stop/start, and proof that user data runs only once.
estimatedTime: 40 minutes
cost: "About USD 0.02 per hour in us-east-1 (t3.micro USD 0.0104/h, public IPv4 USD 0.005/h, a small gp3 root volume; t3.small at USD 0.0208/h for the last step); a few cents in total if you clean up within an hour. Covered by Free Tier credits (accounts from 15 July 2025). On the legacy 12-month Free Tier, launch t2.micro instead of t3.micro (t3.micro is free there only in Regions without t2.micro); the t3.small minutes are billed either way."
freeTier: partial
services: [ec2, security-groups, ami]
---

> [!COST]
> Nothing here is expensive, but it is not free for every account. A running `t3.micro` costs
> USD 0.0104 per hour On-Demand in us-east-1, its public IPv4 address USD 0.005 per hour, and the
> gp3 root volume USD 0.08 per GB-month (charged even while the instance is stopped). New accounts
> pay this from Free Tier credits. Accounts on the legacy Free Tier get 750 hours a month of
> `t2.micro` (of `t3.micro` only in Regions that do not offer `t2.micro`) and 750 hours of public
> IPv4, so in Step 3 they should pick `t2.micro` where it is offered; a `t3.micro` in us-east-1 is
> billed for them. Accounts older than 12 months pay the rates above. Step 7 briefly uses a
> `t3.small` (USD 0.0208 per hour), which no Free Tier covers. Terminate everything in **Cleanup**
> when you finish.

You will build the course's first hands-on server, then use it as a test bench for the ideas in
the lesson. No SSH key is needed: everything is observed from your browser (lab 02 covers logging
in).

## Prerequisites

- An AWS account and an IAM identity allowed to manage EC2 (for example the `AmazonEC2FullAccess` managed policy).
- A Region with its **default VPC** (every Region has one unless it was deleted). Examples use `us-east-1`; any Region works.
- A web browser. For the CLI tabs: AWS CLI v2 configured with `aws configure`, or AWS CloudShell (no setup needed), and a Bash shell. Keep the same terminal open for the whole lab because later commands reuse shell variables.
- If you use the CLI tabs, run every command, including the `curl` tests, from the **same** machine: the security group rule in Step 5 uses that machine's public IP address.

## Steps

### Step 1: Create a security group for the web server

:::console
1. Open the **EC2** console and check the Region in the top navigation bar.
2. In the navigation pane, under **Network & Security**, choose **Security Groups**, then **Create security group**.
3. For **Security group name** enter `ec2-basics-web-sg`, for **Description** enter `Lab 01: HTTP from anywhere`, and keep the default **VPC**.
4. Under **Inbound rules**, choose **Add rule**. Set **Type** to **HTTP** and **Source** to **Anywhere-IPv4** (`0.0.0.0/0`).
5. Leave **Outbound rules** as they are (all traffic allowed) and choose **Create security group**.
:::

:::cli
```bash
VPC_ID=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true \
  --query 'Vpcs[0].VpcId' --output text)
WEB_SG=$(aws ec2 create-security-group --group-name ec2-basics-web-sg \
  --description "Lab 01: HTTP from anywhere" --vpc-id "$VPC_ID" \
  --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$WEB_SG" \
  --protocol tcp --port 80 --cidr 0.0.0.0/0
aws ec2 describe-security-groups --group-ids "$WEB_SG" \
  --query 'SecurityGroups[0].[IpPermissions,IpPermissionsEgress]'
```
:::

> [!CHECK]
> The group shows **one inbound rule** (HTTP, TCP 80, `0.0.0.0/0`) and **one outbound rule**
> (All traffic, `0.0.0.0/0`) that AWS added automatically. That is the default "nothing in,
> everything out" starting point plus your HTTP rule.

### Step 2: Prepare the user data script

This script installs Apache, asks the instance metadata service (using an IMDSv2 token) for the
instance ID, AZ and type, and writes them into the home page together with the time the script ran
and the user it ran as.

```bash
#!/bin/bash
dnf install -y httpd
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 300")
ID=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)
AZ=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/placement/availability-zone)
TYPE=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-type)
cat > /var/www/html/index.html <<EOF
<h1>Hello from $ID</h1>
<p>Availability Zone: $AZ | Instance type at first boot: $TYPE</p>
<p>User data ran at: $(date -u) as user: $(whoami)</p>
EOF
systemctl enable --now httpd
```

For the CLI path, save it as `user-data.sh` in your current directory (in CloudShell: `nano user-data.sh`, paste, then Ctrl+O, Enter, Ctrl+X).

### Step 3: Launch the instance with user data

:::console
1. In the EC2 console choose **Instances** → **Launch instances**.
2. Under **Name and tags**, for **Name** enter `ec2-basics-web`.
3. Under **Application and OS Images (Amazon Machine Image)**, keep **Quick Start** → **Amazon Linux** with **Amazon Linux 2023 AMI** selected.
4. Under **Instance type**, choose **t3.micro** (legacy Free Tier account in a Region that offers it: **t2.micro**; the lab works the same).
5. Under **Key pair (login)**, choose **Proceed without a key pair (Not recommended)**. You will not log in to this instance.
6. Under **Network settings**, choose **Edit**. Keep the default **VPC** and **Subnet** (**No preference** is fine), check that **Auto-assign public IP** is **Enable**, then for **Firewall (security groups)** choose **Select existing security group** and pick `ec2-basics-web-sg` under **Common security groups**.
7. Under **Configure storage**, keep the default root volume.
8. Expand **Advanced details**, scroll to **User data** and paste the script from Step 2. Leave **User data has already been base64 encoded** unchecked.
9. In the **Summary** panel choose **Launch instance**, then choose the instance ID in the success message.
:::

:::cli
```bash
AMI=$(aws ssm get-parameters \
  --names /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --query 'Parameters[0].Value' --output text)
# No --subnet-id: EC2 picks a default subnet, which assigns a public IPv4 address automatically.
IID=$(aws ec2 run-instances --image-id "$AMI" --instance-type t3.micro \
  --security-group-ids "$WEB_SG" \
  --user-data file://user-data.sh \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=ec2-basics-web}]' \
  --query 'Instances[0].InstanceId' --output text)
aws ec2 wait instance-status-ok --instance-ids "$IID"
aws ec2 describe-instances --instance-ids "$IID" \
  --query 'Reservations[0].Instances[0].[State.Name,Placement.AvailabilityZone,PublicIpAddress,PrivateIpAddress]' \
  --output table
```
:::

> [!CHECK]
> The instance moves from **Pending** to **Running**, and after a minute or two the **Status
> check** column shows the checks passed. On the **Details** tab note the **Public IPv4 address**
> and **Private IPv4 addresses**; you will compare them in Step 7.

### Step 4: Open the website

:::console
1. Select the instance and copy its **Public IPv4 address**.
2. In a new browser tab open `http://<public-ip>` (type `http://` yourself; the server has no HTTPS certificate).
:::

:::cli
```bash
PUB_IP=$(aws ec2 describe-instances --instance-ids "$IID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
curl -s "http://$PUB_IP/"
```
:::

> [!CHECK]
> The page shows the instance ID, the AZ, **Instance type at first boot: t3.micro** (or `t2.micro`), the UTC time
> the script ran and **as user: root**. Write down that time. If the page does not load yet, wait
> another minute: user data runs after the instance reports **Running**.

### Step 5: Compare a timeout with a connection refused

First remove the HTTP rule and watch the browser, then open a port where nothing listens.

:::console
1. Go to **Security Groups**, select `ec2-basics-web-sg`, open the **Inbound rules** tab and choose **Edit inbound rules**.
2. Choose **Delete** next to the HTTP rule and choose **Save rules**.
3. Reload `http://<public-ip>` in the browser (use a private window to avoid the cache). Wait for the result.
4. Edit the inbound rules again: **Add rule** with **Type** **HTTP**, **Source** **Anywhere-IPv4**, and a second rule with **Type** **Custom TCP**, **Port range** `8080`, **Source** **My IP**. Choose **Save rules**.
5. Reload `http://<public-ip>` (it works again), then open `http://<public-ip>:8080`.
:::

:::cli
```bash
aws ec2 revoke-security-group-ingress --group-id "$WEB_SG" \
  --protocol tcp --port 80 --cidr 0.0.0.0/0
curl -m 10 -sS "http://$PUB_IP/" || echo "-> no answer within 10 seconds"

MY_IP=$(curl -s https://checkip.amazonaws.com)
aws ec2 authorize-security-group-ingress --group-id "$WEB_SG" \
  --protocol tcp --port 80 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id "$WEB_SG" \
  --protocol tcp --port 8080 --cidr "$MY_IP/32"
curl -s "http://$PUB_IP/" | head -1
curl -m 10 -sS "http://$PUB_IP:8080/" || echo "-> failed immediately?"
```
:::

> [!CHECK]
> Without the HTTP rule the browser spins and finally reports that the site took too long to
> respond (curl: `Connection timed out` or `Operation timed out`). The security group dropped the
> packets silently. Port 8080 fails **instantly** with "refused to connect" (curl: `Connection
> refused`): the security group let the packet through, but no process listens on 8080. Same
> symptom family, two very different causes.

Remove the 8080 rule now: **Edit inbound rules** → **Delete** next to the 8080 rule → **Save rules**
(CLI: `aws ec2 revoke-security-group-ingress --group-id "$WEB_SG" --protocol tcp --port 8080 --cidr "$MY_IP/32"`).

### Step 6: Look at the user data and the boot log

:::console
1. Go to **Instances** and select `ec2-basics-web`.
2. Choose **Actions** → **Instance settings** → **Edit user data**. You can read the script, but you cannot change it while the instance is running (editing needs a stopped instance). Choose **Cancel**.
3. Choose **Actions** → **Monitor and troubleshoot** → **Get system log** and scroll through the output.
:::

:::cli
```bash
aws ec2 describe-instance-attribute --instance-id "$IID" --attribute userData \
  --query 'UserData.Value' --output text | base64 --decode
aws ec2 get-console-output --instance-id "$IID" --latest --output text | grep -i cloud-init | tail -5
```
:::

> [!CHECK]
> The user data comes back exactly as you pasted it (the API stores it base64-encoded, which is why
> the CLI decodes it). The system log contains `cloud-init` lines from the first boot, ending with a
> message that cloud-init finished.

### Step 7: Stop, resize and start the instance

:::console
1. Select the instance and choose **Instance state** → **Stop instance**, then **Stop**. Wait until the state is **Stopped**.
2. Note that the **Public IPv4 address** field is now empty, while the private address is still shown.
3. Choose **Actions** → **Instance settings** → **Change instance type**. On the **Change instance type** page, for **Instance type** select **t3.small**, then choose **Change**.
4. Choose **Instance state** → **Start instance**. When it is **Running**, copy the new **Public IPv4 address**.
5. Open `http://<new-public-ip>` and compare the page with your notes from Step 4.
:::

:::cli
```bash
aws ec2 stop-instances --instance-ids "$IID"
aws ec2 wait instance-stopped --instance-ids "$IID"
aws ec2 modify-instance-attribute --instance-id "$IID" --instance-type '{"Value": "t3.small"}'
aws ec2 start-instances --instance-ids "$IID"
aws ec2 wait instance-status-ok --instance-ids "$IID"
aws ec2 describe-instances --instance-ids "$IID" \
  --query 'Reservations[0].Instances[0].[InstanceType,PublicIpAddress,PrivateIpAddress]' --output table
NEW_IP=$(aws ec2 describe-instances --instance-ids "$IID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
curl -s "http://$NEW_IP/"
```
:::

> [!CHECK]
> Three things to notice. The **public IPv4 address changed** (the old one no longer answers) while
> the **private IP stayed the same**. The console now says **t3.small**, but the page still shows
> the original type with the **same timestamp** as before: the user data script did not run again on
> this start, which is why the page was never rewritten. The web server still works because the
> script enabled `httpd` to start at every boot.

## Cleanup

Delete in this order:

- [ ] **Instance `ec2-basics-web`**: **Instances** → select it → **Instance state** → **Terminate (delete) instance** → **Terminate (delete)**. Its root volume and public IP are released with it. CLI: `aws ec2 terminate-instances --instance-ids "$IID"` then `aws ec2 wait instance-terminated --instance-ids "$IID"`.
- [ ] **Security group `ec2-basics-web-sg`** (after the instance shows **Terminated**): **Security Groups** → select it → **Actions** → **Delete security groups** → **Delete**. CLI: `aws ec2 delete-security-group --group-id "$WEB_SG"`.
- [ ] **Local file `user-data.sh`** (CLI path only): `rm user-data.sh`.
- [ ] **Final check**: **Instances** shows no running or stopped `ec2-basics-*` instances in this Region (filter **Instance state = running**), **Volumes** shows no leftover `available` volumes, and the next day **Billing and Cost Management** → **Bills** shows no growing EC2 charges.

## Progress checklist

- [ ] Step 1: Created `ec2-basics-web-sg` and saw the default outbound rule
- [ ] Step 2: Prepared the user data script
- [ ] Step 3: Launched `ec2-basics-web` with user data and no key pair
- [ ] Step 4: Saw the page written by user data, running as root
- [ ] Step 5: Reproduced a timeout (missing rule) and a connection refused (no listener)
- [ ] Step 6: Viewed the user data and the cloud-init lines in the system log
- [ ] Step 7: Stopped, resized and started the instance; saw a new public IP and no user data rerun
- [ ] Cleanup done
