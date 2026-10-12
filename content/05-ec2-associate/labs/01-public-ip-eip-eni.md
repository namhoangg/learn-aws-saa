---
id: 05-ec2-associate-lab-01
title: Watch public IPs change, pin one with an Elastic IP, and move a network interface between instances
objective: Launch two instances in one subnet, see the public IPv4 change on stop/start while the private IPv4 stays, fix it with an Elastic IP, then move a secondary network interface (with its Elastic IP) from one instance to the other to simulate failover.
estimatedTime: 45 minutes
cost: "About USD 0.04 if finished within an hour in us-east-1: two t3.micro instances (USD 0.0104 per hour each), three public IPv4 addresses (USD 0.005 per hour each, including the Elastic IP) and two 8 GiB gp3 volumes. New accounts' Free Tier credits normally cover it."
freeTier: partial
services: [ec2, elastic-ip, eni, vpc, subnet, security-groups]
---

> [!COST]
> You pay for each `t3.micro` instance while it runs (USD 0.0104 per hour in us-east-1), for every
> public IPv4 address (USD 0.005 per hour each, whether auto-assigned or an Elastic IP, attached or
> idle) and for EBS storage (gp3 is USD 0.08 per GB-month, so two 8 GiB root volumes cost a fraction
> of a cent per hour). Expect about USD 0.04 for the whole lab. Accounts with Free Tier credits are
> normally covered. The usual surprise is an **Elastic IP left allocated** after the lab: it keeps
> billing even with no instance, so follow the Cleanup section to the end.

## Prerequisites

- An AWS account with the **default VPC** still present in the Region you use (the examples use `us-east-1`).
- An IAM identity allowed to launch, stop, start and terminate instances and to manage Elastic IPs and network interfaces (for example `AmazonEC2FullAccess` in a sandbox account).
- Optional: AWS CLI v2 configured (or AWS CloudShell) for the CLI tabs. The CLI examples use `bash`.
- A note-taking place for IDs: you will record instance IDs, an allocation ID and a network interface ID.

## Steps

### Step 1: Launch two instances into the same subnet

Both instances must be in the **same Availability Zone** so the network interface can move between
them later. Launching both into one subnet guarantees that.

:::console
1. Open the **EC2** console in **US East (N. Virginia)** and choose **Instances** → **Launch instances**.
2. Under **Name and tags**, enter `ip-lab`.
3. Under **Application and OS Images (Amazon Machine Image)**, keep **Amazon Linux** with the default **Amazon Linux 2023 AMI**.
4. Under **Instance type**, choose `t3.micro`.
5. Under **Key pair (login)**, choose **Proceed without a key pair (Not recommended)**. You will not log in during this lab.
6. Under **Network settings**, choose **Edit**:
   - **VPC**: the default VPC.
   - **Subnet**: pick one subnet and note its Availability Zone (for example `us-east-1a`).
   - **Auto-assign public IP**: **Enable** (the default in a default subnet).
   - **Firewall (security groups)**: **Select existing security group** and choose **default**. It allows no inbound traffic from the internet, which is fine because you will not connect.
7. Leave **Configure storage** at the default 8 GiB gp3 volume.
8. In the **Summary** panel, set **Number of instances** to `2` and choose **Launch instance**.
9. Back in **Instances**, select the first new instance, open the **Tags** tab, choose **Manage tags**, change the **Name** value to `ip-lab-a` and save. Rename the second instance to `ip-lab-b` the same way.
:::

:::cli
```bash
REGION=us-east-1
# A default subnet in one AZ
SUBNET=$(aws ec2 describe-subnets --region $REGION \
  --filters Name=default-for-az,Values=true Name=availability-zone,Values=us-east-1a \
  --query "Subnets[0].SubnetId" --output text)

# Launch both instances; the default subnet assigns public IPv4 addresses automatically
aws ec2 run-instances --region $REGION \
  --image-id resolve:ssm:/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --instance-type t3.micro \
  --subnet-id $SUBNET \
  --count 2 \
  --credit-specification CpuCredits=standard \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=ip-lab}]' \
  --query "Instances[].InstanceId" --output text
# Note the two IDs, then name them
aws ec2 create-tags --region $REGION --resources i-AAAA --tags Key=Name,Value=ip-lab-a
aws ec2 create-tags --region $REGION --resources i-BBBB --tags Key=Name,Value=ip-lab-b
```
Without `--security-group-ids`, the instances get the VPC's default security group.
:::

