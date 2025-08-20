/* ==========================================================================
   ADD-ONS PAGE FREE SHIPPING UPSELL (DEFINITIVE V10)
   - Robust meal counting (variant_title, title, sku, or _meals_per_unit)
   - Case-insensitive non-meal product types
   - Zero-meal guard + tidy deferred flag
   - Safe button handler (rechecks cart)
   - Extra cart events to re-evaluate state
   ========================================================================== */

(function () {
  document.addEventListener('DOMContentLoaded', function () {
    const upsell = document.querySelector('[data-double-up-upsell]');
    if (!upsell) return;

    const wrapper = document.querySelector('[data-free-delivery-target]');
    const threshold = wrapper ? parseInt(wrapper.dataset.freeDeliveryTarget, 10) : 21;

    // Normalize to lowercase for case-insensitive comparison
    const nonMealProductTypes = [
      'peanut butter',
      'protein popcorn',
      'seasoning',
      'beverage',
      'options_hidden_product'
    ];

    function isMeal(item) {
      const type = String(item.product_type || '').toLowerCase();
      const handle = String(item.handle || '').toLowerCase();

      // Exclude meal plans from upsell math
      if (type.includes('meal plan') || handle.includes('meal-plan')) return false;

      // Exclude known non-meal product types (case-insensitive)
      if (nonMealProductTypes.includes(type)) return false;

      return true;
    }

    function mealMultiplier(item) {
      // Prefer explicit override via line-item property
      if (item.properties && item.properties._meals_per_unit) {
        const n = parseInt(item.properties._meals_per_unit, 10);
        if (!isNaN(n) && n > 0) return n;
      }

      // Parse numbers from multiple sources:
      // Examples: "12-Meal", "12 Meal", "(12 Meals)", "12 Meals – Large"
      const sources = [item.variant_title, item.title, item.sku]
        .filter(Boolean)
        .map(s => String(s).toLowerCase());

      for (const src of sources) {
        const m = src.match(/(\d+)\s*[- ]*\s*meal(s)?\b/);
        if (m) {
          const n = parseInt(m[1], 10);
          if (!isNaN(n) && n > 0) return n;
        }
      }

      // Default: assume single prepared meal per unit
      return 1;
    }

    function mealCount(cart) {
      return (cart.items || []).reduce((count, item) => {
        if (!isMeal(item)) return count;
        return count + item.quantity * mealMultiplier(item);
      }, 0);
    }

    function getBuilderId(item) {
      if (!item || !item.properties) return null;
      return item.properties._boldBuilderId || item.properties.builder_id || null;
    }

    function hasFreeShipping(cart) {
      const apps = cart.cart_level_discount_applications || [];
      return apps.some(app => {
        const title = String(app.title || '').toLowerCase();
        return app.target_type === 'shipping_line' || title.includes('free shipping') || title.includes('freedelivery');
      });
    }

    function containsMealPlan(cart) {
      return (cart.items || []).some(item => {
        const type = String(item.product_type || '').toLowerCase();
        const handle = String(item.handle || '').toLowerCase();
        return type.includes('meal plan') || handle.includes('meal-plan');
      });
    }

    function fetchCart() {
      return fetch('/cart.js', { credentials: 'same-origin' }).then(res => res.json());
    }

    async function evaluate() {
      if (upsell.classList.contains('is-successful')) return;

      try {
        const cart = await fetchCart();

        // Hide when meal plan exists or free shipping already applied
        if (containsMealPlan(cart) || hasFreeShipping(cart)) {
          upsell.classList.add('hidden');
          return;
        }

        const currentMeals = mealCount(cart);

        // Keep the deferred flag tidy
        if (currentMeals >= threshold) {
          try { sessionStorage.setItem('deferred_discount', 'FREEDELIVERY'); } catch (e) { /* noop */ }
        } else {
          try { sessionStorage.removeItem('deferred_discount'); } catch (e) { /* noop */ }
        }

        // Do not show on zero-meal carts
        if (currentMeals <= 0) {
          upsell.classList.add('hidden');
          return;
        }

        const remaining = Math.max(threshold - currentMeals, 0);
        if (remaining <= 0) {
          upsell.classList.add('hidden');
          return;
        }

        const pluralS = remaining === 1 ? '' : 's';
        const titleEl = upsell.querySelector('[data-upsell-title]');
        const descriptionEl = upsell.querySelector('[data-upsell-description]');
        const btn = upsell.querySelector('[data-upsell-button]');

        if (titleEl) {
          titleEl.textContent = `Add ${remaining} more meal${pluralS} to unlock free delivery`;
        }

        if (descriptionEl) {
          descriptionEl.innerHTML = `Add <strong>${remaining} more meal${pluralS}</strong> to unlock FREE delivery. We’ll evenly increase your meals so your cart hits ${threshold}.`;
        }

        if (btn) {
          btn.textContent = `Yes, Add ${remaining} Meal${pluralS} & Save`;
          const newBtn = btn.cloneNode(true);
          btn.parentNode.replaceChild(newBtn, btn);
          newBtn.addEventListener('click', handleUpsellClick, { passive: true });
        }

        upsell.classList.remove('hidden');
      } catch (e) {
        console.error('Free shipping upsell check failed', e);
      }
    }

    async function handleUpsellClick() {
      try {
        const cart = await fetchCart();

        if (containsMealPlan(cart) || hasFreeShipping(cart)) {
          upsell.classList.add('hidden');
          return;
        }

        const currentMeals = mealCount(cart);
        const remaining = Math.max(threshold - currentMeals, 0);

        if (remaining <= 0) {
          upsell.classList.add('hidden');
          return;
        }
        try { sessionStorage.setItem('fd_source_intent', 'ADDONS_CTA'); } catch (e) { /* noop */ }
        await addMissingMeals(remaining);
      } catch (e) {
        console.error('Upsell click check failed', e);
      }
    }

    async function addMissingMeals(mealsNeeded) {
      document.body.classList.add('is-loading--cart');
      const pageWrapper = document.querySelector('.addons-page-wrapper');
      if (pageWrapper) pageWrapper.classList.add('is-loading');
      upsell.classList.add('is-loading');

      try {
        const cart = await fetchCart();
        const updates = {};

        const mealItems = (cart.items || []).filter(isMeal);
        if (mealItems.length === 0) {
          console.warn('Upsell clicked, but no qualifying meal items found in cart.');
          return;
        }

        // Mirror counts so we only increment
        cart.items.forEach(item => { updates[item.key] = item.quantity; });

        // Group builder-linked lines so we increment each member if needed
        const builderGroups = {};
        cart.items.forEach(item => {
          const id = getBuilderId(item);
          if (id) {
            if (!builderGroups[id]) builderGroups[id] = [];
            builderGroups[id].push(item);
          }
        });

        let mealsLeftToAdd = mealsNeeded;
        let idx = 0;

        while (mealsLeftToAdd > 0) {
          const itemToUpdate = mealItems[idx];
          updates[itemToUpdate.key] = (updates[itemToUpdate.key] || itemToUpdate.quantity) + 1;

          // Keep builder-linked items in sync
          const id = getBuilderId(itemToUpdate);
          if (id && builderGroups[id]) {
            builderGroups[id].forEach(groupItem => {
              if (groupItem.key !== itemToUpdate.key) {
                updates[groupItem.key] = (updates[groupItem.key] || groupItem.quantity) + 1;
              }
            });
          }

          mealsLeftToAdd--;
          idx = (idx + 1) % mealItems.length;
        }

        upsell.classList.add('is-successful');

        const res = await fetch('/cart/update.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ updates })
        });

        if (!res.ok) throw new Error('Cart update failed');

        const newCart = await res.json();

        try { sessionStorage.setItem('deferred_discount', 'FREEDELIVERY'); } catch (e) { /* noop */ }

        // Let the theme react and redraw
        document.dispatchEvent(new CustomEvent('cart:updated', { detail: { cart: newCart } }));

        setTimeout(() => { upsell.classList.add('hidden'); }, 4000);
      } catch (e) {
        console.error('Failed to update cart for free shipping upsell', e);
        upsell.classList.remove('is-successful');
      } finally {
        document.body.classList.remove('is-loading--cart');
        const pageWrapper = document.querySelector('.addons-page-wrapper');
        if (pageWrapper) pageWrapper.classList.remove('is-loading');
        upsell.classList.remove('is-loading');
      }
    }

    // Initial run + listen for multiple cart update event flavors
    evaluate();
    document.addEventListener('cart:updated', evaluate);
    document.addEventListener('ajaxCart:updated', evaluate);
    document.addEventListener('cart:change', evaluate);
  });
})();
