/*
  Custom Meal Recharge Bundle Builder - v8.2 (Container-Aware Scroll Fix)
  - Merges new Accordion UI and Auto-Advance feature with original, stable logic.
  - FIX: Restored the robust `handleAddToCart` to ensure bundled items are added correctly.
  - FIX: Restored the detailed `emitMacroSelections` logic for the nutrition calculator.
  - REVISED: The `scrollToElement` function now targets the page's *internal* scroll container (`#main`) instead of the `window`, making it compatible with the strict full-height CSS layout. This definitively solves the "content cut-off" issue.
*/

const CM_UNIT_OVERRIDES = {
  byTitle: { 'Beyond Meat Vegan Patty':{unit:'EA'},'Black Bean Vegan Patty':{unit:'EA'},'Turkey Bacon':{unit:'SL'},'Home Style Protein Pancakes':{unit:'EA'},'Brown Rice':{unit:'C',fractionMap:{'1/4':1,'1/2':2,'1':4,'1.5':6,'2':8}},'Gluten Free Penne Pasta':{unit:'C',fractionMap:{'1/4':1,'1/2':2,'1':4,'1.5':6,'2':8}},'Jasmine Saffron Rice':{unit:'C',fractionMap:{'1/4':1,'1/2':2,'1':4,'1.5':6,'2':8}},'Kyoto Blend Veggies':{unit:'C',fractionMap:{'1/4':1,'1/2':2,'1':4,'1.5':6,'2':8}},'Quinoa':{unit:'C',fractionMap:{'1/4':1,'1/2':2,'1':4,'1.5':6,'2':8}},'Red Quinoa':{unit:'C',fractionMap:{'1/4':1,'1/2':2,'1':4,'1.5':6,'2':8}},'Quinoa Rice Blend':{unit:'C',fractionMap:{'1/4':1,'1/2':2,'1':4,'1.5':6,'2':8}},'White Rice':{unit:'C',fractionMap:{'1/4':1,'1/2':2,'1':4,'1.5':6,'2':8}},'Oatmeal':{unit:'C',fractionMap:{'1/2':2,'1':4,'2':8}}}
};
const CM_UNIT_DEFINITIONS = [ {key:'OZ',keywords:['oz','ounce','ounces'],displaySingular:'oz',displayPlural:'oz'},{key:'C',keywords:['cup','cups'],displaySingular:'c',displayPlural:'c'},{key:'EA',keywords:['ea','each'],displaySingular:'ea',displayPlural:'ea'},{key:'SL',keywords:['slice','slices','sl'],displaySingular:'sl',displayPlural:'sl'} ];
const CM_UNICODE_FRACTIONS = { '¼':0.25,'½':0.5,'¾':0.75,'⅓':1/3,'⅔':2/3,'⅛':0.125,'⅜':0.375,'⅝':0.625,'⅞':0.875 };

