---
id: 09-rds-aurora-elasticache-lab-02
title: Explore Aurora endpoints, failover and cloning with Aurora Serverless
objective: Build an Aurora MySQL cluster with serverless writer and reader instances, see how the cluster and reader endpoints route connections, trigger a failover, and create a copy-on-write clone for testing.
estimatedTime: 75 minutes
cost: "About USD 0.15–0.30 per hour in us-east-1 while the serverless instances are active (USD 0.12 per ACU-hour, two to three instances at 0.5–1 ACU each), plus a few cents for the EC2 client and storage; roughly USD 0.40–0.60 for the whole lab if you clean up promptly. Sign-up credits can cover it on a paid-plan account, but Free plan accounts can't run this lab (they only get Aurora PostgreSQL express-configuration clusters, at most 2 instances); there is no always-free Aurora allowance."
freeTier: partial
services: [aurora, aurora-serverless, ec2, security-groups]
---

> [!COST]
> Aurora Serverless bills each serverless instance per second for the ACUs it uses: USD 0.12 per ACU-hour with Aurora Standard storage in us-east-1. Two instances idling at about 0.5 ACU each cost roughly USD 0.12 per hour, and the clone in Step 6 adds another instance. Storage (USD 0.10 per GB-month) and I/O (USD 0.20 per million requests) are negligible here. This lab sets the minimum capacity to **0 ACUs**, so idle instances pause after 10 minutes and stop billing compute, but storage is billed until you delete the cluster itself (deleting its instances is not enough). Do the **Cleanup** section when you finish.
>
> Accounts on the credit-based **Free plan** can't do this lab: on that plan Aurora is limited to Aurora PostgreSQL clusters created with the express configuration (up to 4 ACUs, 1 GB of storage, 2 clusters and 2 instances per account), while this lab uses Aurora MySQL with the full configuration and three instances. Paid-plan accounts receive the same sign-up credits and can use them to offset this usage.

Aurora's endpoints and shared storage are easier to understand once you see them answer queries. You will ask each connection which instance served it (`@@aurora_server_id`) and whether it is read-only (`@@innodb_read_only`).

## Prerequisites

- An AWS account with permissions for Amazon RDS (Aurora) and Amazon EC2.
- The EC2 client `demo-db-client` and the security groups `demo-client-sg` and `demo-db-sg` from **Lab 01, Step 1** (create them again with that step if you deleted them). `demo-db-sg` allows port 3306, which Aurora MySQL also uses.
- The MySQL client installed on the EC2 client (`sudo dnf install -y mariadb105`).
- For the CLI tabs: AWS CLI v2 or AWS CloudShell, with the variables from Lab 01 Step 1 set again if this is a new shell:
  ```bash
  DB_SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=demo-db-sg \
    --query 'SecurityGroups[0].GroupId' --output text)
  ```
- Region `us-east-1` in the examples; any Region with Aurora Serverless works.

## Steps

### Step 1: Create an Aurora MySQL cluster with a serverless writer

:::console
1. Open the **RDS** console → **Databases** → **Create database** → **Standard create**.
2. For **Engine type** choose **Aurora (MySQL Compatible)** and keep the default version.
3. Under **Templates** choose **Dev/Test**.
4. Under **Settings**, enter `demo-aurora` as **DB cluster identifier**, keep `admin` as **Master username**, choose **Self managed** credentials and set a password.
5. For **Cluster storage configuration** choose **Aurora Standard**.
6. Under **Instance configuration**, for **DB instance class** choose **Serverless v2** (newer consoles may label it **Serverless**). Set the capacity range to a minimum of **0** ACUs and a maximum of **2** ACUs, and set the idle time before pausing to 10 minutes.
7. Under **Availability & durability**, don't create an Aurora Replica yet; you will add a reader in Step 3.
8. Under **Connectivity**, choose **Don't connect to an EC2 compute resource**, keep the default VPC, set **Public access** to **No**, and choose the existing security group `demo-db-sg` (remove `default`).
9. Expand **Additional configuration**: **Initial database name** `shop`, **Backup retention period** 1 day, keep encryption enabled, clear **Enable deletion protection**.
10. Choose **Create database** and wait until the writer instance is **Available** (about 10 minutes).
:::

