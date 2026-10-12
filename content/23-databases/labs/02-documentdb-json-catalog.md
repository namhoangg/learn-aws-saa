---
id: 23-databases-lab-02
title: Store and query JSON documents in Amazon DocumentDB
objective: Create a one-instance Amazon DocumentDB cluster, connect to it from AWS CloudShell with one click, insert and query MongoDB-style documents with nested fields, and see the Aurora-like cluster design (cluster endpoint, reader endpoint, shared storage, continuous backups).
estimatedTime: 45 minutes (about 15 of them waiting for the cluster)
cost: "About USD 0.10 if deleted within an hour in us-east-1: one db.t3.medium instance at USD 0.078 per hour, plus a few cents of I/O and storage. First-time DocumentDB users get a 30-day free trial (750 hours of db.t3.medium, 30 million I/Os, 5 GB storage, 5 GB backup storage); otherwise the charge is billed or drawn from Free Tier credits. CloudShell has no extra charge."
freeTier: partial
services: [documentdb, cloudshell, vpc, security-groups, kms]
---

> [!COST]
> A DocumentDB instance is billed per second (10-minute minimum) from creation until deletion, even when idle, plus I/O requests and storage. A `db.t3.medium` with Standard storage costs USD 0.078 per hour in us-east-1 (AWS Price List, September 2026; check the pricing page for other Regions), which is about USD 57 a month if forgotten, and T3/T4g instances run in unlimited mode, so they add CPU-credit charges (USD 0.09 per vCPU-hour) if they run hot. The 30-day free trial covers this lab for accounts that have never used DocumentDB; on the credit-based Free plan, anything outside the trial is drawn from your credits. Delete the cluster at the end of the session.

The point of this lab is to feel what "MongoDB-compatible, Aurora-style" means: you use the MongoDB shell and query language, while AWS runs a cluster whose data lives in a shared volume replicated six ways across three AZs.

## Prerequisites

- An AWS account and an IAM principal with `AmazonDocDBFullAccess` plus permissions to use CloudShell VPC environments (for a sandbox, `AWSCloudShellFullAccess`; the connection feature also needs to describe the VPC and create a network interface).
- The **default VPC** in your Region, for example **US East (N. Virginia) us-east-1**.
- A primary username and a password of your own for the cluster: 8 to 100 printable characters, without `/`, `"` or `@`. Do not reuse a password from any other account.

## Steps

### Step 1: Create an instance-based cluster with one instance

:::console
1. Open the **Amazon DocumentDB** console. Under **Clusters**, choose **Create**.
2. In **Cluster type**, keep **Instance-based cluster**.
3. In **Cluster configuration**, enter **Cluster identifier** `demo-docdb` and choose **Engine version** `5.0.0`.
4. In **Cluster storage configuration**, keep **Amazon DocumentDB Standard**.
5. In **Instance configuration**, keep **Memory optimized classes (include r classes)**, choose **Instance class** `db.t3.medium` and set **Number of instances** to **1** (production would use three, one per AZ).
6. In **Connectivity**, keep **Don't connect to an EC2 compute resource**.
7. In **Authentication**, enter your primary username, choose **Self managed** and enter and confirm your password.
8. Leave everything else at the defaults and choose **Create cluster**. Wait until the cluster and its instance show **Available** (about 10 to 15 minutes).
:::

:::cli
```bash
read -r -p "Primary username: " DOCDB_USER
read -r -s -p "Primary password (8-100 chars, no / \" @): " DOCDB_PASSWORD; echo

# --storage-encrypted matches the console default; the CLI leaves encryption at rest off otherwise
aws docdb create-db-cluster --db-cluster-identifier demo-docdb \
  --engine docdb --engine-version 5.0.0 --storage-encrypted \
  --master-username "$DOCDB_USER" --master-user-password "$DOCDB_PASSWORD"
unset DOCDB_PASSWORD

aws docdb create-db-instance --db-instance-identifier demo-docdb-1 \
  --db-instance-class db.t3.medium --engine docdb --db-cluster-identifier demo-docdb

aws docdb wait db-instance-available --db-instance-identifier demo-docdb-1 && echo "instance is available"
```
:::

> [!CHECK]
> The cluster `demo-docdb` shows status **Available** with one instance under it whose role is **Primary**. You chose an instance class and count, but no disk size: storage grows on its own in 10 GB steps.

