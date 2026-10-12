---
id: 25-machine-learning-lab-01
title: Analyze an image, a document and a customer review with Rekognition, Textract, Comprehend and Translate
objective: Upload a photo and a screenshot of a table to S3, then use the pre-trained AI APIs to label the photo, test moderation thresholds, extract the table with Textract, and analyze and translate a short customer review, all from the console demos and AWS CloudShell.
estimatedTime: 40 minutes
cost: "Well under USD 0.10 in us-east-1 at list prices: about 10 Rekognition images at USD 0.001 each, two Textract pages (USD 0.0015 detect text, USD 0.015 tables), a dozen Comprehend requests at the 3-unit minimum (USD 0.0003 each) and a few hundred Translate characters (USD 15 per million). New accounts pay this from Free Tier credits; legacy 12-month Free Tier allowances also cover it."
freeTier: partial
services: [rekognition, textract, comprehend, translate, s3, cloudshell]
---

> [!COST]
> Nothing in this lab runs by the hour: every API call is billed per image, page, 100-character unit or character, so the whole lab costs a few US cents at list price. The only resource that persists is the S3 bucket with two small files (fractions of a cent per month). Free Tier: accounts created on or after 15 July 2025 pay from their sign-up credits; older accounts in their first 12 months have monthly allowances (for example 1,000 Rekognition images, 50,000 Comprehend units, 2 million Translate characters, and 1,000 Textract text pages for the first 3 months). Delete the bucket in **Cleanup**.

These managed AI services are stateless APIs: you send data, you get JSON back, and nothing keeps running. That is exactly why they suit "least operational overhead" answers on the exam.

## Prerequisites

- An AWS account and an IAM user or role that can use Rekognition, Textract, Comprehend, Translate and S3 (for a sandbox: `AmazonRekognitionFullAccess`, `AmazonTextractFullAccess`, `ComprehendFullAccess`, `TranslateFullAccess`, `AmazonS3FullAccess`).
- A Region where all four services are available; the examples use **US East (N. Virginia) `us-east-1`**.
- **AWS CloudShell** opened in its own browser tab (choose the **CloudShell** icon in the navigation bar, then **Open in new browser tab**) so that **Actions** → **Upload file** is available. It already has AWS CLI v2 and `jq`.
- Two files on your computer, both containing no personal data:
  - `photo.jpg`: any JPEG or PNG photo you took yourself (a street, a park, your desk), under 5 MB.
  - `table.png`: a screenshot of a table, for example the "Scenario signal | Service" table in this lesson.

Set these variables in CloudShell first; later CLI tabs use them.

```bash
REGION=${AWS_REGION:-$(aws configure get region)}
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET="ml-lab-$ACCOUNT_ID-$REGION"
echo "$REGION $BUCKET"
```

## Steps

### Step 1: Create a bucket and upload the two files

:::console
1. Open the **S3** console and choose **Create bucket**.
2. Keep **General purpose**, enter a globally unique name such as `ml-lab-<account-id>-<region>`, leave the defaults (Block all public access stays on) and choose **Create bucket**.
3. Open the bucket, choose **Upload** → **Add files**, select `photo.jpg` and `table.png`, and choose **Upload**.
:::

:::cli
```bash
# In CloudShell: Actions > Upload file, once for photo.jpg and once for table.png
aws s3 mb "s3://$BUCKET"
aws s3 cp photo.jpg "s3://$BUCKET/photo.jpg"
aws s3 cp table.png "s3://$BUCKET/table.png"
aws s3 ls "s3://$BUCKET/"
```
:::

> [!CHECK]
> The bucket lists two objects, `photo.jpg` and `table.png`. Rekognition and Textract will read them directly from S3, so you never send the bytes from your laptop again.

### Step 2: Label the photo with Rekognition

:::console
1. Open the **Amazon Rekognition** console and choose **Label detection** in the navigation pane.
2. Look at the sample image result first: each label has a confidence percentage in the **Labels | Confidence** pane.
3. Choose **Upload** and select your `photo.jpg` from your computer.
4. Expand the **Request** and **Response** sections below the image to see the JSON the console sent and received.
:::

