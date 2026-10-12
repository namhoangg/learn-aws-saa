---
id: 34-more-architectures-lab-01
title: Find where failed messages land when Lambda reads from SQS, SQS FIFO and SNS
objective: Wire one Lambda function to a standard SQS queue, an SQS FIFO queue and an SNS topic, send messages that fail on purpose, and observe who retries, which dead-letter queue catches each failure, and how a failing FIFO message blocks its message group.
estimatedTime: 45 minutes
cost: "Free: a few dozen Lambda invocations, SQS requests and SNS publishes, all inside the Always Free allowances (1 million Lambda requests and 400,000 GB-seconds, 1 million SQS requests and 1 million SNS publishes per month). CloudWatch Logs usage is a few kilobytes."
freeTier: yes
services: [lambda, sqs, sns, cloudwatch-logs, iam-roles, cloudshell]
---

The lesson's first table says the three Lambda patterns differ in *who holds a failed message while it is retried* and *where the dead-letter queue lives*. In this lab you prove it with one function that throws an error whenever a message contains the word `fail`:

- a **standard queue** with a redrive policy: SQS keeps the message and moves it to the queue's DLQ;
- a **FIFO queue**: the failing message holds up the rest of its message group until it reaches the FIFO DLQ;
- an **SNS topic**: Lambda retries asynchronously and sends the event to the **function's** DLQ.

You also see that the function's DLQ stays empty for SQS failures, which is the most common exam trap in this area.

## Prerequisites

- An AWS account and an IAM identity that can manage Lambda, SQS, SNS, IAM roles and CloudWatch Logs (an administrator role in a personal sandbox account is simplest).
- One Region for the whole lab; the steps use `us-east-1`, any Region works.
- **AWS CloudShell** in that Region for the CLI tabs (AWS CLI v2, `jq` and `zip` are preinstalled). Keep one CloudShell tab open: later commands reuse shell variables. Even if you follow the console tabs, CloudShell is the quickest way to read the logs.

## Steps

### Step 1: Create the queues

You need five queues: a standard queue and a FIFO queue for orders, a dead-letter queue (DLQ) for each of them, and a separate standard queue that will become the **Lambda function's** DLQ. A DLQ must be the same type as its source queue, so the FIFO queue gets a FIFO DLQ.

`maxReceiveCount` is set to **2** so the lab moves quickly. In production AWS suggests at least 5 for queues read by Lambda. The default 30-second visibility timeout is exactly six times the 5-second function timeout you set in Step 2, which follows the Lambda guidance.

:::console
1. Open the **Amazon SQS** console and choose **Create queue**. Leave **Type** as **Standard**, enter the **Name** `lab-orders-dlq`, set **Message retention period** to `14` **Days** and choose **Create queue**.
2. Choose **Create queue** again. Choose **Type** **FIFO**, enter `lab-orders-dlq.fifo`, set **Message retention period** to `14` **Days** and choose **Create queue**.
3. Create a third queue: **Standard**, named `lab-fn-dlq`, all defaults.
4. Create the main standard queue: **Standard**, named `lab-orders`. Under **Configuration** keep **Visibility timeout** at `30` **Seconds**. Expand **Dead-letter queue**, turn on **Enabled**, choose the ARN of `lab-orders-dlq` and set **Maximum receives** to `2`. Choose **Create queue**.
5. Create the main FIFO queue: **Type** **FIFO**, named `lab-orders.fifo`. Keep **Visibility timeout** at `30` seconds and turn on **Content-based deduplication** (so you do not need to type deduplication IDs). Under **Dead-letter queue**, turn on **Enabled**, choose `lab-orders-dlq.fifo` and set **Maximum receives** to `2`. Choose **Create queue**.
:::

