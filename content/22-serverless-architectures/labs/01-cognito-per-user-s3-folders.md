---
id: 22-serverless-architectures-lab-01
title: Give each app user a private S3 folder with Cognito identity pools
objective: Build the MyTodoList identity layer, a Cognito user pool, an identity pool and one IAM role whose policy uses the identity ID variable, then sign in as two users from the CLI and prove each one can read and write only their own S3 prefix.
estimatedTime: 45 minutes
cost: "Free: user pools on the Lite and Essentials plans include 10,000 monthly active users at no charge, identity pools are free, IAM is free, and the S3 requests and a few bytes of storage used here cost a tiny fraction of a cent (covered by Free Tier credits)."
freeTier: yes
services: [cognito, s3, iam-roles, sts]
---

This lab recreates the most important trick from the mobile app case study: letting a phone talk to S3 **directly** with short-lived credentials, while a single IAM role keeps every user inside their own folder. You play the part of the mobile app from AWS CloudShell, signing in as `alice` and `bob` and using the credentials Cognito hands back.

> [!NOTE] Cost
> Amazon Cognito user pools include 10,000 monthly active users per month at no charge on the Lite and Essentials plans, and the free tier does not expire. Identity pools have no charge. Nothing in this lab is billed by the hour.

## Prerequisites

- An AWS account and an IAM user or role that can manage Amazon Cognito, IAM roles and Amazon S3 (for example `AmazonCognitoPowerUser`, `IAMFullAccess` and `AmazonS3FullAccess` in a sandbox account).
- **AWS CloudShell** in the Region you want to use (it has AWS CLI v2, `jq` and `openssl` installed). Keep one CloudShell tab open for the whole lab: later commands reuse shell variables.
- Steps 3, 6, 7 and 8 are CLI only, because signing in as an app user and using the returned credentials has no console equivalent.

## Steps

### Step 1: Set variables and create the bucket

:::console
1. Open the **Amazon S3** console and choose **Create bucket**.
2. Keep the bucket type **General purpose** if the option is shown, and enter a globally unique name such as `todo-files-<account-id>-<region>`.
3. Leave **Block all public access** turned on and the other settings at their defaults, then choose **Create bucket**.
4. In CloudShell, set the variables that later steps use (replace the bucket name with yours):

```bash
REGION=${AWS_REGION:-$(aws configure get region)}
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET="todo-files-$ACCOUNT_ID-$REGION"
```
:::

:::cli
```bash
REGION=${AWS_REGION:-$(aws configure get region)}
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET="todo-files-$ACCOUNT_ID-$REGION"

aws s3 mb "s3://$BUCKET"
aws s3api get-public-access-block --bucket "$BUCKET"
```
:::

> [!CHECK]
> The bucket exists, is empty, and all four **Block Public Access** settings are `true`. No bucket policy is needed: access will come from an IAM role.

### Step 2: Create the user pool and a public app client

The app client must **not** have a client secret (a phone cannot keep one) and must allow plain username-and-password sign-in so you can sign in from the CLI. The console decides the secret from the application type you pick: **Traditional web application** and **Machine-to-machine application** always generate one, and you cannot remove a secret from an existing app client (you would have to create a new client).

:::console
1. Open the **Amazon Cognito** console, choose **User pools**, then **Create user pool**.
2. Under **Define your application**, choose a public-client **Application type**: the mobile app option fits this scenario, and the single-page application (SPA) option works too. Do not pick **Traditional web application** or **Machine-to-machine application**.
3. In **Name your application**, enter `todo-mobile`.
4. Under **Options for sign-in identifiers**, select **Username**. Keep the suggested **Required attributes for sign-up**.
5. Under **Add a return URL**, enter `https://localhost:3000/callback` (this lab never uses it), then choose **Create your application** and scroll down to **Go to overview**.
6. Choose **App clients** under **Applications**, open `todo-mobile` and choose **Edit**.
7. Under **Authentication flows**, select **Sign in with username and password: ALLOW_USER_PASSWORD_AUTH**, keep the refresh-token flow selected, and choose **Save changes**.
8. Copy the **User pool ID** (from the overview) and the **Client ID**, and store them in CloudShell:

```bash
POOL_ID=<user-pool-id>      # for example us-east-1_AbCdEfGhI
CLIENT_ID=<app-client-id>
```
:::

:::cli
```bash
POOL_ID=$(aws cognito-idp create-user-pool --pool-name todo-users \
  --query UserPool.Id --output text)

CLIENT_ID=$(aws cognito-idp create-user-pool-client --user-pool-id "$POOL_ID" \
  --client-name todo-mobile --no-generate-secret \
  --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH \
  --query UserPoolClient.ClientId --output text)

echo "User pool: $POOL_ID   App client: $CLIENT_ID"
```
:::