> [!NOTE] Console and CLI defaults differ
> A cluster created in the console has **deletion protection** turned on; one created with the CLI does not. Cleanup covers both cases.

### Step 2: Read the cluster's architecture from its details

:::console
1. Choose the cluster name `demo-docdb`.
2. Open the **Configuration** tab. In the **Configurations and status** section, note the **Cluster endpoint** and the **Reader endpoint**.
3. On the same tab, find **Deletion protection** in the **Cluster details** section and note whether it is enabled.
4. Open the **Connectivity & security** tab to see the ready-made connection strings for the `mongo` shell and for application code.
:::

:::cli
```bash
aws docdb describe-db-clusters --db-cluster-identifier demo-docdb \
  --query 'DBClusters[0].{Writer:Endpoint,Reader:ReaderEndpoint,Port:Port,AZs:AvailabilityZones,Members:DBClusterMembers[].DBInstanceIdentifier,Encrypted:StorageEncrypted,Backups:BackupRetentionPeriod,DeletionProtection:DeletionProtection}'
```
:::

> [!CHECK]
> There are two DNS names: the **cluster endpoint** (contains `.cluster-`) always points to the primary for writes, and the **reader endpoint** (contains `.cluster-ro-`) spreads reads over replicas. With one instance both reach the same node, but an app written against them needs no change when you add up to 15 replicas. The cluster lists three Availability Zones even though you run one instance, because the storage volume lives in all three. The port is **27017**, the MongoDB default, and `Encrypted` is `true` (encryption at rest with the AWS managed KMS key; it can only be chosen when the cluster is created).

### Step 3: Connect from CloudShell with one click

:::console
1. In **Clusters**, select the check box next to `demo-docdb` (the cluster and its instance must both be **Available**).
2. Choose **Connect to cluster** (next to **Actions**). The CloudShell **Run command** screen opens.
3. In **New environment name**, enter `docdb-lab` and choose **Create and run**. CloudShell creates a VPC environment in the cluster's VPC and installs the MongoDB shell.
4. When prompted, enter the cluster password from Step 1.
:::

> [!NOTE] Console-only shortcut
> There is no single CLI command for this step: the console builds the CloudShell VPC environment and connection string for you. Without it you would create a CloudShell VPC environment (or an EC2 instance) in the same VPC, allow port 27017 in the cluster's security group, download the TLS certificate bundle and run `mongosh` yourself.

> [!CHECK]
> The prompt changes to something like `rs0 [direct: primary] test>`. You are talking to DocumentDB through the regular MongoDB shell; the cluster has no public endpoint, which is why the shell had to run inside the VPC.

### Step 4: Insert and query documents

Paste these commands at the `mongosh` prompt. Notice that the documents do not share an identical schema and contain nested objects and arrays.

```javascript
use catalog

db.products.insertMany([
  { _id: 1, name: "Trail running shoe", brand: "Northpeak", price: 129, tags: ["running", "outdoor"], stock: { warehouse: "east", qty: 42 } },
  { _id: 2, name: "Rain jacket", brand: "Northpeak", price: 189, tags: ["outdoor", "waterproof"], stock: { warehouse: "west", qty: 7 }, colors: ["red", "navy"] },
  { _id: 3, name: "Yoga mat", brand: "Calmform", price: 39, tags: ["fitness"], stock: { warehouse: "east", qty: 120 } }
])

// Match a value inside an array
db.products.find({ tags: "outdoor" }, { name: 1, price: 1 })

// Query a nested field and project only some fields
db.products.find({ "stock.qty": { $lt: 10 } }, { name: 1, "stock.qty": 1 })

// Update in place: change a field and append to an array
db.products.updateOne({ _id: 3 }, { $set: { price: 35 }, $push: { tags: "sale" } })
db.products.findOne({ _id: 3 })

// Secondary index on any field, then an aggregation
db.products.createIndex({ brand: 1 })
db.products.aggregate([ { $group: { _id: "$brand", avgPrice: { $avg: "$price" }, items: { $sum: 1 } } } ])
```

> [!CHECK]
> `insertMany` reports three inserted IDs. The `tags` query returns the shoe and the jacket, the nested `stock.qty` query returns only the jacket, the updated yoga mat shows `price: 35` with `"sale"` in its tags, and the aggregation returns one row per brand (Northpeak with an average of 159 over 2 items, Calmform with 35). Only the jacket has a `colors` field, and nothing complained: that schema flexibility is why document databases suit fast-changing catalogs.

Type `exit` to leave the shell.

