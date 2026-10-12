---
id: 33-disaster-recovery-migrations-lab-03
title: Replicate an EC2 server with Elastic Disaster Recovery and run a drill in another Region
objective: Initialize AWS Elastic Disaster Recovery in a recovery Region, install the AWS Replication Agent on a source instance, watch continuous block-level replication into the staging area, launch a non-disruptive recovery drill and confirm that the recovered server holds the source data.
estimatedTime: About 2 hours (mostly waiting for the initial sync and the drill), plus up to 90 minutes in the background while DRS removes its staging resources
cost: "About USD 0.25-0.50 in total if you clean up the same day: DRS at USD 0.028 per source server hour, a t3.small replication server (USD 0.0208/hour), two t3.micro instances (USD 0.0104/hour each), public IPv4 addresses (USD 0.005/hour each), small EBS staging volumes and snapshots, and a short-lived conversion server during the drill."
freeTier: partial
services: [drs, ec2, ebs, ebs-snapshots, iam, security-groups]
---

> [!COST]
> Elastic Disaster Recovery bills **USD 0.028 per source server per hour** from the moment replication starts, and it creates billable resources in your account: a replication server (t3.small by default, USD 0.0208/hour), EBS staging volumes, point-in-time snapshots, and during the drill a temporary conversion server plus the drill instance itself. Each public IPv4 address adds USD 0.005/hour. Expect well under USD 1 for the lab, but replication keeps billing until you **disconnect** the source server in the **Cleanup** section.

> [!VERIFY] Can a Free plan account use Elastic Disaster Recovery?
> Checked on 2026-10-04 and still open. AWS's [Choosing a plan](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html) guide only says the credit-based Free plan reaches "select" services and features, and sends you to the [AWS Free Tier page](https://aws.amazon.com/free/) for the list. Neither page, the [DRS pricing page](https://aws.amazon.com/disaster-recovery/pricing/) nor the [DRS initialization guide](https://docs.aws.amazon.com/drs/latest/userguide/getting-started-initializing.html) says whether DRS works on the Free plan. The one AWS page that names DRS covers the newer **Sign up for AWS (new)** experience, which is still reaching only some customers: its [supported services list](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html) marks DRS as unsupported on both its Free and Paid plans until you activate advanced AWS features, and it also blocks multi-Region features such as cross-Region snapshot copy. **What to do:** before Step 1, open the DRS console in us-west-2. If it refuses to initialize or asks you to upgrade, either upgrade to the Paid plan (**Billing and Cost Management** → **Upgrade plan**; the charges in the COST callout then apply) or read the lab as a walkthrough.

The source server runs in **us-east-1** and plays the role of your "data center". **us-west-2** is the recovery Region where DRS keeps the staging area and launches the drill. Any two Regions where DRS is available work.

## Prerequisites

- An AWS account where you are an administrator (DRS initialization creates several IAM roles and needs `AWSElasticDisasterRecoveryConsoleFullAccess` or admin rights). On a Free plan account, first check that DRS initializes (see the note above). A standard Paid plan account has access to all services; an account from the new AWS sign-up experience also needs advanced AWS features activated.
- A **default VPC** in both Regions.
- For the CLI tabs: AWS CLI v2 with credentials, or **AWS CloudShell**. Use one terminal for the whole lab because later commands reuse shell variables.
- A browser for **EC2 Instance Connect** (no SSH key needed).

## Steps

### Step 1: Initialize Elastic Disaster Recovery in both Regions

Initialization happens once per Region. It saves the default replication and launch settings and creates the service roles DRS needs.