:::cli
```bash
read -rsp "Choose a master password (8-41 chars, no / ' \" @ or spaces): " DB_PASS; echo

aws rds create-db-cluster \
  --db-cluster-identifier demo-aurora \
  --engine aurora-mysql \
  --master-username admin --master-user-password "$DB_PASS" \
  --vpc-security-group-ids "$DB_SG" \
  --database-name shop \
  --storage-encrypted \
  --backup-retention-period 1 \
  --serverless-v2-scaling-configuration MinCapacity=0,MaxCapacity=2,SecondsUntilAutoPause=600

aws rds create-db-instance \
  --db-instance-identifier demo-aurora-writer \
  --db-cluster-identifier demo-aurora \
  --engine aurora-mysql \
  --db-instance-class db.serverless

aws rds wait db-instance-available --db-instance-identifier demo-aurora-writer
aws rds describe-db-clusters --db-cluster-identifier demo-aurora \
  --query 'DBClusters[0].{Writer:Endpoint,Reader:ReaderEndpoint,Status:Status}'
```
If the cluster command rejects `MinCapacity=0`, your Region's default engine version predates auto-pause (it needs Aurora MySQL 3.08 or later); use `MinCapacity=0.5` and drop `SecondsUntilAutoPause`.
:::

> [!CHECK]
> On the cluster's **Connectivity & security** tab you see two endpoints: a **Writer** endpoint containing `.cluster-` and a **Reader** endpoint containing `.cluster-ro-`. The **Configuration** tab shows the capacity range 0–2 ACUs.

### Step 2: Connect through the cluster (writer) endpoint

In the EC2 Instance Connect terminal on `demo-db-client`:

:::console
1. Connect with the **Writer** endpoint (the first connection after an idle pause can take about 15 seconds while the instance resumes):
   ```bash
   mysql -h <writer-endpoint> -P 3306 -u admin -p
   ```
2. Ask which instance answered and whether it is read-only, then create data:
   ```sql
   SELECT @@aurora_server_id, @@innodb_read_only;
   USE shop;
   CREATE TABLE products (id INT PRIMARY KEY, name VARCHAR(50), price DECIMAL(8,2));
   INSERT INTO products VALUES (1,'lamp',25.00),(2,'desk',180.00),(3,'chair',95.00);
   SELECT * FROM products;
   ```
3. Type `exit`.
:::

:::cli
```bash
# Queries run in the EC2 Instance Connect terminal; print the endpoints to paste there:
aws rds describe-db-clusters --db-cluster-identifier demo-aurora \
  --query 'DBClusters[0].[Endpoint,ReaderEndpoint]' --output text
```
:::

> [!CHECK]
> `@@aurora_server_id` returns `demo-aurora-writer` and `@@innodb_read_only` returns `0` (writable). The table has three rows.

### Step 3: Add a reader in another Availability Zone

