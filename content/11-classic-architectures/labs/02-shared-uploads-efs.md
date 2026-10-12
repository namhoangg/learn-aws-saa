---
id: 11-classic-architectures-lab-02
title: Share uploaded files across Availability Zones with Amazon EFS
objective: Reproduce the MyWordPress.com storage problem and its fix, by mounting one EFS file system as the uploads folder of two web servers in different AZs, then proving that an EBS volume cannot cross AZs.
estimatedTime: 45 minutes
cost: "About USD 0.03 per hour in us-east-1 (two t3.micro instances, two public IPv4 addresses, a few KB in EFS and a 1 GiB gp3 volume); well under USD 0.10 if you clean up within an hour. Free Tier credits or the legacy Free Tier can cover most of it."
freeTier: partial
services: [efs, ebs, ec2, security-groups]
---

> [!COST]
> Two `t3.micro` instances cost about USD 0.0104 per hour each in us-east-1 and each public IPv4 address USD 0.005 per hour. EFS bills per GB-month stored plus read/write activity; the few kilobytes in this lab cost a fraction of a cent, and access through the mount target in the instance's own AZ has no data transfer charge. The 1 GiB `gp3` test volume costs a fraction of a cent per hour. Run the **Cleanup** section when you finish.

In the lesson, MyWordPress.com lost images because each instance wrote uploads to its own EBS volume. Here you build the fixed version: two web servers in two AZs whose `uploads` folder is the same EFS file system. Each server writes one "uploaded photo" (a small text file) at boot, and either server can then show both files.

## Prerequisites

- An AWS account with permissions for EC2 and Amazon EFS (for example the `AmazonEC2FullAccess` and `AmazonElasticFileSystemFullAccess` managed policies).
- A Region with a **default VPC** (DNS resolution and DNS hostnames are enabled in default VPCs, which EFS mounting by name needs). The steps use `us-east-1`.
- For the CLI tabs: AWS CLI v2 configured (or AWS CloudShell) and a Bash shell; keep one terminal open because later commands reuse shell variables.
- A web browser. If you use CloudShell for the CLI path, note that "my IP" there is CloudShell's address, so run the `curl` tests from CloudShell too.

## Steps

### Step 1: Create the security groups

The web servers accept HTTP only from your IP address, and the EFS mount targets accept NFS (TCP 2049) only from the web servers' security group: the same chaining pattern as the three-tier design.

:::console
1. Open the **EC2** console, choose **Security Groups** under **Network & Security**, then **Create security group**.
2. **Security group name** `uploads-web-sg`, **Description** `Web: HTTP from my IP`, default **VPC**. Under **Inbound rules** choose **Add rule**, **Type** **HTTP**, **Source** **My IP**. Choose **Create security group**.
3. Choose **Create security group** again. **Security group name** `uploads-efs-sg`, **Description** `EFS: NFS from web tier`, default **VPC**. Add an inbound rule with **Type** **NFS** (port 2049), **Source** **Custom**, and pick `uploads-web-sg` in the search box. Choose **Create security group**.
:::

:::cli
```bash
VPC_ID=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true \
  --query 'Vpcs[0].VpcId' --output text)
MY_IP=$(curl -s https://checkip.amazonaws.com)

WEB_SG=$(aws ec2 create-security-group --group-name uploads-web-sg \
  --description "Web: HTTP from my IP" --vpc-id "$VPC_ID" --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$WEB_SG" \
  --protocol tcp --port 80 --cidr "$MY_IP/32"

EFS_SG=$(aws ec2 create-security-group --group-name uploads-efs-sg \
  --description "EFS: NFS from web tier" --vpc-id "$VPC_ID" --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$EFS_SG" \
  --protocol tcp --port 2049 --source-group "$WEB_SG"
echo "web: $WEB_SG  efs: $EFS_SG"
```
:::

> [!CHECK]
> `uploads-efs-sg` has one inbound rule: NFS, TCP 2049, with `uploads-web-sg` (an `sg-...` ID) as the source rather than an IP range.

### Step 2: Create the EFS file system with a mount target in two AZs

