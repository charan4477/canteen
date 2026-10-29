// Small wrapper around the Canteen API.
async function api(path, { method = "GET", body, idToken, staffToken } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
  if (staffToken) headers["x-staff-token"] = staffToken;
  const res = await fetch(window.CANTEEN_CONFIG.API_URL + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || data.message || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Build DOM safely: el("p", {class: "x"}, "text", child) - never uses innerHTML with data.
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, "");
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) n.append(c instanceof Node ? c : String(c));
  return n;
}

const rupees = (n) => "₹" + Number(n).toLocaleString("en-IN");
const when = (iso) => new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

function toast(msg, isError = false) {
  const t = el("div", { class: "toast" + (isError ? " error" : "") }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 3500);
}
