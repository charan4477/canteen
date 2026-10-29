"""Run: pip install "moto[dynamodb]" boto3 pytest && pytest backend/tests -q"""
import importlib, json, os, sys
import boto3
from moto import mock_aws

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))


def ev(route, body=None, email=None, staff=None, path=None):
    e = {"routeKey": route, "headers": {}, "body": json.dumps(body) if body is not None else None,
         "pathParameters": path or {}}
    if email:
        e["requestContext"] = {"authorizer": {"jwt": {"claims": {"email": email, "name": "Bobby"}}}}
    if staff:
        e["headers"]["X-Staff-Token"] = staff
    return e


@mock_aws
def test_full_flow():
    os.environ.update(AWS_DEFAULT_REGION="ap-south-1", MENU_TABLE="menu", ORDERS_TABLE="orders",
                      STAFF_KEY="canteen-staff-2026")
    ddb = boto3.client("dynamodb", region_name="ap-south-1")
    ddb.create_table(TableName="menu", BillingMode="PAY_PER_REQUEST",
                     AttributeDefinitions=[{"AttributeName": "id", "AttributeType": "S"}],
                     KeySchema=[{"AttributeName": "id", "KeyType": "HASH"}])
    ddb.create_table(TableName="orders", BillingMode="PAY_PER_REQUEST",
                     AttributeDefinitions=[{"AttributeName": n, "AttributeType": "S"} for n in ("orderId", "userEmail", "createdAt")],
                     KeySchema=[{"AttributeName": "orderId", "KeyType": "HASH"}],
                     GlobalSecondaryIndexes=[{"IndexName": "byUser", "Projection": {"ProjectionType": "ALL"},
                                              "KeySchema": [{"AttributeName": "userEmail", "KeyType": "HASH"},
                                                            {"AttributeName": "createdAt", "KeyType": "RANGE"}]}])
    import app; importlib.reload(app)
    h = lambda e: (lambda r: (r["statusCode"], json.loads(r["body"])))(app.lambda_handler(e, None))

    s, b = h(ev("GET /menu")); assert s == 200 and len(b["items"]) == 8

    # customer must be signed in
    assert h(ev("POST /orders", {"items": [{"id": "tea", "qty": 1}]}))[0] == 401
    # server ignores any client price and recomputes
    s, b = h(ev("POST /orders", {"items": [{"id": "tea", "qty": 2, "price": 1}, {"id": "samosa", "qty": 1}]}, email="A@x.com"))
    assert s == 201 and b["order"]["total"] == 12 * 2 + 15, b
    oid = b["order"]["orderId"]
    assert h(ev("POST /orders", {"items": [{"id": "tea", "qty": 99}]}, email="a@x.com"))[0] == 400
    assert h(ev("POST /orders", {"items": [{"id": "nope", "qty": 1}]}, email="a@x.com"))[0] == 400
    s, b = h(ev("GET /orders/mine", email="a@x.com")); assert len(b["orders"]) == 1
    s, b = h(ev("GET /orders/mine", email="other@x.com")); assert b["orders"] == []

    # manager
    assert h(ev("POST /manager/login", {"staffKey": "wrong"}))[0] == 401
    assert h(ev("GET /manager/orders"))[0] == 401
    assert h(ev("GET /manager/orders", staff="forged.token"))[0] == 401
    s, b = h(ev("POST /manager/login", {"staffKey": "canteen-staff-2026"})); tok = b["token"]
    s, b = h(ev("GET /manager/orders", staff=tok)); assert s == 200 and len(b["orders"]) == 1
    s, b = h(ev("PATCH /manager/orders/{id}", {"status": "ready"}, staff=tok, path={"id": oid}))
    assert s == 200 and b["order"]["status"] == "READY"
    assert h(ev("PATCH /manager/orders/{id}", {"status": "READY"}, staff=tok, path={"id": "ZZZ"}))[0] == 404
    assert h(ev("PATCH /manager/orders/{id}", {"status": "EATEN"}, staff=tok, path={"id": oid}))[0] == 400

    s, b = h(ev("POST /manager/menu", {"name": "Paneer Roll", "price": 60, "category": "Snacks"}, staff=tok))
    assert s == 200; new_id = b["item"]["id"]
    s, b = h(ev("POST /manager/menu", {"id": "tea", "name": "Tea", "price": 12, "category": "Drinks", "available": False}, staff=tok))
    assert h(ev("POST /orders", {"items": [{"id": "tea", "qty": 1}]}, email="a@x.com"))[0] == 400  # sold out
    assert h(ev("DELETE /manager/menu/{id}", staff=tok, path={"id": new_id}))[0] == 200
    s, b = h(ev("GET /menu")); assert len(b["items"]) == 8
    assert h(ev("GET /nope"))[0] == 404