:::console
1. Switch the console to **US West (Oregon)** and open **Elastic Disaster Recovery**.
2. Choose **Set default replication settings**. On **Set up replication servers**, keep a default subnet as the staging area subnet and the default replication server instance type (**t3.small**). Choose **Next**.
3. On **Specify volumes and security groups**, keep the defaults (including **Always use AWS Elastic Disaster Recovery security group**, which opens TCP 1500 for replication traffic). Choose **Next**.
4. On **Configure additional replication settings**, keep the defaults: data flows over the internet to a replication server with a public IP, and the default point-in-time snapshot policy applies. Choose **Next**.
5. Keep the defaults on **Set default DRS launch settings** and **Set default EC2 launch settings**, then on **Review and initialize** choose **Configure and initialize**.
6. Switch the console to **US East (N. Virginia)**, open **Elastic Disaster Recovery** again and run the same wizard with all defaults. When the source servers are EC2 instances, AWS asks for DRS to be initialized in both the source and the recovery Region. Initialization creates settings and roles only, nothing billable.
:::

:::cli
```bash
# Initialization from the CLI means creating six IAM roles by hand before running
# `aws drs initialize-service`, so use the console wizard (in both Regions) instead.
# Afterwards you can confirm that the replication settings template exists:
DR_REGION=us-west-2
SRC_REGION=us-east-1
aws drs describe-replication-configuration-templates --region "$DR_REGION" \
  --query 'items[].{Template:replicationConfigurationTemplateID,ServerType:replicationServerInstanceType}'
```
:::

> [!CHECK]
> The DRS console in both us-west-2 and us-east-1 now shows an empty **Source servers** page instead of the getting-started screen. In **IAM** → **Roles** you can see new roles such as `AWSElasticDisasterRecoveryReplicationServerRole` and `AWSElasticDisasterRecoveryRecoveryInstanceRole`.

### Step 2: Create the IAM role and security groups

The source instance uses an instance role to install the agent, so you never create access keys. The drill instance gets a security group that allows EC2 Instance Connect in the recovery Region.

:::console
1. Open **IAM** → **Roles** → **Create role**. Choose **AWS service** and use case **EC2**, then **Next**.
2. Search for and select the managed policy **AWSElasticDisasterRecoveryEc2InstancePolicy**, choose **Next**, name the role `demo-drs-source-role` and choose **Create role**.
3. In **EC2** in **US East (N. Virginia)**, create security group `demo-drs-source-sg` (description `DRS source: SSH from EC2 Instance Connect`) in the default VPC with one inbound rule: **SSH** from the prefix list `com.amazonaws.us-east-1.ec2-instance-connect`.
4. In **EC2** in **US West (Oregon)**, create security group `demo-drs-recovery-sg` (description `DRS drill: SSH from EC2 Instance Connect`) in the default VPC with one inbound rule: **SSH** from the prefix list `com.amazonaws.us-west-2.ec2-instance-connect`.
:::

:::cli
```bash
aws iam create-role --role-name demo-drs-source-role \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
aws iam attach-role-policy --role-name demo-drs-source-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSElasticDisasterRecoveryEc2InstancePolicy
aws iam create-instance-profile --instance-profile-name demo-drs-source-role
aws iam add-role-to-instance-profile --instance-profile-name demo-drs-source-role \
  --role-name demo-drs-source-role

SRC_VPC=$(aws ec2 describe-vpcs --region "$SRC_REGION" --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)
SRC_PL=$(aws ec2 describe-managed-prefix-lists --region "$SRC_REGION" \
  --filters Name=prefix-list-name,Values=com.amazonaws.${SRC_REGION}.ec2-instance-connect \
  --query 'PrefixLists[0].PrefixListId' --output text)
SRC_SG=$(aws ec2 create-security-group --region "$SRC_REGION" --group-name demo-drs-source-sg \
  --description "DRS source: SSH from EC2 Instance Connect" --vpc-id "$SRC_VPC" --query GroupId --output text)
aws ec2 authorize-security-group-ingress --region "$SRC_REGION" --group-id "$SRC_SG" \
  --ip-permissions "IpProtocol=tcp,FromPort=22,ToPort=22,PrefixListIds=[{PrefixListId=$SRC_PL}]"

DR_VPC=$(aws ec2 describe-vpcs --region "$DR_REGION" --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)
DR_PL=$(aws ec2 describe-managed-prefix-lists --region "$DR_REGION" \
  --filters Name=prefix-list-name,Values=com.amazonaws.${DR_REGION}.ec2-instance-connect \
  --query 'PrefixLists[0].PrefixListId' --output text)
REC_SG=$(aws ec2 create-security-group --region "$DR_REGION" --group-name demo-drs-recovery-sg \
  --description "DRS drill: SSH from EC2 Instance Connect" --vpc-id "$DR_VPC" --query GroupId --output text)
aws ec2 authorize-security-group-ingress --region "$DR_REGION" --group-id "$REC_SG" \
  --ip-permissions "IpProtocol=tcp,FromPort=22,ToPort=22,PrefixListIds=[{PrefixListId=$DR_PL}]"
```
:::

