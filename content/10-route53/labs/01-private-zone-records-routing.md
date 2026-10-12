---
id: 10-route53-lab-01
title: Records, alias and routing policies in a private hosted zone
objective: Create a private hosted zone, add A, CNAME and alias records, see TTL caching and the zone-apex rule in action, and watch weighted, multivalue and latency records answer differently, all queried with dig from an EC2 instance inside the VPC.
estimatedTime: 50 minutes
cost: "About USD 0.02 per hour in us-east-1 (one t3.micro plus its public IPv4 address); the hosted zone is free if you delete it within 12 hours of creating it, otherwise USD 0.50 for the month. Free Tier credits (accounts created on or after 15 July 2025) can cover the instance; on a legacy 12-month Free Tier account launch t2.micro instead, which is the free-tier type in us-east-1."
freeTier: partial
services: [route53, ec2, vpc, security-groups]
---

> [!COST]
> The EC2 instance costs about USD 0.0104 per hour (`t3.micro`, us-east-1) and its public IPv4 address USD 0.005 per hour, unless Free Tier credits (accounts created on or after 15 July 2025) or the legacy 12-month Free Tier cover them. The legacy Free Tier covers `t2.micro` in us-east-1, not `t3.micro`, so on a legacy account choose `t2.micro` in Step 2. A Route 53 hosted zone costs USD 0.50 per month, but a zone deleted within 12 hours of creation is not charged. The few hundred DNS queries you send cost a fraction of a cent. Finish with the **Cleanup** section (or continue straight to lab 02, which reuses everything, and clean up there).

Public hosted zones can only be created for domains you are allowed to administer, so this lab uses a **private hosted zone** named `lab.internal`, which needs no domain at all. Everything you learn about records, alias and routing policies applies to public zones in the same way. The record values in the `10.99.x.x` range are made-up addresses: nothing needs to run there, because you are only looking at which answer Route 53 returns.

## Prerequisites

- An AWS account with permissions for EC2 and Route 53 (for example the `AmazonEC2FullAccess` and `AmazonRoute53FullAccess` managed policies). Creating a private hosted zone also needs EC2 VPC read permissions, which `AmazonEC2FullAccess` includes.
- A Region with a **default VPC** (its `enableDnsSupport` and `enableDnsHostnames` attributes are on by default). The steps use `us-east-1`; if you use another Region, replace `us-east-1` everywhere, including in prefix list names.
- For the CLI tabs: AWS CLI v2 in a Bash shell, ideally **AWS CloudShell** in the same Region. Keep the same terminal open, because later commands reuse shell variables.
- A browser for EC2 Instance Connect (the browser-based terminal opened from the EC2 console).

## Steps

### Step 1: Create a security group for EC2 Instance Connect

The instance only needs SSH from the EC2 Instance Connect service, which AWS publishes as a managed prefix list. No port is opened to the whole internet.

:::console
1. Open the **EC2** console, choose **Security Groups** in the navigation pane, then **Create security group**.
2. For **Security group name** enter `r53-lab-sg`, for **Description** enter `Route 53 lab: SSH from EC2 Instance Connect`, and keep the default **VPC**.
3. Under **Inbound rules**, choose **Add rule**. Set **Type** to **SSH**, keep **Source** as **Custom**, and in the search box choose the prefix list `com.amazonaws.us-east-1.ec2-instance-connect`.
4. Choose **Create security group**.
:::

:::cli
```bash
REGION=us-east-1
VPC_ID=$(aws ec2 describe-vpcs --region "$REGION" --filters Name=is-default,Values=true \
  --query 'Vpcs[0].VpcId' --output text)

SG_ID=$(aws ec2 create-security-group --region "$REGION" --group-name r53-lab-sg \
  --description "Route 53 lab: SSH from EC2 Instance Connect" --vpc-id "$VPC_ID" \
  --query GroupId --output text)

EIC_PL=$(aws ec2 describe-managed-prefix-lists --region "$REGION" \
  --filters Name=prefix-list-name,Values=com.amazonaws.$REGION.ec2-instance-connect \
  --query 'PrefixLists[0].PrefixListId' --output text)

aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$SG_ID" \
  --ip-permissions "IpProtocol=tcp,FromPort=22,ToPort=22,PrefixListIds=[{PrefixListId=$EIC_PL}]"
echo "VPC: $VPC_ID  SG: $SG_ID"
```
:::

