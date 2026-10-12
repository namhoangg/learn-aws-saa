---
id: 17-sqs-sns-lab-03
title: Fan out order events from SNS to SQS queues with filter policies
objective: Build an SNS topic that fans out to three SQS queues, give two of the subscriptions filter policies on an order status attribute, publish test orders and confirm that each queue receives exactly the messages it should, with and without raw message delivery.
estimatedTime: 40 minutes
cost: "Free: a few dozen SNS publishes and SQS requests are inside the Always Free allowances (1 million SNS publishes and 1 million SQS requests per month; SNS does not charge per delivery to SQS). The optional email step uses a handful of the 1,000 free email notifications."
freeTier: yes
services: [sns, sqs]
---

This lab builds the fan-out pattern from the lesson: an order service publishes once, and SNS copies each order into the queues of the systems that care about it. A **fulfilment** queue gets only placed orders, a **refunds** queue gets only cancelled orders, and an **analytics** queue gets everything.

> [!NOTE] Cost
> SNS includes 1 million publishes, 100,000 HTTP/S deliveries and 1,000 email deliveries per month at no charge, and does not charge per notification delivered to SQS. SQS includes 1 million requests per month. Nothing in this lab is billed by the hour.

## Prerequisites

- An AWS account and an IAM user or role allowed to manage SNS and SQS (for example `AmazonSNSFullAccess` plus `AmazonSQSFullAccess`).
- Any Region; create the topic and the queues in the same Region and use it for the console and the CLI.
- For the CLI tabs: **AWS CloudShell** (AWS CLI v2 and `jq` preinstalled) or a Bash shell with AWS CLI v2 and `jq`. Keep one terminal open; later commands reuse shell variables.
- Optional for Step 7: an email address you can read.

## Steps

### Step 1: Create the SNS topic

:::console
1. Open the **Amazon SNS** console and choose **Topics** in the navigation pane, then **Create topic**.
2. For **Type**, choose **Standard**.
3. For **Name**, enter `demo-orders-topic`. Leave the optional sections (encryption, access policy, delivery policies) at their defaults.
4. Choose **Create topic** and copy the topic **ARN** from the **Details** section.
:::

:::cli
```bash
TOPIC_ARN=$(aws sns create-topic --name demo-orders-topic \
  --query TopicArn --output text)
echo "$TOPIC_ARN"
```
:::

> [!CHECK]
> The topic page shows Type **Standard**, the name `demo-orders-topic` and an ARN like `arn:aws:sns:<region>:<account-id>:demo-orders-topic`. It has no subscriptions yet.

### Step 2: Create three SQS queues

:::console
1. Open the **Amazon SQS** console and choose **Create queue**.
2. Keep **Type** **Standard**, enter the **Name** `demo-orders-fulfilment`, leave everything else at the defaults and choose **Create queue**.
3. Repeat for `demo-orders-refunds` and `demo-orders-analytics`.
:::

:::cli
```bash
for q in fulfilment refunds analytics; do
  aws sqs create-queue --queue-name "demo-orders-$q" --query QueueUrl --output text
done

FUL_URL=$(aws sqs get-queue-url --queue-name demo-orders-fulfilment --query QueueUrl --output text)
REF_URL=$(aws sqs get-queue-url --queue-name demo-orders-refunds --query QueueUrl --output text)
ANA_URL=$(aws sqs get-queue-url --queue-name demo-orders-analytics --query QueueUrl --output text)

arn_of() {
  aws sqs get-queue-attributes --queue-url "$1" \
    --attribute-names QueueArn --query Attributes.QueueArn --output text
}
FUL_ARN=$(arn_of "$FUL_URL"); REF_ARN=$(arn_of "$REF_URL"); ANA_ARN=$(arn_of "$ANA_URL")
echo "$FUL_ARN"; echo "$REF_ARN"; echo "$ANA_ARN"
```
:::

> [!CHECK]
> Three standard queues exist, each with 0 messages. They use the default SSE-SQS encryption, which involves no KMS key, so SNS needs no key permissions to deliver to them.

