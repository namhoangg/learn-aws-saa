---
id: 16-storage-extras-lab-02
title: Give a partner SFTP access to an S3 bucket with AWS Transfer Family
objective: Create a managed SFTP server backed by Amazon S3, add a service-managed user locked to their own folder, and upload and download files with a standard SFTP client.
estimatedTime: 40 minutes
cost: "About USD 0.30 per hour while the server exists (SFTP protocol hourly fee in us-east-1) plus USD 0.04 per GB transferred; roughly USD 0.30 to 0.60 if you delete the server within two hours. Sign-up credits on accounts created on or after 15 July 2025 (Free or Paid plan) can cover it; there is no Always Free Transfer Family allowance."
freeTier: partial
services: [transfer-family, s3, iam-roles]
---

> [!COST]
> A Transfer Family server is billed **USD 0.30 per hour for each enabled protocol** (us-east-1) from the moment it is created until it is **deleted**. A **stopped** server still accrues this charge, so stopping is not enough. Data uploaded or downloaded over SFTP costs USD 0.04 per GB (this lab moves a few kilobytes). Do the **Cleanup** section as soon as you finish; a forgotten server costs about USD 220 per month.
>
> Transfer Family works on both account plans: the [AWS Free Tier page](https://aws.amazon.com/free/) lists it as available on the credit-based **Free plan** as well as the **Paid plan**, so sign-up credits pay for this lab either way. The exception is an account made through the limited-rollout **Sign up for AWS (new)** experience, where AWS lists Transfer Family as unsupported until you [activate advanced AWS features](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html). {{updated: Checked 2026-10-04 on the AWS Free Tier page and the Sign up for AWS (new) service list; standard Free plan accounts can use Transfer Family.}}

This lab rebuilds the classic "partners drop files on our SFTP server" setup without any server to run. The user authenticates with an SSH key stored in Transfer Family, Transfer Family assumes an IAM role to write into S3, and a logical home directory keeps the user inside their own prefix.

## Prerequisites

- An AWS account with permissions for AWS Transfer Family, S3 and IAM (for example `AWSTransferConsoleFullAccess`, `AmazonS3FullAccess` and permission to create IAM roles and policies). Free plan and Paid plan accounts both work; an account created through Sign up for AWS (new) must first activate advanced AWS features (see the COST note).
- One Region for everything; the examples use `us-east-1`.
- **AWS CloudShell** for the SSH key and the SFTP client (it includes `ssh-keygen` and `sftp`; if `sftp` is missing, run `sudo dnf install -y openssh-clients`). Keep the same CloudShell tab open: later commands reuse shell variables.

## Steps

### Step 1: Create the bucket and a welcome file

:::console
1. Open CloudShell and run the CLI commands for this step: they create a uniquely named bucket and put `partner1/welcome.txt` in it.
2. In the **S3** console, open the bucket and confirm the `partner1/` folder contains `welcome.txt`.
:::

:::cli
```bash
REGION=${AWS_REGION:-us-east-1}
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET=sftp-lab-$ACCOUNT_ID-$RANDOM
aws s3 mb "s3://$BUCKET" --region "$REGION"
echo "Welcome, partner 1. Drop your files here." > welcome.txt
aws s3 cp welcome.txt "s3://$BUCKET/partner1/welcome.txt"
echo "Bucket: $BUCKET"
```
:::

### Step 2: Create the IAM role that Transfer Family assumes for the user

Transfer Family never uses the user's own AWS credentials; it assumes an IAM role you attach to the user. The role needs a trust relationship with `transfer.amazonaws.com` and permissions on the bucket.

:::console
1. Open the **IAM** console, choose **Policies**, then **Create policy**, and switch the policy editor to **JSON**.
2. Paste the policy from the CLI tab (the `sftp-access.json` part), replacing `BUCKET_NAME` with your bucket name. Choose **Next**, name it `sftp-lab-bucket-access`, and choose **Create policy**.
3. Choose **Roles**, then **Create role**. For **Trusted entity type** choose **AWS service**, and for **Service or use case** choose **Transfer**. Choose **Next**.
4. Select the `sftp-lab-bucket-access` policy and choose **Next**.
5. For **Role name** enter `sftp-lab-user-role` and choose **Create role**.
:::

:::cli
```bash
cat > sftp-trust.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "transfer.amazonaws.com" },
    "Action": "sts:AssumeRole",
    "Condition": {
      "StringEquals": { "aws:SourceAccount": "$ACCOUNT_ID" },
      "ArnLike": { "aws:SourceArn": "arn:aws:transfer:$REGION:$ACCOUNT_ID:user/*" }
    }
  }]
}
EOF

# In the console path, replace BUCKET_NAME by hand; here the shell fills it in.
cat > sftp-access.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListBucket",
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": "arn:aws:s3:::$BUCKET"
    },
    {
      "Sid": "ObjectAccess",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:GetObjectTagging", "s3:DeleteObject",
                 "s3:GetObjectVersion", "s3:DeleteObjectVersion"],
      "Resource": "arn:aws:s3:::$BUCKET/*"
    }
  ]
}
EOF

USER_ROLE_ARN=$(aws iam create-role --role-name sftp-lab-user-role \
  --assume-role-policy-document file://sftp-trust.json --query Role.Arn --output text)
aws iam put-role-policy --role-name sftp-lab-user-role --policy-name sftp-lab-bucket-access \
  --policy-document file://sftp-access.json
echo "$USER_ROLE_ARN"
```
:::

> [!CHECK]
> In IAM, `sftp-lab-user-role` shows **transfer.amazonaws.com** under **Trust relationships** and a policy that allows `s3:PutObject` and `s3:GetObject` on your bucket only.

### Step 3: Create an SFTP-enabled server

:::console
1. Open the **AWS Transfer Family** console, choose **Servers** in the navigation pane, then **Create server**.
2. In **Choose protocols**, select **SFTP** and choose **Next**.
3. In **Choose an identity provider**, choose **Service managed** and choose **Next**.
4. In **Choose an endpoint**, for **Endpoint type** choose **Publicly accessible**, for **Custom hostname** choose **None**, and choose **Next**.
5. In **Choose a domain**, choose **Amazon S3** and choose **Next**.
6. In **Configure additional details**, keep the default **Cryptographic algorithm options** and other defaults, and choose **Next**.
7. In **Review and create**, choose **Create server**.
8. Wait until the server's state is **Online** (a few minutes), then open it and copy the **Endpoint** (it looks like `s-1234567890abcdef0.server.transfer.us-east-1.amazonaws.com`).
:::

:::cli
```bash
SERVER_ID=$(aws transfer create-server \
  --protocols SFTP \
  --identity-provider-type SERVICE_MANAGED \
  --endpoint-type PUBLIC \
  --domain S3 \
  --tags Key=Name,Value=sftp-lab \
  --query ServerId --output text)
aws transfer wait server-online --server-id "$SERVER_ID"
ENDPOINT="$SERVER_ID.server.transfer.$REGION.amazonaws.com"
echo "Server $SERVER_ID is online at $ENDPOINT"
```
:::

> [!CHECK]
> The **Servers** page shows your server with protocol **SFTP**, identity provider **Service managed**, endpoint type **Public** and state **Online**. The hourly charge has started.

### Step 4: Generate an SSH key and add a restricted user

:::console
1. In CloudShell, run the `ssh-keygen` command from the CLI tab, then run `cat transfer-key.pub` and copy the whole line (it starts with `ssh-rsa`).
2. In the Transfer Family console, open your server (choose its **Server ID**) and, in the **Users** section, choose **Add user**.
3. For **Username** enter `partner1`.
4. For the role (**Access**), choose `sftp-lab-user-role`. For **Policy**, choose **None**.
5. For **Home directory**, choose your `sftp-lab-...` bucket and enter `partner1` as the folder.
6. Select **Restricted** so the user cannot see anything outside that folder (or the bucket name).
7. For **SSH public key**, paste the key you copied, then choose **Add**.
:::

:::cli
```bash
ssh-keygen -t rsa -b 4096 -N "" -f transfer-key -C partner1
aws transfer create-user \
  --server-id "$SERVER_ID" \
  --user-name partner1 \
  --role "$USER_ROLE_ARN" \
  --home-directory-type LOGICAL \
  --home-directory-mappings "[{\"Entry\":\"/\",\"Target\":\"/$BUCKET/partner1\"}]" \
  --ssh-public-key-body "$(cat transfer-key.pub)"
aws transfer describe-user --server-id "$SERVER_ID" --user-name partner1 \
  --query 'User.{Home:HomeDirectoryType,Mappings:HomeDirectoryMappings,Keys:length(SshPublicKeys)}'
```
:::

> [!CHECK]
> The server's **Users** list shows `partner1` with your IAM role and one SSH key. `describe-user` shows a `LOGICAL` home directory mapping `/` to `/sftp-lab-.../partner1`.

### Step 5: Connect with an SFTP client, download and upload

If you created the server in the console, first set the two shell variables in CloudShell: `ENDPOINT=<the endpoint you copied>` and `BUCKET=<your bucket name>`. In the CLI tab, `sftp -b` stops at the first command that fails; the leading `-` on `-cd ..` tells it to carry on even if the server refuses the move.

:::console
1. In CloudShell, create a file to upload: `echo "Inventory for today" > upload-test.txt`.
2. Connect interactively: `sftp -i transfer-key -o StrictHostKeyChecking=accept-new partner1@$ENDPOINT`.
3. At the `sftp>` prompt run `pwd` (it shows `/`), `ls` (you see `welcome.txt`), then `get welcome.txt downloaded-welcome.txt` to download it.
4. Run `put upload-test.txt`, then `ls` to see it listed.
5. Try to escape the home folder: `cd ..` then `pwd`. You stay at `/`. Type `bye` to exit.
:::

:::cli
```bash
echo "Inventory for today" > upload-test.txt
cat > sftp-cmds.txt <<'EOF'
pwd
ls
get welcome.txt downloaded-welcome.txt
put upload-test.txt
-cd ..
pwd
ls
EOF
sftp -i transfer-key -o StrictHostKeyChecking=accept-new -b sftp-cmds.txt "partner1@$ENDPOINT"
cat downloaded-welcome.txt
```
:::

> [!CHECK]
> The session shows `/` as the working directory before and after `cd ..`, lists `welcome.txt` and then `upload-test.txt`, and `downloaded-welcome.txt` contains the welcome text. The user never sees the bucket name or other prefixes.

### Step 6: Confirm the upload landed in S3

:::console
1. In the **S3** console, open your bucket and the `partner1/` folder.
2. Confirm `upload-test.txt` is there next to `welcome.txt`, and open it to see its contents.
:::

:::cli
```bash
aws s3 ls "s3://$BUCKET/partner1/"
aws s3 cp "s3://$BUCKET/partner1/upload-test.txt" -
```
:::

> [!CHECK]
> `upload-test.txt` is an ordinary S3 object under `partner1/`. From here, an S3 Event Notification could trigger a Lambda function or a Transfer Family managed workflow to process every partner upload automatically.

## Cleanup

Delete everything in this order (the server first, because it is the part that bills by the hour):

- [ ] **User `partner1`**: open the server → **Users** → select `partner1` → **Actions** → **Delete**, then confirm. CLI: `aws transfer delete-user --server-id "$SERVER_ID" --user-name partner1`.
- [ ] **Server `sftp-lab`**: **Servers** → select the server → **Actions** → **Delete**, type `delete` if asked, and confirm. CLI: `aws transfer delete-server --server-id "$SERVER_ID"`.
- [ ] **CloudWatch log group** (only if one was created for the server, named like `/aws/transfer/s-...`): CloudWatch → **Log groups** → select → **Actions** → **Delete log group(s)**. CLI: `aws logs delete-log-group --log-group-name "/aws/transfer/$SERVER_ID"`.
- [ ] **Bucket `sftp-lab-...`**: S3 console → select it → **Empty** (type `permanently delete`), then **Delete** (type the bucket name). CLI: `aws s3 rb "s3://$BUCKET" --force`.
- [ ] **IAM role `sftp-lab-user-role`**: IAM → **Roles** → select → **Delete**, type the role name. CLI: `aws iam delete-role-policy --role-name sftp-lab-user-role --policy-name sftp-lab-bucket-access` then `aws iam delete-role --role-name sftp-lab-user-role`.
- [ ] **IAM policy `sftp-lab-bucket-access`** (console path only, where it was created as a managed policy): IAM → **Policies** → select → **Actions** → **Delete**.
- [ ] **CloudShell files**: `rm -f transfer-key transfer-key.pub welcome.txt downloaded-welcome.txt upload-test.txt sftp-cmds.txt sftp-trust.json sftp-access.json`.
- [ ] **Final check**: the Transfer Family **Servers** page is empty in this Region (deleted, not just stopped), and the next day **Billing and Cost Management** → **Bills** shows Transfer Family charges only for the hours the server existed.

## Progress checklist

- [ ] Step 1: Created the bucket and `partner1/welcome.txt`
- [ ] Step 2: Created the IAM role trusted by Transfer Family with bucket permissions
- [ ] Step 3: Created a public, service-managed SFTP server and saw it come online
- [ ] Step 4: Added `partner1` with an SSH key and a restricted home folder
- [ ] Step 5: Downloaded and uploaded files with `sftp` and could not leave the home folder
- [ ] Step 6: Confirmed the upload is an S3 object under `partner1/`
- [ ] Cleanup done: server deleted, not only stopped
