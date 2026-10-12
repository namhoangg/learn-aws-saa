---
id: 36-well-architected-exam-lab-01
title: Review a workload with the AWS Well-Architected Tool
objective: Define a workload in the AWS Well-Architected Tool, answer security and reliability questions honestly, read the high and medium risks and the improvement plan, save milestones before and after an improvement, generate a report, then delete the workload.
estimatedTime: 40 minutes
cost: "USD 0. The AWS Well-Architected Tool has no charge and this lab creates no billable resources."
freeTier: yes
services: [well-architected-tool, cli-sdk, cloudshell]
---

The Well-Architected Tool does not look at your resources; it records what you tell it about a workload and compares that with the framework. In this lab you describe a small, imaginary web shop ("demo shop") that has a few typical weaknesses, so you can see how the tool turns answers into risks and an improvement plan. Nothing is deployed.

## Prerequisites

- An AWS account and a user or role allowed to use the tool, for example with the AWS managed policy `WellArchitectedConsoleFullAccess` (works for the console and the CLI), or a custom policy that allows the `wellarchitected:` actions this lab calls (`CreateWorkload`, `ListLenses`, `GetLensReview`, `ListAnswers`, `GetAnswer`, `UpdateAnswer`, `CreateMilestone`, `ListMilestones`, `GetLensReviewReport`, `ListWorkloads`, `DeleteWorkload`).
- A Region where the tool is available; the steps use `us-east-1`. Workloads are stored per Region, so stay in the same Region for the whole lab.
- For the CLI tabs: AWS CLI v2 configured with credentials, or AWS CloudShell (no setup). Use one terminal session for the whole lab because later commands reuse shell variables.

## Steps

### Step 1: Define the workload

:::console
1. Open the **AWS Well-Architected Tool** console at `https://console.aws.amazon.com/wellarchitected/` and check the Region selector shows **US East (N. Virginia)**.
2. In the left navigation pane choose **Workloads**, then **Define workload** (on a first visit you can also choose **Define workload** on the welcome page).
3. Fill in:
   - **Name**: `demo-shop-lab`
   - **Description**: `Practice review of an imaginary web shop`
   - **Review owner**: your name or email
   - **Environment**: **Pre-production**
   - **Regions**: under **AWS Regions** choose **US East (N. Virginia)**
4. Leave the optional fields (account IDs, application, architectural design, industry, **Trusted Advisor**, **Jira**, tags) empty and choose **Next**.
5. On the **Apply Profile** step choose **Next** without selecting a profile.
6. On the lens step, note that the **AWS Well-Architected Framework** lens is already selected. Browse the **Lens Catalog** to see what else exists (Serverless Applications, SaaS, Generative AI and others), but do not add any. Choose **Define workload**.
:::

:::cli
```bash
export AWS_REGION=us-east-1

# Confirm the alias of the Framework lens (expect "wellarchitected")
aws wellarchitected list-lenses \
  --query 'LensSummaries[].[LensAlias,LensName]' --output table

WL_ID=$(aws wellarchitected create-workload \
  --workload-name demo-shop-lab \
  --description "Practice review of an imaginary web shop" \
  --environment PREPRODUCTION \
  --review-owner "you@example.com" \
  --aws-regions us-east-1 \
  --lenses wellarchitected \
  --query WorkloadId --output text)
echo "Workload ID: $WL_ID"
```
:::

> [!CHECK]
> The workload details page for `demo-shop-lab` opens with a banner reminding you to start the review. In the CLI, `WL_ID` holds a 32-character hexadecimal ID.

### Step 2: Answer a few security questions

Pretend the demo shop is an early-stage project: developers share IAM users with long-lived access keys, and nobody has thought about incident response yet.

:::console
1. On the workload page choose **Start reviewing**, then **AWS Well-Architected Framework**.
2. In the left pane expand **Security** and open the first questions. For each question read it, choose **Info** to see the guidance, and answer as the demo shop would:
   - For the question about how you manage identities and credentials (or securely operating your workload), select **None of these**.
   - For one question about detection or logging, select one or two best practices that a basic setup would have (for example one about configuring service and application logging).
3. In the **Notes** box of one question, type a short reason, for example `Developers still use long-lived access keys`.
4. Choose **Next** to move between questions and **Save and exit** when you have answered three or four security questions.
:::

