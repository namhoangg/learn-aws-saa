---
id: 14-s3-security-lab-01
title: Encrypt S3 objects, force HTTPS and share with a pre-signed URL
objective: See SSE-S3 default encryption, watch an SSE-C upload get blocked, switch objects and the bucket default to SSE-KMS with a Bucket Key, deny plain HTTP with a bucket policy and hand out a short-lived pre-signed URL.
estimatedTime: 40 minutes
cost: "Effectively USD 0.00: a few KB in S3 Standard and a few dozen requests (fractions of a cent, covered by Free Tier credits on accounts from 15 July 2025 or the legacy 12-month Free Tier), plus a handful of KMS requests on the AWS managed key aws/s3 (no monthly key fee; the AWS KMS free tier includes 20,000 requests per month)."
freeTier: yes
services: [s3, kms, cloudtrail, iam-policies]
---

You will create one private bucket and use it to compare encryption options, then lock it down to HTTPS only and share one object with a link that expires after five minutes.

> [!NOTE] Why the AWS managed key
> This lab uses the AWS managed key `aws/s3`, which has no monthly fee. A customer managed key would cost USD 1 per month (prorated hourly) and would be the right choice in production when you need a key policy or cross-account sharing.

## Prerequisites

- An AWS account and an IAM identity with permissions for S3 (`s3:*` on the lab bucket), KMS use of `aws/s3`, and `cloudtrail:LookupEvents`. `AdministratorAccess` in a sandbox account is fine.
- Region **US East (N. Virginia) us-east-1** selected in the console (any Region works; adjust the commands if you change it).
- For the CLI tabs: **AWS CloudShell** (recommended) or a recent AWS CLI v2 configured locally. A CLI version from before April 2026 may not recognise the `BlockedEncryptionTypes` field; update it if Step 5 fails with a parameter validation error.
- Run this block first in the CLI tab; later steps reuse the variables (if you create the bucket in the console, set `BUCKET` to its name instead):

```bash
export AWS_REGION=us-east-1
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET="enc-lab-${ACCOUNT_ID}-${RANDOM}"
echo "$BUCKET"
echo "hello from an encrypted object" > note.txt
echo "quarterly numbers" > report.txt
```

## Steps

### Step 1: Create a private bucket

:::console
1. Open the **S3** console and choose **General purpose buckets** in the left navigation pane.
2. Choose **Create bucket**.
3. For **Bucket name**, enter a globally unique name such as `enc-lab-<your-account-id>-<random digits>` and write it down.
4. Keep every other setting at its default (ACLs disabled, **Block *all* public access** on, versioning off) and choose **Create bucket**.
:::

:::cli
```bash
aws s3 mb "s3://$BUCKET" --region "$AWS_REGION"
aws s3api get-public-access-block --bucket "$BUCKET"
```
:::

> [!CHECK]
> The bucket appears in the list with access shown as not public. The CLI prints all four Block Public Access settings as `true`.

### Step 2: Look at default encryption (SSE-S3)

:::console
1. Open the bucket and choose the **Properties** tab.
2. Find **Default encryption**. Note the encryption type (**Server-side encryption with Amazon S3 managed keys (SSE-S3)**) and the **Blocked encryption types** setting.
3. Choose the **Objects** tab → **Upload** → **Add files**, pick a small text file named `note.txt` (create one locally if needed), then choose **Upload**.
4. Open `note.txt` in the object list and scroll the object's **Properties** page to its server-side encryption settings.
:::

:::cli
```bash
aws s3api get-bucket-encryption --bucket "$BUCKET"
aws s3 cp note.txt "s3://$BUCKET/note.txt"
aws s3api head-object --bucket "$BUCKET" --key note.txt --query '{SSE:ServerSideEncryption}'
```
:::

> [!CHECK]
> The bucket default is SSE-S3 (`"SSEAlgorithm": "AES256"`) and SSE-C is listed as a blocked encryption type (`"BlockedEncryptionTypes": {"EncryptionType": ["SSE-C"]}` in the CLI output; the Middle East (Bahrain) and Middle East (UAE) Regions are exceptions). The object shows **SSE-S3** / `"SSE": "AES256"` even though you never asked for encryption.

### Step 3: Try an SSE-C upload (CLI only)

