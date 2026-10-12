---
id: 30-threat-protection-lab-01
title: Protect an API Gateway REST API with an AWS WAF web ACL
objective: Build a tiny mock REST API, put a Regional web ACL in front of it with an IP set rule, a custom header rule, a rate-based rule and the AWS managed core rule set, then watch requests get counted, blocked and sampled.
estimatedTime: 50 minutes
cost: "About USD 0.03 if you delete everything within two hours: the web ACL (USD 5 per month) and four rules (USD 1 per month each) are prorated hourly, plus USD 0.60 per million inspected requests. The few hundred API Gateway calls cost a fraction of a cent and can be covered by Free Tier credits."
freeTier: partial
services: [waf, api-gateway]
---

> [!COST]
> AWS WAF has no Always Free allowance. In this lab you pay for one web ACL (USD 5.00 per month) and four rules or rule groups (USD 1.00 per month each), all prorated by the hour, which is roughly USD 0.012 per hour in total, plus USD 0.60 per million requests inspected. The AWS managed core rule set adds no extra fee beyond its USD 1.00 rule charge, and the web ACL stays below 1,500 capacity units, so no extra per-request surcharge applies. API Gateway REST API calls cost USD 3.50 per million. Delete the web ACL in the **Cleanup** section as soon as you finish; a forgotten one keeps billing about USD 9 per month.

The lab uses an API Gateway REST API with a **mock integration** as the protected resource: it answers requests without any backend, so there is no load balancer or instance billing by the hour. The WAF concepts are identical for an Application Load Balancer or a CloudFront distribution (for CloudFront you would create the web ACL in the global scope, us-east-1).

## Prerequisites

- An AWS account with permissions for API Gateway and AWS WAF (for example the `AmazonAPIGatewayAdministrator` and `AWSWAFFullAccess` managed policies, or administrator access in a sandbox account).
- One Region for everything. The examples use `us-east-1`; any Region where AWS WAF is available works, but the web ACL, the IP set and the API **must** all be in the same Region.
- A Bash terminal with `curl` to send test requests. **AWS CloudShell** is the easiest choice: it already has the AWS CLI v2 and `curl`, and the CLI tabs below assume GNU tools as found in CloudShell. Keep the same terminal open for the whole lab; later commands reuse shell variables.
- The CLI tabs need **AWS CLI v2** (the `--cli-binary-format` option used in Step 3 does not exist in v1).

> [!WARNING]
> Send the test requests from the **same machine** whose public IP you put in the IP set in Step 2. If you build the web ACL in the console but run `curl` in CloudShell, the IP set must contain the CloudShell address, not your laptop's.

## Steps

### Step 1: Create a mock REST API and deploy it

:::console
1. Open the **API Gateway** console and choose **Create API**. Under **REST API**, choose **Build** (if a **Create Example API** pop-up appears, choose **OK** and continue).
2. For **API name** enter `waf-lab-api`, keep **API endpoint type** set to **Regional**, keep **IP address type** at **IPv4**, and choose **Create API**.
3. With the root resource `/` selected, choose **Create method**. For **Method type** choose **GET**, for **Integration type** choose **Mock**, then choose **Create method**.
4. Open the **Integration request** tab and check the **Mapping templates** section: there should be a template for `application/json` whose body is `{"statusCode": 200}`. If it is missing, choose **Edit**, add it, and save.
5. Open the **Integration response** tab, choose **Edit** on **Default - Response**, expand **Mapping templates**, add (or edit) the template for content type `application/json` with this body, and choose **Save**:

   ```json
   {"message": "hello from waf-lab-api"}
   ```

6. Choose **Deploy API**. For **Stage** choose **New stage**, enter the **Stage name** `prod`, and choose **Deploy**.
7. Under **Stage details**, copy the **Invoke URL**. In your terminal, store it in a variable, for example `URL="https://abc123.execute-api.us-east-1.amazonaws.com/prod"`.
:::

