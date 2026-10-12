---
id: 35-other-services-lab-02
title: Manage an EC2 instance with Session Manager, Run Command, Patch Manager and Automation
objective: Launch an instance with no SSH key and no inbound rules, make it a Systems Manager managed node, open a shell with Session Manager, run a script with Run Command, scan it for missing patches, and restart it with an Automation runbook.
estimatedTime: 45 minutes
cost: "About USD 0.02 per hour in us-east-1 (t3.micro about USD 0.0104/h plus USD 0.005/h for its public IPv4 address) and under USD 0.01 for the Automation run; roughly USD 0.03 if you clean up within an hour. Free Tier credits (new accounts) or the legacy 12-month Free Tier can cover the instance. Session Manager, Run Command and Patch Manager are free on EC2."
freeTier: partial
services: [systems-manager, ec2, iam-roles, security-groups]
---

> [!COST]
> The `t3.micro` instance bills per second while it runs (about USD 0.0104 per hour in us-east-1 unless Free Tier credits cover it) and its public IPv4 address costs USD 0.005 per hour; the 8 GiB root EBS volume adds well under one cent per hour. Systems Manager **Automation** has no free tier any more: it charges USD 0.002 per step, so the two-step restart runbook in Step 7 costs well under one cent. Session Manager, Run Command and Patch Manager add nothing on EC2. Terminate the instance in **Cleanup** as soon as you finish.

You will prove the exam's favourite Systems Manager claim: an instance with **no key pair and no inbound security group rules** can still be reached, scripted, patched and restarted, as long as it has the SSM Agent, an IAM role and outbound HTTPS.

## Prerequisites

- An AWS account and permissions for EC2, IAM (create a role and instance profile) and Systems Manager, for example an administrator in a sandbox account.
- A Region with a **default VPC**; the steps use `us-east-1`. The instance reaches Systems Manager through the default VPC's internet gateway, so it needs a public IPv4 address (private subnets would need a NAT gateway or VPC interface endpoints instead).
- For the CLI tabs: AWS CLI v2 configured, or **AWS CloudShell**. Keep one terminal open for the whole lab because commands reuse shell variables. Starting a session from the CLI also needs the **Session Manager plugin** on your machine, which is not listed among CloudShell's preinstalled tools; use the console tab for Step 4 if you do not have it.

## Steps

### Step 1: Create an IAM role for the instance

The SSM Agent on the instance needs credentials with Systems Manager permissions. The AWS managed policy `AmazonSSMManagedInstanceCore` contains exactly the core permissions.

:::console
1. Open the **IAM** console and choose **Roles** → **Create role**.
2. For **Trusted entity type** choose **AWS service**. For **Service or use case** choose **EC2**, keep the **EC2** use case selected, and choose **Next**.
3. On **Add permissions**, search for **AmazonSSMManagedInstanceCore**, select its check box and choose **Next**.
4. For **Role name** enter `lab-ssm-instance-role` and choose **Create role**. The console also creates an instance profile with the same name.
:::

:::cli
```bash
cat > ec2-trust.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "ec2.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
EOF

aws iam create-role --role-name lab-ssm-instance-role \
  --assume-role-policy-document file://ec2-trust.json
aws iam attach-role-policy --role-name lab-ssm-instance-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore

aws iam create-instance-profile --instance-profile-name lab-ssm-instance-role
aws iam add-role-to-instance-profile --instance-profile-name lab-ssm-instance-role \
  --role-name lab-ssm-instance-role
```
:::

> [!CHECK]
> The role's **Permissions** tab lists `AmazonSSMManagedInstanceCore`, and its **Trust relationships** tab shows `ec2.amazonaws.com` as the trusted service.

### Step 2: Create a security group with no inbound rules

:::console
1. Open the **EC2** console, choose **Security Groups** under **Network & Security**, then **Create security group**.
2. Enter **Security group name** `lab-ssm-no-inbound` and **Description** `No inbound rules - SSM lab`, and keep the default **VPC**.
3. Leave **Inbound rules** empty. Keep the default outbound rule (all traffic). Choose **Create security group**.
:::

:::cli
```bash
VPC_ID=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true \
  --query 'Vpcs[0].VpcId' --output text)

SG_ID=$(aws ec2 create-security-group --group-name lab-ssm-no-inbound \
  --description "No inbound rules - SSM lab" --vpc-id "$VPC_ID" \
  --query GroupId --output text)
echo "Security group: $SG_ID"
```
:::

> [!CHECK]
> The security group's **Inbound rules** tab says there are no rules. It stays that way for the whole lab.

### Step 3: Launch the instance and wait for it to become a managed node