### Step 3: Subscribe the queues and allow SNS to send to them

A subscription alone is not enough: each queue's **access policy** must allow the topic to call `sqs:SendMessage`. Subscribing from the SQS console writes that statement for you; with the CLI you add it yourself.

:::console
1. In the SQS console, select `demo-orders-fulfilment`, then from **Actions** choose **Subscribe to Amazon SNS topic**.
2. From **Specify an Amazon SNS topic available for this queue**, choose `demo-orders-topic` and choose **Save**.
3. Repeat for `demo-orders-refunds` and `demo-orders-analytics`.
4. Open one of the queues, choose the **Access policy** tab and read the statement the console added.
:::

:::cli
```bash
allow_topic() {   # $1 = queue URL, $2 = queue ARN
  jq -n --arg q "$2" --arg t "$TOPIC_ARN" '{Policy: ({
      Version: "2012-10-17",
      Statement: [{
        Sid: "AllowDemoOrdersTopic",
        Effect: "Allow",
        Principal: {Service: "sns.amazonaws.com"},
        Action: "sqs:SendMessage",
        Resource: $q,
        Condition: {ArnEquals: {"aws:SourceArn": $t}}
      }]
    } | tojson)}' > policy-attrs.json
  aws sqs set-queue-attributes --queue-url "$1" --attributes file://policy-attrs.json
}

subscribe() {     # $1 = queue ARN, prints the subscription ARN
  aws sns subscribe --topic-arn "$TOPIC_ARN" --protocol sqs \
    --notification-endpoint "$1" --return-subscription-arn \
    --query SubscriptionArn --output text
}

allow_topic "$FUL_URL" "$FUL_ARN"; SUB_FUL=$(subscribe "$FUL_ARN")
allow_topic "$REF_URL" "$REF_ARN"; SUB_REF=$(subscribe "$REF_ARN")
allow_topic "$ANA_URL" "$ANA_ARN"; SUB_ANA=$(subscribe "$ANA_ARN")

aws sns list-subscriptions-by-topic --topic-arn "$TOPIC_ARN" \
  --query 'Subscriptions[].[Protocol, Endpoint]' --output table
```
:::

> [!CHECK]
> In the SNS console, `demo-orders-topic` lists three **Amazon SQS** subscriptions with status **Confirmed** (a queue in your own account is confirmed automatically). Each queue's access policy contains a statement with principal `sns.amazonaws.com`, action `sqs:SendMessage` and an `aws:SourceArn` condition naming the topic.

### Step 4: Add filter policies to two subscriptions

The fulfilment subscription should accept only messages whose `status` attribute is `placed`, and the refunds subscription only `cancelled`. The analytics subscription gets no filter policy, so it receives everything.

:::console
1. In the SNS console choose **Subscriptions**, select the subscription whose endpoint ends in `demo-orders-fulfilment`, and choose **Edit**.
2. Expand **Subscription filter policy**, choose **attribute-based filtering**, and in the **JSON editor** enter `{"status": ["placed"]}`.
3. Choose **Save changes**.
4. Repeat for the `demo-orders-refunds` subscription with `{"status": ["cancelled"]}`.
5. Wait a couple of minutes before publishing: filter policy changes can take up to 15 minutes to take full effect.
:::

:::cli
```bash
aws sns set-subscription-attributes --subscription-arn "$SUB_FUL" \
  --attribute-name FilterPolicy --attribute-value '{"status": ["placed"]}'

aws sns set-subscription-attributes --subscription-arn "$SUB_REF" \
  --attribute-name FilterPolicy --attribute-value '{"status": ["cancelled"]}'

aws sns get-subscription-attributes --subscription-arn "$SUB_FUL" \
  --query 'Attributes.[FilterPolicy, FilterPolicyScope]' --output text

sleep 120   # filter policies are eventually consistent (up to 15 minutes)
```
:::

