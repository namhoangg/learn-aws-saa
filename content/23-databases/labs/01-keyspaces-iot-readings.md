---
id: 23-databases-lab-01
title: Model IoT sensor readings in Amazon Keyspaces with CQL
objective: Create a serverless Cassandra-compatible keyspace and table, write and query sensor readings with CQL from AWS CloudShell, see how the partition key decides which queries are efficient, and confirm point-in-time recovery.
estimatedTime: 35 minutes
cost: "Well under USD 0.01 in on-demand mode: a few dozen read and write request units plus a few KB of storage and PITR storage. CloudShell has no extra charge. Nothing here is Always Free, so the tiny usage is billed (or drawn from Free Tier credits if your account has them)."
freeTier: partial
services: [keyspaces, cloudshell, iam]
---

> [!COST]
> Amazon Keyspaces in on-demand mode bills per read request unit, per write request unit and per GB-month of storage, and point-in-time recovery adds a per-GB-month charge. This lab writes about ten small rows and reads them a handful of times, so the total is a tiny fraction of a cent, but the table keeps billing storage until you delete it. Delete the keyspace at the end (Cleanup).

Amazon Keyspaces has no servers or clusters to create: you define a keyspace and a table, and AWS stores every table as three copies across Availability Zones. You will model a typical IoT access pattern, "latest readings of one device", and see why the same table cannot efficiently answer "all hot readings anywhere".

## Prerequisites

- An AWS account and an IAM user or role allowed to use Amazon Keyspaces and AWS CloudShell (for a sandbox account, the AWS managed policies `AmazonKeyspacesFullAccess` and `AWSCloudShellFullAccess`).
- A Region where both Amazon Keyspaces and CloudShell are available, for example **US East (N. Virginia) us-east-1**. Use the same Region for every step.
- No local tools are needed: CQL runs in CloudShell, which signs requests with your console credentials (SigV4), so you do not create any database passwords.

## Steps

### Step 1: Create a single-Region keyspace

A keyspace groups tables and sets their replication strategy. Single-Region replication keeps three copies of every table in three AZs.

:::console
1. Open the **Amazon Keyspaces** console and choose **Keyspaces** in the navigation pane.
2. Choose **Create keyspace**.
3. For **Keyspace name**, enter `iot_lab`.
4. Under **AWS Regions**, keep **Single-Region replication**.
5. Choose **Create keyspace**.
:::

:::cli
```bash
aws keyspaces create-keyspace --keyspace-name iot_lab
aws keyspaces get-keyspace --keyspace-name iot_lab
```
:::

> [!CHECK]
> `iot_lab` appears in the **Keyspaces** list. From the CLI, `get-keyspace` shows `"replicationStrategy": "SINGLE_REGION"`. You did not choose any instance, node count or disk size.

### Step 2: Create a table designed for one query pattern

The question the app asks most is "show the latest readings of device X". So `device_id` is the **partition key** (all readings of one device live together) and `reading_time` is a **clustering column** sorted newest first.

:::console
1. In the navigation pane choose **Keyspaces**, then choose `iot_lab`.
2. Choose **Create table** and enter **Table name** `sensor_readings`.
3. In **Columns**, add these columns, using **Add column** for each new row:
   - `device_id`, type `text`
   - `reading_time`, type `timestamp`
   - `site_id`, type `text`
   - `temperature`, type `double`
   - `humidity`, type `double`
4. Under **Partition Key**, choose `device_id`.
5. Choose **Add clustering column**, select `reading_time` and set **Order** to **DESC**.
6. In **Table settings**, keep **Default settings** (on-demand capacity).
7. Choose **Create table**. The status shows **Creating** for a few seconds, then **Active**.
:::

