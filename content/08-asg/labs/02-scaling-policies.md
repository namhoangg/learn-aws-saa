---
id: 08-asg-lab-02
title: Scale an Auto Scaling group with target tracking and scheduled actions
objective: Add a target tracking policy on ALB requests per target to the lab 01 group, drive it with generated traffic, inspect the alarms it manages, then add one-time and recurring scheduled actions and see how they interact with the policy.
estimatedTime: 70 minutes
cost: "About USD 0.07 to 0.10 per hour in us-east-1 while the lab 01 resources run (ALB, one to four t3.micro instances, their public IPv4 addresses); the generated traffic adds well under USD 0.01 of ALB LCUs, and the two target tracking alarms fall within the CloudWatch Always Free alarm allowance. Roughly USD 0.15 for the whole lab if you clean up promptly."
freeTier: partial
services: [asg, ec2, alb, cloudwatch, cloudwatch-alarms, cloudshell]
---

> [!COST]
> This lab reuses the lab 01 ALB (USD 0.0225 per hour plus LCUs) and lets the group grow to four `t3.micro` instances (USD 0.0104 per hour each, plus USD 0.005 per hour for each public IPv4 address) for about 20 minutes. The load test sends a few thousand requests per minute for 10 minutes, which costs a fraction of a cent in LCUs. The target tracking policy creates two standard CloudWatch alarms, billed hourly at USD 0.10 per alarm per month if you are past the Always Free allowance of 10 alarm metrics. **CloudShell** is free. Finish with the **Cleanup** section, which removes everything from labs 01 and 02.

You will make the lab 01 group elastic. A target tracking policy keeps each instance at about 50 requests per minute, a deliberately tiny target so that a simple loop of `curl` commands from CloudShell is enough to push the group from one to four instances. Then you will add scheduled actions and watch the dynamic policy keep working around them.

## Prerequisites

- Lab 01 completed **without** its cleanup: `demo-asg`, `demo-asg-lt`, `demo-asg-alb`, `demo-asg-tg`, `demo-asg-alb-sg` and `demo-asg-web-sg` exist, and the group has healthy instances registered in `demo-asg-tg`.
- The same IAM permissions and Region as lab 01.
- **AWS CloudShell** opened in the same Region (it is used to generate traffic, even if you follow the console steps). If you are in a new terminal since lab 01, reload the variables:

```bash
REGION=${AWS_REGION:-$(aws configure get region)}
TG_ARN=$(aws elbv2 describe-target-groups --names demo-asg-tg \
  --query 'TargetGroups[0].TargetGroupArn' --output text)
ALB_ARN=$(aws elbv2 describe-load-balancers --names demo-asg-alb \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text)
DNS=$(aws elbv2 describe-load-balancers --names demo-asg-alb \
  --query 'LoadBalancers[0].DNSName' --output text)
ALB_SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=demo-asg-alb-sg \
  --query 'SecurityGroups[0].GroupId' --output text)
WEB_SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=demo-asg-web-sg \
  --query 'SecurityGroups[0].GroupId' --output text)
echo "$DNS"
```

## Steps

### Step 1: Start from a single instance

Shrinking the group first makes the scale-out easy to see.

:::console
1. Open **EC2** → **Auto Scaling Groups**, select `demo-asg`, and on the **Details** tab choose **Group details** → **Edit**.
2. Set **Desired capacity** `1`, **Min desired capacity** `1`, **Max desired capacity** `4`. Choose **Update**.
3. Wait until **Instance management** shows a single `InService` instance.
:::

:::cli
```bash
aws autoscaling update-auto-scaling-group --auto-scaling-group-name demo-asg \
  --min-size 1 --max-size 4 --desired-capacity 1
sleep 90
aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names demo-asg \
  --query 'AutoScalingGroups[0].[MinSize,DesiredCapacity,MaxSize,length(Instances)]' --output text
```
:::

> [!CHECK]
> The group shows min 1, desired 1, max 4, and after the default termination policy has removed one instance, a single healthy target remains in `demo-asg-tg`.

### Step 2: Create a target tracking policy on requests per target

