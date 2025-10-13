(function () {
  'use strict';

  if (window.ShareCart) {
    return;
  }

  var SELECTORS = {
    drawer: {
      containers: ['.cart-drawer__actions', '.cart-drawer__footer'],
      checkout: '.cart-drawer__checkout-btn'
    },
    sidebar: {
      host: '#cart-sidebar',
      body: '.cart-sidebar__body',
      checkout: '.cart-sidebar__checkout-btn'
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
    if (!element || typeof window.getComputedStyle !== 'function') return false;
    var style = window.getComputedStyle(element);
    return style && (style.display === 'none' || style.visibility === 'hidden');
  }

  function ShareCartManager() {
    this.buttons = new Set();
    this.renderTimer = null;
    this.cartRequest = null;
    this.cartData = null;
    this.lastCartFetch = 0;
    this.observer = null;
    this.reconstructing = false;
    this.handleButtonClick = this.handleButtonClick.bind(this);
    this.scheduleRender = this.scheduleRender.bind(this);
  }

  ShareCartManager.prototype.init = function () {
    this.injectStyles();
    this.injectAll();
    this.refreshButtonStates();
    this.observe();
  };

  ShareCartManager.prototype.injectStyles = function () {
    if (document.getElementById('share-cart-styles')) return;
    var style = document.createElement('style');
    style.id = 'share-cart-styles';
    style.textContent = TOAST_STYLES;
    document.head.appendChild(style);
  };

  ShareCartManager.prototype.observe = function () {
    if (this.observer) return;
    var self = this;
    this.observer = new MutationObserver(function () {
      self.scheduleRender();
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
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
    if (!container) return;

    var inlineGroup = container.querySelector('.cart-drawer__continue-action');
    if (inlineGroup && isHidden(inlineGroup)) {
      inlineGroup = null;
    }

    var target = inlineGroup || container;
    if (target.querySelector('[data-share-cart]')) return;

    var button = this.createButton();
    if (inlineGroup) {
      button.classList.add('cart-drawer__secondary-link');
      this.ensureInlineDivider(inlineGroup);
      inlineGroup.appendChild(button);
    } else {
      var checkout = container.querySelector(SELECTORS.drawer.checkout);
      if (checkout && checkout.parentElement) {
        checkout.parentElement.insertBefore(button, checkout);
      } else {
        container.appendChild(button);
      }
    }
  };

  ShareCartManager.prototype.injectSidebarButton = function () {
    var hosts = document.querySelectorAll(SELECTORS.sidebar.host);
    if (!hosts || !hosts.length) return;

    for (var i = 0; i < hosts.length; i++) {
      var host = hosts[i];
      if (!host) continue;

      var hostCs = window.getComputedStyle(host);
      if (hostCs.display === 'none' || hostCs.visibility === 'hidden') continue;

      if (host.querySelector('[data-share-cart]')) {
        continue;
      }

      var inlineGroup = host.querySelector('.cart-drawer__continue-action');
      if (inlineGroup && isHidden(inlineGroup)) {
        inlineGroup = null;
      }

      if (inlineGroup) {
        var buttonInline = this.createButton();
        buttonInline.classList.add('cart-drawer__secondary-link');
        this.ensureInlineDivider(inlineGroup);
        inlineGroup.appendChild(buttonInline);
        continue;
      }

      var checkout = host.querySelector(SELECTORS.sidebar.checkout);
      var container = (checkout && checkout.parentElement) || host.querySelector(SELECTORS.sidebar.body);
      if (!container) continue;

      var containerCs = window.getComputedStyle(container);
      if (containerCs.display === 'none' || containerCs.visibility === 'hidden') continue;

      var button = this.createButton();
      container.appendChild(button);
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

    if (!container || container.querySelector('[data-share-cart]')) return;

    var button = this.createButton();
    var updateLink = container.querySelector('.cart-summary__update-link');
    if (updateLink && updateLink.parentElement === container) {
      updateLink.insertAdjacentElement('afterend', button);
    } else {
      var checkout = container.querySelector(SELECTORS.page.checkout) || container.querySelector(SELECTORS.page.form);
      if (checkout && checkout.parentElement) {
        checkout.parentElement.insertBefore(button, checkout.nextSibling);
      } else {
        container.appendChild(button);
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

  ShareCartManager.prototype.buildShareLink = function () {
    var self = this;
    return this.fetchCart().then(function (cart) {
      if (!cart || !cart.items || cart.items.length === 0) {
        throw new Error('Your cart is empty.');
      }

      var items = cart.items.map(function (item) {
        var payload = {
          id: item.variant_id,
          quantity: item.quantity
        };
        if (item.properties && Object.keys(item.properties).length > 0) {
          var cleaned = sanitizeProperties(item.properties);
          if (cleaned) {
            payload.properties = cleaned;
          }
        }
        var sellingPlanId = item.selling_plan || (item.selling_plan_allocation && item.selling_plan_allocation.selling_plan && item.selling_plan_allocation.selling_plan.id);
        if (sellingPlanId) {
          payload.selling_plan = sellingPlanId;
        }
        return payload;
      });

      var encoded = base64Encode(JSON.stringify(items));
      var origin = window.location.origin || (window.location.protocol + '//' + window.location.host);
      var link = origin.replace(/\/$/, '') + '/cart?shared=' + encodeURIComponent(encoded);
      return link;
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

  if (window.__shareCartBoot) {
    manager.reconstructIfShared();
  }
})();