---
id: 11-classic-architectures-lab-01
title: Deploy, update and scale a web app with AWS Elastic Beanstalk
objective: Create an Elastic Beanstalk application with a single-instance environment, look at the resources Beanstalk builds for you, deploy a new application version, then turn the environment into a load-balanced, multi-AZ setup and watch it heal itself.
estimatedTime: 60 minutes
cost: "About USD 0.02 per hour while single-instance (one t3.micro plus its Elastic IP) and about USD 0.07 to 0.09 per hour once load balanced (ALB, two t3.micro instances, one public IPv4 address per instance and per AZ the ALB uses) in us-east-1; roughly USD 0.10 to 0.15 if you clean up within 90 minutes. Free Tier credits can cover most of it."
freeTier: partial
services: [elastic-beanstalk, ec2, alb, asg, elastic-ip, s3, cloudformation, iam]
---

> [!COST]
> Elastic Beanstalk itself is free, but it creates billable resources in your account. While the environment is **single instance** you pay for one `t3.micro` (about USD 0.0104 per hour in us-east-1) and its Elastic IP (USD 0.005 per hour, like every public IPv4 address). After Step 6 you also pay for an Application Load Balancer (USD 0.0225 per hour plus a negligible LCU charge), a second instance and the extra public IPv4 addresses (the ALB has one in every AZ it is placed in, on top of one per instance), about USD 0.07 to 0.09 per hour in total. A small S3 bucket holds your application versions (fractions of a cent). New accounts on the Free plan can cover this with credits; legacy Free Tier accounts (created before 15 July 2025, within their first 12 months) get 750 hours a month each of `t2.micro` or `t3.micro` (depending on the Region), of Classic or Application Load Balancer (with 15 LCUs), and of public IPv4 address use on EC2, so for them mostly the load balancer's own public IPv4 addresses are billed; note that two instances use those hours twice as fast. Do the **Cleanup** section as soon as you finish.

This lab follows the architecture of the lesson: you start with the "single instance, great for development" mode, then switch the same environment to the "high availability with a load balancer" mode. The sample application and the second version are small PHP apps published by AWS in the Elastic Beanstalk documentation.

## Prerequisites

- An AWS account with permissions for Elastic Beanstalk, EC2, Elastic Load Balancing, Auto Scaling, CloudFormation, S3 and IAM role creation (for example the `AdministratorAccess-AWSElasticBeanstalk` managed policy plus permission to create IAM roles, or an administrator user).
- A Region with a **default VPC** that has subnets in at least two Availability Zones (every Region has one unless it was deleted). The steps use `us-east-1`.
- For the CLI tabs: AWS CLI v2 configured (or AWS CloudShell, which needs no setup) and a Bash shell. Keep one terminal open for the whole lab because later commands reuse shell variables.
- A web browser.

## Steps

### Step 1: Create the two IAM roles Elastic Beanstalk needs

Beanstalk uses a **service role** (it assumes it to monitor and update your environment) and an **EC2 instance profile** (your instances use it to upload logs and read application versions). The console no longer creates the instance profile for you, so you create both once per account. If they already exist, skip to Step 2.

:::console
1. You will create the roles from inside the environment wizard in Step 2, on the **Configure service access** page. Read the sub-steps there; nothing to do here yet.
2. If the wizard shows a **Customize** option instead of a **Service role** list, your account has role manager enabled and Beanstalk attaches a service role for you; you still need the **EC2 instance profile**.
:::

:::cli
```bash
# Service role trusted by Elastic Beanstalk
cat > eb-service-trust.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "elasticbeanstalk.amazonaws.com" },
    "Action": "sts:AssumeRole",
    "Condition": { "StringEquals": { "sts:ExternalId": "elasticbeanstalk" } }
  }]
}
EOF
aws iam create-role --role-name aws-elasticbeanstalk-service-role \
  --assume-role-policy-document file://eb-service-trust.json
aws iam attach-role-policy --role-name aws-elasticbeanstalk-service-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSElasticBeanstalkEnhancedHealth
aws iam attach-role-policy --role-name aws-elasticbeanstalk-service-role \
  --policy-arn arn:aws:iam::aws:policy/AWSElasticBeanstalkManagedUpdatesCustomerRolePolicy

# Instance role trusted by EC2, wrapped in an instance profile of the same name
cat > eb-ec2-trust.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "ec2.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
EOF
aws iam create-role --role-name aws-elasticbeanstalk-ec2-role \
  --assume-role-policy-document file://eb-ec2-trust.json
for P in AWSElasticBeanstalkWebTier AWSElasticBeanstalkWorkerTier AWSElasticBeanstalkMulticontainerDocker; do
  aws iam attach-role-policy --role-name aws-elasticbeanstalk-ec2-role \
    --policy-arn arn:aws:iam::aws:policy/$P
done
aws iam create-instance-profile --instance-profile-name aws-elasticbeanstalk-ec2-role
aws iam add-role-to-instance-profile --instance-profile-name aws-elasticbeanstalk-ec2-role \
  --role-name aws-elasticbeanstalk-ec2-role
```
:::

