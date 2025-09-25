/**
 * =================================================================================================================
 * PRO DEV REVISION V5: UNIVERSAL DYNAMIC PRICE ENGINE
 *
 * DIAGNOSIS: The previous price engine was hard-coded to require the '.bold_option_total' element,
 *            causing it to fail on any product not using Bold Product Options.
 *
 * THE FIX (HOLISTIC REWRITE):
 *  1. UNIVERSAL COMPATIBILITY: The script no longer aborts if Bold elements are missing. Instead, it
 *     gracefully handles their absence.
 *  2. CONDITIONAL LOGIC: It checks for the '.bold_option_total' container. If found, it includes Bold's
 *     extra costs in the calculation. If not found, it calculates a simple `basePrice * quantity`.
 *  3. SINGLE SOURCE OF TRUTH: This one script now correctly calculates prices for ALL product types,
 *     dramatically simplifying theme logic and maintenance. It is now the definitive price engine.
 *
 * WHY: This solution is robust and scalable. It fixes the immediate bug and prevents future issues by
 *      no longer making unsafe assumptions about which apps are active on a given product.
 * =================================================================================================================
 */
document.addEventListener('DOMContentLoaded', () => {
  // --- 1. Element Selection ---
  // We target elements within the main product container to avoid conflicts.
  const productMainContainer = document.querySelector('.product-main');
  if (!productMainContainer) return;

  const priceDisplayElement = productMainContainer.querySelector('.product-main__price span[data-product-price]');
  const quantityInput = productMainContainer.querySelector('.integrated-quantity__input[name="quantity"]');
  const productJsonScript = document.querySelector('script[data-product-json]');

  // This element is now OPTIONAL.
  const boldTotalContainer = productMainContainer.querySelector('.bold_option_total');

  // Critical elements must exist to proceed.
  if (!priceDisplayElement || !quantityInput || !productJsonScript) {
    console.warn('Universal Price Engine: Missing critical elements (price, quantity, or product JSON). Aborting.');
    return;
  }

  // --- 2. Data Initialization ---
  let basePriceInCents = 0;
  try {
    const productData = JSON.parse(productJsonScript.textContent);
    basePriceInCents = productData?.selected_or_first_available_variant?.price || productData?.variants?.[0]?.price || 0;
  } catch (e) {
    console.error('Universal Price Engine: Failed to parse product JSON.', e);
    return; // Exit if we can't get a base price.
  }

  // --- 3. Helper Functions (unchanged) ---
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
    let extrasInCents = 0;
    // ** THE CORE FIX **: Only read from Bold container if it exists.
    if (boldTotalContainer) {
      const extrasPriceText = boldTotalContainer.querySelector('span')?.textContent || boldTotalContainer.textContent;
      extrasInCents = parseMoneyToCents(extrasPriceText);
    }

    const quantity = parseInt(quantityInput.value, 10) || 1;
    const finalTotalInCents = (basePriceInCents + extrasInCents) * quantity;

    priceDisplayElement.textContent = formatMoney(finalTotalInCents);
  };

  // --- 5. Event Listeners & Observers ---
  // Listen for the 'change' event dispatched by our robust delegated quantity script.
  quantityInput.addEventListener('change', updateCombinedPrice);

  // If the Bold container exists, observe it for changes.
  if (boldTotalContainer) {
    const observer = new MutationObserver(updateCombinedPrice);
    observer.observe(boldTotalContainer, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }
  
  // Also listen to Bold's specific events if available.
  if (window.BOLD?.options?.app?.on) {
    BOLD.options.app.on('option_changed', updateCombinedPrice);
  }

  // --- 6. Initial Execution ---
  // Run once on page load to set the initial price correctly.
  updateCombinedPrice();
});