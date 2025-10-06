(function() {
  if (window.__appViewportInitialized) return;
  window.__appViewportInitialized = true;

  const root = document.documentElement;
  const setViewportHeight = () => {
    const viewport = window.visualViewport;
    const rawHeight = viewport ? viewport.height : window.innerHeight;
    if (!rawHeight) return;
    const height = Math.max(0, Math.round(rawHeight * 100) / 100);
    root.style.setProperty('--app-viewport-height', `${height}px`);
  };

  const requestSet = () => window.requestAnimationFrame(setViewportHeight);

  const attach = (target, event) => {
    if (!target || !target.addEventListener) return;
    target.addEventListener(event, requestSet, { passive: true });
  };

  attach(window, 'resize');
  attach(window, 'orientationchange');

  if (window.visualViewport) {
    attach(window.visualViewport, 'resize');
    attach(window.visualViewport, 'scroll');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setViewportHeight, { once: true });
  } else {
    setViewportHeight();
  }
})();
