---
id: 35-other-services-lab-03
title: Explore and forecast costs, read Savings Plans advice and set up anomaly alerts
objective: Open Cost Explorer, break your costs down by service and day, produce a forecast, read Savings Plans recommendations, and make sure a Cost Anomaly Detection monitor with an email alert subscription watches your account.
estimatedTime: 30 minutes (plus up to 24 hours of data preparation if Cost Explorer was never opened in this account)
cost: "Free in the console: Cost Explorer's interface, Savings Plans recommendations and Cost Anomaly Detection have no charge. The CLI tab calls the Cost Explorer API, which costs USD 0.01 per paginated request, so the CLI path costs about USD 0.10 or less."
freeTier: partial
services: [cost-explorer, cost-anomaly-detection, savings-plans]
---

> [!COST]
> Nothing in the console steps is billed. Each request the CLI tab sends to the Cost Explorer API (`aws ce ...`) costs USD 0.01; this lab sends about ten (roughly USD 0.10 in total). Do not put these commands in a loop or a script that polls.

This lab uses your real billing data, so the numbers you see depend on what your account has run. A brand-new account may show only cents and may not have enough history for forecasts or recommendations yet; the steps still show you where everything lives.

## Prerequisites

- An AWS account where you can open **Billing and Cost Management**. Use the root user once to turn on **IAM user and role access to Billing information** (Account settings) if you work as an IAM user or role, and give that identity billing read permissions (for example the `AWSBillingReadOnlyAccess` managed policy) plus `ce:*` for the anomaly steps.
- In an AWS Organizations member account, the management account must allow Cost Explorer access; cost allocation tag and linked-account monitors can only be created in the management account.
- An email address you can read, for the anomaly alert subscription.
- For the CLI tabs: AWS CLI v2 in **AWS CloudShell** (GNU `date` is used below). Cost Explorer commands are sent to `us-east-1`, so each command includes `--region us-east-1`.

## Steps

### Step 1: Open (and if needed enable) Cost Explorer

:::console
1. Open the **Billing and Cost Management** console.
2. In the navigation pane choose **Cost Explorer**.
3. If you see **Welcome to Cost Explorer**, choose **Launch Cost Explorer**. AWS starts preparing the current month and the previous 13 months; the current month appears in about 24 hours, older data a few days later. Come back to Step 2 when data appears.
4. If Cost Explorer opens a chart straight away, it is already enabled.
:::

:::cli
```bash
# Cost Explorer can only be enabled from the console. This call (USD 0.01) simply
# confirms that data is available for the current month.
aws ce get-cost-and-usage --region us-east-1 \
  --time-period Start=$(date -u +%Y-%m-01),End=$(date -u -d tomorrow +%Y-%m-%d) \
  --granularity MONTHLY --metrics UnblendedCost \
  --query 'ResultsByTime[].Total.UnblendedCost' --output table
```
:::

> [!CHECK]
> The console shows a bar chart of recent monthly costs, or the CLI prints a month-to-date amount in USD. An error saying Cost Explorer is not enabled means Step 1 in the console has not finished preparing data yet.

> [!NOTE]
> Enabling Cost Explorer also sets up Cost Anomaly Detection with an AWS services monitor and a daily summary subscription (alerting when an anomaly exceeds USD 100 and 40% of expected spend). You look at it in Step 5.

### Step 2: Break down monthly cost by service

:::console
1. In Cost Explorer, use the **Report parameters** panel on the right.
2. Open the date calendar and choose **6M** (last six months), then **Apply**.
3. Set **Granularity** to **Monthly**.
4. Under **Group by**, choose the **Service** dimension.
5. Switch the chart style (top right of the chart) between **Bar** and **Stack**, and scroll down to the data table that lists cost per service per month.
:::

:::cli
```bash
LAST_MONTH=$(date -u -d "$(date -u +%Y-%m-01) -1 month" +%Y-%m-%d)
THIS_MONTH=$(date -u +%Y-%m-01)

aws ce get-cost-and-usage --region us-east-1 \
  --time-period Start=$LAST_MONTH,End=$THIS_MONTH \
  --granularity MONTHLY --metrics UnblendedCost \
  --group-by Type=DIMENSION,Key=SERVICE \
  --query 'ResultsByTime[0].Groups[].[Keys[0],Metrics.UnblendedCost.Amount]' \
  --output text | sort -t$'\t' -k2 -g -r | head -n 10
```
:::

