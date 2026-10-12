---
id: 12-s3-fundamentals-lab-01
title: Create a bucket, explore keys and host a public static website
objective: Create a private S3 bucket, upload objects with prefixes, metadata and tags, prove that objects are private by default, then publish a static website with website hosting, Block Public Access and a bucket policy.
estimatedTime: 40 minutes
cost: "Effectively zero: a few KB of S3 Standard storage and a few hundred requests cost well under USD 0.01, covered by Free Tier credits (new accounts) or the legacy 12-month Free Tier."
freeTier: yes
services: [s3, iam]
---

In this lab you build the classic S3 website from the slides' hands-on part, but in a deliberate order: first you see that a new bucket is private, then you watch each permission layer (website hosting, Block Public Access, bucket policy) change the HTTP status you get back.

> [!WARNING]
> You will make a few objects readable by anyone on the internet. Upload only the harmless files from this lab, and finish the **Cleanup** section.

## Prerequisites

- An AWS account you control. Use a personal or sandbox account: if your organization enforces Block Public Access at the organization or account level, the website will stay at 403, which is the intended protection (step 6 shows how to check).
- An IAM identity allowed to manage S3 in this account (for example the `AmazonS3FullAccess` managed policy), including `s3:PutBucketPolicy`, `s3:PutBucketPublicAccessBlock` and `s3:PutBucketWebsite`.
- Region **US East (N. Virginia) `us-east-1`** (the website URL format below assumes it).
- For the CLI tabs: AWS CLI v2 configured, or AWS CloudShell, with a Bash shell. `curl` is used to read HTTP status codes.
- A text editor to create four small files.

## Steps

### Step 1: Prepare the website files

Create a folder on your computer with this layout and content (CloudShell users can run the CLI block instead).

```text
s3-lab-site/
  index.html
  error.html
  images/logo.svg
  notes/readme.txt
```

`index.html`:

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>S3 lab site</title></head>
<body><h1>Hello from Amazon S3</h1><img src="images/logo.svg" alt="logo" width="120"></body></html>
```

`error.html`:

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>Not found</title></head>
<body><h1>Custom error page: that page does not exist</h1></body></html>
```

`images/logo.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><circle cx="60" cy="60" r="50" fill="#ff9900"/></svg>
```

`notes/readme.txt`: any line of text, for example `Private notes, not part of the site`.

:::cli
```bash
export AWS_REGION=us-east-1
BUCKET="s3-lab-site-$(date +%s)"   # globally unique name
echo "Bucket name: $BUCKET"
mkdir -p s3-lab-site/images s3-lab-site/notes && cd s3-lab-site
cat > index.html <<'EOF'
<!doctype html>
<html><head><meta charset="utf-8"><title>S3 lab site</title></head>
<body><h1>Hello from Amazon S3</h1><img src="images/logo.svg" alt="logo" width="120"></body></html>
EOF
cat > error.html <<'EOF'
<!doctype html>
<html><head><meta charset="utf-8"><title>Not found</title></head>
<body><h1>Custom error page: that page does not exist</h1></body></html>
EOF
cat > images/logo.svg <<'EOF'
<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><circle cx="60" cy="60" r="50" fill="#ff9900"/></svg>
EOF
echo "Private notes, not part of the site" > notes/readme.txt
ls -R
```
:::

### Step 2: Create a private bucket with default settings

:::console
1. Open the **Amazon S3** console. In the navigation bar, choose the Region **US East (N. Virginia)**.
2. In the left navigation pane, choose **General purpose buckets**, then **Create bucket**.
3. If the page shows a **Bucket type** choice, keep **General purpose**. For **Bucket name**, enter a unique lowercase name such as `s3-lab-site-<your initials>-<random digits>`. If the page asks which bucket namespace to use, keep the default global namespace for this lab.
4. Under **Object Ownership**, keep **ACLs disabled** with **Bucket owner enforced** (the default).
5. Under **Block Public Access settings for this bucket**, keep **Block *all* public access** selected for now.
6. Keep **Bucket Versioning** disabled and **Default encryption** at **Server-side encryption with Amazon S3 managed keys (SSE-S3)**.
7. Choose **Create bucket**.
:::

:::cli
```bash
# us-east-1 needs no LocationConstraint; every other Region does
aws s3api create-bucket --bucket "$BUCKET" --region us-east-1
aws s3api get-bucket-ownership-controls --bucket "$BUCKET"
aws s3api get-public-access-block --bucket "$BUCKET"
aws s3api get-bucket-encryption --bucket "$BUCKET" \
  --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault'
```
:::

> [!CHECK]
> The bucket appears in the list with **AWS Region** `US East (N. Virginia) us-east-1`. The CLI shows `ObjectOwnership: BucketOwnerEnforced`, all four Block Public Access flags `true`, and `SSEAlgorithm: AES256` (SSE-S3). Nothing was configured by you: these are the secure defaults.

### Step 3: Upload objects and inspect keys, metadata and tags

