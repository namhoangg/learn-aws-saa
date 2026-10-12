---
id: 09-rds-aurora-elasticache-lab-01
title: Run RDS for MySQL with a read replica, a snapshot and a promotion
objective: Create a private, encrypted RDS for MySQL instance with storage autoscaling, connect from an EC2 client, add a read replica and watch asynchronous replication, take a manual snapshot, check point-in-time restore, and promote the replica to a standalone database.
estimatedTime: 75 minutes
cost: "About USD 0.06 per hour in us-east-1 (two db.t4g.micro instances at USD 0.016/hour each, 40 GiB of gp3 storage, one t3.micro client and one public IPv4 address); roughly USD 0.10–0.15 if you finish and clean up within two hours. Free Tier credits (new accounts) or the legacy 12-month RDS Free Tier can cover most of it."
freeTier: partial
services: [rds, ec2, security-groups, kms, cloudwatch]
---

> [!COST]
> RDS bills each DB instance per hour from creation until deletion: db.t4g.micro MySQL is USD 0.016 per hour in us-east-1, so the primary and the replica together cost about USD 0.032 per hour, plus a few tenths of a cent per hour for 20 GiB of storage each. The EC2 client (t3.micro, about USD 0.0104 per hour) and its public IPv4 address (USD 0.005 per hour) add a little more. Manual snapshots are billed as backup storage until you delete them. A forgotten pair of instances and their storage costs roughly USD 28 per month, so do the **Cleanup** section when you finish. The legacy Free Tier's 750 hours a month cover only one Single-AZ micro instance running all the time. RDS lists the features its Free Tier excludes, such as deployments other than Single-AZ, reserved instances and Aurora read replicas; RDS for MySQL read replicas are not on that list, so Free plan accounts can do Step 5 with a db.t4g.micro replica. The replica is billed as a second DB instance and draws on your credits like the primary.

This lab builds the classic pattern from the lesson: a private database reachable only from an application security group, a read replica that receives changes asynchronously, and backups you can restore. Labs 02 and 03 reuse the EC2 client and the security groups from Step 1, so if you plan to continue, keep them when you clean up.

## Prerequisites

- An AWS account with permissions for Amazon RDS and Amazon EC2 (for example the `AmazonRDSFullAccess` and `AmazonEC2FullAccess` managed policies).
- A Region with a **default VPC**. The steps use `us-east-1`; any Region that offers db.t4g.micro works.
- For the CLI tabs: AWS CLI v2 with credentials, or **AWS CloudShell** (no setup needed). Use one terminal for the whole lab because later commands reuse shell variables.
- A browser for **EC2 Instance Connect** (no SSH key needed).

## Steps

### Step 1: Create the security groups and an EC2 client

The database will accept MySQL traffic only from instances in `demo-client-sg`, and the client accepts SSH only from the EC2 Instance Connect service.