> [!CHECK]
> CLI path: `aws iam get-instance-profile --instance-profile-name aws-elasticbeanstalk-ec2-role --query 'InstanceProfile.Roles[0].RoleName'` prints `aws-elasticbeanstalk-ec2-role`. If `create-role` says the role already exists, that is fine: an earlier Beanstalk environment created it.

### Step 2: Create the application and a single-instance environment

:::console
1. Open the **Elastic Beanstalk** console and choose **Create application**.
2. For **Environment tier**, keep **Web server environment**.
3. For **Application name**, enter `getting-started-app`.
4. Under **Environment information**, set **Environment name** to `gs-app-web-env`. Leave **Domain** empty to get a generated name.
5. For **Platform**, choose **PHP** and keep the recommended platform branch and version (Amazon Linux 2023).
6. For **Application code**, keep **Sample application**. For **Presets**, keep **Single instance**. Choose **Next**.
7. On **Configure service access**, for **Service role** select `aws-elasticbeanstalk-service-role` if it exists. Otherwise choose **Create role**, pick **Trusted entity type** **AWS service** and **Use case** **Elastic Beanstalk – Environment**, choose **Next**, confirm the policies `AWSElasticBeanstalkEnhancedHealth` and `AWSElasticBeanstalkManagedUpdatesCustomerRolePolicy`, choose **Next** and **Create role**, then return to the wizard tab, refresh the list and select it.
8. For **EC2 instance profile**, select `aws-elasticbeanstalk-ec2-role` if it exists. Otherwise choose **Create role**, pick **AWS service** and **Elastic Beanstalk – Compute**, choose **Next**, confirm `AWSElasticBeanstalkWebTier`, `AWSElasticBeanstalkWorkerTier` and `AWSElasticBeanstalkMulticontainerDocker`, name it `aws-elasticbeanstalk-ec2-role`, choose **Create role**, then refresh and select it.
9. Leave **EC2 key pair** empty. Choose **Skip to review**.
10. On the **Review** page, check that **Environment type** shows a single instance, then choose **Submit**.
:::

:::cli
```bash
aws elasticbeanstalk create-application --application-name getting-started-app

# Latest PHP 8.4 platform on Amazon Linux 2023
STACK=$(aws elasticbeanstalk list-available-solution-stacks \
  --query "SolutionStacks[?contains(@, 'Amazon Linux 2023') && contains(@, 'running PHP 8.4')] | [0]" \
  --output text)
echo "$STACK"

# No --version-label: Beanstalk deploys the platform's sample application.
# LoadBalancerType is set now so that Step 6 creates an ALB (AWS pages disagree on the API default; see the note below).
aws elasticbeanstalk create-environment \
  --application-name getting-started-app \
  --environment-name gs-app-web-env \
  --solution-stack-name "$STACK" \
  --option-settings \
    Namespace=aws:elasticbeanstalk:environment,OptionName=EnvironmentType,Value=SingleInstance \
    Namespace=aws:elasticbeanstalk:environment,OptionName=ServiceRole,Value=aws-elasticbeanstalk-service-role \
    Namespace=aws:elasticbeanstalk:environment,OptionName=LoadBalancerType,Value=application \
    Namespace=aws:autoscaling:launchconfiguration,OptionName=IamInstanceProfile,Value=aws-elasticbeanstalk-ec2-role \
    Namespace=aws:ec2:instances,OptionName=InstanceTypes,Value=t3.micro

aws elasticbeanstalk wait environment-exists --environment-names gs-app-web-env
aws elasticbeanstalk describe-environments --environment-names gs-app-web-env \
  --query 'Environments[0].[Status,Health,CNAME,VersionLabel]' --output table
```
:::

