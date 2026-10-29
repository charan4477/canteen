# 🍛 Canteen

A simple canteen ordering system.

- **Frontend:** plain HTML, CSS and JavaScript (no frameworks, no build step)
- **Customers:** sign up and sign in with email + password, verified by a 6-digit code emailed by **Amazon Cognito**
- **Manager:** logs in with a secret **staff key**, sees live orders, updates their status, and edits the menu
- **Backend on AWS:** API Gateway (HTTP API) → one Python Lambda → two DynamoDB tables, all created by one SAM template

```
index.html          customer page (sign in, menu, cart, my orders)
manager.html        manager dashboard (staff key login, orders, menu)
css/style.css
js/config.js        ← paste your AWS values here after deploying
js/auth.js          Cognito email auth with plain fetch (no SDK)
js/api.js           API helper + safe DOM builder
js/customer.js
js/manager.js
backend/template.yaml   AWS SAM: Cognito, DynamoDB, Lambda, HTTP API
backend/src/app.py      the Lambda (all API routes)
backend/tests/          local test with moto (fake DynamoDB)
```

## How it works

```
Browser ──(email + password)──▶ Amazon Cognito ──▶ ID token (JWT)
Browser ──(JWT)──▶ API Gateway [JWT authorizer] ──▶ Lambda ──▶ DynamoDB
Manager ──(staff key)──▶ /manager/login ──▶ signed 8-hour staff token ──▶ /manager/*
```

| Method | Path | Who |
|---|---|---|
| GET | /menu | anyone |
| POST | /orders | signed-in customer |
| GET | /orders/mine | signed-in customer |
| POST | /manager/login | anyone with the staff key |
| GET | /manager/orders | manager |
| PATCH | /manager/orders/{id} | manager |
| POST | /manager/menu | manager |
| DELETE | /manager/menu/{id} | manager |

Security basics that are built in:
- The server recomputes every price from the menu, so nobody can change the price in the browser.
- The staff key lives only in Lambda (never in the frontend code). Managers get a signed token that expires in 8 hours.
- Customers only ever see their own orders (email comes from the verified Cognito token).
- All user text is inserted with `textContent`, never `innerHTML`, so no XSS.

## Deploy the backend (about 5 minutes)

1. Sign in to the AWS Console, switch region to **Asia Pacific (Mumbai) ap-south-1**, and open **CloudShell** (the `>_` icon at the top). SAM CLI is already installed there.
2. Get the code and deploy:
   ```bash
   git clone https://github.com/charan4477/canteen.git
   cd canteen/backend
   sam build
   sam deploy --guided
   ```
   Answer the prompts:
   - Stack name: `canteen`
   - Region: `ap-south-1`
   - Parameter **StaffKey**: choose a secret, 8+ characters (this is what managers type)
   - Parameter AllowedOrigin: `*` for now
   - "CanteenFunction has no authentication. Is this okay?" → **y** (manager routes check the staff key inside the Lambda)
   - Accept the other defaults (`Y` to save the config).
3. When it finishes, copy the **Outputs**: `ApiUrl`, `Region`, `UserPoolClientId`.

## Connect the frontend

Edit `js/config.js`:

```js
window.CANTEEN_CONFIG = {
  API_URL: "https://abc123.execute-api.ap-south-1.amazonaws.com",
  COGNITO_REGION: "ap-south-1",
  COGNITO_CLIENT_ID: "1a2b3c4d5e6f7g8h9i0j",
};
```

These values are safe to commit: they are public identifiers, not secrets.

## Host it

**GitHub Pages:** repo Settings → Pages → Source: *Deploy from a branch* → `main` / `(root)`.
The site will be at `https://charan4477.github.io/canteen/`.

Then lock CORS to your site (optional but better):
```bash
sam deploy --parameter-overrides StaffKey=YOUR_KEY AllowedOrigin=https://charan4477.github.io
```

Locally, any static server works: `python3 -m http.server 8000` then open http://localhost:8000.

## Try it

1. Open the site → **Create account** → check your email for the code → verify. You're signed in.
2. Add dishes, place an order, and note your pickup token number.
3. Open **Staff** (`manager.html`) → enter the staff key → change the order to *Preparing* → *Ready*.
   The customer page picks up the new status within 20 seconds.
4. Add, edit, mark sold out, or delete dishes from the Menu section.

The first time `/menu` is called with an empty table, a starter menu is added automatically.

## Run the backend test locally

```bash
pip install "moto[dynamodb]" boto3 pytest
pytest backend/tests -q
```

## Notes and limits

- Cognito's built-in email sender allows about 50 emails a day, plenty for a college demo. For more, connect Amazon SES in the User Pool settings.
- Everything here fits in the AWS Free Tier for a class project.
- To delete everything: `sam delete --stack-name canteen`.
- Order statuses: PLACED → PREPARING → READY → COMPLETED (or CANCELLED).