### Step 5: Look at continuous backups

:::cli
```bash
aws docdb describe-db-clusters --db-cluster-identifier demo-docdb \
  --query 'DBClusters[0].{RetentionDays:BackupRetentionPeriod,EarliestRestorable:EarliestRestorableTime,LatestRestorable:LatestRestorableTime}'
```
:::

> [!CHECK]
> Automated backups are already on: `RetentionDays` shows the retention period (1 day is the CLI default; any value from 1 to 35 days is allowed). `LatestRestorableTime` is only a few minutes old: DocumentDB backs up continuously, so you could restore a **new** cluster to any second inside the retention window. This is the same point-in-time recovery model as RDS and Aurora.

## Cleanup

Delete in this order. The instance and cluster keep billing until the last step finishes.

- [ ] **CloudShell VPC environment `docdb-lab`**: in CloudShell, switch to the `docdb-lab` tab, choose **Actions** → **Delete**, and confirm.
- [ ] **Deletion protection** (console-created clusters only): **Clusters** → select `demo-docdb` → **Actions** → **Modify** → clear **Deletion protection** → **Continue** → choose to apply immediately → **Modify cluster**. CLI: `aws docdb modify-db-cluster --db-cluster-identifier demo-docdb --no-deletion-protection --apply-immediately`.
- [ ] **Instance `demo-docdb-1` and cluster `demo-docdb`**: console: **Clusters** → select the **instance** under the cluster → **Actions** → **Delete** → for **Create final cluster snapshot?** choose **No** → type `delete entire cluster` → **Delete** (deleting the last instance deletes the cluster and its automated backups). CLI:

  ```bash
  aws docdb delete-db-instance --db-instance-identifier demo-docdb-1
  aws docdb wait db-instance-deleted --db-instance-identifier demo-docdb-1
  aws docdb delete-db-cluster --db-cluster-identifier demo-docdb --skip-final-snapshot
  ```

- [ ] **Manual or final snapshots**, only if you created one: **Snapshots** → select it → **Actions** → **Delete**. CLI: `aws docdb delete-db-cluster-snapshot --db-cluster-snapshot-identifier <name>`.
- [ ] **Security groups, rules and network interface left by the CloudShell connection**: the [launch announcement](https://aws.amazon.com/about-aws/whats-new/2025/02/amazon-documentdb-one-click-connectivity-cloudshell) says **Connect to cluster** sets up the VPC, security groups and ingress rules for you, and the [getting-started guide](https://docs.aws.amazon.com/documentdb/latest/devguide/get-started-guide.html) only says the VPC environment details are configured automatically. Neither page, nor the [CloudShell VPC guide](https://docs.aws.amazon.com/cloudshell/latest/userguide/using-cshell-in-vpc.html), names those groups or says whether deleting the environment removes them {{verify: Checked 2026-10-04 - AWS does not document the names of the security groups or rules that Connect to cluster creates, or whether deleting the CloudShell VPC environment removes them}}. The [CloudShell troubleshooting guide](https://docs.aws.amazon.com/cloudshell/latest/userguide/troubleshooting.html) adds that the environment's network interface is tagged `ManagedByCloudShell` and is only cleaned up if your role may call `ec2:DeleteNetworkInterface`. So, once the CloudShell environment and the cluster are gone, check the default VPC yourself: in the **EC2** console → **Security Groups**, delete any group that appeared during the lab (check each group's name and description) and any inbound rule on port 27017 added to an existing group; under **Network Interfaces**, delete any interface tagged `ManagedByCloudShell` that is still listed as **Available**. Never delete the VPC's `default` security group itself.
- [ ] **Final check**: `aws docdb describe-db-clusters --query 'DBClusters[].DBClusterIdentifier'` no longer lists `demo-docdb` (deletion takes several minutes), and the next day **Billing and Cost Management** → **Bills** shows no new DocumentDB instance hours.

## Progress checklist

- [ ] Step 1: Created the `demo-docdb` cluster with one `db.t3.medium` instance
- [ ] Step 2: Identified the cluster endpoint, reader endpoint, port 27017 and three AZs
- [ ] Step 3: Connected from CloudShell with **Connect to cluster**
- [ ] Step 4: Inserted, queried, updated, indexed and aggregated JSON documents
- [ ] Step 5: Confirmed continuous backups and the restorable time window
- [ ] Cleanup done: CloudShell environment, instance, cluster and any snapshots deleted
