---
id: 19-containers-lab-02
title: Run a container on ECS Fargate behind an ALB, with auto scaling and stopped-task events
objective: Deploy the Lab 01 image as an ECS service on AWS Fargate behind an Application Load Balancer, add target tracking auto scaling, watch the service replace a stopped task, and capture ECS task state change events with an EventBridge rule.
estimatedTime: 60 minutes
cost: "About USD 0.07 per hour in us-east-1 (ALB hourly charge, two 0.25 vCPU / 0.5 GB Fargate tasks, four public IPv4 addresses); roughly USD 0.10 to 0.15 if you clean up within 90 minutes. Free Tier credits on new accounts can cover it."
freeTier: partial
services: [ecs, fargate, alb, ecr, eventbridge, cloudwatch-logs, application-auto-scaling, iam-roles, security-groups]
---

> [!COST]
> Charges start as soon as the service and load balancer exist. In `us-east-1`: the ALB costs USD 0.0225 per hour plus a negligible LCU charge for test traffic; each Fargate task of 0.25 vCPU and 0.5 GB costs about USD 0.012 per hour (USD 0.0405 per vCPU-hour + USD 0.0044 per GB-hour); each public IPv4 address costs USD 0.005 per hour (one per task and one per AZ the ALB uses). With two tasks in two AZs that is about USD 0.07 per hour, and up to about USD 0.10 per hour if auto scaling runs four tasks. CloudWatch Logs ingestion for this lab is a few KB. A forgotten ALB alone costs about USD 16 per month, so do the **Cleanup** section.

This lab builds the architecture from the lesson: users → ALB → an ECS service on Fargate with tasks in two AZs, a task execution role that pulls the image from ECR and ships logs, Service Auto Scaling, and an EventBridge rule watching for stopped tasks.

## Prerequisites

- Lab 01 completed, with the image `demo-web:v2` still in your ECR repository `demo-web`. If you skipped Lab 01, use the public image `public.ecr.aws/docker/library/httpd:latest` instead (the page then shows "It works!" rather than the task hostname, and the lab still works).
- An AWS account with permissions for ECS, ECR, EC2 (security groups, load balancers), IAM (to create a role), CloudWatch Logs, EventBridge and Application Auto Scaling, for example administrator access in a sandbox account.
- The **US East (N. Virginia) `us-east-1`** Region with its **default VPC** (default subnets are public, so tasks with a public IP can reach ECR without a NAT gateway).
- For the CLI tabs: AWS CloudShell (or AWS CLI v2 with a Bash shell). Keep one terminal open, because later commands reuse shell variables.

## Steps

### Step 1: Prepare the task execution role

Fargate needs a **task execution role** to pull the private image from ECR and to send container output to CloudWatch Logs. Many accounts already have `ecsTaskExecutionRole`; check first. You also add `logs:CreateLogGroup`, because log configurations that ask the log driver to create the group (as the console's default may do) need it and the managed policy does not include it.

:::console
1. Open the **IAM** console, choose **Roles** and search for `ecsTaskExecutionRole`. If it exists, open it and go to item 7.
2. Otherwise choose **Create role**. For **Trusted entity type** choose **AWS service**.
3. For **Service or use case** choose **Elastic Container Service**, then the **Elastic Container Service Task** use case, and choose **Next**.
4. Search for and select **AmazonECSTaskExecutionRolePolicy**, then choose **Next**.
5. For **Role name** enter `ecsTaskExecutionRole` and choose **Create role**.
6. Open the new role.
7. On the **Permissions** tab choose **Add permissions** → **Create inline policy**, switch to **JSON**, paste the policy below, choose **Next**, name it `demo-ecs-create-log-group` and choose **Create policy**.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "logs:CreateLogGroup", "Resource": "*" }
  ]
}
```
:::

:::cli
```bash
export AWS_REGION=us-east-1
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

if ! aws iam get-role --role-name ecsTaskExecutionRole >/dev/null 2>&1; then
  cat > ecs-tasks-trust.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Principal": { "Service": "ecs-tasks.amazonaws.com" }, "Action": "sts:AssumeRole" }
  ]
}
EOF
  aws iam create-role --role-name ecsTaskExecutionRole \
    --assume-role-policy-document file://ecs-tasks-trust.json
  aws iam attach-role-policy --role-name ecsTaskExecutionRole \
    --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
  echo "Created ecsTaskExecutionRole (delete it during cleanup)"