:::cli
```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
qurl() { aws sqs get-queue-url --queue-name "$1" --query QueueUrl --output text; }
qarn() { aws sqs get-queue-attributes --queue-url "$1" --attribute-names QueueArn \
           --query Attributes.QueueArn --output text; }

# Dead-letter queues first, because the redrive policies must point at existing queues.
aws sqs create-queue --queue-name lab-orders-dlq --attributes MessageRetentionPeriod=1209600
aws sqs create-queue --queue-name lab-orders-dlq.fifo \
  --attributes FifoQueue=true,MessageRetentionPeriod=1209600
aws sqs create-queue --queue-name lab-fn-dlq

DLQ_URL=$(qurl lab-orders-dlq);       DLQ_ARN=$(qarn "$DLQ_URL")
FDLQ_URL=$(qurl lab-orders-dlq.fifo); FDLQ_ARN=$(qarn "$FDLQ_URL")
FN_DLQ_URL=$(qurl lab-fn-dlq);        FN_DLQ_ARN=$(qarn "$FN_DLQ_URL")

# Main queues with redrive policies (the policy itself is a JSON string, so build it with jq).
jq -n --arg dlq "$DLQ_ARN" '{VisibilityTimeout: "30",
  RedrivePolicy: ({deadLetterTargetArn: $dlq, maxReceiveCount: "2"} | tojson)}' > std-attrs.json
Q_URL=$(aws sqs create-queue --queue-name lab-orders \
  --attributes file://std-attrs.json --query QueueUrl --output text)

jq -n --arg dlq "$FDLQ_ARN" '{FifoQueue: "true", ContentBasedDeduplication: "true",
  VisibilityTimeout: "30",
  RedrivePolicy: ({deadLetterTargetArn: $dlq, maxReceiveCount: "2"} | tojson)}' > fifo-attrs.json
FQ_URL=$(aws sqs create-queue --queue-name lab-orders.fifo \
  --attributes file://fifo-attrs.json --query QueueUrl --output text)

Q_ARN=$(qarn "$Q_URL"); FQ_ARN=$(qarn "$FQ_URL")
aws sqs list-queues --queue-name-prefix lab- --output table
```
:::

> [!CHECK]
> The queue list shows five queues whose names start with `lab-`. `lab-orders` lists `lab-orders-dlq` as its dead-letter queue with maximum receives 2, and `lab-orders.fifo` lists `lab-orders-dlq.fifo`.

### Step 2: Create the function and its asynchronous failure handling

The handler accepts both SQS and SNS records and logs one line per message, including the message group for FIFO messages, so the log shows the processing order.

```python
def lambda_handler(event, context):
    for record in event.get("Records", []):
        if record.get("eventSource") == "aws:sqs":
            source = "sqs"
            body = record["body"]
            group = record["attributes"].get("MessageGroupId", "-")
        else:  # SNS records use the key "EventSource": "aws:sns"
            source = "sns"
            body = record["Sns"]["Message"]
            group = "-"
        if "fail" in body:
            print(f"FAILED source={source} group={group} body={body}")
            raise RuntimeError(f"Cannot process {body}")
        print(f"OK source={source} group={group} body={body}")
    return {"status": "done"}
```

The function also gets its own DLQ (`lab-fn-dlq`) and **0** asynchronous retries. Those settings apply only to asynchronous sources such as SNS; Lambda's default would be 2 retries, 1 and then 2 minutes apart.

