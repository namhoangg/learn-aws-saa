---
id: 20-lambda-lab-01
title: Watch cold starts, throttling and failure destinations in a Lambda function
objective: Create a Python function, compare cold and warm invocations, then configure asynchronous retries with an SQS on-failure destination and use reserved concurrency to see how synchronous and asynchronous calls behave when a function is throttled.
estimatedTime: 45 minutes
cost: "Free: a few dozen Lambda requests and a few SQS messages, well inside the Always Free allowances (1 million Lambda requests and 400,000 GB-seconds, 1 million SQS requests per month). CloudWatch Logs usage is a few kilobytes."
freeTier: yes
services: [lambda, sqs, cloudwatch-logs, iam-roles]
---

You will build one small function and use it to see, step by step, the behaviours the exam asks about: the Init phase that only cold starts pay for, the automatic retry and destination machinery of asynchronous invocations, and what "throttled" means for a synchronous caller versus an asynchronous event.

> [!NOTE] Cost
> Everything here is covered by Always Free allowances: Lambda (1 million requests and 400,000 GB-seconds per month), SQS (1 million requests per month) and the CloudWatch Logs free tier. Nothing is billed by the hour. Delete the resources at the end anyway.

## Prerequisites

- An AWS account and an IAM user or role allowed to manage Lambda, SQS, IAM roles and CloudWatch Logs (for example the managed policies `AWSLambda_FullAccess`, `AmazonSQSFullAccess` and permission to create IAM roles).
- One Region for the whole lab; the commands use your CLI default Region.
- **AWS CloudShell** in that Region (recommended: AWS CLI v2, Python and `jq` are preinstalled). Steps 5 to 7 need the CLI because the console **Test** button always invokes synchronously. Keep one CloudShell tab open; later commands reuse shell variables.

## Steps

### Step 1: Create the function

The module-level variable `COLD` is set when the execution environment initialises, so the response tells you whether an invocation paid for Init.

:::console
1. Open the **Lambda** console, choose **Functions**, then **Create function**.
2. Select **Author from scratch**.
3. For **Function name**, enter `demo-throttle`.
4. For **Runtime**, choose **Python 3.14**. Leave **Architecture** as **x86_64**.
5. Leave the default execution role (Lambda creates a role with basic permissions to write to CloudWatch Logs) and choose **Create function**.
6. On the **Code** tab, replace the contents of `lambda_function.py` with the code below, then choose **Deploy**.

```python
import time

COLD = True  # set once per execution environment, during Init


def lambda_handler(event, context):
    global COLD
    was_cold = COLD
    COLD = False
    print(f"orderId={event.get('orderId')} cold={was_cold}")
    if event.get("fail"):
        raise RuntimeError(f"Simulated failure for order {event.get('orderId')}")
    time.sleep(event.get("sleep", 0))
    return {
        "orderId": event.get("orderId"),
        "coldStart": was_cold,
        "memoryMB": context.memory_limit_in_mb,
    }
```
:::

:::cli
```bash
mkdir -p ~/demo-throttle && cd ~/demo-throttle
cat > lambda_function.py <<'EOF'
import time

COLD = True  # set once per execution environment, during Init


def lambda_handler(event, context):
    global COLD
    was_cold = COLD
    COLD = False
    print(f"orderId={event.get('orderId')} cold={was_cold}")
    if event.get("fail"):
        raise RuntimeError(f"Simulated failure for order {event.get('orderId')}")
    time.sleep(event.get("sleep", 0))
    return {
        "orderId": event.get("orderId"),
        "coldStart": was_cold,
        "memoryMB": context.memory_limit_in_mb,
    }
EOF
zip function.zip lambda_function.py

cat > trust.json <<'EOF'
{"Version": "2012-10-17",
 "Statement": [{"Effect": "Allow",
                "Principal": {"Service": "lambda.amazonaws.com"},
                "Action": "sts:AssumeRole"}]}
EOF
ROLE_ARN=$(aws iam create-role --role-name demo-throttle-role \
  --assume-role-policy-document file://trust.json \
  --query Role.Arn --output text)
aws iam attach-role-policy --role-name demo-throttle-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
sleep 10   # give IAM a moment to propagate the new role

aws lambda create-function --function-name demo-throttle \
  --runtime python3.14 --architectures x86_64 \
  --handler lambda_function.lambda_handler \
  --role "$ROLE_ARN" --zip-file fileb://function.zip --timeout 10
aws lambda wait function-active-v2 --function-name demo-throttle
```
:::

