---
id: 14-s3-security-lab-02
title: Fix a CORS error between two buckets and turn on server access logging
objective: Host a page in one bucket that loads JSON from a second bucket, watch the browser block it, fix it with a CORS rule on the right bucket, and record requests with server access logs in a third bucket.
estimatedTime: 45 minutes (plus a few hours of waiting for the first access logs, optional)
cost: "Effectively USD 0.00: three buckets holding a few KB and a few hundred requests (fractions of a cent, covered by Free Tier credits on accounts from 15 July 2025 or the legacy 12-month Free Tier); server access log delivery to S3 is free, you pay only to store the tiny log files."
freeTier: yes
services: [s3, iam-policies, athena]
---

You will rebuild the classic exam scenario: a static website in bucket **HTML** whose JavaScript reads `prices.json` from bucket **DATA**. Then you add logging so every request to the website bucket is recorded in bucket **LOGS**.

> [!WARNING] Two buckets become public
> To host a public website you turn off Block Public Access on the HTML and DATA buckets. Upload only the harmless test files from this lab, never anything private, and delete the buckets when you finish.

## Prerequisites

- An AWS account and an IAM identity that can create buckets, change Block Public Access and bucket policies, and configure CORS and logging (`AdministratorAccess` in a sandbox account is fine).
- **Account-level** Block Public Access must allow public bucket policies. If it is on, you will see a note under **Block public access (bucket settings)**; turn the account setting off only in a sandbox account, and turn it back on during cleanup.
- Region **US East (N. Virginia) us-east-1**. The website endpoint format below (`s3-website-us-east-1`) is specific to that Region; in other Regions copy the endpoint from the console.
- A desktop browser with developer tools (F12) to read the JavaScript console.
- For the CLI tabs: AWS CloudShell or AWS CLI v2. Run this first (if you create the buckets in the console, set `HTML`, `DATA` and `LOGS` to their names instead):

```bash
export AWS_REGION=us-east-1
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
SUFFIX=$RANDOM
HTML="cors-html-${ACCOUNT_ID}-${SUFFIX}"
DATA="cors-data-${ACCOUNT_ID}-${SUFFIX}"
LOGS="access-logs-${ACCOUNT_ID}-${SUFFIX}"
SITE="http://${HTML}.s3-website-${AWS_REGION}.amazonaws.com"
echo "$HTML $DATA $LOGS $SITE"
```

## Steps

### Step 1: Create the three buckets

:::console
1. In the **S3** console choose **General purpose buckets** → **Create bucket**.
2. Create three buckets with default settings, using unique names that start with `cors-html-`, `cors-data-` and `access-logs-` (for example with your account ID and the same random number). Write the names down.
:::

:::cli
```bash
for B in "$HTML" "$DATA" "$LOGS"; do aws s3 mb "s3://$B" --region "$AWS_REGION"; done
```
:::

> [!CHECK]
> Three new buckets are listed, all private, all in us-east-1. The logging bucket keeps the default SSE-S3 encryption, which server access logging requires.

### Step 2: Send the HTML bucket's access logs to the LOGS bucket

Turn this on early so log records accumulate while you work.

:::console
1. Open the **cors-html-...** bucket and choose the **Properties** tab.
2. In the **Server access logging** section, choose **Edit**.
3. Choose **Enable**.
4. Under **Destination bucket**, specify the **access-logs-...** bucket with the prefix `html-logs/`, so the destination reads `s3://access-logs-.../html-logs/` (the trailing slash keeps the log files in their own folder).
5. Keep the default **Log object key format** (`[DestinationPrefix][YYYY]-[MM]-[DD]-[hh]-[mm]-[ss]-[UniqueString]`) and choose **Save changes**.
6. Open the **access-logs-...** bucket → **Permissions** → **Bucket policy** and look at what the console added.
:::

:::cli
```bash
cat > logs-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "S3ServerAccessLogsPolicy",
    "Effect": "Allow",
    "Principal": { "Service": "logging.s3.amazonaws.com" },
    "Action": "s3:PutObject",
    "Resource": "arn:aws:s3:::${LOGS}/html-logs/*",
    "Condition": {
      "ArnLike": { "aws:SourceArn": "arn:aws:s3:::${HTML}" },
      "StringEquals": { "aws:SourceAccount": "${ACCOUNT_ID}" }
    }
  }]
}
EOF
aws s3api put-bucket-policy --bucket "$LOGS" --policy file://logs-policy.json
aws s3api put-bucket-logging --bucket "$HTML" --bucket-logging-status \
  "{\"LoggingEnabled\":{\"TargetBucket\":\"${LOGS}\",\"TargetPrefix\":\"html-logs/\"}}"
aws s3api get-bucket-logging --bucket "$HTML"
```
:::

> [!CHECK]
> Server access logging on the HTML bucket shows **Enabled** with the LOGS bucket as destination. The LOGS bucket now has a policy allowing `logging.s3.amazonaws.com` to `s3:PutObject` (the console writes it for you; with the CLI you added it yourself). Note that you did **not** choose the HTML bucket as its own destination, which would cause a logging loop.