:::cli
```bash
aws rekognition detect-labels \
  --image "S3Object={Bucket=$BUCKET,Name=photo.jpg}" \
  --max-labels 10 --min-confidence 80 \
  --query 'Labels[].[Name,Confidence]' --output table
```
:::

> [!CHECK]
> You get up to 10 labels such as "Tree", "Road" or "Computer", each with a confidence of 80 or more. Run the command again with `--min-confidence 50` and notice that more, less certain labels appear. Every Rekognition result is a guess with a score, and you decide where to draw the line.

### Step 3: See how the moderation threshold changes what gets flagged

`DetectModerationLabels` returns only unsafe-content labels whose confidence is at least `MinConfidence` (50 when you leave it out).

:::cli
```bash
for t in 20 50 90; do
  echo "== MinConfidence $t"
  aws rekognition detect-moderation-labels \
    --image "S3Object={Bucket=$BUCKET,Name=photo.jpg}" \
    --min-confidence "$t" \
    --query 'ModerationLabels[].[TaxonomyLevel,ParentName,Name,Confidence]' --output text
done
```
:::

> [!CHECK]
> For an everyday photo the lists at 50 and 90 are normally empty. At 20 you may see low-confidence labels (for example something about swimwear on a beach photo): those are the false positives a low threshold produces. In a real moderation pipeline you would publish below the threshold, block high-confidence hits and send the band in between to a human reviewer.

Now read the text in your screenshot with Rekognition, which is designed for short text in scenes:

:::cli
```bash
aws rekognition detect-text \
  --image "S3Object={Bucket=$BUCKET,Name=table.png}" \
  --query 'TextDetections[?Type==`LINE`].DetectedText' --output text
```
:::

> [!CHECK]
> You get lines of words, but no idea which words belong to which row or column. Keep that in mind for the next step.

### Step 4: Extract the table with Textract

:::cli
```bash
# Plain text: lines only
aws textract detect-document-text \
  --document "S3Object={Bucket=$BUCKET,Name=table.png}" \
  --query 'Blocks[?BlockType==`LINE`].Text' --output text

# Structure: tables and cells
aws textract analyze-document \
  --document "S3Object={Bucket=$BUCKET,Name=table.png}" \
  --feature-types TABLES > table.json
jq '[.Blocks[] | select(.BlockType=="TABLE")] | length' table.json
jq -r '(.Blocks | map({(.Id): .}) | add) as $b
  | .Blocks[] | select(.BlockType=="CELL")
  | "row \(.RowIndex) col \(.ColumnIndex): " +
    ([.Relationships[]? | select(.Type=="CHILD") | .Ids[] | $b[.] | select(.BlockType=="WORD") | .Text] | join(" "))' \
  table.json | head -20
```
:::

> [!CHECK]
> The first `jq` command prints the number of tables found (normally `1`). The second prints each cell with its row and column number, for example `row 2 col 2: Rekognition`. This is the difference the exam cares about: Textract keeps document **structure** (tables, forms), while Rekognition only reads words.

### Step 5: Analyze a customer review with Comprehend

Use this fictional review (the e-mail address is a placeholder):

> I ordered the TrailMax 2 backpack in Lisbon on 3 March. The zips feel cheap and delivery took two weeks, but the shoulder straps are really comfortable. Contact me at maria@example.com.

:::console
1. Open the **Amazon Comprehend** console and choose **Real-time analysis** in the left menu.
2. Under **Input type**, choose **Built-in** for **Analysis type**.
3. Replace the sample text with the review above and choose **Analyze**.
4. In the **Insights** panel, open the **Entities**, **Key phrases**, **Language**, **PII**, **Sentiment** and **Targeted sentiment** tabs in turn.
:::