> [!CHECK]
> The function page shows runtime **Python 3.14**, memory **128 MB** and timeout **3 sec** (console) or **10 sec** (CLI). Under **Configuration** → **Permissions** an execution role is listed.

### Step 2: Compare a cold and a warm invocation

:::console
1. In the **Code** tab, under **TEST EVENTS**, choose **Create test event**.
2. For **Event Name**, enter `order1001`, replace the JSON with `{"orderId": 1001}` and choose **Save**.
3. In **TEST EVENTS**, choose the run icon next to `order1001`. Look at the **OUTPUT** tab: the response and the `REPORT` line.
4. Run the same test event again within a few seconds and compare.
:::

:::cli
```bash
for i in 1 2; do
  aws lambda invoke --function-name demo-throttle \
    --cli-binary-format raw-in-base64-out \
    --payload '{"orderId": 1001}' --log-type Tail \
    --query LogResult --output text out.json | base64 -d | grep REPORT
  cat out.json; echo
done
```
:::

> [!CHECK]
> The first response has `"coldStart": true` and its `REPORT` line ends with an **Init Duration** value. The second response has `"coldStart": false` and no Init Duration, because the same execution environment was reused. Since August 2025 that Init time is billed like any other duration.

### Step 3: Change memory and observe a new environment

Changing configuration makes Lambda create fresh execution environments.

:::console
1. Choose the **Configuration** tab, then **General configuration**, then **Edit**.
2. Set **Memory** to `512` MB and choose **Save**.
3. Back on the **Code** tab, run `order1001` twice again.
:::

:::cli
```bash
aws lambda update-function-configuration --function-name demo-throttle --memory-size 512
aws lambda wait function-updated-v2 --function-name demo-throttle
aws lambda invoke --function-name demo-throttle \
  --cli-binary-format raw-in-base64-out \
  --payload '{"orderId": 1002}' out.json && cat out.json; echo
```
:::

> [!CHECK]
> The first invocation after the change reports `"coldStart": true` and `"memoryMB": 512`. The `REPORT` line now shows **Memory Size: 512 MB**. More memory also means a larger CPU share.

### Step 4: Create an SQS queue for failed events and allow the function to use it

An on-failure destination needs a target and permission for the execution role to send to it.

:::console
1. Open the **Amazon SQS** console and choose **Create queue**.
2. Leave **Type** as **Standard** (FIFO queues are not supported as Lambda destinations), enter the name `demo-throttle-failures` and choose **Create queue**. Copy the queue **ARN**.
3. Back in the Lambda console, open `demo-throttle`, choose **Configuration** → **Permissions** and choose the **Role name** link to open the role in IAM.
4. In **Permissions policies**, choose **Add permissions** → **Create inline policy**.
5. Select **JSON**, paste the policy below (replace the ARN with yours) and choose **Next**.
6. For **Policy name**, enter `send-to-failure-queue` and choose **Create policy**.

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "sqs:SendMessage",
    "Resource": "arn:aws:sqs:REGION:ACCOUNT_ID:demo-throttle-failures"
  }]
}
```
:::

:::cli
```bash
Q_URL=$(aws sqs create-queue --queue-name demo-throttle-failures --query QueueUrl --output text)
Q_ARN=$(aws sqs get-queue-attributes --queue-url "$Q_URL" \
  --attribute-names QueueArn --query Attributes.QueueArn --output text)

