---
id: 35-other-services-lab-01
title: Deploy, change and delete a CloudFormation stack, then try a service role
objective: Create a stack from a template, inspect its resources and diagram, preview and apply an update with a change set, see a least-privilege service role block a resource it is not allowed to create, and delete everything with one action.
estimatedTime: 40 minutes
cost: "Effectively free: an empty S3 bucket, a standard SSM parameter and an unused SNS topic are not billed, and CloudFormation itself costs nothing for AWS resource types. If you upload templates through the console, CloudFormation stores them in an S3 bucket in your account (a few KB, fractions of a cent, covered by Free Tier credits)."
freeTier: "yes"
services: [cloudformation, s3, ssm-parameter-store, sns, iam-roles, infrastructure-composer]
---

This lab shows the CloudFormation lifecycle that the exam assumes you understand: **template → stack → change set → update → delete**, plus the **service role** pattern for least privilege. Every resource is free or nearly free, so you can repeat it as often as you like.

## Prerequisites

- An AWS account and a user or role with permissions for CloudFormation, S3, Systems Manager Parameter Store, SNS and IAM (to create one role in Step 6), for example an administrator in a sandbox account.
- A Region of your choice; the steps use `us-east-1`. Use the same Region for every step.
- For the console tabs: a text editor to save two small YAML files on your computer.
- For the CLI tabs: AWS CLI v2 configured with `aws configure`, or **AWS CloudShell**, which needs no setup. Keep the same terminal open, because later commands reuse shell variables.

## Steps

### Step 1: Write the first template

The template declares an S3 bucket (CloudFormation generates its name) and an SSM parameter that stores the bucket's name. Because the parameter uses `!Ref DemoBucket`, CloudFormation knows it must create the bucket first.

Save this as `lab-v1.yaml`:

```yaml
AWSTemplateFormatVersion: "2010-09-09"
Description: SAA lab - an S3 bucket and an SSM parameter that stores its name
Parameters:
  EnvName:
    Type: String
    Default: dev
    AllowedValues: [dev, test]
    Description: Environment tag applied to the bucket
Resources:
  DemoBucket:
    Type: AWS::S3::Bucket
    Properties:
      Tags:
        - Key: Environment
          Value: !Ref EnvName
  BucketNameParam:
    Type: AWS::SSM::Parameter
    Properties:
      Name: !Sub "/lab/${AWS::StackName}/bucket-name"
      Type: String
      Value: !Ref DemoBucket
Outputs:
  BucketName:
    Description: Name that CloudFormation generated for the bucket
    Value: !Ref DemoBucket
```

:::console
1. Open a text editor, paste the template above and save it as `lab-v1.yaml`.
2. Keep the file handy; you upload it in Step 2 and Step 6.
:::

:::cli
```bash
cat > lab-v1.yaml <<'EOF'
AWSTemplateFormatVersion: "2010-09-09"
Description: SAA lab - an S3 bucket and an SSM parameter that stores its name
Parameters:
  EnvName:
    Type: String
    Default: dev
    AllowedValues: [dev, test]
    Description: Environment tag applied to the bucket
Resources:
  DemoBucket:
    Type: AWS::S3::Bucket
    Properties:
      Tags:
        - Key: Environment
          Value: !Ref EnvName
  BucketNameParam:
    Type: AWS::SSM::Parameter
    Properties:
      Name: !Sub "/lab/${AWS::StackName}/bucket-name"
      Type: String
      Value: !Ref DemoBucket
Outputs:
  BucketName:
    Description: Name that CloudFormation generated for the bucket
    Value: !Ref DemoBucket
EOF

aws cloudformation validate-template --template-body file://lab-v1.yaml
```
:::

> [!CHECK]
> The CLI `validate-template` call returns the `EnvName` parameter and the template description without errors.

### Step 2: Create the stack

:::console
1. Open the **CloudFormation** console and check the Region in the navigation bar.
2. On the **Stacks** page choose **Create stack** → **With new resources (standard)**.
3. Under **Prerequisite - Prepare template** choose **Choose an existing template**. Under **Specify template** choose **Upload a template file**, choose **Choose File**, pick `lab-v1.yaml`, then choose **Next**.
4. On **Specify stack details**, enter **Stack name** `lab-cfn-demo`. Leave **EnvName** as `dev`. Choose **Next**.
5. On **Configure stack options**, leave every setting at its default (note the **Permissions** section: no IAM role means CloudFormation acts with your own permissions). Choose **Next**.
6. On **Review and create**, choose **Submit**.
7. Watch the **Events** tab until the stack status is `CREATE_COMPLETE` (about a minute).
:::

