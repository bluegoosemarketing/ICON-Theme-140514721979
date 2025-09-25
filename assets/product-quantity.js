document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.integrated-quantity').forEach(qtyWrap => {
    // Skip components that already manage their own quantity:
    // - product-card quick-add custom element
    // - Recharge PDP controller
    // - Custom-meal Recharge form
    if (
      qtyWrap.dataset.qtyInitialized === 'true' ||
      qtyWrap.closest('product-form') ||                 // quick-add cards use product-card.js
      qtyWrap.closest('product-form-controller') ||      // product-main-recharge.liquid
      qtyWrap.closest('[data-cm-form]')                  // product-cm-recharge.liquid
    ) return;

    const input   = qtyWrap.querySelector('.integrated-quantity__input[name="quantity"]');
    const label   = qtyWrap.querySelector('.integrated-quantity__text');
    const minus   = qtyWrap.querySelector('[name="minus"], [data-qty-minus]');
    const plus    = qtyWrap.querySelector('[name="plus"], [data-qty-plus]');
    if (!input) return;

    const sync = () => {
      const v = Math.max(1, parseInt(input.value, 10) || 1);
      input.value = v;
      if (label) label.textContent = v;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };

    // init
    sync();

    minus?.addEventListener('click', () => { input.value = (parseInt(input.value, 10) || 1) - 1; sync(); });
    plus?.addEventListener('click',  () => { input.value = (parseInt(input.value, 10) || 1) + 1; sync(); });
    input.addEventListener('input',  sync);
    input.addEventListener('change', sync);

    // Mark this component as initialized to prevent double-binding.
    qtyWrap.dataset.qtyInitialized = 'true';
  });
});