:::cli
```bash
# List the security questions and their current risk
aws wellarchitected list-answers --workload-id "$WL_ID" \
  --lens-alias wellarchitected --pillar-id security \
  --query 'AnswerSummaries[].[QuestionId,QuestionTitle,Risk]' --output table

# Pick the question about managing identities and look at its choices
Q1=$(aws wellarchitected list-answers --workload-id "$WL_ID" \
  --lens-alias wellarchitected --pillar-id security \
  --query "AnswerSummaries[?contains(QuestionTitle, 'identities')] | [0].QuestionId" \
  --output text)
echo "Question: $Q1"   # if this prints None, set Q1 to any QuestionId from the table above
aws wellarchitected get-answer --workload-id "$WL_ID" \
  --lens-alias wellarchitected --question-id "$Q1" \
  --query 'Answer.Choices[].[ChoiceId,Title]' --output table

# Answer it as the demo shop: select only the first listed best practice
C1=$(aws wellarchitected get-answer --workload-id "$WL_ID" \
  --lens-alias wellarchitected --question-id "$Q1" \
  --query 'Answer.Choices[0].ChoiceId' --output text)
aws wellarchitected update-answer --workload-id "$WL_ID" \
  --lens-alias wellarchitected --question-id "$Q1" \
  --selected-choices "$C1" \
  --notes "Developers still use long-lived access keys" \
  --query 'Answer.[QuestionTitle,Risk]'
```
:::

> [!CHECK]
> Answered questions show **Done** in the left pane with a risk badge. A question where you followed few or none of the best practices is marked **High risk**; partial answers can be **Medium risk**. In the CLI, `update-answer` returns the question title and its `Risk` (`HIGH`, `MEDIUM`, `NONE` or `NOT_APPLICABLE`).

### Step 3: Mark something as not applicable and answer reliability questions

:::console
1. Choose **Continue reviewing** and expand **Reliability**.
2. Answer two questions: select **None of these** for one about backing up data, and select most of the best practices for another (for example about managing service quotas).
3. Pick any question that genuinely does not fit an imaginary single-Region shop and choose **Question does not apply to this workload**, adding a note explaining why.
4. On another question, try **Mark best practice(s) that don't apply to this workload**, pick one best practice and choose a reason.
5. Choose **Save and exit**.
:::

:::cli
```bash
# Pillar IDs used by --pillar-id (security, reliability, ...)
aws wellarchitected get-lens-review --workload-id "$WL_ID" \
  --lens-alias wellarchitected \
  --query 'LensReview.PillarReviewSummaries[].[PillarId,PillarName]' --output table

# Show reliability questions
aws wellarchitected list-answers --workload-id "$WL_ID" \
  --lens-alias wellarchitected --pillar-id reliability \
  --query 'AnswerSummaries[].[QuestionId,QuestionTitle,Risk]' --output table

# Mark the last reliability question as not applicable
QNA=$(aws wellarchitected list-answers --workload-id "$WL_ID" \
  --lens-alias wellarchitected --pillar-id reliability \
  --query 'AnswerSummaries[-1].QuestionId' --output text)
aws wellarchitected update-answer --workload-id "$WL_ID" \
  --lens-alias wellarchitected --question-id "$QNA" \
  --no-is-applicable --notes "Not relevant for this practice workload" \
  --query 'Answer.[QuestionTitle,IsApplicable,Risk]'
```
:::

> [!CHECK]
> The not-applicable question shows no risk and no longer counts toward the pillar's risks. The pillar counter in the left pane shows how many questions you answered.

### Step 4: Read the risks and the improvement plan

:::console
1. Go back to the workload page (choose the workload name in the breadcrumb).
2. On the **Overview** tab, look at the workload summary: the number of questions answered and the counts of **high risks** and **medium risks**.
3. Choose the **AWS Well-Architected Framework** lens and open the **Improvement plan** tab. For one high-risk question, read the recommended improvement items and open one of the linked documents.
4. Open **Dashboard** in the left navigation pane and look at the issues per pillar.
:::

:::cli
```bash
# Overall risk counts for the lens review
aws wellarchitected get-lens-review --workload-id "$WL_ID" \
  --lens-alias wellarchitected --query 'LensReview.RiskCounts'

# Risk counts per pillar
aws wellarchitected get-lens-review --workload-id "$WL_ID" \
  --lens-alias wellarchitected \
  --query 'LensReview.PillarReviewSummaries[].[PillarName,RiskCounts]' --output json
```
:::

> [!CHECK]
> You see at least one high risk in **Security** (the identity question answered with None of these or a single best practice). Most questions remain **Unanswered**, which is normal for a practice run.