:::cli
```bash
aws cloudformation create-stack --stack-name lab-cfn-demo \
  --template-body file://lab-v1.yaml \
  --parameters ParameterKey=EnvName,ParameterValue=dev

aws cloudformation wait stack-create-complete --stack-name lab-cfn-demo

aws cloudformation describe-stack-events --stack-name lab-cfn-demo \
  --query 'StackEvents[].[LogicalResourceId,ResourceStatus]' --output table
```
:::

> [!CHECK]
> The events, read from the bottom up, show `DemoBucket` reaching `CREATE_COMPLETE` **before** `BucketNameParam` starts. CloudFormation derived that order from the `!Ref`; you never wrote it down.

### Step 3: Inspect what CloudFormation built

:::console
1. On the stack page open the **Resources** tab. Note the **Physical ID** of `DemoBucket` (a generated name such as `lab-cfn-demo-demobucket-...`).
2. Open the **Outputs** tab and confirm `BucketName` shows the same name.
3. Choose the bucket's physical ID link to open it in the S3 console, then open **Properties** and scroll to **Tags**.
4. Open the **Systems Manager** console, choose **Parameter Store** and open `/lab/lab-cfn-demo/bucket-name`. Its value is the bucket name.
5. Back on the stack, open the **Template** tab and choose **Open in template studio** (or choose **Template studio** in the CloudFormation navigation pane and paste the template). Switch the view to **Both** or **Canvas** to see the resource diagram.
:::

:::cli
```bash
BUCKET=$(aws cloudformation describe-stacks --stack-name lab-cfn-demo \
  --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" --output text)
echo "Bucket: $BUCKET"

aws s3api get-bucket-tagging --bucket "$BUCKET"

aws ssm get-parameter --name /lab/lab-cfn-demo/bucket-name \
  --query Parameter.Value --output text
```
:::

> [!CHECK]
> The bucket has your `Environment=dev` tag **and** tags CloudFormation added automatically, such as `aws:cloudformation:stack-name = lab-cfn-demo`. These automatic tags are what let you filter costs by stack. In template studio, the diagram draws a line from the parameter to the bucket because one references the other.

### Step 4: Preview an update with a change set

Version 2 turns on bucket versioning and adds an SNS topic. A change set shows exactly what CloudFormation will do before anything changes.

Save this as `lab-v2.yaml`:

```yaml
AWSTemplateFormatVersion: "2010-09-09"
Description: SAA lab v2 - versioned bucket, SSM parameter and an SNS topic
Parameters:
  EnvName:
    Type: String
    Default: dev
    AllowedValues: [dev, test]
    Description: Environment tag applied to the bucket
Resources:
  DemoBucket:
    Type: AWS::S3::Bucket
    Properties:
      VersioningConfiguration:
        Status: Enabled
      Tags:
        - Key: Environment
          Value: !Ref EnvName
  BucketNameParam:
    Type: AWS::SSM::Parameter
    Properties:
      Name: !Sub "/lab/${AWS::StackName}/bucket-name"
      Type: String
      Value: !Ref DemoBucket
  DemoTopic:
    Type: AWS::SNS::Topic
    Properties:
      TopicName: !Sub "${AWS::StackName}-alerts"
Outputs:
  BucketName:
    Description: Name that CloudFormation generated for the bucket
    Value: !Ref DemoBucket
  TopicArn:
    Description: ARN of the new SNS topic
    Value: !Ref DemoTopic
```

:::console
1. Save the template above as `lab-v2.yaml`.
2. Open the `lab-cfn-demo` stack and choose **Stack actions** → **Create a change set**.
3. Choose **Replace existing template**, then **Upload a template file**, pick `lab-v2.yaml` and choose **Next**.
4. Enter a change set name such as `add-topic-and-versioning`, keep **EnvName** as `dev`, and choose **Next**.
5. Leave **Configure stack options** unchanged and choose **Next**, then **Submit** on the review page.
6. Wait until the change set status is `CREATE_COMPLETE` and read the **Changes** list.
:::

