const ROOT_ID = 'mf-income-extra-actions';

const normalize = (value: string | null | undefined) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

function isVisible(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
}

function openLauncher(category: 'Renda extra' | 'Benefícios', benefitMethod: boolean) {
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.textContent = 'Lançar';
  trigger.style.display = 'none';
  document.body.appendChild(trigger);
  trigger.click();
  trigger.remove();

  const configure = (attempt = 0) => {
    const root = document.getElementById('mf-unified-transaction-root');
    if (!root || attempt > 20) return;

    const incomeButton = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      isVisible(button) && normalize(button.textContent) === 'entrada',
    );
    incomeButton?.click();

    window.setTimeout(() => {
      const select = Array.from(root.querySelectorAll<HTMLSelectElement>('select')).find((candidate) =>
        Array.from(candidate.options).some((option) => option.value === category || option.textContent?.trim() === category),
      );
      if (select) {
        const option = Array.from(select.options).find((item) => item.value === category || item.textContent?.trim() === category);
        if (option) {
          const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
          setter?.call(select, option.value);
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }

      if (benefitMethod) {
        const benefitButton = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
          isVisible(button) && normalize(button.textContent) === 'beneficio',
        );
        benefitButton?.click();
      }
    }, 60);
  };

  const waitForLauncher = (attempt = 0) => {
    if (document.getElementById('mf-unified-transaction-root')) configure(attempt);
    else if (attempt < 20) window.setTimeout(() => waitForLauncher(attempt + 1), 50);
  };
  waitForLauncher();
}

function patchIncomeActions() {
  if (document.getElementById(ROOT_ID)) return;
  const heading = Array.from(document.querySelectorAll<HTMLElement>('h2')).find((item) =>
    normalize(item.textContent).includes('renda e folha') && isVisible(item),
  );
  const header = heading?.closest('header');
  const actions = header?.querySelector<HTMLElement>('div.flex.flex-wrap.items-center.gap-2');
  if (!actions) return;

  const wrapper = document.createElement('div');
  wrapper.id = ROOT_ID;
  wrapper.className = 'flex flex-wrap items-center gap-2';

  const extraButton = document.createElement('button');
  extraButton.type = 'button';
  extraButton.className = 'rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold transition hover:border-brand-primary/40 hover:text-brand-primary';
  extraButton.textContent = '+ Renda extra';
  extraButton.addEventListener('click', () => openLauncher('Renda extra', false));

  const benefitButton = document.createElement('button');
  benefitButton.type = 'button';
  benefitButton.className = extraButton.className;
  benefitButton.textContent = '+ Benefício';
  benefitButton.addEventListener('click', () => openLauncher('Benefícios', true));

  wrapper.append(extraButton, benefitButton);
  actions.prepend(wrapper);
}

function install() {
  patchIncomeActions();
  const observer = new MutationObserver(patchIncomeActions);
  observer.observe(document.body, { subtree: true, childList: true });
  window.addEventListener('beforeunload', () => observer.disconnect(), { once: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
else install();

export {};
