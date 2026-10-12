---
id: 21-dynamodb-apigw-cognito-lab-03
title: Orchestrate an order workflow with Step Functions and DynamoDB
objective: Build a Standard state machine that validates an order, branches on its amount, writes it straight to a DynamoDB table without any Lambda function, and handles duplicates and bad input with Catch and Fail states.
estimatedTime: 40 minutes
cost: "USD 0.00 if you clean up: about 15 state transitions (Always Free includes 4,000 per month) and a provisioned 1 RCU / 1 WCU table with a few items, inside the DynamoDB Always Free allowance."
freeTier: yes
services: [step-functions, dynamodb, iam, cloudshell]
---

An online shop wants every incoming order checked and recorded: orders up to USD 100 are approved at once, larger ones are stored as waiting for a human review, malformed requests are rejected, and the same order must never be recorded twice. You will build this as a **Standard** workflow whose Task states call DynamoDB `PutItem` directly through the optimized integration, so there is no function code at all. Along the way you will use the Choice, Task, Fail and Succeed states, Retry and Catch rules, and the visual execution history from the lesson.

> [!TIP] Why this lab costs nothing
> Standard workflows are billed per state transition, and the first 4,000 transitions each month are Always Free (they do not expire with the Free Tier period). The table uses provisioned mode with 1 RCU and 1 WCU and auto scaling turned off, which sits inside the DynamoDB Always Free allowance of 25 RCU, 25 WCU and 25 GB per Region. If other provisioned tables in the same Region already use that allowance, 1 WCU plus 1 RCU costs about USD 0.02 per day (USD 0.00065 per WCU-hour and USD 0.00013 per RCU-hour in us-east-1), billed whether or not you use them; delete the table at the end either way.

## Prerequisites

- An AWS account and an IAM identity that can manage Step Functions, DynamoDB and IAM roles (for example an administrator in a sandbox account).
- One Region for the whole lab (Step Functions and DynamoDB are available in every commercial Region).
- For the CLI tabs: **AWS CloudShell** (AWS CLI v2 preinstalled) or a Bash shell with AWS CLI v2 configured. Keep one terminal open, because later commands reuse shell variables. Even console users need CloudShell in Step 2 to save the definition file, or can copy it from this page.

## Steps

### Step 1: Create a provisioned table for the orders

This time the table uses **provisioned** capacity, the mode the lesson recommends for small, steady and predictable traffic.

:::console
1. Open the **DynamoDB** console, choose **Tables**, then **Create table**.
2. For **Table name**, enter `demo-orders`. For **Partition key**, enter `OrderId` (type **String**). Leave **Sort key** empty.
3. For **Table settings**, choose **Customize settings**.
4. Keep **Table class** as **DynamoDB Standard**. Under **Read/write capacity settings**, choose **Provisioned**.
5. For both **Read capacity** and **Write capacity**, set **Auto scaling** to **Off** and enter `1` as the provisioned capacity units. Auto scaling would also create CloudWatch alarms, which this lab does not need.
6. Leave the other settings at their defaults and choose **Create table**.
:::

:::cli
```bash
aws dynamodb create-table --table-name demo-orders \
  --attribute-definitions AttributeName=OrderId,AttributeType=S \
  --key-schema AttributeName=OrderId,KeyType=HASH \
  --provisioned-throughput ReadCapacityUnits=1,WriteCapacityUnits=1
aws dynamodb wait table-exists --table-name demo-orders

aws dynamodb describe-table --table-name demo-orders \
  --query 'Table.{Status:TableStatus,Throughput:ProvisionedThroughput}'
```
:::

> [!CHECK]
> `demo-orders` is **Active**. The CLI shows `ReadCapacityUnits` and `WriteCapacityUnits` of 1, and the **Read/write capacity** section of the **Additional settings** tab shows provisioned mode with auto scaling off.

### Step 2: Write the workflow definition

The definition is written in Amazon States Language with **JSONata** expressions (`{% ... %}`), the query language AWS now recommends for new workflows. Read it before you save it:

- `ValidateInput` (Choice) sends the order on only if it has an `orderId`, a `customer` and a numeric `amount`; anything else goes to the `InvalidOrder` Fail state.
- `CheckAmount` (Choice) routes orders above 100 to `SaveForReview` and the rest to `SaveApproved`.
- Both Task states call `arn:aws:states:::dynamodb:putItem` with a **condition expression** that refuses to overwrite an existing `OrderId`. If DynamoDB rejects the write for that reason, the **Catch** rule moves to the `DuplicateOrder` Fail state. Throttling errors are **retried** three times with exponential backoff instead.