> [!CHECK]
> The fulfilment subscription shows the filter policy `{"status": ["placed"]}` with scope `MessageAttributes`, the refunds subscription shows `cancelled`, and the analytics subscription has no filter policy.

### Step 5: Publish four orders with different statuses

The filter policies look at the **message attribute** `status`, not at the message body, so each publish must set that attribute.

:::console
1. In the SNS console choose **Topics** → `demo-orders-topic` → **Publish message**.
2. Under **Message body**, keep **Identical payload for all delivery protocols** and enter `{"order": 1036, "product": "pencil", "qty": 4}`.
3. Under **Message attributes**, set **Type** to **String**, **Name** to `status` and **Value** to `placed`. Choose **Publish message**.
4. Publish three more messages the same way, changing the body's order number and the attribute value: order 1037 with `cancelled`, order 1038 with `declined`, order 1039 with `placed`.
:::

:::cli
```bash
publish() {   # $1 = order number, $2 = status
  aws sns publish --topic-arn "$TOPIC_ARN" \
    --message "{\"order\": $1, \"product\": \"pencil\", \"qty\": 4}" \
    --message-attributes "{\"status\": {\"DataType\": \"String\", \"StringValue\": \"$2\"}}" \
    --query MessageId --output text
}

publish 1036 placed
publish 1037 cancelled
publish 1038 declined
publish 1039 placed
```
:::

> [!CHECK]
> Each publish succeeds and returns a message ID. The producer did not need to know which queues exist or what they want: that is the point of fan-out.

### Step 6: Check what each queue received

:::console
1. In the SQS console, open **Queues** and compare **Messages available**: fulfilment, refunds and analytics.
2. Open `demo-orders-analytics` → **Send and receive messages** → **Poll for messages**, and open one message. The body is a JSON **envelope** from SNS with fields such as `Type`, `MessageId`, `TopicArn`, `Message` (your original order JSON) and `MessageAttributes`.
:::

:::cli
```bash
for u in "$FUL_URL" "$REF_URL" "$ANA_URL"; do
  printf '%-30s %s\n' "${u##*/}" "$(aws sqs get-queue-attributes --queue-url "$u" \
    --attribute-names ApproximateNumberOfMessages \
    --query Attributes.ApproximateNumberOfMessages --output text)"
done

# Look at one delivered message: the SNS envelope
aws sqs receive-message --queue-url "$ANA_URL" > m.json
jq -r '.Messages[0].Body' m.json | jq '{Type, TopicArn, Message, MessageAttributes}'
```
:::

> [!CHECK]
> Fulfilment holds **2** messages (orders 1036 and 1039), refunds holds **1** (1037), and analytics holds **4**, including the declined order 1038 that no filtered subscriber wanted. If the filtered queues show 4 as well, the filter policies had not propagated yet: purge the queues, wait a few more minutes and publish again.

### Step 7 (optional): Add an email subscriber for cancelled orders

Subscribers do not have to be queues. A support team mailbox can get only the cancellations.

:::console
1. In the SNS console open `demo-orders-topic` and choose **Create subscription**.
2. For **Protocol**, choose **Email**; for **Endpoint**, enter your email address.
3. Expand **Subscription filter policy**, choose **attribute-based filtering** and enter `{"status": ["cancelled"]}` in the **JSON editor**. Choose **Create subscription**.
4. Open the confirmation email from AWS Notifications and choose the confirmation link. The subscription status changes from **Pending confirmation** to **Confirmed**.
5. Publish one message with the attribute `status` = `cancelled` and another with `placed`.
:::

:::cli
```bash
EMAIL="you@example.com"   # replace with your address
aws sns subscribe --topic-arn "$TOPIC_ARN" --protocol email \
  --notification-endpoint "$EMAIL" \
  --attributes '{"FilterPolicy": "{\"status\": [\"cancelled\"]}"}'

# Confirm the subscription from the email first, then:
publish 1040 cancelled
publish 1041 placed
```
:::

