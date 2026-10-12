---
id: 29-encryption-secrets-lab-02
title: Store configuration in Parameter Store and a secret in Secrets Manager
objective: Build a per-environment parameter hierarchy with a SecureString, read it by path, look up the latest Amazon Linux AMI from a public parameter, store and update a Secrets Manager secret, read it through the Parameter Store API, and optionally try parameter policies and a multi-Region secret.
estimatedTime: 45 minutes
cost: "Under USD 0.01 if you clean up the same day: standard parameters are free; the secret costs USD 0.40 per month prorated (about USD 0.0006 per hour); the optional advanced parameter costs USD 0.05 per month prorated and the optional replica adds about the same as the secret; API calls cost fractions of a cent."
freeTier: partial
services: [ssm-parameter-store, secrets-manager, kms, cloudshell]
---

> [!COST]
> Standard-tier parameters and their standard-throughput API calls are free. **Secrets Manager** bills USD 0.40 per secret per month, prorated by the hour, plus USD 0.05 per 10,000 API calls, so one secret kept for an hour costs well under a cent. Secrets scheduled for deletion are not billed. The optional **advanced parameter** costs USD 0.05 per month (prorated) and its API calls USD 0.05 per 10,000. The optional **replica secret** is billed as a distinct secret, another USD 0.40 per month prorated, until you delete it. Encryption uses the free AWS managed keys `aws/ssm` and `aws/secretsmanager`. Free Tier credits on new accounts cover all of this.

You will play the role of a team that runs a small app in a `dev` and a `prod` environment. Plain configuration and a rarely changing password go into Parameter Store. A partner API key goes into Secrets Manager, where it gets versions with staging labels and, if you like, a copy in a second Region.

## Prerequisites

- An AWS account and an IAM role or user with administrator access, or at least `AmazonSSMFullAccess`, `SecretsManagerReadWrite` and permission to use the `aws/ssm` and `aws/secretsmanager` keys (`kms:Encrypt`, `kms:Decrypt`).
- The Region **US East (N. Virginia) `us-east-1`** selected in the console. The optional replica step uses **US West (Oregon) `us-west-2`** as the second Region.
- **AWS CloudShell** opened from the console's top bar (AWS CLI v2 and GNU `date` are ready there).

## Steps

### Step 1: Create a parameter hierarchy for two environments

You will create three parameters:

| Name | Type | Value |
|---|---|---|
| `/lab-app/dev/db-url` | String | `jdbc:postgresql://dev-db.example.internal:5432/app` |
| `/lab-app/dev/db-password` | SecureString | `dev-demo-password-1` |
| `/lab-app/prod/db-url` | String | `jdbc:postgresql://prod-db.example.internal:5432/app` |

:::console
1. Open the **AWS Systems Manager** console and choose **Parameter Store** in the navigation pane, then **Create parameter**.
2. For **Name** enter `/lab-app/dev/db-url` and add a **Description** such as `Dev database URL`.
3. For **Parameter tier** keep **Standard**. For **Type** choose **String** and keep **Data type** `text`.
4. Paste the value from the table into **Value** and choose **Create parameter**.
5. Repeat for `/lab-app/dev/db-password`, this time choosing **SecureString** as **Type**. Keep the default KMS key, the AWS managed key `alias/aws/ssm`.
6. Repeat for `/lab-app/prod/db-url` as a **String**.
:::

:::cli
```bash
aws ssm put-parameter --name /lab-app/dev/db-url --type String \
  --value "jdbc:postgresql://dev-db.example.internal:5432/app"
aws ssm put-parameter --name /lab-app/dev/db-password --type SecureString \
  --value "dev-demo-password-1"                    # no --key-id: uses alias/aws/ssm
aws ssm put-parameter --name /lab-app/prod/db-url --type String \
  --value "jdbc:postgresql://prod-db.example.internal:5432/app"
```
:::

> [!CHECK]
> The **My parameters** list shows all three, each at **Tier** `Standard` and **Version** `1`. The SecureString's type is `SecureString` and its **KMS key ID** is `alias/aws/ssm`.

