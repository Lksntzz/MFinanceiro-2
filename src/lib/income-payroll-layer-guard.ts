function normalizeLabel(value: string | null | undefined): string {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function isIncomePayrollActive(): boolean {
  const activeButton = Array.from(document.querySelectorAll<HTMLButtonElement>('.mf-nav button'))
    .find((button) => button.classList.contains('active'));
  const label = normalizeLabel(activeButton?.textContent);
  return label.includes('renda e folha') || label.includes('preferências');
}

function findLegacyIncomePanel(): HTMLElement | null {
  const legacyTab = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
    .find((button) => normalizeLabel(button.textContent) === 'renda e ciclo');
  if (!legacyTab) return null;

  let current: HTMLElement | null = legacyTab.parentElement;
  while (current && current !== document.body) {
    const text = normalizeLabel(current.textContent);
    if (text.includes('renda e ciclo') && text.includes('ajustes') && text.includes('resumo salarial estimado')) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

function setLegacyPanelVisibility(active: boolean) {
  const legacyPanel = findLegacyIncomePanel();
  if (!legacyPanel) return;

  if (active) {
    if (legacyPanel.dataset.mfOriginalDisplay === undefined) {
      legacyPanel.dataset.mfOriginalDisplay = legacyPanel.style.display || '';
    }
    legacyPanel.style.display = 'none';
    legacyPanel.setAttribute('aria-hidden', 'true');
  } else if (legacyPanel.dataset.mfOriginalDisplay !== undefined) {
    legacyPanel.style.display = legacyPanel.dataset.mfOriginalDisplay;
    legacyPanel.removeAttribute('aria-hidden');
    delete legacyPanel.dataset.mfOriginalDisplay;
  }
}

function alignIncomePayrollPage(active: boolean) {
  const page = document.querySelector<HTMLElement>('#mf-income-payroll-center-root > div');
  if (!page) return;

  if (!active) {
    page.style.removeProperty('left');
    page.style.removeProperty('right');
    page.style.removeProperty('top');
    page.style.removeProperty('bottom');
    page.style.removeProperty('border-radius');
    return;
  }

  const content = document.querySelector<HTMLElement>('.mf-content');
  if (!content) return;

  const rect = content.getBoundingClientRect();
  page.style.left = `${Math.max(0, Math.round(rect.left))}px`;
  page.style.right = `${Math.max(0, Math.round(window.innerWidth - rect.right))}px`;
  page.style.top = `${Math.max(0, Math.round(rect.top))}px`;
  page.style.bottom = '0px';
  page.style.borderRadius = '0';
}

function syncIncomePayrollLayer() {
  const active = isIncomePayrollActive();
  setLegacyPanelVisibility(active);
  alignIncomePayrollPage(active);
}

function installIncomePayrollLayerGuard() {
  syncIncomePayrollLayer();

  const observer = new MutationObserver(syncIncomePayrollLayer);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'style'],
  });

  window.addEventListener('resize', syncIncomePayrollLayer);
  window.setInterval(syncIncomePayrollLayer, 500);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installIncomePayrollLayerGuard, { once: true });
} else {
  installIncomePayrollLayerGuard();
}

export {};
