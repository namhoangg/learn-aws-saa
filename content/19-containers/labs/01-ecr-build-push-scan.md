---
id: 19-containers-lab-01
title: Build an image in CloudShell, push it to Amazon ECR, scan it and add a lifecycle policy
objective: Package a tiny web server as a Docker image, store two versions in a private ECR repository with immutable tags, read the vulnerability scan results and preview a lifecycle rule that keeps only the newest version.
estimatedTime: 35 minutes
cost: "Under USD 0.01: about 60 MB of ECR storage at USD 0.10 per GB-month, prorated; CloudShell has no charge. On the credit-based Free plan it comes out of your Free Tier credits; accounts on the legacy Free Tier (created before 15 July 2025) may instead fall within the 12-month 500 MB ECR storage allowance."
freeTier: partial
services: [ecr, cloudshell, inspector]
---

> [!COST]
> ECR bills USD 0.10 per GB-month for private storage, prorated by the hour. The two image versions in this lab share almost all layers and use roughly 60 MB, so even a full month would cost less than one cent. AWS CloudShell has no additional charge. Basic scanning is turned on by default for private registries and, according to the ECR pricing page, is included at no extra cost. Do not turn on enhanced scanning for this lab: it is billed through Amazon Inspector.

You will build the image that Lab 02 runs on Fargate. If you plan to do Lab 02 next, **keep the repository** at the end and clean it up after Lab 02 instead.

## Prerequisites

- An AWS account with permissions for Amazon ECR and AWS CloudShell (for example the `AmazonEC2ContainerRegistryFullAccess` and `AWSCloudShellFullAccess` managed policies, or administrator access).
- The **US East (N. Virginia) `us-east-1`** Region. Other Regions work if CloudShell offers Docker there; not every Region does, so `us-east-1` is the safe choice.
- Basic comfort with a Linux shell. Everything runs in CloudShell, so you need nothing installed locally. CloudShell keeps 1 GB of persistent storage in your home folder and Docker has limited disk space there, so use small images.

## Steps

### Step 1: Open CloudShell and write a Dockerfile

The image starts from the Apache `httpd` image that Docker publishes in the Amazon ECR Public Gallery (no Docker Hub rate limits) and writes a page showing the container's hostname at start-up, so you can tell containers apart later.

:::console
1. Sign in to the AWS Management Console and switch the Region selector to **US East (N. Virginia)**.
2. Choose the **CloudShell** icon in the console navigation bar (or search for **CloudShell**) and wait for the prompt.
3. Run the commands in the CLI tab to create the folder and the `Dockerfile`. CloudShell is the place to run them even when you follow the console path.
:::

:::cli
```bash
export AWS_REGION=us-east-1
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REPO=demo-web
ECR_URL=${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com
mkdir -p ~/demo-web && cd ~/demo-web

cat > Dockerfile <<'EOF'
FROM public.ecr.aws/docker/library/httpd:latest
ENV APP_VERSION=v1
# Write the page at start-up so it shows the hostname of the container that served it.
CMD ["sh", "-c", "echo \"<h1>demo-web $APP_VERSION</h1><p>Served by $(uname -n)</p>\" > /usr/local/apache2/htdocs/index.html && exec httpd-foreground"]
EOF
cat Dockerfile
docker --version
```
:::

> [!CHECK]
> `cat Dockerfile` prints the three instructions and `docker --version` prints a version number. If `docker` is not found, you are in a Region where CloudShell has no Docker support; switch to `us-east-1` and reopen CloudShell.

### Step 2: Build the image and test it locally

:::cli
```bash
docker build --platform linux/amd64 --tag demo-web:v1 .
docker images demo-web

docker run --detach --name demo-web-test --publish 8080:80 demo-web:v1
sleep 3
curl -s http://localhost:8080
docker rm --force demo-web-test
```
:::

`--platform linux/amd64` makes the image match the default X86_64 architecture of ECS task definitions, which Lab 02 uses.

> [!CHECK]
> `docker images` lists `demo-web` with tag `v1`. `curl` returns `<h1>demo-web v1</h1><p>Served by ...</p>` where the hostname is the short container ID. That is the same image a Fargate task will run, which is the whole point of containers.