fi
aws iam put-role-policy --role-name ecsTaskExecutionRole \
  --policy-name demo-ecs-create-log-group \
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"logs:CreateLogGroup","Resource":"*"}]}'
EXEC_ROLE_ARN=$(aws iam get-role --role-name ecsTaskExecutionRole --query Role.Arn --output text)
echo "$EXEC_ROLE_ARN"
```
:::

> [!CHECK]
> The role `ecsTaskExecutionRole` has the managed policy **AmazonECSTaskExecutionRolePolicy** and the inline policy `demo-ecs-create-log-group`, and its trust relationship names `ecs-tasks.amazonaws.com`. Write down whether you created the role in this lab: you delete it at the end only if you did.

### Step 2: Create a security group and a log group

For a short lab, one security group allowing HTTP from anywhere is used for both the load balancer and the tasks. In production you would give the tasks their own group that accepts traffic **only from the ALB's security group**.

:::console
1. Open the **EC2** console, choose **Security Groups** → **Create security group**.
2. Name it `demo-ecs-web-sg`, description `HTTP for the ECS demo`, keep the default **VPC**.
3. Under **Inbound rules** choose **Add rule**, **Type** **HTTP**, **Source** **Anywhere-IPv4**. Choose **Create security group**.
4. Open the **CloudWatch** console, choose **Log groups** → **Create log group**, enter `/ecs/demo-web` and choose **Create**.
:::

:::cli
```bash
VPC_ID=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true \
  --query 'Vpcs[0].VpcId' --output text)
