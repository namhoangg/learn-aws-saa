---
id: 03-ec2-basics-lab-02
title: Connect to a Linux instance with SSH, PuTTY and EC2 Instance Connect
objective: Create a key pair, lock SSH down to your own IP, log in with the OpenSSH client (macOS, Linux or Windows) or PuTTY, then use EC2 Instance Connect from the browser and the CLI and fix the security group rule it needs.
estimatedTime: 45 minutes
cost: "About USD 0.016 per hour in us-east-1 (t3.micro USD 0.0104/h plus public IPv4 USD 0.005/h, plus a small gp3 root volume); a couple of cents if you clean up within an hour. Covered by Free Tier credits (accounts from 15 July 2025). On the legacy 12-month Free Tier, launch t2.micro instead (t3.micro is free there only in Regions without t2.micro)."
freeTier: partial
services: [ec2, security-groups]
---

> [!COST]
> One `t3.micro` (USD 0.0104 per hour On-Demand in us-east-1), one public IPv4 address (USD 0.005
> per hour) and its gp3 root volume (USD 0.08 per GB-month). Key pairs, security groups and EC2
> Instance Connect are free. New accounts pay from Free Tier credits. Legacy Free Tier accounts stay
> within their 750-hour allowances only with `t2.micro` (or `t3.micro` in a Region without
> `t2.micro`), so pick `t2.micro` in Step 2 if your Region offers it. Accounts older than 12 months
> pay the rates above. Do the **Cleanup** section when you finish.

The slides split this topic by operating system: macOS and Linux use the `ssh` command, Windows
uses PuTTY or (Windows 10 and later) the same `ssh` command, and everyone can use EC2 Instance
Connect. Do the steps that match your computer: Step 4 (PuTTY) is the Windows alternative to
Step 3, while Steps 5 and 7 use the OpenSSH `ssh` command from Step 3 (built into Windows 10 and 11
too).

## Prerequisites

- An AWS account and an IAM identity allowed to manage EC2 (for example the `AmazonEC2FullAccess` managed policy) **and** to call `ec2-instance-connect:SendSSHPublicKey` (included in `AdministratorAccess`; the EC2 Instance Connect tutorial in the EC2 User Guide shows a minimal policy).
- A Region with its default VPC. Examples use `us-east-1`.
- An SSH client: built into macOS and Linux; on Windows 10 (build 1809 or later) or 11 type `ssh` in PowerShell, and if it is missing add **OpenSSH Client** under **Settings** → **Optional features**. PuTTY (with PuTTYgen) is the alternative for Windows.
- For the CLI tabs: AWS CLI **version 2** (the `ec2-instance-connect ssh` command exists only in v2), configured with `aws configure` **on your own computer**. Do not use CloudShell for this lab: the security group rule allows *your* computer's public IP, and CloudShell connects from a different address.

## Steps

### Step 1: Create a key pair

:::console
1. Open the **EC2** console. In the navigation pane, under **Network & Security**, choose **Key Pairs** → **Create key pair**.
2. For **Name** enter `ec2-basics-key`.
3. For **Key pair type** choose **ED25519** (or **RSA**; both work for Linux).
4. For **Private key file format** choose **.pem** for OpenSSH (macOS, Linux, Windows `ssh`) or **.ppk** if you will only use PuTTY.
5. Choose **Create key pair**. Your browser downloads `ec2-basics-key.pem` (or `.ppk`). Move it to a safe folder, for example `~/.ssh/` on macOS or Linux, or `C:\Users\<you>\.ssh\` on Windows.
:::

:::cli
```bash
mkdir -p ~/.ssh
aws ec2 create-key-pair --key-name ec2-basics-key \
  --key-type ed25519 --key-format pem \
  --query KeyMaterial --output text > ~/.ssh/ec2-basics-key.pem