### Step 2: Read parameters by name and by path

:::console
1. Choose `/lab-app/dev/db-password`. On the **Overview** tab the value is masked. Choose **Show** to display it.
:::

:::cli
```bash
# Without decryption you get the ciphertext:
aws ssm get-parameter --name /lab-app/dev/db-password --query Parameter.Value --output text
# With decryption (needs kms:Decrypt on the key as well as ssm:GetParameter):
aws ssm get-parameter --name /lab-app/dev/db-password --with-decryption \
  --query Parameter.Value --output text
# Everything a dev function needs in one call:
aws ssm get-parameters-by-path --path /lab-app/dev --with-decryption \
  --query 'Parameters[].[Name,Type,Value]' --output table
```
:::

> [!CHECK]
> The first command prints a long base64 string, the encrypted value. The second prints `dev-demo-password-1`. The path query returns only the two `dev` parameters, never the `prod` one. An IAM policy that allows `ssm:GetParametersByPath` on `arn:aws:ssm:*:*:parameter/lab-app/dev/*` would confine a dev function to exactly this branch.

### Step 3: Update a parameter and view its history

:::console
1. Select `/lab-app/dev/db-url` and choose **Edit**.
2. Change the port in **Value** to `6432` and choose **Save changes**.
3. Open the parameter and choose the **History** tab.
:::

:::cli
```bash
aws ssm put-parameter --name /lab-app/dev/db-url --type String --overwrite \
  --value "jdbc:postgresql://dev-db.example.internal:6432/app"
aws ssm get-parameter-history --name /lab-app/dev/db-url \
  --query 'Parameters[].[Version,Value,LastModifiedDate]' --output table
# An application can pin a version with name:version
aws ssm get-parameter --name /lab-app/dev/db-url:1 --query Parameter.Value --output text
```
:::

> [!CHECK]
> The parameter is now at **Version** `2`, the history shows both values, and `/lab-app/dev/db-url:1` still returns the old URL.

### Step 4: Look up the latest Amazon Linux 2023 AMI from a public parameter

:::console
1. In **Parameter Store**, open the **Public parameters** tab. (It appears once your account has at least one parameter in the Region.)
2. From **Select a service**, choose `ami-amazon-linux-latest`.
3. Type `al2023` in the search bar and choose `al2023-ami-kernel-default-x86_64` to see its value.
:::

:::cli
```bash
aws ssm get-parameters \
  --names /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --query 'Parameters[0].[Name,Value,LastModifiedDate]' --output table
# Every Amazon Linux parameter AWS publishes in this Region:
aws ssm get-parameters-by-path --path /aws/service/ami-amazon-linux-latest \
  --query 'Parameters[].Name' --output text | tr '\t' '\n' | grep al2023
```
:::

> [!CHECK]
> The value is an AMI ID (`ami-...`) for the newest Amazon Linux 2023 image in your Region. Launch templates, CloudFormation and scripts can reference this name instead of hard-coding an AMI ID that goes stale every few weeks.

### Step 5 (optional): Try an advanced parameter with an expiration policy

Parameter policies need the **Advanced** tier. Here a temporary vendor token deletes itself after two hours, with an EventBridge notification one hour before.

:::console
1. Choose **Create parameter**. For **Name** enter `/lab-app/dev/vendor-token`.
2. For **Parameter tier** choose **Advanced**, for **Type** choose **SecureString**, and enter `temp-demo-token` as **Value**.
3. In the **Parameter policies** section, enable an **Expiration** date about two hours from now and an **ExpirationNotification** of `1` hour before expiration.
4. Choose **Create parameter**, then open the parameter and look at its policies.
:::

