---
id: 07-elb-lab-02
title: ALB listener rules, sticky sessions and deregistration delay
objective: Extend the lab 01 ALB with path, query-string and redirect rules, then observe sticky session cookies and connection draining on a target group.
estimatedTime: 40 minutes
cost: "About USD 0.07 per hour in us-east-1 for the lab 01 resources that keep running (ALB, two t3.micro instances, public IPv4 addresses); listener rules and an extra target group add nothing measurable. Free Tier credits or the legacy Free Tier can cover most of it."
freeTier: partial
services: [alb, elb, ec2]
---

> [!COST]
> This lab adds no new hourly resources, but it keeps the lab 01 ALB (USD 0.0225 per hour plus LCUs), two `t3.micro` instances and four public IPv4 addresses (USD 0.005 per hour each) running. Finish with the **Cleanup** section, which removes everything from both labs.

You will turn the single default rule from lab 01 into a small routing table, then explore two target group attributes that show up in exam questions: stickiness and deregistration delay.

## Prerequisites

- Lab 01 completed **without** its cleanup: `demo-alb`, `demo-web-tg`, `web-a`, `web-b`, `demo-alb-sg` and `demo-web-sg` exist and both targets are healthy.
- The same IAM permissions and Region as lab 01.
- For the CLI tabs, a Bash shell (CloudShell works). If you opened a new terminal since lab 01, reload the variables with the block below.

```bash
VPC_ID=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)
ALB_ARN=$(aws elbv2 describe-load-balancers --names demo-alb --query 'LoadBalancers[0].LoadBalancerArn' --output text)
LISTENER_ARN=$(aws elbv2 describe-listeners --load-balancer-arn "$ALB_ARN" --query 'Listeners[0].ListenerArn' --output text)
TG_ARN=$(aws elbv2 describe-target-groups --names demo-web-tg --query 'TargetGroups[0].TargetGroupArn' --output text)
DNS=$(aws elbv2 describe-load-balancers --load-balancer-arns "$ALB_ARN" --query 'LoadBalancers[0].DNSName' --output text)
I1=$(aws ec2 describe-instances --filters Name=tag:Name,Values=web-a Name=instance-state-name,Values=running --query 'Reservations[0].Instances[0].InstanceId' --output text)
I2=$(aws ec2 describe-instances --filters Name=tag:Name,Values=web-b Name=instance-state-name,Values=running --query 'Reservations[0].Instances[0].InstanceId' --output text)
echo "$ALB_ARN $TG_ARN $I1 $I2"
```

## Steps

### Step 1: Create a second target group for the API

This target group contains only `web-b`, so you can tell at a glance whether a request was routed by your new rule.

:::console
1. In the EC2 console choose **Target Groups** → **Create target group**.
2. **Choose a target type**: **Instances**. **Target group name**: `demo-api-tg`. Keep **Protocol** `HTTP`, **Port** `80`, the default **VPC** and **Protocol version** **HTTP1**.
3. Under **Health checks**, set **Health check path** to `/health`.
4. Choose **Next**, select only `web-b`, choose **Include as pending below**, then **Create target group**.
:::

:::cli
```bash
API_TG_ARN=$(aws elbv2 create-target-group --name demo-api-tg \
  --protocol HTTP --port 80 --vpc-id "$VPC_ID" --target-type instance \
  --health-check-path /health \
  --query 'TargetGroups[0].TargetGroupArn' --output text)
aws elbv2 register-targets --target-group-arn "$API_TG_ARN" --targets Id="$I2"
```
:::

### Step 2: Add a path-based rule for /api/*

:::console
1. Choose **Load Balancers**, select `demo-alb`, and open the **Listeners and rules** tab.
2. Choose the **HTTP:80** text in the **Protocol:Port** column to open the listener, then on the **Rules** tab choose **Add rule**.
3. Expand **Name and tags** and enter `api-path`.
4. Choose **Add condition**, pick **Path**, keep value matching, enter `/api/*`, and confirm.
5. For **Routing action**, choose **Forward to target groups** and select `demo-api-tg`. Choose **Next**.
6. For **Priority**, enter `10`. Choose **Next**, then **Create** on the **Review and create** page.
:::

:::cli
```bash
aws elbv2 create-rule --listener-arn "$LISTENER_ARN" --priority 10 \
  --conditions Field=path-pattern,Values='/api/*' \
  --actions Type=forward,TargetGroupArn="$API_TG_ARN"
for i in 1 2 3 4; do curl -s "http://$DNS/api/"; done
```
:::

