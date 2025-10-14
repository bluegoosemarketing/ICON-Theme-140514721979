(function () {
  'use strict';

  try {
    var global = window;
    var bootState = global.__shareCartBoot = global.__shareCartBoot || {};
    if (bootState.initialized) {
      return;
    }
    bootState.initialized = true;

    var handledSignatures = bootState.handledSignatures = bootState.handledSignatures || Object.create(null);
    var isRunning = false;
    var visibilityNoticeKey = 'shareCart:lastNotice';
    var loadingClassName = 'share-cart-loading';
    var loadingSelectors = {
      screen: '[data-share-cart-loading]',
      message: '[data-share-cart-loading-message]',
      spinner: '[data-share-cart-loading-spinner]'
    };
    var shareCartConfig = global.__SHARE_CART_CONFIG__ || {};
    var defaultLoadingMessage = shareCartConfig.defaultLoadingMessage || 'You have great friends... building your cart now!';
    var metaobjectType = shareCartConfig.metaobjectType || 'shared_cart';

    function currentParams() {
      try {
        return new URLSearchParams(window.location.search);
      } catch (err) {
        return null;
      }
    }

    function isDebugEnabled(params) {
      params = params || currentParams();
      return !!(params && params.get('scdebug') === '1');
    }

    function debugLog() {
      if (!bootState.debugEnabled) return;
      if (typeof console === 'undefined' || typeof console.log !== 'function') return;
      var args = Array.prototype.slice.call(arguments);
      args.unshift('[ShareCart]');
      console.log.apply(console, args);
    }

    function describeError(err) {
      if (!err) return 'Unknown error';
      if (typeof err === 'string') return err;
      if (err.message) return err.message;
      return String(err);
    }

    function setLoadingScreenVisible(visible) {
      var root = document.documentElement;
      if (!root) return;
      if (visible) {
        root.classList.add(loadingClassName);
      } else {
        root.classList.remove(loadingClassName);
      }
      var screen = document.querySelector(loadingSelectors.screen);
      if (screen) {
        screen.setAttribute('aria-hidden', visible ? 'false' : 'true');
      }
    }

    function updateLoadingScreen(message, isError) {
      var screen = document.querySelector(loadingSelectors.screen);
      if (!screen) return;
      if (isError) {
        screen.classList.add('is-error');
      } else {
        screen.classList.remove('is-error');
      }
      if (message) {
        var messageNode = screen.querySelector(loadingSelectors.message);
        if (messageNode) {
          messageNode.textContent = message;
        }
      }
      var spinner = screen.querySelector(loadingSelectors.spinner);
      if (spinner) {
        if (isError) {
          spinner.style.display = 'none';
          spinner.setAttribute('aria-hidden', 'true');
        } else {
          spinner.style.display = '';
          spinner.setAttribute('aria-hidden', 'false');
        }
      }
    }

    function handleFlowError(message, context) {
      updateLoadingScreen(message || 'Unable to rebuild shared cart.', true);
      if (context && context.type === 'query') {
        stripSharedParam();
      } else if (context && context.type === 'short') {
        stripShortPath();
      }
      setTimeout(function () {
        setLoadingScreenVisible(false);
      }, 1800);
    }

    function normalizeBase64(value) {
      if (!value || typeof value !== 'string') return null;
      var normalized = value.replace(/-/g, '+').replace(/_/g, '/');
      while (normalized.length % 4 !== 0) {
        normalized += '=';
      }
      return normalized;
    }

    function decodeSharedPayload(raw) {
      var normalized = normalizeBase64(raw);
      if (!normalized) return null;
      try {
        var decoded = atob(normalized);
        var uriDecoded = decodeURIComponent(
          decoded
            .split('')
            .map(function (char) {
              return '%' + ('00' + char.charCodeAt(0).toString(16)).slice(-2);
            })
            .join('')
        );
        return uriDecoded;
      } catch (err) {
        return null;
      }
    }

    function sanitizeItems(rawItems) {
      if (!Array.isArray(rawItems)) return [];
      var output = [];
      for (var i = 0; i < rawItems.length; i++) {
        var item = rawItems[i];
        if (!item) continue;
        var id = Number(item.id);
        var quantity = Number(item.quantity || 0);
        if (!id || !quantity || quantity < 1) continue;
        var cleaned = { id: id, quantity: quantity };
        if (item.properties && typeof item.properties === 'object') {
          var properties = {};
          Object.keys(item.properties).forEach(function (key) {
            var value = item.properties[key];
            if (value !== '' && value !== null && value !== undefined) {
              properties[key] = String(value);
            }
          });
          if (Object.keys(properties).length) {
            cleaned.properties = properties;
          }
        }
        if (item.selling_plan) {
          var sellingPlan = Number(item.selling_plan);
          cleaned.selling_plan = sellingPlan || item.selling_plan;
        }
        output.push(cleaned);
      }
      return output;
    }

    function stripSharedParam() {
      try {
        var url = new URL(window.location.href);
        if (!url.searchParams.has('shared')) return;
        url.searchParams.delete('shared');
        var newSearch = url.searchParams.toString();
        var newUrl = url.pathname + (newSearch ? '?' + newSearch : '') + url.hash;
        window.history.replaceState({}, document.title, newUrl);
      } catch (err) {
        // Ignore inability to manipulate history
      }
    }

    function stripShortPath() {
      try {
        var path = window.location.pathname || '';
        if (path.toLowerCase().indexOf('/cart/s/') !== 0) return;
        var newUrl = '/cart';
        var search = window.location.search || '';
        if (search) {
          newUrl += search;
        }
        var hash = window.location.hash || '';
        if (hash) {
          newUrl += hash;
        }
        window.history.replaceState({}, document.title, newUrl);
      } catch (err) {
        // Ignore inability to manipulate history
      }
    }

    function requestWithRetry(url, options, attempt) {
      attempt = attempt || 0;
      return fetch(url, Object.assign({ credentials: 'same-origin' }, options)).then(function (response) {
        if (!response.ok && attempt < 1 && (response.status === 429 || response.status >= 500)) {
          return new Promise(function (resolve) {
            setTimeout(resolve, 400);
          }).then(function () {
            return requestWithRetry(url, options, attempt + 1);
          });
        }
        return response;
      });
    }

    function detectSharedContext(params) {
      var path = '';
      try {
        path = window.location.pathname || '';
      } catch (err) {
        path = '';
      }

      if (params && typeof params.get === 'function') {
        var sharedValue = params.get('shared');
        if (sharedValue) {
          return {
            type: 'query',
            value: sharedValue,
            signature: 'shared:' + signatureFor(sharedValue)
          };
        }
      }

      if (path && path.toLowerCase().indexOf('/cart/s/') === 0) {
        var match = path.match(/\/cart\/s\/([^/?#]+)/i);
        if (match && match[1]) {
          var decoded = null;
          try {
            decoded = decodeURIComponent(match[1]);
          } catch (err) {
            decoded = match[1];
          }
          return {
            type: 'short',
            code: decoded,
            signature: 'short:' + signatureFor(decoded)
          };
        }
      }

      return null;
    }

    function extractItemsFromCartData(cartData) {
      if (!cartData || !Array.isArray(cartData.items)) return [];
      var rawItems = [];
      for (var i = 0; i < cartData.items.length; i++) {
        var item = cartData.items[i];
        if (!item) continue;
        var variantId = item.variant_id || item.id;
        var quantity = Number(item.quantity || 0);
        if (!variantId || !quantity || quantity < 1) continue;
        var entry = { id: variantId, quantity: quantity };
        if (item.properties && typeof item.properties === 'object') {
          entry.properties = item.properties;
        }
        var sellingPlanId = null;
        if (item.selling_plan_allocation && item.selling_plan_allocation.selling_plan && item.selling_plan_allocation.selling_plan.id) {
          sellingPlanId = item.selling_plan_allocation.selling_plan.id;
        } else if (item.selling_plan) {
          sellingPlanId = item.selling_plan;
        }
        if (sellingPlanId) {
          entry.selling_plan = sellingPlanId;
        }
        rawItems.push(entry);
      }
      return rawItems;
    }

    function fetchSharedCartByHandle(handle) {
      if (!handle) {
        return Promise.reject(new Error('This shared cart link is invalid.'));
      }

      var token = shareCartConfig.storefrontToken;
      if (!token) {
        return Promise.reject(new Error('This shared cart link is currently unavailable.'));
      }

      var apiVersion = shareCartConfig.apiVersion || '2024-07';
      var endpoint = shareCartConfig.graphqlEndpoint;

      if (!endpoint) {
        try {
          var origin = window.location.origin || (window.location.protocol + '//' + window.location.host);
          endpoint = origin.replace(/\/$/, '') + '/api/' + apiVersion + '/graphql.json';
        } catch (err) {
          endpoint = '/api/' + apiVersion + '/graphql.json';
        }
      }

      var query =
        'query SharedCartByHandle($handle: String!, $type: String!) {' +
        ' metaobjectByHandle(handle: { type: $type, handle: $handle }) {' +
        '   id' +
        '   fields { key value }' +
        ' }' +
        '}';

      var body = JSON.stringify({
        query: query,
        variables: { handle: handle, type: metaobjectType }
      });

      return requestWithRetry(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Shopify-Storefront-Access-Token': token
        },
        body: body
      })
        .then(function (response) {
          if (!response.ok) {
            throw new Error('Unable to load this shared cart.');
          }
          return response.json();
        })
        .then(function (payload) {
          if (!payload) {
            throw new Error('Unable to load this shared cart.');
          }
          if (payload.errors && payload.errors.length) {
            throw new Error(payload.errors[0] && payload.errors[0].message ? payload.errors[0].message : 'Unable to load this shared cart.');
          }
          var metaobject = payload.data && payload.data.metaobjectByHandle;
          if (!metaobject) {
            throw new Error('This shared cart link could not be found.');
          }
          var fieldMap = {};
          if (Array.isArray(metaobject.fields)) {
            metaobject.fields.forEach(function (field) {
              if (!field || !field.key) return;
              fieldMap[field.key] = field.value;
            });
          }
          var expiration = fieldMap.expiration_date ? Date.parse(fieldMap.expiration_date) : NaN;
          if (!isNaN(expiration) && expiration < Date.now()) {
            throw new Error('This shared cart link has expired.');
          }
          var rawCart = fieldMap.cart_data;
          if (!rawCart) {
            throw new Error('This shared cart is unavailable.');
          }
          var parsedCart;
          try {
            parsedCart = JSON.parse(rawCart);
          } catch (err) {
            throw new Error('We could not read this shared cart.');
          }
          var rawItems = extractItemsFromCartData(parsedCart);
          return sanitizeItems(rawItems);
        });
    }

    function beginCartRebuild(sanitized, context) {
      if (!sanitized || !sanitized.length) {
        debugLog('No valid shared items after sanitization');
        handleFlowError('This shared cart is empty.', context);
        isRunning = false;
        return;
      }

      rebuildCart(sanitized)
        .then(function (result) {
          debugLog('Cart rebuild complete', result);
          if (context && context.type === 'query') {
            stripSharedParam();
          } else if (context && context.type === 'short') {
            stripShortPath();
          }
          if (!result || !result.partial) {
            clearNotice();
          }
          window.location.replace('/cart');
        })
        .catch(function (err) {
          debugLog('Cart rebuild failed', describeError(err));
          handleFlowError((err && err.message) || 'Unable to add shared cart.', context);
        })
        .finally(function () {
          isRunning = false;
        });
    }

    function signatureFor(value) {
      if (!value) return null;
      return String(value);
    }

    function storeNotice(message) {
      try {
        localStorage.setItem(
          visibilityNoticeKey,
          JSON.stringify({ message: message, ts: Date.now() })
        );
      } catch (err) {
        // ignore storage errors
      }
    }

    function clearNotice() {
      try {
        localStorage.removeItem(visibilityNoticeKey);
      } catch (err) {
        // ignore storage errors
      }
    }

    function handlePartialFailure(failedItems) {
      if (!failedItems || !failedItems.length) return;
      var message = 'Some shared cart items could not be added.';
      storeNotice(message);
      debugLog('Partial add failure for items', failedItems);
    }

    function fallbackAddItems(items) {
      var sequence = Promise.resolve();
      var addedCount = 0;
      var failed = [];

      items.forEach(function (item) {
        sequence = sequence.then(function () {
          debugLog('Fallback POST /cart/add.js', item);
          return requestWithRetry('/cart/add.js', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json'
            },
            body: JSON.stringify({ items: [item] })
          }).then(function (response) {
            if (!response.ok) {
              failed.push(item);
            } else {
              addedCount += 1;
            }
          });
        });
      });

      return sequence.then(function () {
        return { added: addedCount, failed: failed };
      });
    }

    function rebuildCart(items) {
      debugLog('Starting cart rebuild with', items.length, 'items');
      debugLog('POST /cart/clear.js');
      return requestWithRetry('/cart/clear.js', {
        method: 'POST',
        headers: { Accept: 'application/json' }
      })
        .then(function (clearResponse) {
          if (!clearResponse.ok) {
            throw new Error('Unable to clear cart');
          }
          debugLog('POST /cart/add.js (batch)');
          return requestWithRetry('/cart/add.js', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json'
            },
            body: JSON.stringify({ items: items })
          });
        })
        .then(function (addResponse) {
          if (addResponse.ok) {
            return { success: true };
          }
          return addResponse
            .json()
            .catch(function () {
              return {};
            })
            .then(function (payload) {
              var fallbackMessage = payload && (payload.description || payload.message);
              debugLog('Batch add failed, attempting fallback', fallbackMessage || addResponse.status);
              return fallbackAddItems(items).then(function (result) {
                if (result.added > 0) {
                  handlePartialFailure(result.failed);
                  return { success: true, partial: result.failed.length > 0 };
                }
                var errorMessage = fallbackMessage || 'Unable to add shared cart.';
                throw new Error(errorMessage);
              });
            });
        });
    }

    function processSharedParam(sharedValue, context) {
      if (!sharedValue) {
        handleFlowError('This shared cart link is invalid.', context);
        isRunning = false;
        return;
      }
      var decoded = decodeSharedPayload(sharedValue);
      if (!decoded) {
        debugLog('Failed to decode shared payload');
        handleFlowError('This shared cart link is invalid.', context);
        isRunning = false;
        return;
      }

      var items;
      try {
        items = JSON.parse(decoded);
      } catch (err) {
        debugLog('Failed to parse shared payload JSON');
        handleFlowError('This shared cart link is invalid.', context);
        isRunning = false;
        return;
      }

      var sanitized = sanitizeItems(items);
      beginCartRebuild(sanitized, context);
    }

    function processSharedCode(code, context) {
      if (!code) {
        debugLog('Missing short code for shared cart');
        handleFlowError('This shared cart link is invalid.', context);
        isRunning = false;
        return;
      }

      fetchSharedCartByHandle(code)
        .then(function (sanitized) {
          beginCartRebuild(sanitized, context);
        })
        .catch(function (err) {
          debugLog('Unable to fetch shared cart by code', describeError(err));
          handleFlowError((err && err.message) || 'Unable to load this shared cart.', context);
          isRunning = false;
        });
    }

    function run(trigger) {
      if (isRunning) {
        debugLog('Rebuild already running, skip trigger', trigger);
        return;
      }
      bootState.debugEnabled = isDebugEnabled();
      debugLog('Boot running via', trigger || 'immediate');
      var params = currentParams();
      var context = detectSharedContext(params);
      if (!context || !context.signature) {
        debugLog('No shared context detected');
        setLoadingScreenVisible(false);
        return;
      }

      if (handledSignatures[context.signature]) {
        debugLog('Shared context already handled');
        return;
      }

      handledSignatures[context.signature] = true;
      isRunning = true;
      setLoadingScreenVisible(true);
      updateLoadingScreen(defaultLoadingMessage, false);

      if (context.type === 'query') {
        debugLog('Shared param detected');
        processSharedParam(context.value, context);
      } else if (context.type === 'short') {
        debugLog('Short shared cart code detected');
        processSharedCode(context.code, context);
      }
    }

    function scheduleInitialRun() {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function onReady() {
          document.removeEventListener('DOMContentLoaded', onReady);
          run('DOMContentLoaded');
        });
      } else {
        run('immediate');
      }
    }

    function attachListeners() {
      var triggers = [
        ['pageshow', window],
        ['popstate', window],
        ['page:load', document],
        ['page:change', document],
        ['shopify:section:load', document],
        ['turbo:load', document],
        ['turbo:render', document],
        ['app:loaded', document]
      ];

      triggers.forEach(function (entry) {
        var eventName = entry[0];
        var target = entry[1];
        if (!target || typeof target.addEventListener !== 'function') return;
        target.addEventListener(eventName, function () {
          run(eventName);
        });
      });
    }

    scheduleInitialRun();
    attachListeners();
  } catch (err) {
    if (typeof console !== 'undefined' && typeof console.error === 'function') {
      console.error('[ShareCart] boot error', err);
    }
  }
})();
