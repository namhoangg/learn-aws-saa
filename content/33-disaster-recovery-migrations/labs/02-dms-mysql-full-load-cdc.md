---
id: 33-disaster-recovery-migrations-lab-02
title: Migrate a live MySQL database with AWS DMS using full load plus CDC
objective: Create a source and a target RDS for MySQL database, run an AWS DMS task that copies the existing rows and then keeps replicating inserts, updates and deletes while the source stays writable, and check which schema objects DMS does and does not create on the target.
estimatedTime: 90 minutes
cost: "About USD 0.07 per hour in us-east-1 while everything runs: two db.t4g.micro RDS instances (USD 0.016/hour each), one dms.t3.micro replication instance (USD 0.0186/hour), a t3.micro client (USD 0.0104/hour) and its public IPv4 address (USD 0.005/hour), plus a few cents of storage. Roughly USD 0.15-0.25 if you finish and clean up within 2-3 hours."
freeTier: partial
services: [dms, rds, ec2, security-groups, iam]
---

> [!COST]
> Every database and the DMS replication instance bill per hour from creation until deletion, whether or not a task is running. In us-east-1: db.t4g.micro MySQL USD 0.016/hour each (two of them), dms.t3.micro single-AZ USD 0.0186/hour, t3.micro USD 0.0104/hour plus USD 0.005/hour for its public IPv4 address, and gp3 storage at USD 0.115 per GB-month for 20 GiB per database. Left running for a month this lab would cost about USD 50, so do the **Cleanup** section. Accounts on the legacy Free Tier get 750 hours a month of single-AZ dms.t3.micro for a year; newer accounts can use their Free Tier credits.

> [!NOTE] Free plan accounts
> AWS's DMS Free Tier page says accounts on the credit-based Free plan can use DMS, including replication instances and DMS Serverless, until the credits run out. RDS is also on the Free plan, so the whole lab runs on credits. If a console step is still blocked for your account, upgrade to the Paid plan or read along.

In this lab both databases run MySQL, so it is a **homogeneous** migration and no schema conversion is needed. For a real MySQL-to-MySQL move AWS also offers DMS *homogeneous data migrations*, which use native MySQL tools; here you use a classic DMS task because it shows the full load and CDC phases that exam questions describe. The steps use **us-east-1** and the default VPC.

## Prerequisites

- An AWS account with permissions for AWS DMS, Amazon RDS, Amazon EC2 and IAM (for example `AmazonRDSFullAccess`, `AmazonEC2FullAccess`, `AmazonDMSFullAccess`-style permissions and `iam:CreateRole` for the DMS service role).
- A Region with a **default VPC**.
- For the CLI tabs: AWS CLI v2 with credentials, or **AWS CloudShell**. Use one terminal for the whole lab because later commands reuse shell variables.
- A browser for **EC2 Instance Connect** (no SSH key needed). The SQL work happens in that browser terminal.

## Steps

### Step 1: Create the security groups and an EC2 client

Three groups: the client accepts SSH only from EC2 Instance Connect, the DMS replication instance needs no inbound rules, and the databases accept MySQL traffic only from the client and from DMS.

:::console
1. Open the **EC2** console, choose **Security Groups** → **Create security group**. Name it `demo-client-sg`, description `DB client: SSH from EC2 Instance Connect`, default **VPC**. Add an inbound rule with **Type** **SSH** and, as **Source**, the prefix list `com.amazonaws.us-east-1.ec2-instance-connect`. Choose **Create security group**.
2. Create `demo-dms-sg` (description `DMS replication instance`) with no inbound rules.
3. Create `demo-db-sg` (description `MySQL from client and DMS`) with two inbound rules: **MYSQL/Aurora** (3306) from `demo-client-sg`, and **MYSQL/Aurora** from `demo-dms-sg`.
4. Choose **Instances** → **Launch instances**: name `demo-db-client`, **Amazon Linux 2023 AMI**, **t3.micro**, **Proceed without a key pair (Not recommended)**, default VPC and a default subnet with **Auto-assign public IP** enabled, existing security group `demo-client-sg`. Choose **Launch instance**.
:::