> [!CHECK]
> Once `demo-api-tg` shows `web-b` as **Healthy**, every request to `http://<DNS name>/api/` answers "API answer from" the **same** instance ID (`web-b`), while `http://<DNS name>/` still alternates between both instances through the default rule.

### Step 3: Add a query-string rule with a fixed response

:::console
1. On the listener's **Rules** tab choose **Add rule**; name it `mobile-query`.
2. Choose **Add condition** → **Query string**, enter key `platform` and value `mobile`.
3. For **Routing action**, choose **Return fixed response**, set **Response code** to `200`, **Content type** to `text/plain`, and **Response body** to `Mobile site coming soon`. Choose **Next**.
4. **Priority**: `20`. Choose **Next**, then **Create**.
:::

:::cli
```bash
aws elbv2 create-rule --listener-arn "$LISTENER_ARN" --priority 20 \
  --conditions '[{"Field":"query-string","QueryStringConfig":{"Values":[{"Key":"platform","Value":"mobile"}]}}]' \
  --actions '[{"Type":"fixed-response","FixedResponseConfig":{"StatusCode":"200","ContentType":"text/plain","MessageBody":"Mobile site coming soon"}}]'
curl -s "http://$DNS/?platform=mobile"; echo
curl -s "http://$DNS/?platform=desktop"; echo
```
:::

> [!CHECK]
> `?platform=mobile` returns the plain text "Mobile site coming soon" without touching any instance; `?platform=desktop` falls through to the default rule and shows the usual instance page.

### Step 4: Add a redirect rule

:::console
1. Choose **Add rule**; name it `old-docs-redirect`.
2. **Add condition** → **Path** → `/old-docs`.
3. For **Routing action**, choose **Redirect to URL**. On the **Full URL** tab enter `https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html`, and for **Status code** choose the permanent option (HTTP 301). Choose **Next**.
4. **Priority**: `30`. Choose **Next**, then **Create**.
:::

:::cli
```bash
aws elbv2 create-rule --listener-arn "$LISTENER_ARN" --priority 30 \
  --conditions Field=path-pattern,Values='/old-docs' \
  --actions '[{"Type":"redirect","RedirectConfig":{"Protocol":"HTTPS","Port":"443","Host":"docs.aws.amazon.com","Path":"/elasticloadbalancing/latest/application/introduction.html","StatusCode":"HTTP_301"}}]'
curl -sI "http://$DNS/old-docs" | grep -iE '^(HTTP|location)'
```
:::

> [!CHECK]
> Opening `http://<DNS name>/old-docs` lands on the AWS documentation page. `curl -I` shows `HTTP/1.1 301 Moved Permanently` and a `Location:` header pointing at docs.aws.amazon.com. The listener's **Rules** tab now lists priorities 10, 20 and 30 above the **Default** rule.

### Step 5: Turn on duration-based sticky sessions

:::console
1. Choose **Target Groups** → `demo-web-tg` → **Attributes** tab → **Edit**.
2. Under **Target selection configuration**, select **Turn on stickiness**.
3. For **Stickiness type**, choose **Load balancer generated cookie**; set **Stickiness duration** to `2` minutes.
4. Choose **Save changes**.
5. Refresh `http://<DNS name>/` in your browser several times. Then open a private (incognito) window and load it again.
:::

:::cli
```bash
aws elbv2 modify-target-group-attributes --target-group-arn "$TG_ARN" \
  --attributes Key=stickiness.enabled,Value=true \
               Key=stickiness.type,Value=lb_cookie \
               Key=stickiness.lb_cookie.duration_seconds,Value=120

# Without cookies: requests still alternate.
for i in 1 2 3 4; do curl -s "http://$DNS/"; echo; done
# With a cookie jar: the AWSALB cookie pins you to one instance.
rm -f cookies.txt
for i in 1 2 3 4; do curl -s -c cookies.txt -b cookies.txt "http://$DNS/"; echo; done
grep AWSALB cookies.txt
```
:::

> [!CHECK]
> In the browser every refresh shows the **same** instance. The ALB resets the cookie's expiry on every response, so you stay pinned until you stop refreshing for more than the 2-minute duration; the private window (no cookie yet) may land on the other instance. With curl, plain requests alternate but cookie-jar requests repeat one instance, and `cookies.txt` contains `AWSALB` and `AWSALBCORS` entries.

