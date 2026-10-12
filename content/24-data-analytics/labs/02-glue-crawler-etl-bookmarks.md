---
id: 24-data-analytics-lab-02
title: Catalog raw CSV with a Glue crawler and convert it to Parquet with a Glue ETL job
objective: Let a Glue crawler discover the schema and partitions of the lab's raw CSV orders, build a Glue Studio visual job that writes Snappy Parquet and registers its own Data Catalog table, then prove that job bookmarks process only the files added since the last run.
estimatedTime: 50 minutes
cost: "About USD 0.30 to 0.50: two crawler runs and two short Spark job runs on 2 G.1X workers at USD 0.44 per DPU-hour (us-east-1; Glue 6.0 Spark jobs cost about 30% less), plus fractions of a cent for Athena and S3. Glue has no Always Free compute; Free Tier credits on new accounts cover it."
freeTier: partial
services: [glue, glue-data-catalog, s3, athena, iam, cloudshell]
---

> [!COST]
> AWS Glue bills crawlers and ETL jobs per **DPU-hour** (USD 0.44 in us-east-1, billed per second). A Spark job run is billed for at least 1 minute and a crawler run for at least 10 minutes, so each crawl costs 10 minutes of DPU time even when it finishes in one or two. With two crawls (roughly 2 DPUs each) and two job runs of 2 DPUs for a couple of minutes, expect about USD 0.30 to 0.50. The Data Catalog itself is free for the first million objects. Don't start Glue Studio **data preview** sessions in this lab: they run an interactive session that is billed separately.

Lab 01 created the table by hand with a `CREATE EXTERNAL TABLE` statement. Here a **crawler** works the schema and partitions out for you, and a **Glue ETL job** performs the CSV-to-Parquet conversion that the lesson describes as the classic way to make Athena cheaper. Last, you add a new month of data and watch the **job bookmark** stop the job from converting the old months a second time.

## Prerequisites

- Lab 01 Steps 1 to 3 completed and not cleaned up: the bucket `datalab-<account>-<region>` with `raw/sales/` data, the Athena workgroup `datalab-wg` (per-query limit back at 1 GB), and the `datalab` database. If you did lab 01's cleanup, repeat those three steps first.
- An IAM identity that can create IAM roles and use Glue, Athena and S3 (for example `AdministratorAccess` in a personal lab account).
- The same Region as lab 01, and **AWS CloudShell** with `make_sales.py` from lab 01 still in your home directory (CloudShell keeps your home directory between sessions). If it is gone, recreate it with the first command block of lab 01 Step 1.
- In CloudShell, set the shared variables again (they do not survive a new session):

  ```bash
  REGION=${AWS_REGION:-$(aws configure get region)}
  ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
  BUCKET=datalab-$ACCOUNT-$REGION
  echo "$BUCKET"
  ```

> [!NOTE]
> If your account has turned on AWS Lake Formation permissions for the Data Catalog (not the default for new accounts), the Glue role also needs Lake Formation grants on the `datalab` database. In a fresh account, IAM permissions alone are enough.

## Steps

### Step 1: Create an IAM role for Glue

Crawlers and jobs act through a role that Glue assumes. The AWS managed policy `AWSGlueServiceRole` covers the Glue, CloudWatch Logs and `aws-glue-*` bucket permissions; you add an inline policy for the lab bucket.

:::console
1. Open the **IAM** console and choose **Roles** → **Create role**.
2. For **Trusted entity type** choose **AWS service**. Under **Service or use case** choose **Glue**, then choose **Next**.
3. In **Permissions policies**, search for `AWSGlueServiceRole`, select it and choose **Next**.
4. For **Role name** enter `AWSGlueServiceRole-datalab` and choose **Create role**.
5. Open the new role, choose **Add permissions** → **Create inline policy**, switch the **Policy editor** to **JSON** and paste the policy below (replace `<your-bucket>` twice). Choose **Next**, name it `datalab-s3-access` and choose **Create policy**.

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
         "Resource": "arn:aws:s3:::<your-bucket>/*"
       },
       {
         "Effect": "Allow",
         "Action": "s3:ListBucket",
         "Resource": "arn:aws:s3:::<your-bucket>"
       }
     ]
   }
   ```
:::

:::cli
```bash
cat > glue-trust.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Service": "glue.amazonaws.com"},
    "Action": "sts:AssumeRole"
  }]
}
EOF

cat > glue-s3.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {"Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
     "Resource": "arn:aws:s3:::$BUCKET/*"},
    {"Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::$BUCKET"}
  ]
}
EOF