> [!CHECK]
> `r53-lab-sg` has one inbound rule: SSH (TCP 22) whose source is a prefix list ID (`pl-...`), not `0.0.0.0/0`.

### Step 2: Launch the test instance

This instance is your DNS client for both labs. The user data installs `dig` (package `bind-utils`) and a tiny Apache site with a `/health` page that lab 02 uses for health checks.

User data script:

```bash
#!/bin/bash
dnf install -y httpd bind-utils
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 300")
ID=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)
echo "<h1>Route 53 lab server $ID</h1>" > /var/www/html/index.html
echo "OK" > /var/www/html/health
systemctl enable --now httpd
```

:::console
1. In the EC2 console choose **Instances** → **Launch instances**.
2. Under **Name and tags**, enter `r53-lab-server`.
3. Under **Application and OS Images (Amazon Machine Image)**, keep **Amazon Linux 2023** (the Quick Start default).
4. Under **Instance type**, choose **t3.micro** (or **t2.micro** on a legacy Free Tier account).
5. Under **Key pair (login)**, choose **Proceed without a key pair (not recommended)**; EC2 Instance Connect pushes a temporary key for you.
6. Under **Network settings**, choose **Edit**. Keep the default VPC and any default subnet, keep **Auto-assign public IP** set to **Enable**, choose **Select existing security group** and pick `r53-lab-sg`.
7. Expand **Advanced details** and paste the script above into **User data**.
8. Choose **Launch instance**, then open the instance and note its **Private IPv4 addresses** value (for example `172.31.20.15`).
:::

:::cli
```bash
# Save the user data script above as user-data.sh first.
# On a legacy Free Tier account, use --instance-type t2.micro instead.
AMI=$(aws ssm get-parameters --region "$REGION" \
  --names /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --query 'Parameters[0].Value' --output text)

INSTANCE_ID=$(aws ec2 run-instances --region "$REGION" --image-id "$AMI" \
  --instance-type t3.micro --security-group-ids "$SG_ID" \
  --user-data file://user-data.sh \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=r53-lab-server}]' \
  --query 'Instances[0].InstanceId' --output text)

aws ec2 wait instance-running --region "$REGION" --instance-ids "$INSTANCE_ID"
PRIVATE_IP=$(aws ec2 describe-instances --region "$REGION" --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].PrivateIpAddress' --output text)
echo "Instance: $INSTANCE_ID  Private IP: $PRIVATE_IP"
```
:::

> [!CHECK]
> After a minute or two the instance is **Running** with **Status check** showing checks passed, and it has both a private and a public IPv4 address.

### Step 3: Create the private hosted zone

:::console
1. Open the **Route 53** console and choose **Hosted zones** in the navigation pane (or **Get started** if this is your first time), then **Create hosted zone**.
2. For **Domain name** enter `lab.internal`. Optionally add a comment such as `Route 53 lab`.
3. For **Type**, choose **Private hosted zone**.
4. Under the VPC association settings, choose the **Region** `us-east-1` and, in the **VPC ID** list, your default VPC.
5. Choose **Create hosted zone**.
:::

:::cli
```bash
ZONE_ID=$(aws route53 create-hosted-zone --name lab.internal \
  --vpc VPCRegion=$REGION,VPCId=$VPC_ID \
  --caller-reference "r53-lab-$(date +%s)" \
  --hosted-zone-config Comment="Route 53 lab" \
  --query 'HostedZone.Id' --output text | cut -d/ -f3)
echo "Zone: $ZONE_ID"
aws route53 list-resource-record-sets --hosted-zone-id "$ZONE_ID" \
  --query 'ResourceRecordSets[].[Name,Type]' --output table
```
:::

> [!CHECK]
> The new zone shows **Type: Private** and already contains two records: an **NS** record listing reserved name servers (`ns-0.awsdns-00.com.` and friends) and an **SOA** record. Do not edit or delete them.

### Step 4: Simple records, TTL and multiple values

Create two simple records: `web` pointing at your instance, and `multi` holding three made-up addresses.

:::console
1. Choose the `lab.internal` zone, then **Create record**.
2. For **Record name** enter `web`, keep **Record type** **A**, enter your instance's private IP in **Value**, set **TTL (seconds)** to `300`, keep **Routing policy** **Simple routing**, and choose **Create records**.
3. Choose **Create record** again. **Record name** `multi`, type **A**, and in **Value** enter three addresses on separate lines: `10.99.0.1`, `10.99.0.2`, `10.99.0.3`. TTL `60`, **Simple routing**. Choose **Create records**.
:::