> [!CHECK]
> `demo-drs-source-role` exists with exactly one policy attached. `demo-drs-source-sg` (us-east-1) and `demo-drs-recovery-sg` (us-west-2) each have one inbound SSH rule whose source is the Region's EC2 Instance Connect prefix list.

### Step 3: Launch the source server with a marker file

The marker file is the "business data" you will look for on the recovered server.

> [!WARNING] Pick the kernel 6.12 AMI, not the default
> Since 17 August 2026 the default Amazon Linux 2023 AMI boots Linux kernel 6.18, but Elastic Disaster Recovery supports AL2023 source servers only up to kernel 6.12. Launch the source from the AL2023 AMI with kernel 6.12, or the agent will not replicate it.

:::console
1. In **EC2** in **US East (N. Virginia)**, choose **Launch instances** and name it `demo-drs-source`. Under **Application and OS Images**, choose **Amazon Linux**, then select the AL2023 AMI for **kernel 6.12** (x86_64) in the AMI list. If it is not offered, choose **Browse more AMIs** and search for `kernel-6.12-x86_64` among the Amazon Linux 2023 images. Choose **t3.micro**.
2. **Key pair**: **Proceed without a key pair (Not recommended)**. **Network settings**: default VPC, a default subnet with **Auto-assign public IP** enabled, existing security group `demo-drs-source-sg`.
3. Expand **Advanced details**, set **IAM instance profile** to `demo-drs-source-role`, and paste this into **User data**:
   ```bash
   #!/bin/bash
   echo "Line 1 written on the source at $(date -u)" > /etc/drs-demo-marker.txt
   ```
4. Choose **Launch instance** and wait for **2/2 checks passed**.
:::

:::cli
```bash
# Kernel 6.12, not kernel-default (6.18 since August 2026), which DRS does not support
AMI_ID=$(aws ssm get-parameters --region "$SRC_REGION" \
  --names /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.12-x86_64 \
  --query 'Parameters[0].Value' --output text)
cat > userdata.sh <<'EOF'
#!/bin/bash
echo "Line 1 written on the source at $(date -u)" > /etc/drs-demo-marker.txt
EOF
sleep 10   # let the new instance profile propagate
SRC_INSTANCE=$(aws ec2 run-instances --region "$SRC_REGION" --image-id "$AMI_ID" --instance-type t3.micro \
  --security-group-ids "$SRC_SG" --iam-instance-profile Name=demo-drs-source-role \
  --user-data file://userdata.sh \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=demo-drs-source}]' \
  --query 'Instances[0].InstanceId' --output text)
aws ec2 wait instance-status-ok --region "$SRC_REGION" --instance-ids "$SRC_INSTANCE"
```
:::

> [!CHECK]
> `demo-drs-source` is running in us-east-1 with a public IPv4 address, its AMI name on the **Details** tab contains `kernel-6.12`, and the IAM role `demo-drs-source-role` is shown on its **Security** tab.

### Step 4: Install the AWS Replication Agent

:::console
1. Select `demo-drs-source` → **Connect** → **EC2 Instance Connect** → **Connect**.
2. Check the marker file and the kernel version (it must start with `6.12`), install the kernel headers that exactly match the running kernel (an agent requirement), then download the installer for the **recovery** Region (us-west-2) and run it:
   ```bash
   cat /etc/drs-demo-marker.txt
   uname -r
   sudo dnf install -y kernel6.12-devel-$(uname -r)
   curl -o aws-replication-installer-init \
     https://aws-elastic-disaster-recovery-us-west-2.s3.us-west-2.amazonaws.com/latest/linux/aws-replication-installer-init
   chmod +x aws-replication-installer-init
   sudo ./aws-replication-installer-init --region us-west-2
   ```