> [!VERIFY] LoadBalancerType on a single-instance environment (CLI path)
> Checked on 2026-10-04: no AWS page says whether `create-environment` accepts `LoadBalancerType` for a single-instance environment, or which load balancer type a later switch to load balanced creates when it is not set. What the pages do say: the [EC2 security group CLI examples](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/using-features.managing.ec2.aws-cli.html) leave the option out of their single-instance examples (that environment has no load balancer) and say `create-environment` uses an ALB by default; the [general options reference](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/command-options-general.html) lists `classic` as the default of `LoadBalancerType`; the [load balancer page](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/using-features.managing.elb.html) says the type can be chosen only at creation and that the console and EB CLI default to an ALB. So keep the line: it is the only way the CLI path can ask for an ALB up front. If `create-environment` rejects it, remove it and add `Namespace=aws:elasticbeanstalk:environment,OptionName=LoadBalancerType,Value=application` to the Step 6 `update-environment` command instead. Either way, check the result after Step 6 (see the CLI check there).

> [!CHECK]
> After about five minutes the environment **Health** turns **Ok** (green). Choose **Go to environment** (or open the **Domain** URL, which looks like `http://gs-app-web-env.eba-xxxxxxxx.us-east-1.elasticbeanstalk.com` when you leave the domain prefix empty): you see the PHP sample's congratulations page over plain HTTP. The **Events** tab lists each resource as it was created.

### Step 3: Look at what Beanstalk built for you

The point of Beanstalk is that the familiar building blocks are created for you, as normal resources in your account.

:::console
1. In the environment's **Events** tab, scroll to the oldest events and note the resources mentioned (S3 storage bucket, security group, Elastic IP, launch template, Auto Scaling group). There is no load balancer and no scaling alarm, because a single-instance group never scales.
2. Open the **EC2** console: under **Instances** you see one running `t3.micro` named `gs-app-web-env`; under **Elastic IPs** one address associated with it; under **Auto Scaling groups** a group whose **Desired**, **Min** and **Max** are all `1`.
3. Open the **CloudFormation** console: a stack named `awseb-e-xxxxxxxxxx-stack` describes all of these resources.
4. Open the **S3** console: a bucket named `elasticbeanstalk-us-east-1-<account-id>` stores application versions and logs.
5. Back in Beanstalk, open **Configuration**: the **Instance traffic and scaling** category shows the single-instance environment type.
:::

:::cli
```bash
aws elasticbeanstalk describe-environment-resources --environment-name gs-app-web-env \
  --query 'EnvironmentResources.{Instances:Instances[].Id,ASG:AutoScalingGroups[].Name,LB:LoadBalancers[].Name}'
ASG_NAME=$(aws elasticbeanstalk describe-environment-resources --environment-name gs-app-web-env \
  --query 'EnvironmentResources.AutoScalingGroups[0].Name' --output text)
aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names "$ASG_NAME" \
  --query 'AutoScalingGroups[0].[MinSize,DesiredCapacity,MaxSize]' --output text
aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
  --query "StackSummaries[?starts_with(StackName,'awseb-')].StackName" --output text
BUCKET=$(aws elasticbeanstalk create-storage-location --query S3Bucket --output text)
echo "$BUCKET"
```
:::

> [!CHECK]
> The Auto Scaling group reports `1 1 1`, there is no load balancer, and `create-storage-location` simply returns the existing `elasticbeanstalk-us-east-1-<account-id>` bucket. This is the slides' "single instance" mode: one EC2 instance reached through an Elastic IP.

### Step 4: Deploy a new application version

You now release "v2" of the app, which creates a new **application version** and deploys it to the environment.

:::console
1. Download `php-v2.zip` (about 3 KB) from the Elastic Beanstalk getting-started tutorial: `https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/samples/php-v2.zip`.
2. In the Beanstalk console, open `gs-app-web-env` and choose **Upload and deploy**.
3. Choose **Choose file**, select `php-v2.zip`, keep the generated **Version label** and choose **Deploy**.
4. Wait for the health to return to **Ok**, then refresh the application URL.
5. In the navigation pane, under `getting-started-app`, choose **Application versions** to see both versions.
:::

