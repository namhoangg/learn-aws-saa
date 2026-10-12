---
id: 18-kinesis-mq-lab-03
title: Run a managed ActiveMQ broker with Amazon MQ
objective: Create a single-instance Amazon MQ for ActiveMQ broker, open its web console from your IP only, and compare queue and topic behaviour while noting the open-protocol endpoints that make Amazon MQ a migration target.
estimatedTime: 50 minutes (about 15 of them waiting for the broker)
cost: "About USD 0.03 per hour in us-east-1 for an mq.t3.micro single-instance broker (USD 0.02704 per hour) plus EFS-backed broker storage at USD 0.30 per GB-month for a few MB. Accounts on the legacy Free Tier get 750 hours of single-instance mq.t3.micro and 5 GB of EFS storage per month for 12 months; accounts created on or after 15 July 2025 pay from their Free Tier credits."
freeTier: partial
services: [amazon-mq, security-groups, vpc, efs, cloudshell]
---

> [!COST]
> An Amazon MQ broker is billed per broker-hour from creation until deletion, even when idle: `mq.t3.micro` single-instance costs USD 0.02704 per hour in us-east-1 (about USD 20 a month if forgotten), plus a few cents of storage. An active/standby pair would double the instance charge. Delete the broker as soon as you finish; deletion itself takes several minutes.

The point of this lab is not message throughput; it is to see what "a managed broker" means: you pick an engine, instance type and deployment mode, AWS builds and runs the server, and you get endpoints for standard protocols such as OpenWire, AMQP, STOMP, MQTT and WebSocket.

## Prerequisites

- An AWS account with permissions for Amazon MQ and EC2 security groups (for a sandbox, `AmazonMQFullAccess` and `AmazonEC2FullAccess`).
- The **default VPC** in your Region (it already has DNS support and DNS hostnames enabled, which Amazon MQ needs).
- Your computer's **public IP address**: open `https://checkip.amazonaws.com` **in the browser you will use for the web console**. Do not use the IP that CloudShell reports; CloudShell runs on AWS with a different address.
- AWS CloudShell in the same Region for the CLI tabs. Set these variables first (replace the IP with yours):

```bash
MY_IP="203.0.113.25"   # your browser's public IP from checkip.amazonaws.com
VPC_ID=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)
SUBNET_ID=$(aws ec2 describe-subnets --filters Name=vpc-id,Values="$VPC_ID" Name=default-for-az,Values=true \
  --query 'Subnets[0].SubnetId' --output text)
echo "$VPC_ID $SUBNET_ID"
```

## Steps

### Step 1: Create a security group that admits only your IP to the web console

The ActiveMQ web console listens on port **8162**. You will open only that port, only to your address.