chmod 400 ~/.ssh/ec2-basics-key.pem
ls -l ~/.ssh/ec2-basics-key.pem
```
:::

> [!CHECK]
> `ec2-basics-key` appears in the **Key pairs** list with its fingerprint. The private key exists
> **only** on your computer; AWS keeps just the public half and will never show the private key
> again.

### Step 2: Create a security group and launch the instance

:::console
1. Choose **Security Groups** → **Create security group**. Name it `ec2-basics-ssh-sg`, description `Lab 02: SSH from my IP`, default **VPC**.
2. Under **Inbound rules**, choose **Add rule**, set **Type** to **SSH** and **Source** to **My IP**. Choose **Create security group**.
3. Choose **Instances** → **Launch instances**. **Name**: `ec2-basics-ssh`. Keep **Amazon Linux 2023 AMI**. **Instance type**: **t3.micro** (or **t2.micro** on a legacy Free Tier account, see the cost note).
4. Under **Key pair (login)**, for **Key pair name** choose `ec2-basics-key`.
5. Under **Network settings**, choose **Select existing security group** and pick `ec2-basics-ssh-sg`. Keep **Auto-assign public IP** enabled (the default in a default subnet).
6. Choose **Launch instance**. When the instance is **Running** and its status checks have passed, note its **Public IPv4 address** and **Public IPv4 DNS**.
:::

:::cli
```bash
VPC_ID=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true \
  --query 'Vpcs[0].VpcId' --output text)
