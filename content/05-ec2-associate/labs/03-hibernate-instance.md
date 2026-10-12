---
id: 05-ec2-associate-lab-03
title: Hibernate an EC2 instance and prove that its memory survives
objective: Launch a hibernation-enabled Amazon Linux 2023 instance with an encrypted root volume, start a process that lives only in memory, hibernate and resume the instance, and compare the result with a normal stop and start.
estimatedTime: 40 minutes
cost: "About USD 0.02 if finished within an hour in us-east-1: one t3.micro (USD 0.0104 per hour, also billed while hibernating in the stopping state), one public IPv4 address (USD 0.005 per hour) and an 8 GiB encrypted gp3 volume. Free Tier credits normally cover it."
freeTier: partial
services: [ec2, ebs, kms, security-groups]
---

> [!COST]
> You pay for the `t3.micro` while it is running (USD 0.0104 per hour in us-east-1) and, unlike a
> normal stop, also while it is in the **stopping** state during hibernation. Its public IPv4 address
> costs USD 0.005 per hour while assigned, and the 8 GiB gp3 root volume (USD 0.08 per GB-month) is
> billed even while the instance is hibernated, because it holds the saved RAM. The root volume is
> encrypted with the AWS managed key `aws/ebs` unless you pick another key. Expect about USD 0.02;
> Free Tier credits normally cover it.

## Prerequisites

- An AWS account with the **default VPC** in the Region you use (the examples use `us-east-1`).
- An IAM identity allowed to manage EC2 instances and security groups and to use EC2 Instance Connect (`ec2-instance-connect:SendSSHPublicKey`); `AmazonEC2FullAccess` plus that permission is enough in a sandbox account.
- A browser that can reach the EC2 Instance Connect endpoint (corporate proxies sometimes block it).
- Optional: AWS CLI v2 configured (or AWS CloudShell) for the CLI tabs. The CLI examples use `bash`.

## Steps

### Step 1: Create a security group for EC2 Instance Connect

The console's EC2 Instance Connect traffic comes from an AWS-managed IP range, published as a
prefix list. Allowing SSH only from that list is much safer than opening port 22 to the world.

:::console
1. Open the **EC2** console in **US East (N. Virginia)** and choose **Network & Security** → **Security Groups** → **Create security group**.
2. **Security group name**: `hibernate-lab-sg`; **Description**: `SSH from EC2 Instance Connect only`; **VPC**: the default VPC.
3. Under **Inbound rules**, choose **Add rule**: **Type** **SSH**, **Source** **Custom**, and in the field next to it select the prefix list **com.amazonaws.us-east-1.ec2-instance-connect**.
4. Choose **Create security group**.
:::

:::cli
```bash
REGION=us-east-1
VPC=$(aws ec2 describe-vpcs --region $REGION --filters Name=is-default,Values=true \
  --query "Vpcs[0].VpcId" --output text)
SG=$(aws ec2 create-security-group --region $REGION --vpc-id $VPC \
  --group-name hibernate-lab-sg --description "SSH from EC2 Instance Connect only" \
  --query GroupId --output text)
PL=$(aws ec2 describe-managed-prefix-lists --region $REGION \
  --filters Name=prefix-list-name,Values=com.amazonaws.$REGION.ec2-instance-connect \
  --query "PrefixLists[0].PrefixListId" --output text)
aws ec2 authorize-security-group-ingress --region $REGION --group-id $SG \
  --ip-permissions "IpProtocol=tcp,FromPort=22,ToPort=22,PrefixListIds=[{PrefixListId=$PL}]"
echo $SG
```
:::

> [!CHECK]
> `hibernate-lab-sg` has one inbound rule: SSH (TCP 22) from a `pl-...` prefix list, not from
> `0.0.0.0/0`.

### Step 2: Launch a hibernation-enabled instance with an encrypted root volume