:::cli
```bash
REGION=${AWS_REGION:-$(aws configure get region)}
API_ID=$(aws apigateway create-rest-api --name waf-lab-api \
  --endpoint-configuration types=REGIONAL --query id --output text)
ROOT_ID=$(aws apigateway get-resources --rest-api-id "$API_ID" \
  --query 'items[?path==`/`].id' --output text)

aws apigateway put-method --rest-api-id "$API_ID" --resource-id "$ROOT_ID" \
  --http-method GET --authorization-type NONE
aws apigateway put-integration --rest-api-id "$API_ID" --resource-id "$ROOT_ID" \
  --http-method GET --type MOCK \
  --request-templates '{"application/json":"{\"statusCode\": 200}"}'
aws apigateway put-method-response --rest-api-id "$API_ID" --resource-id "$ROOT_ID" \
  --http-method GET --status-code 200
aws apigateway put-integration-response --rest-api-id "$API_ID" --resource-id "$ROOT_ID" \
  --http-method GET --status-code 200 \
  --response-templates '{"application/json":"{\"message\": \"hello from waf-lab-api\"}"}'

aws apigateway create-deployment --rest-api-id "$API_ID" --stage-name prod
URL="https://$API_ID.execute-api.$REGION.amazonaws.com/prod"
echo "$URL"
```
:::

Now call the API twice: once to see the body and once to see only the status code.

```bash
curl -s "$URL"; echo
curl -s -o /dev/null -w "%{http_code}\n" "$URL"
```

> [!CHECK]
> The first command prints `{"message": "hello from waf-lab-api"}` and the second prints `200`. Nothing is filtering the API yet.

### Step 2: Create an IP set that contains your public IP address

An IP set is a reusable list of addresses (up to 10,000 CIDR ranges) that rules reference. You will use it later to simulate a deny list.

First find the public IPv4 address of the machine that runs `curl`:

```bash
curl -s https://checkip.amazonaws.com
```

:::console
1. Open the **AWS WAF** console at `https://console.aws.amazon.com/wafv2/homev2`. If it opens in the new console experience (pages that talk about **protection packs**), open the standard experience from the navigation pane; both create the same WAFv2 resources, and the standard one walks through each rule step by step, which is what the steps below follow.
2. In the navigation pane choose **IP sets**, then **Create IP set**.
3. **IP set name**: `waf-lab-my-ip`. For **Region**, choose the Region of your API (not **Global (CloudFront)**).
4. **IP version**: **IPv4**. In **IP addresses**, enter your address followed by `/32`, for example `203.0.113.25/32`.
5. Choose **Create IP set**.
:::

:::cli
```bash
MY_IP=$(curl -s https://checkip.amazonaws.com)
read IPSET_ID IPSET_ARN < <(aws wafv2 create-ip-set --name waf-lab-my-ip \
  --scope REGIONAL --ip-address-version IPV4 --addresses "$MY_IP/32" \
  --query 'Summary.[Id,ARN]' --output text)
echo "$IPSET_ID $IPSET_ARN"
```
:::

> [!CHECK]
> The IP set `waf-lab-my-ip` appears in the list for your Region with one address ending in `/32`. Its ARN contains `:regional/ipset/`.

### Step 3: Create the web ACL with four rules and attach it to the API stage

You will create a web ACL whose **default action is Allow** and add, in priority order:

| Priority | Rule | Type | Action | Purpose |
|---|---|---|---|---|
| 0 | `block-my-ip` | IP set match | **Count** (for now) | Shows how a new rule is tested safely before blocking |
| 1 | `block-test-header` | String match on header `x-lab-test` | Block | A custom layer 7 rule on request content |
| 2 | `rate-limit-per-ip` | Rate-based, 10 requests per 1 minute per source IP | Block | A miniature HTTP flood defence |
| 3 | Core rule set | AWS managed rule group (`AWSManagedRulesCommonRuleSet`) | Rule group defaults | OWASP-style protections maintained by AWS |

