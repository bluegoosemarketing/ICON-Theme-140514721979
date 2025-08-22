/* =====================================================================
   Protein Popcorn BOGO module for Add-ons page (V5.1 - Integrated Gift Logic)
   - Manages the single promo banner UI.
   - Includes automatic "free gift" synchronization.
   ===================================================================== */
(function() {
  document.addEventListener('DOMContentLoaded', function() {
    const container = document.querySelector('[data-pp-bogo]');
    if (!container) return;

    const addBtn = container.querySelector('[data-pp-bogo-add]');
    const countdownEl = container.querySelector('[data-pp-bogo-countdown]');

    if (!addBtn) return;

    const params = new URLSearchParams(window.location.search);
    const devMode = params.get('bogo_dev') === '1' || params.get('pp_bogo_dev') === '1';

    const config = window.ppBogoConfig || {};

    // --- Dev Mode Fallbacks ---
    if (devMode && !config.variantId) {
      config.variantId = '41138635473083'; // Default "Buy One"
    }
    if (devMode && !config.giftVariantId) {
      config.giftVariantId = '41138635473083'; // Default "Get One" (using same for demo)
    }

    if ((!config.enabled && !devMode) || !config.variantId) {
      container.classList.add('hidden');
      return;
    }
    
    // --- Countdown Timer Logic ---
    let countdownInterval;
    function initializeCountdown(endDateString) {
      if (!endDateString || !countdownEl) {
        if(countdownEl) countdownEl.style.display = 'none';
        return;
      }
      
      const countdownDate = new Date(endDateString.replace(/-/g, '/')).getTime();
      const daysEl = countdownEl.querySelector('[data-countdown-days]');
      const hoursEl = countdownEl.querySelector('[data-countdown-hours]');
      const minsEl = countdownEl.querySelector('[data-countdown-mins]');
      const secsEl = countdownEl.querySelector('[data-countdown-secs]');
      
      if(!daysEl || !hoursEl || !minsEl || !secsEl) return;

      countdownInterval = setInterval(() => {
        const now = new Date().getTime();
        const distance = countdownDate - now;

        if (distance < 0) {
          clearInterval(countdownInterval);
          countdownEl.innerHTML = '<span class="countdown-expired">This offer has expired!</span>';
          addBtn.disabled = true;
          addBtn.querySelector('.btn-text').textContent = 'Offer Expired';
          return;
        }

        const days = Math.floor(distance / (1000 * 60 * 60 * 24));
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);

        daysEl.textContent = String(days).padStart(2, '0');
        hoursEl.textContent = String(hours).padStart(2, '0');
        minsEl.textContent = String(minutes).padStart(2, '0');
        secsEl.textContent = String(seconds).padStart(2, '0');
      }, 1000);
    }

    initializeCountdown(config.countdownEndDate);
    
    // --- Core Eligibility & Cart Logic ---
    function isMeal(item) {
      const type = String(item.product_type || '').toLowerCase();
      const nonMealTypes = ['peanut butter', 'protein popcorn', 'seasoning', 'beverage', 'options_hidden_product'];
      return !nonMealTypes.includes(type);
    }

    function mealMultiplier(item) {
      if (item.properties && item.properties._meals_per_unit) {
        const n = parseInt(item.properties._meals_per_unit, 10);
        if (!isNaN(n) && n > 0) return n;
      }
      const sources = [item.variant_title, item.title, item.sku].filter(Boolean).map(s => String(s).toLowerCase());
      for (const src of sources) {
        const m = src.match(/(\d+)\s*[- ]*\s*meal(s)?\b/);
        if (m) {
          const n = parseInt(m[1], 10);
          if (!isNaN(n) && n > 0) return n;
        }
      }
      return 1;
    }

    function mealCount(cart) {
      return (cart.items || []).reduce((count, item) => {
        if (!isMeal(item)) return count;
        return count + item.quantity * mealMultiplier(item);
      }, 0);
    }

    function fetchCart() {
      return fetch('/cart.js', { credentials: 'same-origin' }).then(r => r.json());
    }

    async function syncGift(cart, eligible) {
      if (!config.giftVariantId) return;

      const items = cart.items || [];
      const giftId = String(config.giftVariantId);
      const mainBogoItemId = String(config.variantId);

      const giftLine = items.find(i => String(i.variant_id) === giftId);
      const hasBogoItem = items.some(i => String(i.variant_id) === mainBogoItemId);
      
      try {
        if (hasBogoItem && eligible) {
          if (!giftLine) {
            await fetch('/cart/add.js', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: giftId, quantity: 1, properties: { _bogo_gift: 'true' } })
            });
            return true; // Indicates a cart change happened
          }
        } else if (giftLine) {
          await fetch('/cart/change.js', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: giftId, quantity: 0 })
          });
          return true; // Indicates a cart change happened
        }
      } catch (err) {
        console.error('PP BOGO gift sync failed', err);
      }
      return false; // No cart change
    }

    async function evaluate() {
      try {
        const cart = await fetchCart();
        const count = mealCount(cart);
        const eligible = count >= 14;

        if (eligible || devMode) {
          container.classList.remove('hidden');
        } else {
          container.classList.add('hidden');
        }

        const giftChanged = await syncGift(cart, eligible);
        if (giftChanged) {
          const newCart = await fetchCart();
          document.dispatchEvent(new CustomEvent('cart:updated', { detail: { cart: newCart } }));
        }

      } catch (e) {
        console.error('PP BOGO eval failed', e);
      }
    }

    evaluate();
    document.addEventListener('cart:updated', evaluate);

    addBtn.addEventListener('click', async () => {
      const variantId = config.variantId;
      if (!variantId) return;

      addBtn.disabled = true;
      addBtn.classList.add('is-loading');

      try {
        if (!devMode) {
          const cart = await fetchCart();
          if (mealCount(cart) < 14) {
            container.classList.add('hidden');
            return;
          }
        }

        const res = await fetch('/cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: variantId, quantity: 1 }),
        });

        if (!res.ok) throw new Error('Add to cart failed');
        
        addBtn.classList.remove('is-loading');
        addBtn.classList.add('is-added');
        addBtn.querySelector('.btn-text').textContent = 'Added!';

        // Trigger evaluation to sync the gift immediately
        await evaluate();

      } catch (e) {
        console.error('PP BOGO add failed', e);
        addBtn.disabled = false; // Re-enable on failure
        addBtn.classList.remove('is-loading');
        addBtn.querySelector('.btn-text').textContent = 'Error - Try Again';
      }
    });
  });
})();