const PRODUCT_KEY = "kv_artist_products";
const CART_KEY = "kv_artist_cart";
const SETTINGS_KEY = "kv_artist_settings";

const defaultProducts = [
  {
    id: "art-1",
    title: "Hometime",
    category: "Print",
    price: 60,
    stock: 12,
    image: "../images/abbie/abbie-art-001.webp",
    description: "Fine art print"
  },
  {
    id: "art-2",
    title: "The Four",
    category: "Print",
    price: 60,
    stock: 12,
    image: "../images/abbie/abbie-art-002.webp",
    description: "Fine art print"
  },
  {
    id: "art-3",
    title: "Going Home",
    category: "Print",
    price: 60,
    stock: 12,
    image: "../images/abbie/abbie-art-003.webp",
    description: "Fine art print"
  },
  {
    id: "art-4",
    title: "Debrief",
    category: "Print",
    price: 60,
    stock: 12,
    image: "../images/abbie/abbie-art-004.webp",
    description: "Fine art print"
  },
  {
    id: "art-5",
    title: "Gone Away",
    category: "Print",
    price: 60,
    stock: 12,
    image: "../images/abbie/abbie-art-005.webp",
    description: "Fine art print"
  }
];

const defaultSettings = {
  storeName: "Abbie at Heart",
  stripePaymentLink: "https://buy.stripe.com/test_placeholder",
  shippingStandard: 6,
  shippingExpress: 14,
  promoCodes: {
    ART10: 10
  }
};

function loadSettings() {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(defaultSettings));
    return { ...defaultSettings };
  }
  const merged = { ...defaultSettings, ...JSON.parse(raw) };

  if (merged.storeName === "Abbie By Hart") {
    merged.storeName = "Abbie at Heart";
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
  }

  return merged;
}

function loadProducts() {
  const raw = localStorage.getItem(PRODUCT_KEY);
  if (!raw) {
    localStorage.setItem(PRODUCT_KEY, JSON.stringify(defaultProducts));
    return [...defaultProducts];
  }
  const parsed = JSON.parse(raw);

  const shouldResetToAbbieDefaults =
    Array.isArray(parsed) &&
    ((parsed.length <= 3 &&
      parsed.every((product) => /^art-[1-3]$/.test(String(product.id || ""))) &&
      parsed.some((product) => !product.image)) ||
      (parsed.length === 5 &&
        parsed.every((product) => /^art-[1-5]$/.test(String(product.id || ""))) &&
        parsed.some((product) =>
          [
            "Gentle Morning Walk",
            "Quiet Field Study",
            "Companions",
            "Blue Horizon",
            "Soft Light"
          ].includes(String(product.title || ""))
        )));

  if (shouldResetToAbbieDefaults) {
    localStorage.setItem(PRODUCT_KEY, JSON.stringify(defaultProducts));
    return [...defaultProducts];
  }

  return parsed;
}

function loadCart() {
  const raw = localStorage.getItem(CART_KEY);
  return raw ? JSON.parse(raw) : [];
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}

function currency(value) {
  return `£${Number(value).toFixed(2)}`;
}

function placeholderSvg(title) {
  const text = encodeURIComponent(title.slice(0, 24));
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='900' height='700'><defs><linearGradient id='g' x1='0' x2='1'><stop offset='0%' stop-color='#cbd5e1'/><stop offset='100%' stop-color='#e2e8f0'/></linearGradient></defs><rect width='100%' height='100%' fill='url(#g)'/><text x='50%' y='52%' dominant-baseline='middle' text-anchor='middle' fill='#334155' font-size='48' font-family='Arial'>${text}</text></svg>`)}`;
}

function getPromoDiscount(subtotal, code, settings) {
  const normalized = (code || "").trim().toUpperCase();
  const percent = settings.promoCodes[normalized];
  if (!percent) return 0;
  return subtotal * (percent / 100);
}

function buildProductCard(product) {
  const article = document.createElement("article");
  article.className = "product";

  const img = document.createElement("img");
  img.className = "product-image";
  img.src = product.image || placeholderSvg(product.title);
  img.alt = product.title;

  const body = document.createElement("div");
  body.className = "product-body";

  const title = document.createElement("h3");
  title.className = "product-title";
  title.textContent = product.title;

  const meta = document.createElement("div");
  meta.className = "product-meta";
  meta.textContent = `${product.category} • ${product.description || "Artwork"}`;
  if (
    String(product.category || "").toLowerCase() === "print" &&
    String(product.description || "").toLowerCase().includes("fine art print")
  ) {
    meta.title = "Print on A3 paper. Image size 250mm high.";
  }

  const price = document.createElement("p");
  price.className = "product-price";
  price.textContent = currency(product.price);

  const actions = document.createElement("div");
  actions.className = "row";

  const addBtn = document.createElement("button");
  addBtn.className = "btn";
  addBtn.textContent = product.stock > 0 ? "Add to cart" : "Sold out";
  addBtn.disabled = product.stock <= 0;
  addBtn.addEventListener("click", () => addToCart(product));

  actions.appendChild(addBtn);
  body.append(title, meta, price, actions);
  article.append(img, body);
  return article;
}

