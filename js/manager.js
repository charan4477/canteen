const $ = (s) => document.querySelector(s);
const KEY = "canteen.staff";
const STATUSES = ["PLACED", "PREPARING", "READY", "COMPLETED", "CANCELLED"];
let orders = [];
let timer;

const staffToken = () => {
  const s = JSON.parse(sessionStorage.getItem(KEY) || "null");
  return s && Date.now() < s.expiresAt ? s.token : null;
};

async function call(path, opts = {}) {
  try {
    return await api(path, { ...opts, staffToken: staffToken() });
  } catch (err) {
    if (err.status === 401) logout("Session expired. Log in again.");
    throw err;
  }
}

$("#staffForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector("button");
  btn.disabled = true;
  try {
    const { token, expiresIn } = await api("/manager/login", {
      method: "POST", body: { staffKey: e.target.staffKey.value },
    });
    sessionStorage.setItem(KEY, JSON.stringify({ token, expiresAt: Date.now() + expiresIn * 1000 }));
    e.target.reset();
    start();
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
  }
});

function logout(msg) {
  sessionStorage.removeItem(KEY);
  clearInterval(timer);
  $("#dashView").classList.add("hidden");
  $("#logoutBtn").classList.add("hidden");
  $("#loginView").classList.remove("hidden");
  if (msg) toast(msg, true);
}
$("#logoutBtn").addEventListener("click", () => logout());

// ---------------- orders ----------------
async function loadOrders() {
  try {
    orders = (await call("/manager/orders")).orders;
    renderOrders();
  } catch (err) { if (err.status !== 401) toast(err.message, true); }
}

function renderOrders() {
  const today = new Date().toDateString();
  const todays = orders.filter((o) => new Date(o.createdAt).toDateString() === today && o.status !== "CANCELLED");
  const stat = (label, value) => el("div", { class: "card stat" }, el("div", { class: "muted small" }, label), el("b", {}, value));
  $("#stats").replaceChildren(
    stat("Orders today", todays.length),
    stat("Revenue today", rupees(todays.reduce((a, o) => a + o.total, 0))),
    stat("Waiting", orders.filter((o) => o.status === "PLACED").length),
    stat("Preparing", orders.filter((o) => o.status === "PREPARING").length),
  );

  const f = $("#filter").value;
  const list = orders.filter((o) =>
    f === "ALL" ? true : f === "ACTIVE" ? ["PLACED", "PREPARING", "READY"].includes(o.status) : o.status === f);
  $("#orders").replaceChildren(...(list.length ? list.map(orderCard) : [el("p", { class: "muted" }, "No orders here.")]));
}
$("#filter").addEventListener("change", renderOrders);
$("#refreshBtn").addEventListener("click", loadOrders);

const NEXT = { PLACED: "PREPARING", PREPARING: "READY", READY: "COMPLETED" };

async function setStatus(o, status) {
  try {
    await call(`/manager/orders/${encodeURIComponent(o.orderId)}`, { method: "PATCH", body: { status } });
    o.status = status;
    toast(`Token #${o.token} → ${status}`);
  } catch (err) { toast(err.message, true); }
  renderOrders();
}

function orderCard(o) {
  const next = NEXT[o.status];
  const select = el("select", {
    onclick: (e) => e.stopPropagation(),
    onchange: (e) => setStatus(o, e.target.value),
  }, STATUSES.map((s) => el("option", { value: s, selected: s === o.status }, s)));

  return el("div", {
    class: "card order" + (next ? " clickable" : ""),
    title: next ? `Click to move to ${next}` : "",
    onclick: next ? () => setStatus(o, next) : null,
  },
    el("div", { class: "row-between" },
      el("b", {}, `Token #${o.token}`),
      el("span", { class: "status s-" + o.status.toLowerCase() }, o.status)),
    el("div", { class: "muted small" }, `${o.userName} (${o.userEmail}) · ${when(o.createdAt)}`),
    el("ul", {}, o.items.map((i) => el("li", {}, `${i.qty} × ${i.name}`))),
    o.note ? el("div", { class: "note" }, "Note: ", o.note) : null,
    next ? el("div", { class: "muted small" }, `Click card → ${next}`) : null,
    el("div", { class: "row-between" }, el("b", {}, rupees(o.total)), select));
}

// ---------------- menu management ----------------
async function loadMenu() {
  const { items } = await api("/menu");
  $("#menuRows").replaceChildren(...items.map((m) => el("tr", {},
    el("td", {}, m.name),
    el("td", {}, m.category),
    el("td", {}, rupees(m.price)),
    el("td", {}, el("input", { type: "checkbox", checked: !!m.available,
      onchange: (e) => saveItem({ ...m, available: e.target.checked }) })),
    el("td", {},
      el("button", { class: "btn tiny", onclick: () => editItem(m) }, "Edit"),
      el("button", { class: "btn tiny danger", onclick: () => deleteItem(m) }, "Delete")),
  )));
}

function editItem(m) {
  const f = $("#itemForm").elements;
  f.id.value = m.id; f.name.value = m.name; f.price.value = m.price;
  f.category.value = m.category; f.available.checked = !!m.available;
  f.name.focus();
  window.scrollTo({ top: $("#itemForm").offsetTop - 90, behavior: "smooth" });
}

async function saveItem(item) {
  try {
    await call("/manager/menu", { method: "POST", body: item });
    toast("Saved " + item.name);
    loadMenu();
  } catch (err) { toast(err.message, true); }
}

async function deleteItem(m) {
  if (!confirm(`Delete ${m.name}?`)) return;
  try {
    await call(`/manager/menu/${encodeURIComponent(m.id)}`, { method: "DELETE" });
    loadMenu();
  } catch (err) { toast(err.message, true); }
}

$("#itemForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target.elements;
  saveItem({
    id: f.id.value || undefined, name: f.name.value.trim(), price: Number(f.price.value),
    category: f.category.value.trim() || "Other", available: f.available.checked,
  });
  e.target.reset(); f.id.value = "";
});

// ---------------- start ----------------
function start() {
  if (!staffToken()) return logout();
  $("#loginView").classList.add("hidden");
  $("#dashView").classList.remove("hidden");
  $("#logoutBtn").classList.remove("hidden");
  loadOrders();
  loadMenu();
  clearInterval(timer);
  timer = setInterval(loadOrders, 10000); // new orders show up on their own
}
start();