In CloudShell, save the file:

```bash
cat > order-workflow.asl.json <<'EOF'
{
  "Comment": "Lab 03: validate an order, route it by amount and record it in DynamoDB",
  "QueryLanguage": "JSONata",
  "StartAt": "ValidateInput",
  "States": {
    "ValidateInput": {
      "Type": "Choice",
      "Choices": [
        {
          "Condition": "{% $exists($states.input.orderId) and $exists($states.input.customer) and $type($states.input.amount) = 'number' %}",
          "Next": "CheckAmount"
        }
      ],
      "Default": "InvalidOrder"
    },
    "CheckAmount": {
      "Type": "Choice",
      "Choices": [
        {
          "Condition": "{% $states.input.amount > 100 %}",
          "Next": "SaveForReview"
        }
      ],
      "Default": "SaveApproved"
    },
    "SaveApproved": {
      "Type": "Task",
      "Resource": "arn:aws:states:::dynamodb:putItem",
      "Arguments": {
        "TableName": "demo-orders",
        "Item": {
          "OrderId": { "S": "{% $string($states.input.orderId) %}" },
          "Customer": { "S": "{% $string($states.input.customer) %}" },
          "Amount": { "N": "{% $string($states.input.amount) %}" },
          "OrderStatus": { "S": "APPROVED" }
        },
        "ConditionExpression": "attribute_not_exists(OrderId)"
      },
      "Retry": [
        {
          "ErrorEquals": ["DynamoDB.ProvisionedThroughputExceededException"],
          "IntervalSeconds": 2,
          "MaxAttempts": 3,
          "BackoffRate": 2
        }
      ],
      "Catch": [
        {
          "ErrorEquals": ["DynamoDB.ConditionalCheckFailedException"],
          "Next": "DuplicateOrder"
        }
      ],
      "Output": {
        "orderId": "{% $string($states.input.orderId) %}",
        "orderStatus": "APPROVED"
      },
      "Next": "Done"
    },
    "SaveForReview": {
      "Type": "Task",
      "Resource": "arn:aws:states:::dynamodb:putItem",
      "Arguments": {
        "TableName": "demo-orders",
        "Item": {
          "OrderId": { "S": "{% $string($states.input.orderId) %}" },
          "Customer": { "S": "{% $string($states.input.customer) %}" },
          "Amount": { "N": "{% $string($states.input.amount) %}" },
          "OrderStatus": { "S": "PENDING_REVIEW" }
        },
        "ConditionExpression": "attribute_not_exists(OrderId)"
      },
      "Retry": [
        {
          "ErrorEquals": ["DynamoDB.ProvisionedThroughputExceededException"],
          "IntervalSeconds": 2,
          "MaxAttempts": 3,
          "BackoffRate": 2
        }
      ],
      "Catch": [
        {
          "ErrorEquals": ["DynamoDB.ConditionalCheckFailedException"],
          "Next": "DuplicateOrder"
        }
      ],
      "Output": {
        "orderId": "{% $string($states.input.orderId) %}",
        "orderStatus": "PENDING_REVIEW"
      },
      "Next": "Done"
    },
    "InvalidOrder": {
      "Type": "Fail",
      "Error": "InvalidOrder",
      "Cause": "The input needs an orderId, a customer and a numeric amount"
    },
    "DuplicateOrder": {
      "Type": "Fail",
      "Error": "DuplicateOrder",
      "Cause": "An order with this orderId is already recorded"
    },
    "Done": {
      "Type": "Succeed"
    }
  }
}
EOF

aws stepfunctions validate-state-machine-definition \
  --definition file://order-workflow.asl.json --type STANDARD
```

> [!CHECK]
> The validation returns `"result": "OK"` with an empty `diagnostics` list. If it reports `FAIL`, the diagnostic names the state and field to fix (usually a pasting error).

> [!NOTE] Why the error names start with DynamoDB
> With the optimized DynamoDB integration, Step Functions reports DynamoDB exceptions with the prefix `DynamoDB.` (for example `DynamoDB.ConditionalCheckFailedException`). Retry and Catch rules match these names, so error handling lives in the workflow instead of in code.

