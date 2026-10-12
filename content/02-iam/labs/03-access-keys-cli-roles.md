---
id: 02-iam-lab-03
title: Use the AWS CLI with temporary credentials and access keys, then create an IAM role for EC2
objective: Run AWS CLI commands from CloudShell and with aws login, configure a least-privilege access key profile, rotate and delete the key, and create an EC2 service role with its instance profile.
estimatedTime: 45 minutes
cost: "Free. IAM, STS and AWS CloudShell have no charge; no EC2 instance is launched (the role is used in the EC2 lessons)."
freeTier: yes
services: [cli-sdk, cloudshell, iam, iam-roles, sts, ec2]
---

You will reach AWS from the command line in three ways, from the most to the least recommended: **CloudShell** (no setup, no keys), **`aws login`** (temporary credentials on your own machine), and a classic **access key** (long-term, only when nothing else fits). Then you create the kind of role an EC2 instance uses instead of keys.

> [!WARNING] Treat access keys like passwords
> The access key you create in Step 3 is a real, working credential. Never paste it into chat, code, screenshots or Git. You delete it at the end of the lab.

## Prerequisites

- An AWS account and your admin identity (for example `admin-yourname` from lab 01, ideally with MFA from lab 02).
- A computer where you can install software (for Step 2). If you cannot install anything, do Steps 1, 3 to 6 in CloudShell instead, using `--profile lab-cli` exactly as shown.
- Any Region; IAM is global. The examples use `us-east-1` as the default Region for the CLI profile.

## Steps

### Step 1: Run your first commands in AWS CloudShell

CloudShell is a browser terminal that is already signed in as you, with AWS CLI v2 preinstalled and 1 GB of persistent home storage per Region, at no charge.

:::console
1. Sign in to the console as your admin user.
2. On the navigation bar choose the **CloudShell** icon (or type `CloudShell` in the **Search** box, or choose **CloudShell** on the Console Toolbar at the lower left).
3. Wait for the `$` prompt, then run the commands in the CLI tab.
:::

:::cli
```bash
aws --version
aws sts get-caller-identity
aws iam list-users --query 'Users[].UserName' --output table
```
:::

> [!CHECK]
> `get-caller-identity` returns your 12-digit account ID and an ARN like `arn:aws:iam::123456789012:user/admin-yourname`. You never typed a key: CloudShell uses your console session.

### Step 2: Install AWS CLI v2 locally and sign in with aws login

`aws login` needs AWS CLI **2.32.0 or later**. It opens your browser, lets you pick your console session, and caches temporary credentials that refresh automatically for up to 12 hours. The signed-in identity needs the permissions in the `SignInLocalDevelopmentAccess` managed policy; your admin user already has them through `AdministratorAccess`.

:::console
1. Download and install AWS CLI v2 from the official guide (**Installing or updating to the latest version of the AWS CLI** in the AWS CLI User Guide). Avoid unofficial package-manager builds.
2. Open a new terminal and run `aws --version`; if it is older than 2.32.0, run `aws update`.
3. Run `aws login --profile lab-login`. When asked, enter the default Region (for example `us-east-1`).
4. In the browser window that opens, choose your admin session (or sign in with password + MFA) and return to the terminal.
:::

:::cli
```bash
# Install (pick one). Linux or macOS, per-user install script:
curl -fsSL https://awscli.amazonaws.com/v2/install.sh | bash
# Windows (PowerShell):  irm https://awscli.amazonaws.com/v2/install.ps1 | iex

aws --version                       # must be 2.32.0 or later
aws login --profile lab-login       # browser opens; choose your session
aws sts get-caller-identity --profile lab-login
cat ~/.aws/config                   # shows [profile lab-login] with login_session, no keys
```
:::

> [!CHECK]
> `get-caller-identity --profile lab-login` shows the same admin ARN as CloudShell, and `~/.aws/config` contains a `login_session = arn:aws:iam::...` line instead of any secret key. On Windows the file is `%UserProfile%\.aws\config`.

### Step 3: Create a least-privilege user and an access key

Some tools only accept access keys. When that happens, give the key to a dedicated user with the smallest possible permissions, never to your admin user.

> [!NOTE] Which identity runs the admin commands
> From here on, the CLI commands that create, change or delete IAM objects must run as your admin. In CloudShell that happens automatically. On your own machine, run `export AWS_PROFILE=lab-login` once (PowerShell: `$env:AWS_PROFILE = "lab-login"`) so they use the `aws login` profile from Step 2; commands that show `--profile lab-cli` override it.