:::cli
```bash
EXPIRES=$(date -u -d '+2 hours' +%Y-%m-%dT%H:%M:%S.000Z)
aws ssm put-parameter --name /lab-app/dev/vendor-token --type SecureString \
  --tier Advanced --value "temp-demo-token" \
  --policies "[{\"Type\":\"Expiration\",\"Version\":\"1.0\",\"Attributes\":{\"Timestamp\":\"$EXPIRES\"}},{\"Type\":\"ExpirationNotification\",\"Version\":\"1.0\",\"Attributes\":{\"Before\":\"1\",\"Unit\":\"Hours\"}}]"
aws ssm describe-parameters \
  --parameter-filters "Key=Name,Values=/lab-app/dev/vendor-token" \
  --query 'Parameters[0].[Tier,Policies[].[PolicyType,PolicyStatus]]'
```
:::

> [!CHECK]
> The parameter shows **Tier** `Advanced` and two policies, `Expiration` and `ExpirationNotification`, in status `Pending`. Parameter Store applies them by itself on a periodic scan: the parameter disappears after its expiry time. Remember that this deletes the value; it never creates a new one. Rotation is a Secrets Manager feature. An advanced parameter cannot be turned back into a standard one.

### Step 6: Store a secret in Secrets Manager

:::console
1. Open the **Secrets Manager** console and choose **Store a new secret**.
2. For **Secret type** choose **Other type of secret**. Under **Key/value pairs** enter the key `api-key` with the value `partner-demo-key-v1`.
3. For **Encryption key** keep **aws/secretsmanager**. Choose **Next**.
4. For **Secret name** enter `lab-app/dev/partner-api` and add a **Description**. Leave **Resource permissions** and **Replicate secret** unchanged. Choose **Next**.
5. On **Configure rotation**, leave automatic rotation off and choose **Next**.
6. Review and choose **Store**. Open the secret and choose **Retrieve secret value**.
:::

:::cli
```bash
aws secretsmanager create-secret --name lab-app/dev/partner-api \
  --description "Lab partner API key" \
  --secret-string '{"api-key":"partner-demo-key-v1"}'
aws secretsmanager get-secret-value --secret-id lab-app/dev/partner-api \
  --query '[ARN,SecretString,VersionStages]'
```
:::

> [!CHECK]
> The secret's ARN ends with the name plus a hyphen and six random characters, for example `lab-app/dev/partner-api-AbC123`. The value comes back as JSON, and its version carries the staging label `AWSCURRENT`.

### Step 7: Read the secret through the Parameter Store API

Code that already uses Parameter Store can read Secrets Manager secrets through a reserved path. There is no console equivalent; use CloudShell.

:::cli
```bash
aws ssm get-parameter \
  --name /aws/reference/secretsmanager/lab-app/dev/partner-api --with-decryption \
  --query 'Parameter.[Name,Type,Value]' --output table
```
:::

> [!CHECK]
> Parameter Store returns the secret as a `SecureString` with the JSON value, but it stores nothing itself; it forwards the request to Secrets Manager. Only `GetParameter` and `GetParameters` work with this prefix. A `get-parameters-by-path` call on `/aws/reference/secretsmanager` is not supported, and the reference has no version history in Parameter Store.

### Step 8: Change the secret and watch the staging labels

In production a rotation function or managed rotation would do this for you. Here you store a new value by hand to see how versions move.

:::console
1. Open `lab-app/dev/partner-api`, choose **Retrieve secret value**, then **Edit**.
2. Change the value to `partner-demo-key-v2` and choose **Save**.
3. Open the **Versions** tab (or reload **Retrieve secret value**).
:::

:::cli
```bash
aws secretsmanager put-secret-value --secret-id lab-app/dev/partner-api \
  --secret-string '{"api-key":"partner-demo-key-v2"}'
aws secretsmanager list-secret-version-ids --secret-id lab-app/dev/partner-api \
  --query 'Versions[].[VersionId,VersionStages]'
aws secretsmanager get-secret-value --secret-id lab-app/dev/partner-api \
  --version-stage AWSPREVIOUS --query SecretString --output text
```
:::

