/*
  Custom Meal Recharge Bundle Builder - v3.0 (Two-Step Selection)
  - Implements a two-step selection UI (Product -> Variant) for improved UX.
  - Dynamically renders variant option buttons based on product selection.
  - Controls hidden select elements to maintain compatibility with original pricing and cart logic.
*/

class CustomMealBuilder {
  constructor(element) {
    this.root = element;
    if (!this.root || this.root.dataset.cmRechargeInitialized === 'true') return;
    this.root.dataset.cmRechargeInitialized = 'true';

    // --- DOM Elements ---
    this.form = this.root.querySelector('[data-cm-form]');
    this.proteinSelect = this.root.querySelector('[data-protein-select]');
    this.side1Select = this.root.querySelector('[data-side1-select]');
    this.side2Select = this.root.querySelector('[data-side2-select]');
    this.frequencySelect = this.root.querySelector('[data-frequency-select]');
    this.quantityInput = this.root.querySelector('[data-qty-input]');
    this.priceDisplay = this.root.querySelector('[data-total-price]');
    this.addToCartButton = this.root.querySelector('[data-add-to-cart-button]');
    this.addToCartText = this.root.querySelector('[data-add-to-cart-text]');
    this.errorMessage = this.root.querySelector('[data-error-message]');
    this.plusButton = this.root.querySelector('[data-qty-plus]');
    this.minusButton = this.root.querySelector('[data-qty-minus]');
    this.productSelects = this.root.querySelectorAll('[data-product-select]');

    if (!this.form || !this.proteinSelect || !this.side1Select || !this.side2Select || !this.frequencySelect) {
      console.error('CustomMealBuilder: required form controls are missing.');
      return;
    }

    // --- Data from Liquid ---
    this.sectionId = this.root.dataset.sectionId || '';
    this.bundleProductId = this.root.dataset.bundleProductId;
    this.bundleVariantId = this.root.dataset.bundleVariantId;
    this.proteinCollectionHandle = this.root.dataset.proteinCollectionHandle || '';
    this.sideCollectionHandle = this.root.dataset.sideCollectionHandle || '';
    this.proteinCollectionId = this.root.dataset.proteinCollectionId;
    this.sideCollectionId = this.root.dataset.sideCollectionId;

    const sellingPlanElement = document.getElementById(`RechargeSellingPlans-${this.sectionId}`);
    try {
      this.sellingPlanGroups = sellingPlanElement ? JSON.parse(sellingPlanElement.textContent || '[]') : [];
    } catch (e) {
      this.sellingPlanGroups = [];
    }

    // --- State & Data Maps ---
    this.state = { quantity: 1, sellingPlanId: null, totalPrice: 0, isLoading: true };
    this.config = {};
    this.variantDetails = new Map();
    this.productData = { protein: [], side: [] };

    if (!this.ensureRequiredIds()) return;

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.initialize());
    } else {
      this.initialize();
    }
  }

  ensureRequiredIds() {
    try {
      this.config.bundleProductId = this.parseNumericId(this.bundleProductId, 'Bundle product ID');
      this.config.bundleVariantId = this.parseNumericId(this.bundleVariantId, 'Bundle variant ID');
      this.config.proteinCollectionId = this.parseNumericId(this.proteinCollectionId, 'Protein collection ID');
      this.config.sideCollectionId = this.parseNumericId(this.sideCollectionId, 'Side collection ID');
      return true;
    } catch (error) {
      this.showError('Bundle configuration is incomplete.');
      return false;
    }
  }

  async initialize() {
    try {
      await this.waitForRechargeBundle();
    } catch (error) {
      this.showError('Could not connect to subscription service. Please refresh.');
      return;
    }

    try {
      this.bindEvents();
      this.populateFrequencies();

      const [proteins, sides] = await Promise.all([
        this.fetchCollectionProductsByHandle(this.proteinCollectionHandle),
        this.fetchCollectionProductsByHandle(this.sideCollectionHandle)
      ]);

      this.productData.protein = this.processProductData(proteins);
      this.productData.side = this.processProductData(sides);

      this.populateProductSelect(this.root.querySelector('[data-product-select="protein"]'), this.productData.protein, 'protein');
      this.populateProductSelect(this.root.querySelector('[data-product-select="side1"]'), this.productData.side, 'side');
      this.populateProductSelect(this.root.querySelector('[data-product-select="side2"]'), this.productData.side, 'side');
      
      this.populateHiddenVariantSelects();

      this.state.isLoading = false;
      this.update();
    } catch (error) {
      this.showError('Could not load meal options. Please refresh.');
    }
  }
  
  processProductData(products) {
    return products.map(product => {
      const variants = (product.variants || []).map(variant => {
        const variantId = String(variant.id);
        this.variantDetails.set(variantId, {
          productId: product.id,
          variantId: variant.id,
          price: this.toCents(variant.price),
          sellingPlanAllocations: this.normalizeSellingPlanAllocations(variant.selling_plan_allocations)
        });
        return {
          id: variantId,
          title: variant.title,
          price: this.toCents(variant.price)
        };
      });
      return { id: product.id, title: product.title, variants };
    }).filter(p => p.variants.length > 0);
  }

  populateProductSelect(selectElement, products, type) {
    if (!selectElement) return;
    selectElement.innerHTML = `<option value="">Choose a ${type}...</option>`;
    products.forEach(product => {
      const option = document.createElement('option');
      option.value = product.id;
      option.textContent = product.title.replace(/ oz/gi, '').trim();
      selectElement.appendChild(option);
    });
    selectElement.disabled = false;
  }
  
  populateHiddenVariantSelects() {
    const allSelects = [this.proteinSelect, this.side1Select, this.side2Select];
    allSelects.forEach(select => { select.innerHTML = ''; });

    this.variantDetails.forEach((details, variantId) => {
      const option = document.createElement('option');
      option.value = variantId;
      option.dataset.price = details.price;
      // Find which selects this option should be added to
      if (this.productData.protein.some(p => p.variants.some(v => v.id === variantId))) {
        this.proteinSelect.appendChild(option.cloneNode(true));
      }
      if (this.productData.side.some(p => p.variants.some(v => v.id === variantId))) {
        this.side1Select.appendChild(option.cloneNode(true));
        this.side2Select.appendChild(option.cloneNode(true));
      }
    });
  }

  renderVariantOptions(selectionGroup, productId) {
    const container = this.root.querySelector(`[data-variant-options="${selectionGroup}"]`);
    const hiddenSelect = this.root.querySelector(`[data-${selectionGroup}-select]`);
    if (!container || !hiddenSelect) return;

    container.innerHTML = '';
    hiddenSelect.value = '';

    if (!productId) {
      this.update();
      return;
    }

    const type = selectionGroup.includes('side') ? 'side' : 'protein';
    const product = this.productData[type].find(p => String(p.id) === String(productId));

    if (product && product.variants) {
      product.variants.forEach(variant => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'variant-option-button';
        button.textContent = variant.title;
        button.dataset.variantId = variant.id;
        container.appendChild(button);
      });
    }
    this.update();
  }

  bindEvents() {
    this.productSelects.forEach(select => {
      select.addEventListener('change', (event) => {
        const selectionGroup = event.target.dataset.productSelect;
        this.renderVariantOptions(selectionGroup, event.target.value);
      });
    });
    
    this.form.addEventListener('click', (event) => {
      const button = event.target.closest('.variant-option-button');
      if (!button) return;

      const container = button.parentElement;
      const selectionGroup = container.dataset.variantOptions;
      const hiddenSelect = this.root.querySelector(`[data-${selectionGroup}-select]`);
      const variantId = button.dataset.variantId;

      if (hiddenSelect) {
        hiddenSelect.value = variantId;
        container.querySelectorAll('.variant-option-button').forEach(btn => btn.classList.remove('is-selected'));
        button.classList.add('is-selected');
        this.update();
      }
    });

    this.frequencySelect.addEventListener('change', () => this.update());
    this.quantityInput.addEventListener('change', () => this.update());
    if (this.plusButton) this.plusButton.addEventListener('click', () => { this.quantityInput.value = this.state.quantity + 1; this.update(); });
    if (this.minusButton) this.minusButton.addEventListener('click', () => { this.quantityInput.value = Math.max(1, this.state.quantity - 1); this.update(); });
    this.form.addEventListener('submit', (event) => this.handleAddToCart(event));
  }
  
  // All other methods (update, calculatePrice, validate, handleAddToCart, etc.) remain largely the same,
  // as they read from the hidden select elements which we are now controlling.
  
  waitForRechargeBundle(timeout = 10000, interval = 50) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        if (window.recharge && window.recharge.bundle) resolve();
        else if (Date.now() - start >= timeout) reject(new Error('recharge.bundle timeout'));
        else setTimeout(check, interval);
      };
      check();
    });
  }

  async fetchCollectionProductsByHandle(handle) {
    if (!handle) throw new Error('Collection handle is missing.');
    const response = await fetch(`/collections/${handle}/products.json?limit=250`);
    if (!response.ok) throw new Error(`Failed to load collection: /collections/${handle}/products.json`);
    const data = await response.json();
    return data.products || [];
  }
  
  populateFrequencies() {
    if (!this.frequencySelect) return;
    this.frequencySelect.innerHTML = '<option value="">One-time purchase</option>';
    this.sellingPlanGroups.forEach(group => {
      (group.selling_plans || []).forEach(plan => {
        const option = document.createElement('option');
        option.value = plan.id;
        option.textContent = plan.name;
        this.frequencySelect.appendChild(option);
      });
    });
    this.frequencySelect.disabled = false;
  }

  update() {
    const qty = parseInt(this.quantityInput.value, 10);
    this.state.quantity = !isNaN(qty) && qty > 0 ? qty : 1;
    this.quantityInput.value = this.state.quantity;
    this.state.sellingPlanId = this.frequencySelect.value || null;
    this.calculatePrice();
    this.validate();
  }

  calculatePrice() {
    const getPrice = (select) => {
      const option = select.options[select.selectedIndex];
      return option ? Number(option.dataset.price) || 0 : 0;
    };
    const linePrice = getPrice(this.proteinSelect) + getPrice(this.side1Select) + getPrice(this.side2Select);
    this.state.totalPrice = linePrice * this.state.quantity;
    this.priceDisplay.textContent = this.formatMoney(this.state.totalPrice);
  }

  validate() {
    const hasSelections = this.proteinSelect.value && this.side1Select.value && this.side2Select.value;
    const canSubmit = hasSelections && !this.state.isLoading;
    this.addToCartButton.disabled = !canSubmit;
    this.addToCartText.textContent = this.state.isLoading ? 'Loading...' : (canSubmit ? 'Add to Cart' : 'Select Options');
    if (canSubmit) this.errorMessage.textContent = '';
  }

  getSelectionDetails(selectElement) {
    const variantId = selectElement.value;
    if (!variantId) throw new Error('A required selection is missing.');
    const details = this.variantDetails.get(variantId);
    if (!details) throw new Error(`Missing variant metadata for ${variantId}.`);
    return details;
  }
  
  buildSelection(variantDetails, collectionId) {
    const selection = {
      collectionId,
      externalProductId: variantDetails.productId,
      externalVariantId: variantDetails.variantId,
      quantity: 1,
    };
    if (this.state.sellingPlanId) {
      selection.sellingPlan = this.state.sellingPlanId;
    }
    return selection;
  }

  async handleAddToCart(event) {
    event.preventDefault();
    if (this.addToCartButton.disabled) return;
    this.errorMessage.textContent = '';
    this.addToCartButton.disabled = true;
    this.addToCartText.textContent = 'Adding...';

    try {
      const bundle = {
        externalProductId: this.config.bundleProductId,
        externalVariantId: this.config.bundleVariantId,
        selections: [
          this.buildSelection(this.getSelectionDetails(this.proteinSelect), this.config.proteinCollectionId),
          this.buildSelection(this.getSelectionDetails(this.side1Select), this.config.sideCollectionId),
          this.buildSelection(this.getSelectionDetails(this.side2Select), this.config.sideCollectionId)
        ]
      };
      const items = recharge.bundle.getDynamicBundleItems(bundle, this.root.dataset.productHandle);
      await this.addItemsToCart(items, this.state.quantity);
      this.addToCartText.textContent = 'Added!';
      setTimeout(() => { this.addToCartButton.disabled = false; this.update(); }, 2000);
    } catch (error) {
      this.addToCartButton.disabled = false;
      this.showError(error.message || 'Error adding to cart.', false);
      this.validate();
    }
  }
  
  async addItemsToCart(items, qty) {
      const lines = Array.from({ length: qty }, () => items).flat();
      const response = await fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: lines })
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.description || 'Failed to add items to cart.');
      }
      document.dispatchEvent(new CustomEvent('cart:updated'));
  }

  showError(message, disable = true) {
    this.errorMessage.textContent = message;
    if (disable) this.form.querySelectorAll('select, button, input').forEach(el => el.disabled = true);
  }

  formatMoney(cents) { return `$${(cents / 100).toFixed(2)}`; }
  toCents(value) { return Math.round(parseFloat(value) * 100) || 0; }
  parseNumericId(val, label) {
    const id = Number(val);
    if (!Number.isFinite(id) || id <= 0) throw new Error(`${label} is invalid.`);
    return id;
  }
  normalizeSellingPlanAllocations(allocations) { return allocations || []; }
}

document.querySelectorAll('.cm-recharge').forEach(el => new CustomMealBuilder(el));
document.addEventListener('shopify:section:load', (event) => {
  event.target.querySelectorAll('.cm-recharge').forEach(el => new CustomMealBuilder(el));
});