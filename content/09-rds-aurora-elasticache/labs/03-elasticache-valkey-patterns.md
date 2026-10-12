---
id: 09-rds-aurora-elasticache-lab-03
title: Practise caching patterns and a leaderboard on ElastiCache Serverless for Valkey
objective: Create a private Valkey serverless cache, connect over TLS from an EC2 client, and try TTLs, lazy loading, write-through, a session store and a sorted-set leaderboard.
estimatedTime: 45 minutes
cost: "About USD 0.03 per hour in us-east-1: the serverless cache bills a minimum of 100 MB of data at USD 0.084 per GB-hour (about USD 0.0084 per hour) plus a negligible USD 0.0023 per million ECPUs, and the t3.micro client with its public IPv4 address adds about USD 0.016 per hour. Under USD 0.05 if you clean up within an hour. Free Tier credits (new accounts) can cover it; the legacy ElastiCache Free Tier applies only to node-based cache.t3.micro nodes."
freeTier: partial
services: [elasticache, ec2, security-groups]
---

> [!COST]
> ElastiCache Serverless for Valkey charges for data stored (minimum 100 MB per cache, USD 0.084 per GB-hour in us-east-1) and for ElastiCache Processing Units (USD 0.0023 per million ECPUs) from creation until deletion. This lab stays at the minimum, about USD 0.20 per day if forgotten. The EC2 client and its public IPv4 address are billed separately. Delete everything in **Cleanup** when you finish. The credit-based Free plan blocks some services, but not this one: AWS's Free Tier database page lists ElastiCache, including serverless caches, as usable with credits on both the Free and Paid plans, so either kind of new account can run this lab from its sign-up credits.

A cache only helps if the application uses it deliberately. In this lab you play the application yourself with `valkey-cli` and a tiny shell script, so you can watch a cache miss turn into a cache hit and see TTLs expire keys.

## Prerequisites