:::console
1. In the AWS WAF console navigation pane, choose **Web ACLs** (newer pages may label it **protection packs (web ACLs)**), make sure your API's Region is selected, and choose **Create web ACL**.
2. For **Resource type**, choose **Regional resources**. For **Name** enter `waf-lab-acl`; keep the suggested **CloudWatch metric name**.
3. Under **Associated AWS resources - optional**, choose **Add AWS resources**, choose the API Gateway resource type, select the `waf-lab-api` API with stage `prod`, and choose **Add**. Choose **Next**.
4. On **Add rules and rule groups**, choose **Add rules** → **Add my own rules and rule groups** → **Rule builder** (visual editor) and create the first rule:
   - **Name** `block-my-ip`, **Type** **Regular rule**, **If a request** **matches the statement**.
   - **Inspect**: **Originates from an IP address in**; **IP set**: `waf-lab-my-ip`; use the **Source IP address**.
   - **Action**: **Count**. Choose **Add rule**.
5. Choose **Add rules** → **Add my own rules and rule groups** again for the second rule:
   - **Name** `block-test-header`, **Type** **Regular rule**, **matches the statement**.
   - **Inspect**: **Single header**, header name `x-lab-test`; **Match type**: **Exactly matches string**; **String to match**: `attack`; **Text transformation**: **None**.
   - **Action**: **Block**. Choose **Add rule**.
6. Add the third rule the same way:
   - **Name** `rate-limit-per-ip`, **Type** **Rate-based rule**.
   - **Rate limit** `10`, **Evaluation window** **1 minute**, **Request aggregation** **Source IP address**, and in **Scope of inspection and rate limiting** choose to consider all requests.
   - **Action**: **Block**. Choose **Add rule**.
7. Choose **Add rules** → **Add managed rule groups**, expand **AWS managed rule groups**, turn on **Add to web ACL** for **Core rule set**, and choose **Add rules**.
8. Under the default web ACL action for requests that don't match any rules, keep **Allow**. Note the capacity units used: a little over 700 of the 1,500 included (the core rule set alone uses 700). Choose **Next**.
9. On **Set rule priority**, order the rules as in the table above (`block-my-ip` first, the core rule set last) with **Move up** / **Move down**. Choose **Next**.
10. On **Configure metrics**, keep the defaults (CloudWatch metrics and request sampling on). Choose **Next**, review, and choose **Create web ACL**.
:::

:::cli
```bash
cat > rules.json <<EOF
[
  {
    "Name": "block-my-ip",
    "Priority": 0,
    "Statement": { "IPSetReferenceStatement": { "ARN": "$IPSET_ARN" } },
    "Action": { "Count": {} },
    "VisibilityConfig": { "SampledRequestsEnabled": true, "CloudWatchMetricsEnabled": true, "MetricName": "block-my-ip" }
  },
  {
    "Name": "block-test-header",
    "Priority": 1,
    "Statement": {
      "ByteMatchStatement": {
        "SearchString": "attack",
        "FieldToMatch": { "SingleHeader": { "Name": "x-lab-test" } },
        "TextTransformations": [ { "Priority": 0, "Type": "NONE" } ],
        "PositionalConstraint": "EXACTLY"
      }
    },
    "Action": { "Block": {} },
    "VisibilityConfig": { "SampledRequestsEnabled": true, "CloudWatchMetricsEnabled": true, "MetricName": "block-test-header" }
  },
  {
    "Name": "rate-limit-per-ip",
    "Priority": 2,
    "Statement": { "RateBasedStatement": { "Limit": 10, "EvaluationWindowSec": 60, "AggregateKeyType": "IP" } },
    "Action": { "Block": {} },
    "VisibilityConfig": { "SampledRequestsEnabled": true, "CloudWatchMetricsEnabled": true, "MetricName": "rate-limit-per-ip" }
  },
  {
    "Name": "aws-core-rule-set",
    "Priority": 3,
    "Statement": { "ManagedRuleGroupStatement": { "VendorName": "AWS", "Name": "AWSManagedRulesCommonRuleSet" } },
    "OverrideAction": { "None": {} },
    "VisibilityConfig": { "SampledRequestsEnabled": true, "CloudWatchMetricsEnabled": true, "MetricName": "aws-core-rule-set" }
  }
]
EOF

# raw-in-base64-out lets you type SearchString as plain text instead of base64.
read ACL_ID ACL_ARN < <(aws wafv2 create-web-acl --name waf-lab-acl --scope REGIONAL \
  --default-action Allow={} \
  --visibility-config SampledRequestsEnabled=true,CloudWatchMetricsEnabled=true,MetricName=waf-lab-acl \
  --rules file://rules.json --cli-binary-format raw-in-base64-out \
  --query 'Summary.[Id,ARN]' --output text)

STAGE_ARN="arn:aws:apigateway:$REGION::/restapis/$API_ID/stages/prod"
aws wafv2 associate-web-acl --web-acl-arn "$ACL_ARN" --resource-arn "$STAGE_ARN"
aws wafv2 get-web-acl-for-resource --resource-arn "$STAGE_ARN" --query WebACL.Name
```
:::