> [!CHECK]
> The app client has no client secret and lists `ALLOW_USER_PASSWORD_AUTH` among its authentication flows (CLI: `aws cognito-idp describe-user-pool-client --user-pool-id "$POOL_ID" --client-id "$CLIENT_ID" --query 'UserPoolClient.[ClientSecret, ExplicitAuthFlows]'` prints `null` for the secret). `echo "$POOL_ID $CLIENT_ID"` prints two non-empty values.

### Step 3: Create two test users with permanent passwords

Users created by an administrator normally get a temporary password and must change it at first sign-in. `admin-set-user-password --permanent` skips that so the CLI sign-in works straight away. The password below is generated for this lab only and satisfies the default policy (upper case, lower case, digit, symbol, 8+ characters).

```bash
PW="Todo-$(openssl rand -hex 4)-Lab9"

for u in alice bob; do
  aws cognito-idp admin-create-user --user-pool-id "$POOL_ID" --username "$u" \
    --user-attributes Name=email,Value="$u@example.com" \
    --message-action SUPPRESS > /dev/null
  aws cognito-idp admin-set-user-password --user-pool-id "$POOL_ID" \
    --username "$u" --password "$PW" --permanent
done

aws cognito-idp list-users --user-pool-id "$POOL_ID" \
  --query 'Users[].[Username, UserStatus]' --output table
```

> [!CHECK]
> The table lists `alice` and `bob` with status **CONFIRMED**. In the console the same users appear under **Users**. `SUPPRESS` means no invitation email was sent to the placeholder addresses.

### Step 4: Create the identity pool and its authenticated role

:::console
1. In the Cognito console choose **Identity pools**, then **Create identity pool**.
2. In **Configure identity pool trust**, select **Authenticated access** and, as the identity type, **Amazon Cognito user pool**. Leave **Guest access** off. Choose **Next**.
3. In **Configure permissions**, choose **Create a new IAM role** and enter the **IAM role name** `todo-identity-auth-role`. Choose **Next**.
4. In **Connect identity providers**, pick your **User pool ID** and the `todo-mobile` **App client ID**. Keep **Role settings** on the default authenticated role and **Attributes for access control** on **Inactive**. Choose **Next**.
5. In **Configure properties**, enter the **Identity pool name** `todo_identities`. Leave **Basic (classic) authentication** turned off. Choose **Next**.
6. In **Review and create**, choose **Create identity pool**, then copy the **Identity pool ID** into CloudShell:

```bash
IDP_ID=<identity-pool-id>   # for example us-east-1:1a2b3c4d-...
ROLE_NAME=todo-identity-auth-role
```
:::

:::cli
```bash
PROVIDER="cognito-idp.$REGION.amazonaws.com/$POOL_ID"

IDP_ID=$(aws cognito-identity create-identity-pool \
  --identity-pool-name todo_identities \
  --no-allow-unauthenticated-identities \
  --cognito-identity-providers ProviderName="$PROVIDER",ClientId="$CLIENT_ID",ServerSideTokenCheck=false \
  --query IdentityPoolId --output text)

ROLE_NAME=todo-identity-auth-role
jq -n --arg pool "$IDP_ID" '{
  Version: "2012-10-17",
  Statement: [{
    Effect: "Allow",
    Principal: {Federated: "cognito-identity.amazonaws.com"},
    Action: "sts:AssumeRoleWithWebIdentity",
    Condition: {
      StringEquals: {"cognito-identity.amazonaws.com:aud": $pool},
      "ForAnyValue:StringLike": {"cognito-identity.amazonaws.com:amr": "authenticated"}
    }
  }]
}' > trust.json

ROLE_ARN=$(aws iam create-role --role-name "$ROLE_NAME" \
  --assume-role-policy-document file://trust.json --query Role.Arn --output text)

aws cognito-identity set-identity-pool-roles --identity-pool-id "$IDP_ID" \
  --roles authenticated="$ROLE_ARN"

aws cognito-identity get-identity-pool-roles --identity-pool-id "$IDP_ID"
```
:::

> [!CHECK]
> Open the role in the **IAM** console and choose the **Trust relationships** tab. The trusted entity is `cognito-identity.amazonaws.com`, the action is `sts:AssumeRoleWithWebIdentity`, and there are two conditions: `aud` equal to your identity pool ID and `amr` equal to `authenticated`. The identity pool lists this role as its authenticated role.

### Step 5: Add the per-user S3 policy to the role

The policy uses `${cognito-identity.amazonaws.com:sub}`. IAM replaces it at request time with the caller's identity ID, so the same role means "your own folder" for every user.