> [!CHECK]
> There are two versions: the new one labelled `AWSCURRENT` and the old one labelled `AWSPREVIOUS`. Applications that ask for the default (current) version get `v2` immediately, with no redeployment. During a real rotation a third label, `AWSPENDING`, marks the new value while it is being tested.

### Step 9 (optional): Replicate the secret to a second Region

:::console
1. On the secret details page open the **Replication** tab and choose **Replicate secret**.
2. In the **Add replica regions** dialog, for **AWS Region** choose **US West (Oregon) us-west-2**. Leave **Encryption key** at its default (`aws/secretsmanager` in that Region). Choose **Replicate**.
3. In the **Replicate secret** section, wait until the **Replication status** for us-west-2 shows success (the CLI reports `InSync`), then switch the console to **us-west-2** and open the secret there.
:::

:::cli
```bash
aws secretsmanager replicate-secret-to-regions --secret-id lab-app/dev/partner-api \
  --add-replica-regions Region=us-west-2
aws secretsmanager describe-secret --secret-id lab-app/dev/partner-api \
  --query 'ReplicationStatus'
aws secretsmanager get-secret-value --region us-west-2 \
  --secret-id lab-app/dev/partner-api --query '[ARN,SecretString]'
```
:::

> [!CHECK]
> The replica has the same name and the same ARN except for the Region (`us-west-2`), and returns the `v2` value. In us-west-2 the console marks it as a replica of the us-east-1 primary. If the primary Region failed, you could choose **Promote to standalone secret** on the replica so applications there keep working.

## Cleanup

- [ ] **Replica in us-west-2** (only if you did step 9; the primary cannot be deleted while it has replicas): open the primary secret, select the replica in the **Replicate secret** section and choose **Actions** → **Delete replica**. A replica is deleted at once, with no waiting period. CLI: `aws secretsmanager remove-regions-from-replication --secret-id lab-app/dev/partner-api --remove-replica-regions us-west-2`.
- [ ] **Secret `lab-app/dev/partner-api`**: choose **Actions** → **Delete secret**, set **Waiting period** to `7` days and choose **Schedule deletion** (no charge while scheduled). CLI, to delete at once without a recovery window: `aws secretsmanager delete-secret --secret-id lab-app/dev/partner-api --force-delete-without-recovery`.
- [ ] **Parameters `/lab-app/dev/db-url`, `/lab-app/dev/db-password` and `/lab-app/prod/db-url`**: in **Parameter Store** select them and choose **Delete**, then confirm. CLI: `aws ssm delete-parameters --names /lab-app/dev/db-url /lab-app/dev/db-password /lab-app/prod/db-url`.
- [ ] **Advanced parameter `/lab-app/dev/vendor-token`** (step 5, if it has not expired yet): delete it the same way. CLI: `aws ssm delete-parameter --name /lab-app/dev/vendor-token`. A "ParameterNotFound" error means the expiration policy already removed it.
- [ ] **Final check**: `aws ssm get-parameters-by-path --path /lab-app --recursive --query 'Parameters[].Name'` returns an empty list, and the Secrets Manager list in us-east-1 (and us-west-2, if used) no longer shows the secret unless you enable **Show secrets scheduled for deletion** in the preferences. The AWS managed keys `aws/ssm` and `aws/secretsmanager` stay in your account; they are free and cannot be deleted.

## Progress checklist

- [ ] Step 1: Created the `/lab-app` hierarchy with a SecureString
- [ ] Step 2: Read values with and without decryption, and by path
- [ ] Step 3: Updated a parameter and read an older version
- [ ] Step 4: Found the latest Amazon Linux 2023 AMI ID through a public parameter
- [ ] Step 5 (optional): Created an advanced parameter with expiration policies
- [ ] Step 6: Stored a secret in Secrets Manager
- [ ] Step 7: Read the secret through `/aws/reference/secretsmanager`
- [ ] Step 8: Saw `AWSCURRENT` and `AWSPREVIOUS` after updating the secret
- [ ] Step 9 (optional): Replicated the secret to us-west-2
- [ ] Cleanup done: replica, secret and all parameters deleted
