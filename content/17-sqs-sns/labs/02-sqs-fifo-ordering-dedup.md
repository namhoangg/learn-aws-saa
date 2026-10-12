---
id: 17-sqs-sns-lab-02
title: See ordering, message groups and deduplication in an SQS FIFO queue
objective: Create a FIFO queue, send order events for two customers, and observe strict ordering per message group, group blocking while a message is in flight, and duplicate removal by deduplication ID and by content.
estimatedTime: 30 minutes
cost: "Free: a few dozen SQS requests, inside the Always Free allowance of 1 million SQS requests per month (the allowance covers FIFO queues too)."
freeTier: yes
services: [sqs]
---

A FIFO queue trades raw throughput for two guarantees: messages in the same **message group** come out in the order they went in, and a retried send inside the **5-minute deduplication window** does not create a second copy. In this lab two customers each produce a short sequence of order events, and you check both guarantees yourself.

> [!NOTE] Cost
> FIFO requests are priced higher than standard requests, but the SQS Always Free tier of 1 million requests per month applies to standard and FIFO queues alike, and this lab needs only a few dozen.

## Prerequisites

- An AWS account and an IAM user or role allowed to manage SQS (for example `AmazonSQSFullAccess`).
- Any Region; use the same Region for the console and the CLI.
- For the CLI tabs: **AWS CloudShell** (AWS CLI v2 and `jq` preinstalled) or a Bash shell with AWS CLI v2 and `jq`. Keep one terminal open; later commands reuse shell variables.

## Steps

### Step 1: Create the FIFO queue

:::console
1. Open the **Amazon SQS** console and choose **Create queue**.
2. For **Type**, choose **FIFO**. (The type cannot be changed later.)
3. For **Name**, enter `demo-orders.fifo`. The `.fifo` suffix is required.
4. Under **Configuration**, keep **Visibility timeout** at `30` seconds and leave **Content-based deduplication** turned off. Do not turn on **Enable high throughput FIFO**.
5. Choose **Create queue**.
:::

:::cli
```bash
F_URL=$(aws sqs create-queue --queue-name demo-orders.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=false \
  --query QueueUrl --output text)

aws sqs get-queue-attributes --queue-url "$F_URL" \
  --attribute-names FifoQueue ContentBasedDeduplication VisibilityTimeout
```
:::

> [!CHECK]
> The queue list shows `demo-orders.fifo` with Type **FIFO**. The CLI shows `"FifoQueue": "true"` and `"ContentBasedDeduplication": "false"`.

### Step 2: Try to send without a message group ID

Every message sent to a FIFO queue must name its group. Prove it by leaving the group out.

:::console
1. Select `demo-orders.fifo` and choose **Send and receive messages**.
2. Enter a **Message body** such as `no group`, enter `test-1` as **Message deduplication ID**, and leave **Message group ID** empty.
3. Choose **Send message**.
:::

:::cli
```bash
aws sqs send-message --queue-url "$F_URL" \
  --message-body "no group" --message-deduplication-id test-1
```
:::

> [!CHECK]
> The send is refused: the console asks for a message group ID and the CLI returns an error about the missing `MessageGroupId`. Nothing is added to the queue.

### Step 3: Send two customers' order events

Customer A creates, pays for and ships an order. Customer B creates and cancels one. Each customer is its own message group, and every message gets a unique deduplication ID.

:::console
1. On **Send and receive messages**, send these five messages one at a time, filling **Message body**, **Message group ID** and **Message deduplication ID** each time:

   | Message body | Message group ID | Message deduplication ID |
   |---|---|---|
   | `A1 customer-A order created` | `customer-A` | `A-1` |
   | `B1 customer-B order created` | `customer-B` | `B-1` |
   | `A2 customer-A order paid` | `customer-A` | `A-2` |
   | `B2 customer-B order cancelled` | `customer-B` | `B-2` |
   | `A3 customer-A order shipped` | `customer-A` | `A-3` |

2. Go back to **Queues** and note the number of messages available.
:::

:::cli
```bash
send() {
  aws sqs send-message --queue-url "$F_URL" \
    --message-group-id "$1" --message-deduplication-id "$2" \
    --message-body "$3" --query SequenceNumber --output text
}

send customer-A A-1 "A1 customer-A order created"
send customer-B B-1 "B1 customer-B order created"
send customer-A A-2 "A2 customer-A order paid"
send customer-B B-2 "B2 customer-B order cancelled"
send customer-A A-3 "A3 customer-A order shipped"

aws sqs get-queue-attributes --queue-url "$F_URL" \
  --attribute-names ApproximateNumberOfMessages
```
:::

> [!CHECK]
> Each CLI send prints a **sequence number**, a value FIFO queues assign to every message, and the numbers increase. The queue holds **5** messages.

### Step 4: Retry a send with the same deduplication ID

Imagine the producer's network dropped after it sent `A2` and it retries. Within 5 minutes of the original, SQS accepts the retry but does not store a second copy, even if the body differs.

:::console
1. On **Send and receive messages**, send a message with body `A2 customer-A order paid (retry)`, **Message group ID** `customer-A` and **Message deduplication ID** `A-2`.
2. The console reports the send as successful. Go back to **Queues** and check the message count.
:::

:::cli
```bash
send customer-A A-2 "A2 customer-A order paid (retry)"

aws sqs get-queue-attributes --queue-url "$F_URL" \
  --attribute-names ApproximateNumberOfMessages
```
:::