MY_IP=$(curl -s https://checkip.amazonaws.com)
SSH_SG=$(aws ec2 create-security-group --group-name ec2-basics-ssh-sg \
  --description "Lab 02: SSH from my IP" --vpc-id "$VPC_ID" \
  --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$SSH_SG" \
  --protocol tcp --port 22 --cidr "$MY_IP/32"

AMI=$(aws ssm get-parameters \
  --names /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --query 'Parameters[0].Value' --output text)
# No --subnet-id: EC2 picks a default subnet, which assigns a public IPv4 address automatically.
IID=$(aws ec2 run-instances --image-id "$AMI" --instance-type t3.micro \
  --key-name ec2-basics-key --security-group-ids "$SSH_SG" \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=ec2-basics-ssh}]' \
  --query 'Instances[0].InstanceId' --output text)
aws ec2 wait instance-status-ok --instance-ids "$IID"
PUB_IP=$(aws ec2 describe-instances --instance-ids "$IID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
echo "$IID $PUB_IP"
```
:::

> [!CHECK]
> On the instance's **Security** tab there is exactly one inbound rule: TCP 22 from your address
> with `/32` at the end. On the **Details** tab, the key pair field shows `ec2-basics-key`.

### Step 3: Connect with the ssh command (macOS, Linux, Windows 10 or 11)

:::console
1. Select the instance and choose **Connect**, then the **SSH client** tab. The page shows the exact `chmod` and `ssh` commands for this instance.
2. **macOS or Linux**: in a terminal run `chmod 400 ~/.ssh/ec2-basics-key.pem`.
3. **Windows**: restrict the key file in PowerShell (only your user may read it):
   ```powershell
   $path = "$HOME\.ssh\ec2-basics-key.pem"
   icacls.exe $path /reset
   icacls.exe $path /GRANT:R "$($env:USERNAME):(R)"
   icacls.exe $path /inheritance:r
   ```
4. Run the command, replacing the address: `ssh -i ~/.ssh/ec2-basics-key.pem ec2-user@<public-ipv4-dns>` (on Windows use `$path` instead of the file path).
5. When asked `Are you sure you want to continue connecting (yes/no)?`, type `yes`.
:::

:::cli
```bash
ssh -i ~/.ssh/ec2-basics-key.pem ec2-user@"$PUB_IP"
```
:::

> [!CHECK]
> You see the Amazon Linux 2023 banner and a prompt such as `[ec2-user@ip-172-31-x-x ~]$`. Your
> computer has stored the instance's host key in `~/.ssh/known_hosts`, so you will not be asked
> again for this address. If you skipped `chmod` on macOS or Linux, SSH printed `UNPROTECTED
> PRIVATE KEY FILE` and refused the key: that is the most common first-day error.

While you are logged in, run a few commands to explore:

```bash
whoami                                  # ec2-user
cat /etc/os-release | head -3           # Amazon Linux 2023
TOKEN=$(curl -s -X PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/public-keys/0/openssh-key
sudo tail -5 /var/log/cloud-init-output.log
exit
```

The `public-keys` lookup returns the public half of `ec2-basics-key`, which cloud-init copied into
`/home/ec2-user/.ssh/authorized_keys` at first boot.

### Step 4 (Windows alternative): Connect with PuTTY

:::console
1. If your key is a `.pem` file, open **PuTTYgen**, choose **Load**, switch the file filter to **All Files**, select `ec2-basics-key.pem`, then choose **Save private key** (accept the warning about no passphrase) and save it as `ec2-basics-key.ppk`. Skip this if you created the key as `.ppk`.
2. Open **PuTTY**. In **Session**, for **Host Name** enter `ec2-user@<public-ipv4-dns>`, keep **Port** `22` and **Connection type** **SSH**.
3. In **Category**, expand **Connection** → **SSH** → **Auth** and choose **Credentials**. Next to **Private key file for authentication**, choose **Browse** and select the `.ppk` file.
4. (Optional) Go back to **Session**, type `ec2-basics` under **Saved Sessions** and choose **Save** so you do not repeat this.
5. Choose **Open**, then **Accept** on the host key alert.
:::

:::cli
```bash
# PuTTY is a GUI tool; the closest command-line equivalent is plink from the same suite (Windows):
# plink -ssh -i C:\Users\<you>\.ssh\ec2-basics-key.ppk ec2-user@<public-ipv4-dns>
# If you created a .pem key, use the OpenSSH command from Step 3 instead.
```
:::

> [!CHECK]
> A PuTTY window opens with the same `[ec2-user@ip-... ~]$` prompt. "Server refused our key"
> means the wrong username (it must be `ec2-user`) or a key that was not converted to `.ppk`.

### Step 5: Save typing with an SSH config entry

:::console
1. On macOS, Linux or Windows OpenSSH, open (or create) the file `~/.ssh/config` (`C:\Users\<you>\.ssh\config` on Windows).
2. Add the block below, with your instance's public IP:
   ```text
   Host ec2-basics
       HostName <public-ip>
       User ec2-user
       IdentityFile ~/.ssh/ec2-basics-key.pem
   ```
3. Save the file and run `ssh ec2-basics`.
:::

:::cli
```bash
cat >> ~/.ssh/config <<EOF

Host ec2-basics
    HostName $PUB_IP
    User ec2-user
    IdentityFile ~/.ssh/ec2-basics-key.pem
EOF
ssh ec2-basics 'hostname; uptime'
```
:::

> [!CHECK]
> `ssh ec2-basics` logs you in without any options. Remember that the `HostName` must be updated
> after a stop/start, because the public IP changes.

### Step 6: Try EC2 Instance Connect in the browser, then fix the rule

:::console
1. Select the instance, choose **Connect**, then the **EC2 Instance Connect** tab.
2. Keep **Connect using a Public IP**, check that **Username** is `ec2-user`, and choose **Connect**. Wait for the result.
3. Go to **Security Groups** → `ec2-basics-ssh-sg` → **Inbound rules** → **Edit inbound rules** → **Add rule**. Set **Type** to **SSH**, leave **Source** on **Custom**, and in the search box next to it choose the prefix list **com.amazonaws.<your-region>.ec2-instance-connect** (for example `com.amazonaws.us-east-1.ec2-instance-connect`). Choose **Save rules**.
4. Return to the instance and repeat steps 1–2.
:::

:::cli
```bash
# The Region the CLI is actually using (aws configure get region ignores AWS_REGION variables).
REGION=$(aws ec2 describe-availability-zones --query 'AvailabilityZones[0].RegionName' --output text)
PL_ID=$(aws ec2 describe-managed-prefix-lists \
  --filters Name=prefix-list-name,Values=com.amazonaws.$REGION.ec2-instance-connect \
  --query 'PrefixLists[0].PrefixListId' --output text)
aws ec2 authorize-security-group-ingress --group-id "$SSH_SG" \
  --ip-permissions "IpProtocol=tcp,FromPort=22,ToPort=22,PrefixListIds=[{PrefixListId=$PL_ID}]"

# Instance Connect from your own terminal: pushes a temporary key, then runs ssh to the public IP.
aws ec2-instance-connect ssh --instance-id "$IID" --connection-type direct
```
:::

> [!CHECK]
> The first browser attempt fails with an error saying it could not connect: your rule allowed
> only *your* IP, but the browser session reaches the instance from the EC2 Instance Connect
> service's addresses. After adding the prefix-list rule, a terminal opens in the browser tab as
> `ec2-user`, with no key file involved. The CLI command also logs you in without `-i`: it pushed a
> one-time key that the instance accepts for 60 seconds.

### Step 7: Practise reading SSH errors

:::console
1. In the security group, **Edit inbound rules** and **Delete** the rule that allows **My IP**, then **Save rules**.
2. Run `ssh -o ConnectTimeout=10 ec2-basics` and note the error.
3. Add the **SSH** / **My IP** rule back and save.
4. Run `ssh -i ~/.ssh/ec2-basics-key.pem root@<public-ip>` (wrong username) and note the error.
:::

:::cli
```bash
aws ec2 revoke-security-group-ingress --group-id "$SSH_SG" \
  --protocol tcp --port 22 --cidr "$MY_IP/32"
ssh -o ConnectTimeout=10 ec2-basics || echo "-> timed out: blocked by the security group"
aws ec2 authorize-security-group-ingress --group-id "$SSH_SG" \
  --protocol tcp --port 22 --cidr "$MY_IP/32"
ssh -o ConnectTimeout=10 -i ~/.ssh/ec2-basics-key.pem root@"$PUB_IP" true \
  || echo "-> reached the server, but the login was rejected"
```
:::

> [!CHECK]
> Without the rule you get `Connection timed out`: a network or security group problem. With the
> rule back but the wrong user, the server answers and rejects the login (`Permission denied
> (publickey)` or a message asking you to log in as `ec2-user`): the network is fine and the
> credentials are wrong.

## Cleanup

- [ ] **Instance `ec2-basics-ssh`**: **Instances** → select it → **Instance state** → **Terminate (delete) instance** → **Terminate (delete)**. CLI: `aws ec2 terminate-instances --instance-ids "$IID"` then `aws ec2 wait instance-terminated --instance-ids "$IID"`.
- [ ] **Security group `ec2-basics-ssh-sg`** (after the instance is terminated): **Security Groups** → select it → **Actions** → **Delete security groups** → **Delete**. CLI: `aws ec2 delete-security-group --group-id "$SSH_SG"`.
- [ ] **Key pair `ec2-basics-key`**: **Key Pairs** → select it → **Actions** → **Delete**, type `Delete`, choose **Delete**. CLI: `aws ec2 delete-key-pair --key-name ec2-basics-key`.
- [ ] **Local private key files** `ec2-basics-key.pem` / `.ppk`: delete them (`rm -f ~/.ssh/ec2-basics-key.pem`, or delete in File Explorer). The `.pem` is read-only after `chmod 400`, so `rm` may ask for confirmation.
- [ ] **SSH config entry**: remove the `Host ec2-basics` block from `~/.ssh/config` and the PuTTY saved session `ec2-basics` if you created one.
- [ ] **known_hosts entry**: `ssh-keygen -R <public-ip>` removes the stored host key for the old address.
- [ ] **Final check**: no running `ec2-basics-*` instances in the Region, no `ec2-basics-key` under **Key Pairs**, and the next day **Billing and Cost Management** → **Bills** shows no growing EC2 charges.

## Progress checklist

- [ ] Step 1: Created the `ec2-basics-key` key pair and stored the private key safely
- [ ] Step 2: Created `ec2-basics-ssh-sg` (SSH from My IP) and launched `ec2-basics-ssh`
- [ ] Step 3: Logged in with the `ssh` command and explored the instance
- [ ] Step 4 (Windows alternative): Logged in with PuTTY and a `.ppk` key
- [ ] Step 5: Added an `~/.ssh/config` entry
- [ ] Step 6: Saw EC2 Instance Connect fail, added the prefix-list rule, and connected from the browser and the CLI
- [ ] Step 7: Reproduced a timeout and a rejected login
- [ ] Cleanup done