The console cannot perform SSE-C, so use CloudShell for this step. The key below is a random throw-away value generated for the test.

:::cli
```bash
TEST_KEY=$(openssl rand -hex 16)   # 32 characters = a 256-bit key
aws s3 cp note.txt "s3://$BUCKET/ssec-note.txt" --sse-c AES256 --sse-c-key "$TEST_KEY"
```
:::

> [!CHECK]
> The upload fails with an `AccessDenied` error on `PutObject`. That is the April 2026 default: new buckets block SSE-C writes until someone sets `BlockedEncryptionTypes` to `NONE`. (In the Middle East (Bahrain) and Middle East (UAE) Regions, which AWS lists as exceptions, the upload may succeed; if so, delete `ssec-note.txt` in cleanup.)

### Step 4: Re-encrypt one object with SSE-KMS

:::console
1. On the **Objects** tab, select the check box next to `note.txt`.
2. From the **Actions** menu, choose **Edit server-side encryption**.
3. Under **Encryption settings**, choose **Override bucket settings for default encryption**.
4. For **Encryption type**, choose **Server-side encryption with AWS Key Management Service keys (SSE-KMS)**.
5. Under **AWS KMS key**, choose **Choose from your AWS KMS keys** and select **aws/s3**.
6. Keep **Additional copy settings** at **Copy source settings** and choose **Save changes**.
7. Open `note.txt` again and check its server-side encryption settings.
:::

:::cli
```bash
# Copying an object onto itself is allowed when the encryption changes.
aws s3 cp "s3://$BUCKET/note.txt" "s3://$BUCKET/note.txt" --sse aws:kms
aws s3api head-object --bucket "$BUCKET" --key note.txt \
  --query '{SSE:ServerSideEncryption,Key:SSEKMSKeyId}'
```
:::

> [!CHECK]
> `note.txt` now shows **SSE-KMS** with a key ARN ending in the ID of the `aws/s3` key (`"SSE": "aws:kms"`). In the **KMS** console under **AWS managed keys** you can now see the alias **aws/s3**. S3 created it the first time you used SSE-KMS.

### Step 5: Make SSE-KMS with a Bucket Key the bucket default

:::console
1. Go back to the bucket's **Properties** tab and choose **Edit** in **Default encryption**.
2. For **Encryption type**, choose **Server-side encryption with AWS Key Management Service keys (SSE-KMS)**.
3. Under **AWS KMS key**, choose **Choose from your AWS KMS keys** and select **aws/s3**.
4. Under **Bucket Key**, choose **Enable**.
5. Leave **Server-side encryption with customer-provided keys (SSE-C)** checked under **Blocked encryption types**, then choose **Save changes**.
6. Upload a second small file named `report.txt` without changing any encryption options, and open its properties.
:::

:::cli
```bash
# Leaving out KMSMasterKeyID makes S3 use the AWS managed key aws/s3.
aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration '{
  "Rules": [{
    "ApplyServerSideEncryptionByDefault": { "SSEAlgorithm": "aws:kms" },
    "BucketKeyEnabled": true,
    "BlockedEncryptionTypes": { "EncryptionType": ["SSE-C"] }
  }]
}'
aws s3 cp report.txt "s3://$BUCKET/report.txt"
aws s3api head-object --bucket "$BUCKET" --key report.txt \
  --query '{SSE:ServerSideEncryption,BucketKey:BucketKeyEnabled}'
```
:::

> [!CHECK]
> `report.txt` is encrypted with SSE-KMS and shows the Bucket Key as enabled (`"BucketKey": true`) although the upload sent no encryption header: the bucket default did the work. `note.txt` from Step 4 keeps the encryption it already had, because default encryption only affects new uploads.

Optional: see the audit trail. KMS calls appear in CloudTrail **Event history** within about 5 to 15 minutes.

:::console
1. Open the **CloudTrail** console and choose **Event history**.
2. Set the lookup attribute to **Event name** and enter `GenerateDataKey`.
:::

:::cli
```bash
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=GenerateDataKey \
  --max-results 5 --query 'Events[].{Time:EventTime,User:Username}'
```
:::

> [!CHECK]
> You see `GenerateDataKey` events from your S3 uploads. This audit trail is exactly what SSE-S3 cannot give you.

### Step 6: Deny every request that is not HTTPS