:::cli
```bash
REGION=${AWS_REGION:-us-east-1}
VPC_ID=$(aws ec2 describe-vpcs --region "$REGION" --filters Name=is-default,Values=true \
  --query 'Vpcs[0].VpcId' --output text)
PL_ID=$(aws ec2 describe-managed-prefix-lists --region "$REGION" \
  --filters Name=prefix-list-name,Values=com.amazonaws.${REGION}.ec2-instance-connect \
  --query 'PrefixLists[0].PrefixListId' --output text)

CLIENT_SG=$(aws ec2 create-security-group --region "$REGION" --group-name demo-client-sg \
  --description "DB client: SSH from EC2 Instance Connect" --vpc-id "$VPC_ID" --query GroupId --output text)
aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$CLIENT_SG" \
  --ip-permissions "IpProtocol=tcp,FromPort=22,ToPort=22,PrefixListIds=[{PrefixListId=$PL_ID}]"

DMS_SG=$(aws ec2 create-security-group --region "$REGION" --group-name demo-dms-sg \
  --description "DMS replication instance" --vpc-id "$VPC_ID" --query GroupId --output text)

DB_SG=$(aws ec2 create-security-group --region "$REGION" --group-name demo-db-sg \
  --description "MySQL from client and DMS" --vpc-id "$VPC_ID" --query GroupId --output text)
aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$DB_SG" \
  --protocol tcp --port 3306 --source-group "$CLIENT_SG"
aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$DB_SG" \
  --protocol tcp --port 3306 --source-group "$DMS_SG"

AMI_ID=$(aws ssm get-parameters --region "$REGION" \
  --names /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --query 'Parameters[0].Value' --output text)
INSTANCE_ID=$(aws ec2 run-instances --region "$REGION" --image-id "$AMI_ID" --instance-type t3.micro \
  --security-group-ids "$CLIENT_SG" \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=demo-db-client}]' \
  --query 'Instances[0].InstanceId' --output text)
aws ec2 wait instance-running --region "$REGION" --instance-ids "$INSTANCE_ID"
```
:::

> [!CHECK]
> `demo-db-sg` has exactly two inbound rules on port 3306, both pointing at security groups (not IP ranges). `demo-db-client` is **Running** with a public IPv4 address.

### Step 2: Create a parameter group for DMS

DMS reads ongoing changes from the MySQL binary log, and it needs that log in `ROW` format on the source. On a MySQL target, the DMS documentation asks for `local_infile = 1` so that DMS can load data. You cannot edit a default parameter group, so create one group with both settings and attach it to both databases.

:::console
1. Open the **RDS** console and choose **Parameter groups** → **Create parameter group**.
2. Choose **MySQL Community** as engine type and **mysql8.4** as **Parameter group family**, type **DB Parameter Group**. Name it `demo-mysql84-dms`, description `Settings for the DMS lab`. Choose **Create**.
3. Open the new group and choose **Edit**. Set `binlog_format` to **ROW** and `local_infile` to **1**, then choose **Save changes**.
:::

:::cli
```bash
aws rds create-db-parameter-group --region "$REGION" \
  --db-parameter-group-name demo-mysql84-dms \
  --db-parameter-group-family mysql8.4 \
  --description "Settings for the DMS lab"
aws rds modify-db-parameter-group --region "$REGION" \
  --db-parameter-group-name demo-mysql84-dms \
  --parameters "ParameterName=binlog_format,ParameterValue=ROW,ApplyMethod=immediate" \
               "ParameterName=local_infile,ParameterValue=1,ApplyMethod=immediate"
```
:::

> [!CHECK]
> In `demo-mysql84-dms`, `binlog_format` shows **ROW** and `local_infile` shows **1**, both with source **user**. `binlog_row_image` keeps its default, **FULL**, which is what DMS needs.

### Step 3: Create the source and target databases