:::console
1. In the IAM console choose **Users** → **Create user**. Enter **User name** `lab-cli`. Leave **Provide user access to the AWS Management Console – optional** cleared (this user never signs in to the console). Choose **Next**.
2. On **Set permissions** choose **Attach policies directly**, search for and select **IAMReadOnlyAccess**, choose **Next**, then **Create user**.
3. Open `lab-cli` → **Security credentials** tab → **Access keys** section → **Create access key**.
4. On **Access key best practices & alternatives**, read the suggested alternatives for each use case (CloudShell, `aws login`, IAM Identity Center, roles). For this exercise choose **Other**, then **Next**.
5. On **Set description tag**, optionally enter a description such as `lab 03 practice key`, then choose **Create access key**.
6. On **Retrieve access keys**, choose **Download .csv file** (or **Show** to reveal the secret). This is the only time the secret is available. Choose **Done**.
:::

:::cli
```bash
aws iam create-user --user-name lab-cli
aws iam attach-user-policy --user-name lab-cli \
  --policy-arn arn:aws:iam::aws:policy/IAMReadOnlyAccess
# Prints AccessKeyId and SecretAccessKey once; keep the output private.
aws iam create-access-key --user-name lab-cli
```
:::

> [!CHECK]
> The **Access keys** section of `lab-cli` lists one key with status **Active**, an ID starting with `AKIA`, and **Last used** = never. You cannot view the secret again in the console.

### Step 4: Configure a named profile with the key and test least privilege

Run this on your machine (or in CloudShell). Using a **named profile** keeps the key away from your default settings.

:::console
1. In your terminal run `aws configure --profile lab-cli`.
2. Paste the **AWS Access Key ID** and **AWS Secret Access Key** from the CSV file, enter `us-east-1` for **Default region name** and `json` for **Default output format**.
3. Run the commands in the CLI tab and compare the results.
:::

:::cli
```bash
aws configure --profile lab-cli
aws sts get-caller-identity --profile lab-cli          # ARN ends in user/lab-cli
aws iam list-users --profile lab-cli --output table    # allowed: IAM read
aws iam create-group --group-name should-fail --profile lab-cli   # denied
aws s3 ls --profile lab-cli                            # denied: no S3 permissions
grep -A1 "\[lab-cli\]" ~/.aws/credentials              # key ID shown; the secret sits on the next line in plain text
```
:::

> [!CHECK]
> `list-users` succeeds; `create-group` and `s3 ls` fail with **AccessDenied** errors that name `user/lab-cli` and the missing action. The credentials file shows the key in plain text, which is why long-term keys on laptops are risky.

### Step 5: Rotate safely: deactivate, test, delete

AWS allows two keys per user so you can switch applications to a new key before removing the old one. Here you simply retire the key.

:::console
1. In the IAM console open `lab-cli` → **Security credentials** → **Access keys**.
2. For the key, choose **Actions** → **Deactivate**, then confirm with **Deactivate**.
3. In your terminal run `aws sts get-caller-identity --profile lab-cli` again (allow a few seconds for the change to propagate).
4. Back in the console choose **Actions** → **Delete** for the inactive key, enter the access key ID to confirm, and choose **Delete**.
:::

:::cli
```bash
KEY_ID=$(aws iam list-access-keys --user-name lab-cli \
  --query 'AccessKeyMetadata[0].AccessKeyId' --output text)
aws iam update-access-key --user-name lab-cli --access-key-id "$KEY_ID" --status Inactive
sleep 10
aws sts get-caller-identity --profile lab-cli    # now fails: the key is inactive
aws iam delete-access-key --user-name lab-cli --access-key-id "$KEY_ID"
aws iam list-access-keys --user-name lab-cli     # empty list
```
:::

> [!CHECK]
> After deactivation the profile fails with an error such as **InvalidClientTokenId** (the security token is invalid). After deletion the user has no access keys, and the deleted key can never be restored.

### Step 6: Create an IAM role for EC2 and inspect its two policies

This is the role an EC2 instance will use in later lessons to call IAM read APIs without any stored keys.