:::console
1. Open the **EC2** console → **Security Groups** → **Create security group**.
2. **Security group name**: `demo-mq-sg`; **Description**: `Amazon MQ lab - web console from my IP`; **VPC**: the default VPC.
3. Under **Inbound rules** choose **Add rule**: **Type** `Custom TCP`, **Port range** `8162`, **Source** `My IP` (or a custom `/32` with your browser's IP).
4. Choose **Create security group**.
:::

:::cli
```bash
SG_ID=$(aws ec2 create-security-group --group-name demo-mq-sg \
  --description "Amazon MQ lab - web console from my IP" --vpc-id "$VPC_ID" \
  --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$SG_ID" \
  --protocol tcp --port 8162 --cidr "$MY_IP/32"
echo "$SG_ID"
```
:::

> [!CHECK]
> `demo-mq-sg` exists in the default VPC with exactly one inbound rule: TCP 8162 from your `/32` address.

### Step 2: Create a single-instance ActiveMQ broker

Choose a broker username and a password of your own (at least 12 characters, at least 4 different characters, no commas, colons or equals signs). Do not reuse a password from any other account.

> [!VERIFY] Label of the public-access choice in the create-broker wizard
> Checked on 2026-10-04. AWS's [private broker page](https://docs.aws.amazon.com/amazon-mq/latest/developer-guide/configuring-private-broker.html) names the **Network settings** section, the **Private access** choice and the two VPC options used in item 6, and the [troubleshooting page](https://docs.aws.amazon.com/amazon-mq/latest/developer-guide/general.html) calls the resulting broker setting **Public Accessibility** (Yes or No). No current AWS page shows the exact wording of the public choice itself, and the older wizard page that used "Network and security" now redirects to the guide's home page. Pick whichever option makes the broker reachable from the internet; after creation, running `aws mq describe-broker --broker-id <your broker ID> --query PubliclyAccessible` in CloudShell should print `true`. If it prints `false`, delete the broker and create it again with public access.

:::console
1. Open the **Amazon MQ** console and start creating a broker.
2. On the **Select broker engine** page choose **Apache ActiveMQ**, then **Next**.
3. On the **Select deployment and storage** page, for **Deployment mode** choose **Single-instance broker**, keep the Amazon EFS storage option (the only one `mq.t3.micro` supports), then **Next**.
4. On the **Configure settings** page, enter **Broker name** `demo-activemq` and choose **Broker instance type** `mq.t3.micro`.
5. In **ActiveMQ Web Console access**, enter your **Username** and **Password**.
6. Expand **Additional settings** and keep the latest engine version. In **Network settings**, choose the public option rather than **Private access**, then choose **Select existing VPC, subnet(s), and security group(s)**: keep the default VPC and one of its default subnets, and pick `demo-mq-sg` as the only security group.
7. Choose **Deploy** (the button that creates the broker). The status shows **Creation in progress** for about 15 minutes, then **Running**.
:::

:::cli
```bash
read -r -p "Broker username: " MQ_USER
read -r -s -p "Broker password (12+ chars, no , : =): " MQ_PASSWORD; echo
BROKER_ID=$(aws mq create-broker --broker-name demo-activemq \
  --engine-type ACTIVEMQ --host-instance-type mq.t3.micro \
  --deployment-mode SINGLE_INSTANCE --storage-type EFS \
  --publicly-accessible --auto-minor-version-upgrade \
  --subnet-ids "$SUBNET_ID" --security-groups "$SG_ID" \
  --users "Username=$MQ_USER,Password=$MQ_PASSWORD,ConsoleAccess=true" \
  --query BrokerId --output text)
unset MQ_PASSWORD
echo "$BROKER_ID"

until [ "$(aws mq describe-broker --broker-id "$BROKER_ID" --query BrokerState --output text)" = "RUNNING" ]; do
  echo "$(date -u +%H:%M:%S) still creating..."; sleep 60
done; echo "broker is RUNNING"
```
:::

> [!TIP] If creation fails
> If the broker fails to create with a message that the instance type is not supported in the Availability Zone, choose a subnet in a different AZ (CLI: change `Subnets[0]` to `Subnets[1]` in the prerequisites) and try again.

> [!CHECK]
> After roughly 15 minutes the broker status is **Running**, engine **ActiveMQ** with a 5.x version, deployment mode single-instance and instance type `mq.t3.micro`. You did not install, patch or configure any server: that is the managed part.

### Step 3: Look at the endpoints

:::console
1. Choose `demo-activemq` in the broker list.
2. In the **Connections** section, note the **ActiveMQ Web Console** URL (port 8162) and the list of wire-level endpoints.
3. In the **Details** section, under **Security and network**, confirm the security group is `demo-mq-sg`.
:::

:::cli
```bash
aws mq describe-broker --broker-id "$BROKER_ID" \
  --query '{state:BrokerState,version:EngineVersion,console:BrokerInstances[0].ConsoleURL,endpoints:BrokerInstances[0].Endpoints}'
```
:::

> [!CHECK]
> You see one endpoint per protocol: `ssl://...:61617` (OpenWire), `amqp+ssl://...:5671` (AMQP), `stomp+ssl://...:61614` (STOMP), `mqtt+ssl://...:8883` (MQTT) and `wss://...:61619` (WebSocket). An on-premises app that already speaks one of these only needs its connection URL changed, which is why Amazon MQ is the exam answer for "migrate without rewriting messaging code". Only port 8162 is open in the security group, so these endpoints are unreachable from the internet for now.

### Step 4: Send and browse a queue message in the web console

> [!NOTE] The web console comes from Apache, not AWS
> Amazon MQ gives you the stock web console of the open-source Apache ActiveMQ Classic engine; AWS's own docs point to Apache's Web Console page for it. The labels below (Queues, Send To, Browse) are therefore Apache's, not AWS console labels, and can differ a little between engine versions.

:::console
1. Open the **ActiveMQ Web Console** URL from Step 3 in the browser whose IP you allowed, and sign in with your broker username and password.
2. Choose **Manage ActiveMQ broker**, then the **Queues** tab.
3. In the queue name box enter `orders` and choose **Create**.
4. In the `orders` row choose **Send To**. Type a message body such as `{"orderId": 1001, "item": "book"}` and choose **Send**.
5. Back on **Queues**, choose **Browse** for `orders` and open the message.
:::

> [!CHECK]
> The `orders` queue shows **1** pending message, and browsing displays your JSON body. The message stays on the queue until a consumer receives it, just as it would in an SQS queue.

### Step 5: Compare with a topic

:::console
1. Open the **Topics** tab, enter `price-updates` and choose **Create**.
2. Choose **Send To** for `price-updates`, send a short message body, and return to **Topics**.
3. Note the enqueued and dequeued counters and that there is nothing to browse.
:::

> [!CHECK]
> The topic accepted the message, but with no subscriber connected nobody received it and it was not kept. Topics are publish/subscribe, like SNS: subscribers get a copy only if they are listening when the message is published. Queues, like SQS, keep messages until someone consumes them.

## Cleanup

- [ ] **Broker `demo-activemq`** (its EFS-backed storage and messages are deleted with it): Amazon MQ console → select the broker → **Delete**, type the confirmation and confirm. CLI: `aws mq delete-broker --broker-id "$BROKER_ID"`. Wait until it disappears from the list (`aws mq list-brokers --query 'BrokerSummaries[].BrokerName'` no longer shows it); this can take several minutes.
- [ ] **Security group `demo-mq-sg`**, after the broker is fully deleted (its network interface must be gone first): EC2 console → **Security Groups** → select → **Actions** → **Delete security groups**. CLI: `aws ec2 delete-security-group --group-id "$SG_ID"` (retry after a few minutes if you get a `DependencyViolation` error).
- [ ] **CloudWatch log groups** only if you turned on broker logs in the wizard (look for log groups whose names contain `amazonmq` and your broker ID): CloudWatch → **Log groups** → select → **Actions** → **Delete log group(s)**.
- [ ] **Final check**: `aws mq list-brokers` returns no brokers in this Region, and the next day **Billing and Cost Management** → **Bills** shows no new Amazon MQ usage after today.

## Progress checklist

- [ ] Step 1: Created `demo-mq-sg` allowing TCP 8162 from my IP only
- [ ] Step 2: Created the `mq.t3.micro` single-instance ActiveMQ broker and saw it reach Running
- [ ] Step 3: Identified the OpenWire, AMQP, STOMP, MQTT and WebSocket endpoints
- [ ] Step 4: Created the `orders` queue, sent a message and browsed it
- [ ] Step 5: Saw that a topic does not keep messages without subscribers
- [ ] Cleanup done: broker and security group deleted