### Step 6: Watch connection draining with a short deregistration delay

:::console
1. On `demo-web-tg` → **Attributes** → **Edit**, find **Target deregistration management** and set **Deregistration delay** to `20` seconds. Under **Target selection configuration**, turn stickiness **off** again so traffic spreads normally. Choose **Save changes**.
2. Open the **Targets** tab, select `web-a`, choose **Deregister**, and confirm with **Deregister**.
3. Refresh the **Targets** tab every few seconds and refresh the ALB page in your browser.
4. When `web-a` has disappeared from the list, choose **Register targets**, select `web-a`, choose **Include as pending below**, then **Register pending targets**.
:::

:::cli
```bash
aws elbv2 modify-target-group-attributes --target-group-arn "$TG_ARN" \
  --attributes Key=deregistration_delay.timeout_seconds,Value=20 \
               Key=stickiness.enabled,Value=false
aws elbv2 deregister-targets --target-group-arn "$TG_ARN" --targets Id="$I1"
for i in 1 2 3 4 5 6; do
  aws elbv2 describe-target-health --target-group-arn "$TG_ARN" \
    --query 'TargetHealthDescriptions[].[Target.Id,TargetHealth.State]' --output text
  sleep 5
done
aws elbv2 register-targets --target-group-arn "$TG_ARN" --targets Id="$I1"
```
:::

> [!CHECK]
> Right after deregistering, `web-a` shows **Draining** and new requests go only to `web-b`. About 20 seconds later `web-a` drops off the list (with the default 300 seconds you would wait 5 minutes). After you register it again it passes through **Initial** to **Healthy** and traffic alternates again.

## Cleanup

This removes everything from labs 01 and 02. Delete in this order:

- [ ] **Listener rules** `api-path`, `mobile-query`, `old-docs-redirect`: they are deleted automatically with the load balancer in the next item (to remove them individually: select the rule on the listener's **Rules** tab and delete it from the **Actions** menu; CLI `aws elbv2 delete-rule --rule-arn <arn>`).
- [ ] **Load balancer `demo-alb`** (and its HTTP:80 listener): **Load Balancers** → select → **Actions** → **Delete load balancer**, enter `confirm`, choose **Delete**. CLI: `aws elbv2 delete-load-balancer --load-balancer-arn "$ALB_ARN"`.
- [ ] **Target group `demo-api-tg`**: **Target Groups** → select → **Actions** → **Delete** → **Delete**. CLI: `aws elbv2 delete-target-group --target-group-arn "$API_TG_ARN"`.
- [ ] **Target group `demo-web-tg`**: same steps. CLI: `aws elbv2 delete-target-group --target-group-arn "$TG_ARN"`.
- [ ] **Instances `web-a` and `web-b`**: **Instances** → select both → **Instance state** → **Terminate (delete) instance**. CLI: `aws ec2 terminate-instances --instance-ids "$I1" "$I2"` then `aws ec2 wait instance-terminated --instance-ids "$I1" "$I2"`.
- [ ] **Security group `demo-web-sg`**, then **`demo-alb-sg`**: **Security Groups** → select → **Actions** → **Delete security groups** (retry after a few minutes if the ALB's network interfaces still exist). CLI: `aws ec2 delete-security-group --group-id <id>` for each (look up IDs with `aws ec2 describe-security-groups --filters Name=group-name,Values=demo-web-sg,demo-alb-sg --query 'SecurityGroups[].[GroupName,GroupId]' --output text`).
- [ ] **Local files** `cookies.txt` and `user-data.sh` (CLI path only).
- [ ] **Final check**: no load balancers, no `demo-*` target groups and no running instances remain in this Region; next day, **Billing and Cost Management** → **Bills** shows no new Elastic Load Balancing usage.

## Progress checklist

- [ ] Step 1: Created `demo-api-tg` with only `web-b`
- [ ] Step 2: Path rule `/api/*` always reaches `web-b`
- [ ] Step 3: Query-string rule returns a fixed response
- [ ] Step 4: Redirect rule returns HTTP 301 to the AWS docs
- [ ] Step 5: Saw the `AWSALB` cookie pin a browser to one instance
- [ ] Step 6: Watched a target drain for 20 seconds and re-registered it
- [ ] Cleanup done for labs 01 and 02
