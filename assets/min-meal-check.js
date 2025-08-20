// ==========================================================================
// ICON MEALS - MINIMUM MEAL CHECK (V19 - CROSS-TAB SYNC)
// ==========================================================================
// This version hardens the cache against cross-tab contamination. If a user
// modifies the cart in another tab, this script now listens for that change
// and invalidates its local cache to prevent checking out with stale data.
//
// THE FIX:
// - A 'storage' event listener is added to the window.
// - When another tab updates the 'icon_cart_last_updated' localStorage key,
//   this script's cache is immediately invalidated.
// ==========================================================================

// Establish a global cache to store the cart state temporarily.
window.ICON_CART_CACHE = {
  cart: null,
  timestamp: null,
  TTL: 4000, // Cache cart data for 4 seconds to handle rapid clicks.
};

// Listen for global cart updates to invalidate our local cache.
document.addEventListener('cart:updated', (e) => {
  if (e.detail && e.detail.cart) {
    window.ICON_CART_CACHE.cart = e.detail.cart;
    window.ICON_CART_CACHE.timestamp = Date.now();
  } else {
    window.ICON_CART_CACHE.cart = null;
    window.ICON_CART_CACHE.timestamp = null;
  }
});

// Listen for storage events from other tabs to invalidate the cache.
window.addEventListener('storage', (event) => {
  if (event.key === 'icon_cart_last_updated') {
    window.ICON_CART_CACHE.cart = null;
    window.ICON_CART_CACHE.timestamp = null;
    console.log('Cart cache invalidated due to cross-tab update.');
  }
});

document.addEventListener('DOMContentLoaded', function () {
  const params = new URLSearchParams(window.location.search);
  const deferredDiscount = params.get('discount_code');
  if (deferredDiscount) {
    sessionStorage.setItem('deferred_discount', deferredDiscount);
  }
  const modal = document.getElementById('min-meal-modal');
  const modalExists = !!modal;
  if (!modalExists) {
    console.warn('Min-Meal Modal not found. Min-meal check disabled.');
  }

  const closeBtn = modalExists ? modal.querySelector('.min-meal-modal__close') : null;

  function showModal() {
    if (modalExists) {
      modal.classList.remove('hidden');
    }
  }

  function hideModal() {
    if (modalExists) {
      modal.classList.add('hidden');
      sessionStorage.removeItem('showMinMealModal');
    }
  }

  function proceedToNextStep(targetEl) {
    sessionStorage.removeItem('showMinMealModal');

    let checkoutUrl = targetEl.dataset && targetEl.dataset.checkoutUrl;

    if (!checkoutUrl && typeof targetEl.getAttribute === 'function') {
      checkoutUrl =
        targetEl.getAttribute('data-checkout-url') ||
        targetEl.getAttribute('href');
    }

    if (checkoutUrl) {
      if (checkoutUrl.includes('/pages/add-ons')) {
        try {
          sessionStorage.setItem('fd_source_intent', 'ADDONS_CTA');
        } catch (e) {}
      }

      const discount = sessionStorage.getItem('deferred_discount');
      if (discount && checkoutUrl.includes('/checkout')) {
        const url = new URL(checkoutUrl, window.location.origin);
        url.searchParams.set('discount', discount);
        checkoutUrl = url.pathname + url.search;
        sessionStorage.removeItem('deferred_discount');
      }
      window.location.href = checkoutUrl;
      return;
    }
    
    if (targetEl.tagName === 'FORM' && typeof targetEl.submit === 'function') {
      targetEl.submit();
    } else if (typeof targetEl.closest === 'function' && targetEl.closest('form')) {
      targetEl.closest('form').submit();
    }
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', hideModal);
  }

  if (modalExists && sessionStorage.getItem('showMinMealModal') === 'true') {
    showModal();
    sessionStorage.removeItem('showMinMealModal');
  }

  async function fetchCartWithRetry(retries = 1, delay = 500) {
    const now = Date.now();
    const cache = window.ICON_CART_CACHE;
    if (cache.cart && cache.timestamp && (now - cache.timestamp < cache.TTL)) {
      return cache.cart;
    }

    let cart;
    for (let i = 0; i <= retries; i++) {
        try {
            cart = await fetch('/cart.js').then((res) => res.json());
            if (cart.item_count > 0 || i === retries) {
                break; 
            }
            await new Promise((resolve) => setTimeout(resolve, delay));
        } catch (e) {
            console.error('Failed to fetch cart', e);
            if (i === retries) throw e;
        }
    }
    
    window.ICON_CART_CACHE.cart = cart;
    window.ICON_CART_CACHE.timestamp = now;
    return cart;
  }

  async function checkMealsAndProceed(event, targetEl) {
    event.preventDefault();
    event.stopImmediatePropagation();

    targetEl.classList.add('is-loading');
    targetEl.disabled = true;

    try {
      const cart = await fetchCartWithRetry();

      const nonMealProductTypes = [
        'Peanut Butter',
        'Protein Popcorn',
        'Seasoning',
        'Beverage',
        'OPTIONS_HIDDEN_PRODUCT'
      ];

      const mealItemCount = cart.items.reduce((count, item) => {
        if (nonMealProductTypes.includes(item.product_type)) {
          return count;
        }
        let multiplier = 1;
        if (item.variant_title && item.variant_title.toLowerCase().includes('meal')) {
          const match = item.variant_title.match(/\d+/);
          if (match) {
            multiplier = parseInt(match[0], 10);
          }
        }
        return count + item.quantity * multiplier;
      }, 0);

      if (mealItemCount > 0 && mealItemCount < 8 && modalExists) {
        showModal();
        sessionStorage.setItem('showMinMealModal', 'true');
        targetEl.classList.remove('is-loading');
        targetEl.disabled = false;
        return;
      } else {
        proceedToNextStep(targetEl);
      }
    } catch (e) {
      console.error('Meal count check failed, proceeding as a fallback.', e);
      targetEl.classList.remove('is-loading');
      targetEl.disabled = false;
      proceedToNextStep(targetEl);
    }
  }

  document.body.addEventListener(
    'click',
    function (e) {
      const selector = `
        .cart-drawer__checkout-btn,
        .cart-sidebar__checkout-btn,
        #cart_submit,
        .collection-header-section-v8__checkout-arrow-link,
        .addons-page__skip-link,
        .checkout-anyway-btn
      `;
      const btn = e.target.closest(selector.replace(/\s+/g, ''));

      if (btn && !btn.classList.contains('is-loading')) {
        if (btn.dataset.bypassMinMeal !== undefined) {
          e.preventDefault();
          e.stopImmediatePropagation();
          hideModal();
          proceedToNextStep(btn);
        } else {
          checkMealsAndProceed(e, btn);
        }
      }
    },
    true
  );

});
