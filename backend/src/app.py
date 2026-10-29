"""Canteen API - one Python Lambda behind an API Gateway HTTP API.

Routes
  GET    /menu                    public
  POST   /manager/login           public, body {"staffKey": "..."} -> {"token": "..."}
  POST   /orders                  customer (Cognito JWT), body {"items": [{"id": "...", "qty": 2}], "note": ""}
  GET    /orders/mine             customer (Cognito JWT)
  GET    /manager/orders          manager (x-staff-token header)
  PATCH  /manager/orders/{id}     manager, body {"status": "PREPARING"}
  POST   /manager/menu            manager, body {"id"?, "name", "price", "category", "available"}
  DELETE /manager/menu/{id}       manager

Prices are whole rupees (integers). The server always recomputes the total
from the menu, so a customer can never set their own price.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import time
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key

_ddb = boto3.resource("dynamodb")
MENU = _ddb.Table(os.environ["MENU_TABLE"])
ORDERS = _ddb.Table(os.environ["ORDERS_TABLE"])
STAFF_KEY = os.environ["STAFF_KEY"]
TOKEN_TTL = 8 * 3600  # manager session: 8 hours
_SIGNING_KEY = hashlib.sha256(("canteen-token:" + STAFF_KEY).encode()).digest()

STATUSES = ["PLACED", "PREPARING", "READY", "COMPLETED", "CANCELLED"]
MAX_QTY = 20

SEED_MENU = [
    {"id": "veg-meals", "name": "Veg Meals", "price": 70, "category": "Meals", "available": True},
    {"id": "chicken-biryani", "name": "Chicken Biryani", "price": 120, "category": "Meals", "available": True},
    {"id": "masala-dosa", "name": "Masala Dosa", "price": 40, "category": "Tiffins", "available": True},
    {"id": "idli", "name": "Idli (2 pcs)", "price": 30, "category": "Tiffins", "available": True},
    {"id": "samosa", "name": "Samosa", "price": 15, "category": "Snacks", "available": True},
    {"id": "veg-puff", "name": "Veg Puff", "price": 20, "category": "Snacks", "available": True},
    {"id": "tea", "name": "Tea", "price": 12, "category": "Drinks", "available": True},
    {"id": "coffee", "name": "Coffee", "price": 15, "category": "Drinks", "available": True},
]


# ---------------- helpers ----------------
class HttpError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def _plain(o):
    """DynamoDB returns Decimal; turn it back into int/float for JSON."""
    if isinstance(o, list):
        return [_plain(x) for x in o]
    if isinstance(o, dict):
        return {k: _plain(v) for k, v in o.items()}
    if isinstance(o, Decimal):
        return int(o) if o == o.to_integral_value() else float(o)
    return o


def resp(status, body):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(_plain(body)),
    }


def body_of(event):
    raw = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode()
    try:
        data = json.loads(raw)
    except ValueError:
        raise HttpError(400, "Body must be JSON")
    if not isinstance(data, dict):
        raise HttpError(400, "Body must be a JSON object")
    return data


def header(event, name):
    for k, v in (event.get("headers") or {}).items():
        if k.lower() == name:
            return v
    return None


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _unb64(s):
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


# ---------------- manager tokens (signed with the staff key) ----------------
def make_token():
    payload = _b64(json.dumps({"role": "manager", "exp": int(time.time()) + TOKEN_TTL}).encode())
    sig = _b64(hmac.new(_SIGNING_KEY, payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{sig}"


def require_manager(event):
    token = header(event, "x-staff-token") or ""
    try:
        payload, sig = token.split(".")
        good = _b64(hmac.new(_SIGNING_KEY, payload.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, good):
            raise ValueError
        data = json.loads(_unb64(payload))
        if data.get("role") != "manager" or data.get("exp", 0) < time.time():
            raise ValueError
    except Exception:
        raise HttpError(401, "Manager login required")


def customer_email(event):
    claims = (((event.get("requestContext") or {}).get("authorizer") or {}).get("jwt") or {}).get("claims") or {}
    email = claims.get("email")
    if not email:
        raise HttpError(401, "Please sign in")
    return email.lower(), claims.get("name") or email.split("@")[0]


# ---------------- handlers ----------------
def get_menu(event):
    items = MENU.scan().get("Items", [])
    if not items:  # first run: seed a starter menu
        with MENU.batch_writer() as bw:
            for it in SEED_MENU:
                bw.put_item(Item=it)
        items = SEED_MENU
    items = sorted(items, key=lambda i: (i.get("category", ""), i.get("name", "")))
    return resp(200, {"items": items})


def staff_login(event):
    key = str(body_of(event).get("staffKey", ""))
    time.sleep(0.3)  # slow down guessing
    if not hmac.compare_digest(key.encode(), STAFF_KEY.encode()):
        raise HttpError(401, "Wrong staff key")
    return resp(200, {"token": make_token(), "expiresIn": TOKEN_TTL})


def place_order(event):
    email, name = customer_email(event)
    data = body_of(event)
    wanted = data.get("items")
    if not isinstance(wanted, list) or not wanted:
        raise HttpError(400, "Your cart is empty")

    qty_by_id = {}
    for row in wanted:
        if not isinstance(row, dict):
            raise HttpError(400, "Bad item")
        item_id = str(row.get("id", ""))
        try:
            qty = int(row.get("qty", 0))
        except (TypeError, ValueError):
            raise HttpError(400, "Bad quantity")
        if not item_id or qty < 1 or qty > MAX_QTY:
            raise HttpError(400, f"Quantity must be 1 to {MAX_QTY}")
        qty_by_id[item_id] = qty_by_id.get(item_id, 0) + qty

    lines, total = [], 0
    for item_id, qty in qty_by_id.items():
        item = MENU.get_item(Key={"id": item_id}).get("Item")
        if not item or not item.get("available", True):
            raise HttpError(400, f"'{item_id}' is not available right now")
        price = int(item["price"])
        lines.append({"id": item_id, "name": item["name"], "price": price, "qty": qty, "subtotal": price * qty})
        total += price * qty

    order = {
        "orderId": uuid.uuid4().hex[:8].upper(),
        "token": str(secrets.randbelow(900) + 100),  # 3-digit pickup number
        "userEmail": email,
        "userName": name,
        "items": lines,
        "total": total,
        "note": str(data.get("note", ""))[:200],
        "status": "PLACED",
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
    }
    ORDERS.put_item(Item=order)
    return resp(201, {"order": order})


def my_orders(event):
    email, _ = customer_email(event)
    res = ORDERS.query(IndexName="byUser", KeyConditionExpression=Key("userEmail").eq(email),
                       ScanIndexForward=False, Limit=50)
    return resp(200, {"orders": res.get("Items", [])})


def all_orders(event):
    require_manager(event)
    items, kwargs = [], {}
    while True:
        res = ORDERS.scan(**kwargs)
        items += res.get("Items", [])
        if "LastEvaluatedKey" not in res:
            break
        kwargs["ExclusiveStartKey"] = res["LastEvaluatedKey"]
    items.sort(key=lambda o: o.get("createdAt", ""), reverse=True)
    return resp(200, {"orders": items})


def update_order(event):
    require_manager(event)
    order_id = (event.get("pathParameters") or {}).get("id", "")
    status = str(body_of(event).get("status", "")).upper()
    if status not in STATUSES:
        raise HttpError(400, "Status must be one of " + ", ".join(STATUSES))
    try:
        res = ORDERS.update_item(
            Key={"orderId": order_id},
            UpdateExpression="SET #s = :s, updatedAt = :u",
            ConditionExpression="attribute_exists(orderId)",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":s": status, ":u": now_iso()},
            ReturnValues="ALL_NEW",
        )
    except _ddb.meta.client.exceptions.ConditionalCheckFailedException:
        raise HttpError(404, "Order not found")
    return resp(200, {"order": res["Attributes"]})


def save_menu_item(event):
    require_manager(event)
    data = body_of(event)
    name = str(data.get("name", "")).strip()[:60]
    category = str(data.get("category", "Other")).strip()[:30] or "Other"
    try:
        price = int(data.get("price"))
    except (TypeError, ValueError):
        raise HttpError(400, "Price must be a whole number")
    if not name or price < 1 or price > 10000:
        raise HttpError(400, "Name and a price between 1 and 10000 are required")
    item_id = str(data.get("id") or "").strip() or "-".join(name.lower().split())[:40] + "-" + uuid.uuid4().hex[:4]
    item = {"id": item_id, "name": name, "price": price, "category": category,
            "available": bool(data.get("available", True))}
    MENU.put_item(Item=item)
    return resp(200, {"item": item})


def delete_menu_item(event):
    require_manager(event)
    item_id = (event.get("pathParameters") or {}).get("id", "")
    MENU.delete_item(Key={"id": item_id})
    return resp(200, {"deleted": item_id})


ROUTES = {
    "GET /menu": get_menu,
    "POST /manager/login": staff_login,
    "POST /orders": place_order,
    "GET /orders/mine": my_orders,
    "GET /manager/orders": all_orders,
    "PATCH /manager/orders/{id}": update_order,
    "POST /manager/menu": save_menu_item,
    "DELETE /manager/menu/{id}": delete_menu_item,
}


def lambda_handler(event, context):
    route = event.get("routeKey", "")
    fn = ROUTES.get(route)
    if not fn:
        return resp(404, {"error": f"No route {route}"})
    try:
        return fn(event)
    except HttpError as e:
        return resp(e.status, {"error": e.message})
    except Exception as e:  # keep details in CloudWatch, not in the browser
        print("ERROR", route, repr(e))
        return resp(500, {"error": "Server error, please try again"})