:::console
1. In the IAM console choose **Roles** → **Create role**.
2. For **Trusted entity type** choose **AWS service**. For **Service or use case** choose **EC2**, select the **EC2** use case, and choose **Next**.
3. Under **Permissions policies** search for and select **IAMReadOnlyAccess**, then choose **Next**.
4. Enter **Role name** `lab-ec2-iam-readonly` and an optional **Description**. Review **Step 1: Select trusted entities**: the trust policy names the service principal `ec2.amazonaws.com`.
5. Choose **Create role**.
6. Open the role and look at the **Permissions** tab (what it can do) and the **Trust relationships** tab (who can assume it).
:::

:::cli
```bash
cat > ec2-trust.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "ec2.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF
aws iam create-role --role-name lab-ec2-iam-readonly \
  --assume-role-policy-document file://ec2-trust.json
aws iam attach-role-policy --role-name lab-ec2-iam-readonly \
  --policy-arn arn:aws:iam::aws:policy/IAMReadOnlyAccess
# The console creates the instance profile for you; with the CLI you add it yourself.
aws iam create-instance-profile --instance-profile-name lab-ec2-iam-readonly
aws iam add-role-to-instance-profile --instance-profile-name lab-ec2-iam-readonly \
  --role-name lab-ec2-iam-readonly
aws iam list-instance-profiles-for-role --role-name lab-ec2-iam-readonly \
  --query 'InstanceProfiles[].InstanceProfileName'
```
:::

> [!CHECK]
> The **Trust relationships** tab shows `"Service": "ec2.amazonaws.com"` with `sts:AssumeRole`, the **Permissions** tab shows `IAMReadOnlyAccess`, and `list-instance-profiles-for-role` returns `lab-ec2-iam-readonly`: an instance profile with the same name, which is what the EC2 launch wizard lists under **IAM instance profile**.

## Cleanup

Delete in this order (all IAM objects are free, but unused identities are a security risk):

- [ ] **Access key of `lab-cli`**: already deleted in Step 5 (check: `aws iam list-access-keys --user-name lab-cli` returns an empty list; if not, deactivate and delete it as in Step 5).
- [ ] **User `lab-cli`**: console **Users** → select `lab-cli` → **Delete** → type the user name → **Delete**. CLI:
  ```bash
  aws iam detach-user-policy --user-name lab-cli \
    --policy-arn arn:aws:iam::aws:policy/IAMReadOnlyAccess
  aws iam delete-user --user-name lab-cli
  ```
- [ ] **Role `lab-ec2-iam-readonly` and its instance profile**: console **Roles** → select the role → **Delete** → type the role name → **Delete** (the console also deletes the same-named instance profile and detaches the policy). CLI:
  ```bash
  aws iam remove-role-from-instance-profile --instance-profile-name lab-ec2-iam-readonly \
    --role-name lab-ec2-iam-readonly
  aws iam delete-instance-profile --instance-profile-name lab-ec2-iam-readonly
  aws iam detach-role-policy --role-name lab-ec2-iam-readonly \
    --policy-arn arn:aws:iam::aws:policy/IAMReadOnlyAccess
  aws iam delete-role --role-name lab-ec2-iam-readonly
  ```
- [ ] **Local `lab-cli` profile**: open `~/.aws/credentials` and `~/.aws/config` (`%UserProfile%\.aws\` on Windows) and delete the `[lab-cli]` and `[profile lab-cli]` sections. Do the same in CloudShell if you configured it there.
- [ ] **`aws login` session**: run `aws logout --profile lab-login` (this deletes the cached credentials), clear the variable with `unset AWS_PROFILE` (PowerShell: `Remove-Item Env:AWS_PROFILE`) if you set it, then remove the `[profile lab-login]` section from `~/.aws/config` if you do not want to keep it.
- [ ] **Local files**: delete the downloaded access key `.csv` file and `ec2-trust.json`.
- [ ] Final check: `aws iam list-users --query "Users[].UserName"` and `aws iam list-roles --query "Roles[?starts_with(RoleName, 'lab-')].RoleName"` show no `lab-` identities.

## Progress checklist

- [ ] Step 1: Ran commands in CloudShell
- [ ] Step 2: Installed CLI v2 and signed in with aws login
- [ ] Step 3: Created `lab-cli` with a least-privilege policy and an access key
- [ ] Step 4: Tested allowed and denied calls with a named profile
- [ ] Step 5: Deactivated and deleted the access key
- [ ] Step 6: Created the EC2 role and inspected trust and permissions policies
- [ ] Cleanup done