:::console
1. Open the **Lambda** console, choose **Functions** → **Create function** → **Author from scratch**.
2. **Function name** `lab-order-worker`, **Runtime** **Python 3.14**, **Architecture** **x86_64**. Keep the default execution role (basic CloudWatch Logs permissions) and choose **Create function**.
3. On the **Code** tab, replace `lambda_function.py` with the code above and choose **Deploy**.
4. Choose **Configuration** → **General configuration** → **Edit**, set **Timeout** to `5` sec and choose **Save**.
5. Choose **Configuration** → **Permissions** and open the **Role name** link. In IAM choose **Add permissions** → **Attach policies**, search for `AWSLambdaSQSQueueExecutionRole`, select it and choose **Add permissions**.
6. Still on the role, choose **Add permissions** → **Create inline policy**, select **JSON**, paste the policy below with your `lab-fn-dlq` ARN, choose **Next**, name it `send-to-fn-dlq` and choose **Create policy**.
7. Back in the function, choose **Configuration** → **Asynchronous invocation** → **Edit**. Set **Retry attempts** to `0`, set **Dead-letter queue service** to **Amazon SQS**, choose `lab-fn-dlq` and choose **Save**.

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "sqs:SendMessage",
    "Resource": "arn:aws:sqs:REGION:ACCOUNT_ID:lab-fn-dlq"
  }]
}
```
:::

:::cli
```bash
mkdir -p ~/lab-order-worker && cd ~/lab-order-worker
cat > lambda_function.py <<'EOF'
def lambda_handler(event, context):
    for record in event.get("Records", []):
        if record.get("eventSource") == "aws:sqs":
            source = "sqs"
            body = record["body"]
            group = record["attributes"].get("MessageGroupId", "-")
        else:  # SNS records use the key "EventSource": "aws:sns"
            source = "sns"
            body = record["Sns"]["Message"]
            group = "-"
        if "fail" in body:
            print(f"FAILED source={source} group={group} body={body}")
            raise RuntimeError(f"Cannot process {body}")
        print(f"OK source={source} group={group} body={body}")
    return {"status": "done"}
EOF
zip function.zip lambda_function.py

cat > trust.json <<'EOF'
{"Version": "2012-10-17",
 "Statement": [{"Effect": "Allow", "Principal": {"Service": "lambda.amazonaws.com"},
                "Action": "sts:AssumeRole"}]}
