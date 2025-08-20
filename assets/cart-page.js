// ==========================================================================
// ICON MEALS - DEDICATED CART PAGE JAVASCRIPT
// ==========================================================================
document.addEventListener('DOMContentLoaded', function () {
  // --- Intelligent "Continue Shopping" Logic ---
  const continueShoppingBtn = document.getElementById('cart-continue-shopping');
  if (continueShoppingBtn) {
    continueShoppingBtn.addEventListener('click', function(event) {
      // Check if the link is to an internal page by checking the referrer.
      // This prevents going "back" to an external site.
      if (document.referrer && new URL(document.referrer).hostname === window.location.hostname) {
        event.preventDefault(); // Stop the default link behavior.
        history.back();       // Go to the previous page in the user's history.
      }
      // If there's no referrer or it's external, the link will proceed to its
      // default href="/collections/signature-menu", which is our safe fallback.
    });
  }
  
  // --- Initialize Loop Subscriptions ---
  try {
    const initialCartData = JSON.parse(document.getElementById('initial-cart').textContent);
    window.Loop = window.Loop || {};
    window.Loop.bundleCartAllItems = initialCartData.items;
    if (typeof initLoopBundle === 'function') {
      initLoopBundle("LOOP_icon-meals-dev_bundles");
    }
  } catch (e) {
    console.error('Error initializing Loop Subscriptions on cart page:', e);
  }

  // --- BOLD Apps Compatibility ---
  document.body.addEventListener('click', function(event) {
    if (event.target.closest('.quantity-controls *')) {
      setTimeout(function() {
        if (window.BOLD && BOLD.common && BOLD.common.eventEmitter && typeof BOLD.common.eventEmitter.emit === 'function') {
          BOLD.common.eventEmitter.emit('BOLD_COMMON_cart_loaded');
        }
      }, 500);
    }
  });

  // --- Redirect Checkout to Add-Ons Page with meal count check ---
  const checkoutBtn = document.getElementById('cart_submit');
  if (checkoutBtn) {
    checkoutBtn.addEventListener('click', function(event) {
      if (typeof checkMealsAndProceed === 'function') {
        checkMealsAndProceed(event, checkoutBtn);
      } else {
        event.preventDefault();
        window.location.href = '/pages/add-ons';
      }
    });
  }
});