> [!CHECK]
> You can name the three services that cost the most last month. These are the first places to look for savings, and the same grouping is what you would use to explain a spend increase to a finance team.

### Step 3: Drill into daily cost and produce a forecast

:::console
1. Set **Granularity** to **Daily** and choose the date range **MTD** (month to date). Keep **Group by** **Service** to see which service each day's spend came from.
2. Under **Filters**, choose **Service** and select one service from Step 2 to isolate it, then clear the filter again.
3. Now remove the grouping (under **Group by**, clear the dimension so there is no grouping); forecasts are not available for grouped charts.
4. Set **Granularity** to **Monthly**, open the calendar and, under the forecast options, choose **+3M**, then **Apply**.
:::

:::cli
```bash
START=$(date -u +%Y-%m-%d)
END=$(date -u -d "$(date -u +%Y-%m-01) +3 months" +%Y-%m-%d)

aws ce get-cost-forecast --region us-east-1 \
  --time-period Start=$START,End=$END \
  --metric UNBLENDED_COST --granularity MONTHLY \
  --prediction-interval-level 80 \
  --query '[Total.Amount, ForecastResultsByTime[].[TimePeriod.Start,MeanValue,PredictionIntervalLowerBound,PredictionIntervalUpperBound]]' \
  --output json
```
:::

> [!CHECK]
> Forecast months appear with a shaded or bracketed range around each value: the 80% prediction interval. A wide range means your past spend was irregular. If you get no forecast and a message about insufficient data, the account does not yet have enough billing history; that is expected for new accounts.

### Step 4: Read Savings Plans recommendations

:::console
1. In the Billing and Cost Management navigation pane, under **Savings Plans**, choose **Recommendations**.
2. In the recommendation options, choose **Compute** Savings Plans, a **1-year** term, **No upfront** payment and a **30-day** lookback period.
3. Read the summary: **Monthly On-Demand spend**, **Estimated monthly spend** and **Estimated monthly savings**, and the recommended hourly commitment.
4. Do **not** add anything to the cart. This lab only reads the recommendation; buying a Savings Plan is a 1- or 3-year financial commitment.
:::

:::cli
```bash
aws ce get-savings-plans-purchase-recommendation --region us-east-1 \
  --savings-plans-type COMPUTE_SP --term-in-years ONE_YEAR \
  --payment-option NO_UPFRONT --lookback-period-in-days THIRTY_DAYS \
  --query 'SavingsPlansPurchaseRecommendation.SavingsPlansPurchaseRecommendationSummary.[HourlyCommitmentToPurchase,EstimatedMonthlySavingsAmount,EstimatedSavingsPercentage]' \
  --output table
```
:::

> [!CHECK]
> Either you see a recommended hourly commitment with estimated savings, or the page says there is no recommendation because your steady compute usage is too small. Both are valid outcomes: recommendations only appear when there is consistent EC2, Fargate or Lambda usage to commit to.

### Step 5: Check the anomaly monitor and add an email alert subscription

:::console
1. In the Billing and Cost Management navigation pane choose **Cost Anomaly Detection**, then the **Cost monitors** tab.
2. Look for a monitor that tracks **AWS services**. Most accounts have one, created automatically when Cost Explorer was enabled. An account can have only one AWS managed services monitor.
3. If there is **no** services monitor: choose **Create monitor**, under **Monitor method** choose **Managed by AWS**, select **AWS services**, enter **Monitor name** `lab-services-monitor` and choose **Next**. Then go to item 5 below, choosing **Create a new subscription**.
4. If a services monitor **exists**: open the **Alert subscriptions** tab and choose **Create a subscription**.
5. Fill in the subscription: **Subscription name** `lab-weekly-anomaly-summary`; **Alerting frequency** **Weekly summaries**; **Alert recipients**: your email address; **Threshold**: an absolute threshold of `10` (USD). If you are on the **Create a subscription** page, select the services monitor in the **Cost monitors** section.
6. Choose **Create subscription** (or **Create monitor** if you came from item 3).
:::

