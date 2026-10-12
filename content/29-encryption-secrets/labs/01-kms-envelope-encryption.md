---
id: 29-encryption-secrets-lab-01
title: Create a customer managed KMS key and practise envelope encryption
objective: Create a symmetric customer managed key, encrypt a small secret directly with KMS, hit the 4 KB limit, encrypt a larger file with a data key, turn on rotation, find every call in CloudTrail and see what disabling a key does.
estimatedTime: 40 minutes
cost: "Under USD 0.01 if you schedule the key for deletion within a few hours: the key costs USD 1 per month prorated hourly (about USD 0.0014 per hour), and the lab's few dozen requests fit inside the 20,000 free KMS requests per month. The optional on-demand rotation adds about the same again per hour until the key is pending deletion."
freeTier: partial
services: [kms, cloudtrail, cloudshell]
---

> [!COST]
> A customer managed KMS key bills USD 1 per month, prorated hourly, from creation until you **schedule it for deletion**. A key pending deletion is not billed. The first on-demand or automatic rotation adds another USD 1 per month (prorated) while the key is active. Requests are free up to 20,000 per month across all Regions, then USD 0.03 per 10,000. Free Tier credits on new accounts can cover the few cents involved. Do the **Cleanup** section the same day.

This lab makes the ideas from the lesson concrete: a key you own, the 4 KB direct-encryption limit, envelope encryption with a data key, rotation that keeps old ciphertext readable, CloudTrail as the audit log, and disabling as the reversible "off switch". Most steps run in **AWS CloudShell**, because the KMS console has no encrypt or decrypt buttons.

## Prerequisites

- An AWS account and an IAM role or user with administrator access (simplest). Otherwise, an IAM policy that allows `kms:CreateKey`, `kms:CreateAlias`, `kms:DeleteAlias`, `kms:DescribeKey`, `kms:GetKeyPolicy`, `kms:ListAliases`, `kms:Encrypt`, `kms:Decrypt`, `kms:GenerateDataKey`, `kms:EnableKeyRotation`, `kms:GetKeyRotationStatus`, `kms:RotateKeyOnDemand`, `kms:ListKeyRotations`, `kms:DisableKey`, `kms:EnableKey` and `kms:ScheduleKeyDeletion`, plus `cloudtrail:LookupEvents`. (A key created in the console also grants its administrators and users these rights through the key policy.)
- The Region **US East (N. Virginia) `us-east-1`** selected in the console. Any Region works if you use it consistently.
- **AWS CloudShell**, opened from the CloudShell icon in the console's top bar. It already has the AWS CLI v2, `openssl` and `base64`, and it uses the console's Region. If `openssl` is ever missing, run `sudo dnf install -y openssl`.
- Keep the same CloudShell tab open for the whole lab, because later commands reuse shell variables.

## Steps

### Step 1: Create a symmetric customer managed key

:::console
1. Open the **Key Management Service (KMS)** console and choose **Customer managed keys** in the navigation pane, then **Create key**.
2. For **Key type** choose **Symmetric**. **Key usage** is already set to **Encrypt and decrypt**. Choose **Next**.
3. For **Alias** enter `lab-app-data`, and for **Description** enter `Lab key for envelope encryption`. Choose **Next**.
4. Under key administrators, select the IAM role or user you are signed in with. Keep **Allow key administrators to delete this key** selected. Choose **Next**.
5. Under key users, select the same role or user. Leave **Other AWS accounts** empty. Choose **Next**.
6. Review the generated key policy and choose **Next**, then review the settings and choose **Finish**.
7. In CloudShell, store the key ID for later steps: `KEY_ID=$(aws kms describe-key --key-id alias/lab-app-data --query KeyMetadata.KeyId --output text); echo "$KEY_ID"`
:::

:::cli
```bash
KEY_ID=$(aws kms create-key --description "Lab key for envelope encryption" \
  --query KeyMetadata.KeyId --output text)
aws kms create-alias --alias-name alias/lab-app-data --target-key-id "$KEY_ID"
aws kms describe-key --key-id alias/lab-app-data \
  --query 'KeyMetadata.[KeyId,KeySpec,KeyUsage,KeyState,KeyManager]' --output table
```
:::

> [!CHECK]
> The key appears under **Customer managed keys** with **Status** `Enabled`, alias `lab-app-data`, key spec `SYMMETRIC_DEFAULT` and usage **Encrypt and decrypt**. `KeyManager` is `CUSTOMER`. Under **AWS managed keys** you may also see keys such as `aws/ebs` or `aws/s3`: AWS created those the first time a service used KMS for you, and you cannot change their policies.

### Step 2: Read the key policy

:::console
1. Choose the alias `lab-app-data` to open the key details page.
2. Open the **Key policy** tab. If the console shows the default view, choose **Switch to policy view** to see the JSON.
:::

