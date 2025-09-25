/**
 * =================================================================================================================
 * PRO DEV REVISION V4: LIVE PAGE DYNAMIC PRICE ENGINE (CENTRALIZED LOGIC)
 *
 * DIAGNOSIS: Previous versions contained redundant click handlers for quantity buttons.
 *
 * THE FIX (HOLISTIC JAVASCRIPT REFACTOR):
 *  1. REMOVED REDUNDANCY: The dedicated click listeners on the quantity buttons have been removed.
 *  2. CENTRALIZED EVENT MODEL: This script now relies exclusively on the 'change' event from the quantity
 *     input. A new global script (`product-quantity.js`) is now the single source of truth for managing
 *     quantity input state and dispatching this 'change' event.
 *  3. INCREASED ROBUSTNESS: By listening to a single, reliable event, we prevent race conditions and conflicts,
 *     making the pricing engine more stable and easier to debug.
 *
 * WHY: This architecture ensures that logic is not duplicated. The quantity handler handles quantity, and the
 *      price engine handles price calculations. This separation of concerns is a professional standard.
 * =================================================================================================================
 */
document.addEventListener('DOMContentLoaded', () => {
  // --- 1. Element Selection & Validation ---
  const priceDisplayElement = document.querySelector('.product-main__price span[data-product-price]');
  const quantityInput = document.querySelector('.integrated-quantity__input[name="quantity"]');
  const boldTotalContainer = document.querySelector('.bold_option_total');
  const productJsonScript = document.querySelector('script[data-product-json]');

  // If any critical element is missing, exit immediately to prevent errors.
  if (!priceDisplayElement || !quantityInput || !boldTotalContainer || !productJsonScript) {
    console.log('Dynamic Price Engine: One or more critical elements not found on the page. Aborting.');
    return;
  }

  // --- 2. Data Initialization ---
  let basePriceInCents = 0;
  try {
    const productData = JSON.parse(productJsonScript.textContent);
    // Use the first available variant's price as the base price.
    basePriceInCents = productData?.variants?.[0]?.price || 0;
  } catch (e) {
    console.error('Dynamic Price Engine: Failed to parse product JSON.', e);
    // As a fallback, try to parse the initial text content of the price display
    basePriceInCents = parseMoneyToCents(priceDisplayElement.textContent);
  }

  if (basePriceInCents === 0) {
      console.warn('Dynamic Price Engine: Base price is zero. Calculations may be incorrect.');
  }

  // --- 3. Helper Functions ---
  const parseMoneyToCents = (text) => {
    if (typeof text !== 'string') return 0;
    const sanitized = text.replace(/[^0-9.]/g, '');
    const asFloat = parseFloat(sanitized);
    return isNaN(asFloat) ? 0 : Math.round(asFloat * 100);
  };

  const formatMoney = (cents) => {
    if (window.Shopify && typeof window.Shopify.formatMoney === 'function') {
      try {
        return window.Shopify.formatMoney(cents, window.theme?.moneyFormat || '${{amount}}');
      } catch (e) {
        return `$${(cents / 100).toFixed(2)}`;
      }
    }
    return `$${(cents / 100).toFixed(2)}`;
  };

  // --- 4. The Core Price Calculation and Update Function ---
  const updateCombinedPrice = () => {
    const extrasPriceText = boldTotalContainer.querySelector('span')?.textContent || boldTotalContainer.textContent;
    const extrasInCents = parseMoneyToCents(extrasPriceText);

    const quantity = parseInt(quantityInput.value, 10) || 1;

    const singleItemTotalInCents = basePriceInCents + extrasInCents;
    const finalTotalInCents = singleItemTotalInCents * quantity;

    // Update the text content of the correct price display element
    priceDisplayElement.textContent = formatMoney(finalTotalInCents);
  };

  // --- 5. Event Listeners & Observers ---
  const observer = new MutationObserver(updateCombinedPrice);
  observer.observe(boldTotalContainer, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // Listen for a single, reliable "change" event on the quantity input.
  quantityInput.addEventListener('change', updateCombinedPrice);

  if (window.BOLD?.options?.app?.on) {
    BOLD.options.app.on('option_changed', updateCombinedPrice);
  }

  // --- 6. Initial Execution ---
  updateCombinedPrice();
});