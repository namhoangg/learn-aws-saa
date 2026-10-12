---
id: 21-dynamodb-apigw-cognito-lab-02
title: Build a serverless CRUD API with API Gateway, Lambda and DynamoDB
objective: Create a DynamoDB table, a Python Lambda function and an API Gateway HTTP API with four routes, then create, list, read and delete items over HTTPS with curl.
estimatedTime: 45 minutes
cost: "Well under USD 0.01: a few dozen HTTP API calls, Lambda invocations and on-demand DynamoDB requests. Lambda is Always Free at this volume; API Gateway calls are covered by the 12-month Free Tier on legacy accounts or by Free Tier credits on new accounts."
freeTier: partial
services: [api-gateway, lambda, dynamodb, iam, cloudwatch-logs, cloudshell]
---

This lab builds the classic serverless backend from the lesson: **client → API Gateway → Lambda → DynamoDB**. One Lambda function handles four routes (`PUT /items`, `GET /items`, `GET /items/{id}`, `DELETE /items/{id}`), and the HTTP API proxies every request to it. Nothing runs when nobody calls the API.

> [!COST]
> Lambda includes 1 million requests and 400,000 GB-seconds per month in its Always Free tier. HTTP API calls cost USD 1.00 per million after the API Gateway Free Tier (1 million HTTP API calls per month for 12 months on legacy accounts; new accounts use Free Tier credits). DynamoDB on-demand requests are not in the Always Free allowance but cost fractions of a cent here. CloudWatch Logs stores a few kilobytes of function logs. Expect a total well under one cent if you clean up afterwards.

## Prerequisites

- An AWS account and an IAM identity that can manage DynamoDB, Lambda, API Gateway, IAM roles and CloudWatch Logs (for example an administrator in a sandbox account).
- One Region for the whole lab.
- `curl` to call the API. **AWS CloudShell** has it, together with the AWS CLI v2 and `zip`. Keep one terminal open, because later commands reuse shell variables.

## Steps

### Step 1: Create the DynamoDB table

:::console
1. Open the **DynamoDB** console, choose **Tables**, then **Create table**.
2. For **Table name**, enter `demo-items`.
3. For **Partition key**, enter `id` (type **String**). Leave **Sort key** empty.
4. For **Table settings**, choose **Customize settings**, then under **Read/write capacity settings** choose **On-demand** (the same reasoning as in lab 01: pick the mode explicitly).
5. Leave the other settings at their defaults and choose **Create table**.
:::

:::cli
```bash
REGION=${AWS_REGION:-$(aws configure get region)}
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

aws dynamodb create-table --table-name demo-items \
  --attribute-definitions AttributeName=id,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST
aws dynamodb wait table-exists --table-name demo-items
```
:::

> [!CHECK]
> The table `demo-items` is **Active** with the simple primary key `id` and on-demand capacity.

### Step 2: Create the Lambda function

The function reads the `routeKey` that API Gateway sends (for example `GET /items/{id}`) and performs the matching DynamoDB call. It needs permission to call DynamoDB, which comes from its execution role.

Save this code; you will paste it into the console or zip it for the CLI. It is written for this lab:

```python
import json
import os
from decimal import Decimal

import boto3

TABLE = boto3.resource("dynamodb").Table(os.environ.get("TABLE_NAME", "demo-items"))


def _reply(status, body):
    # DynamoDB returns numbers as Decimal, which json cannot encode by default
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body, default=lambda v: float(v) if isinstance(v, Decimal) else str(v)),
    }


def lambda_handler(event, context):
    route = event.get("routeKey", "")
    params = event.get("pathParameters") or {}
    try:
        if route == "PUT /items":
            data = json.loads(event.get("body") or "{}", parse_float=Decimal)
            TABLE.put_item(Item={"id": str(data["id"]), "name": data["name"], "price": data["price"]})
            return _reply(200, {"saved": str(data["id"])})
        if route == "GET /items":
            return _reply(200, TABLE.scan().get("Items", []))
        if route == "GET /items/{id}":
            item = TABLE.get_item(Key={"id": params["id"]}).get("Item")
            return _reply(200, item) if item else _reply(404, {"error": "not found"})
        if route == "DELETE /items/{id}":
            TABLE.delete_item(Key={"id": params["id"]})
            return _reply(200, {"deleted": params["id"]})
        return _reply(400, {"error": "unsupported route " + route})
    except (KeyError, ValueError) as err:
        return _reply(400, {"error": "bad request: " + str(err)})
```

