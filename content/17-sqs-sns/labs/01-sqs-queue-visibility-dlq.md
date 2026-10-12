---
id: 17-sqs-sns-lab-01
title: Send, receive and fail messages in an SQS standard queue
objective: Create a standard queue with a dead-letter queue, then watch the visibility timeout, ChangeMessageVisibility, short versus long polling, a poison message moving to the DLQ, and a DLQ redrive.
estimatedTime: 40 minutes
cost: "Free: the lab makes a few hundred SQS requests, well inside the Always Free allowance of 1 million SQS requests per month. Default SSE-SQS encryption has no extra charge."
freeTier: yes
services: [sqs, cloudwatch]
---

You will build the queue pair that almost every SQS design uses: a main queue for work and a dead-letter queue (DLQ) for messages that keep failing. Then you will play the role of a consumer to see, step by step, what happens to a message after it is received, when it is not deleted, and when it can never be processed.

> [!NOTE] Cost
> SQS has an Always Free tier of 1 million requests per month for every account, and each 64 KB chunk of a payload counts as one request. This lab stays far below that. Nothing here is billed by the hour, but delete the queues at the end anyway to keep the account tidy.

## Prerequisites

- An AWS account and an IAM user or role allowed to manage SQS (for example the `AmazonSQSFullAccess` managed policy).
- Any Region; the commands use your CLI default Region. Use the same Region for the console and the CLI.
- For the CLI tabs: **AWS CloudShell** (recommended: it has the AWS CLI v2 and `jq` preinstalled) or a Bash shell with AWS CLI v2 configured and `jq` installed. Keep one terminal open for the whole lab because later commands reuse shell variables.

## Steps

### Step 1: Create the dead-letter queue

Create the DLQ first, because the main queue's redrive policy must point at an existing queue. Give it the maximum retention: in a standard queue a message keeps its original enqueue timestamp when it moves to the DLQ, so a short DLQ retention could delete it almost immediately.

:::console
1. Open the **Amazon SQS** console and choose **Create queue**.
2. Leave **Type** as **Standard**.
3. For **Name**, enter `demo-orders-dlq`.
4. Under **Configuration**, set **Message retention period** to `14` **Days**. Leave the other values at their defaults.
5. Leave **Encryption** at its default (server-side encryption enabled with an Amazon SQS key).
6. Choose **Create queue**.
:::

:::cli
```bash
DLQ_URL=$(aws sqs create-queue --queue-name demo-orders-dlq \
  --attributes MessageRetentionPeriod=1209600 \
  --query QueueUrl --output text)

DLQ_ARN=$(aws sqs get-queue-attributes --queue-url "$DLQ_URL" \
  --attribute-names QueueArn --query Attributes.QueueArn --output text)

echo "DLQ: $DLQ_URL"
echo "DLQ ARN: $DLQ_ARN"
```
:::

> [!CHECK]
> The queue's **Details** page shows Type **Standard**, a retention of 14 days and an ARN ending in `:demo-orders-dlq`. In the CLI, `MessageRetentionPeriod` is `1209600` seconds.

### Step 2: Create the main queue with a redrive policy

The main queue keeps the default 30-second visibility timeout and short polling (receive wait time 0) for now. Its redrive policy sends a message to the DLQ after it has been received three times without being deleted.

:::console
1. In the SQS console choose **Create queue** again and leave **Type** as **Standard**.
2. For **Name**, enter `demo-orders`.
3. Under **Configuration**, check that **Visibility timeout** is `30` **Seconds** and **Receive message wait time** is `0` seconds.
4. Expand **Dead-letter queue** and turn on **Enabled**.
5. Choose the ARN of `demo-orders-dlq` as the dead-letter queue and set **Maximum receives** to `3`.
6. Choose **Create queue**.
:::

:::cli
```bash
cat > main-queue-attrs.json <<EOF
{
  "VisibilityTimeout": "30",
  "ReceiveMessageWaitTimeSeconds": "0",
  "RedrivePolicy": "{\"deadLetterTargetArn\":\"$DLQ_ARN\",\"maxReceiveCount\":\"3\"}"
}
EOF

Q_URL=$(aws sqs create-queue --queue-name demo-orders \
  --attributes file://main-queue-attrs.json \
  --query QueueUrl --output text)

aws sqs get-queue-attributes --queue-url "$Q_URL" \
  --attribute-names VisibilityTimeout ReceiveMessageWaitTimeSeconds RedrivePolicy
```
:::

> [!CHECK]
> `demo-orders` shows a **Dead-letter queue** of `demo-orders-dlq` with maximum receives 3. In the CLI output, `RedrivePolicy` contains the DLQ's ARN and `"maxReceiveCount":"3"` (the CLI may print it as a number).

### Step 3: Send some orders

:::console
1. Select `demo-orders` and choose **Send and receive messages**.
2. In **Message body**, enter `{"orderId": 1001, "item": "pencil", "qty": 1}` and choose **Send message**.
3. Send four more messages, changing the `orderId` to 1002, 1003, 1004 and 1005.
4. Go back to **Queues** and look at the `demo-orders` row.
:::

