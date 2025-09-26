(() => {
  document.addEventListener('DOMContentLoaded', () => {
    const priceBlock = document.querySelector('.product-main__price[data-legacy-pricing="true"]');
    if (!priceBlock) return;

    const sectionEl    = priceBlock.closest('.product-main') || document;
    const priceDisplay = priceBlock.querySelector('[data-product-price]');
    // Quantity is OPTIONAL on this template. Fall back to 1 and don’t early-return if absent.
    const qtyInput =
      sectionEl.querySelector('.integrated-quantity__input[name="quantity"]') ||
      sectionEl.querySelector('input[name="quantity"]') ||
      null;
    const qtyContainer = sectionEl.querySelector('.integrated-quantity') || null;
    // Bold may inject outside the form; widen the scope to the whole section.
    const formEl       = sectionEl.querySelector('.product-main__form') || sectionEl;

    if (!sectionEl || !priceDisplay || !formEl) return;

    const moneyFormat = (window.Shopify && window.Shopify.money_format) || '';
    const basePriceCents = Number(priceDisplay.getAttribute('data-base-price')) || 0;

    let wentLive = false;
    const goLive = () => {
      if (wentLive) return;
      priceBlock.classList.remove('price--placeholder');
      priceBlock.classList.add('price--live');
      priceDisplay.className = '';
      wentLive = true;
    };

    const parseMoneyToCents = (t) => {
      if (typeof t !== 'string') return 0;
      const clean = t.replace(/[^0-9.]/g, '');
      const n = parseFloat(clean);
      return Number.isFinite(n) ? Math.round(n * 100) : 0;
    };

    const formatMoney = (cents) => {
      const amt = (cents / 100).toFixed(2);
      if (!moneyFormat) return `$${amt}`;
      return moneyFormat.replace(/\{\{\s*amount\s*\}\}/, amt).replace('.00', '');
    };

    // Bold total can use a few different hooks across themes/versions.
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

    const update = () => {
      const extrasText =
        (boldTotalEl?.querySelector('span')?.textContent) ||
        (boldTotalEl?.textContent) ||
        '0';
      const extras = parseMoneyToCents(extrasText);
      const qty = qtyInput ? (parseInt(qtyInput.value, 10) || 1) : 1;
      const total = (basePriceCents + extras) * qty;
      goLive();
      priceDisplay.innerHTML = `${formatMoney(total)}<span class="price-note">updates as you choose</span>`;
    };

    const wireBold = () => {
      if (!boldTotalEl || boldTotalEl.__wired) return;
      boldTotalEl.__wired = true;

      new MutationObserver(update).observe(boldTotalEl, {
        childList: true,
        subtree: true,
        characterData: true
      });

      if (window.BOLD?.options?.app?.on) {
        window.BOLD.options.app.on('option_changed', update);
      }

      // Quantity listeners are optional
      const debounced = () => setTimeout(update, 10);
      if (qtyContainer) {
        qtyContainer.addEventListener('click', (e) => {
          if (e.target.closest('.integrated-quantity__button')) debounced();
        });
      }
      if (qtyInput) {
        qtyInput.addEventListener('change', update);
        qtyInput.addEventListener('input', update);
      }

      update(); // initial render
    };

    if (boldTotalEl) {
      wireBold();
    } else {
      // Watch the entire section for Bold’s late injection.
      const appearObs = new MutationObserver(() => {
        const found = findBoldTotal();
        if (found) {
          boldTotalEl = found;
          wireBold();
          appearObs.disconnect();
        }
      });
      appearObs.observe(sectionEl, { childList: true, subtree: true });
    }
  });
})();