:::console
1. Open the **Lambda** console and choose **Create function**.
2. Keep **Author from scratch**. For **Function name**, enter `demo-items-api`.
3. For **Runtime**, choose the latest supported **Python** runtime that is not marked as a preview (Python 3.14 at the time of writing; Python 3.15 is in public preview).
4. Under **Permissions**, expand **Change default execution role**, select **Create a new role from AWS policy templates**, enter `demo-items-api-role` as the **Role name**, and under **Policy templates** choose **Simple microservice permissions** (it allows the function to read and write DynamoDB items).
5. Choose **Create function**.
6. In the **Code** tab, replace the contents of `lambda_function.py` with the code above and choose **Deploy**.
:::

:::cli
```bash
cat > trust.json <<'EOF'
{"Version": "2012-10-17",
 "Statement": [{"Effect": "Allow", "Principal": {"Service": "lambda.amazonaws.com"}, "Action": "sts:AssumeRole"}]}
EOF

cat > ddb-policy.json <<EOF
{"Version": "2012-10-17",
 "Statement": [{"Effect": "Allow",
   "Action": ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:Scan"],
   "Resource": "arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/demo-items"}]}
EOF

aws iam create-role --role-name demo-items-api-role --assume-role-policy-document file://trust.json
aws iam attach-role-policy --role-name demo-items-api-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
aws iam put-role-policy --role-name demo-items-api-role \
  --policy-name demo-items-access --policy-document file://ddb-policy.json

# Save the Python code above as lambda_function.py first, then:
zip function.zip lambda_function.py
# A brand-new role can take a few seconds to become usable; retry the next command if it says the role cannot be assumed
aws lambda create-function --function-name demo-items-api \
  --runtime python3.14 --handler lambda_function.lambda_handler \
  --role arn:aws:iam::${ACCOUNT_ID}:role/demo-items-api-role \
  --zip-file fileb://function.zip \
  --environment "Variables={TABLE_NAME=demo-items}"

aws lambda wait function-active-v2 --function-name demo-items-api
FUNC_ARN=$(aws lambda get-function --function-name demo-items-api \
  --query Configuration.FunctionArn --output text)
```
:::

> [!CHECK]
> The function `demo-items-api` exists with handler `lambda_function.lambda_handler` and the role `demo-items-api-role`. In the console, **Configuration** → **Permissions** shows the role and lists DynamoDB actions in its resource summary.

### Step 3: Create the HTTP API

An HTTP API is the cheaper, simpler API Gateway product and is enough for a Lambda proxy. The console creates a `$default` stage with automatic deployment for you.

:::console
1. Open the **API Gateway** console and choose **Create API**. Under **HTTP API**, choose **Build**.
2. For **API name**, enter `demo-items-http-api`. For **IP address type**, select **IPv4**.
3. Choose **Next**. On **Configure routes**, choose **Next** without adding routes.
4. Review the `$default` stage (auto-deploy is on) and choose **Next**, then **Create**.
:::

:::cli
```bash
API_ID=$(aws apigatewayv2 create-api --name demo-items-http-api \
  --protocol-type HTTP --query ApiId --output text)

aws apigatewayv2 create-stage --api-id "$API_ID" --stage-name '$default' --auto-deploy

API_URL=$(aws apigatewayv2 get-api --api-id "$API_ID" --query ApiEndpoint --output text)
echo "$API_URL"
```
:::

> [!CHECK]
> The API's **Details** page shows an **Invoke URL** like `https://abc123defg.execute-api.<region>.amazonaws.com`. Calling it now returns `{"message":"Not Found"}` because there are no routes yet.

### Step 4: Add routes and the Lambda integration

Each route is an HTTP method plus a path. `{id}` is a path parameter that API Gateway extracts and passes to the function.

:::console
1. In your API, choose **Routes**, then **Create**.
2. Choose method **GET**, enter path `/items/{id}`, and choose **Create**.
3. Repeat for **GET** `/items`, **PUT** `/items` and **DELETE** `/items/{id}`.
4. Choose **Integrations**, then **Manage integrations** → **Create**. Skip **Attach this integration to a route**, choose **Integration type** **Lambda function**, select `demo-items-api`, and choose **Create**.
5. Back on **Integrations**, select each route in turn, choose the `demo-items-api` integration under **Choose an existing integration**, and choose **Attach integration**. The console also adds the permission that lets API Gateway invoke the function.
:::

