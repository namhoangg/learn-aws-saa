---
id: 04-ec2-purchasing-lab-02
title: Launch a persistent Spot Instance, watch its request change state, and remove it the right way
objective: Request a t3.micro Spot Instance with a persistent request, observe the active, disabled and open states, see why terminating first relaunches capacity, then cancel the request and terminate its instances correctly.
estimatedTime: 35 minutes
cost: "Usually under USD 0.05 in total: t3.micro Spot capacity (about USD 0.004 per hour in us-east-1 when written) plus a small 8 GiB EBS root volume while instances exist. Spot usage may not be covered by Free Tier offers."
freeTier: partial
services: [ec2, ec2-spot]
---

> [!COST]
> You pay the current Spot price for each running `t3.micro` Spot Instance (a fraction of a US cent
> per hour; check **Spot Requests** → **Pricing history** for your Region) and the EBS storage of
> each instance's root volume while it exists, including while an instance is stopped. With the
> whole lab finished in under an hour, expect less than USD 0.05. Do not assume Free Tier credits
> or legacy Free Tier hours cover Spot usage. The real risk is forgetting the cleanup: a persistent
> request keeps replacing instances until you cancel it.

## Prerequisites

- An AWS account with a default VPC in the Region you use (the examples use `us-east-1`).
- An IAM identity allowed to run, stop, start and terminate EC2 instances and to manage Spot requests (for example `AmazonEC2FullAccess` in a sandbox account).
- AWS CLI v2 configured if you want the CLI tabs (AWS CloudShell works). The CLI examples use `bash`.
- Your Spot vCPU quota must allow at least 2 vCPUs (one `t3.micro`); new accounts normally do.

## Steps

### Step 1: Check the current Spot price for t3.micro

:::console
1. Open the **EC2** console and choose **Spot Requests** → **Pricing history**.
2. For **Graph**, choose **Availability Zones**; set **Instance type** to `t3.micro`, **Platform** to **Linux/UNIX** and a recent **Date range**.
3. Compare the price with the On-Demand price for `t3.micro` (USD 0.0104 per hour in us-east-1 at the time of writing).
:::

:::cli
```bash
aws ec2 describe-spot-price-history \
  --region us-east-1 \
  --instance-types t3.micro \
  --product-descriptions "Linux/UNIX" \
  --max-items 6 \
  --query "SpotPriceHistory[].[AvailabilityZone,SpotPrice,Timestamp]" \
  --output table
```
:::

> [!CHECK]
> The Spot price is well below the On-Demand price and differs slightly between AZs.

### Step 2: Launch a Spot Instance with a persistent request

:::console
1. In the **EC2** console, choose **Instances** → **Launch instances**.
2. Under **Name and tags**, enter `spot-lab`.
3. Under **Application and OS Images (Amazon Machine Image)**, keep **Amazon Linux** and the default Amazon Linux 2023 AMI.
4. Under **Instance type**, choose `t3.micro`.
5. Under **Key pair (login)**, choose **Proceed without key pair (Not recommended)**. You will not connect to this instance.
6. Leave **Network settings** and **Configure storage** at their defaults.
7. Expand **Advanced details**. Under **Purchasing option**, select **Request Spot Instances**, then choose **Customize** and set:
   - **Maximum price**: **No maximum price** (recommended).
   - **Request type**: **Persistent request**.
   - **Valid to**: **No request expiry date**.
   - **Interruption behavior**: **Stop**. (For a persistent request the wizard accepts only **Stop** or **Hibernate**; keeping the default **Terminate** makes the launch fail.)
8. In the **Summary** panel, keep **Number of instances** at `1` and choose **Launch instance**.
:::

:::cli
```bash
# Market options for a persistent request that stops (instead of terminating) on interruption
cat > spot-options.json <<'EOF'
{
  "MarketType": "spot",
  "SpotOptions": {
    "SpotInstanceType": "persistent",
    "InstanceInterruptionBehavior": "stop"
  }
}
EOF

aws ec2 run-instances \
  --region us-east-1 \
  --image-id resolve:ssm:/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --instance-type t3.micro \
  --count 1 \
  --instance-market-options file://spot-options.json \
  --credit-specification CpuCredits=standard \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=spot-lab}]' \
                       'ResourceType=spot-instances-request,Tags=[{Key=Name,Value=spot-lab}]' \
  --query "Instances[0].[InstanceId,SpotInstanceRequestId,InstanceLifecycle]" \
  --output table
```
Write down the instance ID (`i-...`) and the request ID (`sir-...`).
:::

> [!CHECK]
> In **Spot Requests**, a new request shows **State** `active` and, under **Capacity**, the ID of
> your instance. In **Instances**, select `spot-lab` and open the **Details** tab: **Lifecycle** is
> `spot` (an On-Demand instance shows `normal`).

:::cli
```bash
aws ec2 describe-spot-instance-requests \
  --region us-east-1 \
  --spot-instance-request-ids sir-REPLACE_ME \
  --query "SpotInstanceRequests[].[SpotInstanceRequestId,Type,State,Status.Code,InstanceId]" \
  --output table
```
:::