:::console
1. Open the **EC2** console, choose **Security Groups** under **Network & Security**, then **Create security group**.
2. Name it `demo-client-sg`, description `DB client: SSH from EC2 Instance Connect`, keep the default **VPC**.
3. Under **Inbound rules**, choose **Add rule**, set **Type** to **SSH**, keep **Source** as **Custom**, and in the search box next to it select the prefix list `com.amazonaws.us-east-1.ec2-instance-connect` (use your Region's code). Choose **Create security group**.
4. Create a second security group named `demo-db-sg`, description `MySQL only from demo-client-sg`, default VPC. Add an inbound rule with **Type** **MYSQL/Aurora** (port 3306) and **Source** **Custom** → `demo-client-sg`. Choose **Create security group**.
5. Choose **Instances** → **Launch instances**. Name it `demo-db-client`, keep **Amazon Linux 2023 AMI**, choose **t3.micro**, and for **Key pair** choose **Proceed without a key pair (Not recommended)**.
6. Under **Network settings**, choose **Edit**, keep the default VPC and a default subnet with **Auto-assign public IP** enabled, choose **Select existing security group** and pick `demo-client-sg`. Choose **Launch instance**.
:::

:::cli
```bash
REGION=${AWS_REGION:-$(aws configure get region)}
VPC_ID=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true \
  --query 'Vpcs[0].VpcId' --output text)

PL_ID=$(aws ec2 describe-managed-prefix-lists \
  --filters Name=prefix-list-name,Values=com.amazonaws.${REGION}.ec2-instance-connect \
  --query 'PrefixLists[0].PrefixListId' --output text)

CLIENT_SG=$(aws ec2 create-security-group --group-name demo-client-sg \
  --description "DB client: SSH from EC2 Instance Connect" --vpc-id "$VPC_ID" \
  --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$CLIENT_SG" \
  --ip-permissions "IpProtocol=tcp,FromPort=22,ToPort=22,PrefixListIds=[{PrefixListId=$PL_ID}]"

DB_SG=$(aws ec2 create-security-group --group-name demo-db-sg \
  --description "MySQL only from demo-client-sg" --vpc-id "$VPC_ID" \
  --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$DB_SG" \
  --protocol tcp --port 3306 --source-group "$CLIENT_SG"

AMI_ID=$(aws ssm get-parameters \
  --names /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --query 'Parameters[0].Value' --output text)
INSTANCE_ID=$(aws ec2 run-instances --image-id "$AMI_ID" --instance-type t3.micro \
  --security-group-ids "$CLIENT_SG" \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=demo-db-client}]' \
  --query 'Instances[0].InstanceId' --output text)
aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
echo "Client SG: $CLIENT_SG  DB SG: $DB_SG  Instance: $INSTANCE_ID"
```
:::

> [!CHECK]
> `demo-db-sg` has exactly one inbound rule, port 3306, whose source is the security group `demo-client-sg` (not an IP range). The instance `demo-db-client` is **Running** and has a public IPv4 address.

### Step 2: Create an encrypted RDS for MySQL instance with storage autoscaling

:::console
1. Open the **RDS** console in the same Region, choose **Databases** → **Create database**, and choose **Standard create**.
2. For **Engine type** choose **MySQL** and keep the default engine version.
3. Under **Templates**, choose **Free tier** if it is shown (Free plan accounts) or **Sandbox** / **Dev/Test**; check that the deployment is a single DB instance with no standby.
4. Under **Settings**, enter `demo-mysql` as **DB instance identifier**, keep `admin` as **Master username**, choose **Self managed** credentials, and type a password you will remember for the lab.
5. Under **Instance configuration**, choose a burstable class: **db.t4g.micro** (or db.t3.micro).
6. Under **Storage**, choose **General Purpose SSD (gp3)** and **20** GiB. Expand **Additional storage configuration**, keep **Enable storage autoscaling** selected and set **Maximum storage threshold** to **30** GiB (it must be at least 10% above the allocated storage).
7. Under **Connectivity**, choose **Don't connect to an EC2 compute resource**, keep the default VPC and its default DB subnet group, set **Public access** to **No**, and for **VPC security group (firewall)** choose **Choose existing**, remove `default` and add `demo-db-sg`.
8. Under **Database authentication**, keep **Password authentication**.
9. Expand **Additional configuration**: set **Initial database name** to `shop`, set **Backup retention period** to **1** day (replicas need backups on), keep **Enable encryption** selected with the default `aws/rds` key, and make sure **Enable deletion protection** is cleared.
10. Choose **Create database**. Creation takes about 10–15 minutes.
:::

:::cli
```bash
read -rsp "Choose a master password (8-41 chars, no / ' \" @ or spaces): " DB_PASS; echo

aws rds create-db-instance \
  --db-instance-identifier demo-mysql \
  --engine mysql \
  --db-instance-class db.t4g.micro \
  --storage-type gp3 --allocated-storage 20 --max-allocated-storage 30 \
  --master-username admin --master-user-password "$DB_PASS" \
  --vpc-security-group-ids "$DB_SG" \
  --no-publicly-accessible \
  --no-multi-az \
  --backup-retention-period 1 \
  --storage-encrypted \
  --db-name shop \
  --no-deletion-protection

aws rds wait db-instance-available --db-instance-identifier demo-mysql
PRIMARY_EP=$(aws rds describe-db-instances --db-instance-identifier demo-mysql \
  --query 'DBInstances[0].Endpoint.Address' --output text)
echo "Primary endpoint: $PRIMARY_EP"
```
:::

> [!CHECK]
> The instance status is **Available**. On the **Configuration** tab, **Encryption** shows **Enabled** and storage autoscaling shows a maximum of 30 GiB. On **Connectivity & security**, **Publicly accessible** is **No** and the security group is `demo-db-sg`. Copy the **Endpoint**.

### Step 3: Connect from the EC2 client and add data

:::console
1. In the **EC2** console, select `demo-db-client`, choose **Connect**, open the **EC2 Instance Connect** tab, keep the public IP option and user name `ec2-user`, and choose **Connect**. A terminal opens in the browser.
2. Install the MySQL-compatible client:
   ```bash
   sudo dnf install -y mariadb105
   ```
3. Connect to the primary (paste your endpoint) and enter the master password when prompted:
   ```bash
   mysql -h <primary-endpoint> -P 3306 -u admin -p
   ```
4. Create a table and a few rows:
   ```sql
   USE shop;
   CREATE TABLE orders (
     id INT AUTO_INCREMENT PRIMARY KEY,
     item VARCHAR(50),
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   );
   INSERT INTO orders (item) VALUES ('keyboard'), ('mouse'), ('monitor');
   SELECT * FROM orders;
   ```
5. Type `exit` to leave the MySQL client but keep the browser terminal open.
:::

:::cli
```bash
# The SQL work happens in the EC2 Instance Connect browser terminal
# (demo-client-sg only allows SSH from the Instance Connect service).
# From CloudShell you can print the endpoint to paste there:
echo "$PRIMARY_EP"
```
:::

> [!CHECK]
> `SELECT * FROM orders;` returns three rows. If the connection hangs, the security group chain is wrong: the database must allow port 3306 from `demo-client-sg`, and the instance must actually use `demo-client-sg`.

### Step 4: Look at the backups RDS already takes

:::console
1. In the RDS console, choose **Automated backups** in the navigation pane and find `demo-mysql` on the **Current Region** tab.
2. Note the **Earliest restorable time** and **Latest restorable time**. The latest restorable time trails the current time by about 5 minutes because transaction logs are uploaded every 5 minutes.
3. Open **Actions** to see **Restore to point in time**, then cancel. Restoring would create a *new* instance, which you don't need for this lab.
:::

:::cli
```bash
aws rds describe-db-instances --db-instance-identifier demo-mysql \
  --query 'DBInstances[0].{Retention:BackupRetentionPeriod,Latest:LatestRestorableTime}'
```
:::

> [!CHECK]
> Backup retention is 1 day and a latest restorable time is shown. This is what makes point-in-time restore possible.

### Step 5: Create a read replica

:::console
1. Choose **Databases**, select `demo-mysql`, and choose **Actions** → **Create read replica**.
2. For **DB instance identifier**, enter `demo-mysql-replica`.
3. Choose the same instance class (**db.t4g.micro**) and keep the current **AWS Region**.
4. Under availability, keep a single instance (no standby for the replica).
5. Under **Connectivity**, make sure the security group is `demo-db-sg` and public access is off.
6. Choose **Create read replica**. It takes about 10–15 minutes.
:::

:::cli
```bash
aws rds create-db-instance-read-replica \
  --db-instance-identifier demo-mysql-replica \
  --source-db-instance-identifier demo-mysql \
  --db-instance-class db.t4g.micro \
  --vpc-security-group-ids "$DB_SG"

aws rds wait db-instance-available --db-instance-identifier demo-mysql-replica
REPLICA_EP=$(aws rds describe-db-instances --db-instance-identifier demo-mysql-replica \
  --query 'DBInstances[0].Endpoint.Address' --output text)
echo "Replica endpoint: $REPLICA_EP"
```
:::

> [!CHECK]
> On the **Databases** page, `demo-mysql-replica` shows **Replica** in the **Role** column, and `demo-mysql` shows **Primary**. The replica has its **own** endpoint, different from the primary's.

### Step 6: Test asynchronous replication and read-only behavior

In the EC2 Instance Connect terminal:

:::console
1. Connect to the **replica** endpoint and read the data:
   ```bash
   mysql -h <replica-endpoint> -P 3306 -u admin -p -e "SELECT * FROM shop.orders;"
   ```
2. Try to write to the replica:
   ```bash
   mysql -h <replica-endpoint> -P 3306 -u admin -p -e "INSERT INTO shop.orders (item) VALUES ('webcam');"
   ```
3. Write the same row to the **primary**, then read it from the replica a second later:
   ```bash
   mysql -h <primary-endpoint> -P 3306 -u admin -p -e "INSERT INTO shop.orders (item) VALUES ('webcam');"
   mysql -h <replica-endpoint> -P 3306 -u admin -p -e "SELECT COUNT(*) FROM shop.orders;"
   ```
4. In the RDS console, open `demo-mysql-replica` → **Monitoring** and find the **ReplicaLag** graph.
:::

:::cli
```bash
aws cloudwatch get-metric-statistics --namespace AWS/RDS --metric-name ReplicaLag \
  --dimensions Name=DBInstanceIdentifier,Value=demo-mysql-replica \
  --start-time "$(date -u -d '-30 minutes' +%Y-%m-%dT%H:%M:%SZ)" \
  --end-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --period 60 --statistics Maximum
```
:::

> [!CHECK]
> The replica returns the three original rows. The `INSERT` on the replica fails with an error saying the server is running with the read-only option. After writing to the primary, the replica's count goes from 3 to 4 within a second or two: that small delay is asynchronous replication. **ReplicaLag** stays near 0 seconds for this tiny workload.

### Step 7: Take a manual snapshot

:::console
1. In the RDS console, choose **Snapshots** → **Take snapshot**.
2. Choose the DB instance `demo-mysql`, enter `demo-mysql-snap1` as **Snapshot name**, and choose **Take snapshot**.
3. Wait until the snapshot status is **Available**, then open it and note that **Encrypted** is **Yes**: snapshots of an encrypted instance are always encrypted.
:::

:::cli
```bash
aws rds create-db-snapshot --db-instance-identifier demo-mysql \
  --db-snapshot-identifier demo-mysql-snap1
aws rds wait db-snapshot-available --db-snapshot-identifier demo-mysql-snap1
aws rds describe-db-snapshots --db-snapshot-identifier demo-mysql-snap1 \
  --query 'DBSnapshots[0].{Status:Status,Encrypted:Encrypted,Type:SnapshotType}'
```
:::

> [!CHECK]
> The snapshot shows type **manual**, status **available** and **Encrypted: true**. Unlike automated backups, it stays until you delete it.

### Step 8: Promote the replica to a standalone database

Promotion is how you turn a replica into an independent database, for example for disaster recovery.

:::console
1. Select `demo-mysql-replica` and choose **Actions** → **Promote**, keep the defaults, and confirm. The instance reboots and takes a few minutes.
2. When it is **Available** again, its **Role** column no longer says Replica.
3. In the EC2 terminal, write to the former replica:
   ```bash
   mysql -h <replica-endpoint> -P 3306 -u admin -p -e "INSERT INTO shop.orders (item) VALUES ('headset'); SELECT COUNT(*) FROM shop.orders;"
   ```
4. Read the count on the original primary and compare.
:::

:::cli
```bash
aws rds promote-read-replica --db-instance-identifier demo-mysql-replica
aws rds wait db-instance-available --db-instance-identifier demo-mysql-replica
aws rds describe-db-instances --db-instance-identifier demo-mysql-replica \
  --query 'DBInstances[0].ReadReplicaSourceDBInstanceIdentifier'
```
:::

> [!CHECK]
> The write now succeeds on the promoted instance (count 5), while the original primary still shows 4: replication stopped for good at promotion. The CLI query returns `null` because the instance no longer has a replication source.

## Cleanup

Delete in this order. If you are continuing to Lab 02 or Lab 03, delete the databases and the snapshot but **keep** `demo-db-client`, `demo-db-sg` and `demo-client-sg`.

- [ ] Delete `demo-mysql-replica`: **Databases** → select it → **Actions** → **Delete**, clear **Create final snapshot?** and **Retain automated backups**, type the confirmation and choose **Delete**.
- [ ] Delete `demo-mysql` the same way (no final snapshot, don't retain automated backups).
- [ ] Delete the manual snapshot `demo-mysql-snap1`: **Snapshots** → select it → **Actions** → **Delete snapshot**.
- [ ] Not continuing to the next labs? Terminate `demo-db-client`: **EC2** → **Instances** → select it → **Instance state** → **Terminate (delete) instance**.
- [ ] Not continuing? After both databases and the instance are gone, delete security group `demo-db-sg` first (it references the other group), then `demo-client-sg`.
- [ ] Optional: if RDS created a DB subnet group named like `default-vpc-...` that you don't use, you may delete it under **Subnet groups** (it is free either way).

:::cli
```bash
aws rds delete-db-instance --db-instance-identifier demo-mysql-replica \
  --skip-final-snapshot --delete-automated-backups
aws rds delete-db-instance --db-instance-identifier demo-mysql \
  --skip-final-snapshot --delete-automated-backups
aws rds wait db-instance-deleted --db-instance-identifier demo-mysql-replica
aws rds wait db-instance-deleted --db-instance-identifier demo-mysql
aws rds delete-db-snapshot --db-snapshot-identifier demo-mysql-snap1

# Only if you are NOT doing Lab 02 or Lab 03:
aws ec2 terminate-instances --instance-ids "$INSTANCE_ID"
aws ec2 wait instance-terminated --instance-ids "$INSTANCE_ID"
aws ec2 delete-security-group --group-id "$DB_SG"
aws ec2 delete-security-group --group-id "$CLIENT_SG"
```
:::

> [!CHECK]
> Final check: the RDS **Databases** list and **Snapshots** → **Manual snapshots** are empty, **Automated backups** → **Retained** shows nothing for `demo-mysql`, and (if you finished all labs) no `demo-db-client` instance is running. Check **Billing and Cost Management** → **Bills** the next day.

## Progress checklist

- [ ] Step 1: Security groups and EC2 client created
- [ ] Step 2: Encrypted RDS for MySQL instance with storage autoscaling created
- [ ] Step 3: Connected from EC2 and created the `orders` table
- [ ] Step 4: Checked automated backups and the latest restorable time
- [ ] Step 5: Read replica created
- [ ] Step 6: Saw read-only errors and replication delay on the replica
- [ ] Step 7: Manual encrypted snapshot taken
- [ ] Step 8: Replica promoted and accepted writes
- [ ] Cleanup done
