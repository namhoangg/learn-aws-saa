---
id: 24-data-analytics-lab-03
title: Load S3 data into Redshift Serverless with COPY and query the data lake in place
objective: Create a 4-RPU Redshift Serverless workgroup with a cost cap, bulk load the latest month of orders with COPY, then read older months straight from S3 through an external schema on the Glue Data Catalog and combine both in one query (the Spectrum hot/cold pattern).
estimatedTime: 45 minutes
cost: "About USD 0.30 to 0.75: Redshift Serverless bills USD 0.375 per RPU-hour in us-east-1 only while queries run (per second, 60-second minimum), so 4 RPUs cost about USD 1.50 per hour of active compute; managed storage for a few MB is negligible. A daily usage limit in Step 3 caps compute at 2 RPU-hours. First-time Redshift Serverless users may receive a USD 300 trial credit."
freeTier: partial
services: [redshift, redshift-spectrum, glue-data-catalog, s3, iam, cloudshell]
---

> [!COST]
> Redshift Serverless compute is billed in **RPU-hours** while the workgroup is serving queries: USD 0.375 per RPU-hour in us-east-1, billed per second with a 60-second minimum. With a base of 4 RPUs, one hour of active querying costs about USD 1.50; an idle workgroup costs nothing for compute, but managed storage (USD 0.024 per GB-month) is billed until you delete the namespace. Queries against S3 data from Redshift Serverless are included in the RPU charge, with no separate per-TB Spectrum fee. Step 3 adds a daily limit of 2 RPU-hours that turns off user queries if it is reached. Delete the workgroup and namespace in **Cleanup** as soon as you finish. New Redshift Serverless users may get a USD 300 trial credit (valid 90 days) that covers this lab.

This lab finishes the warehouse side of the lesson. Recent, frequently queried data (September) goes **into** Redshift with a bulk `COPY`. Older data (July and August) stays in S3 as the Parquet table you built in lab 01, and Redshift reads it in place through an **external schema** that points at the same Glue Data Catalog database Athena uses. One SQL query then reports across both.

## Prerequisites

- Lab 01 completed and not cleaned up: the bucket `datalab-<account>-<region>` with `raw/sales/` CSV data, and the `datalab` database containing the Parquet table `sales_parquet` (from lab 01 Step 6). Lab 02 is optional.
- An IAM identity with permissions to create IAM roles and to use Redshift Serverless and Query editor v2 (for example `AdministratorAccess` in a personal lab account). Use the **same identity** for the console and CloudShell: when you create the namespace in the console without custom admin credentials (Step 2), AWS documents that Redshift Serverless turns the identity you signed in with into a database superuser.
- A Region that offers 4-RPU base capacity, such as US East (N. Virginia) `us-east-1`, US East (Ohio), US West (Oregon), Europe (Ireland) or Asia Pacific (Tokyo). In other Regions use 8 RPUs (twice the cost per hour).
- The Region's **default VPC** with subnets in at least three Availability Zones (Redshift Serverless needs three AZs and a few free IP addresses).
- **AWS CloudShell**, with the shared variables set:

  ```bash
  REGION=${AWS_REGION:-$(aws configure get region)}
  ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
  BUCKET=datalab-$ACCOUNT-$REGION
  ROLE_ARN=arn:aws:iam::$ACCOUNT:role/datalab-redshift-role
  echo "$BUCKET  $ROLE_ARN"
  ```

> [!NOTE]
> If your account enforces AWS Lake Formation permissions on the Data Catalog (not the default in new accounts), Step 7 also needs a Lake Formation grant on the `datalab` database and its tables for `datalab-redshift-role`.

## Steps

### Step 1: Create an IAM role that Redshift can assume

`COPY` and external schemas run with an IAM role attached to the namespace, never with access keys in the SQL. The role below can read only the lab bucket and only the `datalab` catalog database.

