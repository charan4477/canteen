// My Orders page: shows live status of the signed-in customer's orders.
// Active orders get a big token + progress tracker; finished ones go under "Past orders".
// Refreshes every 10 seconds so kitchen updates appear on their own.
const $ = (s) => document.querySelector(s);
const STEPS = ["PLACED", "PREPARING", "READY", "COMPLETED"];
const ACTIVE = ["PLACED", "PREPARING", "READY"];
const MESSAGES = {
    PLACED: "Order received. The kitchen will start soon.",
    PREPARING: "Your food is being prepared.",
    READY: "Ready! Show your token at the counter.",
};
const newId = new URLSearchParams(location.search).get("new");

$("#logoutBtn").addEventListener("click", () => { Auth.signOut(); location.href = "index.html"; });
$("#refreshBtn").addEventListener("click", loadOrders);

async function loadOrders() {
    try {
    const idToken = await Auth.token();
    if (!idToken) return (location.href = "index.html");
    const { orders } = await api("/orders/mine", { idToken });
    const active = orders.filter((o) => ACTIVE.includes(o.status));
    const past = orders.filter((o) => !ACTIVE.includes(o.status));

    $("#active").replaceChildren(...(active.length ? active.map(activeCard)
        : [el("div", { class: "card empty" },
            el("p", { class: "muted" }, "No orders in progress."),
            el("a", { href: "index.html", class: "btn primary" }, "Order food"))]));
    $("#past").replaceChildren(...(past.length ? past.map(pastCard)
        : [el("p", { class: "muted" }, "No past orders yet.")]));
    $("#updated").textContent = "Updated " + new Date().toLocaleTimeString("en-IN", { timeStyle: "short" });
    } catch (err) {
    toast(err.message, true);
    }
}

function tracker(status) {
    const at = STEPS.indexOf(status);
    return el("ol", { class: "tracker" }, STEPS.map((s, i) =>
    el("li", { class: i < at ? "done" : i === at ? "current" : "" },
        el("span", { class: "dot" }, i < at ? "✓" : String(i + 1)),
        el("span", { class: "label" }, s.charAt(0) + s.slice(1).toLowerCase()))));
}

function items(o) {
    return el("ul", {}, o.items.map((i) => el("li", {}, `${i.qty} × ${i.name} — ${rupees(i.subtotal)}`)));
}

function activeCard(o) {
    return el("div", { class: "card order active-order s-border-" + o.status.toLowerCase() + (o.orderId === newId ? " highlight" : "") },
    el("div", { class: "row-between" },
        el("div", {}, el("div", { class: "muted small" }, "Pickup token"), el("div", { class: "big-token" }, `#${o.token}`)),
        el("span", { class: "status s-" + o.status.toLowerCase() }, o.status)),
    tracker(o.status),
    el("p", { class: "status-msg" }, MESSAGES[o.status]),
    el("div", { class: "muted small" }, `${when(o.createdAt)} · Order ${o.orderId}`),
    items(o),
    o.note ? el("div", { class: "note" }, "Note: ", o.note) : null,
    el("div", { class: "total" }, "Total ", el("b", {}, rupees(o.total))));
}

function pastCard(o) {
    return el("div", { class: "card order past" },
    el("div", { class: "row-between" },
        el("b", {}, `Token #${o.token}`),
        el("span", { class: "status s-" + o.status.toLowerCase() }, o.status)),
    el("div", { class: "muted small" }, `${when(o.createdAt)} · Order ${o.orderId}`),
    items(o),
    el("div", { class: "total" }, "Total ", el("b", {}, rupees(o.total))));
}

(async function start() {
    if (!(await Auth.token())) return (location.href = "index.html");
    $("#who").textContent = "Hi, " + Auth.user().name;
    loadOrders();
  setInterval(loadOrders, 10000); // status changes from the kitchen show up on their own
})();
