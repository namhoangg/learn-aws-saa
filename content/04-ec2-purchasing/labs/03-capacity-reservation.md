---
id: 04-ec2-purchasing-lab-03
title: Reserve, use and cancel an On-Demand Capacity Reservation
objective: Create a targeted Capacity Reservation for one t3.micro in a chosen Availability Zone, launch an instance into it, see what happens when the reservation is full, then cancel it and clean up.
estimatedTime: 25 minutes
cost: "About USD 0.01–0.03: the reservation is billed at the t3.micro On-Demand rate (USD 0.0104 per hour in us-east-1 when written) whether used or not, plus the instance's small EBS root volume. The t3.micro instance itself may be covered by Free Tier credits or legacy Free Tier hours."
freeTier: partial
services: [ec2, ec2-capacity-reservations]
---

> [!COST]
> A Capacity Reservation is charged at the On-Demand rate of its instance type for every second it
> is active (60-second minimum), even while no instance uses it. When a matching instance runs in
> it, you pay for the instance instead of the reservation, not both. For one `t3.micro` kept for
> under an hour, expect a few US cents at most. Unused reservation time is not something to rely on
> Free Tier to cover. Cancel the reservation as soon as you finish.

## Prerequisites

- An AWS account with a default VPC (default subnets in each AZ) in the Region you use; examples use `us-east-1`.
- An IAM identity allowed to manage EC2 instances and Capacity Reservations (for example `AmazonEC2FullAccess` in a sandbox account).
- Spare On-Demand vCPU quota for at least 2 vCPUs: reservations count against the On-Demand quota even when unused.
- AWS CLI v2 configured if you want the CLI tabs (AWS CloudShell works).

## Steps

### Step 1: Create a targeted Capacity Reservation

:::console
1. Open the **EC2** console and choose **Capacity Reservations** → **Create Capacity Reservation**.
2. In **Instance details**, set **Instance Type** to `t3.micro`, **Platform** to **Linux/UNIX**, choose an **Availability Zone** (for example `us-east-1a`), keep **Tenancy** as **Default**, and set **Total instance count** to `1`.
3. In **Reservation details**, set **Capacity Reservation starts** to **Immediately**, **Capacity Reservation ends** to **Manually**, and **Instance eligibility** to **targeted** (so no other instance in your account slips into it).
4. Choose **Create**.
:::

:::cli
```bash
aws ec2 create-capacity-reservation \
  --region us-east-1 \
  --availability-zone us-east-1a \
  --instance-type t3.micro \
  --instance-platform Linux/UNIX \
  --tenancy default \
  --instance-count 1 \
  --instance-match-criteria targeted \
  --tag-specifications 'ResourceType=capacity-reservation,Tags=[{Key=Name,Value=cr-lab}]' \
  --query "CapacityReservation.[CapacityReservationId,State,AvailabilityZone]" \
  --output table
```
Write down the reservation ID (`cr-...`).
:::

> [!CHECK]
> The reservation is `active`, with a total capacity of 1 and 1 available. From this moment you are
> paying the `t3.micro` On-Demand rate even though nothing runs in it: capacity, not a discount.

:::cli
```bash
aws ec2 describe-capacity-reservations --region us-east-1 \
  --capacity-reservation-ids cr-REPLACE_ME \
  --query "CapacityReservations[0].[State,TotalInstanceCount,AvailableInstanceCount,InstanceMatchCriteria]" \
  --output table
```
:::

### Step 2: Launch an instance into the reservation

:::console
1. Choose **Instances** → **Launch instances**. Name it `cr-lab`, keep the default Amazon Linux 2023 AMI, choose `t3.micro` and **Proceed without key pair (Not recommended)**.
2. Under **Network settings**, choose **Edit** and select the default **Subnet** in the same Availability Zone as the reservation (for example `us-east-1a`).
3. Expand **Advanced details**. For **Capacity Reservation**, choose **Specify Capacity Reservation** and select the reservation you created.
4. Choose **Launch instance**.
:::