- An AWS account with permissions for Amazon ElastiCache and Amazon EC2 (for example `AmazonElastiCacheFullAccess` and `AmazonEC2FullAccess`).
- The EC2 client `demo-db-client` with security group `demo-client-sg` from **Lab 01, Step 1** (run that step again if you deleted them; you don't need the database security group here).
- For the CLI tabs: AWS CLI v2 or AWS CloudShell. In a new shell, look up the client security group:
  ```bash
  CLIENT_SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=demo-client-sg \
    --query 'SecurityGroups[0].GroupId' --output text)
  VPC_ID=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true \
    --query 'Vpcs[0].VpcId' --output text)
  ```
- Region `us-east-1` in the examples; any Region with ElastiCache Serverless works.

## Steps

### Step 1: Create a security group for the cache

Serverless Valkey caches listen on port 6379 (primary endpoint) and 6380 (reads from replicas). Allow both, but only from the client's security group.

:::console
1. In the **EC2** console, choose **Security Groups** → **Create security group**.
2. Name it `demo-cache-sg`, description `Valkey 6379-6380 from demo-client-sg`, default VPC.
3. Add an inbound rule: **Type** **Custom TCP**, **Port range** `6379-6380`, **Source** **Custom** → `demo-client-sg`. Choose **Create security group**.
:::

:::cli
```bash
CACHE_SG=$(aws ec2 create-security-group --group-name demo-cache-sg \
  --description "Valkey 6379-6380 from demo-client-sg" --vpc-id "$VPC_ID" \
  --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$CACHE_SG" \
  --protocol tcp --port 6379-6380 --source-group "$CLIENT_SG"
echo "Cache SG: $CACHE_SG"
```
:::

> [!CHECK]
> `demo-cache-sg` has one inbound rule for ports 6379–6380 whose source is `demo-client-sg`.

### Step 2: Create a Valkey serverless cache

:::console
1. Open the **ElastiCache** console and choose **Valkey caches** in the navigation pane, then **Create Valkey cache**.
2. Make sure the deployment option is **Serverless** and the connection type is the private **VPC** option (not public).
3. Enter `demo-valkey` as the **Name**.
4. Under **Default settings**, choose **Customize default settings**. In the **Connectivity** section keep **Network type** **IPv4** and the default VPC and subnets; for security groups, remove `default` and select `demo-cache-sg`.
5. Leave the other settings (engine version, usage limits, default user access) as they are and choose **Create**.
6. Wait until the status is available (a few minutes), open the cache, and copy the **Endpoint** from **Cache details**.
:::

:::cli
```bash
aws elasticache create-serverless-cache \
  --serverless-cache-name demo-valkey \
  --engine valkey \
  --security-group-ids "$CACHE_SG"

while [ "$(aws elasticache describe-serverless-caches --serverless-cache-name demo-valkey \
  --query 'ServerlessCaches[0].Status' --output text)" = "creating" ]; do sleep 15; done

CACHE_EP=$(aws elasticache describe-serverless-caches --serverless-cache-name demo-valkey \
  --query 'ServerlessCaches[0].Endpoint.Address' --output text)
echo "Cache endpoint: $CACHE_EP"
```
:::

> [!CHECK]
> The cache status is available, the engine is Valkey, and the endpoint contains `.serverless.` and ends in `.cache.amazonaws.com`. You never chose a node type or a number of shards: serverless sizes itself.

### Step 3: Install valkey-cli and connect over TLS

Open an **EC2 Instance Connect** terminal on `demo-db-client` (**EC2** → select the instance → **Connect** → **EC2 Instance Connect** → **Connect**).

:::console
1. Install the Valkey package, which includes a TLS-enabled `valkey-cli`:
   ```bash
   sudo dnf install -y valkey
   valkey-cli --version
   ```
   If the package isn't available on your AMI, use `sudo dnf install -y redis6` and type `redis6-cli` wherever this lab says `valkey-cli`.
2. Save the endpoint in a variable and connect. Serverless caches only accept TLS connections:
   ```bash
   export CACHE_EP=<your-cache-endpoint>
   valkey-cli -h "$CACHE_EP" --tls -p 6379
   ```
3. At the prompt, test the connection and a key with a TTL:
   ```text
   PING
   SET greeting "hello cache" EX 60
   GET greeting
   TTL greeting
   ```
4. Run `TTL greeting` again a few times, then type `quit`.
:::

:::cli
```bash
# Commands run on the EC2 client. Print the endpoint to paste there:
echo "$CACHE_EP"
```
:::

> [!CHECK]
> `PING` answers `PONG`, `GET greeting` returns the value, and `TTL greeting` counts down from 60. After 60 seconds `GET greeting` returns `(nil)`: the key expired by itself. Without `--tls` the connection fails, which is expected.

### Step 4: Simulate lazy loading (cache-aside)

This script behaves like an application: it asks the cache first and only "queries the database" (a deliberate 2-second delay) on a miss, then stores the result with a TTL.

:::console
1. Create the script on the EC2 client:
   ```bash
   cat > lazy.sh <<'EOF'
   #!/bin/bash
   # Lazy loading: read the cache, fall back to the "database" on a miss.
   KEY="product:$1"
   VALUE=$(valkey-cli -h "$CACHE_EP" --tls -p 6379 GET "$KEY")
   if [ -n "$VALUE" ]; then
     echo "HIT  $KEY -> $VALUE"
   else
     echo "MISS $KEY -> querying the slow database..."
     sleep 2
     VALUE="{\"id\":$1,\"name\":\"lamp\",\"price\":25}"
     valkey-cli -h "$CACHE_EP" --tls -p 6379 SET "$KEY" "$VALUE" EX 120 > /dev/null
     echo "     cached for 120 s -> $VALUE"
   fi
   EOF
   chmod +x lazy.sh
   ```
2. Run it twice and compare the timings:
   ```bash
   time ./lazy.sh 42
   time ./lazy.sh 42
   ```
:::

:::cli
```bash
# No AWS CLI equivalent: this step exercises the application pattern on the client.
aws elasticache describe-serverless-caches --serverless-cache-name demo-valkey \
  --query 'ServerlessCaches[0].{Status:Status,Engine:Engine,Version:FullEngineVersion}'
```
:::

> [!CHECK]
> The first run prints **MISS** and takes a little over 2 seconds; the second prints **HIT** and finishes in a small fraction of a second, most of it spent opening a fresh TLS connection for each `valkey-cli` call (the lookup itself takes well under a millisecond). That gap is why caches cut database load. The data can now go stale for up to 120 seconds if the "database" changes.

### Step 5: Add write-through to avoid stale data

When the price changes, the application updates the database *and* the cache in the same code path.

:::console
1. Simulate a price update that writes through to the cache, then read with the lazy-loading script:
   ```bash
   # 1) UPDATE products SET price = 20 WHERE id = 42;   (database write, simulated)
   # 2) write the same new value to the cache
   valkey-cli -h "$CACHE_EP" --tls -p 6379 SET product:42 '{"id":42,"name":"lamp","price":20}' EX 120
   ./lazy.sh 42
   ```
:::

:::cli
```bash
# No AWS CLI equivalent: write-through is application logic.
echo "Run the commands in the console tab on the EC2 client."
```
:::

> [!CHECK]
> The script reports a **HIT** with price 20 right away. With lazy loading alone, readers would have seen price 25 until the TTL expired.

### Step 6: Use the cache as a session store

:::console
1. Connect again with `valkey-cli -h "$CACHE_EP" --tls -p 6379` and store a session as a hash with a 30-minute TTL:
   ```text
   HSET session:7f3a user alice role customer cart_items 3
   EXPIRE session:7f3a 1800
   HGETALL session:7f3a
   TTL session:7f3a
   ```
2. Imagine a second web server receiving this user's next request: it reads the same key and finds the user logged in. Type `quit` when done.
:::

:::cli
```bash
# No AWS CLI equivalent: session handling is application logic.
echo "Run the commands in the console tab on the EC2 client."
```
:::

> [!CHECK]
> `HGETALL` returns the user, role and cart fields, and `TTL` shows about 1800 seconds. Any server that can reach the cache can read the session, so the web tier stays stateless.

### Step 7: Build a real-time leaderboard with a sorted set

:::console
1. In `valkey-cli`, add players and update scores:
   ```text
   ZADD leaderboard 1500 alice 1320 bob 1710 carol 990 dave
   ZREVRANGE leaderboard 0 2 WITHSCORES
   ZINCRBY leaderboard 450 bob
   ZREVRANGE leaderboard 0 2 WITHSCORES
   ZREVRANK leaderboard alice
   ZSCORE leaderboard bob
   ```
2. Type `quit`.
:::

:::cli
```bash
# No AWS CLI equivalent: sorted-set commands run with valkey-cli on the client.
echo "Run the commands in the console tab on the EC2 client."
```
:::

> [!CHECK]
> The first top-3 list is carol, alice, bob. After `ZINCRBY` adds 450 to bob (1770), bob jumps to first place immediately, and `ZREVRANK leaderboard alice` returns `2` (ranks start at 0). No sorting query was needed: the sorted set keeps members ordered as scores change.

## Cleanup

- [ ] Delete the serverless cache `demo-valkey`: **ElastiCache** → **Valkey caches** → select it → **Actions** → **Delete**; don't create a final backup, confirm, and wait until it disappears from the list.
- [ ] Delete security group `demo-cache-sg` after the cache is fully deleted.
- [ ] Terminate the EC2 client `demo-db-client` if you have finished all labs: **Instances** → **Instance state** → **Terminate (delete) instance**.
- [ ] Delete security group `demo-db-sg` if it still exists from Labs 01–02, then `demo-client-sg`.

:::cli
```bash
aws elasticache delete-serverless-cache --serverless-cache-name demo-valkey
while aws elasticache describe-serverless-caches --serverless-cache-name demo-valkey \
  > /dev/null 2>&1; do sleep 15; done
aws ec2 delete-security-group --group-id "$CACHE_SG"

# If you have finished all the labs in this section:
INSTANCE_ID=$(aws ec2 describe-instances \
  --filters Name=tag:Name,Values=demo-db-client Name=instance-state-name,Values=running \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)
aws ec2 terminate-instances --instance-ids "$INSTANCE_ID"
aws ec2 wait instance-terminated --instance-ids "$INSTANCE_ID"
aws ec2 delete-security-group --group-name demo-db-sg 2>/dev/null
aws ec2 delete-security-group --group-name demo-client-sg
```
:::

> [!CHECK]
> Final check: **ElastiCache** → **Valkey caches** is empty, no `demo-*` security groups remain, and no `demo-db-client` instance is running in the Region. Check **Billing and Cost Management** → **Bills** the next day.

## Progress checklist

- [ ] Step 1: Cache security group created
- [ ] Step 2: Valkey serverless cache created
- [ ] Step 3: Connected over TLS and watched a TTL expire
- [ ] Step 4: Saw a cache miss become a cache hit with lazy loading
- [ ] Step 5: Used write-through to update a cached value
- [ ] Step 6: Stored a session hash with a TTL
- [ ] Step 7: Built and updated a sorted-set leaderboard
- [ ] Cleanup done