EOF
ROLE_ARN=$(aws iam create-role --role-name lab-order-worker-role \
  --assume-role-policy-document file://trust.json --query Role.Arn --output text)
# Read/delete from SQS plus CloudWatch Logs permissions.
aws iam attach-role-policy --role-name lab-order-worker-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaSQSQueueExecutionRole
cat > dlq-policy.json <<EOF
{"Version": "2012-10-17",
 "Statement": [{"Effect": "Allow", "Action": "sqs:SendMessage", "Resource": "$FN_DLQ_ARN"}]}
EOF
aws iam put-role-policy --role-name lab-order-worker-role \
  --policy-name send-to-fn-dlq --policy-document file://dlq-policy.json
sleep 15   # let IAM propagate the new role

aws lambda create-function --function-name lab-order-worker \
  --runtime python3.14 --architectures x86_64 \
  --handler lambda_function.lambda_handler --role "$ROLE_ARN" \
  --zip-file fileb://function.zip --timeout 5 \
  --dead-letter-config TargetArn="$FN_DLQ_ARN"
aws lambda wait function-active-v2 --function-name lab-order-worker
aws lambda put-function-event-invoke-config --function-name lab-order-worker \
  --maximum-retry-attempts 0
```
:::

> [!CHECK]
> The function shows runtime **Python 3.14** and timeout **5 sec**. **Configuration** → **Asynchronous invocation** lists **Retry attempts 0** and the dead-letter queue `lab-fn-dlq`. CLI: `aws lambda get-function-configuration --function-name lab-order-worker --query '[Timeout, DeadLetterConfig.TargetArn]'`.

> [!TIP]
> If you created the queues and function in the console, set the shell variables in CloudShell anyway so the later CLI commands (reading logs and queues, cleanup) work: run the `ACCOUNT_ID=...`, `qurl()` and `qarn()` lines from the Step 1 CLI tab, the three lines that set `DLQ_URL`, `FDLQ_URL` and `FN_DLQ_URL`, then `Q_URL=$(qurl lab-orders); FQ_URL=$(qurl lab-orders.fifo); Q_ARN=$(qarn "$Q_URL"); FQ_ARN=$(qarn "$FQ_URL")`.

### Step 3: Connect the standard queue to the function

An **event source mapping** makes Lambda poll the queue for you. A batch size of 1 keeps each failure separate so the log is easy to read.

:::console
1. In the function's **Function overview** pane, choose **Add trigger**.
2. Select **SQS**, choose `lab-orders` as the **SQS queue**, set **Batch size** to `1` and choose **Add**.
:::

:::cli
```bash
ESM_STD=$(aws lambda create-event-source-mapping --function-name lab-order-worker \
  --event-source-arn "$Q_ARN" --batch-size 1 --query UUID --output text)
until [ "$(aws lambda get-event-source-mapping --uuid "$ESM_STD" --query State --output text)" = "Enabled" ]; do
  sleep 5
done; echo "standard queue trigger enabled: $ESM_STD"
```
:::

> [!CHECK]
> **Configuration** → **Triggers** lists `lab-orders` with state **Enabled** (it shows **Creating** for a few seconds first).

### Step 4: Send a good and a bad message to the standard queue

:::console
1. In the SQS console select `lab-orders` → **Send and receive messages**.
2. Enter the **Message body** `order-1 ok` and choose **Send message**. Then send `order-2 fail`.
3. Wait about three minutes. Open `lab-orders-dlq` → **Send and receive messages** → **Poll for messages** and open the message.
4. Check `lab-fn-dlq` the same way.
5. In CloudShell, read the function log with the first CLI command of the next tab.
:::

:::cli
```bash
aws sqs send-message --queue-url "$Q_URL" --message-body "order-1 ok"
aws sqs send-message --queue-url "$Q_URL" --message-body "order-2 fail"
sleep 180
aws logs tail /aws/lambda/lab-order-worker --since 10m --format short | grep -E "OK|FAILED"
echo "--- queue DLQ:";    aws sqs receive-message --queue-url "$DLQ_URL" --wait-time-seconds 5 \
  --query 'Messages[].Body' --output text
echo "--- function DLQ:"; aws sqs get-queue-attributes --queue-url "$FN_DLQ_URL" \
  --attribute-names ApproximateNumberOfMessages --query Attributes --output text
```
:::

> [!CHECK]
> The log shows `OK source=sqs ... body=order-1 ok` once and `FAILED source=sqs ... body=order-2 fail` **twice**, about 30 seconds apart (each failure made the message visible again after the visibility timeout). After the second failure SQS moved the message to **`lab-orders-dlq`**. The function's own DLQ, **`lab-fn-dlq`, is empty (0 messages)**: for an SQS source the queue owns the message, so only the queue's redrive policy matters.

### Step 5: Watch a failing FIFO message block its message group

You send five messages for two customers. `A1 fail` is first in group `customer-A`.

:::console
1. In the Lambda function choose **Add trigger** → **SQS**, choose `lab-orders.fifo`, set **Batch size** to `1` and choose **Add**. Wait until the trigger is **Enabled**.
2. In the SQS console select `lab-orders.fifo` → **Send and receive messages**. Send these five messages in this order, typing the **Message group ID** for each (no deduplication ID is needed because content-based deduplication is on):
   - `A1 fail`, group `customer-A`
   - `A2 ok`, group `customer-A`
   - `A3 ok`, group `customer-A`
   - `B1 ok`, group `customer-B`
   - `B2 ok`, group `customer-B`
3. In CloudShell read the log right away, and again after about three minutes, with the `aws logs tail` command from the CLI tab. Then poll `lab-orders-dlq.fifo` in the console.
:::

:::cli
```bash
ESM_FIFO=$(aws lambda create-event-source-mapping --function-name lab-order-worker \
  --event-source-arn "$FQ_ARN" --batch-size 1 --query UUID --output text)
until [ "$(aws lambda get-event-source-mapping --uuid "$ESM_FIFO" --query State --output text)" = "Enabled" ]; do
  sleep 5
done; echo "FIFO trigger enabled: $ESM_FIFO"

for m in "customer-A:A1 fail" "customer-A:A2 ok" "customer-A:A3 ok" \
         "customer-B:B1 ok" "customer-B:B2 ok"; do
  aws sqs send-message --queue-url "$FQ_URL" \
    --message-group-id "${m%%:*}" --message-body "${m#*:}" \
    --query SequenceNumber --output text
done

sleep 20
echo "--- after 20 seconds:"
aws logs tail /aws/lambda/lab-order-worker --since 2m --format short | grep "group=customer"
sleep 160
echo "--- after 3 minutes:"
aws logs tail /aws/lambda/lab-order-worker --since 5m --format short | grep "group=customer"
echo "--- FIFO DLQ:"
aws sqs receive-message --queue-url "$FDLQ_URL" --wait-time-seconds 5 \
  --query 'Messages[].Body' --output text
```
:::

> [!CHECK]
> After 20 seconds, `B1 ok` and `B2 ok` are already processed while group `customer-A` shows only `FAILED ... A1 fail`. Over the next minute or two `A1 fail` fails a second time and moves to **`lab-orders-dlq.fifo`**; only then do `A2 ok` and `A3 ok` appear, in that order. One poison message stalled one customer's stream while the other customer was unaffected, which is exactly why a FIFO queue needs a DLQ.

### Step 6: Send a failing event through SNS

SNS invokes the function **asynchronously**: the publish call succeeds at once, and Lambda alone handles retries. With **Retry attempts** at 0 the failed event goes straight to the function's DLQ.

:::console
1. Open the **Amazon SNS** console → **Topics** → **Create topic**. Choose **Standard**, enter the **Name** `lab-order-events` and choose **Create topic**.
2. In the Lambda function choose **Add trigger** → **SNS**, choose `lab-order-events` as the **SNS topic** and choose **Add** (the console adds the permission that lets SNS invoke the function).
3. In the SNS topic choose **Publish message**, enter the **Message body** `S1 ok` and choose **Publish message**. Publish a second message with the body `S2 fail`.
4. After about 30 seconds, poll `lab-fn-dlq` in the SQS console, open the message and look at its **Attributes** as well as its body.
:::

:::cli
```bash
TOPIC_ARN=$(aws sns create-topic --name lab-order-events --query TopicArn --output text)
FN_ARN=$(aws lambda get-function --function-name lab-order-worker \
  --query Configuration.FunctionArn --output text)
aws lambda add-permission --function-name lab-order-worker \
  --statement-id sns-lab-order-events --action lambda:InvokeFunction \
  --principal sns.amazonaws.com --source-arn "$TOPIC_ARN"
SUB_ARN=$(aws sns subscribe --topic-arn "$TOPIC_ARN" --protocol lambda \
  --notification-endpoint "$FN_ARN" --return-subscription-arn \
  --query SubscriptionArn --output text)

aws sns publish --topic-arn "$TOPIC_ARN" --message "S1 ok"
aws sns publish --topic-arn "$TOPIC_ARN" --message "S2 fail"
sleep 30
aws logs tail /aws/lambda/lab-order-worker --since 2m --format short | grep "source=sns"
aws sqs receive-message --queue-url "$FN_DLQ_URL" --wait-time-seconds 10 \
  --message-attribute-names All --output json \
  | jq '.Messages[0] | {error: .MessageAttributes.ErrorMessage.StringValue,
                       snsMessage: (.Body | fromjson | .Records[0].Sns.Message)}'