### Step 3: Create a private repository with immutable tags

:::console
1. Open the **Amazon ECR** console. In the navigation pane, under **Private registry**, choose **Repositories**, then **Create repository**.
2. For **Repository name**, enter `demo-web`.
3. For **Image tag immutability**, choose **Immutable** and leave the **Immutable tag exclusion** box empty.
4. For **Encryption configuration**, keep **AES-256**.
5. Leave **Image scanning settings** as they are (basic scanning is on at the registry level by default; you will start a scan by hand in Step 5) and choose **Create**.
:::

:::cli
```bash
aws ecr create-repository --repository-name "$REPO" \
  --image-tag-mutability IMMUTABLE \
  --image-scanning-configuration scanOnPush=true \
  --encryption-configuration encryptionType=AES256 \
  --query 'repository.repositoryUri' --output text
```
:::

> [!CHECK]
> The repository `demo-web` appears with **Tag immutability: Immutable** (CLI: the command prints the URI `<account-id>.dkr.ecr.us-east-1.amazonaws.com/demo-web`). The CLI path also turns on scan on push for this repository, so every pushed image is scanned automatically.

### Step 4: Authenticate Docker and push two versions

Docker cannot use IAM directly, so you exchange your IAM identity for a registry password that is valid for 12 hours.

:::console
1. In the ECR console, select the `demo-web` repository and choose **View push commands**. The dialog shows the same login, tag and push commands as the CLI tab; run them in CloudShell.
2. Then run the remaining commands from the CLI tab to try overwriting `v1` and to push `v2`.
:::

:::cli
```bash
aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin "$ECR_URL"

docker tag demo-web:v1 "$ECR_URL/$REPO:v1"
docker push "$ECR_URL/$REPO:v1"

# Change the image and try to reuse the v1 tag: immutability must refuse it.
sed -i 's/APP_VERSION=v1/APP_VERSION=v2/' Dockerfile
docker build --platform linux/amd64 --tag demo-web:v2 .
docker tag demo-web:v2 "$ECR_URL/$REPO:v1"
docker push "$ECR_URL/$REPO:v1" || echo "Push refused, as expected"

# Push the new content under its own tag.
docker tag demo-web:v2 "$ECR_URL/$REPO:v2"
docker push "$ECR_URL/$REPO:v2"
aws ecr describe-images --repository-name "$REPO" \
  --query 'imageDetails[].[imageTags[0],imageSizeInBytes,imagePushedAt]' --output table
```
:::

> [!CHECK]
> `docker login` prints **Login Succeeded**. The second push of `v1` fails with a message mentioning that the tag already exists (`ImageTagAlreadyExistsException` in the API) because tags are immutable. The repository's **Images** list then shows two images, `v1` and `v2`. Note how little the second push uploaded: the base image layers already existed in the repository.

### Step 5: Scan the images and read the findings

:::console
1. Open the `demo-web` repository. On the **Images** page, select the `v2` image and choose **Scan**. Repeat for `v1`. (If you used the CLI path in Step 3, the images were already scanned on push and a second scan within 24 hours is refused; just look at the results.)
2. Wait a minute and refresh. Choose the image tag to open its details and review the vulnerability findings and their severities.
:::

:::cli
```bash
# Images pushed with scanOnPush are already being scanned. If you created the repository
# in the console, start the scan yourself (a second scan within 24 hours is refused, hence || true).
aws ecr start-image-scan --repository-name "$REPO" --image-id imageTag=v2 >/dev/null 2>&1 || true
aws ecr wait image-scan-complete --repository-name "$REPO" --image-id imageTag=v2
aws ecr describe-image-scan-findings --repository-name "$REPO" --image-id imageTag=v2 \
  --query 'imageScanFindings.findingSeverityCounts'
aws ecr describe-image-scan-findings --repository-name "$REPO" --image-id imageTag=v2 \
  --query 'imageScanFindings.findings[0:5].[name,severity]' --output table
```
:::