:::console
1. In the EC2 console choose **Instances** → **Launch instances**.
2. Under **Name and tags** enter `lab-ssm-node`.
3. Keep **Amazon Linux 2023** (the Quick Start default; the SSM Agent is preinstalled) and choose instance type **t3.micro**.
4. Under **Key pair (login)** choose **Proceed without a key pair (not recommended)**.
5. Under **Network settings** choose **Edit**: keep the default VPC and a default subnet, keep **Auto-assign public IP** set to **Enable**, choose **Select existing security group** and pick `lab-ssm-no-inbound`.
6. Expand **Advanced details** and set **IAM instance profile** to `lab-ssm-instance-role`.
7. Choose **Launch instance**.
8. Open the **Systems Manager** console and choose **Fleet Manager** (in the unified console experience, **Explore nodes**). Within about five minutes `lab-ssm-node` appears as a managed node with ping status **Online**.
:::

:::cli
```bash
AMI=$(aws ssm get-parameters \
  --names /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --query 'Parameters[0].Value' --output text)

# Pick a default subnet in an AZ that offers t3.micro.
AZS=$(aws ec2 describe-instance-type-offerings --location-type availability-zone \
  --filters Name=instance-type,Values=t3.micro \
  --query 'InstanceTypeOfferings[].Location' --output text | tr '\t' ',')
SUBNET=$(aws ec2 describe-subnets \
  --filters Name=vpc-id,Values="$VPC_ID" Name=default-for-az,Values=true \
            Name=availability-zone,Values="$AZS" \
  --query 'Subnets[0].SubnetId' --output text)

# A new instance profile can take a few seconds to propagate. If run-instances reports
# an invalid IAM instance profile, wait 15 seconds and run it again.
IID=$(aws ec2 run-instances --image-id "$AMI" --instance-type t3.micro \
  --subnet-id "$SUBNET" --security-group-ids "$SG_ID" --associate-public-ip-address \
  --iam-instance-profile Name=lab-ssm-instance-role \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=lab-ssm-node}]' \
  --query 'Instances[0].InstanceId' --output text)
echo "Instance: $IID"

aws ec2 wait instance-running --instance-ids "$IID"

# Repeat until PingStatus shows Online (usually a few minutes).
aws ssm describe-instance-information \
  --filters "Key=InstanceIds,Values=$IID" \
  --query 'InstanceInformationList[].[InstanceId,PingStatus,PlatformName,AgentVersion]' \
  --output table
```
:::

> [!CHECK]
> The node shows **Online** with platform Amazon Linux and an agent version. If it never appears after ten minutes, confirm the instance has the `lab-ssm-instance-role` profile and a public IPv4 address; without one of them the agent cannot register.

### Step 4: Open a shell with Session Manager

:::console
1. In the EC2 console select `lab-ssm-node` and choose **Connect**.
2. Choose the **Session Manager** tab and choose **Connect**. A browser terminal opens.
3. Run these commands:

   ```bash
   whoami
   hostname
   cat /etc/os-release | head -n 2
   sudo dnf -q check-update | head -n 5
   ```

4. Type `exit` (or choose **Terminate**) to end the session.
5. In the Systems Manager console choose **Session Manager** and open the **Session history** tab to find your session.
:::

:::cli
```bash
# Requires the Session Manager plugin on the machine running the CLI.
aws ssm start-session --target "$IID"
# Inside the session run: whoami ; hostname ; exit

aws ssm describe-sessions --state History \
  --filters "key=Target,value=$IID" \
  --query 'Sessions[].[SessionId,Owner,Status]' --output table
```
:::

> [!CHECK]
> `whoami` prints `ssm-user`, an account the agent created for sessions. You connected without a key pair, without a bastion and with zero inbound rules, and the session history records who connected and when.

### Step 5: Run a script with Run Command

:::console
1. In the Systems Manager console choose **Run Command** → **Run command**.
2. In the **Command document** list search for and select **AWS-RunShellScript**.
3. Under **Command parameters**, enter these lines in **Commands**:

   ```bash
   uptime
   df -h /
   rpm -q amazon-ssm-agent
   ```

4. Under **Targets** choose **Specify instance tags**, enter tag key `Name` and value `lab-ssm-node`, and choose **Add**.
5. Under **Rate control** keep the defaults (concurrency and error threshold).
6. Under **Output options** clear **Write command output to an S3 bucket** (the output still appears in the console).
7. Choose **Run**. When the status is **Success**, select the instance under **Targets and outputs** and choose **View output**.
:::

:::cli
```bash
CMD_ID=$(aws ssm send-command --document-name AWS-RunShellScript \
  --targets "Key=tag:Name,Values=lab-ssm-node" \
  --parameters 'commands=["uptime","df -h /","rpm -q amazon-ssm-agent"]' \
  --max-concurrency 50% --max-errors 0 \
  --comment "SAA lab run command" \
  --query Command.CommandId --output text)

aws ssm wait command-executed --command-id "$CMD_ID" --instance-id "$IID"

aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$IID" \
  --query '[Status,StandardOutputContent]' --output text
```
:::

> [!CHECK]
> The command status is **Success** and the output shows the uptime, the root volume usage and the installed `amazon-ssm-agent` package version. The instance was selected by its tag, which is how you would target hundreds of instances at once.

### Step 6: Scan for missing patches with Patch Manager