Use MySQL **8.4**. MySQL 8.0 reached the end of RDS standard support on 31 July 2026 and now runs only under paid Extended Support.

:::console
1. In **RDS**, choose **Databases** → **Create database** → **Standard create**, engine **MySQL**, and a **MySQL 8.4** engine version.
2. Choose the **Free tier** template (shown as **Sandbox** on Paid plan accounts) or **Dev/Test** with a single DB instance. **DB instance identifier**: `demo-dms-source`; master username `admin`, **Self managed** password.
3. **Instance configuration**: **db.t4g.micro**. **Storage**: **gp3**, **20** GiB; clear storage autoscaling.
4. **Connectivity**: **Don't connect to an EC2 compute resource**, default VPC, **Public access** **No**, **Choose existing** security group `demo-db-sg` (remove `default`).
5. **Additional configuration**: **DB parameter group** `demo-mysql84-dms`; keep automated backups with **Backup retention period** **1** day (RDS for MySQL writes binary logs only while backups are on); clear **Enable deletion protection**. Choose **Create database**.
6. Repeat for the target: identifier `demo-dms-target`, same password, class, storage, security group and parameter group `demo-mysql84-dms`; you may set backup retention to **0** days (the target needs no binary log). Both take about 10-15 minutes; continue with Step 4 while they are created, then wait for **Available**.
:::

:::cli
```bash
read -rsp "Choose a master password (8-41 chars, no / ' \" @ or spaces): " DB_PASS; echo

aws rds create-db-instance --region "$REGION" --db-instance-identifier demo-dms-source \
  --engine mysql --engine-version 8.4 --db-instance-class db.t4g.micro \
  --storage-type gp3 --allocated-storage 20 \
  --master-username admin --master-user-password "$DB_PASS" \
  --vpc-security-group-ids "$DB_SG" --no-publicly-accessible --no-multi-az \
  --db-parameter-group-name demo-mysql84-dms \
  --backup-retention-period 1 --no-deletion-protection

aws rds create-db-instance --region "$REGION" --db-instance-identifier demo-dms-target \
  --engine mysql --engine-version 8.4 --db-instance-class db.t4g.micro \
  --storage-type gp3 --allocated-storage 20 \
  --master-username admin --master-user-password "$DB_PASS" \
  --vpc-security-group-ids "$DB_SG" --no-publicly-accessible --no-multi-az \
  --db-parameter-group-name demo-mysql84-dms \
  --backup-retention-period 0 --no-deletion-protection

aws rds wait db-instance-available --region "$REGION" --db-instance-identifier demo-dms-source
aws rds wait db-instance-available --region "$REGION" --db-instance-identifier demo-dms-target
SRC_EP=$(aws rds describe-db-instances --region "$REGION" --db-instance-identifier demo-dms-source \
  --query 'DBInstances[0].Endpoint.Address' --output text)
TGT_EP=$(aws rds describe-db-instances --region "$REGION" --db-instance-identifier demo-dms-target \
  --query 'DBInstances[0].Endpoint.Address' --output text)
echo "Source: $SRC_EP"; echo "Target: $TGT_EP"
```
:::

> [!CHECK]
> Both databases are **Available** and not publicly accessible. On each database's **Configuration** tab, the parameter group is `demo-mysql84-dms` (**in-sync**); backups are on for the source. Copy both endpoints.

### Step 4: Create the DMS replication instance

The replication instance is the managed compute that reads from the source and writes to the target. It takes about 10 minutes, so start it while the databases finish.