```
:::

> [!CHECK]
> Both publish calls return a **MessageId** immediately, even for the event that fails. The log shows `OK source=sns ... S1 ok` and a single `FAILED source=sns ... S2 fail` (no retries, because you set 0). **`lab-fn-dlq` now holds one message**: its body is the original SNS event containing `S2 fail`, and its attributes include **ErrorMessage** `Cannot process S2 fail` and the **RequestID**. An on-failure destination would also have recorded the function's response.

> [!TIP]
> Summarise what you saw: for the two SQS patterns the **queue** kept the message and its redrive policy moved it to the queue's DLQ; for SNS the **function** kept the event and its own DLQ (or destination) caught it. The same rule applies to every asynchronous source, such as S3 event notifications and EventBridge.

## Cleanup

Delete in this order:

- [ ] **Event source mappings** (both SQS triggers): Lambda → `lab-order-worker` → **Configuration** → **Triggers** → select each SQS trigger → **Delete**. CLI: `aws lambda delete-event-source-mapping --uuid "$ESM_STD"` and `aws lambda delete-event-source-mapping --uuid "$ESM_FIFO"` (list them with `aws lambda list-event-source-mappings --function-name lab-order-worker` if the variables are gone).
- [ ] **SNS topic `lab-order-events`** and its Lambda subscription: SNS → **Topics** → select it → **Delete**, type `delete me`, confirm. Then **Subscriptions** → delete any remaining subscription for the topic. CLI: `aws sns unsubscribe --subscription-arn "$SUB_ARN"` and `aws sns delete-topic --topic-arn "$TOPIC_ARN"`.
- [ ] **Lambda function `lab-order-worker`**: **Functions** → select → **Actions** → **Delete**, type `confirm`. CLI: `aws lambda delete-function --function-name lab-order-worker`.
- [ ] **IAM role**: IAM → **Roles** → the function's role (`lab-order-worker-role`, or `lab-order-worker-role-xxxxxxxx` if the console created it) → **Delete**, type the role name. If the console created it, also delete its customer managed policy `AWSLambdaBasicExecutionRole-...` under **Policies**. CLI: `aws iam detach-role-policy --role-name lab-order-worker-role --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaSQSQueueExecutionRole`, `aws iam delete-role-policy --role-name lab-order-worker-role --policy-name send-to-fn-dlq`, then `aws iam delete-role --role-name lab-order-worker-role`.
- [ ] **Log group `/aws/lambda/lab-order-worker`**: CloudWatch → **Log groups** → select → **Actions** → **Delete log group(s)**. CLI: `aws logs delete-log-group --log-group-name /aws/lambda/lab-order-worker`.
- [ ] **Five SQS queues** `lab-orders`, `lab-orders.fifo`, `lab-orders-dlq`, `lab-orders-dlq.fifo`, `lab-fn-dlq`: SQS → select each → **Delete**, type `delete`. CLI: `for u in "$Q_URL" "$FQ_URL" "$DLQ_URL" "$FDLQ_URL" "$FN_DLQ_URL"; do aws sqs delete-queue --queue-url "$u"; done`.
- [ ] **Local files** in CloudShell: `rm -rf ~/lab-order-worker std-attrs.json fifo-attrs.json` (run from the directory where you created the JSON files).
- [ ] **Final check**: `aws sqs list-queues --queue-name-prefix lab-` returns nothing (deletion can take up to 60 seconds), `aws lambda list-functions --query "Functions[?FunctionName=='lab-order-worker']"` returns `[]`, and `aws sns list-topics` no longer shows `lab-order-events`.

## Progress checklist

- [ ] Step 1: Created two main queues, two queue DLQs and the function DLQ
- [ ] Step 2: Created `lab-order-worker` with a 5-second timeout, 0 async retries and `lab-fn-dlq`
- [ ] Step 3: Connected `lab-orders` with batch size 1
- [ ] Step 4: Saw the failing standard-queue message land in `lab-orders-dlq`, not in the function DLQ
- [ ] Step 5: Saw `A1 fail` block group `customer-A` while `customer-B` flowed
- [ ] Step 6: Saw the failing SNS event land in the function's DLQ with error attributes
- [ ] Cleanup done