:::console
1. Open the **IAM** console and choose **Roles** → **Create role**.
2. For **Trusted entity type** choose **Custom trust policy** and replace the editor content with:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Principal": {"Service": ["redshift.amazonaws.com", "redshift-serverless.amazonaws.com"]},
       "Action": "sts:AssumeRole"
     }]
   }
   ```

3. Choose **Next**, skip **Add permissions** with **Next**, enter **Role name** `datalab-redshift-role` and choose **Create role**.
4. Open the role, choose **Add permissions** → **Create inline policy**, switch the **Policy editor** to **JSON**, and paste the policy below after replacing `<your-bucket>`, `<region>` and `<account-id>`. Choose **Next**, name it `datalab-redshift-access`, and choose **Create policy**.

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "ReadLabBucket",
         "Effect": "Allow",
         "Action": ["s3:GetObject", "s3:ListBucket", "s3:GetBucketLocation"],
         "Resource": ["arn:aws:s3:::<your-bucket>", "arn:aws:s3:::<your-bucket>/*"]
       },
       {
         "Sid": "ReadLabCatalog",
         "Effect": "Allow",
         "Action": ["glue:GetDatabase", "glue:GetDatabases", "glue:GetTable", "glue:GetTables",
                    "glue:GetPartition", "glue:GetPartitions", "glue:BatchGetPartition"],
         "Resource": ["arn:aws:glue:<region>:<account-id>:catalog",
                      "arn:aws:glue:<region>:<account-id>:database/datalab",
                      "arn:aws:glue:<region>:<account-id>:table/datalab/*"]
       }
     ]
   }
   ```
:::

:::cli
```bash
cat > redshift-trust.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Service": ["redshift.amazonaws.com", "redshift-serverless.amazonaws.com"]},
    "Action": "sts:AssumeRole"
  }]
}
EOF

cat > redshift-access.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {"Sid": "ReadLabBucket", "Effect": "Allow",
     "Action": ["s3:GetObject", "s3:ListBucket", "s3:GetBucketLocation"],
     "Resource": ["arn:aws:s3:::$BUCKET", "arn:aws:s3:::$BUCKET/*"]},
    {"Sid": "ReadLabCatalog", "Effect": "Allow",
     "Action": ["glue:GetDatabase", "glue:GetDatabases", "glue:GetTable", "glue:GetTables",
                "glue:GetPartition", "glue:GetPartitions", "glue:BatchGetPartition"],
     "Resource": ["arn:aws:glue:$REGION:$ACCOUNT:catalog",
                  "arn:aws:glue:$REGION:$ACCOUNT:database/datalab",
                  "arn:aws:glue:$REGION:$ACCOUNT:table/datalab/*"]}
  ]
}
EOF

aws iam create-role --role-name datalab-redshift-role \
  --assume-role-policy-document file://redshift-trust.json
aws iam put-role-policy --role-name datalab-redshift-role \
  --policy-name datalab-redshift-access --policy-document file://redshift-access.json
```
:::

> [!CHECK]
> The role's **Trust relationships** tab lists both Redshift service principals, and **Permissions** shows only the inline policy `datalab-redshift-access`. The role can read the lab bucket and the `datalab` catalog database, and nothing else.

### Step 2: Create a namespace and a 4-RPU workgroup

A **namespace** holds the storage side (databases, schemas, tables, users, the attached roles); a **workgroup** holds the compute side (RPUs, network settings, endpoint).

:::console
1. Open the **Amazon Redshift** console and choose **Redshift Serverless** in the navigation pane. If a getting-started page appears, choose **Customize settings**; otherwise, on the **Serverless dashboard**, choose **Create workgroup**.
2. For the workgroup name enter `datalab-wg`.
3. In the capacity settings, choose to set a **Base capacity** (rather than a price-performance target) and select **4** RPUs.
4. Under network and security, keep **IPv4**, the **default VPC**, its **default** security group and the preselected subnets (they must cover three AZs). Leave enhanced VPC routing and extra compute for automatic optimizations turned off. Choose **Next**.
5. Choose **Create a new namespace** and enter `datalab-ns`. Keep the database name `dev`, and leave **Customize admin user credentials** cleared so your IAM identity acts as the administrator.
6. Under **Permissions**, use **Associate IAM roles** (in the **Manage IAM roles** menu) to attach `datalab-redshift-role`.
7. Keep the default encryption and no audit logging. Choose **Continue** (or **Next**), review the settings under **Review and create**, and choose **Save** (the button may read **Create**).
8. Wait until both the namespace and the workgroup show **Available** (usually a few minutes).
:::