> [!CHECK]
> The send succeeds, yet the queue still holds **5** messages, not 6. Within the 5-minute deduplication interval, a second message with an ID that SQS has already seen is accepted and then dropped. The `NumberOfDeduplicatedSentMessages` CloudWatch metric for the queue counts these drops.

### Step 5: See a message group block while a message is in flight

While one message of a group is being processed (in flight), the following messages of that group are held back. Other groups keep flowing.

:::console
1. On **Send and receive messages**, choose **Poll for messages** and look at the order of the bodies: within each customer the numbers increase (A1, A2, A3 and B1, B2). Do not delete anything.
2. Wait about 30 seconds so the visibility timeout ends and the messages become visible again.
3. The console poll takes every available message at once, so it cannot show one group waiting behind another. To see that, open **CloudShell** from the console toolbar and run the CLI tab's commands there (set `F_URL` first with `F_URL=$(aws sqs get-queue-url --queue-name demo-orders.fifo --query QueueUrl --output text)`). The last command waits 35 seconds so the messages are visible again for the next step.
:::

:::cli
```bash
# Take exactly one message and do NOT delete it
aws sqs receive-message --queue-url "$F_URL" --max-number-of-messages 1 \
  --query 'Messages[].Body' --output text

# Ask for up to 10 more: only the OTHER customer's messages come back, in order
aws sqs receive-message --queue-url "$F_URL" --max-number-of-messages 10 \
  --query 'Messages[].Body' --output text

# Ask again: both groups now have a message in flight, so nothing is returned
aws sqs receive-message --queue-url "$F_URL" --max-number-of-messages 10 \
  --wait-time-seconds 5 --query 'Messages[].Body' --output text

sleep 35
```
:::

> [!CHECK]
> The first call returns one message, for example `A1`. The second returns only the other customer's messages in sequence (`B1`, `B2`, or just `B1`), never `A2`, because group A is blocked behind the in-flight `A1`. The third call returns nothing (`None` in the CLI). This is why many distinct group IDs mean more parallelism, and why one stuck message holds up its whole group.

### Step 6: Process everything in order

Now act as a well-behaved consumer: receive one message, "process" it, delete it, repeat.

:::console
1. Choose **Poll for messages**. One receive can return several messages of the same group, but always in the order they were sent, so the list shows A1 before A2 before A3, and B1 before B2.
2. A real consumer would process them in exactly that order. Select all the messages, choose **Delete** and confirm.
3. Poll once more to confirm the queue is empty. (The CLI tab shows the one-at-a-time version of this loop.)
:::

:::cli
```bash
for i in $(seq 1 7); do
  aws sqs receive-message --queue-url "$F_URL" --wait-time-seconds 5 > r.json
  if ! jq -e '.Messages' r.json > /dev/null 2>&1; then
    echo "queue empty"; break
  fi
  jq -r '.Messages[0].Body' r.json
  aws sqs delete-message --queue-url "$F_URL" \
    --receipt-handle "$(jq -r '.Messages[0].ReceiptHandle' r.json)"
done
```
:::

> [!CHECK]
> Customer A's events print as A1, A2, A3 and customer B's as B1, B2. The two groups may interleave (for example A1, B1, A2...), but within a group the order is always the order of sending. The retried `A2 ... (retry)` body never appears. The loop ends with `queue empty`.

### Step 7: Switch on content-based deduplication

Instead of inventing deduplication IDs, you can let SQS hash the message body (SHA-256; attributes are ignored).

:::console
1. Select `demo-orders.fifo`, choose **Edit**, turn on **Content-based deduplication** and choose **Save**.
2. On **Send and receive messages**, send the body `C1 customer-C order created` with **Message group ID** `customer-C` and leave **Message deduplication ID** empty.
3. Send exactly the same body and group again.
4. Check the message count on the **Queues** page, then poll and delete the message.
:::

:::cli
```bash
aws sqs set-queue-attributes --queue-url "$F_URL" \
  --attributes ContentBasedDeduplication=true

for n in 1 2; do
  aws sqs send-message --queue-url "$F_URL" \
    --message-group-id customer-C --message-body "C1 customer-C order created" \
    --query MessageId --output text
done

aws sqs get-queue-attributes --queue-url "$F_URL" \
  --attribute-names ApproximateNumberOfMessages
```
:::

> [!CHECK]
> Both sends succeed without a deduplication ID, but the queue holds only **1** message: the identical body produced the same hash, so the second copy was dropped. Change one character of the body and a third send would be stored.

## Cleanup

- [ ] Delete the queue `demo-orders.fifo` (console: **Queues** → select it → **Delete** → in the **Delete queue** dialog enter `delete` → **Delete**; CLI: `aws sqs delete-queue --queue-url "$F_URL"`). Any remaining messages are deleted with it.
- [ ] Remove the local helper file: `rm -f r.json`.
- [ ] Final check: `aws sqs list-queues --queue-name-prefix demo-orders` no longer lists `demo-orders.fifo` (deletion can take up to 60 seconds).

## Progress checklist

- [ ] Step 1: FIFO queue created
- [ ] Step 2: saw a send without a message group ID rejected
- [ ] Step 3: sent five events in two message groups
- [ ] Step 4: saw a retried send with the same deduplication ID dropped
- [ ] Step 5: saw a message group blocked while one of its messages was in flight
- [ ] Step 6: processed all messages in order
- [ ] Step 7: saw content-based deduplication drop an identical body
- [ ] Cleanup done
