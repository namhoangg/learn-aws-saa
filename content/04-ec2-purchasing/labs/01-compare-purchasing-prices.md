---
id: 04-ec2-purchasing-lab-01
title: Compare On-Demand, Spot, Reserved Instance and Savings Plan prices without buying anything
objective: Use the EC2 and Billing and Cost Management consoles (and read-only CLI calls) to collect real prices for one instance type under each purchasing option, then decide which option fits three scenarios.
estimatedTime: 30 minutes
cost: "Free if you stay in the consoles and use the read-only EC2 and Service Quotas CLI calls. The optional Cost Explorer API call in Step 5 costs USD 0.01 per request."
freeTier: partial
services: [ec2, ec2-spot, ec2-reserved, savings-plans, cost-explorer]
---

> [!COST]
> Nothing in this lab launches or buys a resource. Browsing prices, Spot price history, Reserved
> Instance offerings and Savings Plans recommendations in the console is free, and so are the
> `aws ec2 describe-*` and `aws service-quotas` calls. The only billed action is the **optional**
> `aws ce get-savings-plans-purchase-recommendation` call in Step 5: AWS Cost Explorer charges
> USD 0.01 per API request. Never choose **Add to cart**, **Order all** or **Purchase** in this lab:
> Reserved Instance and Savings Plan purchases cannot be cancelled.

## Prerequisites

- An AWS account and an IAM identity that can read EC2, Service Quotas and Billing and Cost Management data (for example the `ReadOnlyAccess` managed policy plus Billing read access).
- AWS CLI v2 configured (`aws configure`) if you want to run the CLI tabs; AWS CloudShell works too.
- One Region to work in. The examples use `us-east-1`; replace it everywhere if you choose another.
- A blank note or spreadsheet with columns: *Option*, *Hourly price*, *Upfront*, *Effective hourly*, *Saving vs On-Demand*.

## Steps

### Step 1: Record the On-Demand price and your On-Demand quota

The On-Demand rate is the baseline every other option is compared with.