:::console
1. Open the **AWS DMS** console and choose **Replication instances** → **Create replication instance**.
2. **Name**: `demo-dms-ri`. **Instance class**: **dms.t3.micro**. Keep the default **Engine version**, as long as it is **3.5.4 or later**: older DMS versions cannot use MySQL 8.4 as a source or target.
3. Under **High Availability** (labeled **Multi AZ** in some console versions), choose **Dev or test workload (Single-AZ)**. For a long production CDC run you would pick the Multi-AZ production option to get a synchronous standby in another AZ.
4. Keep the default **Allocated storage**. **Network type**: **IPv4**. **VPC**: the default VPC. **Replication subnet group**: keep the one the console proposes (it creates one for the default VPC if none exists). Clear **Publicly accessible**.
5. Under **Advanced settings**, set **VPC security group(s)** to `demo-dms-sg` only.
6. Choose **Create replication instance** and wait for status **Available**. The console also creates the IAM role `dms-vpc-role` if your account does not have it yet.
:::

:::cli
```bash
# DMS needs a role named exactly dms-vpc-role (the console creates it automatically)
if ! aws iam get-role --role-name dms-vpc-role >/dev/null 2>&1; then
  aws iam create-role --role-name dms-vpc-role \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"dms.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
  aws iam attach-role-policy --role-name dms-vpc-role \
    --policy-arn arn:aws:iam::aws:policy/service-role/AmazonDMSVPCManagementRole
  sleep 15
fi

SUBNETS=$(aws ec2 describe-subnets --region "$REGION" \
  --filters Name=vpc-id,Values="$VPC_ID" Name=default-for-az,Values=true \
  --query 'Subnets[].SubnetId' --output text)
aws dms create-replication-subnet-group --region "$REGION" \
  --replication-subnet-group-identifier demo-dms-subnets \
  --replication-subnet-group-description "Default VPC subnets for the DMS lab" \
  --subnet-ids $SUBNETS

RI_ARN=$(aws dms create-replication-instance --region "$REGION" \
  --replication-instance-identifier demo-dms-ri \
  --replication-instance-class dms.t3.micro \
  --no-multi-az --no-publicly-accessible \
  --replication-subnet-group-identifier demo-dms-subnets \
  --vpc-security-group-ids "$DMS_SG" \
  --query 'ReplicationInstance.ReplicationInstanceArn' --output text)
aws dms wait replication-instance-available --region "$REGION" \
  --filters Name=replication-instance-arn,Values="$RI_ARN"
```
:::

> [!CHECK]
> `demo-dms-ri` is **Available**, **Multi-AZ** shows **No**, its engine version is 3.5.4 or later, and it has only a private IP address. Nothing has been migrated yet: a replication instance does nothing until a task runs on it.

### Step 5: Create the sample data on the source

:::console
1. In **EC2**, select `demo-db-client` → **Connect** → **EC2 Instance Connect** → **Connect**.
2. Install the MySQL-compatible client and connect to the **source** endpoint over TLS (enter the password when asked):
   ```bash
   sudo dnf install -y mariadb105
   mysql --ssl -h <source-endpoint> -u admin -p
   ```
3. Create a table with a primary key **and** a secondary index, add rows, and keep binary logs for 24 hours so DMS can read them:
   ```sql
   CREATE DATABASE shop;
   USE shop;
   CREATE TABLE orders (
     id INT AUTO_INCREMENT PRIMARY KEY,
     customer VARCHAR(40) NOT NULL,
     item VARCHAR(40) NOT NULL,
     qty INT NOT NULL DEFAULT 1,
     INDEX idx_customer (customer)
   );
   INSERT INTO orders (customer, item, qty) VALUES
     ('ana','keyboard',1), ('ben','mouse',2), ('ana','monitor',1),
     ('chen','laptop',1), ('dee','headset',3);
   CALL mysql.rds_set_configuration('binlog retention hours', 24);
   SHOW VARIABLES LIKE 'binlog_format';
   ```
4. Type `exit` but keep the browser terminal open.
:::

:::cli
```bash
# The SQL runs in the EC2 Instance Connect terminal (demo-db-sg only admits the client and DMS).
# Print the endpoints to paste there:
echo "$SRC_EP"; echo "$TGT_EP"
```
:::

> [!CHECK]
> `SELECT COUNT(*) FROM shop.orders;` returns 5 and `binlog_format` is **ROW**. If the client reports an authentication-plugin error, make sure you passed `--ssl`: RDS for MySQL 8.4 uses the `caching_sha2_password` plugin by default, and its first login needs either TLS or an RSA key exchange; `--ssl` provides TLS.