3. When the installer lists the disks, press **Enter** to replicate all of them (the root disk is always included).
4. Wait until it prints the source server ID (`s-...`) and reports that the agent was installed. Keep the terminal open.
:::

:::cli
```bash
# The installer runs on the source server itself (EC2 Instance Connect terminal).
# From CloudShell you can watch the new source server appear in the recovery Region:
aws drs describe-source-servers --region "$DR_REGION" \
  --query 'items[].{Id:sourceServerID,Host:sourceProperties.identificationHints.hostname,State:dataReplicationInfo.dataReplicationState}'
SRC_ID=$(aws drs describe-source-servers --region "$DR_REGION" --query 'items[0].sourceServerID' --output text)
```
:::

> [!TIP]
> The installer does not ask for access keys because it uses the instance role. If it does ask, the role is missing or lacks `AWSElasticDisasterRecoveryEc2InstancePolicy`: fix the role on the instance (**Actions** → **Security** → **Modify IAM role**) and run the installer again. If it stops on a missing prerequisite instead (for example kernel headers or the DHCP client), install that package with `dnf` and rerun it.

> [!CHECK]
> In the DRS console in us-west-2, **Source servers** lists the instance's hostname with a data replication status of **Initial sync** and a progress percentage. In **EC2** in us-west-2, a new instance named like *AWS Elastic Disaster Recovery Replication Server* is running, with a staging EBS volume the same size as the source disk.

### Step 5: Wait for continuous replication and change the data

An 8 GiB disk usually finishes its initial sync in 15-30 minutes.

:::console
1. Refresh **Source servers** until the data replication status is **Healthy** and the server shows as ready for recovery.
2. In the source terminal, add a second line to the marker file, written after the initial sync:
   ```bash
   echo "Line 2 written after the initial sync at $(date -u)" | sudo tee -a /etc/drs-demo-marker.txt
   sync
   ```
3. Open the source server's details page in DRS: the replication status and lag are shown there (the lag stays at seconds), and point-in-time snapshots accumulate over time.
:::

:::cli
```bash
# Run until State is CONTINUOUS
aws drs describe-source-servers --region "$DR_REGION" --filters sourceServerIDs="$SRC_ID" \
  --query 'items[0].{State:dataReplicationInfo.dataReplicationState,Lag:dataReplicationInfo.lagDuration}'
```
:::

> [!CHECK]
> The state moves from **INITIAL_SYNC** to **CONTINUOUS** (console: **Healthy**). From now on, every block the source writes reaches the staging area within seconds: this is why DRS offers an RPO measured in seconds while the expensive compute stays switched off, like a pilot light.

### Step 6: Prepare the launch settings for the drill

Make the drill instance small, reachable through EC2 Instance Connect, and isolated from anything else.

:::console
1. In DRS (us-west-2), open the source server and choose the **Launch settings** tab.
2. Under **General launch settings**, choose **Edit**: set **Instance type right-sizing** to **Inactive** and keep **Start instance upon launch** on. Save.
3. Under **EC2 launch template**, choose **Edit**: **Subnet** = a default subnet, **Security groups** = `demo-drs-recovery-sg`, **Instance type** = **t3.micro**, and under the advanced settings turn on **Auto assign public IP**. Choose **Save settings** (DRS makes this the default template version).
:::

