---
id: 01-getting-started-lab-02
title: Protect a new account with a zero spend budget
objective: Create an AWS Budgets zero spend alert and a small monthly cost budget, confirm the email recipient, and learn where to watch Free Tier usage and credits, so that no later lab can surprise you with a bill.
estimatedTime: 20 minutes
cost: "USD 0. Budget monitoring and email notifications are free; this lab uses no budget actions and no budget reports."
freeTier: yes
services: [budgets, console, cloudshell, cli-sdk]
---

Every later lab in this course creates resources that can cost money if you forget to delete them. A budget alert is your safety net: AWS emails you when spending starts, instead of you finding out from the monthly bill. Do this lab before any lab that is not fully Free Tier.

## Prerequisites

- An AWS account and an email address you can read now (the recipient must confirm it within 12 hours).
- Sign in as the **root user**, or as an IAM identity with the AWS managed `Billing` policy **after** the root user has turned on **IAM User and Role Access to Billing Information** (account menu → **Account** → **Edit** → **Activate IAM Access** → **Update**). IAM users and roles cannot open Billing pages until that setting is active, whatever their policies say.
- For the CLI tabs: AWS CloudShell (open it from the console navigation bar). AWS Budgets is a global service, so the Region you are in does not matter.

## Steps

### Step 1: Create a zero spend budget from a template

:::console
1. Open the **Billing and Cost Management** console (search for `Budgets` or go to `https://console.aws.amazon.com/cost-management/`).
2. In the navigation pane, choose **Budgets**, then **Create budget** at the top of the page.
3. Under **Budget setup**, choose **Use a template (simplified)**.
4. Under **Templates**, choose **Zero spend budget**.
5. Enter a budget name such as `zero-spend-alert`.
6. In **Email recipients**, enter your email address (up to 10 addresses, separated by commas).
7. Optional: under **Template settings**, choose **JSON** to see the exact budget definition the template creates.
8. Choose **Create budget**.
:::

:::cli
```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
EMAIL="you@example.com"   # replace with your address

cat > zero-budget.json <<'EOF'
{
  "BudgetName": "zero-spend-alert-cli",
  "BudgetType": "COST",
  "TimeUnit": "MONTHLY",
  "BudgetLimit": { "Amount": "1.00", "Unit": "USD" }
}
EOF

cat > zero-notify.json <<EOF
[
  {
    "Notification": {
      "NotificationType": "ACTUAL",
      "ComparisonOperator": "GREATER_THAN",
      "Threshold": 0.01,
      "ThresholdType": "ABSOLUTE_VALUE"
    },
    "Subscribers": [ { "SubscriptionType": "EMAIL", "Address": "$EMAIL" } ]
  }
]
EOF

aws budgets create-budget --account-id "$ACCOUNT_ID" \
  --budget file://zero-budget.json \
  --notifications-with-subscribers file://zero-notify.json
```
This CLI version is a close equivalent of the template (alert as soon as actual spend passes USD 0.01). Use either the console or the CLI, not both, unless you want two budgets to practise deleting.
:::

> [!CHECK]
> The **Budgets** page lists your new budget with a budget amount and **Current** spend of USD 0.00 (or close to it). From the CLI, `aws budgets describe-budgets --account-id "$ACCOUNT_ID" --query "Budgets[].BudgetName"` shows its name.

### Step 2: Confirm the email recipient

Budget notifications only go to verified addresses.

:::console
1. Open your inbox and find the verification email from an `@aws.com` sender (check the spam folder too).
2. Choose the link in the email. It opens the AWS Management Console; sign in to **the same AWS account** if asked, and complete the verification.
3. Back in **Budgets**, open your budget and refresh its detail page. In the recipients list, the status should change from **Pending** to **Active**.
4. If the link expired (links last 12 hours) or never arrived, choose **Resend verification** on the recipient row.
:::

> [!CHECK]
> Your address shows **Active** on the budget detail page. Until then, AWS Budgets will not email you even if the threshold is crossed.

### Step 3: Add a small monthly cost budget

A zero spend budget tells you that spending started. A monthly cost budget tells you when it is getting out of hand, including a forecast before it happens.

:::console
1. In **Budgets**, choose **Create budget** → **Use a template (simplified)** → **Monthly cost budget**.
2. Name it `monthly-5-usd`, enter `5` as the budgeted amount in USD, and add your email in **Email recipients**.
3. Read the summary of alerts the template creates (when this lab was written it showed actual spend reaching 85% and 100% of the amount, and forecasted spend reaching 100%; see the VERIFY note below). Optional: under **Template settings**, choose **JSON** to see each alert's type and threshold exactly.
4. Choose **Create budget**.
:::