:::cli
```bash
cat > simple.json <<EOF
{"Changes":[
 {"Action":"CREATE","ResourceRecordSet":{"Name":"web.lab.internal","Type":"A","TTL":300,
   "ResourceRecords":[{"Value":"$PRIVATE_IP"}]}},
 {"Action":"CREATE","ResourceRecordSet":{"Name":"multi.lab.internal","Type":"A","TTL":60,
   "ResourceRecords":[{"Value":"10.99.0.1"},{"Value":"10.99.0.2"},{"Value":"10.99.0.3"}]}}
]}
EOF
aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" --change-batch file://simple.json
```
:::

Now connect to the instance: in the EC2 console select `r53-lab-server`, choose **Connect**, open the **EC2 Instance Connect** tab, choose **Connect using a Public IP**, keep the username `ec2-user`, and choose **Connect**. In the browser terminal run:

```bash
dig +noall +answer web.lab.internal
sleep 20
dig +noall +answer web.lab.internal
for i in 1 2 3 4 5; do dig +short multi.lab.internal | tr '\n' ' '; echo; done
dig +short web.lab.internal @1.1.1.1
```

> [!CHECK]
> The first query shows `web.lab.internal. 300 IN A <your private IP>`. The second usually shows a smaller TTL (around 280), because the VPC resolver is now serving its cached copy and counting down. The `multi` query returns all three addresses every time (the order may or may not change between queries): a simple record cannot drop one of them. The query sent to a public resolver (`@1.1.1.1`) returns nothing, because private zones only answer inside associated VPCs.

### Step 5: CNAME, the zone apex and an alias record

:::console
1. **Create record**: **Record name** `www`, **Record type** **CNAME**, **Value** `web.lab.internal`, TTL `300`. Choose **Create records**.
2. **Create record** again, leave **Record name** empty (that is the zone apex, `lab.internal`), choose **Record type** **CNAME**, **Value** `web.lab.internal`, and choose **Create records**. Read the error, then cancel or change this record as follows.
3. For the apex record, keep **Record name** empty, set **Record type** to **A**, turn on **Alias**, and under **Route traffic to** choose the option for **another record in this hosted zone**, then pick `web.lab.internal`. Set **Evaluate target health** to **No** and choose **Create records**.
:::

:::cli
```bash
cat > cname.json <<EOF
{"Changes":[{"Action":"CREATE","ResourceRecordSet":{"Name":"www.lab.internal","Type":"CNAME","TTL":300,
  "ResourceRecords":[{"Value":"web.lab.internal"}]}}]}
EOF
aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" --change-batch file://cname.json

# Expected to FAIL: a CNAME is not allowed at the zone apex.
cat > apex-cname.json <<EOF
{"Changes":[{"Action":"CREATE","ResourceRecordSet":{"Name":"lab.internal","Type":"CNAME","TTL":300,
  "ResourceRecords":[{"Value":"web.lab.internal"}]}}]}
EOF
aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" --change-batch file://apex-cname.json

# Works: an alias A record at the apex that targets another record in the same zone.
cat > apex-alias.json <<EOF
{"Changes":[{"Action":"CREATE","ResourceRecordSet":{"Name":"lab.internal","Type":"A",
  "AliasTarget":{"HostedZoneId":"$ZONE_ID","DNSName":"web.lab.internal","EvaluateTargetHealth":false}}}]}
EOF
aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" --change-batch file://apex-alias.json
```
:::

On the instance:

```bash
dig +noall +answer www.lab.internal
dig +noall +answer lab.internal
```

> [!CHECK]
> The apex CNAME is rejected (the CLI returns an `InvalidChangeBatch` error). `www.lab.internal` answers with a **CNAME** line followed by the **A** record of `web.lab.internal`: two steps. `lab.internal` answers directly with an **A** record and the instance's IP: the alias is invisible to the client, and its TTL comes from the target record because alias records have none of their own.

### Step 6: Weighted routing

Create three weighted records for `app.lab.internal` with weights 70, 20 and 10. A TTL of 1 second keeps the resolver from caching, so each query gets a fresh weighted choice.