### Step 6: Create and test the source and target endpoints

:::console
1. In **AWS DMS**, choose **Endpoints** → **Create endpoint**, choose **Source endpoint** and tick **Select RDS DB instance**, then pick `demo-dms-source`.
2. **Endpoint identifier**: `demo-src`. **Source engine**: **MySQL**. **Access to endpoint database**: **Provide access information manually**; check the server name and port, set **Secure Socket Layer (SSL) mode** to **require**, user `admin` and your password.
3. Open **Test endpoint connection (optional)**, choose the default VPC and `demo-dms-ri`, and choose **Run test**. When it reports **successful**, choose **Create endpoint**.
4. Repeat with **Target endpoint**, RDS instance `demo-dms-target`, identifier `demo-tgt`, engine **MySQL**, SSL mode **require**, and run the test.
:::

:::cli
```bash
SRC_ARN=$(aws dms create-endpoint --region "$REGION" --endpoint-identifier demo-src \
  --endpoint-type source --engine-name mysql --server-name "$SRC_EP" --port 3306 \
  --username admin --password "$DB_PASS" --ssl-mode require \
  --query 'Endpoint.EndpointArn' --output text)
TGT_ARN=$(aws dms create-endpoint --region "$REGION" --endpoint-identifier demo-tgt \
  --endpoint-type target --engine-name mysql --server-name "$TGT_EP" --port 3306 \
  --username admin --password "$DB_PASS" --ssl-mode require \
  --query 'Endpoint.EndpointArn' --output text)

aws dms test-connection --region "$REGION" --replication-instance-arn "$RI_ARN" --endpoint-arn "$SRC_ARN"
aws dms test-connection --region "$REGION" --replication-instance-arn "$RI_ARN" --endpoint-arn "$TGT_ARN"
aws dms wait test-connection-succeeds --region "$REGION" \
  --filters Name=endpoint-arn,Values="$SRC_ARN","$TGT_ARN"
aws dms describe-connections --region "$REGION" --query 'Connections[].{Endpoint:EndpointIdentifier,Status:Status}'
```
:::

> [!CHECK]
> Both connection tests show **successful**. If a test fails with a timeout, check that `demo-db-sg` allows port 3306 from `demo-dms-sg` and that the replication instance really uses `demo-dms-sg`.

### Step 7: Create the migration task with full load plus CDC

:::console
1. Choose **Database migration tasks** → **Create task**.
2. **Task identifier**: `demo-task`; **Replication instance**: `demo-dms-ri`; **Source database endpoint**: `demo-src`; **Target database endpoint**: `demo-tgt`.
3. **Migration type**: **Migrate existing data and replicate ongoing changes**.
4. **Task settings**: keep **Target table preparation mode** = **Drop tables on target** and the default LOB settings. Leave CloudWatch logs off for this lab.
5. **Table mappings**: keep the **Wizard** editor, choose **Add new selection rule**, **Schema**: **Enter a schema**, **Source name** `shop`, **Source table name** `%`, **Action** **Include**.
6. **Migration task startup configuration**: choose **Start automatically on create** (skip premigration assessments for this small lab).
7. Choose **Create task**.
:::

:::cli
```bash
cat > mappings.json <<'EOF'
{
  "rules": [{
    "rule-type": "selection", "rule-id": "1", "rule-name": "include-shop",
    "object-locator": { "schema-name": "shop", "table-name": "%" },
    "rule-action": "include"
  }]
}
EOF
TASK_ARN=$(aws dms create-replication-task --region "$REGION" \
  --replication-task-identifier demo-task \
  --source-endpoint-arn "$SRC_ARN" --target-endpoint-arn "$TGT_ARN" \
  --replication-instance-arn "$RI_ARN" \
  --migration-type full-load-and-cdc \
  --table-mappings file://mappings.json \
  --query 'ReplicationTask.ReplicationTaskArn' --output text)
aws dms wait replication-task-ready --region "$REGION" \
  --filters Name=replication-task-arn,Values="$TASK_ARN"
aws dms start-replication-task --region "$REGION" \
  --replication-task-arn "$TASK_ARN" --start-replication-task-type start-replication
```
:::