:::console
1. Open the bucket and choose **Upload**.
2. Choose **Add files** and select `index.html` and `error.html`. Choose **Add folder** and select the `images` folder, then again for the `notes` folder.
3. Choose **Upload**, then **Close** on the **Upload: status** page.
4. Open the `notes/` folder and choose `readme.txt`. On its **Properties** tab, find **Key** (`notes/readme.txt`), **Size**, **Entity tag (Etag)**, **Storage class** (Standard) and **Server-side encryption settings**.
5. Still on `readme.txt`, scroll to **Tags**, choose **Edit**, choose **Add tag**, enter key `Classification` and value `Internal`, and choose **Save changes**.
6. Scroll to **Metadata** and note the system-defined `Content-Type` (`text/plain`).
:::

:::cli
```bash
aws s3 cp index.html "s3://$BUCKET/index.html"
aws s3 cp error.html "s3://$BUCKET/error.html"
aws s3 cp images/logo.svg "s3://$BUCKET/images/logo.svg"
aws s3 cp notes/readme.txt "s3://$BUCKET/notes/readme.txt" --metadata owner=lab-user
aws s3api put-object-tagging --bucket "$BUCKET" --key notes/readme.txt \
  --tagging 'TagSet=[{Key=Classification,Value=Internal}]'

aws s3 ls "s3://$BUCKET" --recursive
aws s3api head-object --bucket "$BUCKET" --key notes/readme.txt \
  --query '{Type:ContentType,Meta:Metadata,Class:StorageClass,SSE:ServerSideEncryption,ETag:ETag}'
aws s3api get-object-tagging --bucket "$BUCKET" --key notes/readme.txt
```
:::

> [!CHECK]
> The console shows `images/` and `notes/` as folders, but the recursive listing shows the truth: four flat keys, two of which contain slashes (`images/logo.svg`, `notes/readme.txt`). On the CLI path, `head-object` returns your user metadata as `owner: lab-user` (sent as `x-amz-meta-owner`), `Class: null` (S3 leaves the storage class header out for Standard objects, while the console shows **Standard**) and `AES256` encryption. `get-object-tagging` lists the `Classification=Internal` tag.

### Step 4: Prove that objects are private by default

:::console
1. Open `index.html` and copy its **Object URL** (it looks like `https://<bucket>.s3.us-east-1.amazonaws.com/index.html`).
2. Paste the URL into a new browser tab. You get an XML error with `<Code>AccessDenied</Code>`.
3. Back on the object page, choose **Open**. The page loads, because the console generates a short-lived pre-signed URL that carries your own credentials.
:::

:::cli
```bash
# Anonymous request to the REST endpoint: expect 403
curl -s -o /dev/null -w "%{http_code}\n" "https://$BUCKET.s3.us-east-1.amazonaws.com/index.html"
# Pre-signed URL signed with your credentials, valid 5 minutes: expect 200
URL=$(aws s3 presign "s3://$BUCKET/index.html" --expires-in 300)
curl -s -o /dev/null -w "%{http_code}\n" "$URL"
```
:::

> [!CHECK]
> Anonymous access returns **403**; the signed request returns **200**. Same object, same bucket: the only difference is who is asking.

### Step 5: Enable static website hosting

:::console
1. Open the bucket's **Properties** tab and scroll to **Static website hosting**. Choose **Edit**.
2. Choose **Use this bucket to host a website**, then under **Static website hosting** choose **Enable**.
3. For **Index document**, enter `index.html`. For **Error document**, enter `error.html`. Leave **Redirection rules** empty.
4. Choose **Save changes**.
5. Scroll back to **Static website hosting** at the bottom of the **Properties** tab and open the website endpoint link shown there.
:::

:::cli
```bash
aws s3 website "s3://$BUCKET/" --index-document index.html --error-document error.html
SITE="http://$BUCKET.s3-website-us-east-1.amazonaws.com"
echo "$SITE"
curl -s -o /dev/null -w "%{http_code}\n" "$SITE/"
```
:::

> [!CHECK]
> The endpoint is `http://<bucket>.s3-website-us-east-1.amazonaws.com` (the dash format used in us-east-1) and it answers **403 Forbidden** with `Code: AccessDenied`. Website hosting changes how S3 answers, not who may read.

### Step 6: Relax Block Public Access for bucket policies only

You only need public **policies**; ACLs stay disabled and blocked.

:::console
1. Open the bucket's **Permissions** tab. Under **Block public access (bucket settings)**, choose **Edit**.
2. Clear **Block *all* public access**, then select again the two settings that mention **access control lists (ACLs)**. Leave the two settings that mention **bucket or access point policies** cleared.
3. Choose **Save changes**. If the console asks you to confirm, type `confirm` and choose **Confirm**.
4. If a notice says Block Public Access is turned on for the account, open **Block Public Access settings for this account** in the left navigation pane to review it. Do not change account-wide settings in a shared or work account; stop the lab here and clean up instead.
:::

:::cli
```bash
aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false
aws s3api get-public-access-block --bucket "$BUCKET"
# Account-level settings (an error saying no configuration exists means nothing is set at account level)
aws s3control get-public-access-block \
  --account-id "$(aws sts get-caller-identity --query Account --output text)"
```
:::