class CustomMealBuilder {
  constructor(element) {
    this.root = element;
    if (!this.root || this.root.dataset.cmRechargeInitialized === 'true') return;
    this.root.dataset.cmRechargeInitialized = 'true';

    // DOM Elements
    this.form = this.root.querySelector('[data-cm-form]');
    this.proteinSelect = this.root.querySelector('[data-protein-select]');
    this.side1Select = this.root.querySelector('[data-side1-select]');
    this.side2Select = this.root.querySelector('[data-side2-select]');
    this.proteinProductSelect = this.root.querySelector('[data-product-select="protein"]');
    this.side1ProductSelect = this.root.querySelector('[data-product-select="side1"]');
    this.side2ProductSelect = this.root.querySelector('[data-product-select="side2"]');
    this.frequencySelect = this.root.querySelector('[data-frequency-select]');
    this.quantityInput = this.root.querySelector('[data-qty-input]');
    this.priceDisplays = this.root.querySelectorAll('[data-total-price]');
    this.priceWrappers = this.root.querySelectorAll('[data-price-wrapper]');
    this.addToCartButton = this.root.querySelector('[data-add-to-cart-button]');
    this.addToCartText = this.root.querySelector('[data-add-to-cart-text]');
    this.collapsibleSteps = this.root.querySelectorAll('[data-collapsible-step]');
    
    // Data & State
    this.state = { quantity: 1, sellingPlanId: null, totalPrice: 0, isLoading: true };
    this.variantDetails = new Map();
    this.productData = { protein: [], side: [] };
    this.productImageData = new Map();
    const sellingPlanElement = document.getElementById(`RechargeSellingPlans-${this.root.dataset.sectionId}`);
    try {
      this.sellingPlanGroups = sellingPlanElement ? JSON.parse(sellingPlanElement.textContent || '[]') : [];
    } catch (e) {
      this.sellingPlanGroups = [];
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.initialize());
    } else { this.initialize(); }
  }

  async initialize() {
    try {
      await this.waitForRechargeBundle();
      this.bindEvents();
      this.bindAccordionEvents();
      this.populateFrequencies();

      const [proteins, sides] = await Promise.all([
        this.fetchCollectionProductsByHandle(this.root.dataset.proteinCollectionHandle),
        this.fetchCollectionProductsByHandle(this.root.dataset.sideCollectionHandle)
      ]);

      this.productData.protein = this.processProductData(proteins);
      this.productData.side = this.processProductData(sides);

      ['protein', 'side1', 'side2'].forEach(group => {
        const productSelect = this.root.querySelector(`[data-product-select="${group}"]`);
        const data = group === 'protein' ? this.productData.protein : this.productData.side;
        this.populateProductSelect(productSelect, data, group);
      });

      this.populateHiddenVariantSelects();
      this.renderAllVisualOptions();
      this.bindVisualOptionEvents();
      
      this.state.isLoading = false;
      this.update({ emitMacros: false });
    } catch (error) { console.error('Failed to initialize Custom Meal Builder:', error); this.showError('Could not load meal options. Please refresh.'); }
  }

  bindEvents() {
    this.root.querySelectorAll('[data-product-select]').forEach(select => {
      select.addEventListener('change', (event) => {
        const group = event.target.dataset.productSelect;
        this.renderVariantOptions(group, event.target.value);
        this.syncVisualSelection(group, event.target.value);
        this.updateStepState(group);
      });
    });

    this.form.addEventListener('click', (event) => {
      const button = event.target.closest('.variant-option-button');
      if (!button) return;
      const step = button.closest('[data-selection-group]');
      if (!step) return;

      const group = step.dataset.selectionGroup;
      const hiddenSelect = this.root.querySelector(`[data-${group}-select]`);
      const variantId = button.dataset.variantId;

      if (hiddenSelect) {
        hiddenSelect.value = variantId;
        step.querySelectorAll('.variant-option-button').forEach(btn => btn.classList.remove('is-selected'));
        button.classList.add('is-selected');
        this.update();
        this.updateStepState(group);

        const currentStep = button.closest('[data-collapsible-step]');
        if (currentStep) {
          const nextStep = currentStep.nextElementSibling;
          // If there is a next step, advance to it
          if (nextStep && nextStep.matches('[data-collapsible-step]')) {
            setTimeout(() => {
                currentStep.classList.remove('is-open');
                nextStep.classList.add('is-open');
                this.scrollToElement(nextStep);
            }, 300);
          } else {
            // Otherwise, this is the last step, so just close it after selection
            setTimeout(() => {
              currentStep.classList.remove('is-open');
            }, 300);
          }
        }
      }
    });

    this.quantityInput.addEventListener('change', () => this.update());
    this.root.querySelector('[data-qty-plus]').addEventListener('click', () => { this.quantityInput.stepUp(); this.update(); });
    this.root.querySelector('[data-qty-minus]').addEventListener('click', () => { this.quantityInput.stepDown(); this.update(); });
    this.frequencySelect.addEventListener('change', () => this.update());
    this.form.addEventListener('submit', (event) => this.handleAddToCart(event));
  }
  
  bindAccordionEvents() {
    this.form.addEventListener('click', (event) => {
        const toggle = event.target.closest('[data-collapsible-toggle]');
        if (!toggle) return;
        event.preventDefault();
        const currentStep = toggle.closest('[data-collapsible-step]');
        if (!currentStep) return;
        const isOpen = currentStep.classList.contains('is-open');
        this.collapsibleSteps.forEach(step => step.classList.remove('is-open'));
        if (!isOpen) currentStep.classList.add('is-open');
    });
  }

  // *** REVISED: Custom scroll function that targets the correct internal container ***
  scrollToElement(element) {
    if (!element) return;
    
    // The scrollable container is `#main` as defined in the CSS
    const scrollContainer = document.querySelector('#main');
    if (!scrollContainer) {
      console.warn('Scroll container #main not found. Scrolling may not work correctly.');
      // Fallback for safety, though it may not work with the new CSS
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const headerOffset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-offset')) || 80;
    
    const elementPosition = element.getBoundingClientRect().top;
    const containerPosition = scrollContainer.getBoundingClientRect().top;
    const currentScrollTop = scrollContainer.scrollTop;

    // Calculate the element's position relative to the top of the scrollable container
    const relativeElementPosition = elementPosition - containerPosition;
    
    // Calculate the final scroll position
    const desiredScrollTop = currentScrollTop + relativeElementPosition - headerOffset - 20; // 20px extra padding

    scrollContainer.scrollTo({
        top: desiredScrollTop,
        behavior: 'smooth'
    });
  }

  updateStepState(group) {
    const step = this.root.querySelector(`[data-selection-group="${group}"]`);
    if (!step) return;

    const hiddenSelect = this.root.querySelector(`[data-${group}-select]`);
    const summaryEl = step.querySelector('[data-selection-summary]');
    const legendTextEl = step.querySelector('.cm-step__legend-text');
    const isComplete = hiddenSelect && hiddenSelect.value !== '';

    step.classList.toggle('is-complete', isComplete);

    // Find the main text node, ignoring child elements like the summary span and <small> tag
    const textNode = Array.from(legendTextEl.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0);

    if (textNode && !legendTextEl.dataset.originalText) {
      // Store the original text (e.g., "Choose Protein") if we haven't already
      legendTextEl.dataset.originalText = textNode.textContent.trim();
    }
    
    if (isComplete) {
      const details = this.variantDetails.get(hiddenSelect.value);
      if (details && summaryEl && textNode && legendTextEl.dataset.originalText) {
        // Change "Choose Protein" to "Protein"
        const originalText = legendTextEl.dataset.originalText;
        const newHeaderText = originalText.replace('Choose ', '');
        textNode.textContent = newHeaderText;

        // Set the summary text with a leading space for clean formatting
        const productTitle = details.productTitle.replace(/ oz/gi, '').trim();
        summaryEl.textContent = ` ${productTitle}, ${details.displayLabel}`;
      }
    } else {
      // Restore original text and clear summary if selection is removed
      if (textNode && legendTextEl.dataset.originalText) {
        textNode.textContent = legendTextEl.dataset.originalText;
      }
      if (summaryEl) {
        summaryEl.textContent = '';
      }
    }
  }

  update({ emitMacros = true } = {}) {
    const qty = parseInt(this.quantityInput.value, 10);
    this.state.quantity = !isNaN(qty) && qty > 0 ? qty : 1;
    this.root.querySelector('[data-qty-text]').textContent = this.state.quantity;
    this.state.sellingPlanId = this.frequencySelect.value || null;
    this.calculatePrice();
    this.validate();
    if (emitMacros) this.emitMacroSelections();
  }

  calculatePrice() {
    const getPrice = (select) => {
      const option = select ? select.options[select.selectedIndex] : null;
      return option ? Number(option.dataset.price) || 0 : 0;
    };
    const baseFee = (this.proteinSelect.value && this.side1Select.value) ? parseInt(this.root.dataset.baseFeeCents, 10) : 0;
    const componentsPrice = getPrice(this.proteinSelect) + getPrice(this.side1Select) + getPrice(this.side2Select);
    const linePrice = componentsPrice + baseFee;
    const oldPrice = this.state.totalPrice;
    this.state.totalPrice = linePrice * this.state.quantity;

    if (oldPrice !== this.state.totalPrice) {
      const formattedPrice = this.formatMoney(this.state.totalPrice);
      this.priceDisplays.forEach(el => el.textContent = formattedPrice);
      this.priceWrappers.forEach(wrapper => {
        wrapper.classList.remove('is-updating');
        void wrapper.offsetWidth;
        wrapper.classList.add('is-updating');
      });
    }
  }
  
  validate() {
    const hasSelections = this.proteinSelect.value && this.side1Select.value;
    const canSubmit = hasSelections && !this.state.isLoading;
    this.addToCartButton.disabled = !canSubmit;
    this.addToCartText.textContent = this.state.isLoading ? 'Loading...' : (canSubmit ? 'Add to Cart' : 'Select Options');
  }

  processProductData(products, groupType = '') { return products.map(product => { this.productImageData.set(String(product.id), (product.images && product.images.length > 0) ? product.images[0].src : product.image?.src); const variants = (product.variants || []).map(variant => { const variantId = String(variant.id); const unitInfo = this.getVariantUnitInfo(product, variant, groupType); const priceInCents = this.toCents(variant.price); this.variantDetails.set(variantId, { productId: product.id, productTitle: product.title, variantId: variant.id, variantTitle: variant.title, displayLabel: unitInfo.fullLabel, amountLabel: unitInfo.amountLabel, unitLabel: unitInfo.displayUnit, unitKey: unitInfo.unitKey, numericQuantity: unitInfo.numericValue, price: priceInCents }); return { id: variantId, title: variant.title, price: priceInCents, displayLabel: unitInfo.fullLabel, amountLabel: unitInfo.amountLabel, unitLabel: unitInfo.displayUnit, unitKey: unitInfo.unitKey }; }); return { id: product.id, title: product.title, variants }; }).filter(p => p.variants.length > 0); }
  populateProductSelect(selectElement, products, type) { if (!selectElement) return; selectElement.innerHTML = `<option value="">Choose a ${type}...</option>`; products.forEach(product => { const option = document.createElement('option'); option.value = product.id; option.textContent = product.title.replace(/ oz/gi, '').trim(); selectElement.appendChild(option); }); selectElement.disabled = false; }
  populateHiddenVariantSelects() { const allSelects = [this.proteinSelect, this.side1Select, this.side2Select]; allSelects.forEach(select => { if(select) select.innerHTML = ''; }); this.variantDetails.forEach((details, variantId) => { const option = document.createElement('option'); option.value = variantId; option.dataset.price = details.price; if (this.productData.protein.some(p => p.variants.some(v => v.id === variantId)) && this.proteinSelect) { this.proteinSelect.appendChild(option.cloneNode(true)); } if (this.productData.side.some(p => p.variants.some(v => v.id === variantId))) { if (this.side1Select) this.side1Select.appendChild(option.cloneNode(true)); if (this.side2Select) this.side2Select.appendChild(option.cloneNode(true)); } }); }
  renderAllVisualOptions() { this.root.querySelectorAll('[data-product-select]').forEach(select => { const group = select.dataset.productSelect; const visualContainer = this.root.querySelector(`[data-visual-options-for="${group}"]`); if (!visualContainer) return; visualContainer.innerHTML = ''; Array.from(select.options).slice(1).forEach(option => { const productId = option.value; const productTitle = option.textContent; const imageUrl = this.productImageData.get(productId) || 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='; const card = document.createElement('button'); card.type = 'button'; card.className = 'cm-product-card-visual'; card.dataset.productId = productId; card.dataset.group = group; card.innerHTML = `<img src="${imageUrl}" alt="${productTitle}" class="cm-product-card-visual__image" width="72" height="72" loading="lazy"><span class="cm-product-card-visual__title">${productTitle}</span>`; visualContainer.appendChild(card); }); }); }
  bindVisualOptionEvents() { this.root.addEventListener('click', (event) => { const card = event.target.closest('.cm-product-card-visual'); if (!card) return; const { productId, group } = card.dataset; const originalSelect = this.root.querySelector(`[data-product-select="${group}"]`); if (originalSelect) { originalSelect.value = productId; originalSelect.dispatchEvent(new Event('change')); } }); }
  renderVariantOptions(selectionGroup, productId) { const step = this.root.querySelector(`[data-selection-group="${selectionGroup}"]`); if (!step) return; const container = step.querySelector('[data-variant-options-for]'); const hiddenSelect = this.root.querySelector(`[data-${selectionGroup}-select]`); if (!container || !hiddenSelect) return; container.innerHTML = ''; hiddenSelect.value = ''; if (!productId) { this.update(); return; } const type = selectionGroup.includes('side') ? 'side' : 'protein'; const product = this.productData[type].find(p => String(p.id) === String(productId)); if (product && product.variants) { product.variants.forEach(variant => { const button = document.createElement('button'); button.type = 'button'; button.className = 'variant-option-button'; const buttonText = [variant.amountLabel, variant.unitLabel].filter(Boolean).join('').trim(); button.textContent = buttonText || variant.title; button.dataset.variantId = variant.id; container.appendChild(button); }); } this.update(); }
  syncVisualSelection(group, selectedProductId) { const visualContainer = this.root.querySelector(`[data-visual-options-for="${group}"]`); if (!visualContainer) return; const step = visualContainer.closest('.cm-selection-step'); if (!step) return; step.dataset.productSelected = !!selectedProductId; visualContainer.querySelectorAll('.cm-product-card-visual').forEach(card => { card.classList.toggle('is-selected', card.dataset.productId === selectedProductId); }); const variantOptionsContainer = step.querySelector('[data-variant-options-for]'); if (variantOptionsContainer) { variantOptionsContainer.classList.toggle('is-visible', !!selectedProductId); } }
  getVariantUnitInfo(product, variant) { const variantTitle = (variant.title||'').trim(); const productTitle = (product.title||'').trim(); let override = null; const overrideKeys = Object.keys(CM_UNIT_OVERRIDES.byTitle).sort((a,b)=>b.length-a.length); for (const key of overrideKeys) { if (productTitle.toLowerCase().includes(key.toLowerCase())) { override = CM_UNIT_OVERRIDES.byTitle[key]; break; } } if (override) { const unitPattern = CM_UNIT_DEFINITIONS.find(def=>def.key===override.unit); if (!unitPattern) return {amountLabel:variantTitle,displayUnit:'',unitKey:'',fullLabel:variantTitle}; const amountLabel = variantTitle; let numericValue = this.parseQuantityString(amountLabel); if(override.fractionMap && override.fractionMap[amountLabel]) numericValue = override.fractionMap[amountLabel]; return {amountLabel:amountLabel,displayUnit:unitPattern.displaySingular,unitKey:unitPattern.key,fullLabel:`${amountLabel} ${unitPattern.displaySingular}`.trim(),numericValue:numericValue}; } const directMatch = this.matchUnitInText(variantTitle); if (directMatch && directMatch.pattern) { const {pattern,amountLabel} = directMatch; return {amountLabel:amountLabel||variantTitle,displayUnit:pattern.displaySingular,unitKey:pattern.key,fullLabel:`${amountLabel||variantTitle} ${pattern.displaySingular}`.trim(),numericValue:this.parseQuantityString(amountLabel||variantTitle)}; } const ozPattern = CM_UNIT_DEFINITIONS.find(def=>def.key==='OZ'); return {amountLabel:variantTitle,displayUnit:ozPattern.displaySingular,unitKey:ozPattern.key,fullLabel:`${variantTitle} ${ozPattern.displaySingular}`.trim(),numericValue:this.parseQuantityString(variantTitle)}; }
  matchUnitInText(text) { if (!text || typeof text !== 'string') return null; const cleanedText = text.replace(/\(s\)/gi,'s').toLowerCase(); for (const definition of CM_UNIT_DEFINITIONS) { for (const keyword of definition.keywords) { if (cleanedText.endsWith(keyword)) { const amountPart = cleanedText.substring(0, cleanedText.length - keyword.length).trim(); if (amountPart && !isNaN(this.parseQuantityString(amountPart))) { return {pattern:definition,amountLabel:amountPart}; } } } } return null; }
  parseQuantityString(value) { if (value == null) return null; const stringValue = String(value).trim(); if (!stringValue) return null; const replacedFractions = stringValue.split('').map(char => CM_UNICODE_FRACTIONS[char] !== undefined ? ` ${CM_UNICODE_FRACTIONS[char]} ` : char).join(''); const normalized = replacedFractions.replace(/-/g,' ').replace(/[^0-9./\s]/g,' ').replace(/\s+/g,' ').trim(); if (!normalized) return null; let total = 0; let hasValue = false; normalized.split(' ').forEach(part => { if (!part) return; hasValue = true; if (part.includes('/')) { const [num,den] = part.split('/').map(Number); if (!isNaN(num) && !isNaN(den) && den !== 0) total += num / den; } else { const num = Number(part); if (!isNaN(num)) total += num; } }); return hasValue ? total : null; }
  waitForRechargeBundle(timeout = 10000, interval = 50) { return new Promise((resolve, reject) => { const start = Date.now(); const check = () => { if (window.recharge && window.recharge.bundle) resolve(); else if (Date.now() - start >= timeout) reject(new Error('recharge.bundle timeout')); else setTimeout(check, interval); }; check(); }); }
  async fetchCollectionProductsByHandle(handle) { if (!handle) throw new Error('Collection handle is missing.'); const response = await fetch(`/collections/${handle}/products.json?limit=250`); if (!response.ok) throw new Error(`Failed to load collection: /collections/${handle}/products.json`); const data = await response.json(); return data.products || []; }
  populateFrequencies() { if (!this.frequencySelect) return; this.frequencySelect.innerHTML = '<option value="">One-time purchase</option>'; (this.sellingPlanGroups||[]).forEach(group => { (group.selling_plans || []).forEach(plan => { const option = document.createElement('option'); option.value = plan.id; option.textContent = plan.name; this.frequencySelect.appendChild(option); }); }); this.frequencySelect.disabled = false; }
  
  getVariantLabelByValue(variantId) { if (!variantId) return ''; const details = this.variantDetails.get(String(variantId)); if (!details) return ''; const productTitle = (details.productTitle || '').trim(); const variantTitle = (details.variantTitle || '').trim(); const variantDisplayLabel = (details.displayLabel || '').trim(); const normalizedVariantTitle = variantDisplayLabel || (variantTitle && variantTitle.toLowerCase() !== 'default title' ? variantTitle : ''); if (!productTitle && !normalizedVariantTitle) return ''; if (!productTitle) return normalizedVariantTitle; if (!normalizedVariantTitle) return productTitle; if (normalizedVariantTitle.toLowerCase().includes(productTitle.toLowerCase())) { return normalizedVariantTitle; } return `${productTitle} - ${normalizedVariantTitle}`; }
  emitMacroSelections() { if (!window.iconMacroV2 || typeof window.iconMacroV2.update !== 'function') return; const payload = { protein: this.proteinProductSelect.value ? this.getVariantLabelByValue(this.proteinSelect?.value) : '', side1: this.side1ProductSelect.value ? this.getVariantLabelByValue(this.side1Select?.value) : '', side2: this.side2ProductSelect.value ? this.getVariantLabelByValue(this.side2Select?.value) : '' }; window.iconMacroV2.update(payload); }
  
  // --- START: RESTORED CART & HELPER FUNCTIONS ---
  getSelectionDetails(selectElement) { const variantId = selectElement.value; if (!variantId && selectElement !== this.side2Select) { throw new Error('A required selection is missing.'); } if (!variantId) return null; const details = this.variantDetails.get(variantId); if (!details) throw new Error(`Missing variant metadata for ${variantId}.`); return details; }
  normalizeIngredientName(name) { if (!name) return ''; let normalized = String(name); normalized = normalized.replace(/\(([^)]+)\)/g, (match, inner) => { const innerLower = inner.toLowerCase(); const hasUnitKeyword = CM_UNIT_DEFINITIONS.some(def => def.keywords.some(keyword => innerLower.includes(keyword))); return hasUnitKeyword ? '' : match; }); normalized = normalized.replace(/(?:\s*\d[\d./\s-]*)?\s*(oz|ounce|ounces|cup|cups|ea|each|slice|slices|sl)\s*$/i, ''); return normalized.replace(/\s{2,}/g, ' ').trim(); }
  buildQuantityKey(name, unitKey) { if (!name || !unitKey) return ''; let base = String(name).toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s{2,}/g, ' ').trim(); if (base === 'CHICKEN BREAST') base = 'CHICKEN'; if (!base) return ''; return `${base} ${unitKey}`.trim(); }
  buildParentLineProperties(commonProps = {}) { const properties = { ...commonProps }; const macroProps = {}; const quantityKeyUsage = new Map(); const selections = [ { id: 'protein', select: this.proteinSelect }, { id: 'side_1', select: this.side1Select }, { id: 'side_2', select: this.side2Select } ]; selections.forEach(({ id, select }) => { if (!select) return; const variantId = select.value; if (!variantId) return; const details = this.variantDetails.get(String(variantId)); if (!details) return; const ingredientName = this.normalizeIngredientName(details.productTitle); const amountLabel = (details.amountLabel || '').trim(); const unitKey = (details.unitKey || '').trim(); const unitInfo = CM_UNIT_DEFINITIONS.find(u => u.key === unitKey); const displayUnit = unitInfo ? unitInfo.displaySingular : ''; const key_prefix = `_rc_cm_${id}`; if (ingredientName) { properties[`${key_prefix}_name`] = ingredientName; } if (amountLabel) { properties[`${key_prefix}_qty`] = amountLabel; } if (displayUnit) { properties[`${key_prefix}_unit`] = displayUnit; } properties[`${key_prefix}_display`] = `${amountLabel}${displayUnit} ${ingredientName}`; if (ingredientName && amountLabel && unitKey) { const baseKey = this.buildQuantityKey(ingredientName, unitKey); if (baseKey) { const usageCount = quantityKeyUsage.get(baseKey) || 0; const finalKey = usageCount === 0 ? baseKey : `${baseKey} ${usageCount + 1}`; quantityKeyUsage.set(baseKey, usageCount + 1); macroProps[finalKey] = amountLabel; } } }); return { ...properties, ...macroProps }; }
  
  async addItemsToCart(payload, qty) { const allItems = Array.from({ length: qty }, () => payload.items).flat(); const response = await fetch('/cart/add.js', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: allItems }) }); if (!response.ok) { let msg = 'Failed to add items to cart.'; try { const ct = response.headers.get('content-type') || ''; if (ct.includes('application/json')) { const j = await response.json(); msg = j?.description || j?.message || msg; } else { const t = await response.text(); const m = t.match(/(?:<p[^>]*>|^)([^<]{8,200})(?:<\/p>|$)/i); msg = m ? m[1].trim() : t.slice(0, 200); } } catch {} throw new Error(msg); } document.dispatchEvent(new CustomEvent('cart:updated')); }

  async handleAddToCart(event) {
    event.preventDefault();
    if (this.addToCartButton.disabled) return;
    this.showError('', false);
    this.addToCartButton.disabled = true;
    this.addToCartText.textContent = 'Adding...';

    try {
      const childVariants = [
        this.getSelectionDetails(this.proteinSelect),
        this.getSelectionDetails(this.side1Select),
        this.getSelectionDetails(this.side2Select)
      ].filter(Boolean).map(v => ({ id: v.variantId, quantity: 1 }));

      if (childVariants.length < 2) {
        throw new Error('Please select a protein and at least one side.');
      }

      const parentHandle = this.root.dataset.productHandle;
      const parentVariantId = this.root.dataset.bundleVariantId;
      const planId = this.state.sellingPlanId;

      const bundleId = crypto.randomUUID();
      const commonProps = {
        _rc_bundle: bundleId,
        _rc_bundle_parent: parentHandle,
        _rc_bundle_variant: String(parentVariantId)
      };

      const parentLine = {
        id: parentVariantId,
        quantity: 1,
        properties: this.buildParentLineProperties(commonProps)
      };

      if (planId) parentLine.selling_plan = planId;
      const childLines = childVariants.map(({ id, quantity }) => ({ id, quantity, properties: { ...commonProps } }));
      const payload = { items: [parentLine, ...childLines] };
      await this.addItemsToCart(payload, this.state.quantity);

      this.addToCartText.textContent = 'Added!';
      setTimeout(() => { this.addToCartButton.disabled = false; this.validate(); }, 2000);
    } catch (error) {
      this.addToCartButton.disabled = false;
      this.showError(error.message || 'Error adding to cart.', false);
      this.validate();
    }
  }
  // --- END: RESTORED CART & HELPER FUNCTIONS ---

  showError(message, disable = false) { const errorEl = this.root.querySelector('[data-error-message]'); if (errorEl) errorEl.textContent = message; if (disable) this.form.querySelectorAll('select, button, input').forEach(el => el.disabled = true); }
  formatMoney(cents) { return `$${(cents / 100).toFixed(2)}`; }
  toCents(value) { return Math.round(parseFloat(value) * 100) || 0; }
  parseNumericId(val, label) { const id = Number(val); if (!Number.isFinite(id) || id <= 0) throw new Error(`${label} is invalid.`); return id; }
}

document.querySelectorAll('.cm-recharge').forEach(el => new CustomMealBuilder(el));
document.addEventListener('shopify:section:load', (event) => {
  event.target.querySelectorAll('.cm-recharge').forEach(el => new CustomMealBuilder(el));
});