SG_ID=$(aws ec2 create-security-group --group-name demo-ecs-web-sg \
  --description "HTTP for the ECS demo" --vpc-id "$VPC_ID" \
  --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$SG_ID" \
  --protocol tcp --port 80 --cidr 0.0.0.0/0
# Two default subnets in different AZs (the default VPC has one per AZ).
read SUBNET_A SUBNET_B <<< "$(aws ec2 describe-subnets \
  --filters Name=vpc-id,Values="$VPC_ID" Name=default-for-az,Values=true \
  --query 'Subnets[0:2].SubnetId' --output text)"
aws logs create-log-group --log-group-name /ecs/demo-web
echo "SG $SG_ID  subnets $SUBNET_A $SUBNET_B"
```
:::

> [!CHECK]
> `demo-ecs-web-sg` has one inbound rule (TCP 80 from `0.0.0.0/0`) and the log group `/ecs/demo-web` exists in CloudWatch Logs.

### Step 3: Create a Fargate cluster

:::console
1. Open the **Amazon ECS** console and choose **Clusters** → **Create cluster**.
2. Under **Cluster configuration**, for **Cluster name** enter `demo-ecs-cluster`. If the page shows an infrastructure choice, keep the Fargate option only.
3. Leave **Monitoring** off (Container Insights is billed per metric or observation) and leave **Task events** off: ECS already sends task state changes to EventBridge, and Step 7 builds its own rule (turning the option on would create an extra rule and log group to clean up).
4. Choose **Create**.
:::

:::cli
```bash
CLUSTER=demo-ecs-cluster
aws ecs create-cluster --cluster-name "$CLUSTER" \
  --capacity-providers FARGATE FARGATE_SPOT \
  --query 'cluster.[clusterName,status]' --output text
```
:::

> [!CHECK]
> The cluster `demo-ecs-cluster` shows status **Active** with 0 services and 0 tasks. The console adds the **FARGATE** and **FARGATE_SPOT** capacity providers automatically (CLI: you added them). You have created no EC2 instances: on Fargate there are none to manage.

### Step 4: Register the task definition

:::console
1. In the ECS console choose **Task definitions** → **Create new task definition** → **Create new task definition**.
2. For **Task definition family** enter `demo-web`. For **Launch type** keep **AWS Fargate**; for **Operating system/Architecture** keep **Linux/X86_64**.
3. For **Task size** choose **.25 vCPU** and **.5 GB**. Keep **Network mode** **awsvpc**.
4. Expand **Task roles**: leave **Task role** empty (the app calls no AWS APIs) and set **Task execution role** to `ecsTaskExecutionRole`.
5. Under the container: **Name** `web`; **Image URI** `<account-id>.dkr.ecr.us-east-1.amazonaws.com/demo-web:v2` (copy it from the image in the ECR console); keep **Essential container** **Yes**; under **Port mappings** set **Container port** `80`, protocol **TCP**.
6. Keep **Use log collection** selected with **Amazon CloudWatch**, and check that the log group option is `/ecs/demo-web` (change it if the default differs).
7. Choose **Create**.
:::

:::cli
```bash
IMAGE="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/demo-web:v2"
# IMAGE=public.ecr.aws/docker/library/httpd:latest   # if you skipped Lab 01
cat > taskdef.json <<EOF
{
  "family": "demo-web",
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc",
  "cpu": "256",
  "memory": "512",
  "runtimePlatform": { "cpuArchitecture": "X86_64", "operatingSystemFamily": "LINUX" },
  "executionRoleArn": "${EXEC_ROLE_ARN}",
  "containerDefinitions": [
    {
      "name": "web",
      "image": "${IMAGE}",
      "essential": true,
      "portMappings": [ { "containerPort": 80, "protocol": "tcp" } ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/demo-web",
          "awslogs-region": "${AWS_REGION}",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
EOF
aws ecs register-task-definition --cli-input-json file://taskdef.json \
  --query 'taskDefinition.taskDefinitionArn' --output text
```
:::

> [!CHECK]
> Task definition `demo-web:1` is **Active**, requires compatibility **FARGATE**, has 0.25 vCPU / 0.5 GB and lists `ecsTaskExecutionRole` as the task execution role. The image is not pulled yet; that happens when a task starts.

### Step 5: Create the service with an ALB and auto scaling

The service keeps two tasks running in two AZs, registers them in an ALB target group of type `ip`, and scales between 1 and 4 tasks to hold average CPU at 50%.

:::console
1. Open **Clusters** → `demo-ecs-cluster`. On the **Services** tab choose **Create**.
2. Under **Service details**, for **Task definition** choose `demo-web` (latest revision) and for **Service name** enter `demo-web-svc`.
3. Under **Compute configuration** keep the default (a capacity provider strategy using **FARGATE**, or the **Fargate** launch type).
4. Under **Deployment configuration** keep **Replica** and set **Desired tasks** to `2`. Set **Health check grace period** to `30`.
5. Expand **Networking**: keep the default **VPC**; under **Subnets** keep exactly **two** subnets in different AZs (remove the others); for **Security group** choose **Use an existing security group**, select `demo-ecs-web-sg` and remove `default`; keep **Public IP** turned on.
6. Expand **Load balancing**: **Load balancer type** **Application Load Balancer**, **Create a new load balancer**, **Load balancer name** `demo-web-alb`, **Choose container to load balance** `web 80:80`, **Listener** port `80` with protocol **HTTP**, **Target group name** `demo-web-tg` with protocol **HTTP**, **Deregistration delay** `30`, **Health check path** `/`.
7. Expand **Service auto scaling** and select **Service auto scaling**. **Minimum number of tasks** `1`, **Maximum number of tasks** `4`, **Scaling policy type** **Target tracking**, **Policy name** `demo-web-cpu50`, **ECS service metric** **ECSServiceAverageCPUUtilization**, **Target value** `50`, **Scale-out cooldown period** `60`, **Scale-in cooldown period** `120`.
8. Choose **Create** and wait until the deployment finishes (2 to 5 minutes).
:::

:::cli
```bash
ALB_ARN=$(aws elbv2 create-load-balancer --name demo-web-alb --type application \
  --subnets "$SUBNET_A" "$SUBNET_B" --security-groups "$SG_ID" \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text)
TG_ARN=$(aws elbv2 create-target-group --name demo-web-tg --protocol HTTP --port 80 \
  --vpc-id "$VPC_ID" --target-type ip --health-check-path / \
  --query 'TargetGroups[0].TargetGroupArn' --output text)
aws elbv2 modify-target-group-attributes --target-group-arn "$TG_ARN" \
  --attributes Key=deregistration_delay.timeout_seconds,Value=30
aws elbv2 create-listener --load-balancer-arn "$ALB_ARN" --protocol HTTP --port 80 \
  --default-actions Type=forward,TargetGroupArn="$TG_ARN"

aws ecs create-service --cluster "$CLUSTER" --service-name demo-web-svc \
  --task-definition demo-web --desired-count 2 --launch-type FARGATE \
  --health-check-grace-period-seconds 30 \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNET_A,$SUBNET_B],securityGroups=[$SG_ID],assignPublicIp=ENABLED}" \
  --load-balancers "targetGroupArn=$TG_ARN,containerName=web,containerPort=80" \
  --query 'service.serviceArn' --output text

aws application-autoscaling register-scalable-target --service-namespace ecs \
  --scalable-dimension ecs:service:DesiredCount \
  --resource-id service/$CLUSTER/demo-web-svc --min-capacity 1 --max-capacity 4
aws application-autoscaling put-scaling-policy --service-namespace ecs \
  --scalable-dimension ecs:service:DesiredCount \
  --resource-id service/$CLUSTER/demo-web-svc \
  --policy-name demo-web-cpu50 --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration \
  '{"TargetValue":50.0,"PredefinedMetricSpecification":{"PredefinedMetricType":"ECSServiceAverageCPUUtilization"},"ScaleOutCooldown":60,"ScaleInCooldown":120}'

aws ecs wait services-stable --cluster "$CLUSTER" --services demo-web-svc
```
:::

> [!CHECK]
> The service shows **2/2 tasks running** and the deployment is **Completed**. On the **Tasks** tab both tasks are **Running** in two different AZs, each with its own private IP. In **EC2** → **Target groups** → `demo-web-tg`, the target type is **IP** and both task IPs are **Healthy**. On the ALB's **Security** tab, note every security group ID it uses; you need them for cleanup.

> [!TIP]
> If tasks stop with a `CannotPullContainerError` or an `AccessDenied` message, read the **Stopped reason** on the task: it is almost always the task execution role (ECR or logs permission) or a missing public IP / route to the internet.

### Step 6: Test the load balancer and read the logs

:::console
1. In **EC2** → **Load balancers**, select `demo-web-alb` and copy its **DNS name**.
2. Open `http://<DNS name>` in a browser and refresh several times.
3. In **CloudWatch** → **Log groups** → `/ecs/demo-web`, open a log stream named `ecs/web/<task-id>`.
:::

:::cli
```bash
ALB_DNS=$(aws elbv2 describe-load-balancers --names demo-web-alb \
  --query 'LoadBalancers[0].DNSName' --output text)
for i in $(seq 1 6); do curl -s "http://$ALB_DNS"; echo; done
aws logs tail /ecs/demo-web --since 10m | tail -n 5
```
:::

> [!CHECK]
> The page shows `demo-web v2` and **two different hostnames** across refreshes (`ip-172-31-...`), proving the ALB spreads requests over both tasks. The log stream contains Apache access lines, including the ALB health checks (user agent `ELB-HealthChecker/2.0`).

### Step 7: Capture stopped-task events with EventBridge

ECS sends an **ECS Task State Change** event to EventBridge every time a task changes state. This rule keeps only tasks of this cluster that reach `STOPPED` and writes them to a log group (in production you would target an SNS topic that emails the team).

Event pattern (replace `ACCOUNT_ID` in the console version):

```json
{
  "source": ["aws.ecs"],
  "detail-type": ["ECS Task State Change"],
  "detail": {
    "clusterArn": ["arn:aws:ecs:us-east-1:ACCOUNT_ID:cluster/demo-ecs-cluster"],
    "lastStatus": ["STOPPED"]
  }
}
```

:::console
1. Open the **Amazon EventBridge** console, choose **Rules**, then **Create rule**.
2. On the rule builder selection page, choose **Advanced Builder**.
3. Enter the **Name** `demo-ecs-stopped-tasks`. For **Event bus** choose **AWS default event bus**, for **Rule type** choose **Rule with an event pattern**, then choose **Next**.
4. For **Event source**, choose **AWS events or EventBridge partner events**.
5. Under **Creation method**, choose **Custom pattern (JSON editor)**, paste the pattern with your account ID and choose **Next**.
6. For **Target type** choose **AWS service**. For **Select a target** choose **CloudWatch log group** and enter `demo-ecs-stopped-tasks` (the console adds the `/aws/events/` prefix and creates the group and its resource policy).
7. Choose **Next**, **Next** again (no tags), review and choose **Create rule**.
:::

:::cli
```bash
EV_LOG_GROUP=/aws/events/demo-ecs-stopped-tasks
aws logs create-log-group --log-group-name "$EV_LOG_GROUP"
aws logs put-resource-policy --policy-name demo-ecs-events-to-logs --policy-document \
  "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":[\"events.amazonaws.com\",\"delivery.logs.amazonaws.com\"]},\"Action\":[\"logs:CreateLogStream\",\"logs:PutLogEvents\"],\"Resource\":\"arn:aws:logs:$AWS_REGION:$ACCOUNT_ID:log-group:$EV_LOG_GROUP:*\"}]}"

cat > stopped-pattern.json <<EOF
{
  "source": ["aws.ecs"],
  "detail-type": ["ECS Task State Change"],
  "detail": {
    "clusterArn": ["arn:aws:ecs:$AWS_REGION:$ACCOUNT_ID:cluster/$CLUSTER"],
    "lastStatus": ["STOPPED"]
  }
}
EOF
aws events put-rule --name demo-ecs-stopped-tasks --event-pattern file://stopped-pattern.json
aws events put-targets --rule demo-ecs-stopped-tasks \
  --targets "Id=logs,Arn=arn:aws:logs:$AWS_REGION:$ACCOUNT_ID:log-group:$EV_LOG_GROUP"
```
:::

> [!CHECK]
> The rule `demo-ecs-stopped-tasks` is **Enabled** with one CloudWatch log group target. `aws events list-targets-by-rule --rule demo-ecs-stopped-tasks` returns the log group ARN.

### Step 8: Stop a task and watch the service heal itself

:::console
1. Open **Clusters** → `demo-ecs-cluster` → **Tasks** tab. Select one running task, choose **Stop** → **Stop selected**, and confirm with **Stop**.
2. Refresh the **Tasks** tab every 20 seconds or so.
3. After a minute, open **CloudWatch** → **Log groups** → `/aws/events/demo-ecs-stopped-tasks` and expand the newest event.
:::

:::cli
```bash
TASK=$(aws ecs list-tasks --cluster "$CLUSTER" --service-name demo-web-svc \
  --query 'taskArns[0]' --output text)
aws ecs stop-task --cluster "$CLUSTER" --task "$TASK" --reason "Lab: self-healing test" \
  --query 'task.desiredStatus' --output text
sleep 60
aws ecs describe-services --cluster "$CLUSTER" --services demo-web-svc \
  --query 'services[0].[desiredCount,runningCount,pendingCount]' --output text
aws logs tail /aws/events/demo-ecs-stopped-tasks --since 15m | tail -n 3
```
:::

> [!CHECK]
> The stopped task disappears from the running list and a **new task** starts within about a minute, because the service always restores its desired count of 2. The event log group holds an event with `"lastStatus": "STOPPED"` and a stop code such as `UserInitiated` with your stop reason. In production, the same rule with an SNS target is how administrators get an email when tasks crash.

### Step 9: Change the desired count and observe auto scaling

:::console
1. On the **Services** tab, select `demo-web-svc` and choose **Update**.
2. Set **Desired tasks** to `3` and choose **Update**.
3. Open the service's **Configuration and networking** or **Service auto scaling** information and note the minimum (1), maximum (4) and the target tracking policy.
:::

:::cli
```bash
aws ecs update-service --cluster "$CLUSTER" --service demo-web-svc --desired-count 3 \
  --query 'service.desiredCount'
aws application-autoscaling describe-scaling-policies --service-namespace ecs \
  --query 'ScalingPolicies[].[PolicyName,PolicyType]' --output table
aws cloudwatch describe-alarms --alarm-name-prefix TargetTracking-service/$CLUSTER/demo-web-svc \
  --query 'MetricAlarms[].[AlarmName,StateValue]' --output table
```
:::

> [!CHECK]
> A third task starts and registers in the target group. Target tracking created two CloudWatch alarms (one to scale out, one to scale in). Because the test traffic leaves CPU far below 50%, auto scaling eventually lowers the desired count toward the minimum of 1 (target tracking scales in cautiously, so this can take 15 minutes or more). That is the lesson: **Service Auto Scaling changes the task count**, while Fargate supplies capacity for however many tasks you ask for.

## Cleanup

Delete in this order. Before deleting the load balancer, make sure you noted the security group IDs on its **Security** tab.

- [ ] **EventBridge rule `demo-ecs-stopped-tasks`**. Console: **EventBridge** → **Rules** → select it → **Delete** and confirm. CLI: `aws events remove-targets --rule demo-ecs-stopped-tasks --ids logs`, then `aws events delete-rule --name demo-ecs-stopped-tasks`.
- [ ] **Event log group `/aws/events/demo-ecs-stopped-tasks`** and, on the CLI path, its resource policy. Console: **CloudWatch** → **Log groups** → select → **Actions** → **Delete log group(s)**. CLI: `aws logs delete-log-group --log-group-name /aws/events/demo-ecs-stopped-tasks` and `aws logs delete-resource-policy --policy-name demo-ecs-events-to-logs`. If you used the console, run `aws logs describe-resource-policies` and delete the policy the console created only if no other EventBridge rule writes to `/aws/events/` log groups.
- [ ] **Scaling policy and scalable target** for the service. Run this in CloudShell even if you used the console path. CLI: `aws application-autoscaling deregister-scalable-target --service-namespace ecs --scalable-dimension ecs:service:DesiredCount --resource-id service/demo-ecs-cluster/demo-web-svc` (this also removes the policy and its two alarms). Afterwards `aws application-autoscaling describe-scalable-targets --service-namespace ecs` should return no target for `demo-web-svc`.
- [ ] **ECS service `demo-web-svc`**. Console: cluster → **Services** tab → select it → **Delete** → type `delete` (use **Force delete** if offered) and confirm; wait until it is gone. CLI: `aws ecs delete-service --cluster demo-ecs-cluster --service demo-web-svc --force`, then `aws ecs wait services-inactive --cluster demo-ecs-cluster --services demo-web-svc`.
- [ ] **Application Load Balancer `demo-web-alb`** (deleting the service does not delete it). Console: **EC2** → **Load balancers** → select → **Actions** → **Delete load balancer** → confirm. CLI: `aws elbv2 delete-load-balancer --load-balancer-arn "$ALB_ARN"`.
- [ ] **Target group `demo-web-tg`**. Console: **EC2** → **Target groups** → select → **Actions** → **Delete**. CLI: `aws elbv2 delete-target-group --target-group-arn "$TG_ARN"` (retry after a minute if it says the target group is still in use).
- [ ] **Cluster `demo-ecs-cluster`**. Console: **Clusters** → select it → **Delete cluster** → type `delete demo-ecs-cluster` → **Delete**. CLI: `aws ecs delete-cluster --cluster demo-ecs-cluster`. Then check **CloudFormation** → **Stacks** for a stack whose name starts with `Infra-ECS-Cluster-demo-ecs-cluster` and delete it if it remains.
- [ ] **Task definition `demo-web`** (all revisions). Console: **Task definitions** → `demo-web` → select each revision → **Actions** → **Deregister**, then **Delete**. CLI: `aws ecs deregister-task-definition --task-definition demo-web:1`, then `aws ecs delete-task-definitions --task-definitions demo-web:1` (repeat for any other revision).
- [ ] **Log group `/ecs/demo-web`**. Console: **CloudWatch** → **Log groups** → select → **Actions** → **Delete log group(s)**. CLI: `aws logs delete-log-group --log-group-name /ecs/demo-web`.
- [ ] **Security group `demo-ecs-web-sg`** and any other security group the console created for the load balancer (the IDs you noted). Wait a few minutes after the ALB and tasks are gone so their network interfaces are released. Console: **EC2** → **Security Groups** → select → **Actions** → **Delete security groups**. CLI: `aws ec2 delete-security-group --group-id "$SG_ID"`.
- [ ] **IAM**: remove the inline policy `demo-ecs-create-log-group` (CLI: `aws iam delete-role-policy --role-name ecsTaskExecutionRole --policy-name demo-ecs-create-log-group`). If you **created** `ecsTaskExecutionRole` in Step 1, also delete the role: `aws iam detach-role-policy --role-name ecsTaskExecutionRole --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy`, then `aws iam delete-role --role-name ecsTaskExecutionRole`.
- [ ] **ECR repository `demo-web`** from Lab 01. Console: **Amazon ECR** → **Repositories** → select → **Delete** → confirm. CLI: `aws ecr delete-repository --repository-name demo-web --force`.
- [ ] **Local files**: `rm -f ecs-tasks-trust.json taskdef.json stopped-pattern.json`.
- [ ] Final check: `aws ecs list-clusters` and `aws elbv2 describe-load-balancers --names demo-web-alb` show nothing from this lab (the second command returns a "not found" error), **CloudFormation** → **Stacks** lists no stack left over from this lab (delete any whose name contains `demo-ecs-cluster` or `demo-web-svc`), and **Billing and Cost Management** → **Bills** shows no growing ECS, ELB or public IPv4 charges over the next day.

## Progress checklist

- [ ] Step 1: Task execution role ready
- [ ] Step 2: Security group and log group created
- [ ] Step 3: Fargate cluster created
- [ ] Step 4: Task definition registered
- [ ] Step 5: Service running behind the ALB with auto scaling
- [ ] Step 6: Two hostnames seen through the ALB and logs read
- [ ] Step 7: EventBridge rule for stopped tasks created
- [ ] Step 8: Stopped task replaced and event captured
- [ ] Step 9: Desired count changed and scaling policy inspected
- [ ] Cleanup done