:::console
1. **Create record**: **Record name** `app`, type **A**, **Value** `10.99.1.70`, **TTL** `1`, **Routing policy** **Weighted**, **Weight** `70`, **Record ID** `app-70`.
2. Choose **Add another record** and repeat with **Value** `10.99.1.20`, **Weight** `20`, **Record ID** `app-20`.
3. **Add another record** once more: **Value** `10.99.1.10`, **Weight** `10`, **Record ID** `app-10`. Choose **Create records**.
:::

:::cli
```bash
cat > weighted.json <<EOF
{"Changes":[
 {"Action":"CREATE","ResourceRecordSet":{"Name":"app.lab.internal","Type":"A","SetIdentifier":"app-70","Weight":70,"TTL":1,"ResourceRecords":[{"Value":"10.99.1.70"}]}},
 {"Action":"CREATE","ResourceRecordSet":{"Name":"app.lab.internal","Type":"A","SetIdentifier":"app-20","Weight":20,"TTL":1,"ResourceRecords":[{"Value":"10.99.1.20"}]}},
 {"Action":"CREATE","ResourceRecordSet":{"Name":"app.lab.internal","Type":"A","SetIdentifier":"app-10","Weight":10,"TTL":1,"ResourceRecords":[{"Value":"10.99.1.10"}]}}
]}
EOF
aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" --change-batch file://weighted.json
```
:::

On the instance (about 80 seconds):

```bash
for i in $(seq 1 40); do dig +short app.lab.internal; sleep 2; done | sort | uniq -c
```

Now set the weight of `app-10` to 0: select that record's row, change **Weight** to `0` in the **Edit record** pane, and choose **Save changes** (CLI below). Run the loop again.

:::cli
```bash
cat > weight-zero.json <<EOF
{"Changes":[{"Action":"UPSERT","ResourceRecordSet":{"Name":"app.lab.internal","Type":"A","SetIdentifier":"app-10","Weight":0,"TTL":1,"ResourceRecords":[{"Value":"10.99.1.10"}]}}]}
EOF
aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" --change-batch file://weight-zero.json
```
:::

> [!CHECK]
> The first run returns one address per query, roughly 28 / 8 / 4 out of 40 (DNS weighting is random, so expect some spread). After the change, `10.99.1.10` no longer appears: weight 0 takes a record out of rotation without deleting it.

### Step 7: Multivalue answer versus simple

:::console
1. **Create record**: **Record name** `mv`, type **A**, **Value** `10.99.2.1`, TTL `60`, **Routing policy** **Multivalue answer**, **Record ID** `mv-1`, no health check.
2. **Add another record** twice for `10.99.2.2` (`mv-2`) and `10.99.2.3` (`mv-3`). Choose **Create records**.
:::

:::cli
```bash
cat > multivalue.json <<EOF
{"Changes":[
 {"Action":"CREATE","ResourceRecordSet":{"Name":"mv.lab.internal","Type":"A","SetIdentifier":"mv-1","MultiValueAnswer":true,"TTL":60,"ResourceRecords":[{"Value":"10.99.2.1"}]}},
 {"Action":"CREATE","ResourceRecordSet":{"Name":"mv.lab.internal","Type":"A","SetIdentifier":"mv-2","MultiValueAnswer":true,"TTL":60,"ResourceRecords":[{"Value":"10.99.2.2"}]}},
 {"Action":"CREATE","ResourceRecordSet":{"Name":"mv.lab.internal","Type":"A","SetIdentifier":"mv-3","MultiValueAnswer":true,"TTL":60,"ResourceRecords":[{"Value":"10.99.2.3"}]}}
]}
EOF
aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" --change-batch file://multivalue.json
```
:::

On the instance: `dig +short mv.lab.internal`

> [!CHECK]
> All three addresses come back, just like the simple `multi` record. The difference is that each multivalue record is a separate record that can carry its own health check; in lab 02 you see health checks remove unhealthy answers. Records without a health check always count as healthy.

### Step 8: Latency records in a private zone

In a private hosted zone, latency routing picks the record whose Region is closest to the Region of the VPC that asked.

:::console
1. **Create record**: **Record name** `lat`, type **A**, **Value** `10.99.3.1`, TTL `60`, **Routing policy** **Latency**, **Region** `us-east-1`, **Record ID** `lat-use1`.
2. **Add another record**: **Value** `10.99.3.2`, **Region** `ap-southeast-1` (Singapore), **Record ID** `lat-apse1`. Choose **Create records**.
:::

