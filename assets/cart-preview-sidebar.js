/**
 * ICON MEALS - CART MANAGER - V21 (DEFINITIVE FIX)
 *
 * This version corrects the section ID targeting and CSS selectors to perfectly
 * match the working `codex` implementation, finally unifying the live-update
 * behavior across all three cart views (drawer, sidebar, and page).
 *
 * THE FIX:
 * - SECTION_IDS now correctly targets 'template--cart', which is the actual section ID.
 * - All relevant selectors for the cart page have been added to ensure the script
 *   can find and interact with the quantity buttons, items, and the main form.
 * - Loading state selectors now also include the cart page form.
 */
(function() {
  'use strict';

  const selectors = {
    sidebarWrapper: '.cart-sidebar-section-wrapper',
    // CORRECTED: Added all necessary item selectors
    cartItem: '.cart-sidebar__item, .cart-drawer__item, .cart-page__item',
    // CORRECTED: Added the input selector for the cart page
    qtyValue: '.cart-sidebar__quantity-value, .cart-drawer__quantity-value, .quantity-selector',
    // CORRECTED: Added all necessary button selectors
    plusBtn: '[data-action="plus"], .qty-plus',
    minusBtn: '[data-action="minus"], .qty-minus',
    removeBtn: '[data-action="remove"], .cart-page__remove-link',
    cartToggleButton: '.slide-menu-cart',
    mainDrawer: '#cartSlideoutWrapper',
    // CORRECTED: The selector for the cart page form was correct but is now properly used
    cartPageForm: 'form.cart[data-wetheme-section-id="cart"]',
    drawerCloseBtn: '.cart-drawer__close-btn',
    continueShoppingBtn: '.cart-drawer__continue-btn',
    checkoutBtn: '.cart-sidebar__checkout-btn, .cart-drawer__checkout-btn, #cart_submit',
  };

  // THE DEFINITIVE FIX: Use 'template--cart' as the section ID
  const SECTION_IDS = ['cart-preview-sidebar', 'cart-drawer', 'template--cart', ...(window.cartSectionIds || [])];

  class CartManager {
    constructor() {
      this.sectionIds = SECTION_IDS;
      this.init();
    }

    async getAssociatedKeys(baseKey) {
      let builderId = null;
      let rcBundleId = null;
      let cartData = null;

      const domItem = document.querySelector(`[data-line-key="${baseKey}"]`);
      if (domItem) {
        builderId = domItem.getAttribute('data-bold-builder-id') || domItem.getAttribute('data-builder-id');
        rcBundleId = domItem.getAttribute('data-rc-bundle-id');
      }

      if (!builderId || !rcBundleId) {
        cartData = await fetch('/cart.js').then(r => r.json());
        const item = cartData.items.find(i => i.key === baseKey);
        if (item && item.properties) {
          if (!builderId) {
            builderId = item.properties._boldBuilderId || item.properties.builder_id || null;
          }
          if (!rcBundleId) {
            rcBundleId = item.properties._rc_bundle || null;
          }
        }
      }

      const keys = new Set([baseKey]);

      if (builderId) {
        document.querySelectorAll(`[data-builder-id="${builderId}"], [data-bold-builder-id="${builderId}"]`).forEach(el => {
          const itemKey = el.getAttribute('data-line-key');
          if (itemKey) keys.add(itemKey);
        });
        if (!cartData) {
          cartData = await fetch('/cart.js').then(r => r.json());
        }
        cartData.items.forEach(item => {
          if (item.properties && (item.properties._boldBuilderId === builderId || item.properties.builder_id === builderId)) {
            keys.add(item.key);
          }
        });
      }

      if (rcBundleId) {
        if (!cartData) {
          cartData = await fetch('/cart.js').then(r => r.json());
        }
        cartData.items.forEach(item => {
          if (item.properties && item.properties._rc_bundle === rcBundleId) {
            keys.add(item.key);
          }
        });
      }

      return [...keys];
    }

    init() {
      this.attachEventHandlers();
    }

    attachEventHandlers() {
      document.addEventListener('cart:updated', (event) => {
        const detail = event.detail || {};
        if (detail.sections) {
          this.updateSections(detail.sections);
          this.hideLoadingState();
          if (typeof window.initMobileNav === 'function') {
            try { window.initMobileNav(); } catch (e) { console.error('Error reinitializing mobile nav:', e); }
          }
        } else {
          this.render();
        }
        if (detail.cart) {
          this.updateCartCount(detail.cart);
        }
      });

      document.body.addEventListener('click', async (event) => {
        const cartToggleButton = event.target.closest(selectors.cartToggleButton);
        const cartItem = event.target.closest(selectors.cartItem);
        const closeButton = event.target.closest(selectors.drawerCloseBtn);
        const continueButton = event.target.closest(selectors.continueShoppingBtn);

        if (event.target.closest(selectors.checkoutBtn)) {
          return;
        }

        if (closeButton || continueButton) {
          event.preventDefault();
          const wethemeDrawer = window.wetheme && window.wetheme.drawer;
          if (wethemeDrawer && wethemeDrawer.slideouts && wethemeDrawer.slideouts.right && typeof wethemeDrawer.slideouts.right.close === 'function') {
            wethemeDrawer.slideouts.right.close();
          }
        }

        if (cartToggleButton) {
          event.preventDefault();
          await this.render();
          const drawer = document.querySelector(selectors.mainDrawer);
          if (drawer) drawer.dispatchEvent(new CustomEvent('cart:open'));
          return;
        }

        if (cartItem) {
          const plusButton = event.target.closest(selectors.plusBtn);
          const minusButton = event.target.closest(selectors.minusBtn);
          const removeButton = event.target.closest(selectors.removeBtn);

          if (!plusButton && !minusButton && !removeButton) return;
          event.preventDefault();

          const key = cartItem.dataset.lineKey;
          if (!key) return;
          
          if (removeButton) {
            this.updateQuantity(key, 0);
            return;
          }

          // New logic for plus/minus based on team direction.
          // This fetches the current quantity from the cart state rather than the DOM, which is more reliable.
          // It then calls the existing `updateQuantity` method, which correctly handles bundle updates and section rendering.
          this.showLoadingState();
          try {
            const cart = await fetch('/cart.js').then(r => r.json());
            const sample = cart.items.find(i => i.key === key);
            if (!sample) {
              this.hideLoadingState();
              return;
            }

            const delta = plusButton ? 1 : -1;
            const newQty = Math.max(0, (sample.quantity || 0) + delta);
            
            await this.updateQuantity(key, newQty);
          } catch (error) {
            console.error('Error updating cart quantity:', error);
            this.hideLoadingState();
          }
        }
      });

      document.body.addEventListener('change', (event) => {
        const input = event.target.closest(selectors.qtyValue);
        if (!input) return;
        const cartItem = input.closest(selectors.cartItem);
        if (!cartItem) return;
        event.preventDefault();
        const key = cartItem.dataset.lineKey;
        const newQty = parseInt(input.value, 10);
        if (key && !isNaN(newQty)) this.updateQuantity(key, newQty);
      });
    }

    async updateQuantity(key, quantity) {
      this.showLoadingState();
      try {
        const keys = await this.getAssociatedKeys(key);
        const updates = {};
        keys.forEach(k => { updates[k] = quantity; });

        const response = await fetch(`/cart/update.js?sections=${this.sectionIds.join(',')}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ updates })
        });
        const data = await response.json();

        document.dispatchEvent(new CustomEvent('cart:updated', {
          detail: { cart: data, sections: data.sections }
        }));

      } catch (error) {
        console.error('Error updating cart:', error);
        this.hideLoadingState();
      }
    }

    async render() {
      this.showLoadingState();
      try {
        const sectionsUrl = `?sections=${this.sectionIds.join(',')}`;
        const [sectionsResp, cartResp] = await Promise.all([
          fetch(sectionsUrl),
          fetch('/cart.js')
        ]);
        const [sections, cart] = await Promise.all([
          sectionsResp.json(),
          cartResp.json()
        ]);
        document.dispatchEvent(new CustomEvent('cart:updated', { detail: { cart, sections } }));
      } catch (error) {
        console.error('Error rendering cart sections:', error);
        this.hideLoadingState();
      }
    }

    updateSections(sections) {
      this.updateSection('cart-drawer', selectors.mainDrawer, sections);
      this.updateSection('cart-preview-sidebar', selectors.sidebarWrapper, sections);
      // THE DEFINITIVE FIX: Use the correct section ID 'template--cart' to find and update the page content.
      this.updateSection('template--cart', selectors.cartPageForm, sections);

      Object.keys(sections).forEach(id => {
        if (['cart-drawer', 'cart-preview-sidebar', 'template--cart'].includes(id)) return;
        this.updateSection(id, `[data-section-id="${id}"]`, sections);
      });
    }

    updateSection(sectionId, selector, sectionsData) {
      const container = document.querySelector(selector);
      const newHtml = sectionsData[sectionId];
      if (!container || typeof newHtml === 'undefined') return;
      
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = newHtml;

      const newContent = tempDiv.querySelector(selector);
      if (newContent) {
        container.innerHTML = newContent.innerHTML;
      } else {
        // Fallback for sections where the root element is the section itself
        container.innerHTML = tempDiv.innerHTML;
      }
    }

    showLoadingState() {
      document.body.classList.add('is-loading--cart');
      // CORRECTED: Ensure the cart page form is included in the loading state selectors
      document
        .querySelectorAll(`${selectors.sidebarWrapper}, ${selectors.mainDrawer}, ${selectors.cartPageForm}`)
        .forEach(el => el.classList.add('is-loading'));
    }

    hideLoadingState() {
      document.body.classList.remove('is-loading--cart');
      // CORRECTED: Ensure the cart page form is included in the loading state selectors
      document
        .querySelectorAll(`${selectors.sidebarWrapper}, ${selectors.mainDrawer}, ${selectors.cartPageForm}`)
        .forEach(el => el.classList.remove('is-loading'));
    }
    
    updateCartCount(cart) {
      const visibleCount = (cart.items || []).reduce((total, item) => {
        if (item.product_type === 'OPTIONS_HIDDEN_PRODUCT') return total;
        let itemCount = item.quantity;
        if (item.variant_title && /meal/i.test(item.variant_title)) {
          const match = item.variant_title.match(/^\d+/);
          if (match) {
            const multiplier = parseInt(match[0], 10);
            if (!isNaN(multiplier)) itemCount *= multiplier;
          }
        }
        return total + itemCount;
      }, 0);

      document.querySelectorAll('.cart-item-count-header').forEach(el => {
        el.textContent = visibleCount;
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    window.cartManager = new CartManager();
    if (window.wetheme && window.wetheme.theme) {
      window.wetheme.theme.updateCartDrawer = async function (cart) {
        document.dispatchEvent(new CustomEvent('cart:updated', { detail: { cart } }));
      };
    }
  });
})();