:::console
1. Select `demo-asg` and open the **Automatic scaling** tab. Under **Dynamic scaling policies**, choose **Create dynamic scaling policy**.
2. Keep **Policy type** **Target tracking scaling**. **Scaling policy name** `demo-requests-per-target`.
3. **Metric type**: **Application Load Balancer request count per target**. **Target group**: `demo-asg-tg`.
4. **Target value**: `50` (requests per instance per minute).
5. **Instance warmup**: `60` seconds, the same as the group's default instance warmup from lab 01. Do **not** select **Disable scale in to create only a scale-out policy**.
6. Choose **Create**.
:::

:::cli
```bash
# ResourceLabel = app/<alb-name>/<alb-id>/targetgroup/<tg-name>/<tg-id>
RESOURCE_LABEL="${ALB_ARN#*:loadbalancer/}/${TG_ARN##*:}"
echo "$RESOURCE_LABEL"

cat > tt-config.json <<EOF
{
  "TargetValue": 50.0,
  "PredefinedMetricSpecification": {
    "PredefinedMetricType": "ALBRequestCountPerTarget",
    "ResourceLabel": "$RESOURCE_LABEL"
  }
}
EOF
aws autoscaling put-scaling-policy --auto-scaling-group-name demo-asg \
  --policy-name demo-requests-per-target --policy-type TargetTrackingScaling \
  --target-tracking-configuration file://tt-config.json
```
:::

> [!CHECK]
> The policy appears under **Dynamic scaling policies**. The CLI output lists two alarm names, one containing `AlarmHigh` and one containing `AlarmLow`: the policy created them for you.

### Step 3: Look at the alarms the policy manages

:::console
1. Open the **CloudWatch** console → **Alarms** → **All alarms**. Find the two alarms whose names start with `TargetTracking-demo-asg`.
2. Open the `AlarmHigh` alarm and read its **Conditions**: the metric, the threshold and how many data points must breach.
3. Open the `AlarmLow` alarm and compare. Do **not** edit either alarm.
:::

:::cli
```bash
aws cloudwatch describe-alarms --alarm-name-prefix TargetTracking-demo-asg \
  --query 'MetricAlarms[].[AlarmName,StateValue,ComparisonOperator,Threshold,DatapointsToAlarm,EvaluationPeriods]' \
  --output table
```
:::

> [!CHECK]
> `AlarmHigh` watches `RequestCountPerTarget` above a threshold near 50 over a short run of 1-minute data points. `AlarmLow` uses a lower threshold and needs a much longer run of low data points before it fires. That asymmetry is why target tracking scales out quickly but scales in cautiously. With no traffic yet, `AlarmLow` may show **In alarm** or **Insufficient data**; either way the group cannot go below its minimum of 1, so nothing happens.

### Step 4: Generate traffic from CloudShell

Both paths use this script. Three parallel loops send requests to the ALB for 10 minutes, far more than 50 requests per instance per minute:

```bash
DNS=${DNS:-$(aws elbv2 describe-load-balancers --names demo-asg-alb \
  --query 'LoadBalancers[0].DNSName' --output text)}
END=$(( $(date +%s) + 600 ))
for w in 1 2 3; do
  ( while [ "$(date +%s)" -lt "$END" ]; do curl -s -o /dev/null "http://$DNS/"; done ) &
done
echo "Load running for 10 minutes. Stop it early with: kill \$(jobs -p)"
```

:::console
1. Open **CloudShell** from the console toolbar, in the same Region as the load balancer.
2. Paste the script above and press **Enter**. The first line looks up the load balancer's DNS name for you.
3. Keep the CloudShell tab open while the load runs, and do the next steps in another browser tab.
:::

:::cli
1. Run the script above in the same terminal you used for steps 1–3 (it reuses `$DNS` if it is already set).
2. The loops run in the background, so you can keep using the terminal for step 5.
:::

> [!CHECK]
> After two or three minutes, `demo-asg-tg` → **Monitoring** shows the request count climbing into the thousands per minute. Requests are served by the single instance for now.

### Step 5: Watch the group scale out

