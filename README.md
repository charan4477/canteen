# Smart Canteen Ordering System

A simple web app for ordering food from the college canteen. Students order from their browser and get a pickup token. The kitchen sees orders live and updates their status, and students can follow their order on the My Orders page.

Built for our Web Programming project with plain HTML, CSS and JavaScript on the front and AWS on the back.

## Features

**Customer**
- Sign up with email and password, verified with a 6-digit code (Amazon Cognito)
- Browse the menu by category and search dishes
- Add to cart, change quantity, add a note for the kitchen
- Place an order and get a pickup token
- My Orders page: live status (Placed > Preparing > Ready > Completed), refreshes every 10 seconds
- Badge in the header showing how many orders are in progress

**Manager (Staff)**
- Log in with a staff key (Staff button on the top right)
- See all orders, filter by status
- Click an order card to move it to the next status, or pick any status from the dropdown
- Today's order count and revenue
- Add, edit, delete menu items and mark them sold out

## Tech stack

| Part | Used |
|---|---|
| Frontend | HTML, CSS, JavaScript (no framework, no build step) |
| Customer login | Amazon Cognito (email + password) |
| Manager login | Staff key, checked in Lambda, gives an 8-hour token |
| API | Amazon API Gateway (HTTP API) |
| Backend | AWS Lambda (Python 3.12) |
| Database | Amazon DynamoDB |
| Hosting | GitHub Pages |

## Folder structure

```
index.html            menu, cart, sign in / sign up
orders.html           my orders with live status
manager.html          staff dashboard
css/style.css         all styles
js/config.js          AWS values (API URL, Cognito region and client id)
js/auth.js            Cognito sign up / sign in using fetch (no SDK)
js/api.js             small helper for API calls and building HTML safely
js/customer.js        menu and cart
js/orders.js          my orders page
js/manager.js         staff dashboard
backend/src/app.py    the Lambda code (all routes)
backend/template.yaml optional SAM template to create everything in one go
backend/tests/        tests with moto (fake DynamoDB)
```

## How it works

```
Customer  -> Cognito (email + password) -> gets a login token
Customer  -> API Gateway (checks token) -> Lambda -> DynamoDB
Manager   -> /manager/login (staff key) -> staff token -> /manager/* routes
```

DynamoDB tables:
- `canteen-menu` - menu items (id, name, price, category, available)
- `canteen-orders` - orders, with a `byUser` index so a customer can fetch only their own orders

## API routes

| Method | Path | Who can call it |
|---|---|---|
| GET | /menu | anyone |
| POST | /orders | signed-in customer |
| GET | /orders/mine | signed-in customer |
| POST | /manager/login | anyone with the staff key |
| GET | /manager/orders | manager |
| PATCH | /manager/orders/{id} | manager |
| POST | /manager/menu | manager |
| DELETE | /manager/menu/{id} | manager |

Only `POST /orders` and `GET /orders/mine` use the Cognito JWT authorizer. The `/manager` routes must NOT have it, because they check the staff token inside Lambda.

## Security

- Prices are recalculated on the server from the menu, so changing a price in the browser does nothing.
- The staff key is only stored in Lambda, never in the frontend.
- Customers can only see their own orders (the email comes from the verified Cognito token).
- User text is added with `textContent`, not `innerHTML`, so scripts can't be injected.

## AWS setup (what we did in the Console, region us-east-1)

1. **DynamoDB** - create `canteen-menu` (key `id`) and `canteen-orders` (key `orderId`) with a global index `byUser` (partition key `userEmail`, sort key `createdAt`).
2. **Cognito** - create a user pool with email sign-in and an app client (no secret) with `USER_PASSWORD_AUTH` turned on.
3. **Lambda** - create `canteen-api` (Python 3.12), paste `backend/src/app.py` as `lambda_function.py`, give it access to both tables, and set the environment variables `MENU_TABLE`, `ORDERS_TABLE` and `STAFF_KEY`.
4. **API Gateway** - create an HTTP API, add the routes above, attach them to the Lambda, and add the Cognito JWT authorizer only to the two `/orders` routes. Turn on CORS.
5. **Lambda permission** - allow API Gateway to call the Lambda with source ARN `arn:aws:execute-api:us-east-1:<account-id>:<api-id>/*/*`. (With a separate permission per route, some routes returned 500 errors.)

Or use the SAM template instead: `cd backend && sam build && sam deploy --guided`.

## Connect the frontend

Put your values in `js/config.js`:

```js
window.CANTEEN_CONFIG = {
  API_URL: "https://<api-id>.execute-api.us-east-1.amazonaws.com",
  COGNITO_REGION: "us-east-1",
  COGNITO_CLIENT_ID: "<app-client-id>",
};
```

These are public ids, not secrets, so they're fine to commit.

## Run it

- **Locally:** `python -m http.server 8000`, then open http://localhost:8000
- **GitHub Pages:** Settings > Pages > Deploy from branch > `main` / root. The site will be at `https://charan4477.github.io/canteen/`

## Try it

1. Open the site, create an account, and enter the code from your email.
2. Add dishes to the cart and place an order. You'll be taken to My Orders with your token.
3. Open **Staff**, enter the staff key, and click the order card to move it to Preparing, then Ready.
4. Go back to My Orders. The status updates by itself within 10 seconds.

## Problems we ran into

- **500 error on /orders/mine** - the Lambda permission only allowed some routes. Fixed with a single `/*/*` source ARN.
- **401 "Manager login required" on status update** - the JWT authorizer was attached to the manager routes by mistake. Removing it fixed it.
- **CORS errors** - CORS had to be turned on in API Gateway, with the `Authorization` and `x-staff-token` headers allowed.

## Future ideas

- UPI payment
- Notification when the order is ready
- Ratings for dishes
- Sales charts for the manager

## Notes

- Cognito's built-in email can send about 50 emails a day, which is enough for a demo.
- Everything fits in the AWS Free Tier.
- Run the backend tests: `pip install "moto[dynamodb]" boto3 pytest` then `pytest backend/tests -q`
