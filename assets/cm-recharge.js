/*
  Custom Meal Recharge Bundle Builder
  - Relies on the globally initialized Recharge Storefront SDK.
  - Uses the documented recharge.bundle.getDynamicBundleItems flow.
  - Adds robust validation, error handling, and plan matching for Shopify Checkout.
*/

class CustomMealBuilder {
  constructor(element) {
    this.root = element;
    if (!this.root) return;
    if (this.root.dataset.cmRechargeInitialized === 'true') return;
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

    if (!this.form || !this.proteinSelect || !this.side1Select || !this.side2Select || !this.frequencySelect || !this.quantityInput || !this.addToCartButton || !this.addToCartText) {
      console.error('CustomMealBuilder: required form controls are missing.');
      return;
    }

    // --- Data from Liquid ---
    this.sectionId = this.root.dataset.sectionId || '';
    this.productHandle = this.root.dataset.productHandle || '';
    this.bundleProductId = this.root.dataset.bundleProductId;
    this.bundleVariantId = this.root.dataset.bundleVariantId;
    this.proteinCollectionHandle = this.root.dataset.proteinCollectionHandle || '';
    this.sideCollectionHandle = this.root.dataset.sideCollectionHandle || '';
    this.proteinCollectionId = this.root.dataset.proteinCollectionId;
    this.sideCollectionId = this.root.dataset.sideCollectionId;

    const sellingPlanElement = document.getElementById(`RechargeSellingPlans-${this.sectionId}`);
    try {
      this.sellingPlanGroups = sellingPlanElement ? JSON.parse(sellingPlanElement.textContent || '[]') : [];
      if (!Array.isArray(this.sellingPlanGroups)) {
        this.sellingPlanGroups = [];
      }
    } catch (parseError) {
      console.error('Failed to parse Recharge selling plans JSON:', parseError);
      this.sellingPlanGroups = [];
    }

    // --- Derived state ---
    this.state = {
      quantity: 1,
      sellingPlanId: null,
      totalPrice: 0,
      isLoading: true,
    };

    this.config = {
      bundleProductId: null,
      bundleVariantId: null,
      proteinCollectionId: null,
      sideCollectionId: null,
    };

    this.variantDetails = Object.create(null);

    if (!this.ensureRequiredIds()) {
      return;
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.initialize(), { once: true });
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
      console.error('CustomMealBuilder configuration error:', error);
      this.showError('Bundle configuration is incomplete. Please verify the assigned collections and variants.');
      return false;
    }
  }

  async initialize() {
    try {
      await this.waitForRechargeBundle();
    } catch (error) {
      console.error('Recharge bundle failed to load:', error);
      this.showError('Recharge SDK (recharge.bundle) not found. Please refresh the page or contact support.');
      return;
    }

    try {
      this.bindEvents();
      this.populateFrequencies();

      const [proteins, sides] = await Promise.all([
        this.fetchCollectionProductsByHandle(this.proteinCollectionHandle),
        this.fetchCollectionProductsByHandle(this.sideCollectionHandle)
      ]);

      this.populateSelect(this.proteinSelect, proteins, 'protein');
      this.populateSelect(this.side1Select, sides, 'side');
      this.populateSelect(this.side2Select, sides, 'side');

      this.state.isLoading = false;
      this.update();
    } catch (error) {
      console.error('Failed to initialize Custom Meal Builder:', error);
      this.showError('Could not load meal options. Please check collection handles and refresh.');
    }
  }

  waitForRechargeBundle(timeout = 10000, interval = 50) {
    return new Promise((resolve, reject) => {
      const start = Date.now();

      const checkBundle = () => {
        if (typeof window !== 'undefined' && typeof window.recharge !== 'undefined' && typeof window.recharge.bundle !== 'undefined') {
          resolve();
          return;
        }

        if (Date.now() - start >= timeout) {
          reject(new Error('recharge.bundle unavailable within timeout'));
          return;
        }

        setTimeout(checkBundle, interval);
      };

      checkBundle();
    });
  }

  bindEvents() {
    this.proteinSelect.addEventListener('change', () => this.update());
    this.side1Select.addEventListener('change', () => this.update());
    this.side2Select.addEventListener('change', () => this.update());
    this.frequencySelect.addEventListener('change', () => this.update());
    this.quantityInput.addEventListener('change', () => this.update());

    if (this.plusButton) {
      this.plusButton.addEventListener('click', () => {
        this.quantityInput.value = String(this.state.quantity + 1);
        this.update();
      });
    }

    if (this.minusButton) {
      this.minusButton.addEventListener('click', () => {
        const nextValue = Math.max(1, this.state.quantity - 1);
        this.quantityInput.value = String(nextValue);
        this.update();
      });
    }

    this.form.addEventListener('submit', (event) => this.handleAddToCart(event));
  }

  async fetchCollectionProductsByHandle(handle) {
    if (!handle) throw new Error('Collection handle is missing.');
    const response = await fetch(`/collections/${handle}/products.json?limit=250`);
    if (!response.ok) throw new Error(`Failed to load collection: /collections/${handle}/products.json`);
    const data = await response.json();
    return Array.isArray(data.products) ? data.products : [];
  }

  populateSelect(selectElement, products, type) {
    if (!selectElement) return;

    selectElement.innerHTML = `<option value="">Choose a ${type}...</option>`;

    products.forEach((product) => {
      const productId = Number(product && product.id);
      if (!Number.isFinite(productId)) return;

      const variants = Array.isArray(product.variants) ? product.variants : [];
      variants.forEach((variant) => {
        const variantId = Number(variant && variant.id);
        if (!Number.isFinite(variantId)) return;

        const option = document.createElement('option');
        option.value = String(variantId);
        option.textContent = `${product.title} - ${variant.title}`;
        option.dataset.price = String(this.toCents(variant.price));
        selectElement.appendChild(option);

        this.variantDetails[String(variantId)] = {
          productId,
          variantId,
          price: this.toCents(variant.price),
          sellingPlanAllocations: this.normalizeSellingPlanAllocations(variant.selling_plan_allocations)
        };
      });
    });

    selectElement.disabled = false;
  }

  populateFrequencies() {
    if (!this.frequencySelect) return;
    this.frequencySelect.innerHTML = '';

    const oneTimeOption = document.createElement('option');
    oneTimeOption.value = '';
    oneTimeOption.textContent = 'One-time purchase';
    this.frequencySelect.appendChild(oneTimeOption);

    this.sellingPlanGroups.forEach((group) => {
      const plans = Array.isArray(group.selling_plans) ? group.selling_plans : [];
      plans.forEach((plan) => {
        if (!plan || !plan.id) return;
        const option = document.createElement('option');
        option.value = plan.id;
        option.textContent = plan.name || 'Subscription';
        this.frequencySelect.appendChild(option);
      });
    });

    this.frequencySelect.disabled = false;
  }

  update() {
    const parsedQuantity = parseInt(this.quantityInput.value, 10);
    this.state.quantity = Number.isFinite(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : 1;
    this.quantityInput.value = String(this.state.quantity);

    this.state.sellingPlanId = this.frequencySelect.value || null;
    this.calculatePrice();
    this.validate();
  }

  calculatePrice() {
    const getPrice = (select) => {
      const option = select && select.options[select.selectedIndex];
      const cents = option ? Number(option.dataset.price) : 0;
      return Number.isFinite(cents) ? cents : 0;
    };

    const linePrice = getPrice(this.proteinSelect) + getPrice(this.side1Select) + getPrice(this.side2Select);
    this.state.totalPrice = linePrice * this.state.quantity;
    this.priceDisplay.textContent = this.formatMoney(this.state.totalPrice);
  }

  validate() {
    const hasSelections = Boolean(this.proteinSelect.value && this.side1Select.value && this.side2Select.value);
    const canSubmit = hasSelections && !this.state.isLoading;

    this.addToCartButton.disabled = !canSubmit;

    if (this.state.isLoading) {
      this.addToCartText.textContent = 'Loading...';
    } else {
      this.addToCartText.textContent = canSubmit ? 'Add to Cart' : 'Select Options';
    }

    if (canSubmit) {
      this.errorMessage.textContent = '';
    }
  }

  getSelectionDetails(selectElement) {
    const variantId = selectElement.value;
    if (!variantId) {
      throw new Error('A required selection is missing.');
    }

    const details = this.variantDetails[variantId];
    if (!details) {
      throw new Error(`Missing variant metadata for ${variantId}.`);
    }

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
      const matchedPlan = this.matchSellingPlan(variantDetails, this.state.sellingPlanId);

      if (matchedPlan && matchedPlan.sellingPlanId) {
        selection.sellingPlan = matchedPlan.sellingPlanId;
      } else if (matchedPlan && matchedPlan.deliveryIntervalUnit && matchedPlan.deliveryIntervalFrequency) {
        selection.shippingIntervalUnitType = matchedPlan.deliveryIntervalUnit;
        selection.shippingIntervalFrequency = matchedPlan.deliveryIntervalFrequency;
      } else {
        selection.sellingPlan = this.state.sellingPlanId;
      }
    }

    return selection;
  }

  async addItemsToCart(items, bundleQty = 1) {
    const lines = [];
    for (let i = 0; i < bundleQty; i += 1) {
      lines.push(...items);
    }

    const response = await fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: lines })
    });

    if (!response.ok) {
      let description = 'Failed to add items to cart.';
      try {
        const errorData = await response.json();
        if (errorData && errorData.description) {
          description = errorData.description;
        }
      } catch (parseError) {
        // ignore parse errors, keep default message
      }
      throw new Error(description);
    }

    document.dispatchEvent(new CustomEvent('cart:updated'));
  }

  async handleAddToCart(event) {
    event.preventDefault();
    if (this.addToCartButton.disabled) return;

    this.errorMessage.textContent = '';
    this.addToCartButton.disabled = true;
    this.addToCartText.textContent = 'Adding...';

    try {
      const proteinDetails = this.getSelectionDetails(this.proteinSelect);
      const side1Details = this.getSelectionDetails(this.side1Select);
      const side2Details = this.getSelectionDetails(this.side2Select);

      const bundle = {
        externalProductId: this.config.bundleProductId,
        externalVariantId: this.config.bundleVariantId,
        selections: [
          this.buildSelection(proteinDetails, this.config.proteinCollectionId),
          this.buildSelection(side1Details, this.config.sideCollectionId),
          this.buildSelection(side2Details, this.config.sideCollectionId)
        ]
      };

      const items = recharge.bundle.getDynamicBundleItems(bundle, this.productHandle);
      await this.addItemsToCart(items, this.state.quantity);

      this.addToCartText.textContent = 'Added!';
      setTimeout(() => {
        this.addToCartButton.disabled = false;
        this.update();
      }, 2000);
    } catch (error) {
      console.error('Failed to add bundle to cart:', error);
      this.addToCartButton.disabled = false;
      this.addToCartText.textContent = 'Add to Cart';
      this.showError(error && error.message ? error.message : 'There was an error adding to cart. Please try again.', false);
      this.validate();
    }
  }

  showError(message, disableForm = true) {
    if (this.errorMessage) {
      this.errorMessage.textContent = message;
    }

    if (disableForm && this.form) {
      const controls = this.form.querySelectorAll('select, button, input');
      controls.forEach((control) => {
        control.disabled = true;
      });
    }
  }

  formatMoney(cents) {
    if (!Number.isFinite(cents)) return '';
    const dollars = (cents / 100).toFixed(2);
    return `$${dollars}`;
  }

  toCents(value) {
    const amount = typeof value === 'number' ? value : parseFloat(value);
    if (!Number.isFinite(amount)) return 0;
    return Math.round(amount * 100);
  }

  parseNumericId(value, label) {
    if (value === undefined || value === null || value === '') {
      throw new Error(`${label} is missing.`);
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`${label} is invalid.`);
    }
    return parsed;
  }

  normalizeSellingPlanAllocations(allocations) {
    if (!Array.isArray(allocations)) return [];

    return allocations.map((allocation) => {
      const sellingPlan = allocation && allocation.selling_plan ? allocation.selling_plan : {};
      const deliveryPolicy = allocation && allocation.delivery_policy ? allocation.delivery_policy : sellingPlan && sellingPlan.delivery_policy ? sellingPlan.delivery_policy : {};

      return {
        sellingPlanId: allocation && allocation.selling_plan_id != null ? String(allocation.selling_plan_id) : (sellingPlan && sellingPlan.id ? String(sellingPlan.id) : null),
        deliveryIntervalUnit: deliveryPolicy && (deliveryPolicy.interval_unit || deliveryPolicy.interval_unit_type || deliveryPolicy.frequency_unit || deliveryPolicy.unit) || null,
        deliveryIntervalFrequency: deliveryPolicy && (deliveryPolicy.interval_count || deliveryPolicy.interval_frequency || deliveryPolicy.frequency) || null,
      };
    });
  }

  matchSellingPlan(variantDetails, sellingPlanId) {
    if (!sellingPlanId || !variantDetails || !Array.isArray(variantDetails.sellingPlanAllocations)) return null;
    const target = String(sellingPlanId);
    const comparableTarget = this.extractComparablePlanId(target);

    for (const allocation of variantDetails.sellingPlanAllocations) {
      if (!allocation) continue;
      const planId = allocation.sellingPlanId ? String(allocation.sellingPlanId) : '';
      if (!planId) continue;
      const comparablePlanId = this.extractComparablePlanId(planId);
      if (planId === target || comparablePlanId === comparableTarget) {
        return allocation;
      }
    }

    return null;
  }

  extractComparablePlanId(value) {
    if (!value) return '';
    const stringValue = String(value);
    if (stringValue.indexOf('/') === -1) return stringValue;
    const segments = stringValue.split('/');
    return segments[segments.length - 1];
  }
}

const initCustomMealBuilders = (scope = document) => {
  if (!scope || typeof scope.querySelectorAll !== 'function') return;
  scope.querySelectorAll('.cm-recharge').forEach((element) => new CustomMealBuilder(element));
};

initCustomMealBuilders();

document.addEventListener('shopify:section:load', (event) => {
  initCustomMealBuilders(event.target);
});