:::console
1. In CloudWatch, refresh the `AlarmHigh` alarm until its state is **In alarm**.
2. In **Auto Scaling Groups** → `demo-asg` → **Activity**, refresh until new **Launching a new EC2 instance** activities appear. Read the **Cause** column: it names the alarm and the policy.
3. Check **Instance management** and the target group's **Targets** tab as the new instances become healthy.
4. Refresh `http://<ALB DNS name>` a few times in your browser.
:::

:::cli
```bash
watch_asg() {
  aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names demo-asg \
    --query 'AutoScalingGroups[0].[DesiredCapacity,length(Instances)]' --output text
  aws autoscaling describe-scaling-activities --auto-scaling-group-name demo-asg \
    --max-items 3 --query 'Activities[].[StartTime,StatusCode,Cause]' --output text
}
watch_asg; sleep 180; watch_asg; sleep 180; watch_asg
```
:::

> [!CHECK]
> Within about five minutes of the load starting, the activity cause shows the `AlarmHigh` alarm triggering policy `demo-requests-per-target` and the desired capacity rising, capped at **4** by the maximum even though the traffic would justify far more. New instances register in `demo-asg-tg`, become healthy, and the page now shows several instance IDs across both AZs.

### Step 6: Stop the load and watch the slower scale-in

:::console
1. Let the 10-minute loop finish (or run `kill $(jobs -p)` in CloudShell).
2. Keep an eye on the `AlarmLow` alarm and the group's **Activity** tab. You can continue with step 7 while you wait.
:::

:::cli
```bash
kill $(jobs -p) 2>/dev/null
sleep 900
aws cloudwatch describe-alarms --alarm-name-prefix TargetTracking-demo-asg \
  --query 'MetricAlarms[].[AlarmName,StateValue]' --output table
watch_asg
# Nothing removed yet? Wait a few more minutes and run watch_asg again.
```
:::

> [!CHECK]
> Scale-in starts noticeably later than scale-out did, typically 15 minutes or more after the load stops: `AlarmLow` must see its longer run of low data points first (compare its **DatapointsToAlarm** with `AlarmHigh` from step 3). Then the group removes instances, keeping the AZs balanced, and each is drained from the target group before it terminates. The group never goes below the minimum of 1.

### Step 7: Add one-time and recurring scheduled actions

A one-time action shows a schedule overriding the current size; a recurring action shows how a weekly event would be expressed.

:::console
1. Select `demo-asg` → **Automatic scaling** tab. Under **Scheduled actions**, choose **Create scheduled action**.
2. **Name** `demo-once`. **Desired capacity** `3`, **Min** `1`, **Max** `4`. **Recurrence** **Once**. **Time zone**: your own (or keep `Etc/UTC`). **Specific start time**: about 5 minutes from now. Choose **Create**.
3. Choose **Create scheduled action** again. **Name** `demo-friday-sale`, **Desired capacity** `2`, **Min** `2`, **Max** `4`, **Recurrence** **Cron** with `0 17 * * 5`, **Time zone** `Europe/Paris` (or your own). For **Specific start time**, choose the coming Friday at 17:00, because the action also runs at its start time. Choose **Create**.
4. Wait for `demo-once` to run, then watch the **Activity** tab for the next 15–20 minutes.
:::

:::cli
```bash
# GNU date syntax (CloudShell, Linux). The recurring action gets no start time, so it first runs on Friday.
aws autoscaling put-scheduled-update-group-action --auto-scaling-group-name demo-asg \
  --scheduled-action-name demo-once \
  --start-time "$(date -u -d '+5 minutes' +%Y-%m-%dT%H:%M:%SZ)" \
  --min-size 1 --max-size 4 --desired-capacity 3

aws autoscaling put-scheduled-update-group-action --auto-scaling-group-name demo-asg \
  --scheduled-action-name demo-friday-sale \
  --recurrence "0 17 * * 5" --time-zone "Europe/Paris" \
  --min-size 2 --max-size 4 --desired-capacity 2

aws autoscaling describe-scheduled-actions --auto-scaling-group-name demo-asg \
  --query 'ScheduledUpdateGroupActions[].[ScheduledActionName,Recurrence,TimeZone,StartTime,MinSize,DesiredCapacity]' \
  --output table
sleep 420
watch_asg
```
:::