Create a file named `deny-http.json` (replace `BUCKET_NAME` with your bucket name if you use the console):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyPlainHttp",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::BUCKET_NAME",
        "arn:aws:s3:::BUCKET_NAME/*"
      ],
      "Condition": { "Bool": { "aws:SecureTransport": "false" } }
    }
  ]
}
```

:::console
1. Open the bucket's **Permissions** tab.
2. Under **Bucket policy**, choose **Edit**.
3. Paste the policy with your bucket name in both `Resource` lines and choose **Save changes**.
:::

:::cli
```bash
cat > deny-http.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyPlainHttp",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": ["arn:aws:s3:::${BUCKET}", "arn:aws:s3:::${BUCKET}/*"],
      "Condition": { "Bool": { "aws:SecureTransport": "false" } }
    }
  ]
}
EOF
aws s3api put-bucket-policy --bucket "$BUCKET" --policy file://deny-http.json
aws s3api get-bucket-policy --bucket "$BUCKET" --query Policy --output text
```
:::

> [!CHECK]
> The policy saves without errors and the bucket is still listed as not public (a Deny statement never makes a bucket public). Your own CLI and console access keeps working because they use HTTPS.

### Step 7: Share one object with a five-minute pre-signed URL

:::console
1. On the **Objects** tab, select `note.txt`.
2. From the **Object actions** menu, choose **Share with a presigned URL**.
3. Set the validity to **5 minutes** and choose **Create presigned URL**. The URL is copied to your clipboard.
4. Paste the URL into a new browser tab.
5. In the address bar, change `https://` to `http://` and load it again.
6. Try the plain object URL without the query string, for example `https://<bucket>.s3.amazonaws.com/note.txt`.
7. After 5 minutes, reload the original HTTPS link.
:::

:::cli
```bash
URL=$(aws s3 presign "s3://$BUCKET/note.txt" --expires-in 300)
echo "$URL"
curl -s "$URL"; echo                      # HTTPS + valid signature
curl -s "${URL/https:/http:}"; echo       # same signature over plain HTTP
curl -s "https://${BUCKET}.s3.amazonaws.com/note.txt"; echo   # no signature
```
:::

> [!CHECK]
> The HTTPS pre-signed link prints `hello from an encrypted object`, even though the object is SSE-KMS encrypted and the bucket is private: the URL carries your permissions, including `kms:Decrypt`. The same link over `http://` returns an XML error (normally `AccessDenied` from your bucket policy; an SSE-KMS object would refuse plain HTTP even without that policy). The unsigned URL returns `AccessDenied` because the bucket is private. After five minutes the HTTPS link fails with a "Request has expired" error.

## Cleanup

Delete in this order:

- [ ] **Objects** `note.txt`, `report.txt` (and `ssec-note.txt` if Step 3 succeeded): select them on the **Objects** tab → **Delete**, type `permanently delete`, choose **Delete objects**. CLI: covered by the next item.
- [ ] **Bucket** `enc-lab-...` (its bucket policy and encryption settings go with it): in **General purpose buckets** select it → **Delete**, enter the bucket name, choose **Delete bucket**. CLI: `aws s3 rb "s3://$BUCKET" --force` (empties the bucket, then deletes it).
- [ ] **AWS managed key `aws/s3`**: nothing to do. AWS managed keys cannot be deleted and have no monthly charge.
- [ ] **Local files** `note.txt`, `report.txt`, `deny-http.json`: `rm -f note.txt report.txt deny-http.json`.
- [ ] **Final check**: `aws s3 ls | grep enc-lab` prints nothing. In a day or two, **Billing and Cost Management** → **Bills** shows no meaningful S3 or KMS charges.

## Progress checklist

- [ ] Step 1: Created a private bucket
- [ ] Step 2: Confirmed SSE-S3 default encryption on a new object
- [ ] Step 3: Saw an SSE-C upload rejected with AccessDenied
- [ ] Step 4: Re-encrypted `note.txt` with SSE-KMS (`aws/s3`)
- [ ] Step 5: Set SSE-KMS + Bucket Key as the default and saw `GenerateDataKey` in CloudTrail
- [ ] Step 6: Added a bucket policy that denies plain HTTP
- [ ] Step 7: Used a pre-signed URL over HTTPS, saw it fail over HTTP and after expiry
- [ ] Cleanup done
