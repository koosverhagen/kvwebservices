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
    image: "../images/abbie/legacy/two_horses_jpg-100486-600x600.jpg",
    description: "Fine art print",
    externalProductId: 220
  },
  {
    id: "art-2",
    title: "Horse and Hound",
    category: "Print",
    price: 60,
    stock: 12,
    image: "../images/abbie/legacy/horse_and_hound_green_jpg-100488-600x600.jpg",
    description: "Fine art print",
    externalProductId: 226
  },
  {
    id: "art-3",
    title: "The Four",
    category: "Print",
    price: 60,
    stock: 12,
    image: "../images/abbie/legacy/four_riders_jpg-100487-600x600.jpg",
    description: "Fine art print",
    externalProductId: 211
  },
  {
    id: "art-4",
    title: "Two Friends",
    category: "Print",
    price: 60,
    stock: 12,
    image: "../images/abbie/legacy/Two_Friends_jpg-100504-600x600.jpg",
    description: "Fine art print",
    externalProductId: 227
  },
  {
    id: "art-5",
    title: "Going Home",
    category: "Print",
    price: 60,
    stock: 12,
    image: "../images/abbie/legacy/rider_and_hounds_jpg-100484-600x600.jpg",
    description: "Fine art print",
    externalProductId: 222
  },
  {
    id: "art-6",
    title: "Grey on Maroon",
    category: "Print",
    price: 60,
    stock: 12,
    image: "../images/abbie/legacy/Grey_on_Maroon_jpg-100501-600x600.jpg",
    description: "Fine art print",
    externalProductId: 230
  },
  {
    id: "art-7",
    title: "Debrief",
    category: "Print",
    price: 60,
    stock: 12,
    image: "../images/abbie/legacy/three_gents_and_dogs_jpg-100485-600x600.jpg",
    description: "Fine art print",
    externalProductId: 221
  },
  {
    id: "art-8",
    title: "Stable Mates",
    category: "Print",
    price: 60,
    stock: 12,
    image: "../images/abbie/legacy/Stable_Mates_jpg-100503-600x600.jpg",
    description: "Fine art print",
    externalProductId: 228
  },
  {
    id: "art-9",
    title: "Gone Away",
    category: "Print",
    price: 60,
    stock: 12,
    image: "../images/abbie/legacy/hunt_and_fox_jpg-100482-600x600.jpg",
    description: "Fine art print",
    externalProductId: 224
  },
  {
    id: "art-10",
    title: "Four Ready",
    category: "Print",
    price: 60,
    stock: 12,
    image: "../images/abbie/legacy/Four_Ready_jpg-100500-600x600.jpg",
    description: "Fine art print",
    externalProductId: 231
  },
  {
    id: "art-11",
    title: "Black on Red",
    category: "Print",
    price: 60,
    stock: 12,
    image: "../images/abbie/legacy/Black_on_Red_jpg-100498-600x600.jpg",
    description: "Fine art print",
    externalProductId: 233
  },
  {
    id: "art-12",
    title: "Friends",
    category: "Print",
    price: 60,
    stock: 12,
    image: "../images/abbie/legacy/Horse_dog_right_jpg-100481-600x600.jpg",
    description: "Fine art print",
    externalProductId: 225
  },
  {
    id: "art-13",
    title: "Hound Show",
    category: "Print",
    price: 60,
    stock: 12,
    image: "../images/abbie/legacy/Hound_Show_jpg-100502-600x600.jpg",
    description: "Fine art print",
    externalProductId: 229
  },
  {
    id: "art-14",
    title: "Chestnut on Green",
    category: "Print",
    price: 60,
    stock: 12,
    image: "../images/abbie/legacy/Chestnut_on_Green_jpg-100499-600x600.jpg",
    description: "Fine art print",
    externalProductId: 232
  },
  {
    id: "art-15",
    title: "Bay on Orange",
    category: "Print",
    price: 60,
    stock: 12,
    image: "../images/abbie/legacy/Bay_on_Orange_jpg-100497-600x600.jpg",
    description: "Fine art print",
    externalProductId: 234
  },
  {
    id: "art-16",
    title: "Leave It",
    category: "Print",
    price: 60,
    stock: 12,
    image: "../images/abbie/legacy/ladies_and_dogs_jpg-100483-600x600.jpg",
    description: "Fine art print",
    externalProductId: 223
  },
  {
    id: "art-17",
    title: "Ukraine",
    category: "Print",
    price: 60,
    stock: 12,
    image: "../images/abbie/legacy/Ukraine_jpg-100513-600x600.jpg",
    description: "Fine art print",
    externalProductId: 241
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

  const isOld3ItemSeed =
    parsed.length <= 3 &&
    parsed.every((product) => /^art-[1-3]$/.test(String(product.id || ""))) &&
    parsed.some((product) => !product.image);

  const isOld5ItemSeed =
    parsed.length === 5 &&
    parsed.every((product) => /^art-[1-5]$/.test(String(product.id || ""))) &&
    parsed.some((product) =>
      ["Gentle Morning Walk", "Quiet Field Study", "Companions", "Blue Horizon", "Soft Light"].includes(
        String(product.title || "")
      )
    );

  const isShortAbbieSeed =
    parsed.length < defaultProducts.length && parsed.every((product) => /^art-\d+$/.test(String(product.id || "")));

  const shouldResetToAbbieDefaults = Array.isArray(parsed) && (isOld3ItemSeed || isOld5ItemSeed || isShortAbbieSeed);

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
    meta.classList.add("has-tooltip");
    meta.setAttribute("data-tooltip", "Print on A3 paper. Image size 250mm high.");
    meta.setAttribute("tabindex", "0");

    meta.addEventListener("click", () => {
      meta.classList.toggle("show-tooltip");
    });

    meta.addEventListener("blur", () => {
      meta.classList.remove("show-tooltip");
    });

    meta.addEventListener("mouseleave", () => {
      meta.classList.remove("show-tooltip");
    });

    meta.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        meta.classList.toggle("show-tooltip");
      }
      if (event.key === "Escape") {
        meta.classList.remove("show-tooltip");
      }
    });
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
  mirrorToExternalCart(product, 1);
}

