const $ = (s) => document.querySelector(s);
let menu = [];
const cart = new Map(); // id -> qty
let pendingEmail = "";
let pendingPassword = ""; // kept in memory only, to sign in right after verifying

// ---------------- auth screens ----------------
function showPanel(id) {
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("hidden", p.id !== id));
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.panel === id));
}
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => showPanel(t.dataset.panel)));
$("#forgotLink").addEventListener("click", (e) => { e.preventDefault(); showPanel("forgotForm"); });

async function busy(form, fn) {
  const btn = form.querySelector("button[type=submit]");
  btn.disabled = true;
  try { await fn(); } catch (err) { toast(err.message, true); return err; } finally { btn.disabled = false; }
}

$("#signinForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  busy(e.target, async () => {
    try {
      await Auth.signIn(f.get("email").trim(), f.get("password"));
      start();
    } catch (err) {
      if (err.type === "UserNotConfirmedException") {
        pendingEmail = f.get("email").trim();
        await Auth.resend(pendingEmail);
        goVerify();
      }
      throw err;
    }
  });
});

$("#signupForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  busy(e.target, async () => {
    pendingEmail = f.get("email").trim();
    await Auth.signUp(pendingEmail, f.get("password"), f.get("name").trim());
    pendingPassword = f.get("password");
    goVerify();
  });
});

function goVerify() {
  $("#verifyEmail").textContent = pendingEmail;
  showPanel("verifyForm");
}

$("#verifyForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const code = new FormData(e.target).get("code").trim();
  busy(e.target, async () => {
    await Auth.confirm(pendingEmail, code);
    const pw = pendingPassword;
    pendingPassword = "";
    if (pw) { await Auth.signIn(pendingEmail, pw); start(); }
    else { toast("Email verified. Please sign in."); showPanel("signinForm"); }
  });
});

$("#resendLink").addEventListener("click", async (e) => {
  e.preventDefault();
  try { await Auth.resend(pendingEmail); toast("New code sent."); } catch (err) { toast(err.message, true); }
});

$("#sendResetBtn").addEventListener("click", async () => {
  const email = $("#forgotForm").email.value.trim();
  if (!email) return toast("Enter your email first", true);
  try { await Auth.forgot(email); toast("Reset code sent to your email."); } catch (err) { toast(err.message, true); }
});

$("#forgotForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  busy(e.target, async () => {
    await Auth.resetPassword(f.get("email").trim(), f.get("code").trim(), f.get("password"));
    toast("Password changed. Please sign in.");
    showPanel("signinForm");
  });
});

$("#logoutBtn").addEventListener("click", () => { Auth.signOut(); location.reload(); });

// ---------------- menu + cart ----------------
async function loadMenu() {
  try {
    menu = (await api("/menu")).items;
    renderMenu();
  } catch (err) {
    $("#menu").replaceChildren(el("p", { class: "muted" }, "Could not load the menu: " + err.message));
  }
}

function renderMenu() {
  const q = $("#search").value.toLowerCase();
  const groups = {};
  menu.filter((m) => m.name.toLowerCase().includes(q))
      .forEach((m) => (groups[m.category] ||= []).push(m));
  const out = Object.entries(groups).map(([cat, items]) =>
    el("div", {},
      el("h3", { class: "cat" }, cat),
      el("div", { class: "grid" }, items.map((m) =>
        el("div", { class: "card dish" + (m.available ? "" : " off") },
          el("div", {}, el("b", {}, m.name), el("div", { class: "muted" }, rupees(m.price))),
          m.available
            ? el("button", { class: "btn primary", onclick: () => addToCart(m.id) }, "Add")
            : el("span", { class: "badge" }, "Sold out")
        )))
    ));
  $("#menu").replaceChildren(...(out.length ? out : [el("p", { class: "muted" }, "No dishes found.")]));
}
$("#search").addEventListener("input", renderMenu);

function addToCart(id, delta = 1) {
  const q = (cart.get(id) || 0) + delta;
  if (q <= 0) cart.delete(id); else cart.set(id, Math.min(q, 20));
  renderCart();
}

function renderCart() {
  let total = 0;
  const rows = [...cart].map(([id, qty]) => {
    const m = menu.find((x) => x.id === id);
    if (!m) return null;
    total += m.price * qty;
    return el("li", {},
      el("span", {}, m.name),
      el("span", { class: "qty" },
        el("button", { class: "btn tiny", onclick: () => addToCart(id, -1) }, "−"),
        String(qty),
        el("button", { class: "btn tiny", onclick: () => addToCart(id, 1) }, "+")),
      el("span", {}, rupees(m.price * qty)));
  });
  $("#cartList").replaceChildren(...(rows.length ? rows : [el("li", { class: "muted" }, "Cart is empty")]));
  $("#cartTotal").textContent = rupees(total);
  $("#placeBtn").disabled = cart.size === 0;
}

$("#placeBtn").addEventListener("click", async () => {
  const btn = $("#placeBtn");
  btn.disabled = true;
  try {
    const idToken = await Auth.token();
    if (!idToken) return location.reload();
    const items = [...cart].map(([id, qty]) => ({ id, qty }));
    const { order } = await api("/orders", { method: "POST", idToken, body: { items, note: $("#note").value } });
    cart.clear(); $("#note").value = ""; renderCart();
    toast(`Order placed! Pickup token #${order.token}`);
    setTimeout(() => { location.href = "orders.html?new=" + encodeURIComponent(order.orderId); }, 1200);
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = cart.size === 0;
  }
});

// ---------------- active order count (nav badge) ----------------
async function loadActiveCount() {
  try {
    const idToken = await Auth.token();
    if (!idToken) return;
    const { orders } = await api("/orders/mine", { idToken });
    const n = orders.filter((o) => ["PLACED", "PREPARING", "READY"].includes(o.status)).length;
    $("#activeCount").textContent = n;
    $("#activeCount").classList.toggle("hidden", n === 0);
  } catch { /* badge is optional */ }
}

// ---------------- start ----------------
async function start() {
  const token = await Auth.token();
  if (!token) {
    $("#authView").classList.remove("hidden");
    $("#appView").classList.add("hidden");
    return;
  }
  const u = Auth.user();
  $("#who").textContent = "Hi, " + u.name;
  $("#logoutBtn").classList.remove("hidden");
  $("#menuLink").classList.remove("hidden");
  $("#ordersLink").classList.remove("hidden");
  $("#authView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
  await loadMenu();
  renderCart();
  loadActiveCount();
  setInterval(loadActiveCount, 20000);
}
start();
