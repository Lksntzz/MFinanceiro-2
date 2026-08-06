function placeSimpleNavigation() {
  const navigation = document.getElementById('mf-simple-navigation-app');
  const hierarchyHost = document.getElementById('mf-hierarchy-nav-host');
  if (!navigation || !hierarchyHost) return;
  if (navigation.parentElement !== hierarchyHost) hierarchyHost.appendChild(navigation);
  navigation.style.width = '100%';
  navigation.style.minWidth = '0';
}

placeSimpleNavigation();
const observer = new MutationObserver(placeSimpleNavigation);
observer.observe(document.body, { subtree: true, childList: true });
const timer = window.setInterval(placeSimpleNavigation, 400);

window.addEventListener('beforeunload', () => {
  observer.disconnect();
  window.clearInterval(timer);
}, { once: true });

export {};