:::cli
```bash
aws kms get-key-policy --key-id "$KEY_ID" --policy-name default --output text
```
:::

> [!CHECK]
> Both policies contain a statement whose principal is `arn:aws:iam::<your-account-id>:root` with `kms:*`. That statement hands control to IAM, so IAM policies in your account can grant use of the key. A key created in the console also lists your role as key administrator and key user in separate statements, one of which allows `kms:CreateGrant` so services such as EBS can use the key on your behalf. A key created with the CLI has only the account statement.

### Step 3: Encrypt and decrypt a small secret directly with KMS

The console has no encrypt or decrypt buttons, so this step runs only in CloudShell.

:::cli
```bash
mkdir -p ~/kms-lab && cd ~/kms-lab
printf 'db-password=demo-value-not-a-real-password' > secret.txt

# Encrypt: KMS returns base64 ciphertext, which we decode into a binary file.
aws kms encrypt --key-id alias/lab-app-data --plaintext fileb://secret.txt \
  --query CiphertextBlob --output text | base64 --decode > secret.enc
ls -l secret.txt secret.enc

# Decrypt: no key ID needed, the ciphertext records which key made it.
aws kms decrypt --ciphertext-blob fileb://secret.enc --query KeyId --output text
aws kms decrypt --ciphertext-blob fileb://secret.enc \
  --query Plaintext --output text | base64 --decode; echo
```
:::

> [!CHECK]
> `secret.enc` is noticeably larger than `secret.txt` because it carries the key reference and integrity data. The first decrypt prints your key's ARN, the second prints the original text. Anyone without `kms:Decrypt` on this key gets `AccessDeniedException` instead.

### Step 4: Hit the 4 KB limit, then use envelope encryption

First prove that KMS refuses to encrypt large payloads directly:

:::cli
```bash
head -c 5000 /dev/urandom > too-big.bin
aws kms encrypt --key-id alias/lab-app-data --plaintext fileb://too-big.bin
```
:::

> [!CHECK]
> The call fails with a `ValidationException` saying the plaintext must be at most 4096 bytes long. This is why services and SDKs use data keys.

Now encrypt a larger file the way S3, EBS and the encryption SDKs do. KMS creates a 256-bit data key and returns it twice: in plaintext, which you use and then throw away, and encrypted under your KMS key, which you store next to the data.

:::cli
```bash
seq 1 20000 > report.txt                         # roughly 110 KB of "data"

# 1. Ask KMS for a data key: plaintext copy plus encrypted copy.
read -r DK_PLAIN DK_CIPHER <<< "$(aws kms generate-data-key \
  --key-id alias/lab-app-data --key-spec AES_256 \
  --query '[Plaintext,CiphertextBlob]' --output text)"

# 2. Encrypt the file locally with the plaintext data key. The file never goes to KMS.
KEY_HEX=$(echo "$DK_PLAIN" | base64 --decode | od -An -tx1 | tr -d ' \n')
IV_HEX=$(openssl rand -hex 16)
openssl enc -aes-256-cbc -K "$KEY_HEX" -iv "$IV_HEX" -in report.txt -out report.txt.enc

# 3. Keep only the encrypted data key (and the IV) next to the data, forget the plaintext key.
echo "$DK_CIPHER" | base64 --decode > report.key.enc
echo "$IV_HEX" > report.iv
unset DK_PLAIN KEY_HEX
ls -l report.txt report.txt.enc report.key.enc
```
:::

To read the file later, ask KMS to decrypt only the small data key, then decrypt the file locally:

:::cli
```bash
KEY_HEX=$(aws kms decrypt --ciphertext-blob fileb://report.key.enc \
  --query Plaintext --output text | base64 --decode | od -An -tx1 | tr -d ' \n')
openssl enc -d -aes-256-cbc -K "$KEY_HEX" -iv "$(cat report.iv)" \
  -in report.txt.enc -out report.decrypted.txt
unset KEY_HEX
cmp report.txt report.decrypted.txt && echo "Round trip OK"
```
:::

> [!CHECK]
> `report.key.enc` is only a couple of hundred bytes, while `report.txt.enc` is about the size of the original file. You see `Round trip OK`. Only the small data key travelled to and from KMS, never the file, yet whoever lacks `kms:Decrypt` on the KMS key cannot recover the data key or the file.

> [!TIP]
> This shell version shows the mechanics only. In real code, use the **AWS Encryption SDK** (or the S3 Encryption Client or AWS Database Encryption SDK). They use authenticated AES-GCM, store the encrypted data key inside the encrypted message, and can cache data keys to save KMS requests.

### Step 5: Turn on automatic rotation (optional: rotate now)