> [!CHECK]
> Two instances named `ip-lab-a` and `ip-lab-b` reach **Running**, both in the same Availability Zone
> (see the **Availability Zone** column).

### Step 2: Record each instance's private and public IPv4 address

:::console
1. Select `ip-lab-a` and open the **Details** tab (or the **Networking** tab).
2. Write down **Private IPv4 addresses** and **Public IPv4 address**.
3. Repeat for `ip-lab-b`.
:::

:::cli
```bash
aws ec2 describe-instances --region us-east-1 \
  --filters Name=tag:Name,Values=ip-lab-a,ip-lab-b Name=instance-state-name,Values=running \
  --query "Reservations[].Instances[].[Tags[?Key=='Name']|[0].Value,InstanceId,PrivateIpAddress,PublicIpAddress,Placement.AvailabilityZone]" \
  --output table
```
:::

> [!CHECK]
> Each instance has a private address from the default VPC range (`172.31.x.x`) and a public address
> from Amazon's pool. The private addresses are in the same subnet range.

### Step 3: Stop and start instance A and compare its addresses

:::console
1. Select `ip-lab-a` and choose **Instance state** → **Stop instance**, then confirm with **Stop**.
2. While it is **Stopped**, look at the **Details** tab: the **Public IPv4 address** field is empty.
3. Choose **Instance state** → **Start instance** and wait for **Running**.
4. Compare both addresses with your notes from Step 2.
:::

:::cli
```bash
aws ec2 stop-instances --region us-east-1 --instance-ids i-AAAA
aws ec2 wait instance-stopped --region us-east-1 --instance-ids i-AAAA
aws ec2 start-instances --region us-east-1 --instance-ids i-AAAA
aws ec2 wait instance-running --region us-east-1 --instance-ids i-AAAA
aws ec2 describe-instances --region us-east-1 --instance-ids i-AAAA \
  --query "Reservations[0].Instances[0].[PrivateIpAddress,PublicIpAddress]" --output text
```
:::

> [!CHECK]
> The **private** IPv4 is unchanged; the **public** IPv4 is different. Anyone who had the old public
> address (a bookmark, a firewall rule, an SSH config) can no longer reach the instance.

### Step 4: Allocate an Elastic IP and associate it with instance A

:::console
1. In the navigation pane, choose **Network & Security** → **Elastic IPs** → **Allocate Elastic IP address**.
2. Keep **Amazon's pool of IPv4 addresses**, optionally add the tag `Name` = `ip-lab-eip`, and choose **Allocate**.
3. Select the new address and choose **Actions** → **Associate Elastic IP address**.
4. For **Resource type**, choose **Instance**; for **Instance**, choose `ip-lab-a`; choose **Associate**.
5. Open `ip-lab-a` again and check **Public IPv4 address** and **Elastic IP addresses**.
:::

:::cli
```bash
aws ec2 allocate-address --region us-east-1 --domain vpc \
  --tag-specifications 'ResourceType=elastic-ip,Tags=[{Key=Name,Value=ip-lab-eip}]' \
  --query "[AllocationId,PublicIp]" --output text
# Note the allocation ID (eipalloc-...) and the address

aws ec2 associate-address --region us-east-1 \
  --instance-id i-AAAA --allocation-id eipalloc-REPLACE_ME
```
:::

> [!CHECK]
> The instance's public IPv4 is now the Elastic IP. The auto-assigned address from Step 3 is gone
> for good; you cannot get it back.

### Step 5: Stop and start instance A again

:::console
1. Stop `ip-lab-a`, wait for **Stopped**, then start it again (as in Step 3).
2. Check **Public IPv4 address** after it is **Running**.
:::

