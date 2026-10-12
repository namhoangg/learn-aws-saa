---
id: 15-cloudfront-global-accelerator-lab-01
title: Serve a private S3 bucket through CloudFront with OAC, then invalidate and geo-block
objective: Put a CloudFront distribution in front of a private S3 bucket using Origin Access Control, prove the bucket cannot be read directly, watch caching and an invalidation in action, and block your own country with geo restriction.
estimatedTime: 45 minutes (much of it waiting for CloudFront deployments)
cost: "Effectively USD 0 on pay-as-you-go: a few requests and kilobytes fall inside CloudFront's Always Free tier (1 TB and 10 million requests a month), the single invalidation path falls inside the 1,000 free paths a month, and S3 storage and requests for a few KB cost a fraction of a cent (covered by Free Tier credits or the legacy S3 free tier)."
freeTier: yes
services: [cloudfront, s3, edge-locations]
---

In this lab you build the most common CloudFront architecture: a private bucket that only your distribution can read. Then you change a file and see that CloudFront keeps serving the old copy until you invalidate it, and you switch on geo restriction to see the 403 a blocked viewer gets.

> [!WARNING] Stay on pay-as-you-go
> The CloudFront console may offer flat-rate pricing plans when you create a distribution. This lab assumes **pay-as-you-go** pricing with AWS WAF **not** enabled. A distribution subscribed to a plan cannot be deleted until the plan is cancelled, and enabling WAF security protections on pay-as-you-go adds web ACL charges. The Free flat-rate plan (USD 0) would also work, but you must cancel it before the Cleanup section.

## Prerequisites

- An AWS account with permissions for Amazon S3 and Amazon CloudFront (for example the `AmazonS3FullAccess` and `CloudFrontFullAccess` managed policies).
- A Region for the bucket; the steps use `us-east-1`, but any Region works.
- A web browser. For the CLI tabs: AWS CloudShell (recommended; it already has the AWS CLI v2, `curl` and `jq`) or a local Bash shell with AWS CLI v2 and `jq`. Keep one terminal open for the whole lab because later commands reuse shell variables.
- Your two-letter country code (ISO 3166-1, for example `US`, `GB`, `VN`, `DE`) for the geo restriction step.

## Steps

### Step 1: Create a private S3 bucket and upload a page

:::console
1. On your computer, create a file named `index.html` containing exactly: `<h1>Hello from CloudFront - version 1</h1>`
2. Open the **Amazon S3** console and choose **Create bucket**.
3. For **Bucket name**, enter a globally unique name such as `cf-lab-<your-account-id>-<random-number>`. Pick your **Region** (for example `us-east-1`).
4. Leave every other setting at its default. In particular, keep **Block all public access** turned on. Choose **Create bucket**.
5. In **General purpose buckets**, choose your new bucket, then **Upload** → **Add files**, select `index.html`, and choose **Upload**.
:::

:::cli
```bash
REGION=us-east-1
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET=cf-lab-$ACCOUNT_ID-$RANDOM
aws s3 mb "s3://$BUCKET" --region "$REGION"

echo '<h1>Hello from CloudFront - version 1</h1>' > index.html
aws s3 cp index.html "s3://$BUCKET/index.html" --content-type text/html
echo "Bucket: $BUCKET"
```
:::

> [!CHECK]
> Open the object `index.html` in the S3 console and copy its **Object URL** (`https://<bucket>.s3.<region>.amazonaws.com/index.html`). Pasting it into a browser shows an **AccessDenied** XML error, because the bucket is private. (CLI: `curl -s -o /dev/null -w "%{http_code}\n" "https://$BUCKET.s3.$REGION.amazonaws.com/index.html"` prints `403`.)

### Step 2: Create a CloudFront distribution with Origin Access Control