:::cli
```bash
curl -sO https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/samples/php-v2.zip
aws s3 cp php-v2.zip "s3://$BUCKET/getting-started-app/php-v2.zip"
aws elasticbeanstalk create-application-version --application-name getting-started-app \
  --version-label v2 --source-bundle S3Bucket="$BUCKET",S3Key=getting-started-app/php-v2.zip
aws elasticbeanstalk update-environment --environment-name gs-app-web-env --version-label v2
aws elasticbeanstalk wait environment-updated --environment-names gs-app-web-env
CNAME=$(aws elasticbeanstalk describe-environments --environment-names gs-app-web-env \
  --query 'Environments[0].CNAME' --output text)
curl -s "http://$CNAME" | grep -i -m1 "v2"
aws elasticbeanstalk describe-application-versions --application-name getting-started-app \
  --query 'ApplicationVersions[].VersionLabel' --output text
```
:::

> [!CHECK]
> The page now shows the updated "v2" message and the overview lists the new **Running version**. Because this is a single instance, the deployment briefly took the only server out of service; in production you would use a load-balanced environment and a policy such as rolling or immutable.

### Step 5: Read the logs

:::console
1. In the environment, choose **Logs** → **Request logs** → **Last 100 lines**.
2. When the entry appears, choose **Download** and look for the nginx access log entries created by your browser visits.
:::

:::cli
```bash
aws elasticbeanstalk request-environment-info --environment-name gs-app-web-env --info-type tail
sleep 20
aws elasticbeanstalk retrieve-environment-info --environment-name gs-app-web-env --info-type tail \
  --query 'EnvironmentInfo[0].Message' --output text
```
:::

> [!CHECK]
> You receive a presigned S3 link to one text file per instance (Beanstalk deletes it after 15 minutes) with the last 100 lines of the nginx and Beanstalk engine logs, including the `GET /` requests from your tests. **Full logs** would instead give a ZIP bundle of complete log files.

### Step 6: Switch to a load-balanced, multi-AZ environment

This is the slides' "high availability with a load balancer" mode, obtained by changing configuration rather than rebuilding.

:::console
1. In the environment, choose **Configuration**.
2. In the **Instance traffic and scaling** category, choose **Edit**.
3. Under **Capacity** → **Auto Scaling group**, change **Environment type** to **Load balanced**.
4. Set **Instances** **Min** to `2` and **Max** to `4`. Keep the other defaults.
5. Choose **Apply** at the bottom of the page. If warned that instances will be replaced, choose **Confirm**.
:::

:::cli
```bash
aws elasticbeanstalk update-environment --environment-name gs-app-web-env \
  --option-settings \
    Namespace=aws:elasticbeanstalk:environment,OptionName=EnvironmentType,Value=LoadBalanced \
    Namespace=aws:autoscaling:asg,OptionName=MinSize,Value=2 \
    Namespace=aws:autoscaling:asg,OptionName=MaxSize,Value=4
aws elasticbeanstalk wait environment-updated --environment-names gs-app-web-env
aws elasticbeanstalk describe-environment-resources --environment-name gs-app-web-env \
  --query 'EnvironmentResources.{Instances:Instances[].Id,LB:LoadBalancers[].Name}'
aws ec2 describe-instances --filters "Name=tag:elasticbeanstalk:environment-name,Values=gs-app-web-env" \
  "Name=instance-state-name,Values=running" \
  --query 'Reservations[].Instances[].[InstanceId,Placement.AvailabilityZone]' --output table
```
:::

> [!CHECK]
> After several minutes the event **Successfully deployed new configuration to environment** appears. The **Health** page lists two instances, the EC2 console shows them in **different AZs**, and **Load Balancers** shows a new Application Load Balancer named `awseb-...`. The environment URL is unchanged: its CNAME now points at the load balancer instead of the instance's Elastic IP. CLI path: `aws elbv2 describe-load-balancers --query "LoadBalancers[?starts_with(LoadBalancerName,'awseb')].[LoadBalancerName,Type]" --output table` should list it with type `application`. If that list is empty but `aws elb describe-load-balancers` shows an `awseb-` load balancer, Beanstalk created a Classic Load Balancer instead; the rest of the lab still works, and it costs about the same per hour.

### Step 7: Watch the environment heal itself

:::console
1. In the EC2 console, select one of the two `gs-app-web-env` instances and choose **Instance state** → **Terminate (delete) instance** → **Terminate (delete)**.
2. Keep refreshing the application URL while you watch the Beanstalk **Health** page and the Auto Scaling group's **Activity** tab.
:::