> [!CHECK]
> After a minute or two the task status is **Load complete, replication ongoing**. On the task's **Table statistics** tab, `shop.orders` shows **5** full-load rows. The source was never stopped: the application could have kept writing the whole time.

### Step 8: Compare the target schema with the source

In the EC2 Instance Connect terminal:

:::console
1. Count the rows on the target:
   ```bash
   mysql --ssl -h <target-endpoint> -u admin -p -e "SELECT COUNT(*) FROM shop.orders;"
   ```
2. Compare the table definitions:
   ```bash
   mysql --ssl -h <source-endpoint> -u admin -p -e "SHOW CREATE TABLE shop.orders\G"
   mysql --ssl -h <target-endpoint> -u admin -p -e "SHOW CREATE TABLE shop.orders\G"
   ```
:::

:::cli
```bash
aws dms describe-table-statistics --region "$REGION" --replication-task-arn "$TASK_ARN" \
  --query 'TableStatistics[].{Table:TableName,FullLoadRows:FullLoadRows,State:TableState}'
```
:::

> [!CHECK]
> The target has all 5 rows and the primary key, but **no `idx_customer` index** and no `AUTO_INCREMENT` on `id`. DMS creates only what it needs to move the data (tables and primary keys); secondary indexes, constraints and other objects come from SCT, DMS Schema Conversion or native tools, typically added before CDC or before cutover.

### Step 9: Watch change data capture while the source stays live

:::console
1. Make changes on the **source**:
   ```bash
   mysql --ssl -h <source-endpoint> -u admin -p -e "
     INSERT INTO shop.orders (customer,item,qty) VALUES ('eva','webcam',1),('ben','dock',1);
     UPDATE shop.orders SET qty = 5 WHERE customer = 'ana' AND item = 'keyboard';
     DELETE FROM shop.orders WHERE customer = 'dee';"
   ```
2. A few seconds later, read the **target**:
   ```bash
   mysql --ssl -h <target-endpoint> -u admin -p -e "SELECT * FROM shop.orders ORDER BY id;"
   ```
3. In the DMS console, open `demo-task` → **Table statistics** and look at the **Inserts**, **Updates** and **Deletes** columns.
:::

:::cli
```bash
aws dms describe-table-statistics --region "$REGION" --replication-task-arn "$TASK_ARN" \
  --query 'TableStatistics[].{Table:TableName,Inserts:Inserts,Updates:Updates,Deletes:Deletes}'
```
:::

> [!CHECK]
> The target now has 6 rows: `eva` and the second `ben` order appear, Ana's keyboard has quantity 5, and `dee` is gone. Table statistics show 2 inserts, 1 update and 1 delete. This is the CDC phase that lets a real migration run for days or weeks before a cutover of a few minutes.

### Step 10: Simulate the cutover

In a real cutover you stop application writes to the source, wait until the task's CDC latency is near zero, stop the task, and point the application at the target.

:::console
1. Select `demo-task` and choose **Actions** → **Stop**, then confirm.
2. Insert one more row on the source and confirm it does **not** reach the target.
:::

:::cli
```bash
aws dms stop-replication-task --region "$REGION" --replication-task-arn "$TASK_ARN"
aws dms wait replication-task-stopped --region "$REGION" \
  --filters Name=replication-task-arn,Values="$TASK_ARN"
```
:::

> [!CHECK]
> The task status is **Stopped** and new source rows no longer appear on the target: from now on the target is the system of record.

## Cleanup

Delete in this order.