:::console
1. Open the **Amazon EFS** console and choose **Create file system**, then **Customize**.
2. On **File system settings**: **Name** `uploads-efs`, keep **File system type** **Regional**, keep the default lifecycle, encryption and performance settings. If an **Automatic backups** option is shown, clear it for this lab. Choose **Next**.
3. On **Network access**: keep the default **VPC**. For every listed mount target, remove the `default` security group and choose `uploads-efs-sg` instead (keep at least the mount targets in the AZs whose default subnets you will use, for example `us-east-1a` and `us-east-1b`). Choose **Next**.
4. On **File system policy**, choose **Next** without selecting anything.
5. On **Review and create**, choose **Create file system**.
6. Open `uploads-efs`, copy its **File system ID** (`fs-...`), and open the **Network** tab.
:::

:::cli
```bash
FS_ID=$(aws efs create-file-system --creation-token uploads-efs-lab --encrypted \
  --performance-mode generalPurpose --throughput-mode elastic \
  --tags Key=Name,Value=uploads-efs --query FileSystemId --output text)
until [ "$(aws efs describe-file-systems --file-system-id "$FS_ID" \
  --query 'FileSystems[0].LifeCycleState' --output text)" = "available" ]; do sleep 5; done

# The default VPC has one default subnet per AZ, so these two are in different AZs.
# Only AZs that offer t3.micro are considered (a few older AZs, for example one in us-east-1, do not).
T3_AZS=$(aws ec2 describe-instance-type-offerings --location-type availability-zone \
  --filters Name=instance-type,Values=t3.micro \
  --query 'InstanceTypeOfferings[].Location' --output text | tr '\t' ',')
read SUBNET_A SUBNET_B <<< "$(aws ec2 describe-subnets \
  --filters Name=vpc-id,Values="$VPC_ID" Name=default-for-az,Values=true \
    Name=availability-zone,Values="$T3_AZS" \
  --query 'Subnets[0:2].SubnetId' --output text)"
aws efs create-mount-target --file-system-id "$FS_ID" --subnet-id "$SUBNET_A" --security-groups "$EFS_SG"
aws efs create-mount-target --file-system-id "$FS_ID" --subnet-id "$SUBNET_B" --security-groups "$EFS_SG"
sleep 90
aws efs describe-mount-targets --file-system-id "$FS_ID" \
  --query 'MountTargets[].[AvailabilityZoneName,LifeCycleState,IpAddress,NetworkInterfaceId]' --output table
```
:::

> [!CHECK]
> On the **Network** tab (or in the CLI table) each mount target shows **Available**, its own AZ, a private IP address and a network interface: the ENIs the lesson describes. Wait until they are all **Available** before launching instances.

### Step 3: Launch two web servers in different AZs

Both instances run the same user data. It installs Apache and the EFS mount helper, mounts the file system at `/var/www/html/uploads` through `/etc/fstab` (with TLS), writes a home page, and "uploads" one file named after its own AZ into the shared folder.

User data script (replace the file system ID on the second line with yours):

```bash
#!/bin/bash
FS_ID=fs-0123456789abcdef0
dnf install -y httpd amazon-efs-utils
mkdir -p /var/www/html/uploads
echo "$FS_ID:/ /var/www/html/uploads efs _netdev,noresvport,tls 0 0" >> /etc/fstab
for i in $(seq 1 30); do mount /var/www/html/uploads && break; sleep 10; done
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 300")
ID=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)
AZ=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/placement/availability-zone)
echo "<h1>Web server $ID in $AZ</h1><p><a href=\"/uploads/\">Browse the shared uploads folder</a></p>" > /var/www/html/index.html
echo "Photo uploaded through $ID in $AZ at $(date -u)" > "/var/www/html/uploads/photo-from-$AZ.txt"
systemctl enable --now httpd
```

