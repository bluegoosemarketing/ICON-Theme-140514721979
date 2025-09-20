/*
  Custom Meal Recharge Bundle Builder - v3.8 (Subscription and Error Handling Fixed)
  - Correctly applies the selling_plan to the parent bundle product for Recharge subscriptions.
  - Implements a fallback to optimistically assume plan eligibility when allocation data is unavailable.
  - Enhances error handling to provide clearer feedback from Shopify's API.
  - Fixes a critical bug where variant size options would not render for Side 1 or Side 2.
  - Replaces fragile selectors with a more robust method of finding step containers.
  - Ensures UI logic works consistently across all selection steps (Protein, Side 1, Side 2).
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
    this.proteinProductSelect = this.root.querySelector('[data-product-select="protein"]');
    this.side1ProductSelect = this.root.querySelector('[data-product-select="side1"]');
    this.side2ProductSelect = this.root.querySelector('[data-product-select="side2"]');
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
    this.productImageData = new Map(); 

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

  addDebugSnippet() {
    const debugScript = document.createElement('script');
    debugScript.type = 'application/json';
    debugScript.id = 'DebugSellingPlans';
    debugScript.textContent = JSON.stringify(this.sellingPlanGroups, null, 2);
    this.root.appendChild(debugScript);
    console.log('Selling plan debug snippet added to the page.');
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
      this.addDebugSnippet(); // Add the debug snippet

      const [proteins, sides] = await Promise.all([
        this.fetchCollectionProductsByHandle(this.proteinCollectionHandle),
        this.fetchCollectionProductsByHandle(this.sideCollectionHandle)
      ]);

      this.productData.protein = this.processProductData(proteins);
      this.productData.side = this.processProductData(sides);

      this.populateProductSelect(this.proteinProductSelect, this.productData.protein, 'protein');
      this.populateProductSelect(this.side1ProductSelect, this.productData.side, 'side');
      this.populateProductSelect(this.side2ProductSelect, this.productData.side, 'side');
      
      this.populateHiddenVariantSelects();
      
      this.renderAllVisualOptions(); 
      this.bindVisualOptionEvents();

      // De-risk: Re-apply visibility for any pre-selected steps on load
      this.root.querySelectorAll('.cm-selection-step').forEach(step => {
        if (step.dataset.productSelected === 'true') {
          const vo = step.querySelector('.variant-options');
          if (vo) vo.classList.add('is-visible');
        }
      });

      this.state.isLoading = false;
      this.update({ emitMacros: false });
    } catch (error) {
      this.showError('Could not load meal options. Please refresh.');
    }
  }
  
  processProductData(products) {
    return products.map(product => {
      this.productImageData.set(String(product.id), (product.images && product.images.length > 0) ? product.images[0].src : product.image?.src);

      const variants = (product.variants || []).map(variant => {
        const variantId = String(variant.id);
        this.variantDetails.set(String(variant.id), {
          productId: product.id,
          productTitle: product.title,
          variantId: variant.id,
          variantTitle: variant.title,
          price: this.toCents(variant.price),
          sellingPlanAllocations: this.normalizeSellingPlanAllocations(variant.selling_plan_allocations || variant.sellingPlanAllocations)
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
    const step = this.root.querySelector(`[data-selection-group="${selectionGroup}"]`);
    if (!step) return;

    const container = step.querySelector('.variant-options');
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
        this.syncVisualSelection(selectionGroup, event.target.value);
      });
    });
    
    this.form.addEventListener('click', (event) => {
      const button = event.target.closest('.variant-option-button');
      if (!button) return;
      
      const step = button.closest('.cm-selection-step');
      if (!step) return;

      const selectionGroup = step.dataset.selectionGroup;
      const hiddenSelect = this.root.querySelector(`[data-${selectionGroup}-select]`);
      const variantId = button.dataset.variantId;
      const container = button.parentElement;

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
  
  renderAllVisualOptions() {
    this.productSelects.forEach(select => {
      const group = select.dataset.productSelect;
      const visualContainer = this.root.querySelector(`[data-visual-options-for="${group}"]`);
      if (!visualContainer) return;

      visualContainer.innerHTML = ''; 
      
      Array.from(select.options).slice(1).forEach(option => {
        const productId = option.value;
        const productTitle = option.textContent;
        const imageUrl = this.productImageData.get(productId) || 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
        
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'cm-product-card-visual';
        card.dataset.productId = productId;
        card.dataset.group = group;
        card.innerHTML = `
          <img src="${imageUrl}" alt="${productTitle}" class="cm-product-card-visual__image" width="56" height="56" loading="lazy">
          <span class="cm-product-card-visual__title">${productTitle}</span>
        `;
        visualContainer.appendChild(card);
      });
    });
  }

  bindVisualOptionEvents() {
    this.root.addEventListener('click', (event) => {
      const card = event.target.closest('.cm-product-card-visual');
      if (!card) return;

      const { productId, group } = card.dataset;
      
      const originalSelect = this.root.querySelector(`[data-product-select="${group}"]`);
      if (originalSelect) {
        originalSelect.value = productId;
        originalSelect.dispatchEvent(new Event('change'));
      }
    });
  }

  syncVisualSelection(group, selectedProductId) {
    const visualContainer = this.root.querySelector(`[data-visual-options-for="${group}"]`);
    if (!visualContainer) return;

    const step = visualContainer.closest('.cm-selection-step');
    if (!step) return;

    step.dataset.productSelected = !!selectedProductId;

    visualContainer.querySelectorAll('.cm-product-card-visual').forEach(card => {
      card.classList.toggle('is-selected', card.dataset.productId === selectedProductId);
    });
    
    const variantOptionsContainer = step.querySelector('.variant-options');
    if (variantOptionsContainer) {
      if (selectedProductId) {
        variantOptionsContainer.classList.add('is-visible');
      } else {
        variantOptionsContainer.classList.remove('is-visible');
      }
    }
  }

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

  getVariantLabelByValue(variantId) {
    if (!variantId) return '';
    const details = this.variantDetails.get(String(variantId));
    if (!details) return '';

    const productTitle = (details.productTitle || '').trim();
    const variantTitle = (details.variantTitle || '').trim();
    const normalizedVariantTitle = variantTitle && variantTitle.toLowerCase() !== 'default title'
      ? variantTitle
      : '';

    if (!productTitle && !normalizedVariantTitle) return '';
    if (!productTitle) return normalizedVariantTitle;
    if (!normalizedVariantTitle) return productTitle;

    if (normalizedVariantTitle.toLowerCase().includes(productTitle.toLowerCase())) {
      return normalizedVariantTitle;
    }

    return `${productTitle} - ${normalizedVariantTitle}`;
  }

  emitMacroSelections() {
    if (!window.iconMacroV2 || typeof window.iconMacroV2.update !== 'function') return;

    const payload = {
      protein: this.proteinProductSelect.value ? this.getVariantLabelByValue(this.proteinSelect?.value) : '',
      side1: this.side1ProductSelect.value ? this.getVariantLabelByValue(this.side1Select?.value) : '',
      side2: this.side2ProductSelect.value ? this.getVariantLabelByValue(this.side2Select?.value) : ''
    };

    window.iconMacroV2.update(payload);
  }

  update({ emitMacros = true } = {}) {
    const qty = parseInt(this.quantityInput.value, 10);
    this.state.quantity = !isNaN(qty) && qty > 0 ? qty : 1;
    this.quantityInput.value = this.state.quantity;
    this.state.sellingPlanId = this.frequencySelect.value || null;
    this.calculatePrice();
    this.validate();
    
    if (emitMacros) {
      this.emitMacroSelections();
    }
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
    const hasSelections = this.proteinSelect.value && this.side1Select.value;
    const canSubmit = hasSelections && !this.state.isLoading;
    this.addToCartButton.disabled = !canSubmit;
    this.addToCartText.textContent = this.state.isLoading ? 'Loading...' : (canSubmit ? 'Add to Cart' : 'Select Options');
    if (canSubmit) this.errorMessage.textContent = '';
  }

  getSelectionDetails(selectElement) {
    const variantId = selectElement.value;
    if (!variantId && selectElement !== this.side2Select) {
      throw new Error('A required selection is missing.');
    }
    if (!variantId) return null; 
    const details = this.variantDetails.get(variantId);
    if (!details) throw new Error(`Missing variant metadata for ${variantId}.`);
    return details;
  }
  
  buildSelection(variantDetails, collectionId) {
    if (!variantDetails) return null; 
    const selection = {
      collectionId,
      externalProductId: String(variantDetails.productId),
      externalVariantId: String(variantDetails.variantId),
      quantity: 1,
    };
    return selection;
  }

  async handleAddToCart(event) {
    event.preventDefault();
    if (this.addToCartButton.disabled) return;
    this.errorMessage.textContent = '';
    this.addToCartButton.disabled = true;
    this.addToCartText.textContent = 'Adding...';

    try {
      const childVariants = [
        this.getSelectionDetails(this.proteinSelect),
        this.getSelectionDetails(this.side1Select),
        this.getSelectionDetails(this.side2Select)
      ].filter(Boolean).map(v => ({ id: v.variantId, quantity: 1 }));

      if (childVariants.length < 2) {
        throw new Error('Please select a protein and at least one side.');
      }

      const parentHandle = this.root.dataset.productHandle;
      const parentVariantId = this.config.bundleVariantId;
      const planId = this.state.sellingPlanId;

      // 1) Build bundle token and line items
      const bundleId = crypto.randomUUID();
      const commonProps = {
        _rc_bundle: bundleId,
        _rc_bundle_parent: parentHandle,
        _rc_bundle_variant: String(parentVariantId)
      };

      const parentLine = {
        id: parentVariantId,
        quantity: 1,
        properties: { ...commonProps }
      };

      // Only add selling_plan if one is selected
      if (planId) {
        parentLine.selling_plan = planId;
      }

      const childLines = childVariants.map(({ id, quantity }) => ({
        id,
        quantity,
        properties: { ...commonProps } // children: NO selling_plan
      }));

      const payload = { items: [parentLine, ...childLines] };

      await this.addItemsToCart(payload, this.state.quantity);

      this.addToCartText.textContent = 'Added!';
      setTimeout(() => { this.addToCartButton.disabled = false; this.update(); }, 2000);
    } catch (error) {
      this.addToCartButton.disabled = false;
      this.showError(error.message || 'Error adding to cart.', false);
      this.validate();
    }
  }
  
  async addItemsToCart(payload, qty) {
      const allItems = Array.from({ length: qty }, () => payload.items).flat();
      const response = await fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: allItems })
      });
      if (!response.ok) {
        let msg = 'Failed to add items to cart.';
        try {
          const ct = response.headers.get('content-type') || '';
          if (ct.includes('application/json')) {
            const j = await response.json();
            msg = j?.description || j?.message || msg;
          } else {
            const t = await response.text();
            const m = t.match(/(?:<p[^>]*>|^)([^<]{8,200})(?:<\/p>|$)/i);
            msg = m ? m[1].trim() : t.slice(0, 200);
          }
        } catch {}
        throw new Error(msg);
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
