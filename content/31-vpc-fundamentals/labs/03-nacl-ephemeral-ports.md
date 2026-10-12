---
id: 31-vpc-fundamentals-lab-03
title: Network ACLs, ephemeral ports and stateless versus stateful filtering
objective: Put a custom network ACL on the bastion's subnet, rebuild access one rule at a time to see why stateless rules need ephemeral ports, test first-match rule ordering with a deny rule, and contrast it all with a stateful security group.
estimatedTime: 40 minutes
cost: "About USD 0.03 per hour in us-east-1 for the lab 01 resources that keep running (two t3.micro instances, one public IPv4 address); network ACLs and their rules are free. Covered by Free Tier credits (accounts from 15 July 2025) or the legacy 12-month Free Tier."
freeTier: partial
services: [nacl, security-groups, subnet, vpc, bastion-host, ec2, cloudshell]
---

> [!COST]
> This lab creates nothing billable: network ACLs and rules cost nothing. It keeps lab 01's two `t3.micro` instances (USD 0.0104 per hour each) and the bastion's public IPv4 address (USD 0.005 per hour) running. Finish with the **Cleanup** section, which also removes the lab 01 resources.

You will lock the bastion's subnet with a brand-new custom network ACL and then open it rule by rule, testing after each change. Every failure on the way is deliberate: each one shows a property of network ACLs that exam questions rely on.

> [!WARNING]
> Changing the network ACL of a subnet affects **every** resource in it immediately. Here that is only your lab bastion. Never test like this on a subnet that carries real traffic.

## Prerequisites