aws iam create-role --role-name AWSGlueServiceRole-datalab \
  --assume-role-policy-document file://glue-trust.json
aws iam attach-role-policy --role-name AWSGlueServiceRole-datalab \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSGlueServiceRole
aws iam put-role-policy --role-name AWSGlueServiceRole-datalab \
  --policy-name datalab-s3-access --policy-document file://glue-s3.json
```
:::

> [!CHECK]
> The role's **Trust relationships** tab names `glue.amazonaws.com`, and its **Permissions** tab lists the managed policy `AWSGlueServiceRole` and the inline policy `datalab-s3-access`.

### Step 2: Create and run a crawler on the raw CSV

:::console
1. Open the **AWS Glue** console. In the navigation pane, under **Data Catalog**, choose **Crawlers** → **Create crawler**.
2. **Set crawler properties**: for **Name** enter `datalab-raw-crawler` and choose **Next**.
3. **Choose data sources and classifiers**: keep **Not yet** for **Is your data already mapped to Glue tables?** and choose **Add a data source**. Set **Data source** to **S3**, keep the location **In this account**, enter **S3 path** `s3://<your-bucket>/raw/sales/`, keep **Crawl all sub-folders** for subsequent runs, and choose **Add an S3 data source**. Choose **Next**.
4. **Configure security settings**: for **IAM role** choose `AWSGlueServiceRole-datalab` and choose **Next**.
5. **Set output and scheduling**: for **Target database** choose `datalab`, for **Table name prefix** enter `raw_`, and keep the crawler schedule **Frequency** at **On demand**. Choose **Next**.
6. Review the settings and choose **Create crawler**.
7. On the crawler's page choose **Run crawler**, then refresh until the state returns to **Ready** (one to two minutes).
:::

:::cli
```bash
aws glue create-crawler --name datalab-raw-crawler \
  --role AWSGlueServiceRole-datalab \
  --database-name datalab --table-prefix raw_ \
  --targets "S3Targets=[{Path=s3://$BUCKET/raw/sales/}]"

# Helper: start the crawler, wait until it is READY again, then print the result of the crawl.
run_crawler() {
  aws glue start-crawler --name datalab-raw-crawler
  sleep 30
  until [ "$(aws glue get-crawler --name datalab-raw-crawler --query Crawler.State --output text)" = READY ]; do
    sleep 15
  done
  aws glue get-crawler --name datalab-raw-crawler --query 'Crawler.LastCrawl.Status'
}
run_crawler
```
:::

> [!CHECK]
> The crawl finishes with status **Succeeded** (CLI: `"SUCCEEDED"`), and the run summary reports one table created. The crawler named the table after the last folder of the include path (`sales`) plus your prefix: `raw_sales`.

### Step 3: Inspect the discovered table and query it

:::console
1. In the Glue console choose **Data Catalog** → **Databases** → `datalab`, then open the table `raw_sales`.
2. Look at the **Schema**: twelve columns with inferred types, plus `year` and `month` marked as partition keys. Choose **View partitions** (or the **Partitions** tab) and check the three values.
3. In the **Athena** query editor (workgroup `datalab-wg`), run:

   ```sql
   SELECT year, month, COUNT(*) AS orders
   FROM datalab.raw_sales
   GROUP BY year, month
   ORDER BY month;
   ```
:::

:::cli
```bash
aws glue get-table --database-name datalab --name raw_sales \
  --query 'Table.{Location:StorageDescriptor.Location,Columns:StorageDescriptor.Columns[].[Name,Type],PartitionKeys:PartitionKeys[].Name}'
aws glue get-partitions --database-name datalab --table-name raw_sales \
  --query 'Partitions[].Values' --output text

# Same helper as lab 01: run a statement in datalab-wg and print state, bytes scanned and rows.
athq() {
  local QID STATE
  QID=$(aws athena start-query-execution --work-group datalab-wg \
    --query-string "$1" --query QueryExecutionId --output text) || return
  while :; do
    STATE=$(aws athena get-query-execution --query-execution-id "$QID" \
      --query QueryExecution.Status.State --output text)
    case "$STATE" in SUCCEEDED|FAILED|CANCELLED) break ;; esac
    sleep 2
  done
  aws athena get-query-execution --query-execution-id "$QID" --output table \
    --query 'QueryExecution.{State:Status.State,BytesScanned:Statistics.DataScannedInBytes,Reason:Status.StateChangeReason}'
  if [ "$STATE" = SUCCEEDED ]; then
    aws athena get-query-results --query-execution-id "$QID" --max-items 15 \
      --query 'ResultSet.Rows[*].Data[*].VarCharValue' --output text
  fi
}
athq "SELECT year, month, COUNT(*) AS orders FROM datalab.raw_sales GROUP BY year, month ORDER BY month"
```
:::