> [!CHECK]
> You receive one email, for order 1040 only. Until you click the confirmation link, the email subscription stays **Pending confirmation** and receives nothing.

### Step 8: Compare the envelope with raw message delivery

By default SQS subscribers receive the SNS JSON envelope. With **raw message delivery**, the queue receives only the original message body, and the SNS message attributes arrive as SQS message attributes.

:::console
1. Purge `demo-orders-fulfilment` (**Queues** → select it → **Actions** → **Purge** → enter `purge` → **Purge**) and wait a minute.
2. In the SNS console choose **Subscriptions**, select the fulfilment subscription, choose **Edit**, select **Enable raw message delivery** and choose **Save changes**.
3. Publish one more message with `status` = `placed` (for example order 1042).
4. Poll `demo-orders-fulfilment` and open the message: the body is now just `{"order": 1042, ...}`.
:::

:::cli
```bash
aws sqs purge-queue --queue-url "$FUL_URL"
sleep 60

aws sns set-subscription-attributes --subscription-arn "$SUB_FUL" \
  --attribute-name RawMessageDelivery --attribute-value true

publish 1042 placed
sleep 5

aws sqs receive-message --queue-url "$FUL_URL" --message-attribute-names All \
  --query 'Messages[0].[Body, MessageAttributes.status.StringValue]' --output text
```
:::

> [!CHECK]
> The body is exactly the JSON you published, with no `Type`, `TopicArn` or signature fields, and the `status` value appears as an SQS message attribute (`placed`). Raw delivery saves consumers from unwrapping the envelope.

## Cleanup

AWS recommends deleting a topic's subscriptions before the topic itself (deleting a topic removes its subscriptions only asynchronously). A subscription still **Pending confirmation** cannot be deleted; SNS removes it automatically after 48 hours.

- [ ] Delete the confirmed subscriptions of `demo-orders-topic`: the three SQS subscriptions and, if you did Step 7 and confirmed it, the email subscription (console: **Subscriptions** → select each → **Delete** → **Delete**; CLI below).

  ```bash
  for s in $(aws sns list-subscriptions-by-topic --topic-arn "$TOPIC_ARN" \
      --query 'Subscriptions[?SubscriptionArn!=`PendingConfirmation`].SubscriptionArn' \
      --output text); do
    aws sns unsubscribe --subscription-arn "$s"
  done
  ```

- [ ] Delete the SNS topic `demo-orders-topic` (console: **Topics** → select it → **Delete** → in the **Delete topic** dialog enter `delete me` → **Delete**; CLI: `aws sns delete-topic --topic-arn "$TOPIC_ARN"`).
- [ ] Delete the queue `demo-orders-fulfilment` (console: **Queues** → select → **Delete** → enter `delete` → **Delete**; CLI: `aws sqs delete-queue --queue-url "$FUL_URL"`).
- [ ] Delete the queue `demo-orders-refunds` (CLI: `aws sqs delete-queue --queue-url "$REF_URL"`).
- [ ] Delete the queue `demo-orders-analytics` (CLI: `aws sqs delete-queue --queue-url "$ANA_URL"`).
- [ ] Remove local helper files: `rm -f policy-attrs.json m.json`.
- [ ] Final check: `aws sns list-topics` no longer shows `demo-orders-topic`, the SNS **Subscriptions** page shows no subscriptions for it (an email subscription you never confirmed may linger until SNS removes it after 48 hours), and `aws sqs list-queues --queue-name-prefix demo-orders` returns nothing after about a minute.

## Progress checklist

- [ ] Step 1: SNS standard topic created
- [ ] Step 2: three SQS queues created
- [ ] Step 3: queues subscribed and access policies allow the topic
- [ ] Step 4: filter policies on the fulfilment and refunds subscriptions
- [ ] Step 5: four orders published with a status attribute
- [ ] Step 6: each queue received exactly the expected messages
- [ ] Step 7 (optional): email subscriber received only cancelled orders
- [ ] Step 8: compared the SNS envelope with raw message delivery
- [ ] Cleanup done