:::cli
```bash
REVIEW="I ordered the TrailMax 2 backpack in Lisbon on 3 March. The zips feel cheap and delivery took two weeks, but the shoulder straps are really comfortable. Contact me at maria@example.com."
aws comprehend detect-dominant-language --text "$REVIEW" --query 'Languages[0]'
aws comprehend detect-sentiment --language-code en --text "$REVIEW"
aws comprehend detect-entities --language-code en --text "$REVIEW" \
  --query 'Entities[].[Type,Text,Score]' --output table
aws comprehend detect-key-phrases --language-code en --text "$REVIEW" \
  --query 'KeyPhrases[].Text' --output text
aws comprehend detect-pii-entities --language-code en --text "$REVIEW" \
  --query 'Entities[].[Type,BeginOffset,EndOffset,Score]' --output table
aws comprehend detect-targeted-sentiment --language-code en --text "$REVIEW" \
  --query 'Entities[].Mentions[].[Text,MentionSentiment.Sentiment]' --output table
```
:::

> [!CHECK]
> Language is `en`; overall sentiment is most likely **MIXED** (complaints plus praise); entities include a location (Lisbon), a date (3 March) and a quantity or commercial item; PII lists an `EMAIL` with its character offsets; targeted sentiment gives each mention its own rating, typically "zips" negative and "shoulder straps" positive (exact entities and scores vary with the model version). No model was trained: this is the pre-trained NLP the exam means by "analyze sentiment with no ML expertise".

### Step 6: Translate the reply

:::console
1. Open the **Amazon Translate** console and choose **Real-time translation**.
2. Keep **Source language** as **Auto** and choose **German** as **Target language**.
3. Type: `Thank you for your feedback. We will send you new zips free of charge.`
4. Expand **Additional settings**, turn on **Formality** and choose formal; compare the output with formality off.
5. Expand **Application integration** to see the equivalent JSON request and response.
:::

:::cli
```bash
REPLY="Thank you for your feedback. We will send you new zips free of charge."
aws translate translate-text --source-language-code auto --target-language-code de \
  --settings Formality=FORMAL --text "$REPLY"
aws translate translate-text --source-language-code en --target-language-code ja \
  --text "$REPLY" --query TranslatedText --output text
```
:::

> [!CHECK]
> The first response shows `SourceLanguageCode: en` even though you sent `auto`: Translate called Comprehend to detect the language for you (which can add a small Comprehend charge). The German formal version uses "Sie"; the Japanese call returns the reply in Japanese.

## Cleanup

These APIs create no lasting resources; only the bucket and your CloudShell files remain.

- [ ] **S3 bucket `ml-lab-<account-id>-<region>` and its objects**: in the S3 console select the bucket, choose **Empty**, confirm, then **Delete** and type the bucket name. CLI: `aws s3 rb "s3://$BUCKET" --force`.
- [ ] **Rekognition console bucket (only if it exists)**: the Rekognition console can create a bucket named like `rekognition-custom-projects-<region>-<id>` when you open Custom Labels or Custom Moderation features. If it appears in your bucket list and you did not use it before, empty and delete it. CLI: `aws s3 ls | grep rekognition-custom-projects`.
- [ ] **CloudShell files**: `rm -f photo.jpg table.png table.json`.
- [ ] **Final check**: `aws s3 ls | grep ml-lab` prints nothing, and a day later **Billing and Cost Management** → **Bills** shows only cents (or credits) for Rekognition, Textract, Comprehend and Translate.

## Progress checklist

- [ ] Step 1: Created the bucket and uploaded `photo.jpg` and `table.png`
- [ ] Step 2: Labelled the photo with Rekognition at two confidence levels
- [ ] Step 3: Compared moderation results at thresholds 20, 50 and 90 and read text with `DetectText`
- [ ] Step 4: Extracted the table structure with Textract
- [ ] Step 5: Analyzed the review with Comprehend (sentiment, entities, PII, targeted sentiment)
- [ ] Step 6: Translated the reply with auto-detection and formality
- [ ] Cleanup done