:::console
1. In the EC2 console choose **Instances** → **Launch instances**.
2. **Name** `uploads-web-a`; **Application and OS Images** keep **Amazon Linux 2023**; **Instance type** **t3.micro**; **Key pair** **Proceed without a key pair (not recommended)**.
3. Under **Network settings** choose **Edit**: default **VPC**, a **Subnet** in the first AZ (for example `us-east-1a`), **Auto-assign public IP** **Enable**, **Select existing security group** → `uploads-web-sg`.
4. Expand **Advanced details**, paste the script into **User data** (with your `fs-...` ID) and choose **Launch instance**.
5. Repeat for `uploads-web-b` with a **Subnet** in a different AZ that also has a mount target (for example `us-east-1b`).
:::

:::cli
```bash
# Save the script above as user-data-template.sh first, unchanged.
sed "s/fs-0123456789abcdef0/$FS_ID/" user-data-template.sh > user-data.sh
AMI=$(aws ssm get-parameters \
  --names /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --query 'Parameters[0].Value' --output text)
IA=$(aws ec2 run-instances --image-id "$AMI" --instance-type t3.micro \
  --subnet-id "$SUBNET_A" --security-group-ids "$WEB_SG" --associate-public-ip-address \
  --user-data file://user-data.sh \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=uploads-web-a}]' \
  --query 'Instances[0].InstanceId' --output text)
IB=$(aws ec2 run-instances --image-id "$AMI" --instance-type t3.micro \
  --subnet-id "$SUBNET_B" --security-group-ids "$WEB_SG" --associate-public-ip-address \
  --user-data file://user-data.sh \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=uploads-web-b}]' \
  --query 'Instances[0].InstanceId' --output text)
aws ec2 wait instance-status-ok --instance-ids "$IA" "$IB"
read IP_A AZ_A <<< "$(aws ec2 describe-instances --instance-ids "$IA" \
  --query 'Reservations[0].Instances[0].[PublicIpAddress,Placement.AvailabilityZone]' --output text)"
read IP_B AZ_B <<< "$(aws ec2 describe-instances --instance-ids "$IB" \
  --query 'Reservations[0].Instances[0].[PublicIpAddress,Placement.AvailabilityZone]' --output text)"
echo "A: $IP_A ($AZ_A)  B: $IP_B ($AZ_B)"
```
:::

> [!CHECK]
> Both instances show **Running** with status checks passed, in two different AZs. Opening `http://<public IP of uploads-web-a>` shows "Web server i-... in us-east-1a". If the page does not load after three minutes, check that your current IP still matches the **My IP** rule.

### Step 4: Prove that both servers share the same uploads

:::console
1. Open `http://<public IP of uploads-web-a>/uploads/`.
2. Open `http://<public IP of uploads-web-b>/uploads/`.
3. On server B, open the file that server A wrote, for example `http://<public IP of uploads-web-b>/uploads/photo-from-us-east-1a.txt`.
:::

:::cli
```bash
curl -s "http://$IP_A/uploads/" | grep -o 'photo-from-[a-z0-9-]*\.txt' | sort -u
curl -s "http://$IP_B/uploads/" | grep -o 'photo-from-[a-z0-9-]*\.txt' | sort -u
curl -s "http://$IP_B/uploads/photo-from-$AZ_A.txt"
```
:::

> [!CHECK]
> Both listings show **two** files, `photo-from-<AZ a>.txt` and `photo-from-<AZ b>.txt`, and server B serves the file that server A wrote in the other AZ. This is the MyWordPress.com fix: every instance reads and writes the same Regional file system through the mount target in its own AZ.

### Step 5: Show that an EBS volume is locked to one AZ

:::console
1. In the EC2 console choose **Volumes** → **Create volume**.
2. **Volume type** **General Purpose SSD (gp3)**, **Size** `1` GiB, **Availability Zone** the AZ of `uploads-web-a`. Add the tag `Name` = `uploads-ebs-test`. Choose **Create volume**.
3. When it is **Available**, select it and choose **Actions** → **Attach volume**. Open the **Instance** list.
:::