:::cli
```bash
aws ec2 stop-instances --region us-east-1 --instance-ids i-AAAA
aws ec2 wait instance-stopped --region us-east-1 --instance-ids i-AAAA
aws ec2 start-instances --region us-east-1 --instance-ids i-AAAA
aws ec2 wait instance-running --region us-east-1 --instance-ids i-AAAA
aws ec2 describe-instances --region us-east-1 --instance-ids i-AAAA \
  --query "Reservations[0].Instances[0].PublicIpAddress" --output text
```
:::

> [!CHECK]
> The public address is still the Elastic IP. While the instance was stopped, the Elastic IP stayed
> associated (and kept billing).

### Step 6: Disassociate the Elastic IP

:::console
1. Choose **Elastic IPs**, select `ip-lab-eip`, choose **Actions** → **Disassociate Elastic IP address**, then **Disassociate**.
2. Open `ip-lab-a` and look at **Public IPv4 address**.
:::

:::cli
```bash
ASSOC=$(aws ec2 describe-addresses --region us-east-1 --allocation-ids eipalloc-REPLACE_ME \
  --query "Addresses[0].AssociationId" --output text)
aws ec2 disassociate-address --region us-east-1 --association-id $ASSOC
aws ec2 describe-instances --region us-east-1 --instance-ids i-AAAA \
  --query "Reservations[0].Instances[0].PublicIpAddress" --output text
```
:::

> [!CHECK]
> The instance receives a brand-new auto-assigned public IPv4. The Elastic IP is still allocated to
> your account, now idle, and still billed.

### Step 7: Create a secondary network interface and attach it to instance A

:::console
1. Choose **Network & Security** → **Network Interfaces** → **Create network interface**.
2. **Description**: `ip-lab-eni`. **Subnet**: the **same subnet** you used in Step 1.
3. **Interface type**: **ENA**. **Private IPv4 address**: **Auto-assign**.
4. **Security groups**: select **default**. Choose **Create network interface** and note its ID (`eni-...`) and **Primary private IPv4 address**.
5. Select the new interface and choose **Actions** → **Attach**. Choose instance `ip-lab-a` and choose **Attach**.
6. Choose **Elastic IPs**, select `ip-lab-eip`, choose **Actions** → **Associate Elastic IP address**. For **Resource type**, choose **Network interface**, select `ip-lab-eni`, and choose **Associate**.
:::

:::cli
```bash
# Same subnet as instance A (needed if you used the console in Step 1)
SUBNET=$(aws ec2 describe-instances --region us-east-1 --instance-ids i-AAAA \
  --query "Reservations[0].Instances[0].SubnetId" --output text)

ENI=$(aws ec2 create-network-interface --region us-east-1 \
  --subnet-id $SUBNET \
  --description "ip-lab-eni" \
  --query "NetworkInterface.NetworkInterfaceId" --output text)
echo $ENI

# Device index 1 makes it the instance's second interface (eth1)
aws ec2 attach-network-interface --region us-east-1 \
  --network-interface-id $ENI --instance-id i-AAAA --device-index 1

aws ec2 associate-address --region us-east-1 \
  --network-interface-id $ENI --allocation-id eipalloc-REPLACE_ME
```
Without `--groups`, the interface gets the VPC's default security group.
:::

> [!CHECK]
> On `ip-lab-a`, the **Networking** tab now lists two network interfaces. The new one shows its own
> private IPv4 and the Elastic IP. On the **Network Interfaces** page, note the interface's **MAC
> address**.

> [!NOTE]
> From now on, if you stopped and started `ip-lab-a`, it would come back without a new auto-assigned
> public IPv4, because it has a secondary network interface. You will not stop it again in this lab.
> Also note that associating the Elastic IP with the secondary interface did **not** release the
> auto-assigned address on `eth0`; only an association with the primary interface does that.

> [!TIP]
> This lab puts both interfaces in the same subnet to keep things simple. In a real design AWS warns
> that this can cause asymmetric routing, and suggests a secondary private IP on the primary interface,
> or a second interface in a different subnet of the same AZ.