:::cli
```bash
# Default subnet in the reservation's AZ
SUBNET_ID=$(aws ec2 describe-subnets --region us-east-1 \
  --filters Name=default-for-az,Values=true Name=availability-zone,Values=us-east-1a \
  --query "Subnets[0].SubnetId" --output text)

aws ec2 run-instances \
  --region us-east-1 \
  --image-id resolve:ssm:/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --instance-type t3.micro \
  --count 1 \
  --subnet-id "$SUBNET_ID" \
  --capacity-reservation-specification "CapacityReservationTarget={CapacityReservationId=cr-REPLACE_ME}" \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=cr-lab}]' \
  --query "Instances[0].[InstanceId,Placement.AvailabilityZone]" \
  --output table
```
:::

> [!CHECK]
> The reservation now shows 0 available out of 1. The instance is running inside reserved capacity,
> and the bill now shows normal instance usage instead of an unused reservation.

:::cli
```bash
aws ec2 describe-instances --region us-east-1 --instance-ids i-REPLACE_ME \
  --query "Reservations[0].Instances[0].[State.Name,CapacityReservationId]" --output table
```
:::

### Step 3: Try to launch a second instance into the full reservation

:::console
1. Repeat Step 2 with the name `cr-lab-2`, again choosing **Specify Capacity Reservation** with the same reservation.
2. Choose **Launch instance** and read the result.
:::

:::cli
```bash
aws ec2 run-instances \
  --region us-east-1 \
  --image-id resolve:ssm:/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --instance-type t3.micro \
  --count 1 \
  --subnet-id "$SUBNET_ID" \
  --capacity-reservation-specification "CapacityReservationTarget={CapacityReservationId=cr-REPLACE_ME}"
```
:::

> [!CHECK]
> The launch fails because the targeted reservation has no available capacity. A reservation holds
> exactly the number of instances you asked for. If an instance did launch here, terminate it in
> Cleanup as well.

### Step 4: Cancel the reservation while the instance keeps running

:::console
1. Choose **Capacity Reservations**, select your reservation and choose **Cancel reservation**.
2. Because this immediate-use reservation has no commitment, no cancellation charge applies. Confirm by choosing **Cancel reservation**.
3. Open **Instances** and check the `cr-lab` instance.
:::

:::cli
```bash
aws ec2 cancel-capacity-reservation --region us-east-1 \
  --capacity-reservation-id cr-REPLACE_ME

aws ec2 describe-capacity-reservations --region us-east-1 \
  --capacity-reservation-ids cr-REPLACE_ME \
  --query "CapacityReservations[0].State" --output text
```
:::

> [!CHECK]
> The reservation state is `cancelled`, and the instance is still `running`: it simply continues as
> a normal On-Demand instance outside any reservation. Cancelling a reservation never stops or
> terminates instances.

## Cleanup

Delete in this order:

- [ ] **Capacity Reservation** `cr-lab` (`cr-...`): state `cancelled`. Console: **Capacity Reservations** → select → **Cancel reservation**. CLI: `aws ec2 cancel-capacity-reservation --region us-east-1 --capacity-reservation-id cr-REPLACE_ME`.
- [ ] **Instance** `cr-lab` (and `cr-lab-2` if it launched): terminated. Console: **Instances** → select → **Instance state** → **Terminate (delete) instance** → **Terminate (delete)**. CLI: `aws ec2 terminate-instances --region us-east-1 --instance-ids i-REPLACE_ME`.
- [ ] **EBS root volumes**: deleted automatically on termination by default; confirm in **Elastic Block Store** → **Volumes** that no `available` volume from this lab remains (CLI: `aws ec2 describe-volumes --region us-east-1 --filters Name=status,Values=available`), and delete any leftover with `aws ec2 delete-volume --volume-id vol-REPLACE_ME`.
- [ ] **Final check**: **Capacity Reservations** shows no `active` reservation and **Instances** shows no running or stopped instance from this lab in the Region you used. A day later, Billing and Cost Management → **Bills** should show only a few cents of EC2 usage.

## Progress checklist

- [ ] Step 1: Targeted Capacity Reservation created and observed as active and unused
- [ ] Step 2: Instance launched into the reservation (0 available)
- [ ] Step 3: Second launch rejected by the full reservation
- [ ] Step 4: Reservation cancelled while the instance kept running
- [ ] Cleanup complete: reservation cancelled, instances terminated, no leftover volumes