:::cli
```bash
# If CloudShell timed out since Step 1, set the variables again
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
EMAIL="you@example.com"   # replace with your address

cat > monthly-budget.json <<'EOF'
{
  "BudgetName": "monthly-5-usd",
  "BudgetType": "COST",
  "TimeUnit": "MONTHLY",
  "BudgetLimit": { "Amount": "5.00", "Unit": "USD" }
}
EOF

cat > monthly-notify.json <<EOF
[
  {
    "Notification": { "NotificationType": "ACTUAL", "ComparisonOperator": "GREATER_THAN",
                      "Threshold": 85, "ThresholdType": "PERCENTAGE" },
    "Subscribers": [ { "SubscriptionType": "EMAIL", "Address": "$EMAIL" } ]
  },
  {
    "Notification": { "NotificationType": "ACTUAL", "ComparisonOperator": "GREATER_THAN",
                      "Threshold": 100, "ThresholdType": "PERCENTAGE" },
    "Subscribers": [ { "SubscriptionType": "EMAIL", "Address": "$EMAIL" } ]
  },
  {
    "Notification": { "NotificationType": "FORECASTED", "ComparisonOperator": "GREATER_THAN",
                      "Threshold": 100, "ThresholdType": "PERCENTAGE" },
    "Subscribers": [ { "SubscriptionType": "EMAIL", "Address": "$EMAIL" } ]
  }
]
EOF

aws budgets create-budget --account-id "$ACCOUNT_ID" \
  --budget file://monthly-budget.json \
  --notifications-with-subscribers file://monthly-notify.json

aws budgets describe-notifications-for-budget --account-id "$ACCOUNT_ID" \
  --budget-name monthly-5-usd
```
:::

> [!VERIFY] Default alert thresholds of the Monthly cost budget template
> Checked 2026-10-04. The [budget templates page](https://docs.aws.amazon.com/cost-management/latest/userguide/budget-templates.html)
> only says this template alerts when spend exceeds, or is forecast to exceed, the amount, and that
> template defaults can be changed later; neither it nor
> [Creating a cost budget](https://docs.aws.amazon.com/cost-management/latest/userguide/create-cost-budget.html)
> gives the percentages. The 85% / 100% actual and 100% forecasted values above come from the console
> summary seen when the lab was written (third-party guides report the same), not from AWS
> documentation, so AWS may change them without notice. Go by what your console shows: the alert
> summary, or **Template settings** → **JSON**. The CLI tab sets its three thresholds explicitly, so it
> is not affected.

> [!CHECK]
> In the console, the budget detail page lists the alerts from the template summary. From the CLI (which sets the three thresholds explicitly), `describe-notifications-for-budget` returns three notifications: `ACTUAL` at 85%, `ACTUAL` at 100% and `FORECASTED` at 100% of USD 5. Because the email address is already verified in this account (Step 2), its recipient status shows **Active** right away, with no new verification email.

### Step 4: Find your Free Tier usage, credits and alert settings

:::console
1. On **Console Home**, look at the cost widget. On a **Free account plan** it shows your remaining credits and the days left on the plan.
2. In **Billing and Cost Management**, open **Credits** to see the credit balance and expiry dates, and **Free Tier** to compare your usage with Always Free and trial limits (for paid-plan and legacy Free Tier accounts).
3. Under **Preferences** in the navigation pane, choose **Billing preferences**. For **Alert preferences**, choose **Edit** and make sure **Receive AWS Free Tier alerts** is selected; these emails arrive when a service passes 85% of its free limit. Choose **Update** if you changed anything.
:::

> [!CHECK]
> You can say how many credits remain, when they expire, and which email address receives Free Tier alerts (by default the root user's address).

## Cleanup

Budgets cost nothing to keep, and the zero spend alert should stay on for the rest of the course.

- [ ] **Budget `zero-spend-alert` (or `zero-spend-alert-cli`)**: keep it (recommended). Delete it only if you are closing this account: **Budgets** → select it → **Actions** → **Delete**, or `aws budgets delete-budget --account-id "$ACCOUNT_ID" --budget-name zero-spend-alert` (use `zero-spend-alert-cli` for the CLI-created one).
- [ ] **Budget `monthly-5-usd`**: keep it as a second safety net or delete it the same way: `aws budgets delete-budget --account-id "$ACCOUNT_ID" --budget-name monthly-5-usd`.
- [ ] **Local JSON files** in CloudShell (`zero-budget.json`, `zero-notify.json`, `monthly-budget.json`, `monthly-notify.json`): `rm -f zero-budget.json zero-notify.json monthly-budget.json monthly-notify.json`.
- [ ] **Final check**: `aws budgets describe-budgets --account-id "$ACCOUNT_ID" --query "Budgets[].BudgetName"` lists only the budgets you chose to keep, and **Billing and Cost Management** → **Bills** shows no charges from this lab.

## Progress checklist

- [ ] Step 1: Created a zero spend budget
- [ ] Step 2: Verified the email recipient (status Active)
- [ ] Step 3: Created a USD 5 monthly cost budget and checked its actual and forecast alerts
- [ ] Step 4: Found credits, Free Tier usage and Free Tier alert preferences
- [ ] Cleanup done