### Step 3: Create the state machine and its role

Step Functions needs an execution role that allows `dynamodb:PutItem` on the table. The console builds it for you from the definition; with the CLI you create it yourself.

:::console
1. Open the **Step Functions** console, choose **State machines**, then **Create state machine**.
2. Choose **Create from blank**, enter `demo-order-workflow` as the name, and choose **Continue**. Workflow Studio opens in **Design** mode.
3. Switch to **Code** mode, select everything in the code editor, and replace it with the contents of `order-workflow.asl.json` (print it with `cat order-workflow.asl.json` in CloudShell and copy it). The graph on the right redraws with the two Choice states, two Tasks and three end states.
4. Switch to **Config** mode. Check the name and that the type is **Standard** (neither can be changed later).
5. Under **Permissions**, keep the option to create a new role. Review the permissions it will generate: they should allow DynamoDB item actions on the `demo-orders` table only, because the table name is written directly in the definition.
6. Choose **Create**, and confirm if the console asks you to approve the new role.
:::

:::cli
```bash
REGION=${AWS_REGION:-$(aws configure get region)}
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

cat > sfn-trust.json <<'EOF'
{"Version": "2012-10-17",
 "Statement": [{"Effect": "Allow", "Principal": {"Service": "states.amazonaws.com"}, "Action": "sts:AssumeRole"}]}
EOF

cat > sfn-ddb-policy.json <<EOF
{"Version": "2012-10-17",
 "Statement": [{"Effect": "Allow", "Action": "dynamodb:PutItem",
   "Resource": "arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/demo-orders"}]}
EOF

aws iam create-role --role-name demo-order-workflow-role \
  --assume-role-policy-document file://sfn-trust.json
aws iam put-role-policy --role-name demo-order-workflow-role \
  --policy-name demo-orders-put --policy-document file://sfn-ddb-policy.json

# A new role can take a few seconds to become usable; rerun this command if it says the role cannot be assumed
SM_ARN=$(aws stepfunctions create-state-machine --name demo-order-workflow \
  --definition file://order-workflow.asl.json \
  --role-arn arn:aws:iam::${ACCOUNT_ID}:role/demo-order-workflow-role \
  --type STANDARD --query stateMachineArn --output text)
echo "$SM_ARN"
```
:::

> [!CHECK]
> The console shows notifications that the state machine and an IAM role were created, and the state machine page lists **Type: Standard** and the execution role. With the CLI, `SM_ARN` prints an ARN ending in `:stateMachine:demo-order-workflow`. Console users: set it for later commands with `SM_ARN=$(aws stepfunctions list-state-machines --query "stateMachines[?name=='demo-order-workflow'].stateMachineArn" --output text)`.

### Step 4: Run a small and a large order

Each run is an **execution** with its own JSON input. Execution names must be unique per state machine, so let the console or CLI generate them.

:::console
1. On the `demo-order-workflow` page, choose **Start execution**.
2. Leave the generated **Name**, enter this **Input** and choose **Start execution**:
   `{"orderId": "1001", "customer": "ana", "amount": 40}`
3. On the execution details page, watch the **Graph view**: `ValidateInput`, `CheckAmount`, `SaveApproved` and `Done` turn green. Select `SaveApproved` and open its input and output in the details panel.
4. Go back to the state machine and start a second execution with:
   `{"orderId": "1002", "customer": "ben", "amount": 250}`
:::

:::cli
```bash
run_order() {
  # Start one execution, give it a few seconds, then show how it ended
  EXEC_ARN=$(aws stepfunctions start-execution --state-machine-arn "$SM_ARN" \
    --input "$1" --query executionArn --output text)
  sleep 3
  aws stepfunctions describe-execution --execution-arn "$EXEC_ARN" \
    --query '{status:status,output:output,error:error,cause:cause}'
}

run_order '{"orderId": "1001", "customer": "ana", "amount": 40}'
run_order '{"orderId": "1002", "customer": "ben", "amount": 250}'

aws dynamodb scan --table-name demo-orders \
  --query 'Items[].[OrderId.S, Customer.S, Amount.N, OrderStatus.S]' --output table
```
:::

> [!CHECK]
> Both executions show status **Succeeded**. The first output is `{"orderId":"1001","orderStatus":"APPROVED"}` and the second took the other branch and returns `PENDING_REVIEW`. **Explore table items** for `demo-orders` (or the scan) shows the two orders with their status. No Lambda function was involved: the Task states wrote to DynamoDB themselves.