:::cli
```bash
aws keyspaces create-table --keyspace-name iot_lab --table-name sensor_readings \
  --schema-definition 'allColumns=[{name=device_id,type=text},{name=reading_time,type=timestamp},{name=site_id,type=text},{name=temperature,type=double},{name=humidity,type=double}],partitionKeys=[{name=device_id}],clusteringKeys=[{name=reading_time,orderBy=DESC}]'

# Wait until the status is ACTIVE (table creation is asynchronous)
aws keyspaces get-table --keyspace-name iot_lab --table-name sensor_readings \
  --query '{status:status,capacity:capacitySpecification.throughputMode,pitr:pointInTimeRecovery.status}'
```
:::

> [!CHECK]
> The table is **Active**, the capacity mode is **On-demand** (`PAY_PER_REQUEST` in the CLI) and the schema shows `device_id` as partition key and `reading_time` as a descending clustering column. Note the PITR status for Step 6: the console turns PITR on by default, the CLI leaves it off unless you ask.

### Step 3: Open a CQL session in CloudShell

:::console
1. In the Keyspaces console, open the keyspace `iot_lab`.
2. Choose the **Connect to Keyspaces** AWS CloudShell button. CloudShell opens with a pre-filled command that initialises `cqlsh-expansion` and connects to the Regional endpoint.
3. Choose **Run** and wait until the `cqlsh` prompt appears.
:::

:::cli
```bash
# Manual alternative inside CloudShell (same Region as the keyspace)
python3 -m pip install --user cqlsh-expansion
cqlsh-expansion.init
cqlsh-expansion cassandra.us-east-1.amazonaws.com 9142 --ssl
```
:::

> [!CHECK]
> The banner says you are connected to Amazon Keyspaces on port **9142**, and the prompt is `cqlsh>` (or `cqlsh:iot_lab>`). Port 9142 with TLS is the only way in; Keyspaces rejects unencrypted connections.

### Step 4: Write readings with CQL

Keyspaces needs `LOCAL_QUORUM` for writes from `cqlsh`, so set it first. Then insert readings for two devices at two sites. Paste these statements at the `cqlsh` prompt:

```sql
CONSISTENCY LOCAL_QUORUM;
USE iot_lab;

INSERT INTO sensor_readings (device_id, reading_time, site_id, temperature, humidity) VALUES ('sensor-001', '2026-10-03 10:00:00+0000', 'site-a', 21.4, 40.1);
INSERT INTO sensor_readings (device_id, reading_time, site_id, temperature, humidity) VALUES ('sensor-001', '2026-10-03 10:05:00+0000', 'site-a', 22.0, 39.8);
INSERT INTO sensor_readings (device_id, reading_time, site_id, temperature, humidity) VALUES ('sensor-001', '2026-10-03 10:10:00+0000', 'site-a', 23.1, 39.5);
INSERT INTO sensor_readings (device_id, reading_time, site_id, temperature, humidity) VALUES ('sensor-001', '2026-10-03 10:15:00+0000', 'site-a', 31.7, 35.2);
INSERT INTO sensor_readings (device_id, reading_time, site_id, temperature, humidity) VALUES ('sensor-002', '2026-10-03 10:00:00+0000', 'site-b', 18.9, 55.0);
INSERT INTO sensor_readings (device_id, reading_time, site_id, temperature, humidity) VALUES ('sensor-002', '2026-10-03 10:05:00+0000', 'site-b', 19.2, 54.6);
INSERT INTO sensor_readings (device_id, reading_time, site_id, temperature, humidity) VALUES ('sensor-002', '2026-10-03 10:10:00+0000', 'site-b', 30.4, 50.3);
```

> [!NOTE] No AWS CLI for data
> The AWS CLI manages keyspaces and tables (the control plane) only. Reading and writing rows in Amazon Keyspaces is always done with CQL, from `cqlsh`, the console's CQL editor or a Cassandra driver.

> [!CHECK]
> `SELECT device_id, reading_time FROM sensor_readings;` lists **7** rows (cqlsh prints `(7 rows)` under the result). Each `INSERT` returned silently; in Cassandra an insert with an existing primary key simply overwrites that row (an "upsert"). Do not try `COUNT(*)`: Amazon Keyspaces does not support CQL aggregate functions.

### Step 5: Query by partition key, then try a query the table was not designed for

Run the queries the table was designed for:

```sql
-- Latest readings of one device: newest first, thanks to the DESC clustering order
SELECT reading_time, temperature, humidity FROM sensor_readings WHERE device_id = 'sensor-001';

-- Only the last two readings
SELECT reading_time, temperature FROM sensor_readings WHERE device_id = 'sensor-001' LIMIT 2;

-- A time range inside one partition (range on the clustering column)
SELECT reading_time, temperature FROM sensor_readings
  WHERE device_id = 'sensor-001' AND reading_time >= '2026-10-03 10:05:00+0000' AND reading_time < '2026-10-03 10:15:00+0000';
```

Now ask a question that ignores the partition key:

```sql
SELECT device_id, reading_time, temperature FROM sensor_readings WHERE temperature > 30;
```

> [!CHECK]
> The first three queries return rows immediately, sorted newest first. The last one is **rejected** with an error telling you the query needs `ALLOW FILTERING`. Add `ALLOW FILTERING` to the end and it runs, returning the two hot readings, but only because the table is tiny: on a real table it would read every partition.

That is the exam lesson about wide-column and key-value stores: they are fast and cheap for queries that start from the partition key, and you handle a new access pattern (for example "readings per site") by creating **another table** keyed for it, not with joins or filters. Amazon Keyspaces does not support `CREATE INDEX` or materialized views, so a second table really is the way.

### Step 6: Confirm point-in-time recovery

:::console
1. In the navigation pane choose **Tables**, then choose `sensor_readings`.
2. Open the **Backups** tab and look at the **Point-in-time recovery** section.
3. If it is not enabled, choose **Edit**, select **Enable Point-in-time recovery** and choose **Save changes**.
:::

:::cli
```bash
aws keyspaces update-table --keyspace-name iot_lab --table-name sensor_readings \
  --point-in-time-recovery 'status=ENABLED'
aws keyspaces get-table --keyspace-name iot_lab --table-name sensor_readings \
  --query 'pointInTimeRecovery'
```
:::

> [!CHECK]
> PITR shows **Enabled** with an earliest restorable time a few minutes ago. From now on you could restore this table to any second in the last 35 days, always into a **new** table (console **Restore**, CLI `aws keyspaces restore-table`). You do not need to run a restore for this lab.

## Cleanup

- [ ] **Exit `cqlsh`**: type `exit`.
- [ ] **Table `sensor_readings`**: Keyspaces console → **Tables** → select it → **Delete** → type `Delete` → **Delete table**. CLI: `aws keyspaces delete-table --keyspace-name iot_lab --table-name sensor_readings`. Because PITR was on, Keyspaces keeps a restorable copy of the deleted table for 35 days at no extra cost; nothing else to remove.
- [ ] **Keyspace `iot_lab`** (this also deletes any table still inside it): **Keyspaces** → select it → **Delete** → type `Delete` → **Delete keyspace**. CLI: `aws keyspaces delete-keyspace --keyspace-name iot_lab`.
- [ ] **Optional: CloudShell tools** if you installed them manually: `pip3 uninstall -y cqlsh-expansion` and `rm -rf ~/.cassandra` (they cost nothing, but the CloudShell home directory keeps them).
- [ ] **Final check**: `aws keyspaces list-keyspaces --query 'keyspaces[].keyspaceName'` lists only the `system...` keyspaces (deletion is asynchronous, so re-run after a minute if `iot_lab` still shows).

## Progress checklist

- [ ] Step 1: Created the single-Region keyspace `iot_lab`
- [ ] Step 2: Created `sensor_readings` with `device_id` as partition key and `reading_time` DESC as clustering column
- [ ] Step 3: Connected to Keyspaces with `cqlsh` in CloudShell on port 9142
- [ ] Step 4: Inserted seven readings with `LOCAL_QUORUM`
- [ ] Step 5: Ran partition-key queries and saw the non-key query rejected without `ALLOW FILTERING`
- [ ] Step 6: Confirmed point-in-time recovery is enabled
- [ ] Cleanup done: table and keyspace deleted