:::cli
```bash
aws redshift-serverless create-namespace --namespace-name datalab-ns --db-name dev \
  --iam-roles "$ROLE_ARN" --default-iam-role-arn "$ROLE_ARN"

# Without --subnet-ids the workgroup uses the default VPC's subnets.
aws redshift-serverless create-workgroup --workgroup-name datalab-wg \
  --namespace-name datalab-ns --base-capacity 4

until [ "$(aws redshift-serverless get-workgroup --workgroup-name datalab-wg \
          --query workgroup.status --output text)" = AVAILABLE ]; do
  sleep 20
done
aws redshift-serverless get-workgroup --workgroup-name datalab-wg \
  --query 'workgroup.{Status:status,BaseRPU:baseCapacity,Endpoint:endpoint.address}'
```
:::

> [!CHECK]
> On the **Serverless dashboard**, `datalab-ns` and `datalab-wg` are **Available**, the workgroup's base capacity is 4 RPUs, and the namespace lists `datalab-redshift-role` under its associated IAM roles. Nothing has been billed for compute yet, because no query has run.

### Step 3: Cap compute with a daily usage limit

A usage limit is the Redshift Serverless equivalent of the Athena workgroup guardrail from lab 01: it watches RPU-hours and acts when a threshold is crossed.

:::console
1. In the navigation pane choose **Workgroup configuration** and open `datalab-wg`.
2. Open the **Limits** tab and choose **Manage usage limits**.
3. Add a limit of `2` RPU hours, set **Frequency** to **Daily**, and set the action to **Turn off user queries**. Save the changes.
:::

:::cli
```bash
WG_ARN=$(aws redshift-serverless get-workgroup --workgroup-name datalab-wg \
  --query workgroup.workgroupArn --output text)
aws redshift-serverless create-usage-limit --resource-arn "$WG_ARN" \
  --usage-type serverless-compute --amount 2 --period daily --breach-action deactivate
aws redshift-serverless list-usage-limits --resource-arn "$WG_ARN" \
  --query 'usageLimits[].{Amount:amount,Period:period,Action:breachAction}'
```
:::

> [!CHECK]
> The **Limits** tab shows one compute limit of 2 RPU-hours per day with the action that turns off user queries. At 4 RPUs that allows about 30 minutes of active querying per day, roughly USD 0.75 at most.

### Step 4: Connect with Query editor v2 and create a table

:::console
1. On the workgroup page choose **Query data**. Query editor v2 opens in a new browser tab. If it asks you to configure account settings on first use, keep the default AWS owned encryption key and continue.
2. In the tree panel on the left, choose `datalab-wg`. When asked how to authenticate, keep **Federated user** and choose **Create connection**.
3. Above the editor, make sure the workgroup is `datalab-wg` and the database is `dev`. Paste and run (**Run**):

   ```sql
   CREATE TABLE public.sales (
     order_id       VARCHAR(20),
     order_date     DATE,
     customer_id    VARCHAR(10),
     country        CHAR(2),
     channel        VARCHAR(10),
     product        VARCHAR(30),
     category       VARCHAR(20),
     quantity       SMALLINT,
     unit_price     DECIMAL(10,2),
     discount       DECIMAL(4,2),
     payment_method VARCHAR(10),
     notes          VARCHAR(200)
   )
   SORTKEY (order_date);
   ```
:::

:::cli
```bash
# Helper: run one SQL statement through the Redshift Data API as your IAM identity, wait, print CSV rows or the error.
rsql() {
  local ID STATUS
  ID=$(aws redshift-data execute-statement --workgroup-name datalab-wg --database dev \
    --result-format CSV --sql "$1" --query Id --output text) || return
  while :; do
    STATUS=$(aws redshift-data describe-statement --id "$ID" --query Status --output text)
    case "$STATUS" in FINISHED|FAILED|ABORTED) break ;; esac
    sleep 2
  done
  if [ "$STATUS" != FINISHED ]; then
    aws redshift-data describe-statement --id "$ID" --query Error --output text
  elif [ "$(aws redshift-data describe-statement --id "$ID" --query HasResultSet --output text)" = True ]; then
    aws redshift-data get-statement-result-v2 --id "$ID" --query 'Records[].CSVRecords' --output text
  else
    echo "$STATUS"
  fi
}

rsql "CREATE TABLE public.sales (
  order_id VARCHAR(20), order_date DATE, customer_id VARCHAR(10), country CHAR(2),
  channel VARCHAR(10), product VARCHAR(30), category VARCHAR(20), quantity SMALLINT,
  unit_price DECIMAL(10,2), discount DECIMAL(4,2), payment_method VARCHAR(10), notes VARCHAR(200))
SORTKEY (order_date)"
```
:::