### Step 5: Save a baseline milestone

:::console
1. On the workload page choose **Save milestone**.
2. For **Milestone name** enter `baseline`, then choose **Save**.
3. Open the **Milestones** tab and confirm the milestone is listed.
:::

:::cli
```bash
aws wellarchitected create-milestone --workload-id "$WL_ID" \
  --milestone-name baseline
aws wellarchitected list-milestones --workload-id "$WL_ID" \
  --query 'MilestoneSummaries[].[MilestoneNumber,MilestoneName]' --output table
```
:::

> [!CHECK]
> Milestone 1 `baseline` exists. Milestones are immutable: later changes to answers do not alter it.

### Step 6: "Fix" an issue and save a second milestone

Imagine the team moved developers to IAM Identity Center with short-term credentials. Update the answer to reflect that.

:::console
1. Choose **Continue reviewing**, open the security question you answered with **None of these** (or a single best practice), and now select most of its best practices. Update the note, for example `Moved to IAM Identity Center, access keys removed`.
2. Choose **Save and exit**.
3. Choose **Save milestone**, name it `after-identity-fix`, and choose **Save**.
4. Compare the risk counts on the **Overview** tab with the `baseline` milestone on the **Milestones** tab.
:::

:::cli
```bash
# Select every best-practice choice except the last one ("None of these" is usually last)
CHOICES=$(aws wellarchitected get-answer --workload-id "$WL_ID" \
  --lens-alias wellarchitected --question-id "$Q1" \
  --query 'Answer.Choices[:-1].ChoiceId' --output text)
aws wellarchitected update-answer --workload-id "$WL_ID" \
  --lens-alias wellarchitected --question-id "$Q1" \
  --selected-choices $CHOICES \
  --notes "Moved to IAM Identity Center, access keys removed" \
  --query 'Answer.[QuestionTitle,Risk]'

aws wellarchitected create-milestone --workload-id "$WL_ID" \
  --milestone-name after-identity-fix
aws wellarchitected get-lens-review --workload-id "$WL_ID" \
  --lens-alias wellarchitected --query 'LensReview.RiskCounts'
```
:::

> [!CHECK]
> The improved question's risk drops (to medium or none), the high-risk count goes down, and the two milestones show the before and after state.

> [!TIP]
> If `update-answer` reports that a choice cannot be combined with others, run the `get-answer` command from Step 2 and remove the "None of these" choice ID from your list by hand.

### Step 7: Generate a report

:::console
1. On the workload page select the **AWS Well-Architected Framework** lens and choose **Generate report**.
2. Open or download the PDF and skim it: answers, notes, risk counts and the improvement plan for risky questions.
:::

:::cli
```bash
aws wellarchitected get-lens-review-report --workload-id "$WL_ID" \
  --lens-alias wellarchitected \
  --query 'LensReviewReport.Base64String' --output text | base64 -d > demo-shop-report.pdf
ls -l demo-shop-report.pdf
```
:::

> [!CHECK]
> The PDF shows the workload name, your notes and the high and medium risk counts. This is what you would hand to stakeholders who do not use the tool.

## Cleanup

Delete in this order:

- [ ] **Workload `demo-shop-lab`** (this also removes its milestones `baseline` and `after-identity-fix` and all answers; deletion cannot be undone): **Workloads** → select `demo-shop-lab` → **Delete** → **Delete**. CLI: `aws wellarchitected delete-workload --workload-id "$WL_ID"`.
- [ ] **Local report file** `demo-shop-report.pdf` (downloaded from the console or created by the CLI): delete it if you no longer need it. CLI path: `rm demo-shop-report.pdf`.
- [ ] **Final check**: **Workloads** in the Well-Architected Tool console (US East (N. Virginia)) lists no `demo-shop-lab`. CLI: `aws wellarchitected list-workloads --query 'WorkloadSummaries[].WorkloadName'` returns no `demo-shop-lab`. No charges are expected because the tool is free.

## Progress checklist

- [ ] Step 1: Defined the workload `demo-shop-lab` with the Framework lens
- [ ] Step 2: Answered security questions and saw a high risk appear
- [ ] Step 3: Answered reliability questions and marked a question as not applicable
- [ ] Step 4: Read the risk counts, the improvement plan and the dashboard
- [ ] Step 5: Saved the `baseline` milestone
- [ ] Step 6: Improved an answer and saved the `after-identity-fix` milestone
- [ ] Step 7: Generated the workload report
- [ ] Cleanup done: workload deleted and local report removed