:::console
1. Select the cluster `demo-aurora` and choose **Actions** → **Add reader**.
2. For **DB instance identifier**, enter `demo-aurora-reader`.
3. Keep the **Serverless** instance class (it uses the cluster's capacity range).
4. For **Availability zone**, pick a different AZ from the writer (the writer's AZ is on its instance page).
5. Keep **Publicly accessible** as **No** and set **Failover priority** to **tier-1** (tiers 0 and 1 keep a serverless reader at least as large as the writer).
6. Choose **Add reader** and wait until it is **Available**.
:::

:::cli
```bash
WRITER_AZ=$(aws rds describe-db-instances --db-instance-identifier demo-aurora-writer \
  --query 'DBInstances[0].AvailabilityZone' --output text)
READER_AZ=$(aws ec2 describe-availability-zones \
  --query "AvailabilityZones[?ZoneName!='$WRITER_AZ' && State=='available'].ZoneName | [0]" \
  --output text)

aws rds create-db-instance \
  --db-instance-identifier demo-aurora-reader \
  --db-cluster-identifier demo-aurora \
  --engine aurora-mysql \
  --db-instance-class db.serverless \
  --availability-zone "$READER_AZ" \
  --promotion-tier 1
aws rds wait db-instance-available --db-instance-identifier demo-aurora-reader
```
:::

> [!CHECK]
> The cluster now lists two instances: `demo-aurora-writer` with role **Writer instance** and `demo-aurora-reader` with role **Reader instance**, in different AZs. No data was copied to create the reader: it attaches to the same cluster volume.

### Step 4: Compare the reader endpoint with the writer endpoint

:::console
1. Connect with the **Reader** endpoint:
   ```bash
   mysql -h <reader-endpoint> -P 3306 -u admin -p -e "SELECT @@aurora_server_id, @@innodb_read_only; SELECT COUNT(*) FROM shop.products;"
   ```
2. Try a write through the reader endpoint:
   ```bash
   mysql -h <reader-endpoint> -P 3306 -u admin -p -e "INSERT INTO shop.products VALUES (4,'shelf',60.00);"
   ```
3. Insert through the **writer** endpoint, then immediately count through the reader endpoint:
   ```bash
   mysql -h <writer-endpoint> -P 3306 -u admin -p -e "INSERT INTO shop.products VALUES (4,'shelf',60.00);"
   mysql -h <reader-endpoint> -P 3306 -u admin -p -e "SELECT COUNT(*) FROM shop.products;"
   ```
:::

:::cli
```bash
aws rds describe-db-clusters --db-cluster-identifier demo-aurora \
  --query 'DBClusters[0].DBClusterMembers[].{Instance:DBInstanceIdentifier,Writer:IsClusterWriter,Tier:PromotionTier}'
```
:::

> [!CHECK]
> Through the reader endpoint, `@@aurora_server_id` is `demo-aurora-reader` and `@@innodb_read_only` is `1`; the write fails with a read-only error. A row written through the writer endpoint shows up on the reader almost instantly (count 4), because both instances read the same storage volume.

### Step 5: Fail over and watch the endpoints follow

:::console
1. In **Databases**, select a DB instance of the cluster (for example `demo-aurora-writer`) and choose **Actions** → **Failover**, then confirm **Failover**.
2. Watch the cluster status change to **Failing-over** and back to **Available** (usually well under a minute). The roles swap: `demo-aurora-reader` becomes the **Writer instance**.
3. Reconnect with the **same** writer endpoint and check who answers:
   ```bash
   mysql -h <writer-endpoint> -P 3306 -u admin -p -e "SELECT @@aurora_server_id, @@innodb_read_only;"
   ```
:::

:::cli
```bash
aws rds failover-db-cluster --db-cluster-identifier demo-aurora \
  --target-db-instance-identifier demo-aurora-reader
sleep 60
aws rds describe-db-clusters --db-cluster-identifier demo-aurora \
  --query 'DBClusters[0].DBClusterMembers[].{Instance:DBInstanceIdentifier,Writer:IsClusterWriter}'
```
:::

> [!CHECK]
> The writer endpoint now returns `demo-aurora-reader` with `@@innodb_read_only = 0`. You never changed a connection string: the cluster endpoint moved to the new writer. Under **Logs & events**, the cluster's recent events record the failover.

### Step 6: Clone the cluster and change the clone

:::console
1. Select the cluster `demo-aurora` and choose **Actions** → **Create clone**.
2. For **DB instance identifier** (the clone's name), enter `demo-aurora-clone`.
3. Keep **Aurora Standard**, choose the serverless capacity settings (minimum 0 or 0.5, maximum 2 ACUs), keep the default VPC, set public access to **No**, and choose security group `demo-db-sg`.
4. Choose **Create clone** and wait until the clone's instance is **Available**.
5. Connect to the **clone's** writer endpoint (shown on its **Connectivity & security** tab), delete data there, and then check the original:
   ```bash
   mysql -h <clone-writer-endpoint> -P 3306 -u admin -p -e "DELETE FROM shop.products; SELECT COUNT(*) FROM shop.products;"
   mysql -h <writer-endpoint> -P 3306 -u admin -p -e "SELECT COUNT(*) FROM shop.products;"
   ```
:::

:::cli
```bash
aws rds restore-db-cluster-to-point-in-time \
  --source-db-cluster-identifier demo-aurora \
  --db-cluster-identifier demo-aurora-clone \
  --restore-type copy-on-write \
  --use-latest-restorable-time \
  --vpc-security-group-ids "$DB_SG" \
  --serverless-v2-scaling-configuration MinCapacity=0.5,MaxCapacity=2

aws rds wait db-cluster-available --db-cluster-identifier demo-aurora-clone
aws rds create-db-instance \
  --db-instance-identifier demo-aurora-clone-instance \
  --db-cluster-identifier demo-aurora-clone \
  --engine aurora-mysql \
  --db-instance-class db.serverless
aws rds wait db-instance-available --db-instance-identifier demo-aurora-clone-instance
aws rds describe-db-clusters --db-cluster-identifier demo-aurora-clone \
  --query 'DBClusters[0].Endpoint' --output text
```
:::

> [!CHECK]
> The clone was ready in minutes without copying the table data first. Deleting rows in the clone leaves the clone with 0 rows while the original cluster still has 4: copy-on-write gave the clone its own pages only for what changed.

## Cleanup

Delete in this order. If you are continuing to Lab 03, keep `demo-db-client`, `demo-client-sg` (and `demo-db-sg` if you want it later).

Aurora never deletes a cluster just because its last instance is gone: an empty cluster keeps its volume and keeps billing storage. Delete the instances first, then each cluster as a separate step.

- [ ] Delete the clone's instance: in **Databases**, expand the `demo-aurora-clone` cluster, select its DB instance → **Actions** → **Delete**, type `delete me` and choose **Delete**.
- [ ] Delete the clone cluster: select the `demo-aurora-clone` cluster → **Actions** → **Delete**, clear **Create final snapshot?** (it is selected by default), leave **Retain automated backups** cleared, type `delete me` and choose **Delete**.
- [ ] Delete the reader instance of `demo-aurora` (after the failover that is `demo-aurora-writer`): **Actions** → **Delete**.
- [ ] Delete the remaining instance, `demo-aurora-reader`, the same way.
- [ ] Delete the cluster `demo-aurora`: select the cluster → **Actions** → **Delete**, clear **Create final snapshot?**, leave **Retain automated backups** cleared, and confirm.
- [ ] Check **Snapshots** for any manual or final cluster snapshots named `demo-aurora*` and delete them.
- [ ] Not doing Lab 03? Terminate `demo-db-client`, then delete security groups `demo-db-sg` and `demo-client-sg` (in that order).

:::cli
```bash
aws rds delete-db-instance --db-instance-identifier demo-aurora-clone-instance
aws rds wait db-instance-deleted --db-instance-identifier demo-aurora-clone-instance
aws rds delete-db-cluster --db-cluster-identifier demo-aurora-clone \
  --skip-final-snapshot --delete-automated-backups

# demo-aurora-writer is the reader after the failover, so delete it first
aws rds delete-db-instance --db-instance-identifier demo-aurora-writer
aws rds wait db-instance-deleted --db-instance-identifier demo-aurora-writer
aws rds delete-db-instance --db-instance-identifier demo-aurora-reader
aws rds wait db-instance-deleted --db-instance-identifier demo-aurora-reader
aws rds delete-db-cluster --db-cluster-identifier demo-aurora \
  --skip-final-snapshot --delete-automated-backups
aws rds wait db-cluster-deleted --db-cluster-identifier demo-aurora
aws rds wait db-cluster-deleted --db-cluster-identifier demo-aurora-clone

# Only if you are NOT doing Lab 03:
INSTANCE_ID=$(aws ec2 describe-instances \
  --filters Name=tag:Name,Values=demo-db-client Name=instance-state-name,Values=running \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)
aws ec2 terminate-instances --instance-ids "$INSTANCE_ID"
aws ec2 wait instance-terminated --instance-ids "$INSTANCE_ID"
aws ec2 delete-security-group --group-name demo-db-sg
aws ec2 delete-security-group --group-name demo-client-sg
```
:::

> [!CHECK]
> Final check: the RDS **Databases** list shows no `demo-aurora*` clusters or instances, **Snapshots** has no `demo-aurora*` entries, and (if you are done with all labs) `demo-db-client` is terminated. Look at **Billing and Cost Management** → **Bills** the next day for Aurora charges.

## Progress checklist

- [ ] Step 1: Aurora MySQL cluster with a serverless writer created
- [ ] Step 2: Connected through the writer endpoint and created data
- [ ] Step 3: Reader added in another AZ
- [ ] Step 4: Saw read-only routing and instant visibility through the reader endpoint
- [ ] Step 5: Failover swapped roles while the writer endpoint stayed the same
- [ ] Step 6: Clone created and changed without affecting the source
- [ ] Cleanup done
