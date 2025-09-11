/*
  REVISED - v4.0
  Recharge Custom Bundle Builder for ICON Meals
  - Relies on globally initialized `recharge` object from theme.liquid.
  - Uses Shopify's products.json endpoint for fetching data.
  - Implements the official recharge.bundle.getDynamicBundleItems workflow.
*/

class CustomMealBuilder {
  constructor(element) {
    this.root = element;
    if (!this.root) return;

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
    
    // --- Data from Liquid ---
    this.productHandle = this.root.dataset.productHandle;
    this.bundleProductId = this.root.dataset.bundleProductId;
    this.bundleVariantId = this.root.dataset.bundleVariantId;
    this.proteinCollectionHandle = this.root.dataset.proteinCollectionHandle;
    this.sideCollectionHandle = this.root.dataset.sideCollectionHandle;
    this.proteinCollectionId = this.root.dataset.proteinCollectionId;
    this.sideCollectionId = this.root.dataset.sideCollectionId;
    this.sellingPlanGroups = JSON.parse(document.getElementById(`RechargeSellingPlans-${this.root.dataset.sectionId}`).textContent);

    // --- State ---
    this.state = {
      quantity: 1,
      sellingPlanId: null,
      totalPrice: 0,
      isLoading: true,
    };
    
    document.addEventListener('DOMContentLoaded', () => this.initialize());
  }

  async initialize() {
    if (typeof recharge === 'undefined') {
      this.showError('Recharge SDK could not be loaded. Contact support.');
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
      this.showError('Could not load meal options. Please refresh the page.');
    }
  }

  bindEvents() {
    this.proteinSelect.addEventListener('change', () => this.update());
    this.side1Select.addEventListener('change', () => this.update());
    this.side2Select.addEventListener('change', () => this.update());
    this.frequencySelect.addEventListener('change', () => this.update());
    this.quantityInput.addEventListener('change', () => this.update());

    this.root.querySelector('[data-qty-plus]').addEventListener('click', () => { this.quantityInput.value++; this.update(); });
    this.root.querySelector('[data-qty-minus]').addEventListener('click', () => { if (this.quantityInput.value > 1) { this.quantityInput.value--; this.update(); }});

    this.form.addEventListener('submit', (e) => this.handleAddToCart(e));
  }
  
  async fetchCollectionProductsByHandle(handle) {
    if (!handle) throw new Error(`Collection handle is missing.`);
    const response = await fetch(`/collections/${handle}/products.json?limit=250`);
    if (!response.ok) throw new Error(`Failed to load collection: /collections/${handle}/products.json`);
    const data = await response.json();
    return data.products || [];
  }

  populateSelect(selectElement, products, type) {
    selectElement.innerHTML = `<option value="">Choose a ${type}...</option>`;
    products.forEach(product => {
      product.variants.forEach(variant => {
        const option = document.createElement('option');
        option.value = variant.id; // Use numeric ID for selection state
        option.textContent = `${product.title} - ${variant.title}`;
        option.dataset.price = Math.round(parseFloat(variant.price) * 100);
        option.dataset.productId = product.id; // Store numeric product ID
        option.dataset.variantId = variant.id; // Store numeric variant ID
        selectElement.appendChild(option);
      });
    });
    selectElement.disabled = false;
  }
  
  populateFrequencies() {
    this.frequencySelect.innerHTML = '';
    const oneTimeOption = document.createElement('option');
    oneTimeOption.value = "";
    oneTimeOption.textContent = "One-time purchase";
    this.frequencySelect.appendChild(oneTimeOption);

    this.sellingPlanGroups.forEach(group => {
      group.selling_plans.forEach(plan => {
        const option = document.createElement('option');
        option.value = plan.id;
        option.textContent = plan.name;
        this.frequencySelect.appendChild(option);
      });
    });
    this.frequencySelect.disabled = false;
  }

  update() {
    this.state.quantity = parseInt(this.quantityInput.value, 10);
    this.state.sellingPlanId = this.frequencySelect.value || null;
    this.calculatePrice();
    this.validate();
  }

  calculatePrice() {
    let linePrice = 0;
    const getPrice = (select) => {
      const selectedOption = select.options[select.selectedIndex];
      return selectedOption ? parseFloat(selectedOption.dataset.price) || 0 : 0;
    };
    
    linePrice += getPrice(this.proteinSelect);
    linePrice += getPrice(this.side1Select);
    linePrice += getPrice(this.side2Select);
    
    this.state.totalPrice = linePrice * this.state.quantity;
    this.priceDisplay.textContent = this.formatMoney(this.state.totalPrice);
  }

  validate() {
    const isValid = this.proteinSelect.value && this.side1Select.value && this.side2Select.value;
    this.addToCartButton.disabled = !isValid;
    this.addToCartText.textContent = isValid ? 'Add to Cart' : 'Complete Your Meal';
    if(isValid) this.errorMessage.textContent = '';
  }

  async addItemsToCart(items, bundleQty = 1) {
    const lines = [];
    for (let i = 0; i < bundleQty; i++) lines.push(...items);
  
    const response = await fetch('/cart/add.js', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ items: lines })
    });
  
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.description || 'Failed to add items to cart.');
    }
    document.dispatchEvent(new CustomEvent('cart:updated'));
  }

  async handleAddToCart(event) {
    event.preventDefault();
    this.addToCartButton.disabled = true;
    this.addToCartText.textContent = 'Adding...';

    const getSelectionData = (select) => {
        const option = select.options[select.selectedIndex];
        return {
            productId: parseInt(option.dataset.productId),
            variantId: parseInt(option.dataset.variantId)
        };
    };

    const proteinData = getSelectionData(this.proteinSelect);
    const side1Data = getSelectionData(this.side1Select);
    const side2Data = getSelectionData(this.side2Select);

    const bundle = {
      externalProductId: parseInt(this.bundleProductId),
      externalVariantId: parseInt(this.bundleVariantId),
      selections: [
        { collectionId: parseInt(this.proteinCollectionId), externalProductId: proteinData.productId, externalVariantId: proteinData.variantId, quantity: 1, sellingPlan: this.state.sellingPlanId ? parseInt(this.state.sellingPlanId) : null },
        { collectionId: parseInt(this.sideCollectionId), externalProductId: side1Data.productId, externalVariantId: side1Data.variantId, quantity: 1, sellingPlan: this.state.sellingPlanId ? parseInt(this.state.sellingPlanId) : null },
        { collectionId: parseInt(this.sideCollectionId), externalProductId: side2Data.productId, externalVariantId: side2Data.variantId, quantity: 1, sellingPlan: this.state.sellingPlanId ? parseInt(this.state.sellingPlanId) : null }
      ]
    };

    try {
      const items = recharge.bundle.getDynamicBundleItems(bundle, this.productHandle);
      await this.addItemsToCart(items, this.state.quantity);
      
      this.addToCartText.textContent = 'Added!';
      setTimeout(() => {
        this.addToCartText.textContent = 'Add to Cart';
        this.validate();
      }, 2000);

    } catch(error) {
      console.error('Failed to add bundle to cart:', error);
      this.showError('There was an error adding to cart. Please try again.');
      this.validate();
    }
  }

  showError(message) {
    this.errorMessage.textContent = message;
    this.form.querySelectorAll('select, button, input').forEach(el => el.disabled = true);
  }

  formatMoney(cents) {
    if (isNaN(cents)) return '';
    const dollars = (cents / 100).toFixed(2);
    return `$${dollars}`;
  }
}

const builderElement = document.querySelector('.cm-recharge');
if (builderElement) {
  new CustomMealBuilder(builderElement);
}