---
id: 02-iam-lab-02
title: Harden sign-in with a password policy and MFA, then audit with IAM reports
objective: Set a custom password policy, confirm root MFA, register MFA for your admin user, and read the credential report and last accessed data.
estimatedTime: 30 minutes
cost: "Free. IAM, the credential report and last accessed data have no charge; no billable resources are created."
freeTier: yes
services: [iam, mfa, iam-policies, cli-sdk]
---

This lab secures the account you will use for the rest of the course and introduces the two built-in audit tools. You need a phone with an authenticator app, a passkey-capable device (most laptops and phones), or a FIDO2 security key.

## Prerequisites

- An AWS account and an administrator identity other than the root user (for example `admin-yourname` from lab 01).
- One MFA option: a passkey provider (iCloud Keychain, Google Password Manager, Windows Hello, 1Password and so on), a FIDO2 security key, or a TOTP authenticator app such as Google Authenticator, Microsoft Authenticator or Duo Mobile.
- Optional, for the CLI tabs: AWS CLI v2 or AWS CloudShell, signed in as your admin. Commands below use Bash syntax (CloudShell's default shell).

## Steps

### Step 1: Set a custom password policy

Goal: at least 14 characters, all four character types, 90-day expiry, and no reuse of the last 5 passwords.

:::console
1. Open the **IAM** console and choose **Account settings** in the navigation pane.
2. In the **Password policy** section choose **Edit**, then choose **Custom**.
3. Set **Password minimum length** to `14`.
4. Under **Password strength**, select all four options: at least one uppercase letter, one lowercase letter, one number and one nonalphanumeric character.
5. Select **Turn on password expiration** and enter `90` days. Leave **Password expiration requires administrator reset** cleared.
6. Keep **Allow users to change their own password** selected.
7. Select **Prevent password reuse** and enter `5`.
8. Choose **Save changes**, then confirm with **Set custom**.
:::

:::cli
```bash
aws iam update-account-password-policy \
  --minimum-password-length 14 \
  --require-uppercase-characters --require-lowercase-characters \
  --require-numbers --require-symbols \
  --max-password-age 90 --password-reuse-prevention 5 \
  --allow-users-to-change-password --no-hard-expiry
aws iam get-account-password-policy
```
:::

> [!CHECK]
> The **Password policy** section now reads **Custom** and lists your settings. Existing passwords are not forced to change for the length rule, but any password older than 90 days must be changed at the next sign-in, because expiry applies immediately.

### Step 2: Confirm that the root user has MFA

You do not need to sign in as root for this: the account summary tells you.

:::console
1. In the IAM navigation pane, under **Access reports**, choose **Credential report** → **Download Report**.
2. Open the CSV and find the row whose `user` value is `<root_account>`. Check its `mfa_active` column (you will read the rest of the report in Step 4).
3. If it says `false`, sign in as the root user, choose your account name in the navigation bar → **Security credentials**, and in the **Multi-factor authentication (MFA)** section register a passkey or security key. Then sign back in as your admin.
:::

:::cli
```bash
# 1 = the root user has MFA, 0 = it does not.
aws iam get-account-summary --query 'SummaryMap.AccountMFAEnabled'
```
:::

> [!CHECK]
> The CLI returns `1` and the `<root_account>` row shows `mfa_active` = `true`. AWS requires root MFA on every account, so a `0` / `false` means you should fix it today.

### Step 3: Register MFA for your admin user

Passkeys and security keys are phishing-resistant and recommended; an authenticator app is the fallback. Passkeys and security keys can only be registered in the console.

:::console
1. While signed in as `admin-yourname`, choose your user name in the navigation bar (top right) → **Security credentials**. If your user's page opens on another tab, choose the **Security credentials** tab.
2. Under **Multi-factor authentication (MFA)** choose **Assign MFA device**.
3. On the **MFA device name** page, enter a **Device name** such as `admin-yourname-laptop`.
4. Choose **Passkey or Security Key** and **Next**, then follow the browser prompts (fingerprint, face, device PIN or tap the key) and choose **Continue**.
   - Or choose **Authenticator app** → **Next**, choose **Show QR code**, scan it with the app, type two consecutive codes into **MFA code 1** and **MFA code 2**, and choose **Add MFA**.
5. Sign out and sign in again with the alias URL to test the new factor.
:::

:::cli
```bash
# Authenticator app only (passkeys/security keys cannot be registered from the CLI).
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
aws iam create-virtual-mfa-device --virtual-mfa-device-name admin-yourname-app \
  --outfile mfa-qr.png --bootstrap-method QRCodePNG
# In CloudShell, get the image with Actions -> Download file (path: mfa-qr.png).
# Scan mfa-qr.png with the app, then replace the two sample values with consecutive codes:
aws iam enable-mfa-device --user-name admin-yourname \
  --serial-number arn:aws:iam::$ACCOUNT:mfa/admin-yourname-app \
  --authentication-code1 123456 --authentication-code2 654321
aws iam list-mfa-devices --user-name admin-yourname
rm mfa-qr.png
```
:::

> [!CHECK]
> The **Multi-factor authentication (MFA)** table lists your device with its type. On the next sign-in AWS asks for the passkey, key tap or 6-digit code after the password. Consider registering a second device as a backup: each user can have up to eight.

### Step 4: Generate and read the credential report

:::console
1. In the IAM navigation pane, under **Access reports**, choose **Credential report**.
2. Choose **Download Report** and open the CSV in a spreadsheet.
3. Find these columns for each row: `password_enabled`, `password_last_used`, `mfa_active`, `access_key_1_active`, `access_key_1_last_rotated`, `access_key_1_last_used_date`.
:::

:::cli
```bash
aws iam generate-credential-report
# Wait until the State is COMPLETE, then decode the base64 content:
aws iam get-credential-report --query Content --output text | base64 --decode > credential-report.csv
# Columns: user, password_enabled, password_last_used, mfa_active,
# access_key_1_active, access_key_1_last_rotated, access_key_1_last_used_date
cut -d, -f1,4,5,8,9,10,11 credential-report.csv
```
:::

> [!CHECK]
> The first data row is `<root_account>`, followed by one row per IAM user. Any user with `password_enabled` = `true` and `mfa_active` = `false` is a finding to fix. If you already downloaded the report in Step 2, you get that same copy back (IAM regenerates it at most once every four hours), so your admin user may still show `mfa_active` = `false` even though you just added MFA. Download it again after four hours and the admin row shows `mfa_active` = `true`.

### Step 5: Review last accessed data

:::console
1. Choose **User groups** → `Admins` (or **Users** → `admin-yourname`).
2. Open the **Last Accessed** tab.
3. Sort by **Last accessed**. Note how many allowed services show **Not accessed in the tracking period**.
4. Choose a service that has action-level tracking, such as **IAM** or **Amazon S3**, to see individual management actions and when they were last used.
:::

:::cli
```bash
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
JOB=$(aws iam generate-service-last-accessed-details \
  --arn arn:aws:iam::$ACCOUNT:user/admin-yourname --query JobId --output text)
sleep 5   # if JobStatus in the next output is IN_PROGRESS, wait a little and run it again
aws iam get-service-last-accessed-details --job-id "$JOB" --query JobStatus
aws iam get-service-last-accessed-details --job-id "$JOB" \
  --query 'ServicesLastAccessed[?LastAuthenticated!=`null`].[ServiceName,LastAuthenticated]' \
  --output table
```
:::

> [!CHECK]
> With `AdministratorAccess`, hundreds of services are allowed but only a handful (IAM, STS, maybe CloudShell) show recent use. That gap is exactly what least privilege removes for real workloads. New activity can take up to four hours to appear.

## Cleanup

Nothing in this lab is billable, and most changes are worth keeping. Decide for each item:

- [ ] **Custom password policy**: keep it (recommended). To revert: **Account settings** → **Password policy** → **Edit** → **IAM default** → **Save changes** → **Set default**, or `aws iam delete-account-password-policy`.
- [ ] **MFA device on `admin-yourname`**: keep it (strongly recommended). Only if you registered it by mistake: **Security credentials** → choose the radio button next to the device → **Remove** → **Remove**, or `aws iam deactivate-mfa-device --user-name admin-yourname --serial-number <device ARN>` followed by `aws iam delete-virtual-mfa-device --serial-number <device ARN>` for an app-based device.
- [ ] **Root user MFA**: keep it; never remove it.
- [ ] **Local files**: delete `credential-report.csv` (and `mfa-qr.png` if it still exists); the report lists every user in your account.
- [ ] Final check: `aws iam get-account-summary --query 'SummaryMap.[AccountMFAEnabled,MFADevicesInUse]'` shows root MFA enabled and at least one device in use.

## Progress checklist

- [ ] Step 1: Custom password policy saved
- [ ] Step 2: Root MFA confirmed
- [ ] Step 3: MFA registered and tested on the admin user
- [ ] Step 4: Credential report downloaded and read
- [ ] Step 5: Last accessed data reviewed
- [ ] Cleanup decisions made and local files deleted