:::cli
```bash
VOL=$(aws ec2 create-volume --volume-type gp3 --size 1 --availability-zone "$AZ_A" \
  --tag-specifications 'ResourceType=volume,Tags=[{Key=Name,Value=uploads-ebs-test}]' \
  --query VolumeId --output text)
aws ec2 wait volume-available --volume-ids "$VOL"
# Try to attach it to the instance in the OTHER AZ: this is expected to fail.
aws ec2 attach-volume --volume-id "$VOL" --instance-id "$IB" --device /dev/sdf
```
:::

> [!CHECK]
> The console's **Instance** list offers only `uploads-web-a`; `uploads-web-b` in the other AZ is not selectable. The CLI call fails with an `InvalidVolume.ZoneMismatch` error. Do not attach the volume; just delete it in the cleanup.

### Step 6 (optional): Lose a server, keep the files

:::console
1. Select `uploads-web-a` and choose **Instance state** → **Terminate (delete) instance** → **Terminate (delete)**.
2. When it is terminated, reload `http://<public IP of uploads-web-b>/uploads/`.
:::

:::cli
```bash
aws ec2 terminate-instances --instance-ids "$IA"
aws ec2 wait instance-terminated --instance-ids "$IA"
curl -s "http://$IP_B/uploads/" | grep -o 'photo-from-[a-z0-9-]*\.txt' | sort -u
```
:::

> [!CHECK]
> Both files are still listed on server B even though the instance that wrote one of them no longer exists. Data on EFS lives outside the instances, which is what lets an Auto Scaling group replace web servers freely.

## Cleanup

Delete in this order (security groups last, because the mount targets and instances use them):

- [ ] **Instances `uploads-web-a` and `uploads-web-b`**: **Instances** → select both → **Instance state** → **Terminate (delete) instance**. CLI: `aws ec2 terminate-instances --instance-ids "$IA" "$IB"` then `aws ec2 wait instance-terminated --instance-ids "$IA" "$IB"`.
- [ ] **EBS volume `uploads-ebs-test`**: **Volumes** → select it → **Actions** → **Delete volume** → **Delete**. CLI: `aws ec2 delete-volume --volume-id "$VOL"`.
- [ ] **EFS file system `uploads-efs` and its mount targets**: in the EFS console select it → **Delete**, enter the file system ID and confirm (this also removes the mount targets). CLI: `for MT in $(aws efs describe-mount-targets --file-system-id "$FS_ID" --query 'MountTargets[].MountTargetId' --output text); do aws efs delete-mount-target --mount-target-id "$MT"; done`, wait until `aws efs describe-mount-targets --file-system-id "$FS_ID"` returns an empty list, then `aws efs delete-file-system --file-system-id "$FS_ID"`.
- [ ] **AWS Backup recovery points** (only if you left automatic backups on): **AWS Backup** → **Backup vaults** → `aws/efs/automatic-backup-vault` → delete any recovery point for this file system.
- [ ] **Security group `uploads-efs-sg`** (first, because its rule references the web group; retry after a few minutes if the mount target network interfaces are still being removed): **Security Groups** → select → **Actions** → **Delete security groups**. CLI: `aws ec2 delete-security-group --group-id "$EFS_SG"`.
- [ ] **Security group `uploads-web-sg`**: same steps. CLI: `aws ec2 delete-security-group --group-id "$WEB_SG"`.
- [ ] **Local files** (CLI path): `rm user-data-template.sh user-data.sh`.
- [ ] **Final check**: no running `uploads-web-*` instances, no `uploads-efs` file system in the EFS console, no `uploads-ebs-test` volume in this Region; the next day **Billing and Cost Management** → **Bills** shows no new EFS or EC2 charges.

## Progress checklist

- [ ] Step 1: Created `uploads-web-sg` and `uploads-efs-sg` with the NFS rule referencing the web group
- [ ] Step 2: Created `uploads-efs` with Available mount targets in two AZs
- [ ] Step 3: Launched `uploads-web-a` and `uploads-web-b` in different AZs
- [ ] Step 4: Saw both uploaded files from both servers
- [ ] Step 5: Confirmed an EBS volume cannot attach to an instance in another AZ
- [ ] Step 6 (optional): Terminated a server and the files survived
- [ ] Cleanup done