:::cli
```bash
cat > latency.json <<EOF
{"Changes":[
 {"Action":"CREATE","ResourceRecordSet":{"Name":"lat.lab.internal","Type":"A","SetIdentifier":"lat-use1","Region":"us-east-1","TTL":60,"ResourceRecords":[{"Value":"10.99.3.1"}]}},
 {"Action":"CREATE","ResourceRecordSet":{"Name":"lat.lab.internal","Type":"A","SetIdentifier":"lat-apse1","Region":"ap-southeast-1","TTL":60,"ResourceRecords":[{"Value":"10.99.3.2"}]}}
]}
EOF
aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" --change-batch file://latency.json
```
:::

On the instance: `dig +short lat.lab.internal`

> [!CHECK]
> From a VPC in us-east-1 the answer is `10.99.3.1`. (If you work in another Region, use your own Region for the first record and a distant one for the second; the answer is the record in your Region.)

> [!TIP] If you own a domain
> Everything above works the same in a public hosted zone. If you own a domain, you can create a public zone for a subdomain such as `r53lab.yourdomain.com` (USD 0.50, or free if deleted within 12 hours) and test geolocation or latency answers without delegating it, using `aws route53 test-dns-answer --hosted-zone-id <zone> --record-name www.r53lab.yourdomain.com --record-type A --edns0-client-subnet-ip 203.0.113.10`. The test tool works only for public zones.

## Cleanup

Skip this section if you are continuing to lab 02 now; its Cleanup removes everything from both labs. Otherwise delete, in this order:

- [ ] **All records you created in `lab.internal`** (everything except the NS and SOA records): in the zone, select `web`, `multi`, `www`, the apex alias `lab.internal` A record, the three `app`, three `mv` and two `lat` records (hold **Ctrl** or **Shift** to select several rows), then choose **Delete** and confirm. CLI (needs `jq`, preinstalled in CloudShell; alias records are listed first so nothing points at a missing record):

  ```bash
  aws route53 list-resource-record-sets --hosted-zone-id "$ZONE_ID" \
    --query "ResourceRecordSets[?Type!='NS' && Type!='SOA']" --output json > rrsets.json
  jq '{Changes: [sort_by(.AliasTarget == null)[] | {Action: "DELETE", ResourceRecordSet: .}]}' \
    rrsets.json > delete.json
  aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" --change-batch file://delete.json
  ```
- [ ] **Hosted zone `lab.internal`**: on the **Hosted zones** page choose its row, choose **Delete**, type the confirmation key and choose **Delete**. CLI: `aws route53 delete-hosted-zone --id "$ZONE_ID"`
- [ ] **EC2 instance `r53-lab-server`**: **Instances** → select → **Instance state** → **Terminate (delete) instance**. CLI: `aws ec2 terminate-instances --region "$REGION" --instance-ids "$INSTANCE_ID"` then `aws ec2 wait instance-terminated --region "$REGION" --instance-ids "$INSTANCE_ID"`
- [ ] **Security group `r53-lab-sg`** (after the instance has terminated): **Security Groups** → select → **Actions** → **Delete security groups**. CLI: `aws ec2 delete-security-group --region "$REGION" --group-id "$SG_ID"`
- [ ] **Local JSON files** in your shell (`*.json`, `user-data.sh`): `rm -f *.json user-data.sh` (not AWS resources, just tidiness).
- [ ] **Final check**: Route 53 **Hosted zones** no longer lists `lab.internal`; EC2 shows no running instances in the Region; a day later, **Billing and Cost Management** → **Bills** shows no Route 53 hosted zone charge if you deleted it within 12 hours.

## Progress checklist

- [ ] Step 1: Security group allowing SSH only from the EC2 Instance Connect prefix list
- [ ] Step 2: Test instance launched with `dig` and a web page
- [ ] Step 3: Private hosted zone `lab.internal` created and associated with the default VPC
- [ ] Step 4: Simple records queried, TTL countdown seen, private zone invisible to a public resolver
- [ ] Step 5: Apex CNAME rejected, alias A record at the apex working
- [ ] Step 6: Weighted split observed, weight 0 removes a record from answers
- [ ] Step 7: Multivalue answer records created and compared with a simple record
- [ ] Step 8: Latency records answer with the VPC's own Region
- [ ] Cleanup done (or continuing to lab 02)