let products = loadProducts();
let cart = loadCart();
const settings = loadSettings();

const storeNameEl = document.getElementById("store-name");
const productGridEl = document.getElementById("product-grid");
const categoryFilterEl = document.getElementById("category-filter");
const cartItemsEl = document.getElementById("cart-items");
const subtotalEl = document.getElementById("subtotal");
const discountEl = document.getElementById("discount");
const shippingEl = document.getElementById("shipping");
const totalEl = document.getElementById("total");
const promoInputEl = document.getElementById("promo-code");
const applyPromoEl = document.getElementById("apply-promo");
const shippingSelectEl = document.getElementById("shipping-method");
const checkoutBtnEl = document.getElementById("checkout-btn");
const yearEl = document.getElementById("year");

let activePromo = "";

function hydrateFilters() {
  const categories = [...new Set(products.map((p) => p.category))];
  categoryFilterEl.innerHTML = `<option value='all'>All categories</option>${categories
    .map((cat) => `<option value='${cat}'>${cat}</option>`)
    .join("")}`;
}

function renderProducts() {
  const filter = categoryFilterEl.value;
  const filtered = filter === "all" ? products : products.filter((p) => p.category === filter);
  productGridEl.innerHTML = "";
  filtered.forEach((product) => productGridEl.appendChild(buildProductCard(product)));
}

function addToCart(product) {
  const existing = cart.find((item) => item.id === product.id);
  if (existing) {
    if (existing.quantity < product.stock) existing.quantity += 1;
  } else {
    cart.push({ id: product.id, title: product.title, price: product.price, quantity: 1 });
  }
  saveCart(cart);
  renderCart();
}

function removeItem(id) {
  cart = cart.filter((item) => item.id !== id);
  saveCart(cart);
  renderCart();
}

function updateQty(id, qty) {
  cart = cart.map((item) => (item.id === id ? { ...item, quantity: Math.max(1, Number(qty) || 1) } : item));
  saveCart(cart);
  renderCart();
}

function renderCart() {
  cartItemsEl.innerHTML = "";

  if (!cart.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Your cart is empty.";
    cartItemsEl.appendChild(empty);
  }

  cart.forEach((item) => {
    const wrap = document.createElement("div");
    wrap.className = "cart-item";

    const top = document.createElement("div");
    top.className = "cart-item-top";

    const left = document.createElement("div");
    left.innerHTML = `<strong>${item.title}</strong><div class='muted'>${currency(item.price)} each</div>`;

    const right = document.createElement("button");
    right.className = "btn ghost";
    right.textContent = "Remove";
    right.addEventListener("click", () => removeItem(item.id));

    top.append(left, right);

    const qty = document.createElement("input");
    qty.type = "number";
    qty.min = "1";
    qty.value = item.quantity;
    qty.addEventListener("change", (e) => updateQty(item.id, e.target.value));

    wrap.append(top, qty);
    cartItemsEl.appendChild(wrap);
  });

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discount = getPromoDiscount(subtotal, activePromo, settings);
  const shippingCost = shippingSelectEl.value === "express" ? settings.shippingExpress : settings.shippingStandard;
  const total = Math.max(0, subtotal - discount + (cart.length ? shippingCost : 0));

  subtotalEl.textContent = currency(subtotal);
  discountEl.textContent = `-${currency(discount)}`;
  shippingEl.textContent = cart.length ? currency(shippingCost) : currency(0);
  totalEl.textContent = currency(total);

  checkoutBtnEl.disabled = cart.length === 0;
}

function wireEvents() {
  categoryFilterEl.addEventListener("change", renderProducts);

  applyPromoEl.addEventListener("click", () => {
    activePromo = promoInputEl.value.trim().toUpperCase();
    renderCart();
  });

  shippingSelectEl.addEventListener("change", renderCart);

  checkoutBtnEl.addEventListener("click", () => {
    const checkoutPayload = {
      items: cart,
      promoCode: activePromo,
      shippingMethod: shippingSelectEl.value,
      shippingCost: shippingSelectEl.value === "express" ? settings.shippingExpress : settings.shippingStandard,
      settings,
      createdAt: new Date().toISOString()
    };
    localStorage.setItem("kv_artist_checkout", JSON.stringify(checkoutPayload));
    window.location.href = "checkout.html";
  });
}

function init() {
  storeNameEl.textContent = settings.storeName;
  yearEl.textContent = new Date().getFullYear();
  hydrateFilters();
  renderProducts();
  renderCart();
  wireEvents();
}

init();
