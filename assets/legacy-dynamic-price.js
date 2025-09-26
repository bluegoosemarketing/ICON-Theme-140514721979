(() => {
  document.addEventListener('DOMContentLoaded', () => {
    // Only run on pages we marked as legacy.
    const priceBlock = document.querySelector('.product-main__price[data-legacy-pricing="true"]');
    if (!priceBlock) return;

    const sectionEl    = priceBlock.closest('.product-main') || document;
    const priceDisplay = priceBlock.querySelector('[data-product-price]');
    if (!priceDisplay) return;

    // Money format from Shopify (falls back to $)
    const moneyFormat = (window.Shopify && window.Shopify.money_format) || '';

    const parseMoneyToCents = (t) => {
      if (typeof t !== 'string') return 0;
      const n = parseFloat(t.replace(/[^\d.]/g, ''));
      return Number.isFinite(n) ? Math.round(n * 100) : 0;
    };

    const formatMoney = (cents) => {
      const amt = (cents/100).toFixed(2);
      return moneyFormat
        ? moneyFormat.replace(/\{\{\s*amount\s*\}\}/, amt)
        : `$${amt}`;
    };

    // Base price in cents (prefer data-base-price, then variant JSON)
    let baseCents = parseInt(priceDisplay.getAttribute('data-base-price'), 10);
    if (!Number.isFinite(baseCents)) baseCents = parseMoneyToCents(priceDisplay.textContent);

    if (!Number.isFinite(baseCents) || baseCents === 0) {
      const pj = document.querySelector('script[data-product-json]');
      if (pj) {
        try {
          const product = JSON.parse(pj.textContent);
          const p = product?.variants?.[0]?.price;
          baseCents = typeof p === 'number' ? Math.round(p) : parseMoneyToCents(String(p));
        } catch (e) { /* noop */ }
      }
    }
    if (!Number.isFinite(baseCents)) baseCents = 0;

    // Optional quantity
    const qtyInput =
      sectionEl.querySelector('.integrated-quantity__input[name="quantity"]') ||
      sectionEl.querySelector('input[name="quantity"]') || null;
    const getQty = () => (qtyInput ? (parseInt(qtyInput.value, 10) || 1) : 1);

    // Bold total can surface under different hooks; search section wide.
    const BOLD_TOTAL_SELECTORS = [
      '.bold_option_total',
      '.bold-options-total',
      '.bold_option_price_total',
      '#bold_option_total'
    ];
    const findBoldTotal = () => {
      for (const sel of BOLD_TOTAL_SELECTORS) {
        const el = sectionEl.querySelector(sel);
        if (el) return el;
      }
      return null;
    };
    let boldTotalEl = findBoldTotal();

    // Placeholder -> live
    const goLive = () => {
      priceBlock.classList.remove('price--placeholder');
      priceBlock.classList.add('price--live');
      priceDisplay.className = '';
    };

    const readExtrasCents = () => {
      if (!boldTotalEl) return 0;
      const span = boldTotalEl.querySelector('span');
      const text = (span?.textContent || boldTotalEl.textContent || '').trim();
      return parseMoneyToCents(text);
    };

    const update = () => {
      const extras = readExtrasCents();
      const qty = getQty();
      const total = (baseCents + extras) * qty;
      goLive();
      priceDisplay.innerHTML = `${formatMoney(total)}<span class="price-note">updates as you choose</span>`;
    };

    const wire = () => {
      if (boldTotalEl) {
        new MutationObserver(update).observe(boldTotalEl, { childList: true, subtree: true, characterData: true });
      }
      if (qtyInput) {
        qtyInput.addEventListener('input', update);
        qtyInput.addEventListener('change', update);
        const qtyContainer = sectionEl.querySelector('.integrated-quantity');
        if (qtyContainer) {
          qtyContainer.addEventListener('click', (e) => {
            if (e.target.closest('.integrated-quantity__button')) setTimeout(update, 10);
          });
        }
      }
      update(); // initial paint
    };

    if (boldTotalEl) {
      wire();
    } else {
      // Wait for Bold to inject later
      const obs = new MutationObserver(() => {
        const found = findBoldTotal();
        if (found) {
          boldTotalEl = found;
          obs.disconnect();
          wire();
        }
      });
      obs.observe(sectionEl, { childList: true, subtree: true });
      update(); // show base price in live mode even before Bold appears
    }
  });
})();