cat > send-policy.json <<EOF
{"Version": "2012-10-17",
 "Statement": [{"Effect": "Allow", "Action": "sqs:SendMessage", "Resource": "$Q_ARN"}]}
EOF
aws iam put-role-policy --role-name demo-throttle-role \
  --policy-name send-to-failure-queue --policy-document file://send-policy.json
echo "$Q_ARN"
```
:::

> [!TIP]
> If you created the function in the console, its role has a generated name such as `demo-throttle-role-abc123`. The later CLI commands need `Q_URL` and `Q_ARN` even if you created the queue in the console; set them with:
>
> ```bash
> Q_URL=$(aws sqs get-queue-url --queue-name demo-throttle-failures --query QueueUrl --output text)
> Q_ARN=$(aws sqs get-queue-attributes --queue-url "$Q_URL" --attribute-names QueueArn --query Attributes.QueueArn --output text)
> ```

### Step 5: Configure asynchronous error handling and the on-failure destination

Retries are set to 0 so you do not have to wait the 1 + 2 minutes of default retries.

:::console
1. In the function, choose **Configuration** → **Asynchronous invocation** → **Edit**.
2. Set **Retry attempts** to `0`, leave **Maximum age of event** at its default (6 hours) and choose **Save**.
3. Go to the **Function overview** pane and choose **Add destination**.
4. For **Source**, choose **Asynchronous invocation**. For **Condition**, choose **On failure**.
5. For **Destination type**, choose **SQS queue**, select `demo-throttle-failures` and choose **Save**.
:::

:::cli
```bash
aws lambda put-function-event-invoke-config --function-name demo-throttle \
  --maximum-retry-attempts 0 \
  --destination-config "{\"OnFailure\":{\"Destination\":\"$Q_ARN\"}}"
```
:::

> [!CHECK]
> The **Function overview** diagram shows an SQS destination attached to the function, and **Asynchronous invocation** lists **Retry attempts: 0**. The CLI output contains `"MaximumRetryAttempts": 0` and the queue ARN under `OnFailure`.

### Step 6: Send a failing asynchronous event and read the failure record

There is no console button for asynchronous invocation, so use CloudShell for this step.

:::cli
```bash
aws lambda invoke --function-name demo-throttle \
  --invocation-type Event \
  --cli-binary-format raw-in-base64-out \
  --payload '{"orderId": 2001, "fail": true}' out.json
# Expect {"StatusCode": 202}. Give Lambda a little time, then read the queue:
sleep 30
aws sqs receive-message --queue-url "$Q_URL" --wait-time-seconds 10 \
  --query 'Messages[0].Body' --output text | jq '{condition: .requestContext.condition, attempts: .requestContext.approximateInvokeCount, error: .responsePayload.errorMessage, payload: .requestPayload}'
```
:::

> [!CHECK]
> The invoke call returns **StatusCode 202** immediately, even though the function fails: asynchronous callers do not wait for the result. The queue message shows the condition `RetriesExhausted`, one attempt, the error text `Simulated failure for order 2001` and the original payload. A DLQ would have stored only the payload.

### Step 7: Throttle the function with reserved concurrency 0

:::console
1. Choose **Configuration** → **Concurrency** → **Edit** (under **Concurrency**).
2. Choose **Reserve concurrency**, enter `0` and choose **Save**.
3. On the **Code** tab, run the `order1001` test event.
:::

:::cli
```bash
aws lambda put-function-concurrency --function-name demo-throttle \
  --reserved-concurrent-executions 0

# Synchronous call: expect a TooManyRequestsException (HTTP 429)
aws lambda invoke --function-name demo-throttle \
  --cli-binary-format raw-in-base64-out \
  --payload '{"orderId": 3001}' out.json

# Asynchronous call: accepted with 202, then routed to the failure queue without running
aws lambda invoke --function-name demo-throttle --invocation-type Event \
  --cli-binary-format raw-in-base64-out \
  --payload '{"orderId": 3002}' out.json
