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

    function processSharedParam(sharedValue) {
      if (!sharedValue) return;
      var signature = signatureFor(sharedValue);
      if (signature && handledSignatures[signature]) {
        debugLog('Shared param already handled');
        return;
      }
      handledSignatures[signature] = true;

      var decoded = decodeSharedPayload(sharedValue);
      if (!decoded) {
        debugLog('Failed to decode shared payload');
        stripSharedParam();
        return;
      }

      var items;
      try {
        items = JSON.parse(decoded);
      } catch (err) {
        debugLog('Failed to parse shared payload JSON');
        stripSharedParam();
        return;
      }

      var sanitized = sanitizeItems(items);
      if (!sanitized.length) {
        debugLog('No valid shared items after sanitization');
        stripSharedParam();
        return;
      }

      isRunning = true;
      rebuildCart(sanitized)
        .then(function (result) {
          debugLog('Cart rebuild complete', result);
          stripSharedParam();
          if (!result || !result.partial) {
            clearNotice();
          }
          window.location.replace('/cart');
        })
        .catch(function (err) {
          debugLog('Cart rebuild failed', describeError(err));
          stripSharedParam();
        })
        .finally(function () {
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
      if (!params || !params.get) {
        debugLog('URLSearchParams unavailable');
        return;
      }
      var shared = params.get('shared');
      if (!shared) {
        debugLog('No shared param detected');
        return;
      }
      debugLog('Shared param detected');
      processSharedParam(shared);
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