### Step 3: Stop and start the instance to see the disabled state

Only Spot Instances from a **persistent** request can be stopped by you.

:::console
1. In **Instances**, select the Spot Instance and choose **Instance state** → **Stop instance**, then **Stop**.
2. Wait until the instance is `stopped`, then refresh **Spot Requests**.
3. Back in **Instances**, choose **Instance state** → **Start instance**.
:::

:::cli
```bash
aws ec2 stop-instances --region us-east-1 --instance-ids i-REPLACE_ME
aws ec2 wait instance-stopped --region us-east-1 --instance-ids i-REPLACE_ME
aws ec2 describe-spot-instance-requests --region us-east-1 \
  --spot-instance-request-ids sir-REPLACE_ME \
  --query "SpotInstanceRequests[].[State,Status.Code]" --output table

aws ec2 start-instances --region us-east-1 --instance-ids i-REPLACE_ME
```
:::

> [!CHECK]
> While the instance is stopped, the request state is `disabled` (status `instance-stopped-by-user`).
> After you start the instance again (Spot capacity permitting), the request may show `open` for a
> moment and then returns to `active` with the same instance ID. While stopped you paid only for the
> EBS volume.

### Step 4: Terminate the instance first (the wrong order) and watch a replacement appear

:::console
1. In **Instances**, select the Spot Instance and choose **Instance state** → **Terminate (delete) instance**, then confirm with **Terminate (delete)**.
2. Open **Spot Requests** and refresh every 30 seconds or so for a few minutes.
:::

:::cli
```bash
aws ec2 terminate-instances --region us-east-1 --instance-ids i-REPLACE_ME

# Run this a few times: the request reopens, then becomes active with a NEW instance ID
aws ec2 describe-spot-instance-requests --region us-east-1 \
  --spot-instance-request-ids sir-REPLACE_ME \
  --query "SpotInstanceRequests[].[State,Status.Code,InstanceId]" --output table
```
:::

> [!CHECK]
> The request moves back to `open` and, once capacity is found, to `active` again with a different
> instance ID under **Capacity**. This is the classic trap: with a persistent request, terminating
> the instance does not stop the spending. Note the new instance ID; the replacement may not carry
> the `spot-lab` name tag.

### Step 5: Cancel the request, then terminate its instance (the right order)

:::console
1. In **Spot Requests**, select your request and choose **Actions** → **Cancel request**.
2. In the **Cancel Spot request** dialog, select **Terminate instances**, then choose **Confirm**.
:::

:::cli
```bash
# 1) cancel the request so it can no longer launch anything
aws ec2 cancel-spot-instance-requests --region us-east-1 \
  --spot-instance-request-ids sir-REPLACE_ME

# 2) then terminate the replacement instance it launched
aws ec2 terminate-instances --region us-east-1 --instance-ids i-REPLACE_WITH_NEW_ID
```
:::

> [!CHECK]
> The request state becomes `cancelled`, the instance moves to `shutting-down` and then
> `terminated`, and no new instance appears after a few minutes. If you had cancelled without
> terminating, the running instance would have kept running and billing.

## Cleanup

Delete in this order:

- [ ] **Spot Instance request** `spot-lab` (`sir-...`): state is `cancelled`. Console: **Spot Requests** → select → **Actions** → **Cancel request**. CLI: `aws ec2 cancel-spot-instance-requests --region us-east-1 --spot-instance-request-ids sir-REPLACE_ME`.
- [ ] **Every Spot Instance the request launched** (the original from Step 2 and the replacement from Step 4): all `terminated`. Console: **Instances** → filter **Instance lifecycle=spot** → select any that are not terminated → **Instance state** → **Terminate (delete) instance**. CLI: `aws ec2 describe-instances --region us-east-1 --filters Name=instance-lifecycle,Values=spot Name=instance-state-name,Values=pending,running,stopping,stopped --query "Reservations[].Instances[].InstanceId"` must return an empty list.
- [ ] **EBS root volumes**: Amazon Linux root volumes are deleted on termination by default; confirm in **Elastic Block Store** → **Volumes** that no `available` 8 GiB volume is left from this lab (CLI: `aws ec2 describe-volumes --region us-east-1 --filters Name=status,Values=available`). Delete any leftover with **Actions** → **Delete volume** or `aws ec2 delete-volume --volume-id vol-REPLACE_ME`.
- [ ] **Local file** `spot-options.json` (CLI users): `rm spot-options.json`.
- [ ] **Final check**: no running or stopped instances remain in the Region you used, and **Spot Requests** shows no `open` or `active` request.

## Progress checklist

- [ ] Step 1: Spot price for t3.micro checked
- [ ] Step 2: Persistent Spot request launched and observed as active
- [ ] Step 3: Instance stopped (request disabled) and started again
- [ ] Step 4: Instance terminated first and the replacement observed
- [ ] Step 5: Request cancelled and its instance terminated
- [ ] Cleanup complete: no Spot requests, instances or leftover volumes