- Lab 01 completed **without** its cleanup: `demo-vpc`, `demo-public-a`, `demo-private-a`, `demo-bastion-sg`, `demo-app-sg`, `demo-key` (with `~/demo-key.pem` in CloudShell), and the running instances `demo-bastion` and `demo-app`. Lab 02 is not required.
- The same IAM permissions and Region as lab 01.
- AWS CloudShell in that Region, with the lab 01 variables loaded. In a new session, run this block (the same as lab 02's, plus the default network ACL):

```bash
VPC_ID=$(aws ec2 describe-vpcs --filters Name=tag:Name,Values=demo-vpc --query 'Vpcs[0].VpcId' --output text)
subnet_id() { aws ec2 describe-subnets --filters Name=vpc-id,Values="$VPC_ID" Name=tag:Name,Values="$1" --query 'Subnets[0].SubnetId' --output text; }
PUB_A=$(subnet_id demo-public-a); PUB_B=$(subnet_id demo-public-b)
PRIV_A=$(subnet_id demo-private-a); PRIV_B=$(subnet_id demo-private-b)
rt_id() { aws ec2 describe-route-tables --filters Name=vpc-id,Values="$VPC_ID" Name=tag:Name,Values="$1" --query 'RouteTables[0].RouteTableId' --output text; }
PUB_RT=$(rt_id demo-public-rt); PRIV_RT=$(rt_id demo-private-rt)
IGW_ID=$(aws ec2 describe-internet-gateways --filters Name=attachment.vpc-id,Values="$VPC_ID" --query 'InternetGateways[0].InternetGatewayId' --output text)
sg_id() { aws ec2 describe-security-groups --filters Name=vpc-id,Values="$VPC_ID" Name=group-name,Values="$1" --query 'SecurityGroups[0].GroupId' --output text; }
BASTION_SG=$(sg_id demo-bastion-sg); APP_SG=$(sg_id demo-app-sg)
instance_id() { aws ec2 describe-instances --filters Name=tag:Name,Values="$1" Name=instance-state-name,Values=running --query 'Reservations[0].Instances[0].InstanceId' --output text; }
BASTION_ID=$(instance_id demo-bastion); APP_ID=$(instance_id demo-app)
BASTION_IP=$(aws ec2 describe-instances --instance-ids "$BASTION_ID" --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
APP_IP=$(aws ec2 describe-instances --instance-ids "$APP_ID" --query 'Reservations[0].Instances[0].PrivateIpAddress' --output text)
MY_IP=$(curl -s https://checkip.amazonaws.com)
aws ec2 authorize-security-group-ingress --group-id "$BASTION_SG" --protocol tcp --port 22 --cidr "$MY_IP/32" 2>/dev/null || echo "SSH rule for $MY_IP already present"
DEFAULT_NACL=$(aws ec2 describe-network-acls --filters Name=vpc-id,Values="$VPC_ID" Name=default,Values=true --query 'NetworkAcls[0].NetworkAclId' --output text)
hop() {
  local target=$1; shift
  ssh -i ~/demo-key.pem -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 \
    -o ProxyCommand="ssh -i ~/demo-key.pem -o StrictHostKeyChecking=accept-new -W %h:%p ec2-user@$BASTION_IP" \
    ec2-user@"$target" "$@"
}
echo "$VPC_ID $PUB_A $BASTION_IP $APP_IP $MY_IP $DEFAULT_NACL"
```

Two short test commands are used throughout. Define them now:

```bash
t_ssh()  { ssh -i ~/demo-key.pem -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 \
             ec2-user@"$BASTION_IP" 'echo "SSH OK on $(hostname)"' || echo "SSH BLOCKED"; }
t_web()  { ssh -i ~/demo-key.pem -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 ec2-user@"$BASTION_IP" \
             'getent hosts checkip.amazonaws.com >/dev/null && echo "DNS OK"; curl -s -m 10 https://checkip.amazonaws.com || echo "HTTPS BLOCKED"'; }
t_ssh
```

## Steps

### Step 1: Inspect the default network ACL

:::console
1. In the **VPC** console choose **Network ACLs** and find the one for `demo-vpc` whose **Default** column says **Yes**.
2. Open its **Inbound rules** and **Outbound rules** tabs, then its **Subnet associations** tab.
:::

:::cli
```bash
aws ec2 describe-network-acls --network-acl-ids "$DEFAULT_NACL" \
  --query 'NetworkAcls[0].Entries[].[Egress,RuleNumber,Protocol,CidrBlock,RuleAction]' --output table
aws ec2 describe-network-acls --network-acl-ids "$DEFAULT_NACL" \
  --query 'NetworkAcls[0].Associations[].SubnetId' --output text
```
:::

> [!CHECK]
> Each direction has rule **100** allowing all traffic from or to `0.0.0.0/0`, followed by the `*` rule that denies everything else (the API shows it as rule number `32767`, protocol `-1` meaning all). All four `demo-*` subnets are associated with it, because you never associated them with anything else. This permissive default is why lab 01 worked without touching network ACLs.

### Step 2: Create a custom network ACL and attach it to the bastion's subnet

:::console
1. In **Network ACLs** choose **Create network ACL**. **Name** `demo-public-nacl`, **VPC** `demo-vpc`, then **Create network ACL**.
2. Select it and look at **Inbound rules** and **Outbound rules**: only the `*` deny rule is there.
3. Choose **Actions** → **Edit subnet associations**, select `demo-public-a`, and choose **Save changes**.
4. Run `t_ssh` in CloudShell.
:::

:::cli
```bash
NACL_ID=$(aws ec2 create-network-acl --vpc-id "$VPC_ID" \
  --tag-specifications 'ResourceType=network-acl,Tags=[{Key=Name,Value=demo-public-nacl}]' \
  --query NetworkAcl.NetworkAclId --output text)
aws ec2 describe-network-acls --network-acl-ids "$NACL_ID" \
  --query 'NetworkAcls[0].Entries[].[Egress,RuleNumber,RuleAction]' --output table

# A subnet always has exactly one NACL association; swap it to the new NACL.
nacl_assoc() { aws ec2 describe-network-acls --filters Name=association.subnet-id,Values="$1" \
  --query "NetworkAcls[0].Associations[?SubnetId=='$1'].NetworkAclAssociationId | [0]" --output text; }
aws ec2 replace-network-acl-association --association-id "$(nacl_assoc "$PUB_A")" --network-acl-id "$NACL_ID"
t_ssh
```
:::

> [!CHECK]
> `t_ssh` prints **SSH BLOCKED** after about 10 seconds. Nothing changed on the instance or its security group (it still allows TCP 22 from your IP), but the packets are dropped at the subnet edge: a freshly created custom network ACL denies all traffic in both directions until you add rules. A new subnet association takes effect within moments; if SSH still works, wait a few seconds and retry.

### Step 3: Allow inbound SSH from your address only

:::console
1. Select `demo-public-nacl` → **Inbound rules** → **Edit inbound rules** → **Add new rule**.
2. **Rule number** `100`, **Type** **SSH (22)**, **Source** your CloudShell address followed by `/32` (`echo $MY_IP` prints it), **Allow/Deny** **Allow**. Choose **Save changes**.
3. Run `t_ssh`.
:::

:::cli
```bash
aws ec2 create-network-acl-entry --network-acl-id "$NACL_ID" --ingress --rule-number 100 \
  --protocol tcp --port-range From=22,To=22 --cidr-block "$MY_IP/32" --rule-action allow
t_ssh
```
:::

> [!CHECK]
> Still **SSH BLOCKED**. Your connection request now gets in, but the server's reply travels from port 22 back to the random **ephemeral port** that CloudShell's SSH client picked. The network ACL has no memory of the request, so it checks that reply against the **outbound** rules, where only the `*` deny exists.

### Step 4: Allow the replies on ephemeral ports

:::console
1. Select `demo-public-nacl` → **Outbound rules** → **Edit outbound rules** → **Add new rule**.
2. **Rule number** `100`, **Type** **Custom TCP**, **Port range** `1024-65535`, **Destination** your address with `/32`, **Allow/Deny** **Allow**. Choose **Save changes**.
3. Run `t_ssh`.
:::

:::cli
```bash
aws ec2 create-network-acl-entry --network-acl-id "$NACL_ID" --egress --rule-number 100 \
  --protocol tcp --port-range From=1024,To=65535 --cidr-block "$MY_IP/32" --rule-action allow
t_ssh
```
:::

> [!CHECK]
> **SSH OK on ip-10-0-0-…**. A stateless filter needs a rule for each direction of every conversation. CloudShell runs Linux, whose client picks a source port from 32768-60999, but any NAT device on CloudShell's way to the internet may rewrite that port, and NAT gateways use the whole 1024-65535 range. `1024-65535` covers that case as well as Windows clients (49152-65535) and load balancers (1024-65535), which is why it is the usual choice.

### Step 5: Let the bastion make outbound HTTPS calls

Now the bastion is the client. Run `t_web`.

> [!CHECK]
> It prints **DNS OK** and then **HTTPS BLOCKED**. Name resolution works because network ACLs never filter traffic to the Amazon DNS resolver; the HTTPS request itself is denied by the outbound rules.

:::console
1. **Outbound rules** → **Edit outbound rules** → **Add new rule**: **Rule number** `110`, **Type** **HTTPS (443)**, **Destination** `0.0.0.0/0`, **Allow**. **Save changes**, then run `t_web`.
2. **Inbound rules** → **Edit inbound rules** → **Add new rule**: **Rule number** `110`, **Type** **Custom TCP**, **Port range** `1024-65535`, **Source** `0.0.0.0/0`, **Allow**. **Save changes**, then run `t_web` again.
:::

:::cli
```bash
aws ec2 create-network-acl-entry --network-acl-id "$NACL_ID" --egress --rule-number 110 \
  --protocol tcp --port-range From=443,To=443 --cidr-block 0.0.0.0/0 --rule-action allow
t_web
aws ec2 create-network-acl-entry --network-acl-id "$NACL_ID" --ingress --rule-number 110 \
  --protocol tcp --port-range From=1024,To=65535 --cidr-block 0.0.0.0/0 --rule-action allow
t_web
```
:::

> [!CHECK]
> After the outbound rule alone, HTTPS is still blocked: the request leaves, but the web server's answer comes back to the bastion's ephemeral port and the inbound rules deny it. After inbound rule 110, `t_web` prints the bastion's public IP. The pattern is the mirror image of Step 4: when the instance is the **client**, the ephemeral-port rule goes on the **inbound** side.

### Step 6: Let the bastion reach the private subnet

```bash
hop "$APP_IP" hostname || echo "HOP BLOCKED"
```

The hop fails: the bastion's SSH request to `demo-app` (TCP 22 to `10.0.16.x`) matches no outbound rule. Add one:

:::console
1. **Outbound rules** → **Edit outbound rules** → **Add new rule**: **Rule number** `120`, **Type** **SSH (22)**, **Destination** `10.0.16.0/20`, **Allow**. **Save changes**.
2. Run `hop "$APP_IP" hostname` again.
:::

:::cli
```bash
aws ec2 create-network-acl-entry --network-acl-id "$NACL_ID" --egress --rule-number 120 \
  --protocol tcp --port-range From=22,To=22 --cidr-block 10.0.16.0/20 --rule-action allow
hop "$APP_IP" hostname
```
:::

> [!CHECK]
> The hop now prints `demo-app`'s hostname. You added no inbound rule for the reply because inbound rule 110 (`1024-65535` from anywhere) already covers it. Traffic between two subnets crosses **both** subnets' network ACLs; `demo-private-a` still uses the permissive default ACL, so only the bastion side needed work. In a real design you would write matching rules on both sides, as the lesson's web-to-database example shows.

### Step 7: Rule order decides: first match wins

:::console
1. **Inbound rules** → **Edit inbound rules** → **Add new rule**: **Rule number** `90`, **Type** **SSH (22)**, **Source** your address with `/32`, **Allow/Deny** **Deny**. **Save changes**, then run `t_ssh`.
2. **Edit inbound rules** again, change that rule's **Rule number** from `90` to `150`, and **Save changes** (the console replaces the rule for you). Run `t_ssh`.
:::

:::cli
```bash
aws ec2 create-network-acl-entry --network-acl-id "$NACL_ID" --ingress --rule-number 90 \
  --protocol tcp --port-range From=22,To=22 --cidr-block "$MY_IP/32" --rule-action deny
t_ssh
# The API cannot renumber a rule: delete it and create it again with the new number.
aws ec2 delete-network-acl-entry --network-acl-id "$NACL_ID" --ingress --rule-number 90
aws ec2 create-network-acl-entry --network-acl-id "$NACL_ID" --ingress --rule-number 150 \
  --protocol tcp --port-range From=22,To=22 --cidr-block "$MY_IP/32" --rule-action deny
t_ssh
```
:::

> [!CHECK]
> With the deny at **90**, `t_ssh` is **BLOCKED**: rule 90 is evaluated before the allow at 100. With the same deny at **150**, SSH works again: rule 100 matches first and evaluation stops there, so rule 150 is never reached. To block one address inside a range you otherwise allow, the deny must carry the **lower** number. Leaving gaps between rule numbers (90, 100, 110…) is what made it possible to slot the deny in front.

### Step 8: Compare with a stateful, allow-only security group

:::console
1. In the **EC2** console open **Security Groups** → `demo-bastion-sg` → **Inbound rules** → **Edit inbound rules**. Look at the rule row: there is no **Allow/Deny** choice, because security groups only allow. Choose **Cancel**.
2. Open the **Outbound rules** tab → **Edit outbound rules**, choose **Delete** on the **All traffic** rule, and choose **Save rules**. The group now has **no** outbound rules.
3. Run `t_ssh` and `t_web`.
4. Restore the rule: **Edit outbound rules** → **Add rule**, **Type** **All traffic**, **Destination** **Anywhere-IPv4** (`0.0.0.0/0`), **Save rules**.
:::

:::cli
```bash
aws ec2 revoke-security-group-egress --group-id "$BASTION_SG" \
  --ip-permissions 'IpProtocol=-1,IpRanges=[{CidrIp=0.0.0.0/0}]'
t_ssh
t_web
aws ec2 authorize-security-group-egress --group-id "$BASTION_SG" \
  --ip-permissions 'IpProtocol=-1,IpRanges=[{CidrIp=0.0.0.0/0}]'
```
:::

> [!CHECK]
> With zero outbound rules, `t_ssh` still says **SSH OK**: the security group remembers that you opened the connection and lets the replies out automatically. `t_web` shows **DNS OK** and **HTTPS BLOCKED**, because the bastion starting a *new* outbound connection does need an outbound rule. Stateful versus stateless in one experiment.

### Step 9: Put the subnet back on the default network ACL

:::console
1. In the **VPC** console choose **Subnets**, select `demo-public-a`, and choose **Actions** → **Edit network ACL association**.
2. For **Network ACL ID** choose the default ACL of `demo-vpc` and choose **Save**.
:::

:::cli
```bash
aws ec2 replace-network-acl-association --association-id "$(nacl_assoc "$PUB_A")" --network-acl-id "$DEFAULT_NACL"
t_ssh
```
:::

> [!CHECK]
> In **Network ACLs**, `demo-public-nacl` shows **Associated with** `-` (no subnets), and `t_ssh` still works under the default ACL. A custom network ACL can only be deleted once no subnet uses it.

## Cleanup

This removes everything from labs 01 and 03. If you also still have lab 02 resources (NAT gateways, Elastic IPs, `demo-nat`), delete `demo-public-nacl` as below and then follow **lab 02's Cleanup** instead of the remaining items. If your CloudShell session restarted, run the reload block from **Prerequisites** first, plus `NACL_ID=$(aws ec2 describe-network-acls --filters Name=tag:Name,Values=demo-public-nacl --query 'NetworkAcls[0].NetworkAclId' --output text)`.

- [ ] **Network ACL `demo-public-nacl`** (after Step 9 removed its association): VPC console → **Network ACLs** → select → **Actions** → **Delete network ACLs** → type `delete` → **Delete**. CLI: `aws ec2 delete-network-acl --network-acl-id "$NACL_ID"`. Its rules are deleted with it.
- [ ] **Instances `demo-bastion` and `demo-app`**: EC2 console → **Instances** → select both → **Instance state** → **Terminate (delete) instance** → **Terminate (delete)**. CLI: `aws ec2 terminate-instances --instance-ids "$BASTION_ID" "$APP_ID"` then `aws ec2 wait instance-terminated --instance-ids "$BASTION_ID" "$APP_ID"`.
- [ ] **Key pair `demo-key`**: EC2 console → **Key Pairs** → select → **Actions** → **Delete** → type `Delete` → **Delete**. CLI: `aws ec2 delete-key-pair --key-name demo-key`; then `rm -f ~/demo-key.pem` in CloudShell.
- [ ] **Security groups `demo-app-sg`, then `demo-bastion-sg`**: EC2 console → **Security Groups** → select → **Actions** → **Delete security groups** → **Delete**. CLI: `aws ec2 delete-security-group --group-id "$APP_SG"` then `aws ec2 delete-security-group --group-id "$BASTION_SG"`. (Console users can skip this: deleting the VPC removes them.)
- [ ] **VPC `demo-vpc`** with subnets `demo-public-a`, `demo-public-b`, `demo-private-a`, `demo-private-b`, route tables `demo-public-rt` and `demo-private-rt`, and internet gateway `demo-igw`: VPC console → **Your VPCs** → select → **Actions** → **Delete VPC** → type `delete` → **Delete**. CLI, in this order:

```bash
for S in "$PUB_A" "$PUB_B" "$PRIV_A" "$PRIV_B"; do aws ec2 delete-subnet --subnet-id "$S"; done
aws ec2 delete-route-table --route-table-id "$PUB_RT"
aws ec2 delete-route-table --route-table-id "$PRIV_RT"
aws ec2 detach-internet-gateway --internet-gateway-id "$IGW_ID" --vpc-id "$VPC_ID"
aws ec2 delete-internet-gateway --internet-gateway-id "$IGW_ID"
aws ec2 delete-vpc --vpc-id "$VPC_ID"
```

- [ ] **Final check**: **Network ACLs** and **Your VPCs** no longer show any `demo-*` entries, and **Instances** shows no running `demo-*` instances in this Region. The next day, **Billing and Cost Management** → **Bills** shows no new EC2 charges.

## Progress checklist

- [ ] Step 1: Inspected the default network ACL (allow all, then `*` deny)
- [ ] Step 2: Attached a new custom network ACL and saw all traffic blocked
- [ ] Step 3: Allowed inbound SSH and saw it still fail without a reply rule
- [ ] Step 4: Allowed outbound ephemeral ports and got SSH working
- [ ] Step 5: Enabled outbound HTTPS with an inbound ephemeral-port rule
- [ ] Step 6: Allowed SSH from the bastion to the private subnet
- [ ] Step 7: Saw a deny rule win at number 90 and lose at number 150
- [ ] Step 8: Showed that a security group with no outbound rules still returns replies
- [ ] Step 9: Moved the subnet back to the default network ACL
- [ ] Cleanup done for labs 01 and 03 (or lab 02's cleanup completed)