function ensureExternalMirrorFrame() {
  let frame = document.getElementById("external-cart-mirror-frame");
  if (frame) return frame;

  frame = document.createElement("iframe");
  frame.id = "external-cart-mirror-frame";
  frame.name = "external-cart-mirror-frame";
  frame.style.display = "none";
  frame.setAttribute("aria-hidden", "true");
  document.body.appendChild(frame);
  return frame;
}

function mirrorToExternalCart(product, quantity) {
  if (!product || !product.externalProductId) return;

  ensureExternalMirrorFrame();

  const form = document.createElement("form");
  form.method = "POST";
  form.action = "https://artprinthub.com/index.php?rt=checkout/cart";
  form.target = "external-cart-mirror-frame";
  form.style.display = "none";

  const productIdInput = document.createElement("input");
  productIdInput.type = "hidden";
  productIdInput.name = "product_id";
  productIdInput.value = String(product.externalProductId);

  const quantityInput = document.createElement("input");
  quantityInput.type = "hidden";
  quantityInput.name = "quantity";
  quantityInput.value = String(quantity || 1);

  const redirectInput = document.createElement("input");
  redirectInput.type = "hidden";
  redirectInput.name = "redirect";
  redirectInput.value = `https://artprinthub.com/index.php?rt=product/product&product_id=${product.externalProductId}`;

  form.appendChild(productIdInput);
  form.appendChild(quantityInput);
  form.appendChild(redirectInput);
  document.body.appendChild(form);
  form.submit();
  form.remove();
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

    const externalCartUrl = "https://artprinthub.com/index.php?rt=checkout/cart";

    cart.forEach((item) => {
      const product = products.find((candidate) => candidate.id === item.id);
      if (product) {
        mirrorToExternalCart(product, item.quantity);
      }
    });

    setTimeout(() => {
      window.location.href = externalCartUrl;
    }, 900);
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