> [!CHECK]
> The crawler detected the header row, so the column names match the CSV header (`order_id`, `order_date`, ... `notes`), numeric columns got numeric types such as `bigint` and `double`, and the partitions are `2026,07`, `2026,08` and `2026,09`. Athena returns 100,000 orders for each month without you writing any DDL or running `MSCK REPAIR TABLE`.

### Step 4: Build a visual ETL job that writes partitioned Parquet

The job reads `raw_sales` from the catalog, drops the bulky free-text `notes` column, and writes Snappy Parquet partitioned by year and month. It also creates and maintains its own catalog table, so you will not need another crawler for the output.

:::console
1. In the Glue console navigation pane choose **ETL jobs**, then **Visual ETL**. An empty job canvas opens.
2. Open the **Add nodes** panel (the **+** button). On the **Sources** tab choose **AWS Glue Data Catalog**. Select the new node and, in its properties, set **Database** to `datalab` and **Table** to `raw_sales`. If Glue Studio offers to start a data preview session, decline it.
3. With the source node selected, open **Add nodes** again and on the **Transforms** tab choose **Drop Fields**. In its properties, tick `notes`.
4. With the **Drop Fields** node selected, open **Add nodes** and on the **Targets** tab choose **Amazon S3**. Set:
   - **Format**: **Parquet**
   - **Compression Type**: **Snappy**
   - **S3 Target Location**: `s3://<your-bucket>/curated/sales_glue/`
   - **Data catalog update options**: **Create a table in the Data Catalog and on subsequent runs, update the schema and add new partitions**
   - **Database**: `datalab`; **Table name**: `sales_glue_parquet`
   - **Partition keys**: choose **Add a partition key** and pick `year`, then add `month`
5. Open the **Job details** tab and set:
   - **Name**: `datalab-csv-to-parquet` (you can also rename the job at the top left of the editor)
   - **IAM Role**: `AWSGlueServiceRole-datalab`
   - **Type**: **Spark**; **Glue version**: keep the default; **Language**: **Python 3**
   - **Worker type**: **G.1X**; **Requested number of workers**: `2` (the default is higher and costs more)
   - **Job bookmark**: **Enable**
   - **Number of retries**: `0`; **Job timeout (minutes)**: `15`
6. Choose **Save**, then **Run**. Open the **Runs** tab and refresh until **Run status** shows **Succeeded** (usually two to three minutes including start-up).
:::

:::cli
```bash
# Save the job script locally, then upload it to the lab bucket.
cat > csv_to_parquet.py <<'EOF'
import sys
from awsglue.context import GlueContext
from awsglue.job import Job
from awsglue.transforms import DropFields
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext

args = getResolvedOptions(sys.argv, ["JOB_NAME", "OUTPUT_PATH"])
glueContext = GlueContext(SparkContext())
job = Job(glueContext)
job.init(args["JOB_NAME"], args)

# The transformation_ctx names are what the job bookmark uses to remember processed files.
raw = glueContext.create_dynamic_frame.from_catalog(
    database="datalab", table_name="raw_sales", transformation_ctx="raw")
slim = DropFields.apply(frame=raw, paths=["notes"], transformation_ctx="slim")

sink = glueContext.getSink(
    path=args["OUTPUT_PATH"], connection_type="s3",
    updateBehavior="UPDATE_IN_DATABASE", partitionKeys=["year", "month"],
    compression="snappy", enableUpdateCatalog=True, transformation_ctx="sink")
sink.setCatalogInfo(catalogDatabase="datalab", catalogTableName="sales_glue_parquet")
sink.setFormat("parquet", useGlueParquetWriter=True)
sink.writeFrame(slim)
job.commit()
EOF
aws s3 cp csv_to_parquet.py "s3://$BUCKET/scripts/csv_to_parquet.py"

aws glue create-job --name datalab-csv-to-parquet \
  --role AWSGlueServiceRole-datalab \
  --command "Name=glueetl,ScriptLocation=s3://$BUCKET/scripts/csv_to_parquet.py,PythonVersion=3" \
  --glue-version 5.1 --worker-type G.1X --number-of-workers 2 --timeout 15 \
  --default-arguments "{\"--job-bookmark-option\":\"job-bookmark-enable\",\"--OUTPUT_PATH\":\"s3://$BUCKET/curated/sales_glue/\"}"

# Helper: start a run of the job, wait for it to finish, then print its state and duration.
run_job() {
  local RUN_ID STATE
  RUN_ID=$(aws glue start-job-run --job-name datalab-csv-to-parquet --query JobRunId --output text)
  while :; do
    STATE=$(aws glue get-job-run --job-name datalab-csv-to-parquet --run-id "$RUN_ID" \
      --query JobRun.JobRunState --output text)
    case "$STATE" in SUCCEEDED|FAILED|STOPPED|TIMEOUT|ERROR) break ;; esac
    sleep 15
  done
  aws glue get-job-run --job-name datalab-csv-to-parquet --run-id "$RUN_ID" \
    --query 'JobRun.{State:JobRunState,Seconds:ExecutionTime,Error:ErrorMessage}'
}
run_job
```
:::