:::cli
```bash
cat > lab-v2.yaml <<'EOF'
AWSTemplateFormatVersion: "2010-09-09"
Description: SAA lab v2 - versioned bucket, SSM parameter and an SNS topic
Parameters:
  EnvName:
    Type: String
    Default: dev
    AllowedValues: [dev, test]
    Description: Environment tag applied to the bucket
Resources:
  DemoBucket:
    Type: AWS::S3::Bucket
    Properties:
      VersioningConfiguration:
        Status: Enabled
      Tags:
        - Key: Environment
          Value: !Ref EnvName
  BucketNameParam:
    Type: AWS::SSM::Parameter
    Properties:
      Name: !Sub "/lab/${AWS::StackName}/bucket-name"
      Type: String
      Value: !Ref DemoBucket
  DemoTopic:
    Type: AWS::SNS::Topic
    Properties:
      TopicName: !Sub "${AWS::StackName}-alerts"
Outputs:
  BucketName:
    Description: Name that CloudFormation generated for the bucket
    Value: !Ref DemoBucket
  TopicArn:
    Description: ARN of the new SNS topic
    Value: !Ref DemoTopic
EOF

aws cloudformation create-change-set --stack-name lab-cfn-demo \
  --change-set-name add-topic-and-versioning \
  --template-body file://lab-v2.yaml \
  --parameters ParameterKey=EnvName,UsePreviousValue=true

aws cloudformation wait change-set-create-complete --stack-name lab-cfn-demo \
  --change-set-name add-topic-and-versioning

aws cloudformation describe-change-set --stack-name lab-cfn-demo \
  --change-set-name add-topic-and-versioning \
  --query 'Changes[].ResourceChange.[Action,LogicalResourceId,Replacement]' --output table
```
:::

> [!CHECK]
> The change set lists two changes: **Add** `DemoTopic`, and **Modify** `DemoBucket` with **Replacement** `False` (versioning can be turned on in place, so the bucket and its name survive). `BucketNameParam` is not listed because nothing about it changes. Nothing has been changed in your account yet.

### Step 5: Execute the change set

:::console
1. On the change set page choose **Execute change set**, keep the default rollback behaviour, and confirm.
2. Wait for the stack status `UPDATE_COMPLETE`.
3. Open the **Outputs** tab: a new `TopicArn` output appears.
4. In the S3 console, open the bucket's **Properties** tab: **Bucket Versioning** now shows **Enabled**.
:::

:::cli
```bash
aws cloudformation execute-change-set --stack-name lab-cfn-demo \
  --change-set-name add-topic-and-versioning

aws cloudformation wait stack-update-complete --stack-name lab-cfn-demo

aws s3api get-bucket-versioning --bucket "$BUCKET"

aws cloudformation describe-stacks --stack-name lab-cfn-demo \
  --query 'Stacks[0].Outputs' --output table
```
:::

> [!CHECK]
> `get-bucket-versioning` returns `"Status": "Enabled"`, the bucket name is unchanged, and the outputs include `TopicArn` ending in `lab-cfn-demo-alerts`.

### Step 6: Deploy through a least-privilege service role

Now pretend you are a developer who may deploy stacks only through a role that can manage S3 and nothing else. You create that role, then deploy the **v1** template (bucket + SSM parameter) as a second stack using the role.

:::console
1. Open the **IAM** console, choose **Roles** → **Create role**.
2. For **Trusted entity type** choose **AWS service**. For **Service or use case** choose **CloudFormation** (and its CloudFormation use case), then choose **Next**. If CloudFormation is not offered in that list, choose **Custom trust policy** as the trusted entity type instead and paste the trust policy shown in the CLI tab.
3. On **Add permissions**, search for and select **AmazonS3FullAccess** only. Choose **Next**.
4. For **Role name** enter `cfn-lab-s3-only-role` and choose **Create role**.
5. In the CloudFormation console choose **Create stack** → **With new resources (standard)**, upload `lab-v1.yaml` again and choose **Next**.
6. Name the stack `lab-cfn-role` and choose **Next**.
7. On **Configure stack options**, under **Permissions**, choose the IAM role `cfn-lab-s3-only-role`. (If your account has the IAM role manager enabled, choose **Customize** there and select the role.) Choose **Next**, then **Submit**.
8. Watch the **Events** tab.
:::