:::cli
```bash
INTEG_ID=$(aws apigatewayv2 create-integration --api-id "$API_ID" \
  --integration-type AWS_PROXY --integration-uri "$FUNC_ARN" \
  --payload-format-version 2.0 --query IntegrationId --output text)

for ROUTE in "GET /items" "GET /items/{id}" "PUT /items" "DELETE /items/{id}"; do
  aws apigatewayv2 create-route --api-id "$API_ID" \
    --route-key "$ROUTE" --target "integrations/$INTEG_ID" --query RouteKey --output text
done

# Allow this API (any stage, any route) to invoke the function
aws lambda add-permission --function-name demo-items-api \
  --statement-id demo-items-apigw-invoke --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:${REGION}:${ACCOUNT_ID}:${API_ID}/*"
```
:::

> [!CHECK]
> **Routes** lists the four routes, each showing an **AWS Lambda** integration. In the Lambda console, the function's **Configuration** → **Triggers** now shows API Gateway.

### Step 5: Call the API

In CloudShell, set `API_URL` to your invoke URL if you used the console (for example `API_URL=https://abc123defg.execute-api.eu-west-1.amazonaws.com`), then run:

```bash
curl -s -X PUT -H "Content-Type: application/json" \
  -d '{"id": "101", "name": "trail shoes", "price": 89.5}' "$API_URL/items"
curl -s -X PUT -H "Content-Type: application/json" \
  -d '{"id": "102", "name": "water bottle", "price": 12}' "$API_URL/items"

curl -s "$API_URL/items"          # list everything (a Scan)
curl -s "$API_URL/items/101"      # read one item (GetItem)
curl -s "$API_URL/items/999"      # an item that does not exist
curl -s -X DELETE "$API_URL/items/102"
curl -s "$API_URL/items"
```

> [!CHECK]
> The two PUT calls return `{"saved": "101"}` and `{"saved": "102"}`. The list shows both items with their prices, `GET /items/101` returns the trail shoes, `GET /items/999` returns `{"error": "not found"}` with HTTP 404, and after the DELETE only item 101 remains. **Explore table items** in the DynamoDB console shows the same data.

### Step 6: Look at what happened behind the scenes

:::console
1. In the Lambda console, open `demo-items-api` and choose the **Monitor** tab, then **View CloudWatch logs**. Open the latest log stream to see one log entry set per request.
2. In the API Gateway console, open your API and look at **Monitor** → **Metrics** for the request count and latency of the `$default` stage.
:::

:::cli
```bash
aws logs tail /aws/lambda/demo-items-api --since 15m
```
:::

> [!CHECK]
> Each API call produced one Lambda invocation (`START`, `END` and `REPORT` lines with duration and memory used). The first call in a while shows an `Init Duration`, which is the cold start you met in the Lambda lesson.

## Cleanup

Delete the resources in this order.

- [ ] Delete the HTTP API `demo-items-http-api` (console: **APIs** → select it → **Actions** → **Delete** → confirm; CLI: `aws apigatewayv2 delete-api --api-id "$API_ID"`).
- [ ] Delete the Lambda function `demo-items-api` (console: **Functions** → select it → **Actions** → **Delete** → confirm; CLI: `aws lambda delete-function --function-name demo-items-api`).
- [ ] Delete the log group `/aws/lambda/demo-items-api` (console: **CloudWatch** → **Log groups** → select it → **Actions** → **Delete log group(s)**; CLI: `aws logs delete-log-group --log-group-name /aws/lambda/demo-items-api`).
- [ ] Delete the IAM role `demo-items-api-role` (console: **IAM** → **Roles** → select it, note the names of the customer managed policies on its **Permissions** tab that the Lambda console created from the templates, choose **Delete** and type the role name to confirm, then delete those noted policies under **Policies**; CLI for the CLI-created role: `aws iam delete-role-policy --role-name demo-items-api-role --policy-name demo-items-access`, then `aws iam detach-role-policy --role-name demo-items-api-role --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole`, then `aws iam delete-role --role-name demo-items-api-role`).
- [ ] Delete the DynamoDB table `demo-items` (console: **Tables** → select it → **Delete** → confirm; CLI: `aws dynamodb delete-table --table-name demo-items`).
- [ ] Remove local files: `rm -f trust.json ddb-policy.json lambda_function.py function.zip`.
- [ ] Final check: the API Gateway, Lambda and DynamoDB consoles no longer list any `demo-items` resources in the Region you used, and `curl -s "$API_URL/items"` fails to resolve or connect.

## Progress checklist

- [ ] Step 1: table `demo-items` created
- [ ] Step 2: Lambda function deployed with DynamoDB permissions
- [ ] Step 3: HTTP API with a `$default` auto-deploy stage created
- [ ] Step 4: four routes attached to the Lambda integration
- [ ] Step 5: created, listed, read and deleted items with curl
- [ ] Step 6: found the invocations in CloudWatch Logs and API metrics
- [ ] Cleanup done
