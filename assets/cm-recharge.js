import Recharge from 'https://cdn.rechargeapps.com/storefront-sdk/latest/recharge-storefront.min.js';

// Basic bundle builder for Custom Meal using Recharge Storefront API
// Handles option selection, price calculation, validation and add to cart

async function initBundleBuilder() {
  const root = document.querySelector('.cm-recharge');
  if (!root || !Recharge) return;

  const client = new Recharge.StorefrontClient(window.rechargeStorefrontApiKey || '', {
    myshopify_domain: window.Shopify && Shopify.shop
  });

  const proteinHandle = root.dataset.proteinHandle;
  const sideHandle = root.dataset.sideHandle;
  const proteinSelect = root.querySelector('[data-protein-select]');
  const side1Select = root.querySelector('[data-side1-select]');
  const side2Select = root.querySelector('[data-side2-select]');
  const seasoningField = root.querySelector('[data-seasoning-field]');
  const freqContainer = root.querySelector('[data-frequency-options]');
  const qtyInput = root.querySelector('[data-qty-input]');
  const totalDisplay = root.querySelector('[data-total-price]');
  const addBtn = root.querySelector('[data-add]');
  const errorBox = root.querySelector('[data-error]');

  const productData = JSON.parse(root.nextElementSibling?.textContent || '{}');
  const sellingPlans = JSON.parse(root.nextElementSibling?.nextElementSibling?.textContent || '[]');

  const state = {
    protein: null,
    side1: null,
    side2: null,
    qty: 1,
    frequency: null,
    prices: {}
  };

  function money(cents) {
    return Shopify.formatMoney(cents, Shopify.money_format || '${{amount}}');
  }

  function updateTotal() {
    const ids = [state.protein, state.side1, state.side2].filter(Boolean);
    const sum = ids.reduce((acc, id) => acc + (state.prices[id] || 0), 0) * state.qty;
    totalDisplay.textContent = ids.length ? money(sum) : '';
  }

  function validate() {
    const valid = state.protein && state.side1 && state.side2;
    addBtn.disabled = !valid;
    errorBox.textContent = valid ? '' : 'Please choose 1 protein and 2 sides';
    return valid;
  }

  function update() {
    updateTotal();
    validate();
  }

  // Quantity controls
  root.querySelector('[data-qty-plus]').addEventListener('click', () => {
    state.qty++;
    qtyInput.value = state.qty;
    update();
  });
  root.querySelector('[data-qty-minus]').addEventListener('click', () => {
    if (state.qty > 1) {
      state.qty--;
      qtyInput.value = state.qty;
      update();
    }
  });

  // load collection products
  async function loadCollection(handle) {
    const res = await client.collectionByHandle(handle, { productsFirst: 50 });
    return res?.collection?.products?.edges?.map(e => e.node) || [];
  }

  function populate(select, products) {
    select.innerHTML = '<option value="">Select</option>';
    products.forEach(p => {
      p.variants.edges.forEach(({ node }) => {
        const opt = document.createElement('option');
        opt.value = node.id;
        opt.textContent = `${p.title} - ${node.title}`;
        state.prices[node.id] = parseInt(node.price.amount * 100);
        select.appendChild(opt);
      });
    });
  }

  const [proteins, sides] = await Promise.all([
    loadCollection(proteinHandle),
    loadCollection(sideHandle)
  ]);
  populate(proteinSelect, proteins);
  populate(side1Select, sides);
  populate(side2Select, sides);

  // show seasoning field if param exists
  const params = new URLSearchParams(location.search);
  if (params.get('seasoning') !== null) {
    seasoningField.hidden = false;
    root.querySelector('[data-seasoning-input]').value = params.get('seasoning');
  }

  // frequency options
  const oneTime = document.createElement('label');
  oneTime.innerHTML = `<input type="radio" name="freq" value=""> One-time purchase`;
  freqContainer.appendChild(oneTime);
  sellingPlans.forEach(group => {
    group.selling_plans.forEach(plan => {
      const lbl = document.createElement('label');
      lbl.innerHTML = `<input type="radio" name="freq" value="${plan.id}"> ${plan.options[0].value}`;
      freqContainer.appendChild(lbl);
    });
  });
  freqContainer.addEventListener('change', e => {
    state.frequency = e.target.value || null;
  });

  function prefill(select, value) {
    if (!value) return;
    const opt = select.querySelector(`option[value="${value}"]`);
    if (opt) {
      select.value = value;
      select.dispatchEvent(new Event('change'));
    }
  }

  proteinSelect.addEventListener('change', e => { state.protein = e.target.value || null; update(); });
  side1Select.addEventListener('change', e => { state.side1 = e.target.value || null; update(); });
  side2Select.addEventListener('change', e => { state.side2 = e.target.value || null; update(); });

  // URL prefill
  prefill(proteinSelect, params.get('protein'));
  prefill(side1Select, params.get('side1'));
  prefill(side2Select, params.get('side2'));
  const freq = params.get('freq');
  if (freq) {
    const radio = freqContainer.querySelector(`input[value="${freq}"]`);
    if (radio) {
      radio.checked = true;
      state.frequency = freq;
    }
  }

  update();

  // handle add to cart
  root.querySelector('[data-cm-form]').addEventListener('submit', async e => {
    e.preventDefault();
    if (!validate()) return;

    const lines = [state.protein, state.side1, state.side2].map(id => ({
      variant_id: id,
      quantity: state.qty,
      selling_plan_id: state.frequency || undefined
    }));

    for (const line of lines) {
      await client.cart.addLineItem(line);
    }

    document.dispatchEvent(new CustomEvent('cart:refresh'));
    addBtn.classList.add('is-added');
  });
}

document.addEventListener('DOMContentLoaded', initBundleBuilder);