Patch Manager's scan runs the `AWS-RunPatchBaseline` document through Run Command and records the result as patch compliance. A **Scan** changes nothing on the instance.

:::console
1. Choose **Run Command** → **Run command** again.
2. Select the document **AWS-RunPatchBaseline**.
3. Under **Command parameters** set **Operation** to **Scan** (leave the other parameters at their defaults).
4. Under **Targets** choose **Choose instances manually** and select `lab-ssm-node`.
5. Clear **Write command output to an S3 bucket** and choose **Run**. Wait for **Success** (one to three minutes).
6. Choose **Patch Manager** in the navigation pane and open the **Compliance reporting** tab. Find `lab-ssm-node` and note its compliance status and the counts of missing patches.
:::

:::cli
```bash
SCAN_ID=$(aws ssm send-command --document-name AWS-RunPatchBaseline \
  --instance-ids "$IID" --parameters 'Operation=Scan' \
  --query Command.CommandId --output text)

aws ssm wait command-executed --command-id "$SCAN_ID" --instance-id "$IID"

aws ssm describe-instance-patch-states --instance-ids "$IID" \
  --query 'InstancePatchStates[].[Operation,BaselineId,InstalledCount,MissingCount,FailedCount]' \
  --output table
```
:::

> [!CHECK]
> The patch state shows operation `Scan`, the default Amazon Linux 2023 baseline ID, and counts of installed and missing patches. A fresh AMI often reports zero or only a few missing patches; the point is that the report exists without anyone logging in. In production you would run **Scan and install** inside a maintenance window or a Quick Setup patch policy.

### Step 7: Restart the instance with an Automation runbook

Run Command works inside the operating system; Automation calls AWS APIs. `AWS-RestartEC2Instance` stops and then starts the instance.

:::console
1. In the Systems Manager console choose **Automation** → **Execute automation**.
2. In the **Automation document** list search for and select **AWS-RestartEC2Instance**, then choose **Next**.
3. Under **Execution Mode** choose **Simple execution**.
4. Under **Input parameters**, for **InstanceId** select `lab-ssm-node`. Leave **AutomationAssumeRole** empty, so the runbook uses your own permissions.
5. Choose **Execute** and watch the steps until the execution status is **Success** (two to four minutes).
:::

:::cli
```bash
EXEC_ID=$(aws ssm start-automation-execution \
  --document-name AWS-RestartEC2Instance \
  --parameters "InstanceId=$IID" \
  --query AutomationExecutionId --output text)

# Repeat until the status is Success.
aws ssm get-automation-execution --automation-execution-id "$EXEC_ID" \
  --query 'AutomationExecution.[AutomationExecutionStatus,StepExecutions[].StepName]' \
  --output text
```
:::

> [!CHECK]
> The execution shows a stop step followed by a start step, both **Success**, and the EC2 console shows the instance back in **Running** state (with a new public IPv4 address, because it was stopped and started). After a minute or two Fleet Manager shows it **Online** again.

## Cleanup

Delete in this order:

- [ ] **EC2 instance `lab-ssm-node`**: EC2 console → **Instances** → select → **Instance state** → **Terminate (delete) instance**; CLI `aws ec2 terminate-instances --instance-ids "$IID"` then `aws ec2 wait instance-terminated --instance-ids "$IID"`. This also releases its public IPv4 address and deletes its root EBS volume.
- [ ] **Security group `lab-ssm-no-inbound`** (after the instance is terminated): EC2 console → **Security Groups** → select → **Actions** → **Delete security groups**; CLI `aws ec2 delete-security-group --group-id "$SG_ID"`.
- [ ] **IAM role and instance profile `lab-ssm-instance-role`**: IAM console → **Roles** → select → **Delete** (the console removes the instance profile too). CLI:

  ```bash
  aws iam remove-role-from-instance-profile --instance-profile-name lab-ssm-instance-role \
    --role-name lab-ssm-instance-role
  aws iam delete-instance-profile --instance-profile-name lab-ssm-instance-role
  aws iam detach-role-policy --role-name lab-ssm-instance-role \
    --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
  aws iam delete-role --role-name lab-ssm-instance-role
  ```

- [ ] **Local file** (optional): `rm ec2-trust.json`.
- [ ] **Final check**: no running or stopped `lab-ssm-node` instance in the Region, and Fleet Manager no longer lists it as online (terminated nodes drop off after a short while). Command, session and automation histories are kept by Systems Manager at no charge and need no cleanup.

## Progress checklist

- [ ] Step 1: Created the instance role with AmazonSSMManagedInstanceCore
- [ ] Step 2: Created a security group with no inbound rules
- [ ] Step 3: Launched the instance and saw it Online as a managed node
- [ ] Step 4: Opened a Session Manager shell as ssm-user
- [ ] Step 5: Ran a script on the instance by tag with Run Command
- [ ] Step 6: Scanned for missing patches and read the compliance report
- [ ] Step 7: Restarted the instance with the AWS-RestartEC2Instance runbook
- [ ] Cleanup done