:::cli
```bash
VICTIM=$(aws ec2 describe-instances --filters "Name=tag:elasticbeanstalk:environment-name,Values=gs-app-web-env" \
  "Name=instance-state-name,Values=running" --query 'Reservations[0].Instances[0].InstanceId' --output text)
aws ec2 terminate-instances --instance-ids "$VICTIM"
for i in $(seq 1 10); do curl -s -o /dev/null -w "%{http_code}\n" "http://$CNAME"; sleep 5; done
ASG_NAME=$(aws elasticbeanstalk describe-environment-resources --environment-name gs-app-web-env \
  --query 'EnvironmentResources.AutoScalingGroups[0].Name' --output text)
aws autoscaling describe-scaling-activities --auto-scaling-group-name "$ASG_NAME" \
  --max-items 3 --query 'Activities[].Description' --output text
```
:::

> [!CHECK]
> The site keeps answering `200` because the load balancer routes to the remaining healthy instance. Health may go to **Warning** or **Degraded** briefly; within a few minutes the Auto Scaling group launches a replacement ("Launching a new EC2 instance") to restore the minimum of 2, and health returns to **Ok**.

## Cleanup

Delete in this order. Terminating the environment removes everything Beanstalk created for it (instances, load balancer, Auto Scaling group, security groups, Elastic IP, alarms and the CloudFormation stack).

- [ ] **Environment `gs-app-web-env`**: open it, choose **Actions** → **Terminate environment**, type the environment name and choose **Terminate**. CLI: `aws elasticbeanstalk terminate-environment --environment-name gs-app-web-env` then `aws elasticbeanstalk wait environment-terminated --environment-names gs-app-web-env`.
- [ ] **Application versions and their source bundles** (a version that is still deployed cannot be deleted, so do this after the environment is terminated): **Applications** → `getting-started-app` → **Application versions**, select all, **Actions** → **Delete**, turn on **Delete versions from Amazon S3**, choose **Delete**. CLI: `aws elasticbeanstalk delete-application-version --application-name getting-started-app --version-label v2 --delete-source-bundle`.
- [ ] **Application `getting-started-app`**: **Applications** → select it → **Actions** → **Delete application**, type the name, choose **Delete**. CLI: `aws elasticbeanstalk delete-application --application-name getting-started-app --terminate-env-by-force`.
- [ ] **Uploaded source bundle** (CLI path): `aws s3 rm "s3://$BUCKET/getting-started-app/php-v2.zip"` if it is still there.
- [ ] **S3 bucket `elasticbeanstalk-us-east-1-<account-id>`** (only if you have no other Beanstalk applications in this Region): in the S3 console open the bucket, **Permissions** → **Bucket policy** → **Delete**, empty the bucket, then **Delete bucket**. CLI: `aws s3api delete-bucket-policy --bucket "$BUCKET"`, `aws s3 rm "s3://$BUCKET" --recursive`, `aws s3api delete-bucket --bucket "$BUCKET"`. AWS recommends deleting only the objects you no longer need if other environments use the bucket.
- [ ] **IAM roles** (optional, only if you created them for this lab and do not plan to use Beanstalk again; they cost nothing): CLI: `aws iam remove-role-from-instance-profile --instance-profile-name aws-elasticbeanstalk-ec2-role --role-name aws-elasticbeanstalk-ec2-role`, `aws iam delete-instance-profile --instance-profile-name aws-elasticbeanstalk-ec2-role`, detach the three policies with `aws iam detach-role-policy`, then `aws iam delete-role --role-name aws-elasticbeanstalk-ec2-role`; detach the two policies from `aws-elasticbeanstalk-service-role` and delete it the same way. In the console: **IAM** → **Roles** → select the role → **Delete**.
- [ ] **Local files** (CLI path): `rm eb-service-trust.json eb-ec2-trust.json php-v2.zip`.
- [ ] **Final check**: the Beanstalk console shows no environments, the EC2 console shows no `gs-app-web-env` instances, no `awseb-` load balancers and no unassociated Elastic IPs in us-east-1; the next day **Billing and Cost Management** → **Bills** shows no new Elastic Load Balancing or EC2 charges.

## Progress checklist

- [ ] Step 1: Service role and EC2 instance profile exist
- [ ] Step 2: Single-instance environment is Ok and shows the sample page
- [ ] Step 3: Found the instance, Elastic IP, Auto Scaling group (1/1/1), CloudFormation stack and S3 bucket
- [ ] Step 4: Deployed v2 and saw two application versions
- [ ] Step 5: Retrieved the last 100 log lines
- [ ] Step 6: Environment is load balanced with two instances in different AZs
- [ ] Step 7: Terminated an instance and saw it replaced without downtime
- [ ] Cleanup done
