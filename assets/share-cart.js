(function () {
  'use strict';

  if (window.ShareCart) {
    return;
  }

  var urlParams = null;
  try {
    urlParams = new URLSearchParams(window.location.search);
  } catch (err) {
    urlParams = null;
  }

  var DEBUG_ENABLED = !!(urlParams && urlParams.get('scdebug') === '1');
  var shareCartConfig = window.__SHARE_CART_CONFIG__ || {};

  function debugLog() {
    if (!DEBUG_ENABLED) return;
    if (typeof console === 'undefined' || typeof console.log !== 'function') return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[ShareCart]');
    console.log.apply(console, args);
  }

  function describeNode(node) {
    if (!node || node.nodeType !== 1) return 'unknown';
    var name = node.tagName ? node.tagName.toLowerCase() : 'node';
    var id = node.id ? '#' + node.id : '';
    var className = '';
    if (node.className && typeof node.className === 'string') {
      className = '.' + node.className.trim().replace(/\s+/g, '.');
    }
    return name + id + className;
  }

  function isElementVisible(element) {
    if (!element || element.nodeType !== 1) return false;
    var current = element;
    while (current && current.nodeType === 1) {
      if (current.hasAttribute('hidden')) return false;
      var style = window.getComputedStyle(current);
      if (!style) break;
      if (style.display === 'none' || style.visibility === 'hidden') {
        return false;
      }
      current = current.parentElement;
    }
    return true;
  }

  var SELECTORS = {
    drawer: {
      containers: ['.cart-drawer__actions', '.cart-drawer__footer'],
      checkout: '.cart-drawer__checkout-btn'
    },
    sidebar: {
      host: '#cart-sidebar',
      hosts: ['#cart-sidebar', '.cart-sidebar', '.cart-sidebar-section-wrapper', '[data-cart-sidebar]'],
      body: '.cart-sidebar__body',
      checkout: '.cart-sidebar__checkout-btn',
      inlineGroups: ['.cart-drawer__continue-action', '.cart-sidebar__secondary-actions']
    },
    page: {
      container: '.container--cart-page',
      actions: '.cart-summary__actions',
      checkout: '#cart_submit',
      form: 'form#cartform'
    }
  };

  var TOAST_STYLES =
    /* TOAST */
    '.share-cart-toast{position:fixed;z-index:9999;left:50%;bottom:2rem;transform:translateX(-50%) translateY(100%);padding:0.75rem 1.25rem;border-radius:999px;font-size:0.95rem;font-weight:600;color:#fff;background:#212529;box-shadow:0 10px 25px rgba(0,0,0,0.2);opacity:0;transition:transform 0.3s ease,opacity 0.3s ease;pointer-events:none}' +
    '.share-cart-toast.is-visible{transform:translateX(-50%) translateY(0);opacity:1}' +
    '.share-cart-toast.is-error{background:#c53030}' +
    '.share-cart-toast.is-success{background:#2f9e44}' +
    /* INLINE TEXT LINK */
    '.cart-share-link{display:inline-flex;align-items:center;gap:.35rem;background:none;border:0;padding:0;margin:0;font:inherit;font-weight:500;color:#4B5563;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px;cursor:pointer;}' +
    '.cart-share-link span{pointer-events:none;}' +
    '.cart-share-link:hover{color:var(--brand-text,#111827);}' +
    '.cart-share-link[aria-disabled="true"],.cart-share-link:disabled{opacity:.6;cursor:not-allowed;text-decoration:none;}' +
    '.cart-share-inline-divider{margin:0 .35rem;color:rgba(148,163,184,0.95);display:inline-block;}';

  function base64Encode(jsonString) {
    return btoa(encodeURIComponent(jsonString).replace(/%([0-9A-F]{2})/g, function (_, match) {
      return String.fromCharCode(parseInt(match, 16));
    }));
  }

  function base64Decode(encoded) {
    return decodeURIComponent(Array.prototype.map.call(atob(encoded), function (char) {
      return '%' + ('00' + char.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
  }

  function createRequest(url, options, attempt) {
    attempt = attempt || 0;
    return fetch(url, Object.assign({ credentials: 'same-origin' }, options)).then(function (response) {
      if (!response.ok && attempt < 1 && (response.status === 429 || response.status >= 500)) {
        return new Promise(function (resolve) {
          setTimeout(resolve, 350);
        }).then(function () {
          return createRequest(url, options, attempt + 1);
        });
      }
      return response;
    });
  }

  function sanitizeProperties(properties) {
    if (!properties || typeof properties !== 'object') return null;
    var cleaned = {};
    Object.keys(properties).forEach(function (key) {
      var value = properties[key];
      if (value !== null && value !== undefined && value !== '') {
        cleaned[key] = value;
      }
    });
    return Object.keys(cleaned).length ? cleaned : null;
  }

  function isHidden(element) {
    return !isElementVisible(element);
  }

  function ShareCartManager() {
    this.buttons = new Set();
    this.renderTimer = null;
    this.cartRequest = null;
    this.cartData = null;
    this.lastCartFetch = 0;
    this.observer = null;
    this.reconstructing = false;
    this.visibilityQueue = [];
    this.externalListenersAttached = false;
    this.handleButtonClick = this.handleButtonClick.bind(this);
    this.scheduleRender = this.scheduleRender.bind(this);
  }

  ShareCartManager.prototype.init = function () {
    this.injectStyles();
    this.consumeBootNotice();
    this.injectAll();
    this.refreshButtonStates();
    this.observe();
    this.bindExternalListeners();
  };

  ShareCartManager.prototype.injectStyles = function () {
    if (document.getElementById('share-cart-styles')) return;
    var style = document.createElement('style');
    style.id = 'share-cart-styles';
    style.textContent = TOAST_STYLES;
    document.head.appendChild(style);
  };

  ShareCartManager.prototype.consumeBootNotice = function () {
    var storageKey = 'shareCart:lastNotice';
    try {
      var raw = localStorage.getItem(storageKey);
      if (!raw) return;
      localStorage.removeItem(storageKey);
      var payload = null;
      try {
        payload = JSON.parse(raw);
      } catch (err) {
        payload = null;
      }
      if (!payload || !payload.message) return;
      this.showToast(payload.message, true);
      debugLog('Toast notice displayed for partial rebuild');
    } catch (err) {
      // Ignore storage errors
    }
  };

  ShareCartManager.prototype.observe = function () {
    if (this.observer) return;
    var self = this;
    this.observer = new MutationObserver(function () {
      self.scheduleRender();
    });
    if (document.body) {
      this.observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'aria-hidden']
      });
    }
  };

  ShareCartManager.prototype.bindExternalListeners = function () {
    if (this.externalListenersAttached) return;
    this.externalListenersAttached = true;
    var listeners = [
      [window, 'resize'],
      [window, 'orientationchange'],
      [document, 'shopify:section:load'],
      [document, 'shopify:section:reorder'],
      [document, 'page:load'],
      [document, 'page:change'],
      [document, 'app:loaded']
    ];
    var self = this;
    listeners.forEach(function (entry) {
      var target = entry[0];
      var eventName = entry[1];
      if (!target || typeof target.addEventListener !== 'function') return;
      target.addEventListener(eventName, self.scheduleRender);
    });
  };

  ShareCartManager.prototype.scheduleRender = function () {
    var self = this;
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
    }
    this.renderTimer = setTimeout(function () {
      self.renderTimer = null;
      self.injectAll();
      self.refreshButtonStates();
    }, 120);
  };

  ShareCartManager.prototype.pruneButtons = function () {
    var self = this;
    this.buttons.forEach(function (button) {
      if (!document.body.contains(button)) {
        self.buttons.delete(button);
      }
    });
  };

  ShareCartManager.prototype.deferVisibilityCheck = function (element) {
    if (!element) return;
    if (!Array.isArray(this.visibilityQueue)) {
      this.visibilityQueue = [];
    }
    if (this.visibilityQueue.indexOf(element) !== -1) {
      return;
    }
    this.visibilityQueue.push(element);
    var self = this;
    setTimeout(function () {
      var index = self.visibilityQueue.indexOf(element);
      if (index !== -1) {
        self.visibilityQueue.splice(index, 1);
      }
      self.scheduleRender();
    }, 250);
  };

  ShareCartManager.prototype.createButton = function () {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'cart-share-link';
    button.setAttribute('data-share-cart', '');
    button.innerHTML = '<span class="cart-share-link__text">Share Cart</span>';
    button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.setAttribute('aria-disabled', 'true');
    button.addEventListener('click', this.handleButtonClick);
    this.buttons.add(button);
    return button;
  };

  ShareCartManager.prototype.ensureInlineDivider = function (container) {
    if (!container) return null;
    var divider = container.querySelector('.cart-share-inline-divider');
    if (!divider) {
      divider = document.createElement('span');
      divider.className = 'cart-share-inline-divider cart-drawer__secondary-link-divider';
      divider.setAttribute('aria-hidden', 'true');
      divider.textContent = '|';
      container.appendChild(divider);
    }
    return divider;
  };

  ShareCartManager.prototype.injectAll = function () {
    this.pruneButtons();
    this.injectDrawerButton();
    this.injectSidebarButton();
    this.injectPageButton();
  };

  ShareCartManager.prototype.getSidebarHosts = function () {
    var selectors = [];
    if (Array.isArray(SELECTORS.sidebar.hosts)) {
      selectors = SELECTORS.sidebar.hosts.slice();
    }
    if (!selectors.length && SELECTORS.sidebar.host) {
      selectors.push(SELECTORS.sidebar.host);
    }
    var results = [];
    selectors.forEach(function (selector) {
      if (!selector) return;
      var nodes = document.querySelectorAll(selector);
      for (var i = 0; i < nodes.length; i++) {
        if (results.indexOf(nodes[i]) === -1) {
          results.push(nodes[i]);
        }
      }
    });
    return results;
  };

  ShareCartManager.prototype.resolveSidebarHost = function (node) {
    if (!node) return null;
    if (node.matches && node.matches('.cart-sidebar')) return node;
    return node.querySelector ? node.querySelector('.cart-sidebar') || node : node;
  };

  ShareCartManager.prototype.findSidebarInlineGroup = function (host) {
    if (!host) return null;
    var selectors = Array.isArray(SELECTORS.sidebar.inlineGroups)
      ? SELECTORS.sidebar.inlineGroups
      : [];
    for (var i = 0; i < selectors.length; i++) {
      var candidate = host.querySelector(selectors[i]);
      if (candidate && !isHidden(candidate)) {
        return candidate;
      }
    }
    return null;
  };

  ShareCartManager.prototype.ensureSidebarInlineGroup = function (host) {
    var inlineGroup = this.findSidebarInlineGroup(host);
    if (inlineGroup) return inlineGroup;
    if (!host) return null;
    var footer = host.querySelector('.cart-sidebar__footer');
    if (!footer || isHidden(footer)) return null;
    inlineGroup = footer.querySelector('.cart-drawer__continue-action');
    if (!inlineGroup) {
      inlineGroup = document.createElement('div');
      inlineGroup.className = 'cart-drawer__continue-action cart-sidebar__secondary-actions';
      footer.appendChild(inlineGroup);
      debugLog('Sidebar injection: created secondary action group', describeNode(footer));
    }
    return inlineGroup;
  };

  ShareCartManager.prototype.findSidebarFallbackContainer = function (host) {
    if (!host) return null;
    var selectors = [
      '.cart-sidebar__footer',
      '.cart-sidebar__actions',
      '.cart-sidebar__content'
    ];
    for (var i = 0; i < selectors.length; i++) {
      var target = host.querySelector(selectors[i]);
      if (target && !isHidden(target)) {
        return target;
      }
    }
    return null;
  };

  ShareCartManager.prototype.injectDrawerButton = function () {
    var container = null;
    for (var i = 0; i < SELECTORS.drawer.containers.length; i++) {
      var candidate = document.querySelector(SELECTORS.drawer.containers[i]);
      if (candidate) {
        var cs = window.getComputedStyle(candidate);
        if (cs.display !== 'none' && cs.visibility !== 'hidden') container = candidate;
        break;
      }
    }
    if (!container) {
      debugLog('Drawer injection: no container available');
      return;
    }

    var inlineGroup = container.querySelector('.cart-drawer__continue-action');
    if (inlineGroup && isHidden(inlineGroup)) {
      inlineGroup = null;
    }

    var target = inlineGroup || container;
    if (target.querySelector('[data-share-cart]')) {
      debugLog('Drawer injection: share CTA already present', describeNode(target));
      return;
    }

    var button = this.createButton();
    if (inlineGroup) {
      button.classList.add('cart-drawer__secondary-link');
      this.ensureInlineDivider(inlineGroup);
      inlineGroup.appendChild(button);
      debugLog('Drawer injection: inserted into inline group', describeNode(inlineGroup));
    } else {
      var checkout = container.querySelector(SELECTORS.drawer.checkout);
      if (checkout && checkout.parentElement) {
        checkout.parentElement.insertBefore(button, checkout);
        debugLog('Drawer injection: inserted before checkout', describeNode(checkout));
      } else {
        container.appendChild(button);
        debugLog('Drawer injection: appended to container', describeNode(container));
      }
    }
  };

  ShareCartManager.prototype.injectSidebarButton = function () {
    var hosts = this.getSidebarHosts();
    if (!hosts || !hosts.length) {
      debugLog('Sidebar injection: no hosts detected');
      return;
    }

    for (var i = 0; i < hosts.length; i++) {
      var rawHost = hosts[i];
      if (!rawHost) continue;

      var host = this.resolveSidebarHost(rawHost);
      if (!host) continue;

      if (!isElementVisible(host)) {
        debugLog('Sidebar injection: host hidden, waiting', describeNode(host));
        this.deferVisibilityCheck(host);
        continue;
      }

      if (host.querySelector('[data-share-cart]')) {
        debugLog('Sidebar injection: CTA already present', describeNode(host));
        continue;
      }

      var inlineGroup = this.ensureSidebarInlineGroup(host);
      if (inlineGroup && isHidden(inlineGroup)) {
        inlineGroup = null;
      }

      if (inlineGroup) {
        var buttonInline = this.createButton();
        buttonInline.classList.add('cart-drawer__secondary-link');
        this.ensureInlineDivider(inlineGroup);
        inlineGroup.appendChild(buttonInline);
        debugLog('Sidebar injection: inserted into inline group', describeNode(inlineGroup));
        continue;
      }

      var checkout = host.querySelector(SELECTORS.sidebar.checkout);
      if (checkout) {
        var container = checkout.closest('.cart-sidebar__actions, .cart-sidebar__footer, .product-form__buttons-group') || checkout.parentElement;
        if (container && isHidden(container)) {
          this.deferVisibilityCheck(container);
          debugLog('Sidebar injection: checkout container hidden', describeNode(container));
          continue;
        }
        var buttonAfterCheckout = this.createButton();
        buttonAfterCheckout.classList.add('cart-drawer__secondary-link');
        checkout.insertAdjacentElement('afterend', buttonAfterCheckout);
        debugLog('Sidebar injection: inserted after checkout button', describeNode(checkout));
        continue;
      }

      var fallback = this.findSidebarFallbackContainer(host);
      if (!fallback) {
        this.deferVisibilityCheck(host);
        debugLog('Sidebar injection: awaiting fallback container', describeNode(host));
        continue;
      }

      var button = this.createButton();
      if (fallback.matches && fallback.matches('.cart-sidebar__actions, .cart-drawer__continue-action')) {
        button.classList.add('cart-drawer__secondary-link');
        this.ensureInlineDivider(fallback);
      }
      fallback.appendChild(button);
      debugLog('Sidebar injection: inserted into fallback container', describeNode(fallback));
    }
  };
  
  ShareCartManager.prototype.injectPageButton = function () {
    var container = null;
    var actions = document.querySelector(SELECTORS.page.actions);
    if (actions) {
      var actionsCs = window.getComputedStyle(actions);
      if (actionsCs.display !== 'none' && actionsCs.visibility !== 'hidden') {
        container = actions;
      }
    }
    
    if (!container) {
      var form = document.querySelector(SELECTORS.page.form);
      if (form && form.parentElement) {
        var parentCs = window.getComputedStyle(form.parentElement);
        if (parentCs.display !== 'none' && parentCs.visibility !== 'hidden') {
          container = form.parentElement;
        }
      }
    }

    if (!container) {
      debugLog('Page injection: no suitable container');
      return;
    }

    if (container.querySelector('[data-share-cart]')) {
      debugLog('Page injection: CTA already present', describeNode(container));
      return;
    }

    var button = this.createButton();
    var updateLink = container.querySelector('.cart-summary__update-link');
    if (updateLink && updateLink.parentElement === container) {
      updateLink.insertAdjacentElement('afterend', button);
      debugLog('Page injection: inserted after update link', describeNode(container));
    } else {
      var checkout = container.querySelector(SELECTORS.page.checkout) || container.querySelector(SELECTORS.page.form);
      if (checkout && checkout.parentElement) {
        checkout.parentElement.insertBefore(button, checkout.nextSibling);
        debugLog('Page injection: inserted near checkout', describeNode(checkout.parentElement));
      } else {
        container.appendChild(button);
        debugLog('Page injection: appended to container', describeNode(container));
      }
    }
  };

  ShareCartManager.prototype.handleButtonClick = function (event) {
    event.preventDefault();
    var button = event.currentTarget;
    if (button.disabled) return;
    var self = this;

    var originalHtml = button.dataset.originalHtml;
    button.disabled = true;
    var textSpan = button.querySelector('span');
    if (textSpan) textSpan.textContent = 'Copying…';

    this.buildShareLink()
      .then(function (link) {
        return self.copyToClipboard(link).then(function () {
          self.showToast('Link copied', false);
          if (window.dataLayer && Array.isArray(window.dataLayer) && self.cartData) {
            window.dataLayer.push({
              event: 'cart_share_link_copied',
              item_count: self.cartData.item_count,
              value: self.cartData.total_price
            });
          }
        });
      })
      .catch(function (error) {
        var message = (error && error.message) || 'Unable to share cart. Please try again.';
        self.showToast(message, true);
      })
      .finally(function () {
        button.innerHTML = originalHtml;
        if (typeof button.focus === 'function' && document.body.contains(button)) {
          button.focus();
        }
        self.refreshButtonStates();
      });
  };

  ShareCartManager.prototype.fetchCart = function () {
    var now = Date.now();
    if (this.cartData && now - this.lastCartFetch < 500) {
      return Promise.resolve(this.cartData);
    }
    if (this.cartRequest) {
      return this.cartRequest;
    }
    var self = this;
    this.cartRequest = createRequest('/cart.js')
      .then(function (response) {
        if (!response.ok) {
          throw new Error('Unable to load cart.');
        }
        return response.json();
      })
      .then(function (cart) {
        self.cartData = cart;
        self.lastCartFetch = Date.now();
        return cart;
      })
      .finally(function () {
        self.cartRequest = null;
      });
    return this.cartRequest;
  };

  ShareCartManager.prototype.extractShareItems = function (cart) {
    if (!cart || !Array.isArray(cart.items)) return [];
    var items = [];
    for (var i = 0; i < cart.items.length; i++) {
      var item = cart.items[i];
      if (!item) continue;
      var variantId = item.variant_id || item.id;
      var quantity = Number(item.quantity || 0);
      if (!variantId || !quantity || quantity < 1) continue;
      var payload = {
        id: variantId,
        quantity: quantity
      };
      if (item.properties && Object.keys(item.properties).length > 0) {
        var cleaned = sanitizeProperties(item.properties);
        if (cleaned) {
          payload.properties = cleaned;
        }
      }
      var sellingPlanId = item.selling_plan;
      if (!sellingPlanId && item.selling_plan_allocation && item.selling_plan_allocation.selling_plan && item.selling_plan_allocation.selling_plan.id) {
        sellingPlanId = item.selling_plan_allocation.selling_plan.id;
      }
      if (sellingPlanId) {
        payload.selling_plan = sellingPlanId;
      }
      items.push(payload);
    }
    return items;
  };

  ShareCartManager.prototype.buildLegacyShareLink = function (items) {
    if (!items || !items.length) {
      throw new Error('Your cart is empty.');
    }
    var encoded = base64Encode(JSON.stringify(items));
    var origin = window.location.origin || (window.location.protocol + '//' + window.location.host);
    var base = origin ? origin.replace(/\/$/, '') : '';
    return base + '/cart?shared=' + encodeURIComponent(encoded);
  };

  ShareCartManager.prototype.generateShareCode = function () {
    var chars = shareCartConfig.codeCharacters || 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    var length = parseInt(shareCartConfig.codeLength, 10);
    if (!length || length < 6) {
      length = 10;
    }
    var output = '';
    for (var i = 0; i < length; i++) {
      var index = Math.floor(Math.random() * chars.length);
      output += chars.charAt(index);
    }
    return output;
  };

  ShareCartManager.prototype.resolveGraphQLEndpoint = function () {
    if (shareCartConfig.graphqlEndpoint) {
      return shareCartConfig.graphqlEndpoint;
    }
    var apiVersion = shareCartConfig.apiVersion || '2024-07';
    var origin = window.location.origin || (window.location.protocol + '//' + window.location.host) || '';
    return origin.replace(/\/$/, '') + '/api/' + apiVersion + '/graphql.json';
  };

  ShareCartManager.prototype.createMetaobjectShare = function (cart) {
    var token = shareCartConfig.storefrontToken;
    if (!token) {
      return Promise.reject(new Error('Share cart configuration is missing.'));
    }

    var endpoint;
    try {
      endpoint = this.resolveGraphQLEndpoint();
    } catch (err) {
      return Promise.reject(new Error('Unable to resolve share link endpoint.'));
    }

    var cartPayload;
    try {
      cartPayload = JSON.stringify(cart);
    } catch (err) {
      return Promise.reject(new Error('Unable to prepare cart for sharing.'));
    }

    var expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    var origin = window.location.origin || (window.location.protocol + '//' + window.location.host) || '';
    origin = origin.replace(/\/$/, '');
    var type = shareCartConfig.metaobjectType || 'shared_cart';
    var mutation =
      'mutation ShareCartCreate($handle: String!, $cartData: String!, $code: String!, $expiresAt: DateTime!, $type: String!) {' +
      ' metaobjectCreate(metaobject: { type: $type, handle: $handle, fields: [' +
      ' { key: "cart_data", value: $cartData },' +
      ' { key: "unique_code", value: $code },' +
      ' { key: "expiration_date", value: $expiresAt }' +
      ' ] }) {' +
      '   metaobject { handle }' +
      '   userErrors { field message code }' +
      ' }' +
      '}';

    var attempts = 0;
    var maxAttempts = 4;
    var self = this;

    function attemptCreation() {
      var code = self.generateShareCode();
      debugLog('Attempting metaobjectCreate for shared cart with handle', code);
      var payload = {
        query: mutation,
        variables: {
          handle: code,
          cartData: cartPayload,
          code: code,
          expiresAt: expiresAt,
          type: type
        }
      };

      return createRequest(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Shopify-Storefront-Access-Token': token
        },
        body: JSON.stringify(payload)
      })
        .then(function (response) {
          if (!response.ok) {
            throw new Error('Unable to create shared cart link.');
          }
          return response.json();
        })
        .then(function (result) {
          if (!result) {
            throw new Error('Unable to create shared cart link.');
          }
          if (result.errors && result.errors.length) {
            throw new Error(result.errors[0] && result.errors[0].message ? result.errors[0].message : 'Unable to create shared cart link.');
          }
          var data = result.data && result.data.metaobjectCreate;
          if (data && data.metaobject && data.metaobject.handle) {
            return origin + '/cart/s/' + data.metaobject.handle;
          }
          var userErrors = (data && data.userErrors) || [];
          if (userErrors.length) {
            var first = userErrors[0] || {};
            var message = first.message || 'Unable to create shared cart link.';
            var codeTaken = false;
            if (first.code) {
              var normalizedCode = String(first.code).toUpperCase();
              codeTaken = normalizedCode === 'TAKEN' || normalizedCode === 'ALREADY_EXISTS';
            } else if (message) {
              var normalizedMessage = message.toLowerCase();
              codeTaken = normalizedMessage.indexOf('handle') !== -1 || normalizedMessage.indexOf('taken') !== -1 || normalizedMessage.indexOf('exists') !== -1;
            }
            if (codeTaken && attempts < maxAttempts) {
              attempts += 1;
              return attemptCreation();
            }
            throw new Error(message);
          }
          throw new Error('Unable to create shared cart link.');
        });
    }

    return attemptCreation();
  };

  ShareCartManager.prototype.buildShareLink = function () {
    var self = this;
    return this.fetchCart().then(function (cart) {
      if (!cart || !cart.items || cart.items.length === 0) {
        throw new Error('Your cart is empty.');
      }
      var shareItems = self.extractShareItems(cart);
      if (!shareItems.length) {
        throw new Error('Your cart is empty.');
      }

      if (!shareCartConfig || !shareCartConfig.storefrontToken) {
        debugLog('Share cart storefront token missing, using legacy link');
        return self.buildLegacyShareLink(shareItems);
      }

      return self.createMetaobjectShare(cart);
    });
  };

  ShareCartManager.prototype.copyToClipboard = function (text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(text).catch(function () {
        return legacyCopy(text);
      });
    }
    return legacyCopy(text);

    function legacyCopy(value) {
      return new Promise(function (resolve, reject) {
        var textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        try {
          document.execCommand('copy');
          resolve();
        } catch (err) {
          reject(err);
        } finally {
          document.body.removeChild(textarea);
        }
      });
    }
  };

  ShareCartManager.prototype.refreshButtonStates = function () {
    var self = this;
    this.fetchCart()
      .then(function (cart) {
        self.updateButtons(cart);
      })
      .catch(function () {
        self.updateButtons(null);
      });
  };

  ShareCartManager.prototype.updateButtons = function (cart) {
    var disabled = !cart || !cart.item_count;
    this.buttons.forEach(function (button) {
      if (!document.body.contains(button)) return;
      button.disabled = disabled;
      if (disabled) {
        button.setAttribute('aria-disabled', 'true');
      } else {
        button.removeAttribute('aria-disabled');
      }
    });
  };

  ShareCartManager.prototype.showToast = function (message, isError) {
    if (!message) return;
    var toast = document.createElement('div');
    toast.className = 'share-cart-toast';
    toast.textContent = message;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.classList.add(isError ? 'is-error' : 'is-success');
    document.body.appendChild(toast);
    requestAnimationFrame(function () {
      toast.classList.add('is-visible');
    });
    setTimeout(function () {
      toast.classList.remove('is-visible');
      setTimeout(function () {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    }, 2200);
  };

  ShareCartManager.prototype.reconstructIfShared = function () {
    if (window.__shareCartBoot && window.__shareCartBoot.initialized) {
      debugLog('Legacy reconstruction skipped (boot active)');
      return;
    }
    if (this.reconstructing) return;
    var search = window.location.search;
    if (!search || search.indexOf('shared=') === -1) return;

    var params = new URLSearchParams(search);
    var encoded = params.get('shared');
    if (!encoded) return;

    this.reconstructing = true;
    var self = this;

    var decoded;
    try {
      decoded = JSON.parse(base64Decode(encoded));
    } catch (error) {
      console.error('ShareCart decode error', error);
      this.finishSharedFlowWithError('We could not read this shared cart.');
      this.reconstructing = false;
      return;
    }

    if (!Array.isArray(decoded)) {
      this.finishSharedFlowWithError('This shared cart link is invalid.');
      this.reconstructing = false;
      return;
    }

    var items = decoded.map(function (item) {
      var entry = {
        id: item.id,
        quantity: item.quantity
      };
      if (item.properties) {
        var cleanedProps = sanitizeProperties(item.properties);
        if (cleanedProps) {
          entry.properties = cleanedProps;
        }
      }
      if (item.selling_plan) {
        entry.selling_plan = item.selling_plan;
      }
      return entry;
    });

    createRequest('/cart/clear.js', { method: 'POST' })
      .then(function (response) {
        if (!response.ok) {
          throw new Error('Unable to reset cart.');
        }
        if (items.length === 0) {
          return null;
        }
        return createRequest('/cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ items: items })
        });
      })
      .then(function (response) {
        if (response && !response.ok) {
          return response.json().then(function (error) {
            var message = (error && (error.description || error.message)) || 'Unable to add shared cart.';
            throw new Error(message);
          });
        }
        self.removeSharedParam();
        window.location.replace('/cart');
      })
      .catch(function (error) {
        console.error('ShareCart rebuild error', error);
        self.finishSharedFlowWithError((error && error.message) || 'Some items in this shared cart are unavailable.');
      })
      .finally(function () {
        self.reconstructing = false;
      });
  };

  ShareCartManager.prototype.finishSharedFlowWithError = function (message) {
    this.removeSharedParam();
    this.showToast(message, true);
  };

  ShareCartManager.prototype.removeSharedParam = function () {
    var url = new URL(window.location.href);
    url.searchParams.delete('shared');
    window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
  };

  var manager = new ShareCartManager();
  window.ShareCart = manager;
  manager.init();
  window.dispatchEvent(new CustomEvent('sharecart:ready'));

  manager.reconstructIfShared();
})();
