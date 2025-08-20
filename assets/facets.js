/*
  LEAD DEVELOPER NOTE V5.0:
  The content of this file has been commented out as it corresponds to the old
  faceted filtering system, which has been replaced by a simpler navigation bar
  in `sections/template--collection.liquid`. This script is no longer needed.
*/

/*
class FacetFiltersForm extends HTMLElement {
  constructor() {
    super();
    this.form = this.querySelector('form');
    this.debouncedOnSubmit = this.debounce((event) => {
      this.onSubmitHandler(event);
    }, 500);

    this.form.addEventListener('input', this.debouncedOnSubmit);
    this.bindEvents();
  }

  static setListeners() {
    window.addEventListener('popstate', (event) => {
      const searchParams = event.state?.searchParams || '';
      this.renderPage(searchParams, false);
    });
  }

  static renderPage(searchParams, updateURLHash = true) {
    const sections = this.getSections();
    if (!sections) return;
    
    document.getElementById('ProductGridContainer')?.classList.add('loading');

    const url = `${window.location.pathname}?section_id=${sections[0].id}&${searchParams}`;
    
    this.renderSectionFromFetch(url);

    if (updateURLHash) this.updateURLHash(searchParams);
  }

  static renderSectionFromFetch(url) {
    fetch(url)
      .then(response => response.text())
      .then((responseText) => {
        const html = new DOMParser().parseFromString(responseText, 'text/html');
        this.renderProductGrid(html);
        this.renderFilters(html);
      });
  }

  static renderProductGrid(html) {
    const productGrid = document.getElementById('ProductGridContainer');
    if (productGrid) {
      productGrid.innerHTML = html.getElementById('ProductGridContainer').innerHTML;
    }
  }

  static renderFilters(html) {
    const facetContainer = document.querySelector('facet-filters-form');
    if (facetContainer) {
      facetContainer.innerHTML = html.querySelector('facet-filters-form').innerHTML;
    }
  }

  static updateURLHash(searchParams) {
    history.pushState({ searchParams }, '', `${window.location.pathname}${searchParams ? '?' + searchParams : ''}`);
  }

  static getSections() {
    const mainCollectionSection = document.querySelector('[data-id^="template--"]');
    if (!mainCollectionSection) return null;
    return [{
      id: mainCollectionSection.dataset.id,
    }];
  }

  onSubmitHandler(event) {
    event.preventDefault();
    const formData = new FormData(this.form);
    const searchParams = new URLSearchParams(formData).toString();
    FacetFiltersForm.renderPage(searchParams);
  }

  bindEvents() {
    this.openBtn = this.querySelector('.facets__open-btn');
    this.container = this.querySelector('.facets__container');
    this.closeBtn = this.querySelector('.facets__close-btn');
    this.applyBtn = this.querySelector('.facets__apply-btn');

    this.openBtn?.addEventListener('click', () => this.toggleDrawer(true));
    this.closeBtn?.addEventListener('click', () => this.toggleDrawer(false));
    this.applyBtn?.addEventListener('click', () => this.toggleDrawer(false));
    
    // Close drawer when clicking outside of it on mobile
    this.addEventListener('click', (event) => {
      if (event.target === this.container?.parentElement) this.toggleDrawer(false);
    });
    
    this.bindActiveFacetButtonEvents();
  }

  toggleDrawer(open) {
    const method = open ? 'add' : 'remove';
    this.container.classList[method]('is-open');
    document.body.classList[method]('overflow-hidden-mobile');
    
    if (this.container.parentElement.tagName === "DETAILS") {
      this.container.parentElement.open = open;
    }
  }

  bindActiveFacetButtonEvents() {
    this.querySelectorAll('.js-facet-remove').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        FacetFiltersForm.renderPage(new URL(event.currentTarget.href).searchParams.toString());
      });
    });
  }

  debounce(fn, wait) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }
}

if (!customElements.get('facet-filters-form')) {
  customElements.define('facet-filters-form', FacetFiltersForm);
  FacetFiltersForm.setListeners();
}
*/