> [!CHECK]
> The run ends in **Succeeded**. In S3, `curated/sales_glue/` now contains `year=2026/month=07/`, `month=08/` and `month=09/` folders of `.parquet` files (CLI: `aws s3 ls "s3://$BUCKET/curated/sales_glue/" --recursive --human-readable --summarize`). In the Glue console, **Data Catalog** → **Tables** shows a new table `sales_glue_parquet` created by the job itself, with 11 columns (no `notes`) and partition keys `year` and `month`.

### Step 5: Query the job's output with Athena

:::console
1. In the Athena query editor (workgroup `datalab-wg`), run the revenue report from lab 01 against the job's table:

   ```sql
   SELECT category,
          ROUND(SUM(quantity * unit_price * (1 - discount)), 2) AS revenue
   FROM datalab.sales_glue_parquet
   GROUP BY category
   ORDER BY revenue DESC;
   ```

2. Run a row count per month and keep the result for Step 6:

   ```sql
   SELECT month, COUNT(*) AS orders
   FROM datalab.sales_glue_parquet
   GROUP BY month
   ORDER BY month;
   ```
:::

:::cli
```bash
athq "SELECT category, ROUND(SUM(quantity * unit_price * (1 - discount)), 2) AS revenue FROM datalab.sales_glue_parquet GROUP BY category ORDER BY revenue DESC"
athq "SELECT month, COUNT(*) AS orders FROM datalab.sales_glue_parquet GROUP BY month ORDER BY month"
```
:::

> [!CHECK]
> The revenue per category matches the CSV results from lab 01, while **Data scanned** is a few megabytes at most instead of about 45 MB. The count shows 100,000 orders in each of months 07, 08 and 09.

### Step 6: Add a new month and prove the job bookmark

A real pipeline runs the same job every day. Without bookmarks it would convert every file again on each run and duplicate the output. Add October's data, refresh the catalog with the crawler, and run the job once more.

:::console
1. In CloudShell, generate and upload one more month:

   ```bash
   python3 make_sales.py 2026 10
   aws s3 cp sales/year=2026/month=10/ "s3://$BUCKET/raw/sales/year=2026/month=10/" --recursive
   ```

2. In the Glue console open **Crawlers** → `datalab-raw-crawler` → **Run crawler**, and wait for **Ready**. The run summary should report a table update (the new partition) rather than a new table.
3. Open **ETL jobs** → `datalab-csv-to-parquet` → **Run**. Wait for **Succeeded** on the **Runs** tab and compare its duration with the first run.
4. In Athena, run the per-month count from Step 5 again.
:::

:::cli
```bash
python3 make_sales.py 2026 10
aws s3 cp sales/year=2026/month=10/ "s3://$BUCKET/raw/sales/year=2026/month=10/" --recursive

run_crawler
aws glue get-partitions --database-name datalab --table-name raw_sales --query 'Partitions[].Values' --output text

run_job
athq "SELECT month, COUNT(*) AS orders FROM datalab.sales_glue_parquet GROUP BY month ORDER BY month"
aws s3 ls "s3://$BUCKET/curated/sales_glue/" --recursive | awk '{print $1, $4}'
```
:::

> [!CHECK]
> The count now shows **100,000 orders for each of months 07, 08, 09 and 10**, not 200,000 for the old months: the bookmark told the job that the July to September files were already processed, so it read only October's file. The S3 listing shows new files only under `month=10/`, with the older folders' timestamps unchanged, and the job added the `month=10` partition to `sales_glue_parquet` on its own. Lab 01's hand-made `sales_csv` table does not see October until you run `MSCK REPAIR TABLE datalab.sales_csv`, because only the crawler's table was refreshed.