:::console
1. On the key details page, open the **Key material and rotations** tab (some console versions label it **Key rotation**).
2. In the **Automatic key rotation** section, choose **Edit**.
3. For **Key rotation** select **Enable**, enter `180` as the rotation period in days, and choose **Save**.
4. Optional, adds rotation cost: on the same tab choose **Rotate now**, read the warning, and choose **Rotate key**.
:::

:::cli
```bash
aws kms enable-key-rotation --key-id "$KEY_ID" --rotation-period-in-days 180
aws kms get-key-rotation-status --key-id "$KEY_ID"

# Optional (adds about USD 0.0014 per hour until the key is pending deletion):
aws kms rotate-key-on-demand --key-id "$KEY_ID"
sleep 30
aws kms list-key-rotations --key-id "$KEY_ID"

# Ciphertext created before the rotation still decrypts:
aws kms decrypt --ciphertext-blob fileb://secret.enc \
  --query Plaintext --output text | base64 --decode; echo
```
:::

> [!CHECK]
> `get-key-rotation-status` shows `KeyRotationEnabled: true`, `RotationPeriodInDays: 180` and a `NextRotationDate` about six months away. If you rotated on demand, `list-key-rotations` shows one entry with `RotationType` `ON_DEMAND` (it may take a moment to appear). `secret.enc`, encrypted with the old key material, still decrypts, and the key ID and ARN have not changed. Rotation did not re-encrypt anything.

### Step 6: Find the key's activity in CloudTrail

:::console
1. Open the **CloudTrail** console and choose **Event history**.
2. The default filter is **Read-only** set to `false`, which hides Encrypt and Decrypt calls (they count as read-only). Remove it and, under **Lookup attributes**, choose **Event source** with the value `kms.amazonaws.com`.
3. Choose a **Decrypt** event and scroll to **Event record**.
:::

:::cli
```bash
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventSource,AttributeValue=kms.amazonaws.com \
  --max-results 25 \
  --query 'Events[].[EventTime,EventName,Username]' --output table
```
:::

> [!CHECK]
> After a few minutes you see `CreateKey`, `CreateAlias`, `Encrypt`, `Decrypt`, `GenerateDataKey`, `EnableKeyRotation` and possibly `RotateKeyOnDemand`, each with your user or role name. The event record names the key ARN and the caller but never contains plaintext or key material. Event history keeps 90 days of management events at no charge.

### Step 7: Disable the key and watch decryption fail

:::console
1. In the KMS console, choose **Customer managed keys** and select the check box next to `lab-app-data`.
2. Choose **Key actions** → **Disable**, and confirm in the dialog.
3. Run the decrypt command from the CLI tab in CloudShell.
:::

:::cli
```bash
aws kms disable-key --key-id "$KEY_ID"
aws kms describe-key --key-id "$KEY_ID" --query KeyMetadata.KeyState --output text
aws kms decrypt --ciphertext-blob fileb://secret.enc \
  --query Plaintext --output text | base64 --decode; echo
```
:::

> [!CHECK]
> The key state is `Disabled` and the decrypt call fails with `DisabledException`. Every piece of data protected by this key, including the data key in `report.key.enc`, is unreadable until someone runs `aws kms enable-key` (or **Key actions** → **Enable**). That reversibility is why AWS recommends disabling a key, and watching for failures, before you ever delete it.

## Cleanup

- [ ] **Alias `alias/lab-app-data`**: on the key details page open the **Aliases** tab, select the alias and choose **Delete**, then confirm. CLI: `aws kms delete-alias --alias-name alias/lab-app-data`.
- [ ] **KMS key**: in **Customer managed keys** select the key, choose **Key actions** → **Schedule key deletion**, set **Waiting period (in days)** to `7`, select the confirmation check box and choose **Schedule deletion**. CLI: `aws kms schedule-key-deletion --key-id "$KEY_ID" --pending-window-in-days 7`. Billing for the key stops as soon as it is pending deletion. It is deleted for good after 7 days, together with any ciphertext still depending on it.
- [ ] **Local files in CloudShell**: `cd ~ && rm -rf ~/kms-lab`.
- [ ] **Final check**: **Customer managed keys** shows the key with **Status** `Pending deletion` and a deletion date, and no other `lab-` keys are active. The CloudTrail events stay in event history (free) and expire after 90 days.

## Progress checklist

- [ ] Step 1: Created the symmetric customer managed key `alias/lab-app-data`
- [ ] Step 2: Read the key policy and found the statement that enables IAM policies
- [ ] Step 3: Encrypted and decrypted a small secret directly with KMS
- [ ] Step 4: Hit the 4 KB limit and completed an envelope encryption round trip
- [ ] Step 5: Turned on automatic rotation (and optionally rotated on demand) and decrypted old ciphertext
- [ ] Step 6: Found the key's API calls in CloudTrail event history
- [ ] Step 7: Disabled the key and saw decryption fail
- [ ] Cleanup done: alias deleted, key pending deletion, local files removed