:::cli
```bash
cat > cfn-trust.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "cloudformation.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
EOF

ROLE_ARN=$(aws iam create-role --role-name cfn-lab-s3-only-role \
  --assume-role-policy-document file://cfn-trust.json \
  --query Role.Arn --output text)
aws iam attach-role-policy --role-name cfn-lab-s3-only-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess

# IAM changes can take a few seconds to reach CloudFormation.
sleep 15

aws cloudformation create-stack --stack-name lab-cfn-role \
  --template-body file://lab-v1.yaml --role-arn "$ROLE_ARN"

aws cloudformation wait stack-create-complete --stack-name lab-cfn-role \
  || echo "Stack creation failed - this is the expected result"

aws cloudformation describe-stack-events --stack-name lab-cfn-role \
  --query "StackEvents[?ResourceStatus=='CREATE_FAILED'].[LogicalResourceId,ResourceStatusReason]" \
  --output text
```
:::

> [!CHECK]
> `DemoBucket` is created, but `BucketNameParam` fails with a status reason saying the role is not authorized to perform an `ssm:` action (such as `ssm:PutParameter`). CloudFormation then rolls back, deletes the bucket it had just created, and the stack ends in `ROLLBACK_COMPLETE`. Your own administrator permissions did not help, because a stack with a service role always uses the role's permissions.

Delete the failed stack now (a stack in `ROLLBACK_COMPLETE` cannot be updated, only deleted). The deletion also runs through the role, which is allowed to delete S3 buckets.

:::console
1. Select the `lab-cfn-role` stack and choose **Delete**, then confirm.
2. Wait until the stack disappears from the list (or shows `DELETE_COMPLETE` with the **Deleted** filter).
:::

:::cli
```bash
aws cloudformation delete-stack --stack-name lab-cfn-role
aws cloudformation wait stack-delete-complete --stack-name lab-cfn-role
```
:::

> [!CHECK]
> The stack is gone. If you deleted the IAM role first, this deletion would fail, which is why the role must outlive every stack that uses it.

## Cleanup

Delete in this order:

- [ ] **Stack `lab-cfn-role`** (if it still exists): CloudFormation console → select → **Delete**; CLI `aws cloudformation delete-stack --stack-name lab-cfn-role` then `aws cloudformation wait stack-delete-complete --stack-name lab-cfn-role`.
- [ ] **Stack `lab-cfn-demo`**, which deletes the S3 bucket, the SSM parameter and the SNS topic in one action (the bucket is empty, so deletion succeeds): console → select → **Delete**; CLI `aws cloudformation delete-stack --stack-name lab-cfn-demo` then `aws cloudformation wait stack-delete-complete --stack-name lab-cfn-demo`.
- [ ] **IAM role `cfn-lab-s3-only-role`**: IAM console → **Roles** → select → **Delete**; CLI `aws iam detach-role-policy --role-name cfn-lab-s3-only-role --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess` then `aws iam delete-role --role-name cfn-lab-s3-only-role`.
- [ ] **Uploaded template files** (console path only): in the S3 console open the bucket named `cf-templates-...-<region>` and delete the `lab-v1.yaml` and `lab-v2.yaml` objects. Delete the whole bucket only if it holds nothing else you need.
- [ ] **Local files** (optional): `rm lab-v1.yaml lab-v2.yaml cfn-trust.json`.
- [ ] **Final check**: the CloudFormation **Stacks** list (filter **Active**) shows no `lab-` stacks, `aws ssm get-parameter --name /lab/lab-cfn-demo/bucket-name` returns `ParameterNotFound`, and the IAM **Roles** list has no `cfn-lab-s3-only-role`.

## Progress checklist

- [ ] Step 1: Wrote and validated `lab-v1.yaml`
- [ ] Step 2: Created stack `lab-cfn-demo` and saw the dependency order in Events
- [ ] Step 3: Found the automatic stack tags, the SSM parameter and the template diagram
- [ ] Step 4: Created a change set and read Add / Modify / Replacement
- [ ] Step 5: Executed the change set and confirmed versioning and the topic
- [ ] Step 6: Watched a service role block the SSM parameter and deleted the failed stack
- [ ] Cleanup done
