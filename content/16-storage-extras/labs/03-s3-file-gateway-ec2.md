---
id: 16-storage-extras-lab-03
title: Mount an S3 bucket over NFS with an S3 File Gateway
objective: Run an Amazon S3 File Gateway on EC2 (standing in for an on-premises VM), create an NFS file share backed by an S3 bucket, write files from a Linux client, and see how objects written directly to S3 need a cache refresh.
estimatedTime: 75 minutes
cost: "About USD 0.25 per hour in us-east-1 (m5.xlarge gateway instance USD 0.192/h, t3.micro client, about 230 GiB of gp3 EBS, two public IPv4 addresses); roughly USD 0.40 if you clean up within 90 minutes. The first 100 GB written to AWS through Storage Gateway is free. Accounts on the credit-based Free plan cannot do this lab (Storage Gateway is Paid plan exclusive and m5.xlarge is not a Free plan instance type); on a Paid-plan account the sign-up credits can cover it."
freeTier: partial
services: [storage-gateway, s3, ec2, ebs, iam-roles, security-groups]
---

> [!COST]
> The gateway needs at least an **xlarge** instance (4 vCPUs, 16 GiB RAM): an `m5.xlarge` costs **USD 0.192 per hour** On-Demand in us-east-1 and is not covered by the legacy Free Tier. Add its root volume (about 80 GiB) and the **150 GiB cache volume** at about USD 0.08 per GB-month for gp3, a `t3.micro` client (about USD 0.01 per hour), and USD 0.005 per hour per public IPv4 address. Storage Gateway charges per GB written to AWS beyond the first 100 GB per account, so this lab's few files cost nothing there. Terminate both instances and check that the cache volume is gone when you finish.
>
> The credit-based **Free plan** (accounts opened on or after 15 July 2025) cannot run this lab, for two reasons. The [AWS Free Tier page](https://aws.amazon.com/free/) marks Storage Gateway **Paid plan exclusive**, and the Free plan's eligible EC2 types (`t3.micro`, `t3.small`, `t4g.micro`, `t4g.small`, `c7i-flex.large`, `m7i-flex.large`) do not include `m5.xlarge`; none of them meets the gateway's 4 vCPU / 16 GiB minimum anyway. Do this lab in a **Paid-plan** account, where the sign-up credits still offset the charges.

In production the gateway runs as a VM in your data center (VMware, Hyper-V, KVM or Nutanix). Running it on EC2 lets you practise the exact same activation, cache and file share steps inside one AWS account. Think of the default VPC as "the corporate network" and the client instance as "an on-premises application server".

## Prerequisites

- An AWS account with permissions for EC2, Storage Gateway, S3 and IAM (for example `AmazonEC2FullAccess`, `AWSStorageGatewayFullAccess`, `AmazonS3FullAccess` and permission to create IAM roles).
- An account on the **Paid plan** or a legacy (pre-15 July 2025) account, because Storage Gateway is Paid plan exclusive and the gateway needs an `m5.xlarge` instance (see the COST note).
- A Region with a **default VPC**; the examples use `us-east-1`.
- **AWS CloudShell** for the CLI tab. Keep the same tab open: later commands reuse shell variables.
- Your browser must be able to reach the gateway on TCP port 80 during activation (the console path activates from your browser's public IP).

## Steps

### Step 1: Create the S3 bucket

:::console
1. Open the **S3** console, choose **General purpose buckets**, then **Create bucket**.
2. For **Bucket name** enter a unique name such as `fgw-lab-<account-id>-<random>` (no dots: S3 File Gateway does not support bucket names with periods).
3. Keep **Block all public access** on and the other defaults, and choose **Create bucket**.
:::

:::cli
```bash
REGION=${AWS_REGION:-us-east-1}
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET=fgw-lab-$ACCOUNT_ID-$RANDOM
aws s3 mb "s3://$BUCKET" --region "$REGION"

VPC_ID=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)
VPC_CIDR=$(aws ec2 describe-vpcs --vpc-ids "$VPC_ID" --query 'Vpcs[0].CidrBlock' --output text)
SUBNET_ID=$(aws ec2 describe-subnets --filters Name=vpc-id,Values="$VPC_ID" Name=default-for-az,Values=true \
  --query 'Subnets[0].SubnetId' --output text)
echo "Bucket $BUCKET  VPC $VPC_ID ($VPC_CIDR)  subnet $SUBNET_ID"
```
:::

### Step 2: Start the gateway setup and launch the gateway instance

The Storage Gateway console starts the wizard and opens the EC2 launch page with the official gateway AMI.

:::console
1. Open the **AWS Storage Gateway** console and choose **Create gateway**.
2. In **Gateway settings**, for **Gateway name** enter `fgw-lab` and choose your **Gateway time zone**.
3. In **Gateway options**, for **Gateway type** choose **Amazon S3 File Gateway**.
4. In **Platform options**, for **Host platform** choose **Amazon EC2**, then choose **Launch instance**. The EC2 launch page opens in a new tab with the Storage Gateway AMI selected.
5. On the EC2 tab, for **Name** enter `fgw-lab-gateway`. For **Instance type** choose **m5.xlarge**.
6. For **Key pair name**, choose an existing key pair or create one named `fgw-lab-key` (you will not need to log in to the gateway).
7. In **Network settings**, choose **Edit**: keep the default **VPC**, pick any **Subnet**, and set **Auto-assign Public IP** to **Enable**.
8. Under **Firewall (security groups)**, create a security group named `fgw-lab-gateway-sg` with these inbound rules:
   - **HTTP** (TCP 80) from **My IP** (needed once, for activation).
   - **Custom TCP** and **Custom UDP** on ports **2049**, **111** and **20048**, each from your VPC CIDR (`172.31.0.0/16` for a default VPC). These are the NFS ports.
9. In **Configure storage**, choose **Add new volume**, set it to **150** GiB and **gp3**. In the advanced view, make sure **Delete on termination** is **Yes** for this volume.
10. Choose **Launch instance**. On the **Instances** page wait until **Instance state** is **Running** and the status checks pass, then copy the instance's **Public IPv4 address** and **Private IPv4 address**.
:::

:::cli
```bash
MY_IP=$(curl -s https://checkip.amazonaws.com)   # CloudShell's public IP, used for activation
GW_SG=$(aws ec2 create-security-group --group-name fgw-lab-gateway-sg \
  --description "File Gateway lab: activation and NFS" --vpc-id "$VPC_ID" \
  --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$GW_SG" --protocol tcp --port 80 --cidr "$MY_IP/32"
for p in 111 2049 20048; do
  aws ec2 authorize-security-group-ingress --group-id "$GW_SG" --protocol tcp --port $p --cidr "$VPC_CIDR"
  aws ec2 authorize-security-group-ingress --group-id "$GW_SG" --protocol udp --port $p --cidr "$VPC_CIDR"
done

GW_AMI=$(aws ssm get-parameter --name /aws/service/storagegateway/ami/FILE_S3/latest \
  --query Parameter.Value --output text)
GW_ID=$(aws ec2 run-instances --image-id "$GW_AMI" --instance-type m5.xlarge \
  --subnet-id "$SUBNET_ID" --security-group-ids "$GW_SG" --associate-public-ip-address \
  --block-device-mappings '[{"DeviceName":"/dev/sdf","Ebs":{"VolumeSize":150,"VolumeType":"gp3","DeleteOnTermination":true}}]' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=fgw-lab-gateway}]' \
  --query 'Instances[0].InstanceId' --output text)
aws ec2 wait instance-status-ok --instance-ids "$GW_ID"
GW_PUBLIC_IP=$(aws ec2 describe-instances --instance-ids "$GW_ID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
GW_PRIVATE_IP=$(aws ec2 describe-instances --instance-ids "$GW_ID" \
  --query 'Reservations[0].Instances[0].PrivateIpAddress' --output text)
echo "Gateway $GW_ID public $GW_PUBLIC_IP private $GW_PRIVATE_IP"
```
:::

> [!CHECK]
> The gateway instance is **Running** with two EBS volumes attached: the root volume and a 150 GiB gp3 volume for the cache. Its security group allows port 80 only from one IP address and the NFS ports only from inside the VPC.

### Step 3: Activate the gateway and allocate the cache

Activation ties the gateway VM to your account and Region. The console path reaches the gateway's port 80 from your browser; the CLI path asks the gateway for an activation key with `curl`.

:::console
1. Back on the Storage Gateway tab, select the **Confirm set up gateway** check box and choose **Next**.
2. On **Connect to AWS**, for **Connection options** choose **IP address** and paste the gateway's **public** IP address.
3. For **Service endpoint**, choose **Publicly accessible**, keep IPv4, and choose **Next**.
4. On **Review and activate**, check the settings (they cannot be changed after activation) and choose **Next** to activate.
5. On **Configure gateway**, in **Configure storage**, allocate the 150 GiB disk to **Cache**.
6. For **CloudWatch log group**, choose **Deactivate logging**. For **CloudWatch alarms**, choose **No alarm**.
7. Choose **Configure**, then open **Gateways** in the navigation pane (the gateway overview page) and wait until `fgw-lab` shows as running.
:::

:::cli
```bash
until ACTIVATION_KEY=$(curl -sf --max-time 10 "http://$GW_PUBLIC_IP/?activationRegion=$REGION&no_redirect"); do
  echo "gateway not ready yet, retrying"; sleep 15
done
echo "Activation key: $ACTIVATION_KEY"   # expires in 30 minutes if unused

GW_ARN=$(aws storagegateway activate-gateway \
  --activation-key "$ACTIVATION_KEY" \
  --gateway-name fgw-lab \
  --gateway-timezone GMT \
  --gateway-region "$REGION" \
  --gateway-type FILE_S3 \
  --query GatewayARN --output text)
sleep 60   # let the gateway finish connecting

# pick the first local disk that is not yet allocated to cache or upload buffer (the 150 GiB volume)
DISK_ID=$(aws storagegateway list-local-disks --gateway-arn "$GW_ARN" \
  --query 'Disks[?DiskAllocationType!=`CACHE_STORAGE` && DiskAllocationType!=`UPLOAD_BUFFER`] | [0].DiskId' --output text)
echo "Cache disk: $DISK_ID"
aws storagegateway add-cache --gateway-arn "$GW_ARN" --disk-ids "$DISK_ID"
aws storagegateway describe-gateway-information --gateway-arn "$GW_ARN" \
  --query '{State:GatewayState,Type:GatewayType}'
```
:::

> [!CHECK]
> The gateway's state is running (`RUNNING` in the CLI) and its local disk shows as allocated to the cache. You can now remove the port 80 rule from `fgw-lab-gateway-sg`; it is only needed during activation.

### Step 4: Create an NFS file share backed by the bucket

Each file share connects to one bucket (or prefix) and uses an IAM role that the gateway assumes to read and write objects.

:::console
1. In the Storage Gateway console choose **File shares**, then **Create file share**, then **Customize configuration**.
2. For **Gateway** choose `fgw-lab`. For **CloudWatch log group** choose **Disable logging**. Choose **Next**.
3. For **S3 bucket** choose your `fgw-lab-...` bucket. Leave **S3 bucket prefix** empty.
4. For **Storage class for new objects** choose **S3 Standard**.
5. For **IAM Role** choose **Created by Storage Gateway**.
6. For **Encryption** choose **S3-Managed Keys (SSE-S3)**.
7. For **File share name** enter `fgw-lab-share` and choose **Next**.
8. For **File share protocol** choose **NFS**. For **Client access** choose **Specific NFS clients**, choose **Add a client**, and enter your VPC CIDR (`172.31.0.0/16`).
9. Keep **Access type** **Read/Write** and **Access level** **Root squash (default)**. Leave automated cache refresh off. Choose **Next**.
10. Review the settings and choose **Create**. Wait until the share's status is **Available**.
:::

:::cli
```bash
cat > fgw-trust.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "storagegateway.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
EOF
cat > fgw-s3-access.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetAccelerateConfiguration", "s3:GetBucketLocation", "s3:GetBucketVersioning",
                 "s3:ListBucket", "s3:ListBucketVersions", "s3:ListBucketMultipartUploads"],
      "Resource": "arn:aws:s3:::$BUCKET"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:AbortMultipartUpload", "s3:DeleteObject", "s3:DeleteObjectVersion", "s3:GetObject",
                 "s3:GetObjectAcl", "s3:GetObjectVersion", "s3:ListMultipartUploadParts",
                 "s3:PutObject", "s3:PutObjectAcl"],
      "Resource": "arn:aws:s3:::$BUCKET/*"
    }
  ]
}
EOF
FGW_ROLE_ARN=$(aws iam create-role --role-name fgw-lab-s3-role \
  --assume-role-policy-document file://fgw-trust.json --query Role.Arn --output text)
aws iam put-role-policy --role-name fgw-lab-s3-role --policy-name fgw-lab-s3-access \
  --policy-document file://fgw-s3-access.json
sleep 15

FS_ARN=$(aws storagegateway create-nfs-file-share \
  --client-token "fgw-lab-$RANDOM" \
  --gateway-arn "$GW_ARN" \
  --role "$FGW_ROLE_ARN" \
  --location-arn "arn:aws:s3:::$BUCKET" \
  --file-share-name fgw-lab-share \
  --default-storage-class S3_STANDARD \
  --client-list "$VPC_CIDR" \
  --squash RootSquash \
  --query FileShareARN --output text)
aws storagegateway describe-nfs-file-shares --file-share-arn-list "$FS_ARN" \
  --query 'NFSFileShareInfoList[0].{Status:FileShareStatus,Name:FileShareName,Path:Path}'
```
:::

> [!CHECK]
> The file share is **Available**, shows protocol **NFS**, your bucket as its location and the allowed client CIDR. Its details page shows an example Linux mount command using the gateway's IP and `/fgw-lab-share`.

### Step 5: Launch a client instance and mount the share

:::console
1. In the **EC2** console choose **Launch instances**. Name it `fgw-lab-client`, choose **Amazon Linux 2023** and **t3.micro**, and for **Key pair** choose **Proceed without a key pair**.
2. In **Network settings** choose **Edit**: default VPC, **Auto-assign public IP** **Enable**, and create a security group `fgw-lab-client-sg` with one inbound **SSH** rule whose source is the prefix list `com.amazonaws.<region>.ec2-instance-connect` (so EC2 Instance Connect in the console can reach it).
3. Launch the instance, wait until it is **Running**, select it and choose **Connect** → **EC2 Instance Connect** → **Connect**.
4. In the browser terminal, run the commands in the "on the client" block of the CLI tab, replacing `GATEWAY_PRIVATE_IP` with the gateway's private IP.
:::

:::cli
```bash
CLIENT_SG=$(aws ec2 create-security-group --group-name fgw-lab-client-sg \
  --description "File Gateway lab client: SSH from EC2 Instance Connect" --vpc-id "$VPC_ID" \
  --query GroupId --output text)
EIC_PL=$(aws ec2 describe-managed-prefix-lists \
  --filters Name=prefix-list-name,Values="com.amazonaws.$REGION.ec2-instance-connect" \
  --query 'PrefixLists[0].PrefixListId' --output text)
aws ec2 authorize-security-group-ingress --group-id "$CLIENT_SG" \
  --ip-permissions "IpProtocol=tcp,FromPort=22,ToPort=22,PrefixListIds=[{PrefixListId=$EIC_PL}]"
AL2023_AMI=$(aws ssm get-parameter \
  --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --query Parameter.Value --output text)
CLIENT_ID=$(aws ec2 run-instances --image-id "$AL2023_AMI" --instance-type t3.micro \
  --subnet-id "$SUBNET_ID" --security-group-ids "$CLIENT_SG" --associate-public-ip-address \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=fgw-lab-client}]' \
  --query 'Instances[0].InstanceId' --output text)
aws ec2 wait instance-running --instance-ids "$CLIENT_ID"
echo "Connect to $CLIENT_ID with EC2 Instance Connect; gateway private IP is $GW_PRIVATE_IP"
```

On the client (EC2 Instance Connect terminal):

```bash
GATEWAY_PRIVATE_IP=172.31.x.x     # replace with the gateway's private IP
sudo dnf install -y nfs-utils
sudo mkdir -p /mnt/fgw
sudo mount -t nfs -o nolock,hard "$GATEWAY_PRIVATE_IP:/fgw-lab-share" /mnt/fgw
df -h /mnt/fgw
echo "Hello from the data center" | sudo tee /mnt/fgw/hello.txt
sudo mkdir -p /mnt/fgw/reports
sudo cp /etc/os-release /mnt/fgw/reports/os-release.txt
ls -lR /mnt/fgw
```
:::

> [!CHECK]
> `df -h` shows the share mounted from the gateway with a very large size (S3 has no fixed capacity), and `ls -lR` lists `hello.txt` and `reports/os-release.txt`. The `nolock` option matters: S3 File Gateway does not support NFS file locking.

### Step 6: See the files as S3 objects

The gateway writes to its local cache first and uploads to S3 asynchronously, usually within seconds for small files.

:::console
1. Open your bucket in the **S3** console and refresh the object list.
2. Confirm `hello.txt` and `reports/os-release.txt` are there as normal objects, and open `hello.txt`.
:::

:::cli
```bash
aws s3 ls "s3://$BUCKET" --recursive
aws s3 cp "s3://$BUCKET/hello.txt" -
```
:::

> [!CHECK]
> Each file written over NFS is one S3 object with the same path as its key, so services such as Athena or Lambda can use the data directly.

### Step 7: Write directly to S3 and refresh the cache

Now act as a cloud application that writes straight into the bucket through the S3 API.

:::console
1. In the S3 console, upload any small file to the bucket root and name it `from-the-cloud.txt` (or run the first command in the CLI tab from CloudShell).
2. On the client terminal run `ls /mnt/fgw`. The new file is **not** listed yet.
3. In the Storage Gateway console, open **File shares**, select `fgw-lab-share`, and choose **Actions** → **Refresh cache**.
4. After a few seconds run `ls /mnt/fgw` again on the client.
:::

:::cli
```bash
echo "Written by a cloud application" > from-the-cloud.txt
aws s3 cp from-the-cloud.txt "s3://$BUCKET/from-the-cloud.txt"
# on the client: ls /mnt/fgw   (the file is missing)
aws storagegateway refresh-cache --file-share-arn "$FS_ARN"
# on the client again: ls /mnt/fgw   (now it appears)
```
:::

> [!CHECK]
> `from-the-cloud.txt` appears in the NFS share only after the cache refresh. In production you either call **RefreshCache** after uploads (for example from a Lambda function on S3 events) or set an automated cache refresh interval on the share.

### Step 8 (optional): Add a lifecycle rule to archive older files

:::console
1. In the S3 console open the bucket, choose the **Management** tab, then **Create lifecycle rule**.
2. Name it `archive-after-30-days`, apply it to all objects in the bucket and acknowledge the warning.
3. Under the transition actions, transition current versions to **Glacier Flexible Retrieval** after **30** days, then choose **Create rule**.
:::

:::cli
```bash
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration '{
  "Rules": [{
    "ID": "archive-after-30-days",
    "Status": "Enabled",
    "Filter": { "Prefix": "" },
    "Transitions": [{ "Days": 30, "StorageClass": "GLACIER" }]
  }]
}'
aws s3api get-bucket-lifecycle-configuration --bucket "$BUCKET"
```
:::

> [!CHECK]
> The rule is listed on the **Management** tab. This is how File Gateway data reaches Glacier: the share writes to Standard (or IA / Intelligent-Tiering) and S3 Lifecycle archives it. Archived files must be restored before the share can read or update them again.

## Cleanup

Delete everything in this order:

- [ ] **Unmount on the client**: `sudo umount /mnt/fgw` in the EC2 Instance Connect terminal, then close it.
- [ ] **File share `fgw-lab-share`**: Storage Gateway → **File shares** → select it → **Actions** → **Delete**, then confirm. CLI: `aws storagegateway delete-file-share --file-share-arn "$FS_ARN"`.
- [ ] **Gateway `fgw-lab`**: Storage Gateway → **Gateways** → select it → delete it from the **Actions** menu and confirm. CLI: `aws storagegateway delete-gateway --gateway-arn "$GW_ARN"`. Deleting the gateway does not stop the EC2 instance.
- [ ] **Instances `fgw-lab-gateway` and `fgw-lab-client`**: EC2 → **Instances** → select both → **Instance state** → **Terminate (delete) instance**. CLI: `aws ec2 terminate-instances --instance-ids "$GW_ID" "$CLIENT_ID"` then `aws ec2 wait instance-terminated --instance-ids "$GW_ID" "$CLIENT_ID"`.
- [ ] **EBS volumes**: EC2 → **Volumes**: confirm the 150 GiB cache volume and the root volumes are gone; delete any that remain in the **available** state. CLI: `aws ec2 describe-volumes --filters Name=status,Values=available --query 'Volumes[].[VolumeId,Size]' --output table`, then `aws ec2 delete-volume --volume-id vol-...` for leftovers from this lab.
- [ ] **Security groups `fgw-lab-gateway-sg` and `fgw-lab-client-sg`**: EC2 → **Security Groups** → select → **Actions** → **Delete security groups** (after the instances are terminated). CLI: `aws ec2 delete-security-group --group-id "$GW_SG"` and `aws ec2 delete-security-group --group-id "$CLIENT_SG"`.
- [ ] **Key pair `fgw-lab-key`** (console path, if you created it): EC2 → **Key Pairs** → select → **Actions** → **Delete**; also delete the downloaded `.pem` file.
- [ ] **Bucket `fgw-lab-...`**: S3 → select it → **Empty** (type `permanently delete`), then **Delete** (type the bucket name). CLI: `aws s3 rb "s3://$BUCKET" --force`.
- [ ] **IAM role for the file share**: console path: IAM → **Roles** → search `StorageGateway` and delete the role that Storage Gateway created for this bucket. CLI path: `aws iam delete-role-policy --role-name fgw-lab-s3-role --policy-name fgw-lab-s3-access` then `aws iam delete-role --role-name fgw-lab-s3-role`.
- [ ] **CloudShell files**: `rm -f fgw-trust.json fgw-s3-access.json from-the-cloud.txt`.
- [ ] **Final check**: no gateways in the Storage Gateway console, no running instances or available volumes from this lab in EC2, and the next day **Billing and Cost Management** → **Bills** shows EC2 and EBS charges only for the time you used.

## Progress checklist

- [ ] Step 1: Created the bucket
- [ ] Step 2: Launched the gateway instance with a 150 GiB cache volume
- [ ] Step 3: Activated the gateway and allocated the cache disk
- [ ] Step 4: Created an NFS file share backed by the bucket
- [ ] Step 5: Mounted the share on a client and wrote files
- [ ] Step 6: Saw the files as S3 objects
- [ ] Step 7: Wrote directly to S3 and made the file visible with a cache refresh
- [ ] Step 8 (optional): Added a lifecycle rule to archive to Glacier Flexible Retrieval
- [ ] Cleanup done