> [!CHECK]
> The scan status is **Complete** and you see a count of findings by severity (it can be zero or a list of CVEs in the Debian packages of the base image; the exact numbers change as new vulnerabilities are published). Basic scanning covers operating system packages only, and each image can be scanned at most once per 24 hours.

> [!TIP]
> If your security team needs continuous re-scanning and coverage of application libraries (Python, Java, Node.js packages), that is **enhanced scanning** with Amazon Inspector, configured under **Private registry** → **Scanning**. It is billed by Inspector, so it is not part of this lab.

### Step 6: Preview and apply a lifecycle policy

Goal: keep only the newest image whose tag starts with `v`. With two images, the preview should mark `v1` for expiry.

:::console
1. On the **Private repositories** page, select `demo-web`, open the **Actions** menu and choose **Lifecycle policies**.
2. Choose **Edit test rules**, then **Create rule**.
3. Set **Rule priority** to `1` and **Rule description** to `Keep only the newest v* image`.
4. For **Image status**, choose **Tagged (prefix matching)** and enter the prefix `v`.
5. For **Match criteria**, choose **Image count** and enter `1` (more than 1 image).
6. For **Rule action**, choose **Expire**, then **Save**.
7. Choose **Save and run test** and look at **Image matches for test lifecycle rules**.
8. If only `v1` is listed, choose **Apply as lifecycle policy**.
:::

:::cli
```bash
cat > lifecycle.json <<'EOF'
{
  "rules": [
    {
      "rulePriority": 1,
      "description": "Keep only the newest v* image",
      "selection": {
        "tagStatus": "tagged",
        "tagPrefixList": ["v"],
        "countType": "imageCountMoreThan",
        "countNumber": 1
      },
      "action": { "type": "expire" }
    }
  ]
}
EOF
aws ecr start-lifecycle-policy-preview --repository-name "$REPO" \
  --lifecycle-policy-text file://lifecycle.json
aws ecr wait lifecycle-policy-preview-complete --repository-name "$REPO"
aws ecr get-lifecycle-policy-preview --repository-name "$REPO" \
  --query 'previewResults[].[imageTags[0],action.type]' --output table

aws ecr put-lifecycle-policy --repository-name "$REPO" \
  --lifecycle-policy-text file://lifecycle.json
```
:::

> [!CHECK]
> The preview lists exactly one image, `v1`, with action **EXPIRE**; `v2` is kept because it is the newest. After you apply the policy, ECR expires `v1` within 24 hours (the expiry is also recorded in CloudTrail). Lab 02 uses `v2`, so it is safe.

> [!WARNING]
> Lifecycle policies delete images for real. In production, always run the preview first, and never let a broad rule match the tags your running services use.

## Cleanup

If you are continuing with **Lab 02**, skip the first item and delete the repository at the end of Lab 02.

- [ ] **ECR repository `demo-web`** (deletes all images and its lifecycle policy). Console: **Amazon ECR** → **Repositories** → select `demo-web` → **Delete** → type `delete` and confirm. CLI: `aws ecr delete-repository --repository-name demo-web --force`.
- [ ] **Local Docker images in CloudShell**: `docker rmi demo-web:v1 demo-web:v2 "$ECR_URL/demo-web:v1" "$ECR_URL/demo-web:v2"` (ignore "No such image" messages), then `docker image prune --force`.
- [ ] **Lab files in CloudShell**: `cd ~ && rm -rf ~/demo-web`.
- [ ] **Docker credentials** saved by `docker login`: `docker logout "$ECR_URL"`.
- [ ] Final check: `aws ecr describe-repositories --query 'repositories[].repositoryName'` no longer lists `demo-web` (unless you kept it for Lab 02).

## Progress checklist

- [ ] Step 1: Dockerfile written in CloudShell
- [ ] Step 2: Image built and tested locally with curl
- [ ] Step 3: Private repository created with immutable tags
- [ ] Step 4: v1 and v2 pushed, overwrite of v1 refused
- [ ] Step 5: Scan findings reviewed
- [ ] Step 6: Lifecycle rule previewed and applied
- [ ] Cleanup done (or repository kept for Lab 02)