### Step 3: Publish prices.json from the DATA bucket

:::console
1. Open the **cors-data-...** bucket → **Permissions**.
2. Under **Block public access (bucket settings)**, choose **Edit**, clear **Block *all* public access**, choose **Save changes**, and confirm.
3. Under **Bucket policy**, choose **Edit**, paste the policy below with your DATA bucket name, and choose **Save changes**.
4. Create a local file `prices.json` containing `{"espresso": 2.5, "latte": 3.8, "mocha": 4.1}` and upload it on the **Objects** tab.
:::

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "PublicReadGetObject",
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::DATA_BUCKET_NAME/*"
  }]
}
```

:::cli
```bash
aws s3api delete-public-access-block --bucket "$DATA"
aws s3api put-bucket-policy --bucket "$DATA" --policy "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{\"Sid\": \"PublicReadGetObject\", \"Effect\": \"Allow\", \"Principal\": \"*\",
    \"Action\": \"s3:GetObject\", \"Resource\": \"arn:aws:s3:::${DATA}/*\"}]
}"
echo '{"espresso": 2.5, "latte": 3.8, "mocha": 4.1}' > prices.json
aws s3 cp prices.json "s3://$DATA/prices.json" --content-type application/json
curl -s "https://${DATA}.s3.${AWS_REGION}.amazonaws.com/prices.json"; echo
```
:::

> [!CHECK]
> Opening `https://<DATA bucket>.s3.us-east-1.amazonaws.com/prices.json` in a browser tab (or with curl) shows the JSON. The file is public, so any failure later cannot be a permissions problem.

### Step 4: Host the page in the HTML bucket

Save this as `index.html`, replacing `DATA_BUCKET_NAME` with your DATA bucket name (the CLI tab does this for you):

```html
<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Coffee prices</title></head>
  <body>
    <h1>Coffee prices</h1>
    <pre id="out">Loading...</pre>
    <script>
      fetch("https://DATA_BUCKET_NAME.s3.us-east-1.amazonaws.com/prices.json")
        .then(r => r.json())
        .then(d => { document.getElementById("out").textContent = JSON.stringify(d, null, 2); })
        .catch(e => { document.getElementById("out").textContent = "Failed: " + e; });
    </script>
  </body>
</html>
```

:::console
1. Open the **cors-html-...** bucket → **Properties** → **Static website hosting** → **Edit**.
2. Choose **Enable** (use this bucket to host a website), enter `index.html` as the **Index document**, and choose **Save changes**.
3. Copy the **Endpoint** shown under **Static website hosting** (for example `http://cors-html-....s3-website-us-east-1.amazonaws.com`).
4. On the **Permissions** tab, turn off **Block *all* public access** as in Step 3, and add the same public-read bucket policy with the HTML bucket name.
5. Upload `index.html` on the **Objects** tab.
:::

:::cli
```bash
sed "s/DATA_BUCKET_NAME/${DATA}/" > index.html <<'EOF'
<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Coffee prices</title></head>
  <body>
    <h1>Coffee prices</h1>
    <pre id="out">Loading...</pre>
    <script>
      fetch("https://DATA_BUCKET_NAME.s3.us-east-1.amazonaws.com/prices.json")
        .then(r => r.json())
        .then(d => { document.getElementById("out").textContent = JSON.stringify(d, null, 2); })
        .catch(e => { document.getElementById("out").textContent = "Failed: " + e; });
    </script>
  </body>
</html>
EOF
aws s3 website "s3://$HTML" --index-document index.html
aws s3api delete-public-access-block --bucket "$HTML"
aws s3api put-bucket-policy --bucket "$HTML" --policy "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{\"Sid\": \"PublicReadGetObject\", \"Effect\": \"Allow\", \"Principal\": \"*\",
    \"Action\": \"s3:GetObject\", \"Resource\": \"arn:aws:s3:::${HTML}/*\"}]
}"
aws s3 cp index.html "s3://$HTML/index.html"
echo "Open: $SITE"
```
:::

### Step 5: Watch the browser block the request

1. Open the website endpoint in your browser.
2. Press **F12** and look at the **Console** tab.
3. Optionally, ask S3 from the CLI whether it would allow your page's origin. The page's `fetch()` is a plain GET with no custom headers, a so-called simple request, so the browser sends no preflight; it simply looks for `Access-Control-Allow-Origin` in the response. A preflight-style `OPTIONS` request is the easiest way to see S3's CORS decision directly.

:::cli
```bash
curl -s -i -X OPTIONS "https://${DATA}.s3.${AWS_REGION}.amazonaws.com/prices.json" \
  -H "Origin: ${SITE}" -H "Access-Control-Request-Method: GET" | head -n 15
```
:::

> [!CHECK]
> The page shows `Failed: TypeError: Failed to fetch` (wording varies by browser) and the console reports that the request was blocked by CORS policy because no `Access-Control-Allow-Origin` header is present. The OPTIONS call returns **HTTP 403** with a message that CORS is not enabled: the DATA bucket has no CORS configuration. The JSON itself is public, so this is purely the browser's same-origin rule at work.

### Step 6: Add a CORS rule on the DATA bucket

CORS goes on the bucket that **serves** the file, not on the bucket that hosts the page.

:::console
1. Open the **cors-data-...** bucket → **Permissions**.
2. In the **Cross-origin resource sharing (CORS)** section, choose **Edit**.
3. Paste the JSON below, replacing the origin with your HTML website endpoint exactly as shown in the console (scheme included, no trailing slash), and choose **Save changes**.
4. Reload the website page (use a hard refresh, Ctrl+F5).
:::

```json
[
  {
    "AllowedOrigins": ["http://cors-html-EXAMPLE.s3-website-us-east-1.amazonaws.com"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 300
  }
]
```

:::cli
```bash
# The CLI wraps the same rules in a "CORSRules" object.
aws s3api put-bucket-cors --bucket "$DATA" --cors-configuration "{
  \"CORSRules\": [{
    \"AllowedOrigins\": [\"${SITE}\"],
    \"AllowedMethods\": [\"GET\", \"HEAD\"],
    \"AllowedHeaders\": [\"*\"],
    \"MaxAgeSeconds\": 300
  }]
}"
curl -s -i -X OPTIONS "https://${DATA}.s3.${AWS_REGION}.amazonaws.com/prices.json" \
  -H "Origin: ${SITE}" -H "Access-Control-Request-Method: GET" | grep -i '^HTTP\|^access-control'
```
:::

> [!CHECK]
> The page now shows the three coffee prices. The OPTIONS check returns **HTTP 200** with `Access-Control-Allow-Origin: http://cors-html-...` and `Access-Control-Allow-Methods: GET, HEAD`. Try changing `AllowedOrigins` to a different value: the page breaks again, proving the origin must match exactly (or be `*`).

### Step 7: Read the server access logs (after a few hours)

Log delivery is best effort and usually takes a few hours, so you may have to come back to this step before doing the cleanup.

:::console
1. Open the **access-logs-...** bucket and open the `html-logs/` folder.
2. Select one log object and choose **Download** (or **Open**).
3. Look for lines that contain `WEBSITE.GET.OBJECT index.html` and your public IP address.
:::

:::cli
```bash
aws s3 ls "s3://$LOGS/html-logs/" | head
FIRST=$(aws s3 ls "s3://$LOGS/html-logs/" | awk 'NR==1{print $4}')
[ -n "$FIRST" ] && aws s3 cp "s3://$LOGS/html-logs/$FIRST" - | head -n 5
```
:::

> [!CHECK]
> Each log line is space-delimited and includes the bucket name, time, your IP address, the operation (for example `WEBSITE.GET.OBJECT` or `REST.GET.OBJECT`), the key, the HTTP status and the bytes sent. For large volumes you would query these files with Amazon Athena instead of reading them by hand.

## Cleanup

Delete in this order:

- [ ] **Server access logging** on the HTML bucket: **Properties** → **Server access logging** → **Edit** → **Disable** → **Save changes**. CLI: `aws s3api put-bucket-logging --bucket "$HTML" --bucket-logging-status '{}'`.
- [ ] **HTML bucket** (website configuration, bucket policy and `index.html` go with it): **General purpose buckets** → select → **Empty** (type `permanently delete`), then **Delete** (enter the name). CLI: `aws s3 rb "s3://$HTML" --force`.
- [ ] **DATA bucket** (CORS configuration, bucket policy and `prices.json` go with it): empty and delete it the same way. CLI: `aws s3 rb "s3://$DATA" --force`.
- [ ] **LOGS bucket** and its log files: empty and delete it. Log files can still arrive for up to an hour after logging is disabled; if deletion fails because the bucket is not empty, empty it again. CLI: `aws s3 rb "s3://$LOGS" --force`.
- [ ] **Account-level Block Public Access**: if you turned it off for this lab, turn it back on under **Block Public Access settings for this account**.
- [ ] **Local files**: `rm -f index.html prices.json logs-policy.json`.
- [ ] **Final check**: `aws s3 ls | grep -E 'cors-|access-logs-'` prints nothing.

## Progress checklist

- [ ] Step 1: Created the HTML, DATA and LOGS buckets
- [ ] Step 2: Enabled server access logging from HTML to LOGS
- [ ] Step 3: Published `prices.json` publicly from DATA
- [ ] Step 4: Hosted `index.html` as a static website
- [ ] Step 5: Saw the CORS error in the browser and a 403 preflight
- [ ] Step 6: Fixed it with a CORS rule on the DATA bucket
- [ ] Step 7: Found my own requests in the access logs
- [ ] Cleanup done