:::console
1. Open the **IAM** console, choose **Roles** and open `todo-identity-auth-role`.
2. Choose **Add permissions**, then **Create inline policy**, and switch the policy editor to **JSON**.
3. Paste the policy below, replacing `todo-files-ACCOUNT-REGION` with your bucket name in both places. Choose **Next**.
4. Name the policy `s3-own-folder` and choose **Create policy**.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListOwnPrefix",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::todo-files-ACCOUNT-REGION",
      "Condition": { "StringLike": { "s3:prefix": ["${cognito-identity.amazonaws.com:sub}/*"] } }
    },
    {
      "Sid": "ReadWriteOwnObjects",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::todo-files-ACCOUNT-REGION/${cognito-identity.amazonaws.com:sub}/*"
    }
  ]
}
```
:::

:::cli
```bash
jq -n --arg b "$BUCKET" '{
  Version: "2012-10-17",
  Statement: [
    {
      Sid: "ListOwnPrefix",
      Effect: "Allow",
      Action: "s3:ListBucket",
      Resource: ("arn:aws:s3:::" + $b),
      Condition: {StringLike: {"s3:prefix": ["${cognito-identity.amazonaws.com:sub}/*"]}}
    },
    {
      Sid: "ReadWriteOwnObjects",
      Effect: "Allow",
      Action: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      Resource: ("arn:aws:s3:::" + $b + "/${cognito-identity.amazonaws.com:sub}/*")
    }
  ]
}' > s3-own-folder.json

aws iam put-role-policy --role-name "$ROLE_NAME" \
  --policy-name s3-own-folder --policy-document file://s3-own-folder.json

aws iam get-role-policy --role-name "$ROLE_NAME" --policy-name s3-own-folder \
  --query 'PolicyDocument.Statement[1].Resource' --output text
```
:::

> [!CHECK]
> The last command prints `arn:aws:s3:::todo-files-.../${cognito-identity.amazonaws.com:sub}/*` with the variable still literal. If the `${...}` part is missing, the shell expanded it: recreate the file with the policy text inside single quotes.

### Step 6: Sign in as alice and get temporary AWS credentials

This is what the AWS SDK does inside a mobile app: sign in to the user pool, trade the ID token for an identity ID (`GetId`), then trade it again for credentials (`GetCredentialsForIdentity`).

```bash
PROVIDER="cognito-idp.$REGION.amazonaws.com/$POOL_ID"

id_token() {   # $1 = username; prints the user's ID token
  aws cognito-idp initiate-auth --client-id "$CLIENT_ID" \
    --auth-flow USER_PASSWORD_AUTH \
    --auth-parameters USERNAME="$1",PASSWORD="$PW" \
    --query AuthenticationResult.IdToken --output text
}

ALICE_TOKEN=$(id_token alice)
ALICE_ID=$(aws cognito-identity get-id --identity-pool-id "$IDP_ID" \
  --logins "{\"$PROVIDER\": \"$ALICE_TOKEN\"}" \
  --query IdentityId --output text)
echo "Alice's identity ID: $ALICE_ID"

read -r AK SK ST <<< "$(aws cognito-identity get-credentials-for-identity \
  --identity-id "$ALICE_ID" --logins "{\"$PROVIDER\": \"$ALICE_TOKEN\"}" \
  --query 'Credentials.[AccessKeyId, SecretKey, SessionToken]' --output text)"

as_alice() {
  AWS_ACCESS_KEY_ID="$AK" AWS_SECRET_ACCESS_KEY="$SK" AWS_SESSION_TOKEN="$ST" aws "$@"
}
as_alice sts get-caller-identity
```

> [!CHECK]
> `get-caller-identity` returns an **assumed-role** ARN for `todo-identity-auth-role`, not your own user: Alice is now acting with the role's permissions only. Her identity ID looks like `<region>:<uuid>`. The credentials expire after one hour; rerun this step if later commands start failing with an expired token.

### Step 7: Use Alice's credentials against S3

```bash
echo "buy milk" > todo.txt

as_alice s3 cp todo.txt "s3://$BUCKET/$ALICE_ID/todo.txt"     # allowed
as_alice s3 ls "s3://$BUCKET/$ALICE_ID/"                       # allowed
as_alice s3 ls "s3://$BUCKET/"                                 # expect AccessDenied
as_alice s3 cp todo.txt "s3://$BUCKET/shared/todo.txt"         # expect AccessDenied
```

> [!CHECK]
> The upload and the listing of Alice's own prefix succeed. Listing the bucket root and writing to `shared/` both fail with **AccessDenied**, because neither matches the `${cognito-identity.amazonaws.com:sub}` pattern. In the S3 console the bucket now has one folder named after Alice's identity ID.

### Step 8: Prove isolation with a second user

```bash
BOB_TOKEN=$(id_token bob)
BOB_ID=$(aws cognito-identity get-id --identity-pool-id "$IDP_ID" \
  --logins "{\"$PROVIDER\": \"$BOB_TOKEN\"}" \
  --query IdentityId --output text)

read -r BAK BSK BST <<< "$(aws cognito-identity get-credentials-for-identity \
  --identity-id "$BOB_ID" --logins "{\"$PROVIDER\": \"$BOB_TOKEN\"}" \
  --query 'Credentials.[AccessKeyId, SecretKey, SessionToken]' --output text)"

as_bob() {
  AWS_ACCESS_KEY_ID="$BAK" AWS_SECRET_ACCESS_KEY="$BSK" AWS_SESSION_TOKEN="$BST" aws "$@"
}

as_bob s3 cp todo.txt "s3://$BUCKET/$BOB_ID/todo.txt"           # allowed
as_bob s3 cp "s3://$BUCKET/$ALICE_ID/todo.txt" stolen.txt        # expect 403 Forbidden
as_bob s3 ls "s3://$BUCKET/$ALICE_ID/"                           # expect AccessDenied

aws cognito-identity list-identities --identity-pool-id "$IDP_ID" \
  --max-results 10 --query 'Identities[].IdentityId' --output table
```

> [!CHECK]
> Bob can write to his own prefix but cannot read or list Alice's, even though both users assume the **same** IAM role. The identity pool now lists two identities, one per user, matching the two folders in the bucket.

## Cleanup

Delete in this order. Run the CLI lines from the same CloudShell session (the variables are still set), or use the console.

- [ ] **S3 objects and bucket**: console **S3** → select the bucket → **Empty**, then **Delete**. CLI: `aws s3 rb "s3://$BUCKET" --force`
- [ ] **Identity pool** `todo_identities`: console **Cognito** → **Identity pools** → select it → **Delete** and confirm. CLI: `aws cognito-identity delete-identity-pool --identity-pool-id "$IDP_ID"`
- [ ] **IAM role** `todo-identity-auth-role` and its policies: console **IAM** → **Roles** → select it → **Delete** and confirm. CLI:

```bash
for p in $(aws iam list-role-policies --role-name "$ROLE_NAME" --query 'PolicyNames[]' --output text); do
  aws iam delete-role-policy --role-name "$ROLE_NAME" --policy-name "$p"
done
for a in $(aws iam list-attached-role-policies --role-name "$ROLE_NAME" --query 'AttachedPolicies[].PolicyArn' --output text); do
  aws iam detach-role-policy --role-name "$ROLE_NAME" --policy-arn "$a"
done
aws iam delete-role --role-name "$ROLE_NAME"
```

- [ ] **User pool** (with its users, app client and any domain): console **Cognito** → **User pools** → select it → **Delete**; accept the prompt to deactivate deletion protection (on by default for console-created pools) and delete the managed-login domain if asked. CLI:

```bash
DOMAIN=$(aws cognito-idp describe-user-pool --user-pool-id "$POOL_ID" \
  --query UserPool.Domain --output text)
if [ "$DOMAIN" != "None" ]; then
  aws cognito-idp delete-user-pool-domain --user-pool-id "$POOL_ID" --domain "$DOMAIN"
fi
# Only needed for console-created pools; this update is safe because the pool is deleted next
aws cognito-idp update-user-pool --user-pool-id "$POOL_ID" --deletion-protection INACTIVE
aws cognito-idp delete-user-pool --user-pool-id "$POOL_ID"
```

- [ ] **Local files** in CloudShell: `rm -f todo.txt stolen.txt trust.json s3-own-folder.json`
- [ ] **Final check**: `aws cognito-idp list-user-pools --max-results 20`, `aws cognito-identity list-identity-pools --max-results 20` and `aws s3 ls | grep todo-files` show none of the lab resources.

## Progress checklist

- [ ] Step 1: bucket created with Block Public Access on
- [ ] Step 2: user pool and secret-less app client with ALLOW_USER_PASSWORD_AUTH
- [ ] Step 3: alice and bob confirmed with permanent passwords
- [ ] Step 4: identity pool and authenticated role with aud and amr conditions
- [ ] Step 5: per-user S3 policy using the identity ID variable
- [ ] Step 6: signed in as alice and received temporary credentials
- [ ] Step 7: own prefix allowed, bucket root and other prefixes denied
- [ ] Step 8: bob isolated from alice with the same role
- [ ] Cleanup complete and final check passed