:::cli
```bash
for i in 1 2 3 4 5; do
  aws sqs send-message --queue-url "$Q_URL" \
    --message-body "{\"orderId\": 100$i, \"item\": \"pencil\", \"qty\": $i}" \
    --query MessageId --output text
done

aws sqs get-queue-attributes --queue-url "$Q_URL" \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible
```
:::

> [!CHECK]
> Five message IDs are printed and the queue reports about **5** messages available and **0** in flight. The counts are approximate and can take a few seconds to settle.

### Step 4: Receive a message and watch the visibility timeout

Receiving a message does not delete it. It only hides it for the visibility timeout.

:::console
1. On the **Send and receive messages** page, choose **Poll for messages**.
2. In the **Messages** list, note the **Receive count** of each message (1) and open one message ID to see its body.
3. Do **not** delete anything. Go back to **Queues**: the messages now count as in flight.
4. Wait about 30 seconds, refresh, and poll again.
:::

:::cli
```bash
aws sqs receive-message --queue-url "$Q_URL" --max-number-of-messages 1 \
  --message-system-attribute-names ApproximateReceiveCount > msg.json
jq '.Messages[0] | {MessageId, Body, Attributes}' msg.json

# Immediately afterwards: one message is hidden (in flight)
aws sqs get-queue-attributes --queue-url "$Q_URL" \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible

sleep 35

# After the 30-second visibility timeout: it is visible again
aws sqs get-queue-attributes --queue-url "$Q_URL" \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible
```
:::

> [!CHECK]
> CLI: right after the receive, about 4 messages are available and 1 is not visible. Console: the poll takes all five at once, so **Messages in flight** shows about 5 and **Messages available** 0. Either way, about 30 seconds later every message is available again, because nobody deleted it. Polling again in the console shows a **Receive count** of 2 for messages you had already received: this is exactly how a slow or crashed consumer causes a second delivery.

### Step 5: Process a message properly, and release one early

A real consumer deletes a message right after it finishes the work, within the visibility timeout. A consumer that decides it cannot handle a message can release it at once with `ChangeMessageVisibility` set to 0 instead of waiting for the timeout.

:::console
1. On **Send and receive messages**, choose **Poll for messages**. If nothing comes back, the messages from your last poll are still hidden: wait for the 30-second visibility timeout to pass and poll again.
2. Select one message (for example order 1001) and choose **Delete**, then confirm with **Delete**.
3. Go back to **Queues**: the queue now holds 4 messages. (Changing the visibility of a single message is an API action; use the CLI tab to try it.)
:::

:::cli
```bash
# Receive and delete within the visibility timeout
aws sqs receive-message --queue-url "$Q_URL" --max-number-of-messages 1 > msg.json
jq -r '.Messages[0].Body' msg.json
aws sqs delete-message --queue-url "$Q_URL" \
  --receipt-handle "$(jq -r '.Messages[0].ReceiptHandle' msg.json)"

# Receive another one, then give it back immediately
aws sqs receive-message --queue-url "$Q_URL" --max-number-of-messages 1 > msg.json
aws sqs change-message-visibility --queue-url "$Q_URL" \
  --receipt-handle "$(jq -r '.Messages[0].ReceiptHandle' msg.json)" \
  --visibility-timeout 0

aws sqs get-queue-attributes --queue-url "$Q_URL" \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible
```
:::

> [!CHECK]
> The deleted order never comes back, and the queue reports about 4 messages. The message you released with a visibility timeout of 0 is immediately available again (0 in flight) instead of hidden for 30 seconds.

### Step 6: Compare short polling with long polling

Empty the queue, then time an empty receive with and without a wait time.

:::console
1. On the **Queues** page select `demo-orders`, then from **Actions** choose **Purge**. In the **Purge queue** dialog enter `purge` and choose **Purge**. Wait a full minute; purging can take up to 60 seconds.
2. Choose **Edit**, set **Receive message wait time** to `20` seconds and choose **Save**. From now on every receive on this queue long polls.
3. Open **Send and receive messages**, choose **Poll for messages**, and while it is polling send a new message from the same page (for example `{"orderId": 2001}`). The message appears in the list almost immediately.
4. Poll again, select the message and **Delete** it so the queue is empty for the next step.
:::

:::cli
```bash
aws sqs purge-queue --queue-url "$Q_URL"
sleep 60

# Short polling: returns at once, even if empty
time aws sqs receive-message --queue-url "$Q_URL"

# Long polling on this call only: waits up to 20 s for a message
time aws sqs receive-message --queue-url "$Q_URL" --wait-time-seconds 20

# Make long polling the queue default
aws sqs set-queue-attributes --queue-url "$Q_URL" \
  --attributes ReceiveMessageWaitTimeSeconds=20
```
:::