> [!TIP]
> You can also attach a web ACL from the API side: in the API Gateway console choose **Stages** → `prod` → **Stage details** → **Edit**, pick the web ACL under **Web application firewall (AWS WAF)** and choose **Save changes**. Either way, a resource can carry only **one** web ACL at a time.

> [!CHECK]
> The web ACL's **Associated AWS resources** tab lists the `prod` stage of `waf-lab-api` (the CLI prints `"waf-lab-acl"`). The **Rules** tab shows four entries in the order 0 to 3.

### Step 4: Test the rules that read request content

Wait about a minute for the association to take effect, then send four requests. Keep this step under ten requests per minute so the rate-based rule does not interfere yet.

```bash
code() { curl -s -o /dev/null -w "%{http_code}\n" "$@"; }

code "$URL"                                                    # a normal request
code -H "x-lab-test: attack" "$URL"                            # matches block-test-header
code -H "User-Agent:" "$URL"                                   # curl sends no User-Agent at all
code -G --data-urlencode 'q=<script>alert(1)</script>' "$URL"  # script tag in the query string
curl -s -H "x-lab-test: attack" "$URL"; echo                   # the body of a blocked request
```

> [!CHECK]
> You see `200`, then `403` three times, then `{"message":"Forbidden"}`. The first 403 comes from your own string match rule; the next two come from the core rule set, which blocks requests without a `User-Agent` header and requests whose query arguments contain cross-site scripting patterns. Security groups could never do this: they cannot read headers or query strings.

### Step 5: Trigger the rate-based rule

Send about one request per second for 90 seconds, which is far above the limit of 10 requests per minute:

```bash
for i in $(seq 1 90); do
  printf '%s %s\n' "$(date +%T)" "$(curl -s -o /dev/null -w '%{http_code}' "$URL")"
  sleep 1
done
```

AWS WAF re-checks request rates frequently but not instantly, and it enforces the limit approximately rather than at exactly the tenth request. Expect a run of `200` responses, then `403` responses once WAF has noticed that your address is over the limit. When the loop ends, wait two or three minutes and call the API again with `code "$URL"`.

> [!CHECK]
> The output switches from `200` to `403` partway through the loop, and a few minutes after the loop ends a single request returns `200` again: a rate-based rule blocks a client only while its rate stays above the limit, with no list for you to maintain.

### Step 6: Read the sampled requests, then turn the IP set rule into a deny list

:::console
1. In the AWS WAF console open **Web ACLs** → `waf-lab-acl` and choose the **Sampled requests** tab. The table covers the last three hours. Look for:
   - rows with metric name `block-test-header` or `rate-limit-per-ip` and action **BLOCK**;
   - rows for the core rule set whose **Rule inside rule group** is `NoUserAgent_HEADER` or `CrossSiteScripting_QUERYARGUMENTS`;
   - rows for `block-my-ip` with action **COUNT**: every request from your address matched it, but nothing was blocked.
2. Open the **Traffic overview** tab to see the same activity as dashboards built from the CloudWatch metrics.
3. Now switch the IP rule to blocking: choose the **Rules** tab, select `block-my-ip`, choose **Edit**, change **Action** to **Block**, choose **Save rule**, and save the web ACL if asked.
4. Wait about a minute and run `code "$URL"` in your terminal.
:::