> [!CHECK]
> Within a couple of minutes of its start time, the activity history shows instances launching because scheduled action `demo-once` set the desired capacity to 3. Because there is no traffic, the target tracking policy later scales the group back in toward 1: scheduled actions set the size at a moment in time, and dynamic policies keep adjusting afterwards within the min and max. `demo-friday-sale` stays listed with its next Friday start time.

## Cleanup

Delete in this order. Deleting the group removes its policies and the alarms that target tracking manages, but deleting the scheduled action and policy explicitly first lets you see that happen.

- [ ] **Scheduled action `demo-friday-sale`** (and `demo-once` if it is still listed): **Automatic scaling** tab → **Scheduled actions** → select → **Actions** → **Delete**. CLI: `aws autoscaling delete-scheduled-action --auto-scaling-group-name demo-asg --scheduled-action-name demo-friday-sale`.
- [ ] **Scaling policy `demo-requests-per-target`**: **Automatic scaling** tab → **Dynamic scaling policies** → select → **Actions** → **Delete**. CLI: `aws autoscaling delete-policy --auto-scaling-group-name demo-asg --policy-name demo-requests-per-target`. Its two `TargetTracking-demo-asg-*` alarms disappear from CloudWatch with it.
- [ ] **Auto Scaling group `demo-asg`**: **Auto Scaling Groups** → select → **Actions** → **Delete**, type `delete`, choose **Delete** (this terminates its instances). CLI: `aws autoscaling delete-auto-scaling-group --auto-scaling-group-name demo-asg --force-delete`. Wait until no `demo-asg-web` instance is pending or running.
- [ ] **Launch template `demo-asg-lt`**: **Launch Templates** → select → **Actions** → **Delete template**, type `Delete`, choose **Delete**. CLI: `aws ec2 delete-launch-template --launch-template-name demo-asg-lt`.
- [ ] **Load balancer `demo-asg-alb`**: **Load Balancers** → select → **Actions** → **Delete load balancer**, confirm. CLI: `aws elbv2 delete-load-balancer --load-balancer-arn "$ALB_ARN"`.
- [ ] **Target group `demo-asg-tg`** (after the load balancer is gone): **Target Groups** → select → **Actions** → **Delete**. CLI: `aws elbv2 delete-target-group --target-group-arn "$TG_ARN"`.
- [ ] **Security group `demo-asg-web-sg`**, then **`demo-asg-alb-sg`**: **Security Groups** → select → **Actions** → **Delete security groups** (retry the ALB group after a few minutes if it reports a dependency). CLI: `aws ec2 delete-security-group --group-id "$WEB_SG"` then `aws ec2 delete-security-group --group-id "$ALB_SG"`.
- [ ] **Local files** `tt-config.json`, plus `user-data.sh` and `lt-data.json` from lab 01 (CLI path): delete them.
- [ ] **Service-linked role `AWSServiceRoleForAutoScaling`**: free; keep it unless you want to remove it in IAM and use no Auto Scaling groups in any Region.
- [ ] **Final check**: in this Region there are no Auto Scaling groups, no load balancers, no `demo-asg-*` target groups or security groups, no running `demo-asg-web` instances, and no CloudWatch alarms starting with `TargetTracking-demo-asg`; the next day **Billing and Cost Management** → **Bills** shows no new Elastic Load Balancing or EC2 charges.

## Progress checklist

- [ ] Step 1: Reduced `demo-asg` to one instance with a maximum of 4
- [ ] Step 2: Created the target tracking policy `demo-requests-per-target` (target 50)
- [ ] Step 3: Compared the `AlarmHigh` and `AlarmLow` alarms the policy created
- [ ] Step 4: Generated 10 minutes of traffic from CloudShell
- [ ] Step 5: Watched the group scale out to its maximum of 4
- [ ] Step 6: Watched the slower, AZ-balanced scale-in after the load stopped
- [ ] Step 7: Created one-time and recurring scheduled actions and saw the policy adjust afterwards
- [ ] Cleanup done for labs 01 and 02