:::cli
```bash
aws drs update-launch-configuration --region "$DR_REGION" --source-server-id "$SRC_ID" \
  --target-instance-type-right-sizing-method NONE --launch-disposition STARTED

# The EC2 launch template edits (subnet, security group, instance type, public IP) are easiest
# in the DRS console, which saves a new template version and marks it as the default for you.
# After saving them there, note the template ID (needed for cleanup) and check the default version:
LT_ID=$(aws drs get-launch-configuration --region "$DR_REGION" --source-server-id "$SRC_ID" \
  --query ec2LaunchTemplateID --output text)
aws ec2 describe-launch-template-versions --region "$DR_REGION" --launch-template-id "$LT_ID" \
  --versions '$Default' \
  --query 'LaunchTemplateVersions[0].LaunchTemplateData.{Type:InstanceType,Nics:NetworkInterfaces}'
```
:::

> [!CHECK]
> The **Launch settings** tab shows right-sizing **Inactive**, instance type **t3.micro**, your subnet and `demo-drs-recovery-sg`. DRS always launches from the launch template version marked as **default**.

### Step 7: Launch a recovery drill

A drill performs every step of a real recovery, but replication keeps running and the source is not touched.

:::console
1. On **Source servers**, select the server and choose **Initiate recovery job** → **Initiate drill**.
2. Under the point-in-time choice, keep **Use most recent data**, then choose **Initiate drill**.
3. Open **Recovery job history** and the new job's log. Watch the steps: snapshot, conversion, launch.
4. When the job finishes, open **Recovery instances**. Wait until the instance passes its status checks (see it in **EC2** in us-west-2).
:::

:::cli
```bash
JOB_ID=$(aws drs start-recovery --region "$DR_REGION" --is-drill \
  --source-servers sourceServerID="$SRC_ID" --query job.jobID --output text)

# Run until the job status is COMPLETED
aws drs describe-jobs --region "$DR_REGION" --filters jobIDs="$JOB_ID" \
  --query 'items[0].{Job:jobID,Type:type,Status:status}'

aws drs describe-recovery-instances --region "$DR_REGION" \
  --query 'items[].{RecoveryInstance:recoveryInstanceID,Ec2:ec2InstanceID,Drill:isDrill}'
```
:::

> [!CHECK]
> The job log ends with the drill instance launched, and **Recovery instances** shows one instance marked as a drill. In **EC2** (us-west-2) it is running as a t3.micro with a public IPv4 address. A short-lived conversion server may appear and disappear during the job.

### Step 8: Prove the recovered server has the source data

:::console
1. In **EC2** in **US West (Oregon)**, select the drill instance → **Connect** → **EC2 Instance Connect** → **Connect**.
2. Read the marker file:
   ```bash
   cat /etc/drs-demo-marker.txt
   ```
3. Back in the us-east-1 terminal, confirm the source is still running normally: `uptime`.
:::

:::cli
```bash
# Confirm replication is still healthy after the drill
aws drs describe-source-servers --region "$DR_REGION" --filters sourceServerIDs="$SRC_ID" \
  --query 'items[0].{State:dataReplicationInfo.dataReplicationState,LastLaunch:lastLaunchResult}'
```
:::

> [!CHECK]
> The drill instance prints **both** lines, including the one written after the initial sync: the recovery used data that was only seconds old. The source kept running the whole time and the source server's last launch result is **SUCCEEDED** while replication stays **CONTINUOUS**. That is the non-disruptive drill you should run regularly in a real DR plan.

### Step 9: Terminate the drill instance

:::console
1. In DRS, open **Recovery instances**, select the drill instance, choose **Actions** → **Terminate recovery instances** and confirm with **Terminate**.
:::

:::cli
```bash
REC_ID=$(aws drs describe-recovery-instances --region "$DR_REGION" --query 'items[0].recoveryInstanceID' --output text)
aws drs terminate-recovery-instances --region "$DR_REGION" --recovery-instance-ids "$REC_ID"
```
:::

> [!CHECK]
> **Recovery instances** is empty and the EC2 instance is **Terminated**. Replication of the source continues until you disconnect it in the cleanup.

## Cleanup

Delete in this order. Disconnecting stops replication billing immediately; DRS then removes its replication server, staging volumes and snapshots within about 90 minutes.

