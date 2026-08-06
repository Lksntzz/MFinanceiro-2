const STYLE_ID = 'mf-current-navigation-only-style';

function installHardNavigationGuard() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    /* The Dashboard still keeps its original buttons as an internal navigation bridge.
       They must never be visible to the user now that the simplified navigation is active. */
    .mf-nav > button {
      display: none !important;
      visibility: hidden !important;
      pointer-events: none !important;
    }
    .mf-nav > #mf-hierarchy-nav-host {
      display: block !important;
      visibility: visible !important;
      width: 100% !important;
      min-width: 0 !important;
    }
    #mf-hierarchy-nav-host #mf-simple-navigation-app,
    #mf-hierarchy-nav-host #mf-simple-navigation-root {
      display: block !important;
      visibility: visible !important;
      width: 100% !important;
      min-width: 0 !important;
    }
  `;
  document.head.appendChild(style);
}

function ensureHierarchyHost(): HTMLElement | null {
  const nav = document.querySelector<HTMLElement>('.mf-nav');
  if (!nav) return null;

  let hierarchyHost = nav.querySelector<HTMLElement>('#mf-hierarchy-nav-host');
  if (!hierarchyHost) {
    hierarchyHost = document.createElement('div');
    hierarchyHost.id = 'mf-hierarchy-nav-host';
    nav.appendChild(hierarchyHost);
  }

  // Keep the old Dashboard buttons only as an invisible programmatic bridge.
  Array.from(nav.children).forEach((child) => {
    if (!(child instanceof HTMLButtonElement)) return;
    child.dataset.mfLegacyNavigationBridge = 'true';
    child.setAttribute('aria-hidden', 'true');
    child.tabIndex = -1;
    child.style.setProperty('display', 'none', 'important');
    child.style.setProperty('visibility', 'hidden', 'important');
    child.style.setProperty('pointer-events', 'none', 'important');
  });

  return hierarchyHost;
}

function placeSimpleNavigation() {
  installHardNavigationGuard();
  const navigation = document.getElementById('mf-simple-navigation-app');
  const hierarchyHost = ensureHierarchyHost();
  if (!navigation || !hierarchyHost) return;

  if (navigation.parentElement !== hierarchyHost) hierarchyHost.appendChild(navigation);
  navigation.style.width = '100%';
  navigation.style.minWidth = '0';
}

placeSimpleNavigation();
const observer = new MutationObserver(placeSimpleNavigation);
observer.observe(document.body, { subtree: true, childList: true });
const timer = window.setInterval(placeSimpleNavigation, 250);

window.addEventListener('beforeunload', () => {
  observer.disconnect();
  window.clearInterval(timer);
}, { once: true });

export {};
