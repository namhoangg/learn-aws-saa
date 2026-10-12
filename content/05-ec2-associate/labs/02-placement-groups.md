---
id: 05-ec2-associate-lab-02
title: Create cluster, spread and partition placement groups and see where instances land
objective: Create one placement group of each classic strategy, launch small instances into the spread and partition groups, read their placement and partition numbers, see why burstable instances cannot join a cluster group, and move an instance out of a group.
estimatedTime: 35 minutes
cost: "Under USD 0.03 if finished within an hour in us-east-1: four t3.micro instances for about 30 minutes (USD 0.0104 per hour each) and their 8 GiB gp3 root volumes. Placement groups are free. The instances are launched without public IPv4 addresses to avoid that charge."
freeTier: partial
services: [ec2, placement-groups, vpc]
---

> [!COST]
> Placement groups themselves cost nothing. You pay for the four `t3.micro` instances while they run
> (USD 0.0104 per hour each in us-east-1) and for their small gp3 root volumes (USD 0.08 per GB-month).
> The lab launches them **without public IPv4 addresses**, which avoids the USD 0.005 per hour public
> IPv4 charge and is good practice for instances nobody needs to reach from the internet. Expect less
> than USD 0.03; Free Tier credits normally cover it.

## Prerequisites

- An AWS account with the **default VPC** in the Region you use (the examples use `us-east-1`).
- An IAM identity allowed to manage EC2 instances and placement groups (for example `AmazonEC2FullAccess` in a sandbox account).
- Optional: AWS CLI v2 configured (or AWS CloudShell) for the CLI tabs. The CLI examples use `bash`.

## Steps

### Step 1: Create three placement groups

:::console
1. Open the **EC2** console in **US East (N. Virginia)** and, in the navigation pane, choose **Network & Security** → **Placement Groups** → **Create placement group**.
2. **Name**: `lab-cluster`; **Placement strategy**: **Cluster**. Choose **Create group**.
3. Choose **Create placement group** again. **Name**: `lab-spread`; **Placement strategy**: **Spread**; **Spread level**: **Rack**. Choose **Create group**.
4. Choose **Create placement group** again. **Name**: `lab-partition`; **Placement strategy**: **Partition**; **Number of partitions**: `2`. Choose **Create group**.
:::

:::cli
```bash
REGION=us-east-1
aws ec2 create-placement-group --region $REGION --group-name lab-cluster   --strategy cluster
aws ec2 create-placement-group --region $REGION --group-name lab-spread    --strategy spread --spread-level rack
aws ec2 create-placement-group --region $REGION --group-name lab-partition --strategy partition --partition-count 2

aws ec2 describe-placement-groups --region $REGION \
  --group-names lab-cluster lab-spread lab-partition \
  --query "PlacementGroups[].[GroupName,Strategy,PartitionCount,SpreadLevel,State]" --output table
```
:::

> [!CHECK]
> The **Placement Groups** page lists three groups in state **available**: `lab-cluster` (cluster),
> `lab-spread` (spread, rack) and `lab-partition` (partition, 2 partitions). Nothing has been billed yet.

### Step 2: Launch two instances into the spread placement group

:::console
1. Choose **Instances** → **Launch instances**.
2. **Name**: `pg-spread`. Keep the default **Amazon Linux 2023 AMI**. **Instance type**: `t3.micro`.
3. **Key pair (login)**: **Proceed without a key pair (Not recommended)**.
4. **Network settings** → **Edit**: keep the default VPC, choose any subnet, set **Auto-assign public IP** to **Disable**, and for **Firewall (security groups)** choose **Select existing security group** → **default**.
5. Expand **Advanced details** and, for **Placement group**, choose `lab-spread`.
6. In **Summary**, set **Number of instances** to `2` and choose **Launch instance**.
:::

:::cli
```bash
SUBNET=$(aws ec2 describe-subnets --region $REGION \
  --filters Name=default-for-az,Values=true Name=availability-zone,Values=us-east-1a \
  --query "Subnets[0].SubnetId" --output text)
AMI=resolve:ssm:/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64

# Two instances in one request; --no-associate-public-ip-address skips the public IPv4 charge
aws ec2 run-instances --region $REGION \
  --image-id $AMI --instance-type t3.micro \
  --subnet-id $SUBNET --no-associate-public-ip-address \
  --count 2 \
  --credit-specification CpuCredits=standard \
  --placement GroupName=lab-spread \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=pg-spread}]' \
  --query "Instances[].InstanceId" --output text
```
:::

> [!CHECK]
> Select one `pg-spread` instance and open the **Details** tab: under **Host and placement group**,
> **Placement group** shows `lab-spread`. EC2 has put each instance on a different rack; you cannot
> see racks, but a spread group guarantees it. An eighth running instance in the same AZ would be
> refused.

### Step 3: Launch two instances into the partition placement group

:::console
1. Launch instances again as in Step 2, but use **Name** `pg-partition` and, under **Advanced details**, choose **Placement group** `lab-partition`. Leave the partition choice automatic if the console offers one.
2. Set **Number of instances** to `2` and choose **Launch instance**.
3. Select each `pg-partition` instance and open **Details** → **Host and placement group**.
:::