- [ ] Terminate any remaining drill instance: DRS → **Recovery instances** → **Actions** → **Terminate recovery instances**.
- [ ] Disconnect the source server: DRS → **Source servers** → select → **Actions** → **Disconnect from AWS** → **Disconnect**. This also uninstalls the agent from the source.
- [ ] Delete the source server record: **Actions** → **Delete server** → **Permanently delete**.
- [ ] Terminate `demo-drs-source` in us-east-1: **EC2** → **Instances** → **Instance state** → **Terminate (delete) instance**.
- [ ] About 90 minutes later, check **EC2** in us-west-2: no running *Replication Server* instance, and no DRS staging volumes under **Volumes** or DRS snapshots under **Snapshots**. Delete anything left over.
- [ ] Delete the DRS launch template for the source server in us-west-2 if it is still listed under **EC2** → **Launch templates** (free, but tidy).
- [ ] Delete security groups `demo-drs-recovery-sg` (us-west-2) and `demo-drs-source-sg` (us-east-1). Optionally delete the DRS replication server security group in us-west-2 once no replication server uses it.
- [ ] Delete the IAM role `demo-drs-source-role` (IAM → Roles → Delete; the console removes its instance profile too).
- [ ] Optional: the DRS service roles and default replication settings created in Step 1 cost nothing; keep them if you will use DRS again.

:::cli
```bash
REC_IDS=$(aws drs describe-recovery-instances --region "$DR_REGION" --query 'items[].recoveryInstanceID' --output text)
[ -n "$REC_IDS" ] && aws drs terminate-recovery-instances --region "$DR_REGION" --recovery-instance-ids $REC_IDS

aws drs disconnect-source-server --region "$DR_REGION" --source-server-id "$SRC_ID"
aws drs delete-source-server --region "$DR_REGION" --source-server-id "$SRC_ID"

aws ec2 terminate-instances --region "$SRC_REGION" --instance-ids "$SRC_INSTANCE"
aws ec2 wait instance-terminated --region "$SRC_REGION" --instance-ids "$SRC_INSTANCE"
aws ec2 delete-security-group --region "$SRC_REGION" --group-id "$SRC_SG"

# After the drill instance is terminated:
aws ec2 delete-security-group --region "$DR_REGION" --group-id "$REC_SG"
aws ec2 delete-launch-template --region "$DR_REGION" --launch-template-id "$LT_ID"

aws iam remove-role-from-instance-profile --instance-profile-name demo-drs-source-role --role-name demo-drs-source-role
aws iam delete-instance-profile --instance-profile-name demo-drs-source-role
aws iam detach-role-policy --role-name demo-drs-source-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSElasticDisasterRecoveryEc2InstancePolicy
aws iam delete-role --role-name demo-drs-source-role

# About 90 minutes later, confirm nothing from DRS is left in the recovery Region:
aws ec2 describe-instances --region "$DR_REGION" --filters Name=instance-state-name,Values=running \
  --query 'Reservations[].Instances[].{Id:InstanceId,Name:Tags[?Key==`Name`]|[0].Value}'
aws ec2 describe-volumes --region "$DR_REGION" --query 'Volumes[].{Id:VolumeId,State:State,Size:Size}'
```
:::

> [!CHECK]
> Final check: the DRS console in us-west-2 lists no source servers or recovery instances; **EC2** shows no running instances from this lab in either Region and no leftover DRS volumes or snapshots in us-west-2. Check **Billing and Cost Management** → **Bills** the next day for any remaining DRS or EC2 charges.

## Progress checklist

- [ ] Step 1: DRS initialized in the recovery and source Regions
- [ ] Step 2: Source role and both security groups created
- [ ] Step 3: Source server launched from the kernel 6.12 AMI with the marker file
- [ ] Step 4: Replication Agent installed with the instance role
- [ ] Step 5: Replication reached continuous state and new data was written
- [ ] Step 6: Drill launch settings configured
- [ ] Step 7: Recovery drill launched
- [ ] Step 8: Drill instance showed both marker lines while the source kept running
- [ ] Step 9: Drill instance terminated
- [ ] Cleanup done