:::cli
```bash
END=$(date -u +%Y-%m-%dT%H:%M:%SZ)
START=$(date -u -d '-2 hours' +%Y-%m-%dT%H:%M:%SZ)   # GNU date, as in CloudShell
for RULE in block-test-header rate-limit-per-ip block-my-ip; do
  echo "== $RULE"
  aws wafv2 get-sampled-requests --web-acl-arn "$ACL_ARN" --rule-metric-name "$RULE" \
    --scope REGIONAL --time-window StartTime=$START,EndTime=$END --max-items 5 \
    --query 'SampledRequests[].[Request.ClientIP,Request.URI,Action]' --output text
done

# Editing a rule means sending the whole rule list back with the current lock token.
# Only block-my-ip uses Count, so this sed changes exactly that rule.
LOCK=$(aws wafv2 get-web-acl --name waf-lab-acl --scope REGIONAL --id "$ACL_ID" \
  --query LockToken --output text)
sed -i 's/"Count": {}/"Block": {}/' rules.json
aws wafv2 update-web-acl --name waf-lab-acl --scope REGIONAL --id "$ACL_ID" \
  --lock-token "$LOCK" --default-action Allow={} \
  --visibility-config SampledRequestsEnabled=true,CloudWatchMetricsEnabled=true,MetricName=waf-lab-acl \
  --rules file://rules.json --cli-binary-format raw-in-base64-out
sleep 60
code "$URL"
```
:::

> [!CHECK]
> Even a perfectly normal request now returns `403`, because your address is in the IP set and the rule at priority 0 blocks it before any other rule runs. This is the pattern for blocking a list of known bad addresses; for more than 10,000 ranges you would add more IP sets.

> [!TIP]
> Starting new rules in **Count** and switching to **Block** after checking the sampled requests is the recommended way to roll out WAF changes on production traffic, so a badly written rule never locks out real users.

## Cleanup

Delete in this order (the web ACL must be detached before deletion, and the IP set cannot be deleted while a web ACL references it):

- [ ] **Web ACL association with the `prod` stage**: web ACL `waf-lab-acl` → **Associated AWS resources** tab → select the stage → **Disassociate**. CLI: `aws wafv2 disassociate-web-acl --resource-arn "$STAGE_ARN"`.
- [ ] **Web ACL `waf-lab-acl`** (this also deletes its four rules): **Web ACLs** → select it → **Delete** and confirm. CLI: `aws wafv2 delete-web-acl --name waf-lab-acl --scope REGIONAL --id "$ACL_ID" --lock-token "$(aws wafv2 get-web-acl --name waf-lab-acl --scope REGIONAL --id "$ACL_ID" --query LockToken --output text)"`.
- [ ] **IP set `waf-lab-my-ip`**: **IP sets** → select it → **Delete** and confirm. CLI: `aws wafv2 delete-ip-set --name waf-lab-my-ip --scope REGIONAL --id "$IPSET_ID" --lock-token "$(aws wafv2 get-ip-set --name waf-lab-my-ip --scope REGIONAL --id "$IPSET_ID" --query LockToken --output text)"`.
- [ ] **REST API `waf-lab-api`** (removes its method, deployment and `prod` stage): API Gateway console → open `waf-lab-api` → on the **Resources** page choose **API actions** → **Delete API**, enter `confirm`, and choose **Delete**. CLI: `aws apigateway delete-rest-api --rest-api-id "$API_ID"`.
- [ ] **Local file `rules.json`** (CLI path): `rm rules.json`.
- [ ] **Final check**: `aws wafv2 list-web-acls --scope REGIONAL` and `aws wafv2 list-ip-sets --scope REGIONAL` no longer show the lab resources, `aws apigateway get-rest-apis --query 'items[].name'` does not list `waf-lab-api`, and the next day **Billing and Cost Management** → **Bills** shows no new AWS WAF charges. The WAF CloudWatch metrics simply stop and need no cleanup.

## Progress checklist

- [ ] Step 1: Deployed `waf-lab-api` with a mock GET method and got a 200 response
- [ ] Step 2: Created the IP set `waf-lab-my-ip` with my public address
- [ ] Step 3: Created `waf-lab-acl` with four rules and associated it with the `prod` stage
- [ ] Step 4: Saw the custom header rule and the core rule set return 403
- [ ] Step 5: Watched the rate-based rule start and stop blocking my address
- [ ] Step 6: Read the sampled requests and turned the Count rule into a Block rule
- [ ] Cleanup done