:::cli
```bash
# Target each partition explicitly
for p in 1 2; do
  aws ec2 run-instances --region $REGION \
    --image-id $AMI --instance-type t3.micro \
    --subnet-id $SUBNET --no-associate-public-ip-address \
    --credit-specification CpuCredits=standard \
    --placement GroupName=lab-partition,PartitionNumber=$p \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=pg-partition-$p}]" \
    --query "Instances[0].InstanceId" --output text
done

aws ec2 describe-instances --region $REGION \
  --filters Name=placement-group-name,Values=lab-spread,lab-partition \
            Name=instance-state-name,Values=pending,running \
  --query "Reservations[].Instances[].[Tags[?Key=='Name']|[0].Value,InstanceId,Placement.GroupName,Placement.PartitionNumber,Placement.AvailabilityZone]" \
  --output table
```
:::

> [!CHECK]
> **Partition number** is shown for the `lab-partition` instances (1 and 2 when targeted from the CLI;
> with the console, EC2 tries to spread them evenly, so you will normally see one in each). Spread
> instances have no partition number. Software such as Kafka or Cassandra reads the same value from
> instance metadata at `placement/partition-number`.

### Step 4: Try to put a burstable instance into the cluster group

Cluster placement groups do not accept burstable (T-family) instance types. Try it to see the
rule enforced.

:::console
1. Start another launch: **Name** `pg-cluster-test`, `t3.micro`, no key pair, **Auto-assign public IP** **Disable**, security group **default**.
2. Under **Advanced details** → **Placement group**, choose `lab-cluster` and choose **Launch instance**.
:::

:::cli
```bash
aws ec2 run-instances --region $REGION \
  --image-id $AMI --instance-type t3.micro \
  --subnet-id $SUBNET --no-associate-public-ip-address \
  --placement GroupName=lab-cluster \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=pg-cluster-test}]'
```
:::

> [!CHECK]
> The launch is rejected with an error about the instance type and the cluster placement group (or
> the console does not let you pick the group for this type). This is why HPC clusters use compute-
> or network-optimized types such as C-family instances. If an instance does launch, terminate
> `pg-cluster-test` during cleanup.

### Step 5: Move a spread instance out of its placement group

An instance must be **stopped** before its placement group can change.

:::console
1. Select one `pg-spread` instance and choose **Instance state** → **Stop instance** → **Stop**. Wait for **Stopped**.
2. Choose **Actions** → **Instance settings** → **Modify instance placement**.
3. For **Placement group**, choose **None** and choose **Save**.
4. Check **Details** → **Host and placement group**.
:::

:::cli
```bash
aws ec2 stop-instances --region $REGION --instance-ids i-SPREAD1
aws ec2 wait instance-stopped --region $REGION --instance-ids i-SPREAD1

# An empty group name removes the instance from its placement group
aws ec2 modify-instance-placement --region $REGION --instance-id i-SPREAD1 --group-name ""

aws ec2 describe-instances --region $REGION --instance-ids i-SPREAD1 \
  --query "Reservations[0].Instances[0].Placement" --output json
```
:::

> [!CHECK]
> The stopped instance no longer shows a placement group. Trying the same change on a **running**
> instance is not allowed, which is why the exam says "stop the instance first".

## Cleanup

Delete in this order:

- [ ] **Instances** `pg-spread` (2), `pg-partition` (2, or `pg-partition-1` and `pg-partition-2`) and `pg-cluster-test` (only if it launched): Console: **Instances** → filter by name `pg-` → select all → **Instance state** → **Terminate (delete) instance** → **Terminate (delete)**. CLI: `aws ec2 terminate-instances --region us-east-1 --instance-ids i-... i-... i-... i-...` and then `aws ec2 wait instance-terminated --region us-east-1 --instance-ids i-... i-... i-... i-...`.
- [ ] **Placement groups** `lab-cluster`, `lab-spread`, `lab-partition` (only after the instances are **terminated**, because a group must be empty): Console: **Placement Groups** → select a group → **Actions** → **Delete** → type **Delete** → **Delete**; repeat for each. CLI: `aws ec2 delete-placement-group --region us-east-1 --group-name lab-cluster`, and the same for `lab-spread` and `lab-partition`.
- [ ] **EBS root volumes**: deleted with the instances by default. Confirm under **Elastic Block Store** → **Volumes** that no `available` 8 GiB volume remains (CLI: `aws ec2 describe-volumes --region us-east-1 --filters Name=status,Values=available`).
- [ ] **Final check**: **Placement Groups** shows none of the `lab-` groups, and no `pg-` instance is running or stopped.

## Progress checklist

- [ ] Step 1: Cluster, spread and partition groups created
- [ ] Step 2: Two instances launched into the spread group
- [ ] Step 3: Two instances launched into the partition group and partition numbers read
- [ ] Step 4: Burstable instance refused by the cluster group
- [ ] Step 5: Stopped instance removed from its placement group
- [ ] Cleanup complete: instances terminated and placement groups deleted