:::cli
```bash
EMAIL="you@example.com"   # replace with your own address

aws ce get-anomaly-monitors --region us-east-1 \
  --query 'AnomalyMonitors[].[MonitorName,MonitorType,MonitorDimension]' --output table

MON_ARN=$(aws ce get-anomaly-monitors --region us-east-1 \
  --query "AnomalyMonitors[?MonitorDimension=='SERVICE'].MonitorArn | [0]" --output text)

# Only if no services monitor exists yet:
if [ "$MON_ARN" = "None" ] || [ -z "$MON_ARN" ]; then
  MON_ARN=$(aws ce create-anomaly-monitor --region us-east-1 \
    --anomaly-monitor '{"MonitorName":"lab-services-monitor","MonitorType":"DIMENSIONAL","MonitorDimension":"SERVICE"}' \
    --query MonitorArn --output text)
  echo "Created monitor (delete it in Cleanup if you do not want to keep it)"
fi
echo "Monitor: $MON_ARN"

cat > lab-subscription.json <<EOF
{
  "SubscriptionName": "lab-weekly-anomaly-summary",
  "MonitorArnList": ["$MON_ARN"],
  "Subscribers": [{ "Address": "$EMAIL", "Type": "EMAIL" }],
  "Frequency": "WEEKLY",
  "ThresholdExpression": {
    "Dimensions": {
      "Key": "ANOMALY_TOTAL_IMPACT_ABSOLUTE",
      "MatchOptions": ["GREATER_THAN_OR_EQUAL"],
      "Values": ["10"]
    }
  }
}
EOF

SUB_ARN=$(aws ce create-anomaly-subscription --region us-east-1 \
  --anomaly-subscription file://lab-subscription.json \
  --query SubscriptionArn --output text)
echo "Subscription: $SUB_ARN"
```
:::

> [!CHECK]
> The **Alert subscriptions** tab lists `lab-weekly-anomaly-summary` with frequency weekly, your email address and the services monitor attached. You did not have to tell it what "normal" spend looks like: the monitor learns that from your history, and the threshold only filters which detected anomalies are worth an email.

### Step 6: Review detected anomalies

:::console
1. Open the **Detected anomalies** tab. By default it shows the last 90 days.
2. If any anomaly is listed, open it and read **Top ranked potential root causes** (service, account, Region, usage type) and the cost impact, then choose **View in Cost Explorer** to see the spike on a chart.
3. If the list is empty, that simply means no unusual spend was found; newly used services also need about 10 days of history before anomalies can be detected for them.
:::

:::cli
```bash
aws ce get-anomalies --region us-east-1 \
  --date-interval StartDate=$(date -u -d '-90 days' +%Y-%m-%d) \
  --query 'Anomalies[].[AnomalyStartDate,Impact.TotalImpact,RootCauses[0].Service,RootCauses[0].Region]' \
  --output table
```
:::

> [!CHECK]
> You either see anomalies with a dollar impact and a root-cause service, or an empty list. Either way you now know where an alert email would lead you.

## Cleanup

- [ ] **Alert subscription `lab-weekly-anomaly-summary`** (delete it unless you want weekly emails; keeping it is free): **Cost Anomaly Detection** → **Alert subscriptions** → select it → **Delete** and confirm (if the console shows no delete action, use the CLI command); CLI `aws ce delete-anomaly-subscription --region us-east-1 --subscription-arn "$SUB_ARN"`.
- [ ] **Monitor `lab-services-monitor`** (only if you created it in Step 5 and do not want to keep it; do not delete the monitor AWS created for you): **Cost monitors** → select it → **Delete** and confirm (or use the CLI command); CLI `aws ce delete-anomaly-monitor --region us-east-1 --monitor-arn "$MON_ARN"`.
- [ ] **Local file** (optional): `rm lab-subscription.json`.
- [ ] **Final check**: no Savings Plan was purchased (**Savings Plans** → **Inventory** shows nothing new), and the **Alert subscriptions** tab shows only the subscriptions you intend to keep. Cost Explorer itself cannot be disabled and costs nothing in the console.

## Progress checklist

- [ ] Step 1: Opened or enabled Cost Explorer
- [ ] Step 2: Grouped the last six months of cost by service
- [ ] Step 3: Viewed daily cost and a 3-month forecast with its prediction interval
- [ ] Step 4: Read Savings Plans recommendations without buying anything
- [ ] Step 5: Confirmed the services monitor and created an email alert subscription
- [ ] Step 6: Reviewed detected anomalies and their root causes
- [ ] Cleanup done