### Step 5: Trigger the error paths

Now send a repeat of order 1001 and an order without an amount.

:::console
1. Start an execution with the first input again: `{"orderId": "1001", "customer": "ana", "amount": 40}`.
2. In the **Graph view**, `SaveApproved` is marked as caught and the run ends in `DuplicateOrder`. Open the **Event view** and expand the `TaskFailed` event to read the DynamoDB error.
3. Start one more execution with `{"orderId": "1003", "customer": "cara"}`.
:::

:::cli
```bash
run_order '{"orderId": "1001", "customer": "ana", "amount": 40}'

# Events of the duplicate run: the failed task, then the Fail state
aws stepfunctions get-execution-history --execution-arn "$EXEC_ARN" \
  --query 'events[].type' --output text

run_order '{"orderId": "1003", "customer": "cara"}'
```
:::

> [!CHECK]
> The repeat of order 1001 ends with status **Failed**, error `DuplicateOrder`, and its history contains a `TaskFailed` event whose error is `DynamoDB.ConditionalCheckFailedException`, followed by `FailStateEntered` and `ExecutionFailed`. The table still holds the original item, unchanged. The order without an amount fails at the first Choice with error `InvalidOrder` and never touches DynamoDB.

### Step 6: Review the execution history and the cost model

:::console
1. Open the state machine and select the **Executions** tab: four executions, two **Succeeded** and two **Failed**, each kept with its full history.
2. Open any execution and switch between **Graph view**, **Table view** and **Event view**. The table view lists every state with its duration, the event view every transition.
:::

:::cli
```bash
aws stepfunctions list-executions --state-machine-arn "$SM_ARN" \
  --query 'executions[].[name, status, startDate]' --output table
```
:::

> [!CHECK]
> Four executions are listed. A successful run here costs about four state transitions (two Choice states, one Task, the Succeed state), so the whole lab used only about 15 of the 4,000 free transitions (each retry would add one more). Standard workflows keep this history for 90 days after each execution closes; an **Express** workflow would not record it at all unless you turn on CloudWatch Logs, which is one reason Standard suits auditable business processes.

> [!TIP] Turning the review branch into real human approval
> In production, `SaveForReview` would be followed by a Task using the **wait for callback** pattern (`.waitForTaskToken`): it sends the task token to a reviewer (for example in an SNS email linking to an API Gateway endpoint), the execution pauses for up to a year at no extra charge, and resumes when the reviewer's click calls `SendTaskSuccess` or `SendTaskFailure` with that token. Only Standard workflows support this pattern.

## Cleanup

Delete the resources in this order.

- [ ] Delete the state machine `demo-order-workflow`; its execution history goes with it (console: **State machines** → choose it → **Actions** → **Delete** → confirm; CLI: `aws stepfunctions delete-state-machine --state-machine-arn "$SM_ARN"`).
- [ ] Delete the execution role. Console-created: in **IAM** → **Roles**, search for `demo-order-workflow`, open the auto-generated role, note the customer managed policies on its **Permissions** tab, choose **Delete** and type the role name to confirm, then delete those noted policies under **Policies**. CLI-created: `aws iam delete-role-policy --role-name demo-order-workflow-role --policy-name demo-orders-put`, then `aws iam delete-role --role-name demo-order-workflow-role`.
- [ ] Delete the DynamoDB table `demo-orders` (console: **Tables** → select it → **Delete** → confirm; CLI: `aws dynamodb delete-table --table-name demo-orders`).
- [ ] Remove the local files: `rm -f order-workflow.asl.json sfn-trust.json sfn-ddb-policy.json`.
- [ ] Final check: `aws stepfunctions list-state-machines` and `aws dynamodb list-tables` no longer show the lab resources in the Region you used, and no IAM role containing `demo-order-workflow` remains.

## Progress checklist

- [ ] Step 1: provisioned table `demo-orders` created with 1 RCU and 1 WCU
- [ ] Step 2: workflow definition saved and validated
- [ ] Step 3: Standard state machine and execution role created
- [ ] Step 4: small order approved and large order stored for review
- [ ] Step 5: duplicate order caught and invalid input rejected
- [ ] Step 6: execution history reviewed and transitions counted
- [ ] Cleanup done
