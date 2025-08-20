  var menuDataEl = document.querySelector('#mobile-menu-data');
  this.menuStructure = menuDataEl ? JSON.parse(menuDataEl.textContent) : {};
  var menuDataTopbarEl = document.querySelector('#mobile-menu-data-topbar');
  this.menuStructureTopbar = menuDataTopbarEl ? JSON.parse(menuDataTopbarEl.textContent) : {};