sleep 30
# The order 2001 record from Step 6 was read but not deleted, so it is visible again; list every record
aws sqs receive-message --queue-url "$Q_URL" --max-number-of-messages 10 --wait-time-seconds 10 \
  --query 'Messages[].Body' --output json \
  | jq -r '.[]? | fromjson | "order \(.requestPayload.orderId): \(.requestContext.condition)"'
```
:::

> [!CHECK]
> The console test and the synchronous CLI call fail with a throttling error (`TooManyRequestsException`, HTTP 429); the caller would have to retry. The asynchronous call is still accepted with **202**, and a record for **order 3002** appears in the queue (next to the old 2001 record; run the receive command again if 3002 is not listed yet). With reserved concurrency 0, Lambda sends new async events straight to the on-failure destination, without retries and without running the function, so no new log lines appear for order 3002.

> [!NOTE]
> New accounts can have a reduced concurrency quota. You can check yours with `aws lambda get-account-settings` (look at `ConcurrentExecutions`). A value of 0 is used here because it takes nothing from the shared pool.

### Step 8: Remove the throttle and confirm the function works again

:::console
1. Choose **Configuration** → **Concurrency** → **Edit**.
2. Choose **Use unreserved account concurrency** and choose **Save**.
3. Run `order1001` once more.
:::

:::cli
```bash
aws lambda delete-function-concurrency --function-name demo-throttle
aws lambda invoke --function-name demo-throttle \
  --cli-binary-format raw-in-base64-out \
  --payload '{"orderId": 4001}' out.json && cat out.json; echo
```
:::

> [!CHECK]
> The invocation succeeds again with HTTP 200 and a normal response. Reserved concurrency is free, but remember it both guarantees and caps; it never pre-warms environments.

## Cleanup

Delete in this order (the role last, so Lambda can clean up behind it).

- [ ] **Lambda function** `demo-throttle`: console **Functions** → select it → **Actions** → **Delete**, type `confirm`, choose **Delete**. CLI: `aws lambda delete-function --function-name demo-throttle`
- [ ] **SQS queue** `demo-throttle-failures`: SQS console → **Queues** → select the queue → **Delete** → in the **Delete queue** dialog enter `delete` → **Delete**. CLI: `aws sqs delete-queue --queue-url "$Q_URL"`
- [ ] **CloudWatch log group** `/aws/lambda/demo-throttle`: CloudWatch console → **Log groups** → select it → **Actions** → **Delete log group(s)** → **Delete**. CLI: `aws logs delete-log-group --log-group-name /aws/lambda/demo-throttle`
- [ ] **IAM role** (`demo-throttle-role` or the console-generated `demo-throttle-role-xxxx`) with its inline policy `send-to-failure-queue`: IAM console → **Roles** → select it → **Delete**, enter the role name, choose **Delete**. If the role was created by the Lambda console, first open its **Permissions** tab and note any **Customer managed** policy attached to it; deleting the role leaves that policy behind, so delete it afterwards under **Policies**. CLI (for the CLI-created role):

```bash
aws iam delete-role-policy --role-name demo-throttle-role --policy-name send-to-failure-queue
aws iam detach-role-policy --role-name demo-throttle-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
aws iam delete-role --role-name demo-throttle-role
```

- [ ] **Local files** in CloudShell: `rm -rf ~/demo-throttle`
- [ ] Final check: the Lambda **Functions** list and the SQS **Queues** list no longer show the demo resources in the Region you used.

## Progress checklist

- [ ] Step 1: function created and code deployed
- [ ] Step 2: cold versus warm invocation compared (Init Duration seen only once)
- [ ] Step 3: memory raised to 512 MB and a new cold start observed
- [ ] Step 4: SQS failure queue created and the role allowed to send to it
- [ ] Step 5: retries set to 0 and on-failure destination configured
- [ ] Step 6: failure record with error details read from the queue
- [ ] Step 7: synchronous 429 and asynchronous routing to the destination observed
- [ ] Step 8: throttle removed and function working again
- [ ] Cleanup completed
