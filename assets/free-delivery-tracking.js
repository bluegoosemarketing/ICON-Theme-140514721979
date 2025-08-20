/* ==========================================================================
   FREE DELIVERY PROMO TRACKING
   Tracks upsell visibility and threshold crossing using cart attributes.
   Activated only when included (theme setting enable_free_delivery_promo).
   ========================================================================== */
(function () {
  const promo = window.freeDeliveryPromo;
  if (!promo || !promo.threshold) return;

  const threshold = Math.max(parseInt(promo.threshold, 10) || 0, 1);
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
    if (type.includes('meal plan') || handle.includes('meal-plan')) return false;
    if (nonMealProductTypes.includes(type)) return false;
    return true;
  }

  function mealMultiplier(item) {
    if (item.properties && item.properties._meals_per_unit) {
      const n = parseInt(item.properties._meals_per_unit, 10);
      if (!isNaN(n) && n > 0) return n;
    }
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
    return 1;
  }

  function mealCount(cart) {
    return (cart.items || []).reduce((count, item) => {
      if (!isMeal(item)) return count;
      return count + item.quantity * mealMultiplier(item);
    }, 0);
  }

  function sendAttributeUpdate(attributes) {
    fetch('/cart/update.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attributes })
    }).catch(err => console.error('FD attribute update failed', err));
  }

  let lastMet = null;

  function evaluate(cart) {
    const attrs = cart.attributes || {};
    const attrSeen = String(attrs.fd_seen).toLowerCase() === 'true';
    const attrMet = String(attrs.fd_threshold_met).toLowerCase() === 'true';
    const attrSource = attrs.fd_source;

    const count = mealCount(cart);
    const met = count >= threshold;

    const prevMet = lastMet === null ? attrMet : lastMet;
    const updates = {};

    if (count >= 8 && !attrSeen) {
      updates.fd_seen = true;
    }

    if (attrMet !== met) {
      updates.fd_threshold_met = met;
    }

    const crossingUp = !prevMet && met;

    if (crossingUp) {
      const intent = sessionStorage.getItem('fd_source_intent');
      const source = intent === 'ADDONS_CTA' ? 'ADDONS_CTA' : 'SELF_BUILD';
      if (attrSource !== source) updates.fd_source = source;
      try { sessionStorage.removeItem('fd_source_intent'); } catch (e) {}
    } else if (lastMet === null && met && !attrSource) {
      updates.fd_source = 'UNKNOWN';
    }

    if (Object.keys(updates).length > 0) {
      sendAttributeUpdate(updates);
    }

    lastMet = met;
  }

  document.addEventListener('cart:updated', function (e) {
    if (e.detail && e.detail.cart) {
      evaluate(e.detail.cart);
    }
  });

  document.addEventListener('DOMContentLoaded', function () {
    fetch('/cart.js', { credentials: 'same-origin' })
      .then(res => res.json())
      .then(cart => {
        evaluate(cart);
      })
      .catch(() => {});
  });
})();
