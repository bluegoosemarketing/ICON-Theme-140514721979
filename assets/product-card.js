/**
 * ICON MEALS - PRODUCT CARD COMPONENT - V16 (PERFORMANCE OPTIMIZED)
 *
 * This version centralizes cart updates to prevent redundant network calls.
 * Instead of every component fetching the cart individually after an update,
 * this component now fetches the cart state ONCE and broadcasts it with the
 * `cart:updated` event. Other components listen and use the data from the event
 * payload, eliminating the N+1 fetch problem.
 */
class ProductForm extends HTMLElement {
  constructor() {
    super();
    this.variantId = this.querySelector('[data-variant-id]').value;
    
    this.addButton = this.querySelector('.product-card__add-btn');
    this.quantityContainer = this.querySelector('.integrated-quantity');

    this.quantityInput = this.querySelector('[data-quantity-input]');
    this.minusButton = this.querySelector('[name="minus"]');
    this.plusButton = this.querySelector('[name="plus"]');
    this.textLabel = this.querySelector('.integrated-quantity__text');

    this.onExternalCartUpdate = this.handleExternalCartUpdate.bind(this);
    this.debouncedUpdateCart = this.debounce(this.updateCart.bind(this), 500);

    this.attachEventListeners();
    this.renderState();
  }

  connectedCallback() {
    document.addEventListener('cart:updated', this.onExternalCartUpdate);
  }

  disconnectedCallback() {
    document.removeEventListener('cart:updated', this.onExternalCartUpdate);
  }

  attachEventListeners() {
    this.addButton.addEventListener('click', this.onPlusClick.bind(this));
    this.plusButton.addEventListener('click', this.onPlusClick.bind(this));
    this.minusButton.addEventListener('click', this.onMinusClick.bind(this));
  }

  renderState() {
    const quantity = parseInt(this.quantityInput.value, 10);
    if (isNaN(quantity)) return;

    if (quantity > 0) {
      this.dataset.state = 'active';
      if (this.textLabel) this.textLabel.textContent = quantity;
    } else {
      this.dataset.state = 'initial';
    }
  }

  async onPlusClick() {
    const currentQuantity = parseInt(this.quantityInput.value, 10);
    const newQuantity = currentQuantity + 1;
    this.quantityInput.value = newQuantity;
    this.setLoading(true);

    if (currentQuantity === 0) {
      await this.addToCart();
    } else {
      this.debouncedUpdateCart();
    }
  }

  async onMinusClick() {
    const currentQuantity = parseInt(this.quantityInput.value, 10);
    if (currentQuantity <= 0) return;

    const newQuantity = currentQuantity - 1;
    this.quantityInput.value = newQuantity;
    this.setLoading(true);
    this.debouncedUpdateCart();
  }
  
  async addToCart() {
    try {
      await fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: this.variantId,
          quantity: 1
        })
      });
      // After adding, fetch the new cart state once.
      const cart = await (await fetch('/cart.js')).json();
      this.onCartUpdateSuccess(cart);
    } catch (error) {
      console.error('Error adding to cart:', error);
      this.setLoading(false);
    }
  }

  async updateCart() {
    const quantity = this.quantityInput.value;
    try {
      // The /cart/change.js endpoint returns the full cart object.
      const response = await fetch('/cart/change.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: this.variantId,
          quantity: quantity
        })
      });
      const cart = await response.json();
      this.onCartUpdateSuccess(cart);
    } catch (error) {
      console.error('Error updating cart:', error);
      this.setLoading(false);
    }
  }
  
  onCartUpdateSuccess(cart) {
    this.setLoading(false);
    this.renderState();
    // Broadcast that the cart has changed, and include the new cart object
    // in the event's 'detail' payload for other components to use.
    document.dispatchEvent(new CustomEvent('cart:updated', { detail: { cart } }));
  }

  setLoading(isLoading) {
    this.classList.toggle('is-loading', isLoading);
  }

  updateGlobalCart() {
    // This method is now DEPRECATED in favor of the event listener in connectedCallback
  }

  debounce(fn, wait) {
    let timeout;
    return function(...args) {
      const context = this;
      clearTimeout(timeout);
      timeout = setTimeout(() => fn.apply(context, args), wait);
    };
  }

  updateQuantityFromCart(cart) {
    try {
      const item = cart.items.find((i) => i.variant_id == this.variantId);
      const qty = item ? item.quantity : 0;
      
      // Only update the input if this component isn't already processing a change.
      if (!this.classList.contains('is-loading')) {
        this.quantityInput.value = qty;
        this.renderState();
      }
    } catch (error) {
      console.error('Error syncing product quantity from cart object:', error);
    }
  }

  async handleExternalCartUpdate(event) {
    // Prefer using the cart data from the event payload.
    if (event.detail && event.detail.cart) {
      this.updateQuantityFromCart(event.detail.cart);
    } else {
      // Fallback to fetching if the event has no data, ensuring backward compatibility.
      try {
        const response = await fetch('/cart.js');
        const cart = await response.json();
        this.updateQuantityFromCart(cart);
      } catch (error) {
        console.error('Error syncing product quantity on fallback:', error);
      }
    }
  }
}

customElements.define('product-form', ProductForm);