:::console
1. Choose **Instances** → **Launch instances**. **Name**: `hibernate-lab`.
2. Keep **Amazon Linux** with the default **Amazon Linux 2023 AMI** (it supports hibernation). **Instance type**: `t3.micro` (1 GiB of RAM, a supported family).
3. **Key pair (login)**: **Proceed without a key pair (Not recommended)**. EC2 Instance Connect pushes a temporary key for you.
4. **Network settings** → **Edit**: default VPC, any subnet, **Auto-assign public IP** **Enable**, **Firewall (security groups)** → **Select existing security group** → `hibernate-lab-sg`.
5. **Configure storage** → choose **Advanced** and expand the root volume: **Size (GiB)** `8`, **Volume type** **gp3**, **Encrypted** **Yes**, **KMS key** the default (`aws/ebs`). 8 GiB easily holds 1 GiB of RAM plus the OS.
6. Expand **Advanced details** and set **Stop - Hibernate behavior** to **Enable**. (The field is available only when the AMI, instance type and encrypted root volume meet the prerequisites.)
7. Choose **Launch instance**.
:::

:::cli
```bash
AMI=$(aws ssm get-parameter --region $REGION \
  --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --query Parameter.Value --output text)
# The root device name must match the AMI's (AL2023 uses /dev/xvda); confirm it:
aws ec2 describe-images --region $REGION --image-ids $AMI --query "Images[0].RootDeviceName" --output text

cat > hibernate-bdm.json <<'EOF'
[
  {
    "DeviceName": "/dev/xvda",
    "Ebs": { "VolumeSize": 8, "VolumeType": "gp3", "Encrypted": true, "DeleteOnTermination": true }
  }
]
EOF

aws ec2 run-instances --region $REGION \
  --image-id $AMI --instance-type t3.micro \
  --security-group-ids $SG \
  --block-device-mappings file://hibernate-bdm.json \
  --hibernation-options Configured=true \
  --credit-specification CpuCredits=standard \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=hibernate-lab}]' \
  --query "Instances[0].InstanceId" --output text
```
:::

> [!CHECK]
> Select `hibernate-lab` → **Details** tab: **Stop-hibernate behavior** shows **Enabled**. On the
> **Storage** tab the root volume is **Encrypted**. CLI:
> `aws ec2 describe-instances --region us-east-1 --instance-ids i-REPLACE_ME --query "Reservations[0].Instances[0].HibernationOptions"` returns `"Configured": true`.

### Step 3: Confirm hibernation was set up inside the OS

Wait at least **two minutes** after the instance is running; hibernating sooner fails.

:::console
1. Select `hibernate-lab` and choose **Actions** → **Monitor and troubleshoot** → **Get system log**.
2. Search the log for lines from `hibinit-agent`.
:::

:::cli
```bash
aws ec2 get-console-output --region us-east-1 --instance-id i-REPLACE_ME --latest \
  --query Output --output text | grep -i hibinit
```
:::

> [!CHECK]
> You see `hibinit-agent` lines. According to the AWS troubleshooting guide, a final line such as
> `hibinit-agent: Running: swapoff /swap` means hibernation was configured; a message about
> insufficient disk space means the root volume is too small. If the log is still empty, wait a
> minute and refresh: console output is buffered.

### Step 4: Start a process that lives only in memory

:::console
1. Select `hibernate-lab`, choose **Connect** → **EC2 Instance Connect** tab → **Connect using a Public IP** → **Connect**. A terminal opens in the browser.
2. Run the commands in the box below and write down the boot time, the process ID and the counter value.
:::

```bash
uptime -s                                   # when the kernel booted
nohup bash -c 'i=0; while true; do i=$((i+1)); echo $i > /tmp/counter; sleep 1; done' >/dev/null 2>&1 &
echo "counter PID: $!"
sleep 5; cat /tmp/counter                   # a small, growing number
curl -s -H "X-aws-ec2-metadata-token: $(curl -s -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')" \
  http://169.254.169.254/latest/meta-data/public-ipv4; echo
```

> [!CHECK]
> You have the boot time, a PID, a counter that increases once per second, and the instance's
> current public IPv4 (read from instance metadata). The counter process exists only in RAM; a normal
> reboot or stop would kill it.

### Step 5: Hibernate the instance

Close the browser terminal first.

:::console
1. Select `hibernate-lab` and choose **Instance state** → **Hibernate instance**, then **Hibernate**.
2. Watch **Instance state** go from **Stopping** to **Stopped** (it can take a few minutes).
3. Open **Details** and read **State transition message**.
:::

:::cli
```bash
aws ec2 stop-instances --region us-east-1 --instance-ids i-REPLACE_ME --hibernate
aws ec2 wait instance-stopped --region us-east-1 --instance-ids i-REPLACE_ME
aws ec2 describe-instances --region us-east-1 --instance-ids i-REPLACE_ME \
  --query "Reservations[0].Instances[0].[State.Name,StateReason.Code,PublicIpAddress]" --output text
```
:::