### Step 8: Move the network interface to instance B (simulated failover)

:::console
1. On the **Network Interfaces** page, select `ip-lab-eni` and choose **Actions** → **Detach**, then confirm with **Detach**. Wait until its **Status** is **Available**.
2. With the interface still selected, choose **Actions** → **Attach**, choose `ip-lab-b`, and choose **Attach**.
3. Open `ip-lab-b` → **Networking** tab and compare the interface details with your notes.
:::

:::cli
```bash
ATTACH=$(aws ec2 describe-network-interfaces --region us-east-1 --network-interface-ids $ENI \
  --query "NetworkInterfaces[0].Attachment.AttachmentId" --output text)
aws ec2 detach-network-interface --region us-east-1 --attachment-id $ATTACH
aws ec2 wait network-interface-available --region us-east-1 --network-interface-ids $ENI

aws ec2 attach-network-interface --region us-east-1 \
  --network-interface-id $ENI --instance-id i-BBBB --device-index 1

aws ec2 describe-network-interfaces --region us-east-1 --network-interface-ids $ENI \
  --query "NetworkInterfaces[0].[Attachment.InstanceId,PrivateIpAddress,MacAddress,Association.PublicIp]" \
  --output text
```
:::

> [!CHECK]
> The interface is now attached to `ip-lab-b` with the **same private IPv4, the same Elastic IP and
> the same MAC address**. Any client using those addresses would now reach instance B. This only
> works because both instances are in the same Availability Zone.

## Cleanup

Delete in this order:

- [ ] **Elastic IP `ip-lab-eip`**: disassociate, then release. Console: **Elastic IPs** → select → **Actions** → **Disassociate Elastic IP address** → **Disassociate**; then **Actions** → **Release Elastic IP addresses** → **Release**. CLI: `aws ec2 disassociate-address --region us-east-1 --association-id $(aws ec2 describe-addresses --region us-east-1 --allocation-ids eipalloc-REPLACE_ME --query "Addresses[0].AssociationId" --output text)` then `aws ec2 release-address --region us-east-1 --allocation-id eipalloc-REPLACE_ME`.
- [ ] **Network interface `ip-lab-eni`**: detach from `ip-lab-b`, then delete. Console: **Network Interfaces** → select → **Actions** → **Detach** → **Detach**; when **Available**, **Actions** → **Delete** → **Delete**. CLI: detach as in Step 8, then `aws ec2 delete-network-interface --region us-east-1 --network-interface-id eni-REPLACE_ME`. (A manually created interface is not deleted with the instance.)
- [ ] **Instances `ip-lab-a` and `ip-lab-b`**: Console: **Instances** → select both → **Instance state** → **Terminate (delete) instance** → **Terminate (delete)**. CLI: `aws ec2 terminate-instances --region us-east-1 --instance-ids i-AAAA i-BBBB`.
- [ ] **EBS root volumes**: deleted automatically on termination by default. Confirm in **Elastic Block Store** → **Volumes** that no `available` 8 GiB volume from this lab remains (CLI: `aws ec2 describe-volumes --region us-east-1 --filters Name=status,Values=available`); delete any leftover with **Actions** → **Delete volume**.
- [ ] **Final check**: **Elastic IPs** shows no addresses you allocated, **Network Interfaces** shows no `ip-lab-eni`, and no `ip-lab` instance is running or stopped.

## Progress checklist

- [ ] Step 1: Two instances launched in the same subnet and named
- [ ] Step 2: Private and public IPv4 addresses recorded
- [ ] Step 3: Public IPv4 changed after stop/start, private IPv4 did not
- [ ] Step 4: Elastic IP allocated and associated with instance A
- [ ] Step 5: Elastic IP survived a stop/start
- [ ] Step 6: Elastic IP disassociated; instance got a new public IPv4
- [ ] Step 7: Secondary network interface created, attached and given the Elastic IP
- [ ] Step 8: Network interface moved to instance B with its IPs and MAC address
- [ ] Cleanup complete: Elastic IP released, interface deleted, instances terminated
