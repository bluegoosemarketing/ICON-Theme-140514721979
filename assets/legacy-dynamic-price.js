(() => {
  document.addEventListener('DOMContentLoaded', () => {
    const priceBlock = document.querySelector('.product-main__price[data-legacy-pricing="true"]');
    if (!priceBlock) return;

    const sectionEl    = priceBlock.closest('.product-main');
    const priceDisplay = priceBlock.querySelector('[data-product-price]');
    const qtyInput     = sectionEl?.querySelector('.integrated-quantity__input[name="quantity"]');
    const qtyContainer = sectionEl?.querySelector('.integrated-quantity');
    const formEl       = sectionEl?.querySelector('.product-main__form');

    if (!sectionEl || !priceDisplay || !qtyInput || !qtyContainer || !formEl) return;

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

    let boldTotalEl = formEl.querySelector('.bold_option_total');

    const update = () => {
      const extrasText = boldTotalEl?.querySelector('span')?.textContent || '0';
      const extras = parseMoneyToCents(extrasText);
      const qty = parseInt(qtyInput.value, 10) || 1;
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

      const debounced = () => setTimeout(update, 10);
      qtyContainer.addEventListener('click', (e) => {
        if (e.target.closest('.integrated-quantity__button')) debounced();
      });
      qtyInput.addEventListener('change', update);

      update(); // initial render
    };

    if (boldTotalEl) {
      wireBold();
    } else {
      const appearObs = new MutationObserver(() => {
        const found = formEl.querySelector('.bold_option_total');
        if (found) {
          boldTotalEl = found;
          wireBold();
          appearObs.disconnect();
        }
      });
      appearObs.observe(formEl, { childList: true, subtree: true });
    }
  });
})();
