/* =====================================================================
   Protein Popcorn BOGO module for Add-ons page
   ===================================================================== */
(function(){
  document.addEventListener('DOMContentLoaded', function(){
    const container = document.querySelector('[data-pp-bogo]');
    if (!container) return;

    const params = new URLSearchParams(window.location.search);
    const devMode = params.get('bogo_dev') === '1' || params.get('pp_bogo_dev') === '1';

    function debug(){
      if (!devMode) return;
      const args = Array.from(arguments);
      args.unshift('[PP BOGO]');
      console.log.apply(console, args);
    }

    const defaultConfig = {
      enabled: false,
      endText: 'Ends Tuesday',
      giftEnabled: false,
      giftVariantId: null,
      flavors: [
        { label: 'Sample Savory', variantId: '1111111111' },
        { label: 'Sample BBQ', variantId: '2222222222' }
      ]
    };
    const config = Object.assign({}, defaultConfig, window.ppBogoConfig || {});
    debug('config', config);
    if ((!config.flavors || config.flavors.length === 0)) {
      if (devMode) {
        config.flavors = defaultConfig.flavors;
      } else {
        container.classList.add('hidden');
        return;
      }
    }

    const flavorSelect = container.querySelector('[data-pp-bogo-flavor]');
    const endEl = container.querySelector('[data-pp-bogo-end]');
    const addBtn = container.querySelector('[data-pp-bogo-add]');

    // populate flavors
    const availabilityPromises = [];
    flavorSelect.innerHTML = '';
    (config.flavors || []).forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.variantId;
      opt.textContent = f.label;
      opt.disabled = true;
      flavorSelect.appendChild(opt);
      availabilityPromises.push(
        checkAvailability(f.variantId).then(avail => {
          if (avail) {
            opt.disabled = false;
          } else {
            opt.textContent += ' (Unavailable)';
          }
        })
      );
    });

    Promise.allSettled(availabilityPromises).then(() => {
      const firstEnabled = Array.from(flavorSelect.options).find(o => !o.disabled);
      if (firstEnabled) {
        flavorSelect.value = firstEnabled.value;
      } else if (!devMode) {
        container.classList.add('hidden');
      }
      updateBtnState();
    });

    endEl.textContent = config.endText || 'Ends Tuesday';

    flavorSelect.addEventListener('change', updateBtnState);
    function updateBtnState(){
      const option = flavorSelect.options[flavorSelect.selectedIndex];
      addBtn.disabled = !option || option.disabled;
    }

    function isMeal(item){
      const type = String(item.product_type || '').toLowerCase();
      const handle = String(item.handle || '').toLowerCase();
      // Exclude clearly non-meal categories only
      const nonMealTypes = ['peanut butter','protein popcorn','seasoning','beverage','options_hidden_product'];
      if (nonMealTypes.includes(type)) return false;
      // Everything else (including meal plans) is counted; multiplier handles 12/24 parsing
      return true;
    }
    function mealMultiplier(item){
      if (item.properties && item.properties._meals_per_unit){
        const n = parseInt(item.properties._meals_per_unit,10);
        if(!isNaN(n) && n>0) return n;
      }
      const sources = [item.variant_title,item.title,item.sku]
        .filter(Boolean)
        .map(s => String(s).toLowerCase());
      for (const src of sources){
        // catches "12 Meal", "12-Meal", "24 meals"
        const m = src.match(/(\d+)\s*[- ]*\s*meal(s)?\b/);
        if (m){
          const n = parseInt(m[1],10);
          if(!isNaN(n) && n>0) return n;
        }
      }
      return 1;
    }
    function mealCount(cart){
      return (cart.items || []).reduce((count,item)=>{
        if(!isMeal(item)) return count;
        return count + item.quantity * mealMultiplier(item);
      },0);
    }
    function fetchCart(){
      return fetch('/cart.js', {credentials:'same-origin'}).then(r=>r.json());
    }

    async function syncGift(cart, eligible){
      if (!config.giftEnabled || !config.giftVariantId) { debug('skip gift: not configured'); return; }
      const items = cart.items || [];
      const giftId = String(config.giftVariantId);
      const giftLine = items.find(i => String(i.variant_id) === giftId);
      const hasBogo = items.some(i => (config.flavors || []).some(f => String(f.variantId) === String(i.variant_id)));
      debug('syncGift', {hasBogo, giftLine, eligible});

      try {
        if (hasBogo && eligible){
          if (!giftLine){
            debug('adding gift');
            await fetch('/cart/add.js', {
              method:'POST',
              headers:{'Content-Type':'application/json'},
              body: JSON.stringify({ id: giftId, quantity:1, properties:{ _bogo_gift:'1' } })
            });
            const newCart = await fetchCart();
            document.dispatchEvent(new CustomEvent('cart:updated', { detail:{ cart:newCart } }));
          } else if (giftLine.quantity > 1){
            debug('reducing gift quantity');
            const lineIndex = items.findIndex(i => String(i.key) === String(giftLine.key)) + 1;
            await fetch('/cart/change.js', {
              method:'POST',
              headers:{'Content-Type':'application/json'},
              body: JSON.stringify({ line: lineIndex, quantity:1 })
            });
            const newCart = await fetchCart();
            document.dispatchEvent(new CustomEvent('cart:updated', { detail:{ cart:newCart } }));
          }
        } else if (giftLine){
          debug('removing gift');
          const lineIndex = items.findIndex(i => String(i.key) === String(giftLine.key)) + 1;
          await fetch('/cart/change.js', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ line: lineIndex, quantity:0 })
          });
          const newCart = await fetchCart();
          document.dispatchEvent(new CustomEvent('cart:updated', { detail:{ cart:newCart } }));
        }
      } catch(err){
        console.error('PP BOGO gift sync failed', err);
      }
    }

    async function evaluate(){
      try{
        const cart = await fetchCart();
        const count = mealCount(cart);
        const eligible = count >= 14;
        debug('evaluate', {count, eligible});
        if (eligible || devMode){
          container.classList.remove('hidden');
        } else {
          container.classList.add('hidden');
        }
        await syncGift(cart, eligible);
      } catch(e) {
        console.error('PP BOGO eval failed', e);
      }
    }

    evaluate();
    document.addEventListener('cart:updated', evaluate);

    addBtn.addEventListener('click', async () => {
      const selected = flavorSelect.value;
      if (!selected) return;

      try {
        if (!devMode){
          const cart = await fetchCart();
          if (mealCount(cart) < 14){
            container.classList.add('hidden');
            return;
          }
        }
        addBtn.disabled = true;
        const res = await fetch('/cart/add.js', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ id: selected, quantity:1 })
        });
        if (!res.ok) throw new Error('Add to cart failed');
        const newCart = await fetchCart();
        document.dispatchEvent(new CustomEvent('cart:updated', { detail:{ cart:newCart } }));
      } catch(e){
        console.error('PP BOGO add failed', e);
      } finally {
        addBtn.disabled = false;
      }
    });

    function checkAvailability(id){
      return fetch(`/variants/${id}.json`)
        .then(r => r.json())
        .then(data => data && data.variant && data.variant.available)
        .catch(()=>false);
    }
  });
})();