> [!CHECK]
> The short poll returns in well under a second with no messages. The long poll on an empty queue returns after about **20 seconds**. If a message arrives while a long poll is waiting, the call returns as soon as the message lands. Fewer empty calls is why long polling costs less.

### Step 7: Send a poison message and watch it move to the DLQ

Pretend the consumer fails on this message every time. Each receive without a delete increases its receive count; once a receive would push the count past **Maximum receives** (3), SQS moves the message to the DLQ instead of delivering it.

:::console
1. On **Send and receive messages** for `demo-orders`, send the body `{"orderId": "BAD", "qty": "not-a-number"}`.
2. Choose **Poll for messages**. The message appears with **Receive count** 1. Do not delete it.
3. Wait about 30 seconds (the visibility timeout) and poll again: receive count 2. Repeat once more: receive count 3.
4. Wait 30 seconds and poll a fourth time: the message no longer appears.
5. Go back to **Queues**: `demo-orders` shows 0 messages and `demo-orders-dlq` shows 1 message available.
:::

:::cli
```bash
aws sqs send-message --queue-url "$Q_URL" \
  --message-body '{"orderId": "BAD", "qty": "not-a-number"}'

for attempt in 1 2 3 4; do
  echo "Attempt $attempt:"
  # --visibility-timeout 2 overrides the queue default for this call only,
  # so the failed message comes back after 2 seconds instead of 30
  aws sqs receive-message --queue-url "$Q_URL" \
    --visibility-timeout 2 --wait-time-seconds 5 \
    --message-system-attribute-names ApproximateReceiveCount \
    --query 'Messages[0].[Body, Attributes.ApproximateReceiveCount]' --output text
  sleep 3
done

aws sqs get-queue-attributes --queue-url "$DLQ_URL" \
  --attribute-names ApproximateNumberOfMessages
```
:::

> [!CHECK]
> Attempts 1 to 3 print the body with receive counts 1, 2 and 3. Attempt 4 prints `None`: SQS moved the message to the DLQ instead of delivering it a fourth time. A few seconds later the DLQ reports **1** message.

### Step 8: Redrive the message back to the source queue

Imagine you fixed the bug. DLQ redrive moves messages back so they are processed again.

:::console
1. In **Queues**, choose `demo-orders-dlq`, then choose **Start DLQ redrive**.
2. Under **Redrive configuration**, for **Message destination** choose **Redrive to source queue(s)**.
3. Under **Velocity control settings**, keep **System optimized**.
4. Choose **Redrive messages** and wait until the redrive status shows it has completed.
5. Open `demo-orders`, choose **Send and receive messages** → **Poll for messages**, select the redriven message and **Delete** it ("processed by the fixed consumer").
:::

:::cli
```bash
aws sqs start-message-move-task --source-arn "$DLQ_ARN"
sleep 10
aws sqs list-message-move-tasks --source-arn "$DLQ_ARN" \
  --query 'Results[0].[Status, ApproximateNumberOfMessagesMoved]' --output text

# The fixed consumer processes and deletes it
aws sqs receive-message --queue-url "$Q_URL" > msg.json
jq -r '.Messages[0].Body' msg.json
aws sqs delete-message --queue-url "$Q_URL" \
  --receipt-handle "$(jq -r '.Messages[0].ReceiptHandle' msg.json)"
```
:::

> [!CHECK]
> The move task reports `COMPLETED` with 1 message moved, the DLQ is empty and the message is received from `demo-orders` again. Redriven messages get a new message ID and enqueue time.

## Cleanup

Delete both queues. Deleting a queue also deletes any messages left in it.

- [ ] Delete the main queue `demo-orders` (console: **Queues** → select it → **Delete** → in the **Delete queue** dialog enter `delete` → **Delete**; CLI: `aws sqs delete-queue --queue-url "$Q_URL"`).
- [ ] Delete the dead-letter queue `demo-orders-dlq` (console: same steps; CLI: `aws sqs delete-queue --queue-url "$DLQ_URL"`).
- [ ] Remove the local helper files from your shell: `rm -f main-queue-attrs.json msg.json`.
- [ ] Final check: the SQS console **Queues** list no longer shows `demo-orders` or `demo-orders-dlq` in the Region you used (`aws sqs list-queues --queue-name-prefix demo-orders` returns nothing).

> [!TIP]
> Deleting a queue takes up to 60 seconds, and you must wait at least 60 seconds before creating a new queue with the same name, for example if you want to repeat the lab.

## Progress checklist

- [ ] Step 1: dead-letter queue created with 14-day retention
- [ ] Step 2: main queue created with a redrive policy (maximum receives 3)
- [ ] Step 3: five orders sent
- [ ] Step 4: saw a received message reappear after the visibility timeout
- [ ] Step 5: deleted one message and released another with ChangeMessageVisibility
- [ ] Step 6: compared short and long polling
- [ ] Step 7: watched a poison message move to the DLQ
- [ ] Step 8: redrove the message and processed it
- [ ] Cleanup done