- [ ] Delete the task `demo-task`: **Database migration tasks** → select → **Actions** → **Delete** (it must be stopped).
- [ ] Delete the endpoints `demo-src` and `demo-tgt`: **Endpoints** → select → **Actions** → **Delete**.
- [ ] Delete the replication instance `demo-dms-ri`: **Replication instances** → select → **Actions** → **Delete**. Wait until it is gone.
- [ ] Delete the replication subnet group: `demo-dms-subnets` (CLI path) or the one the console created for the default VPC, under **Subnet groups** (free, but tidy).
- [ ] Delete `demo-dms-source` and `demo-dms-target`: **RDS** → **Databases** → **Actions** → **Delete**, clear **Create final snapshot** and **Retain automated backups**, confirm.
- [ ] Delete the parameter group `demo-mysql84-dms` after both databases are gone.
- [ ] Terminate `demo-db-client`: **EC2** → **Instances** → **Instance state** → **Terminate (delete) instance**.
- [ ] Delete the security groups `demo-db-sg` first (it references the others), then `demo-dms-sg` and `demo-client-sg`. If deletion fails, wait a few minutes for DMS and RDS network interfaces to be released.
- [ ] Optional: keep the IAM role `dms-vpc-role` (free, needed for any future DMS use) or delete it if you created it only for this lab.

:::cli
```bash
aws dms delete-replication-task --region "$REGION" --replication-task-arn "$TASK_ARN"
aws dms wait replication-task-deleted --region "$REGION" --filters Name=replication-task-arn,Values="$TASK_ARN"
aws dms delete-endpoint --region "$REGION" --endpoint-arn "$SRC_ARN"
aws dms delete-endpoint --region "$REGION" --endpoint-arn "$TGT_ARN"
aws dms delete-replication-instance --region "$REGION" --replication-instance-arn "$RI_ARN"
aws dms wait replication-instance-deleted --region "$REGION" --filters Name=replication-instance-arn,Values="$RI_ARN"
aws dms delete-replication-subnet-group --region "$REGION" --replication-subnet-group-identifier demo-dms-subnets

aws rds delete-db-instance --region "$REGION" --db-instance-identifier demo-dms-source --skip-final-snapshot --delete-automated-backups
aws rds delete-db-instance --region "$REGION" --db-instance-identifier demo-dms-target --skip-final-snapshot --delete-automated-backups
aws rds wait db-instance-deleted --region "$REGION" --db-instance-identifier demo-dms-source
aws rds wait db-instance-deleted --region "$REGION" --db-instance-identifier demo-dms-target
aws rds delete-db-parameter-group --region "$REGION" --db-parameter-group-name demo-mysql84-dms

aws ec2 terminate-instances --region "$REGION" --instance-ids "$INSTANCE_ID"
aws ec2 wait instance-terminated --region "$REGION" --instance-ids "$INSTANCE_ID"
aws ec2 delete-security-group --region "$REGION" --group-id "$DB_SG"
aws ec2 delete-security-group --region "$REGION" --group-id "$DMS_SG"
aws ec2 delete-security-group --region "$REGION" --group-id "$CLIENT_SG"
```
:::

> [!CHECK]
> Final check: the DMS console shows no tasks, endpoints or replication instances; **RDS** → **Databases** is empty and **Automated backups** → **Retained** shows nothing from this lab; no `demo-db-client` instance is running. Check **Billing and Cost Management** → **Bills** the next day.

## Progress checklist

- [ ] Step 1: Security groups and EC2 client created
- [ ] Step 2: Parameter group with `binlog_format = ROW` and `local_infile = 1` created
- [ ] Step 3: Source and target RDS for MySQL 8.4 databases available
- [ ] Step 4: DMS replication instance available
- [ ] Step 5: Sample table with a secondary index created on the source
- [ ] Step 6: Both endpoints tested successfully
- [ ] Step 7: Full load plus CDC task running
- [ ] Step 8: Saw that DMS created the table and primary key but not the secondary index
- [ ] Step 9: Inserts, updates and deletes replicated through CDC
- [ ] Step 10: Task stopped to simulate cutover
- [ ] Cleanup done