> [!CHECK]
> The bucket shows the ACL-related settings **On** and the policy-related settings **Off**. Reload the website endpoint: it is **still 403**, because no policy grants public read yet.

### Step 7: Add a public-read bucket policy for the site files

The policy grants read access only to the site's keys, so `notes/readme.txt` stays private.

:::console
1. On the **Permissions** tab, under **Bucket policy**, choose **Edit**.
2. Paste the policy below, replacing `YOUR-BUCKET` (three times) with your bucket name, and choose **Save changes**.
3. Reload the website endpoint, then open `<endpoint>/does-not-exist.html` and `<endpoint>/notes/readme.txt`.
4. Try `https://` instead of `http://` on the website endpoint.
:::

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadForSiteFiles",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": [
        "arn:aws:s3:::YOUR-BUCKET/index.html",
        "arn:aws:s3:::YOUR-BUCKET/error.html",
        "arn:aws:s3:::YOUR-BUCKET/images/*"
      ]
    }
  ]
}
```

:::cli
```bash
cat > policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadForSiteFiles",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": [
        "arn:aws:s3:::$BUCKET/index.html",
        "arn:aws:s3:::$BUCKET/error.html",
        "arn:aws:s3:::$BUCKET/images/*"
      ]
    }
  ]
}
EOF
aws s3api put-bucket-policy --bucket "$BUCKET" --policy file://policy.json
aws s3api get-bucket-policy-status --bucket "$BUCKET"
curl -s -o /dev/null -w "home: %{http_code}\n" "$SITE/"
curl -s -o /dev/null -w "missing page: %{http_code}\n" "$SITE/does-not-exist.html"
curl -s "$SITE/does-not-exist.html" | grep -o "Custom error page[^<]*"
curl -s -o /dev/null -w "private notes: %{http_code}\n" "$SITE/notes/readme.txt"
curl -s -m 10 -o /dev/null -w "https: %{http_code}\n" "https://$BUCKET.s3-website-us-east-1.amazonaws.com/" || echo "https: connection failed"
```
:::

> [!CHECK]
> The home page shows "Hello from Amazon S3" with an orange circle (**200**). The missing page returns your custom error page with status **403**, not 404: the policy does not let anonymous users read (or list) that key, so S3 will not reveal whether it exists. `notes/readme.txt` is refused the same way (**403** with your error page) because the policy does not cover it. `get-bucket-policy-status` reports `IsPublic: true`. HTTPS to the website endpoint fails: it is HTTP only.

### Step 8: Watch Block Public Access override the policy

:::console
1. On **Permissions** → **Block public access (bucket settings)** → **Edit**, select only the setting about **new** public bucket or access point policies. Save and confirm. Reload the site: it still works, because existing policies are not touched by this setting.
2. Edit again and also select the setting about **any** public bucket or access point policies. Save and confirm. Wait a minute and reload the site (use a private browser window to avoid the cache).
:::

:::cli
```bash
aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=false
curl -s -o /dev/null -w "after BlockPublicPolicy: %{http_code}\n" "$SITE/"

aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
sleep 60
curl -s -o /dev/null -w "after RestrictPublicBuckets: %{http_code}\n" "$SITE/"
```
:::

> [!CHECK]
> With only `BlockPublicPolicy` on, the site still answers **200** (it blocks *new* public policies). With `RestrictPublicBuckets` on, the same bucket policy is still attached but anonymous requests get **403**: Block Public Access sits above the policy.

## Cleanup

Deleting the bucket removes its objects, bucket policy, website configuration and Block Public Access settings.

- [ ] **Objects in the bucket** (`index.html`, `error.html`, `images/logo.svg`, `notes/readme.txt`): **General purpose buckets** → select the bucket → **Empty** → type the confirmation text the page asks for → **Empty**. CLI: `aws s3 rm "s3://$BUCKET" --recursive`.
- [ ] **Bucket** (with its bucket policy and website configuration): select the bucket → **Delete** → enter the bucket name → **Delete bucket**. CLI: `aws s3 rb "s3://$BUCKET"` (or `aws s3 rb "s3://$BUCKET" --force` to empty and delete in one command; this works because versioning was never enabled).
- [ ] **Local files**: delete the `s3-lab-site` folder (CLI: `cd .. && rm -rf s3-lab-site`).
- [ ] **Account-level Block Public Access**: if you changed it for this lab, turn it back on (**Block Public Access settings for this account** → **Edit** → select **Block *all* public access** → **Save changes**).
- [ ] **Final check**: `aws s3 ls | grep s3-lab-site` returns nothing, and the website URL no longer resolves to your content.

## Progress checklist

- [ ] Step 1: Website files prepared
- [ ] Step 2: Private bucket created with secure defaults
- [ ] Step 3: Objects uploaded; keys, metadata and tags inspected
- [ ] Step 4: Saw 403 anonymously and 200 with a pre-signed URL
- [ ] Step 5: Website hosting enabled and 403 observed
- [ ] Step 6: Block Public Access relaxed for policies only
- [ ] Step 7: Bucket policy added; site, custom error page and private notes behave as expected
- [ ] Step 8: RestrictPublicBuckets blocked the existing public policy
- [ ] Cleanup done
