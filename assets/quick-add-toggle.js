(function(){
  'use strict';
  function init(wrapper){
    var toggle=wrapper.querySelector('.quick-add-toggle');
    if(!toggle) return;
    var controls=wrapper.querySelector('.quick-add-controls');
    var qtyVal=wrapper.querySelector('.qty-value');
    var qtyInput=wrapper.querySelector('.quick-add-qty');
    wrapper.addEventListener('click', function(e){
      if(e.target.closest('.quick-add-toggle')){
        toggle.classList.add('d-none');
        controls.classList.remove('d-none');
      }
      if(e.target.closest('.qty-btn.plus')){
        var v=parseInt(qtyVal.textContent,10)+1;
        qtyVal.textContent=v;
        qtyInput.value=v;
      }
      if(e.target.closest('.qty-btn.minus')){
        var v=parseInt(qtyVal.textContent,10);
        if(v>1){v--; qtyVal.textContent=v; qtyInput.value=v;}
      }
    });
  }
  document.addEventListener('DOMContentLoaded', function(){
    document.querySelectorAll('.quick-add-wrapper').forEach(init);
  });
})();