:::console
1. Open the [Amazon EC2 On-Demand pricing page](https://aws.amazon.com/ec2/pricing/on-demand/).
2. Select your **Region** and **Linux** as the operating system, then search for `m7i.large`.
3. Write the hourly price in your table as the *On-Demand* row.
4. Open the **Service Quotas** console, choose **AWS services** → **Amazon Elastic Compute Cloud (Amazon EC2)**, and type `On-Demand` in the search box.
5. Note the **Applied quota value** for **Running On-Demand Standard (A, C, D, H, I, M, R, T, Z) instances**. It is a number of vCPUs, not instances.
:::

:::cli
```bash
# Applied vCPU quota for running On-Demand Standard instances in this Region
aws service-quotas get-service-quota \
  --region us-east-1 \
  --service-code ec2 \
  --quota-code L-1216C47A \
  --query "Quota.[QuotaName,Value]" \
  --output table
```
:::

> [!CHECK]
> You have one On-Demand price (in us-east-1, `m7i.large` Linux was USD 0.1008 per hour when this
> lab was written) and a vCPU quota. An `m7i.large` has 2 vCPUs, so a quota of 5 vCPUs would allow
> only two of them at once.

### Step 2: Explore Spot price history

:::console
1. Open the **EC2** console and choose **Spot Requests** in the navigation pane.
2. Choose **Pricing history**.
3. For **Graph**, choose **Availability Zones**. Set **Instance type** to `m7i.large`, **Platform** to **Linux/UNIX** and **Date range** to the longest option.
4. Hover over the graph to read the current and average price for each AZ.
5. Switch **Graph** to **Instance Types**, pick one AZ and up to five types (for example `m7i.large`, `m6i.large`, `m7a.large`, `c7i.large`, `r7i.large`) and compare.
6. Add the lowest current Spot price for `m7i.large` to your table.
:::

:::cli
```bash
# Replace the start time with yesterday's date (UTC) to see recent prices per AZ
aws ec2 describe-spot-price-history \
  --region us-east-1 \
  --instance-types m7i.large m6i.large c7i.large \
  --product-descriptions "Linux/UNIX" \
  --start-time 2026-10-02T00:00:00 \
  --query "SpotPriceHistory[].[AvailabilityZone,InstanceType,SpotPrice,Timestamp]" \
  --output table
```
:::

> [!CHECK]
> Spot prices differ by AZ and by instance type, change slowly rather than minute by minute, and
> sit well below the On-Demand line. Each line you see is one **Spot capacity pool** (one type in
> one AZ). The history goes back about 90 days.

### Step 3: Browse Standard Reserved Instance offerings

> [!WARNING]
> You are only *searching*. Do not choose **Add to cart** or **Order all**. A Reserved Instance
> purchase starts billing immediately and cannot be cancelled.

:::console
1. In the **EC2** console, choose **Reserved Instances** → **Purchase Reserved Instances**.
2. Set **Offering class** to **Standard**, then use the other filters on the screen to pick the `Linux/UNIX` platform, default tenancy and the `m7i.large` instance type.
3. Leave **Only show offerings that reserve capacity** turned off (regional RIs), then choose **Search**.
4. Compare the rows for 1-year and 3-year terms and for **No Upfront**, **Partial Upfront** and **All Upfront**. For each, compute an *effective hourly* rate: upfront ÷ hours in the term (8,760 for 1 year, 26,280 for 3 years) + hourly charge.
5. Turn **Only show offerings that reserve capacity** on. An **Availability Zone** field appears: these are zonal RIs. Note that the prices do not change.
:::

:::cli
```bash
# 1-year, regional, Standard offerings sold by AWS (no Marketplace listings)
aws ec2 describe-reserved-instances-offerings \
  --region us-east-1 \
  --instance-type m7i.large \
  --product-description "Linux/UNIX" \
  --instance-tenancy default \
  --offering-class standard \
  --no-include-marketplace \
  --filters Name=duration,Values=31536000 Name=scope,Values=Region \
  --query "ReservedInstancesOfferings[].{Payment:OfferingType,Upfront:FixedPrice,Hourly:RecurringCharges[0].Amount}" \
  --output table
```
Repeat with `Values=94608000` for the 3-year term and with `Name=scope,Values="Availability Zone"` to list zonal offerings.
:::

> [!CHECK]
> All Upfront has the lowest effective hourly rate, No Upfront the highest; 3-year beats 1-year; and
> zonal and regional offerings cost the same. Only the zonal one reserves capacity.

### Step 4: Compare Convertible Reserved Instances

:::console
1. On the same **Purchase Reserved Instances** screen, change **Offering class** to **Convertible** and choose **Search** again.
2. Add the 1-year and 3-year Convertible effective rates to your table.
:::

:::cli
```bash
aws ec2 describe-reserved-instances-offerings \
  --region us-east-1 \
  --instance-type m7i.large \
  --product-description "Linux/UNIX" \
  --instance-tenancy default \
  --offering-class convertible \
  --filters Name=scope,Values=Region \
  --query "ReservedInstancesOfferings[].{Payment:OfferingType,Seconds:Duration,Upfront:FixedPrice,Hourly:RecurringCharges[0].Amount}" \
  --output table
```
:::

> [!CHECK]
> Convertible rates are higher than Standard rates for the same term and payment option. That gap
> is the price of being able to exchange the reservation for another family, OS or tenancy later.

### Step 5: Look at Savings Plans recommendations

:::console
1. Open the **Billing and Cost Management** console.
2. In the navigation pane, under **Savings Plans**, choose **Recommendations**.
3. Try different combinations of Savings Plans type (**Compute** and **EC2 Instance**), term, payment option and look-back period, and read **Monthly On-Demand spend**, **Estimated monthly spend** and **Estimated monthly savings**.
4. If your account has little or no EC2 usage, you may see no recommendation. That is expected: recommendations are calculated from your past usage.
:::

:::cli
```bash
# Optional and billed: each Cost Explorer API request costs USD 0.01
aws ce get-savings-plans-purchase-recommendation \
  --savings-plans-type COMPUTE_SP \
  --term-in-years ONE_YEAR \
  --payment-option NO_UPFRONT \
  --lookback-period-in-days THIRTY_DAYS
```
:::

> [!CHECK]
> A recommendation (if shown) is an **hourly commitment in USD**, not a list of instances. That is
> the key difference from Reserved Instances.

### Step 6: Decide for three scenarios

Using your table, write down which option you would choose and why:

1. A reporting database on one `m7i.large` that runs 24/7 for the next three years.
2. A nightly batch job that needs 20 `m7i.large`-sized instances for four hours and can be retried.
3. A start-up that runs a steady fleet today but plans to move half of it to AWS Fargate next year.

> [!CHECK]
> Reasonable answers: (1) 3-year Standard RI or EC2 Instance Savings Plan, All Upfront; (2) Spot
> Instances across several instance types and AZs; (3) a Compute Savings Plan sized to the steady
> baseline, with the rest On-Demand or Spot.

## Cleanup

Nothing was created, but confirm that nothing was bought by accident:

- [ ] **Reserved Instances**: in the EC2 console, open **Reserved Instances** and confirm there is no new row in the `payment-pending`, `active` or `queued` state. (CLI: `aws ec2 describe-reserved-instances --region us-east-1 --query "ReservedInstances[].[ReservedInstancesId,State,Start]" --output table`.) If an RI appears in the `queued` state, choose **Actions** → **Delete queued Reserved Instances**; an active purchase cannot be undone.
- [ ] **Savings Plans**: in Billing and Cost Management, open **Savings Plans** → **Inventory** and confirm there is no new plan. (CLI: `aws savingsplans describe-savings-plans --query "savingsPlans[].[savingsPlanId,state]" --output table`.)
- [ ] **Cart**: close the Reserved Instances purchase screen without ordering.
- [ ] **Final check**: in Billing and Cost Management → **Bills**, there are no new EC2 reservation charges, and at most USD 0.01 per Cost Explorer API call you made.

## Progress checklist

- [ ] Step 1: On-Demand price and vCPU quota recorded
- [ ] Step 2: Spot price history compared across AZs and instance types
- [ ] Step 3: Standard RI offerings compared (terms, payment options, regional vs zonal)
- [ ] Step 4: Convertible RI offerings compared
- [ ] Step 5: Savings Plans recommendations reviewed
- [ ] Step 6: Three scenario decisions written down
- [ ] Cleanup: confirmed that no RI or Savings Plan was purchased