> [!CHECK]
> The statement succeeds and `sales` appears under `dev` → `public` → **Tables** in the tree (refresh the tree if needed). The sort key on `order_date` stores rows in date order, so filters on a date range can skip whole blocks. Redshift has no indexes; sort keys, columnar storage and compression do that job.

> [!TIP]
> If a statement fails with a permission error, check that Query editor v2 or CloudShell is signed in as the IAM identity that created `datalab-ns` in the console: that is the identity AWS documents as the database superuser.

> [!VERIFY] Admin rights for a namespace created with the CLI
> Checked 2026-10-04. The page [Getting started with IAM credentials](https://docs.aws.amazon.com/redshift/latest/mgmt/serverless-iam-credentials.html) describes the creating IAM identity becoming a superuser only for namespaces set up in the console. The [CreateNamespace API](https://docs.aws.amazon.com/redshift-serverless/latest/APIReference/API_CreateNamespace.html) behind `create-namespace` instead takes an optional admin user name plus either a password or a password that Redshift manages in Secrets Manager, and says nothing about the caller's IAM identity. So AWS does not document what rights your IAM identity gets on a namespace made by the Step 2 CLI command, which sets no admin credentials.
>
> If a statement then fails with a permission error (most likely `CREATE EXTERNAL SCHEMA` in Step 7), you don't have to rebuild anything. Give the namespace an admin whose password Redshift keeps in Secrets Manager: **Namespace configuration** → `datalab-ns` → **Actions** → **Edit admin credentials** → **Manage admin credentials in AWS Secrets Manager** (enter an admin user name if the form asks for one), as described in [Creating a secret for database connection credentials](https://docs.aws.amazon.com/redshift/latest/mgmt/redshift-secrets-manager-integration-create.html). Then connect Query editor v2 to `datalab-wg` with the **AWS Secrets Manager** method, choose that secret and rerun the statement (the editor lists only secrets that carry a tag key starting with `Redshift`; add one in the Secrets Manager console if the secret is missing). From CloudShell, read the secret ARN with `aws redshift-serverless get-namespace --namespace-name datalab-ns --query namespace.adminPasswordSecretArn --output text` and add `--secret-arn <that ARN>` to the `aws redshift-data execute-statement` call inside `rsql`. The secret costs about USD 0.0006 per hour and is deleted together with the namespace in **Cleanup**. Recreating the namespace with the console steps of Step 2 also works.

### Step 5: Bulk load September with COPY

`COPY` reads every file under an S3 prefix in parallel across the workgroup's compute, which is why the lesson calls large batch loads the right way to fill a warehouse. Replace `<your-bucket>` and `<account-id>`.

:::console
1. In Query editor v2, run:

   ```sql
   COPY public.sales
   FROM 's3://<your-bucket>/raw/sales/year=2026/month=09/'
   IAM_ROLE 'arn:aws:iam::<account-id>:role/datalab-redshift-role'
   FORMAT AS CSV
   IGNOREHEADER 1
   DATEFORMAT 'YYYY-MM-DD';
   ```

2. Check what the load did:

   ```sql
   SELECT table_name, status, loaded_rows, source_file_count,
          duration / 1000000.0 AS seconds
   FROM sys_load_history
   ORDER BY start_time DESC
   LIMIT 5;
   ```
:::

:::cli
```bash
rsql "COPY public.sales
FROM 's3://$BUCKET/raw/sales/year=2026/month=09/'
IAM_ROLE '$ROLE_ARN'
FORMAT AS CSV IGNOREHEADER 1 DATEFORMAT 'YYYY-MM-DD'"

rsql "SELECT table_name, status, loaded_rows, source_file_count, duration / 1000000.0 AS seconds
FROM sys_load_history ORDER BY start_time DESC LIMIT 5"
```
:::

> [!CHECK]
> `sys_load_history` shows one completed load into `sales` with **100,000** `loaded_rows` from one source file, typically in a few seconds. If the `COPY` fails with an access error, check that `datalab-redshift-role` is associated with `datalab-ns` and that its inline policy names your bucket.

> [!WARNING]
> Loading the same rows with 100,000 separate `INSERT` statements from an application would take far longer and keep the workgroup busy (and billing) the whole time. Batch your writes: `COPY` from S3, Amazon Data Firehose, zero-ETL integrations or streaming ingestion.

### Step 6: Query the warehouse table

:::console
1. Run an aggregation over the loaded month:

   ```sql
   SELECT country,
          COUNT(*) AS orders,
          ROUND(SUM(quantity * unit_price * (1 - discount)), 2) AS revenue
   FROM public.sales
   GROUP BY country
   ORDER BY revenue DESC
   LIMIT 5;
   ```

2. Run a filtered query that benefits from the sort key:

   ```sql
   SELECT order_date, COUNT(*) AS orders
   FROM public.sales
   WHERE order_date BETWEEN '2026-09-10' AND '2026-09-12'
   GROUP BY order_date
   ORDER BY order_date;
   ```
:::

:::cli
```bash
rsql "SELECT country, COUNT(*) AS orders, ROUND(SUM(quantity * unit_price * (1 - discount)), 2) AS revenue
FROM public.sales GROUP BY country ORDER BY revenue DESC LIMIT 5"
rsql "SELECT order_date, COUNT(*) AS orders FROM public.sales
WHERE order_date BETWEEN '2026-09-10' AND '2026-09-12' GROUP BY order_date ORDER BY order_date"
```
:::

> [!CHECK]
> Both queries return in about a second or less: five countries with their order counts and revenue, then three September dates with roughly 3,300 orders each.

### Step 7: Point an external schema at the Glue Data Catalog

An external schema maps a Glue Data Catalog database into Redshift. Every table Athena or Glue registered in `datalab` becomes queryable from Redshift, while the files stay in S3. On provisioned DC2 and RA3 clusters this is Redshift Spectrum; on Redshift Serverless the same SQL runs on the workgroup's own RPUs.

:::console
1. Run (replace `<account-id>`):

   ```sql
   CREATE EXTERNAL SCHEMA lake
   FROM DATA CATALOG
   DATABASE 'datalab'
   IAM_ROLE 'arn:aws:iam::<account-id>:role/datalab-redshift-role';
   ```

2. List what Redshift now sees through it:

   ```sql
   SELECT schemaname, tablename, location
   FROM svv_external_tables
   WHERE schemaname = 'lake';
   ```

3. Query the Parquet table that Athena's CTAS created in lab 01:

   ```sql
   SELECT month, COUNT(*) AS orders
   FROM lake.sales_parquet
   GROUP BY month
   ORDER BY month;
   ```
:::

:::cli
```bash
rsql "CREATE EXTERNAL SCHEMA lake FROM DATA CATALOG DATABASE 'datalab' IAM_ROLE '$ROLE_ARN'"
rsql "SELECT schemaname, tablename, location FROM svv_external_tables WHERE schemaname = 'lake'"
rsql "SELECT month, COUNT(*) AS orders FROM lake.sales_parquet GROUP BY month ORDER BY month"
```
:::

> [!CHECK]
> `svv_external_tables` lists `sales_csv` and `sales_parquet` from lab 01 (plus `raw_sales` and `sales_glue_parquet` if you kept lab 02's tables), each with its S3 location. The count returns 100,000 orders for each of months 07, 08 and 09, read straight from the Parquet files in S3: the same catalog serves Athena, Glue and Redshift.

### Step 8: Report across warehouse and lake in one query

Keep September in Redshift for fast, frequent dashboards and leave July and August in S3 where storage is cheap. A `UNION ALL` reports across both.

:::console
1. Run:

   ```sql
   SELECT month, source, COUNT(*) AS orders, ROUND(SUM(revenue), 2) AS revenue
   FROM (
     SELECT TO_CHAR(order_date, 'MM') AS month, 'warehouse' AS source,
            CAST(quantity * unit_price * (1 - discount) AS DOUBLE PRECISION) AS revenue
     FROM public.sales
     UNION ALL
     SELECT month, 'lake' AS source,
            CAST(quantity * unit_price * (1 - discount) AS DOUBLE PRECISION) AS revenue
     FROM lake.sales_parquet
     WHERE month IN ('07', '08')
   ) AS t
   GROUP BY month, source
   ORDER BY month;
   ```

2. Try to delete rows from the lake table through Redshift:

   ```sql
   DELETE FROM lake.sales_parquet WHERE month = '07';
   ```
:::

:::cli
```bash
rsql "SELECT month, source, COUNT(*) AS orders, ROUND(SUM(revenue), 2) AS revenue FROM (
  SELECT TO_CHAR(order_date, 'MM') AS month, 'warehouse' AS source,
         CAST(quantity * unit_price * (1 - discount) AS DOUBLE PRECISION) AS revenue
  FROM public.sales
  UNION ALL
  SELECT month, 'lake' AS source,
         CAST(quantity * unit_price * (1 - discount) AS DOUBLE PRECISION) AS revenue
  FROM lake.sales_parquet WHERE month IN ('07', '08')
) AS t GROUP BY month, source ORDER BY month"

rsql "DELETE FROM lake.sales_parquet WHERE month = '07'"
```
:::

> [!CHECK]
> The report shows months 07 and 08 with source `lake` and month 09 with source `warehouse`, 100,000 orders each. The August revenue equals the sum of the August per-category figures Athena returned in lab 01 Step 5, give or take rounding. The `DELETE` fails with an error: Redshift cannot update or delete rows in an external table. It can only append to external Parquet or text tables with `INSERT INTO ... SELECT` (which would also need write permissions this role does not have). To change data lake files you rewrite them with tools such as Glue or EMR, or you load the data into Redshift first.

## Cleanup

Delete in this order (the namespace cannot be deleted while its workgroup exists):

- [ ] **Workgroup `datalab-wg`** (this also removes its usage limit): in the Redshift Serverless console choose **Workgroup configuration**, open `datalab-wg`, and use the delete action (shown as **Delete** in the **Actions** menu or as a delete button for the instance). Type `delete` and choose **Delete**. CLI: `aws redshift-serverless delete-workgroup --workgroup-name datalab-wg`, then repeat `aws redshift-serverless get-workgroup --workgroup-name datalab-wg` until it returns a ResourceNotFound error.
- [ ] **Namespace `datalab-ns`** with the `dev` database, the `sales` table, the `lake` external schema and, if you followed the Step 4 fallback, the Redshift-managed admin secret (dropping it does not touch the S3 files or the Glue catalog): **Namespace configuration** → select `datalab-ns` → **Actions** → **Delete namespace**. Don't create a snapshot; type `delete` and choose **Delete**. CLI: `aws redshift-serverless delete-namespace --namespace-name datalab-ns`.
- [ ] **IAM role `datalab-redshift-role`**: **IAM** → **Roles** → select it → **Delete**, type the role name to confirm. CLI: `aws iam delete-role-policy --role-name datalab-redshift-role --policy-name datalab-redshift-access`, then `aws iam delete-role --role-name datalab-redshift-role`.
- [ ] **Query editor v2 items** (free, optional): delete any saved queries or notebooks you created under **Queries** / **Notebooks**.
- [ ] **CloudShell files**: `rm -f ~/redshift-trust.json ~/redshift-access.json`.
- [ ] **Lab 01 and lab 02 resources**: if you kept them for this lab, finish with lab 02's **Cleanup** (if you did lab 02) and then lab 01's **Cleanup** (database, workgroup, bucket, local files).
- [ ] **Final check**: the **Serverless dashboard** shows no namespaces or workgroups, IAM has no `datalab-redshift-role`, and the next day **Billing and Cost Management** → **Bills** shows only a small Redshift charge (or one covered by the trial credit) and no ongoing RPU-hours.

## Progress checklist

- [ ] Step 1: Created `datalab-redshift-role` with a Redshift trust policy and read-only bucket and catalog access
- [ ] Step 2: Created `datalab-ns` and a 4-RPU `datalab-wg` with the role attached
- [ ] Step 3: Added a daily 2 RPU-hour usage limit that turns off user queries
- [ ] Step 4: Connected with Query editor v2 and created the `sales` table with a sort key
- [ ] Step 5: Loaded September with one `COPY` and checked `sys_load_history`
- [ ] Step 6: Ran aggregations on the warehouse table
- [ ] Step 7: Created the `lake` external schema and queried `sales_parquet` in S3
- [ ] Step 8: Combined warehouse and lake data in one report and saw that external rows can't be deleted from Redshift
- [ ] Cleanup done