> [!CHECK]
> The state is **Stopped** and the state transition message is
> **Client.UserInitiatedHibernate: User initiated hibernate**. The public IPv4 address is gone. You
> are no longer billed for the instance, only for its EBS volume (and nothing for the released public IP).

### Step 6: Start the instance and check that memory was restored

:::console
1. Choose **Instance state** → **Start instance** and wait for **Running**.
2. Connect again with **EC2 Instance Connect** (**Connect using a Public IP**).
3. Run the commands below.
:::

:::cli
```bash
aws ec2 start-instances --region us-east-1 --instance-ids i-REPLACE_ME
aws ec2 wait instance-running --region us-east-1 --instance-ids i-REPLACE_ME
```
:::

```bash
uptime -s                         # compare with Step 4
pgrep -af tmp/counter             # the counter loop and its PID
cat /tmp/counter; sleep 3; cat /tmp/counter
curl -s -H "X-aws-ec2-metadata-token: $(curl -s -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')" \
  http://169.254.169.254/latest/meta-data/public-ipv4; echo
```

> [!CHECK]
> The **boot time is the same** as in Step 4: the kernel never rebooted. The counter process is still
> running with the **same PID** and its value keeps growing from where it was. The **public IPv4 is
> different**, because hibernation releases it like any stop; the private IPv4 is unchanged.

### Step 7: Compare with a normal stop and start

:::console
1. Close the terminal. Choose **Instance state** → **Stop instance** → **Stop** (not Hibernate) and wait for **Stopped**.
2. Choose **Instance state** → **Start instance**, wait for **Running**, connect again and run `uptime -s` and `pgrep -af tmp/counter`.
:::

:::cli
```bash
aws ec2 stop-instances --region us-east-1 --instance-ids i-REPLACE_ME
aws ec2 wait instance-stopped --region us-east-1 --instance-ids i-REPLACE_ME
aws ec2 start-instances --region us-east-1 --instance-ids i-REPLACE_ME
aws ec2 wait instance-running --region us-east-1 --instance-ids i-REPLACE_ME
```
:::

> [!CHECK]
> This time `uptime -s` shows a **new** boot time and `pgrep` finds no counter process: a regular stop
> clears RAM, and the operating system boots from scratch.

## Cleanup

Delete in this order:

- [ ] **Instance `hibernate-lab`**: Console: **Instances** → select → **Instance state** → **Terminate (delete) instance** → **Terminate (delete)**. CLI: `aws ec2 terminate-instances --region us-east-1 --instance-ids i-REPLACE_ME` then `aws ec2 wait instance-terminated --region us-east-1 --instance-ids i-REPLACE_ME`. (You can also terminate a hibernated instance directly.)
- [ ] **Encrypted root volume**: deleted with the instance (delete on termination is on). Confirm in **Elastic Block Store** → **Volumes** that no `available` 8 GiB volume remains (CLI: `aws ec2 describe-volumes --region us-east-1 --filters Name=status,Values=available`).
- [ ] **Security group `hibernate-lab-sg`** (after the instance is terminated): Console: **Security Groups** → select → **Actions** → **Delete security groups**, enter **Delete** if prompted, then **Delete**. CLI: `aws ec2 delete-security-group --region us-east-1 --group-id sg-REPLACE_ME`.
- [ ] **Local file** `hibernate-bdm.json` (CLI users): `rm hibernate-bdm.json`.
- [ ] **Final check**: no `hibernate-lab` instance is running or stopped in the Region, and no leftover volumes or security group from this lab remain.

## Progress checklist

- [ ] Step 1: Security group allowing SSH only from EC2 Instance Connect created
- [ ] Step 2: Hibernation-enabled instance launched with an encrypted gp3 root volume
- [ ] Step 3: hibinit-agent lines found in the system log
- [ ] Step 4: In-memory counter process started and values recorded
- [ ] Step 5: Instance hibernated (Client.UserInitiatedHibernate)
- [ ] Step 6: After start, same boot time and same process; new public IPv4
- [ ] Step 7: Normal stop/start cleared the process and rebooted the OS
- [ ] Cleanup complete: instance terminated, volume gone, security group deleted