> [!TIP]
> To reprocess everything on purpose (for example after fixing a bug in the job), reset the bookmark: use **Reset job bookmark** in the job's **Actions** menu, or run `aws glue reset-job-bookmark --job-name datalab-csv-to-parquet`.

## Cleanup

If you continue to lab 03, you can delete everything in this list except the S3 bucket and the `datalab` database, which lab 03 reuses. Delete in this order:

- [ ] **Glue job `datalab-csv-to-parquet`**: **ETL jobs** → select the job → choose the delete action in the **Actions** menu, and confirm. CLI: `aws glue delete-job --job-name datalab-csv-to-parquet`.
- [ ] **Crawler `datalab-raw-crawler`**: **Crawlers** → select the crawler → choose **Delete crawler** in the actions menu, and confirm. CLI: `aws glue delete-crawler --name datalab-raw-crawler`.
- [ ] **Tables `raw_sales` and `sales_glue_parquet`**: in Athena run `DROP TABLE datalab.raw_sales;` and `DROP TABLE datalab.sales_glue_parquet;` (this removes metadata only). CLI: `aws glue batch-delete-table --database-name datalab --tables-to-delete raw_sales sales_glue_parquet`.
- [ ] **Job output and script in the lab bucket**: CLI: `aws s3 rm "s3://$BUCKET/curated/sales_glue/" --recursive` and, for the CLI path, `aws s3 rm "s3://$BUCKET/scripts/" --recursive`. Optionally remove October's raw data with `aws s3 rm "s3://$BUCKET/raw/sales/year=2026/month=10/" --recursive`.
- [ ] **Glue Studio assets (console path)**: Glue Studio saved the generated script, temporary files and (with the Spark UI option it turns on by default) Spark event logs in a bucket named `aws-glue-assets-<account>-<region>`. Delete the `datalab-csv-to-parquet` script under `scripts/` and anything under `temporary/` and `sparkHistoryLogs/`; delete the whole bucket only if no other Glue jobs in this Region use it.
- [ ] **IAM role `AWSGlueServiceRole-datalab`**: **IAM** → **Roles** → select it → **Delete**, type the role name to confirm (this also removes its inline policy). CLI: `aws iam delete-role-policy --role-name AWSGlueServiceRole-datalab --policy-name datalab-s3-access`, then `aws iam detach-role-policy --role-name AWSGlueServiceRole-datalab --policy-arn arn:aws:iam::aws:policy/service-role/AWSGlueServiceRole`, then `aws iam delete-role --role-name AWSGlueServiceRole-datalab`.
- [ ] **CloudWatch log groups** `/aws-glue/crawlers`, `/aws-glue/jobs/output`, `/aws-glue/jobs/error` and, if continuous logging wrote there, `/aws-glue/jobs/logs-v2` (optional, tiny): delete them in the **CloudWatch** console under **Log groups** only if no other Glue jobs or crawlers in this Region log there. CLI: `aws logs delete-log-group --log-group-name /aws-glue/crawlers` (repeat for the others).
- [ ] **CloudShell files**: `rm -f ~/glue-trust.json ~/glue-s3.json ~/csv_to_parquet.py`.
- [ ] **Lab 01 resources**: unless you continue to lab 03, finish with the **Cleanup** section of lab 01 (database, workgroup, bucket, `make_sales.py` and `sales/`).
- [ ] **Final check**: the Glue console shows no `datalab-*` crawlers or jobs, and IAM has no `AWSGlueServiceRole-datalab` role. The next day, **Billing and Cost Management** → **Bills** shows only cents for AWS Glue.

## Progress checklist

- [ ] Step 1: Created `AWSGlueServiceRole-datalab` with the managed Glue policy and bucket access
- [ ] Step 2: Created and ran `datalab-raw-crawler`, which created `raw_sales`
- [ ] Step 3: Checked the inferred schema and partitions and queried `raw_sales` in Athena
- [ ] Step 4: Built and ran the CSV-to-Parquet job with a bookmark and catalog update
- [ ] Step 5: Queried `sales_glue_parquet` and compared the bytes scanned with the CSV
- [ ] Step 6: Added October, reran crawler and job, and confirmed no duplicates
- [ ] Cleanup done (or the bucket and database kept for lab 03)
