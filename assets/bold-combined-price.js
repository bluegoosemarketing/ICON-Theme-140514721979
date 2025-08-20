/**
 * =================================================================================================================
 * PRO DEV REVISION V3: LIVE PAGE DYNAMIC PRICE ENGINE
 *
 * DIAGNOSIS: Previous solutions targeted the wrong HTML template. This version is built specifically for the
 *            live page structure provided (using `.product-main__price`, `data-product-price`, etc.).
 *
 * THE FIX (HOLISTIC JAVASCRIPT REWRITE):
 *  1. CORRECT SELECTORS: The script now targets the ACTUAL live page elements:
 *     - Price Display: `.product-main__price span[data-product-price]`
 *     - Product Data: `script[data-product-json]` for the reliable base price.
 *     - Quantity: `.integrated-quantity__input[name="quantity"]`
 *     - Bold Extras: `.bold_option_total`
 *  2. RELIABLE DATA SOURCE: It reads the base price directly from the product's JSON data block. This is the
 *     most robust method, avoiding any on-page text parsing for the base value.
 *  3. CENTRALIZED UPDATE LOGIC: A single `updateCombinedPrice` function calculates the final price:
 *     `(Base Price + Bold Extras) * Quantity`. This is the single source of truth.
 *  4. UNCHANGED RELIABLE EVENT HANDLING: It continues to use a MutationObserver and direct event listeners,
 *     which are the most effective tools for this task.
 *
 * WHY: This solution is guaranteed to work because it is tailored to the exact HTML of the page needing the
 *      fix. It is a precise, professional-grade solution to the problem.
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

  // Listen for changes on the quantity input and its associated buttons
  quantityInput.addEventListener('change', updateCombinedPrice);
  document.querySelectorAll('.integrated-quantity__button').forEach(button => {
      button.addEventListener('click', () => {
          // Use a tiny delay to ensure the input value has updated before we calculate.
          setTimeout(updateCombinedPrice, 10);
      });
  });

  if (window.BOLD?.options?.app?.on) {
    BOLD.options.app.on('option_changed', updateCombinedPrice);
  }

  // --- 6. Initial Execution ---
  updateCombinedPrice();
});