:::console
1. Open the **CloudFront** console and choose **Create distribution**.
2. If the wizard asks you to choose a pricing plan, choose the **pay-as-you-go** option rather than one of the Free, Pro, Business or Premium flat-rate tiers (see the warning at the top of this lab). {{verify: Checked 2026-10-04. The CloudFront Developer Guide page on flat-rate pricing plans says you pick the distribution's plan during creation and calls pay-as-you-go the alternative to the four tiers, but no AWS page shows the label or wizard page of that choice, and the Create a distribution procedure lists no plan step at all. Pick whatever choice is not a flat-rate tier. If you subscribe to a plan by mistake, cancel it before cleanup; a Free plan cancels at once.}}
3. Enter a **Distribution name**, for example `cf-lab`, choose **Single website or app**, then **Next**.
4. Skip the optional **Domain setup** (you will use the `cloudfront.net` domain) and choose **Next**.
5. On the **Specify origin** page, for **Origin type** choose **Amazon S3**. For **S3 origin**, choose **Browse S3** and select your bucket.
6. For **Settings**, keep **Use recommended origin settings**. This creates an origin access control, sets **Redirect HTTP to HTTPS** and uses the **CachingOptimized** cache policy. Choose **Next**.
7. On the **Enable security protections** page, pick the choice that leaves AWS WAF switched off, then choose **Next**. {{verify: Checked 2026-10-04. The CloudFront Developer Guide pages Create a distribution, Get started with a CloudFront standard distribution and Enable AWS WAF for distributions only say to choose whether to enable protections here and name only the Enable security protections choice; the label of the opt-out choice is not published. Choose the option that does not enable protections; after creation, the distribution's Security tab should offer to enable AWS WAF instead of showing it active.}}
8. Review the settings and choose **Create distribution**. CloudFront updates the bucket policy for you.
9. Copy the **Distribution domain name** (for example `d111111abcdef8.cloudfront.net`) and wait until **Last modified** changes from **Deploying** to a date (usually 3–10 minutes).
:::

:::cli
```bash
# 1. Create the origin access control (CloudFront is global, no --region needed)
OAC_ID=$(aws cloudfront create-origin-access-control \
  --origin-access-control-config "Name=cf-lab-oac-$RANDOM,Description=CloudFront lab OAC,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3" \
  --query OriginAccessControl.Id --output text)

# 2. Describe the distribution: one S3 origin with OAC, HTTPS redirect, CachingOptimized policy
cat > dist-config.json <<EOF
{
  "CallerReference": "cf-lab-$(date +%s)",
  "Comment": "CloudFront OAC lab",
  "Enabled": true,
  "DefaultRootObject": "index.html",
  "Origins": {
    "Quantity": 1,
    "Items": [
      {
        "Id": "s3-origin",
        "DomainName": "$BUCKET.s3.$REGION.amazonaws.com",
        "S3OriginConfig": { "OriginAccessIdentity": "" },
        "OriginAccessControlId": "$OAC_ID"
      }
    ]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "s3-origin",
    "ViewerProtocolPolicy": "redirect-to-https",
    "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
    "Compress": true
  }
}
EOF

read DIST_ID DOMAIN DIST_ARN <<< "$(aws cloudfront create-distribution \
  --distribution-config file://dist-config.json \
  --query 'Distribution.[Id,DomainName,ARN]' --output text)"

# 3. Allow only this distribution to read the bucket
cat > bucket-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontServicePrincipalReadOnly",
      "Effect": "Allow",
      "Principal": { "Service": "cloudfront.amazonaws.com" },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::$BUCKET/*",
      "Condition": { "StringEquals": { "AWS:SourceArn": "$DIST_ARN" } }
    }
  ]
}
EOF
aws s3api put-bucket-policy --bucket "$BUCKET" --policy file://bucket-policy.json

echo "Distribution $DIST_ID at https://$DOMAIN  (waiting for deployment...)"
aws cloudfront wait distribution-deployed --id "$DIST_ID"
```
:::

> [!CHECK]
> In the S3 console, open your bucket → **Permissions** → **Bucket policy**. You see a statement allowing the service principal `cloudfront.amazonaws.com` to call `s3:GetObject`, with a condition on `AWS:SourceArn` equal to your distribution's ARN. In the CloudFront console, **Origin access** in the navigation pane lists the new control setting.

### Step 3: Read the page through CloudFront and watch the cache

1. Open `https://<distribution-domain>/index.html` in your browser. You see **Hello from CloudFront - version 1**.
2. Try the S3 object URL again: still **AccessDenied**. The only way in is CloudFront.
3. Look at the cache status. In the browser's developer tools (**Network** tab, select `index.html`, **Response headers**) find `x-cache`. Or use the CLI tab.

:::cli
```bash
curl -s "https://$DOMAIN/index.html"
curl -sI "https://$DOMAIN/index.html" | grep -i -E "x-cache|age|x-amz-cf-pop"
curl -sI "https://$DOMAIN/index.html" | grep -i -E "x-cache|age|x-amz-cf-pop"
```
:::

> [!CHECK]
> The first request usually shows `x-cache: Miss from cloudfront` (the edge fetched the object from S3). A repeat request shows `x-cache: Hit from cloudfront` and an `age` header counting seconds since it was cached. `x-amz-cf-pop` names the edge location that served you (for example `IAD89-C1` for northern Virginia).

### Step 4: Change the file and see the stale cache

:::console
1. Edit your local `index.html` so it reads `<h1>Hello from CloudFront - version 2</h1>`.
2. In the S3 console, upload it to the same bucket with the same name, replacing the old object.
3. Reload `https://<distribution-domain>/index.html` (use a private window or a hard refresh to bypass your browser cache).
:::

:::cli
```bash
echo '<h1>Hello from CloudFront - version 2</h1>' > index.html
aws s3 cp index.html "s3://$BUCKET/index.html" --content-type text/html
curl -s "https://$DOMAIN/index.html"
```
:::

> [!CHECK]
> CloudFront still returns **version 1**. The object is cached at the edge with the CachingOptimized default TTL of 24 hours, and CloudFront does not know the origin changed. (If you happen to reach a different edge location that never cached the file, you may already see version 2; repeat from the same browser or CloudShell session.)

### Step 5: Invalidate the cached file

:::console
1. In the CloudFront console, choose your distribution and open the **Invalidations** tab.
2. Choose **Create invalidation**.
3. Enter one path per line: `/index.html`
4. Choose **Create invalidation** and wait until the **Status** shows **Completed** (usually under a minute or two).
5. Reload the page.
:::

:::cli
```bash
INV_ID=$(aws cloudfront create-invalidation --distribution-id "$DIST_ID" \
  --paths "/index.html" --query Invalidation.Id --output text)
aws cloudfront wait invalidation-completed --distribution-id "$DIST_ID" --id "$INV_ID"
curl -s "https://$DOMAIN/index.html"
curl -sI "https://$DOMAIN/index.html" | grep -i x-cache
```
:::

> [!CHECK]
> The page now shows **version 2**, and the first request after the invalidation is a `Miss from cloudfront`. This invalidation used 1 of your 1,000 free paths for the month. A wildcard such as `/*` would also count as just one path.

### Step 6: Block your own country with geo restriction

Pick the country you will test from. From a browser, that is the country you are in. From CloudShell, requests come from the CloudShell Region, so for `us-east-1` use `US`.

:::console
1. In the CloudFront console, choose your distribution and open the **Security** tab.
2. Under **Geographic restrictions**, choose **Edit**.
3. Select **Block list**, add your country, and choose **Save changes**.
4. Wait until the distribution's **Last modified** column shows a date again (a few minutes), then reload `https://<distribution-domain>/index.html`.
:::

:::cli
```bash
MY_COUNTRY=US   # replace with the two-letter code of the country you test from

aws cloudfront get-distribution-config --id "$DIST_ID" > dist.json
ETAG=$(jq -r '.ETag' dist.json)
jq --arg c "$MY_COUNTRY" \
  '.DistributionConfig | .Restrictions.GeoRestriction = {"RestrictionType":"blacklist","Quantity":1,"Items":[$c]}' \
  dist.json > dist-geo.json
aws cloudfront update-distribution --id "$DIST_ID" --if-match "$ETAG" \
  --distribution-config file://dist-geo.json --query Distribution.Status --output text
aws cloudfront wait distribution-deployed --id "$DIST_ID"
curl -s -o /dev/null -w "%{http_code}\n" "https://$DOMAIN/index.html"
```
:::

> [!CHECK]
> The browser shows a CloudFront **403 ERROR** page saying the request could not be satisfied, and `curl` prints `403`. Note that the API calls the lists `blacklist` and `whitelist`, while the console says **Block list** and **Allow list**.

Now remove the restriction so the distribution is usable again (or skip straight to Cleanup):

:::console
1. On the **Security** tab, under **Geographic restrictions**, choose **Edit**, turn the restriction off (remove your country and set the restriction type back to no restriction), and choose **Save changes**.
:::

:::cli
```bash
aws cloudfront get-distribution-config --id "$DIST_ID" > dist.json
ETAG=$(jq -r '.ETag' dist.json)
jq '.DistributionConfig | .Restrictions.GeoRestriction = {"RestrictionType":"none","Quantity":0}' \
  dist.json > dist-nogeo.json
aws cloudfront update-distribution --id "$DIST_ID" --if-match "$ETAG" \
  --distribution-config file://dist-nogeo.json --query Distribution.Status --output text
```
:::

## Cleanup

Delete the distribution first, then the origin access control, then the bucket. A distribution must be **disabled** and fully deployed before it can be deleted.

- [ ] **CloudFront distribution `cf-lab`**: console: select it, choose **Disable** and confirm; wait until **Last modified** shows a new date; select it again and choose **Delete**. (If you subscribed it to a flat-rate plan, cancel the plan first.)
- [ ] **Origin access control** created for the bucket: console: **Origin access** → select the control setting → **Delete** (possible only after the distribution is deleted).
- [ ] **S3 bucket** and its object `index.html`: console: select the bucket → **Empty** → confirm, then **Delete** → confirm with the bucket name.
- [ ] Local files you created (`index.html`, and for the CLI path `dist-config.json`, `bucket-policy.json`, `dist*.json`).

:::cli
```bash
# Disable the distribution and wait for the change to deploy
aws cloudfront get-distribution-config --id "$DIST_ID" > dist.json
ETAG=$(jq -r '.ETag' dist.json)
jq '.DistributionConfig | .Enabled = false' dist.json > dist-disabled.json
aws cloudfront update-distribution --id "$DIST_ID" --if-match "$ETAG" \
  --distribution-config file://dist-disabled.json --query Distribution.Status --output text
aws cloudfront wait distribution-deployed --id "$DIST_ID"

# Delete the distribution
ETAG=$(aws cloudfront get-distribution --id "$DIST_ID" --query ETag --output text)
aws cloudfront delete-distribution --id "$DIST_ID" --if-match "$ETAG"

# Delete the origin access control
OAC_ETAG=$(aws cloudfront get-origin-access-control --id "$OAC_ID" --query ETag --output text)
aws cloudfront delete-origin-access-control --id "$OAC_ID" --if-match "$OAC_ETAG"

# Empty and delete the bucket, then remove local files
aws s3 rb "s3://$BUCKET" --force
rm -f index.html dist-config.json bucket-policy.json dist.json dist-geo.json dist-nogeo.json dist-disabled.json
```
:::

> [!CHECK]
> The CloudFront **Distributions** list and **Origin access** page no longer show your lab resources, and the S3 bucket is gone. In **Billing and Cost Management** → **Bills**, CloudFront shows no charges beyond the free tier for this month.

## Progress checklist

- [ ] Step 1: private bucket created, direct S3 URL returns AccessDenied
- [ ] Step 2: distribution with OAC deployed and bucket policy scoped to its ARN
- [ ] Step 3: page served through CloudFront; saw Miss then Hit in `x-cache`
- [ ] Step 4: updated the object and observed the stale cached version
- [ ] Step 5: invalidated `/index.html` and saw version 2
- [ ] Step 6: geo restriction returned 403 for your country, then removed it
- [ ] Cleanup: distribution, origin access control and bucket deleted
