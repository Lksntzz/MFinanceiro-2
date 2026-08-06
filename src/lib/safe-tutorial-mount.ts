import { supabase } from './supabase';

type TutorialStep = {
  eyebrow: string;
  title: string;
  description: string;
  content: string;
};

const TUTORIAL_ROOT_ID = 'mf-safe-tutorial-root';
const STYLE_ID = 'mf-safe-tutorial-style';

const normalize = (value: string | null | undefined) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const steps: TutorialStep[] = [
  {
    eyebrow: 'Etapa 1 de 3',
    title: 'Bem-vindo ao MF Financeiro',
    description: 'Organize sua vida financeira sem precisar entender termos técnicos.',
    content: `
      <div class="mf-safe-welcome-icon" aria-hidden="true">MF</div>
      <p class="mf-safe-centered-copy">
        A tela inicial reúne seu saldo, os gastos do dia, o ciclo atual, alertas e os lançamentos mais recentes.
        Quanto mais registros você incluir, mais completas ficam as projeções.
      </p>
    `,
  },
  {
    eyebrow: 'Etapa 2 de 3',
    title: 'Onde encontrar cada ferramenta',
    description: 'O menu principal foi dividido por ações fáceis de reconhecer.',
    content: `
      <div class="mf-safe-area-grid">
        <article><b>Início</b><span>Resumo do saldo, gastos, ciclo e alertas.</span></article>
        <article><b>Movimentações</b><span>Entradas, saídas e importação de extratos.</span></article>
        <article><b>Contas</b><span>Contas fixas, assinaturas e orçamentos.</span></article>
        <article><b>Cartões</b><span>Limites, faturas e compras parceladas.</span></article>
        <article><b>Renda</b><span>Holerites, proventos, descontos e ciclo salarial.</span></article>
        <article><b>Análises</b><span>Resumo, Insights, saúde, metas e investimentos.</span></article>
      </div>
    `,
  },
  {
    eyebrow: 'Etapa 3 de 3',
    title: 'O que registrar primeiro',
    description: 'Estes registros deixam a tela inicial e os Insights mais confiáveis.',
    content: `
      <div class="mf-safe-checklist">
        <div><i>1</i><span><b>Confirme seu perfil e saldo</b><small>Nome, foto e valor disponível hoje.</small></span></div>
        <div><i>2</i><span><b>Cadastre sua renda</b><small>Informe o salário ou importe um holerite.</small></span></div>
        <div><i>3</i><span><b>Inclua contas e cartões</b><small>O aplicativo organiza vencimentos e prioridades.</small></span></div>
        <div><i>4</i><span><b>Registre uma movimentação</b><small>Use o botão Lançar ou importe um extrato.</small></span></div>
      </div>
      <div class="mf-safe-tip">Você pode reabrir este tutorial pelo botão do perfil.</div>
    `,
  },
];

let currentStep = 0;
let legacyHandling = false;

function installStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${TUTORIAL_ROOT_ID} {
      position: fixed;
      inset: 0;
      z-index: 2147483000;
      display: grid;
      place-items: center;
      padding: 16px;
      background: rgba(0, 0, 0, .76);
      backdrop-filter: blur(8px);
      color: #fff;
      font-family: inherit;
    }
    #${TUTORIAL_ROOT_ID} * { box-sizing: border-box; }
    #${TUTORIAL_ROOT_ID} .mf-safe-panel {
      position: relative;
      display: flex;
      flex-direction: column;
      width: min(650px, 100%);
      max-height: min(760px, calc(100vh - 24px));
      overflow: hidden;
      border: 1px solid rgba(255,255,255,.14);
      border-radius: 24px;
      background: #0b0b0d;
      box-shadow: 0 30px 100px rgba(0,0,0,.78);
      isolation: isolate;
    }
    #${TUTORIAL_ROOT_ID} .mf-safe-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      padding: 20px 20px 16px;
      border-bottom: 1px solid rgba(255,255,255,.08);
    }
    #${TUTORIAL_ROOT_ID} .mf-safe-eyebrow {
      display: block;
      margin-bottom: 5px;
      color: #00f2ff;
      font-size: 10px;
      font-weight: 900;
      letter-spacing: .12em;
      text-transform: uppercase;
    }
    #${TUTORIAL_ROOT_ID} h2 { margin: 0; font-size: clamp(19px, 3vw, 25px); line-height: 1.15; }
    #${TUTORIAL_ROOT_ID} .mf-safe-description { margin: 7px 0 0; color: rgba(255,255,255,.52); font-size: 12px; line-height: 1.55; }
    #${TUTORIAL_ROOT_ID} .mf-safe-close {
      flex: 0 0 auto;
      display: grid;
      place-items: center;
      width: 38px;
      height: 38px;
      border: 1px solid rgba(255,255,255,.12);
      border-radius: 12px;
      background: rgba(255,255,255,.05);
      color: #fff;
      cursor: pointer;
      font-size: 22px;
      line-height: 1;
    }
    #${TUTORIAL_ROOT_ID} .mf-safe-body { overflow-y: auto; padding: 22px 20px; min-height: 250px; }
    #${TUTORIAL_ROOT_ID} .mf-safe-welcome-icon {
      display: grid;
      place-items: center;
      width: 78px;
      height: 78px;
      margin: 6px auto 18px;
      border: 1px solid rgba(0,242,255,.25);
      border-radius: 25px;
      background: rgba(0,242,255,.10);
      color: #00f2ff;
      font-size: 25px;
      font-weight: 950;
      box-shadow: 0 0 35px rgba(0,242,255,.08);
    }
    #${TUTORIAL_ROOT_ID} .mf-safe-centered-copy { max-width: 510px; margin: 0 auto; text-align: center; color: rgba(255,255,255,.64); font-size: 13px; line-height: 1.7; }
    #${TUTORIAL_ROOT_ID} .mf-safe-area-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    #${TUTORIAL_ROOT_ID} .mf-safe-area-grid article {
      display: grid;
      gap: 6px;
      min-height: 82px;
      padding: 14px;
      border: 1px solid rgba(255,255,255,.09);
      border-radius: 15px;
      background: rgba(255,255,255,.035);
    }
    #${TUTORIAL_ROOT_ID} .mf-safe-area-grid b { font-size: 13px; }
    #${TUTORIAL_ROOT_ID} .mf-safe-area-grid span { color: rgba(255,255,255,.48); font-size: 11px; line-height: 1.45; }
    #${TUTORIAL_ROOT_ID} .mf-safe-checklist { display: grid; gap: 9px; }
    #${TUTORIAL_ROOT_ID} .mf-safe-checklist > div { display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px solid rgba(255,255,255,.09); border-radius: 14px; background: rgba(255,255,255,.03); }
    #${TUTORIAL_ROOT_ID} .mf-safe-checklist i { display: grid; place-items: center; flex: 0 0 auto; width: 28px; height: 28px; border-radius: 999px; background: rgba(0,242,255,.12); color: #00f2ff; font-size: 11px; font-style: normal; font-weight: 900; }
    #${TUTORIAL_ROOT_ID} .mf-safe-checklist span { display: grid; gap: 3px; }
    #${TUTORIAL_ROOT_ID} .mf-safe-checklist b { font-size: 12px; }
    #${TUTORIAL_ROOT_ID} .mf-safe-checklist small { color: rgba(255,255,255,.45); font-size: 10px; line-height: 1.4; }
    #${TUTORIAL_ROOT_ID} .mf-safe-tip { margin-top: 13px; padding: 11px 12px; border: 1px solid rgba(0,242,255,.18); border-radius: 13px; background: rgba(0,242,255,.07); color: rgba(255,255,255,.58); font-size: 10px; }
    #${TUTORIAL_ROOT_ID} .mf-safe-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 15px 20px 20px; border-top: 1px solid rgba(255,255,255,.08); }
    #${TUTORIAL_ROOT_ID} .mf-safe-dots { display: flex; gap: 6px; }
    #${TUTORIAL_ROOT_ID} .mf-safe-dot { width: 7px; height: 7px; border-radius: 999px; background: rgba(255,255,255,.18); }
    #${TUTORIAL_ROOT_ID} .mf-safe-dot.active { width: 21px; background: #00f2ff; }
    #${TUTORIAL_ROOT_ID} .mf-safe-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
    #${TUTORIAL_ROOT_ID} button { font-family: inherit; }
    #${TUTORIAL_ROOT_ID} .mf-safe-secondary, #${TUTORIAL_ROOT_ID} .mf-safe-primary {
      border-radius: 12px;
      padding: 10px 14px;
      cursor: pointer;
      font-size: 11px;
      font-weight: 900;
    }
    #${TUTORIAL_ROOT_ID} .mf-safe-secondary { border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.04); color: #fff; }
    #${TUTORIAL_ROOT_ID} .mf-safe-primary { border: 1px solid #00f2ff; background: #00f2ff; color: #050505; }
    @media (max-width: 620px) {
      #${TUTORIAL_ROOT_ID} { padding: 8px; align-items: end; }
      #${TUTORIAL_ROOT_ID} .mf-safe-panel { max-height: calc(100vh - 8px); border-radius: 22px 22px 10px 10px; }
      #${TUTORIAL_ROOT_ID} .mf-safe-header { padding: 17px 16px 14px; }
      #${TUTORIAL_ROOT_ID} .mf-safe-body { padding: 18px 16px; }
      #${TUTORIAL_ROOT_ID} .mf-safe-footer { align-items: flex-end; padding: 13px 16px 16px; }
      #${TUTORIAL_ROOT_ID} .mf-safe-area-grid { grid-template-columns: 1fr; }
      #${TUTORIAL_ROOT_ID} .mf-safe-actions { gap: 6px; }
      #${TUTORIAL_ROOT_ID} .mf-safe-secondary, #${TUTORIAL_ROOT_ID} .mf-safe-primary { padding: 9px 11px; }
    }
  `;
  document.head.appendChild(style);
}

async function markSeen() {
  try {
    const { data } = await supabase.auth.getUser();
    const userId = data.user?.id;
    if (!userId) return;
    await supabase
      .from('mf_user_settings')
      .update({ onboarding_seen: true })
      .eq('user_id', userId);
  } catch {
    // The tutorial must always remain closable, even if persistence fails.
  }
}

function closeTutorial(markAsSeen = true) {
  document.getElementById(TUTORIAL_ROOT_ID)?.remove();
  document.removeEventListener('keydown', handleKeydown);
  if (markAsSeen) void markSeen();
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeTutorial(true);
}

function renderStep() {
  const root = document.getElementById(TUTORIAL_ROOT_ID);
  if (!root) return;
  const step = steps[currentStep] || steps[0];

  root.innerHTML = `
    <section class="mf-safe-panel" role="dialog" aria-modal="true" aria-labelledby="mf-safe-tutorial-title">
      <header class="mf-safe-header">
        <div>
          <span class="mf-safe-eyebrow">${step.eyebrow}</span>
          <h2 id="mf-safe-tutorial-title">${step.title}</h2>
          <p class="mf-safe-description">${step.description}</p>
        </div>
        <button type="button" class="mf-safe-close" data-action="close" aria-label="Fechar tutorial">×</button>
      </header>
      <div class="mf-safe-body">${step.content}</div>
      <footer class="mf-safe-footer">
        <div class="mf-safe-dots" aria-label="Progresso do tutorial">
          ${steps.map((_, index) => `<span class="mf-safe-dot ${index === currentStep ? 'active' : ''}"></span>`).join('')}
        </div>
        <div class="mf-safe-actions">
          <button type="button" class="mf-safe-secondary" data-action="skip">Agora não</button>
          ${currentStep > 0 ? '<button type="button" class="mf-safe-secondary" data-action="back">Voltar</button>' : ''}
          <button type="button" class="mf-safe-primary" data-action="next">${currentStep === steps.length - 1 ? 'Ir para o Início' : 'Continuar'}</button>
        </div>
      </footer>
    </section>
  `;

  root.querySelector<HTMLElement>('[data-action="close"]')?.addEventListener('click', () => closeTutorial(true));
  root.querySelector<HTMLElement>('[data-action="skip"]')?.addEventListener('click', () => closeTutorial(true));
  root.querySelector<HTMLElement>('[data-action="back"]')?.addEventListener('click', () => {
    currentStep = Math.max(0, currentStep - 1);
    renderStep();
  });
  root.querySelector<HTMLElement>('[data-action="next"]')?.addEventListener('click', () => {
    if (currentStep < steps.length - 1) {
      currentStep += 1;
      renderStep();
      return;
    }
    closeTutorial(true);
    const homeButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) => {
      const label = normalize(button.textContent);
      return label === 'inicio' || label === 'visao geral' || label === 'dashboard';
    });
    homeButton?.click();
  });

  window.setTimeout(() => {
    const panel = root.querySelector<HTMLElement>('.mf-safe-panel');
    const rect = panel?.getBoundingClientRect();
    if (!panel || !rect || rect.width < 240 || rect.height < 160) closeTutorial(false);
  }, 350);
}

function openTutorial() {
  installStyle();
  closeTutorial(false);
  currentStep = 0;

  const root = document.createElement('div');
  root.id = TUTORIAL_ROOT_ID;
  root.addEventListener('click', (event) => {
    if (event.target === root) closeTutorial(true);
  });
  document.body.appendChild(root);
  document.addEventListener('keydown', handleKeydown);
  renderStep();
}

function findLegacyBackdrop(title: string): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>('.mf-dialog-backdrop')).find((backdrop) =>
    normalize(backdrop.textContent).includes(normalize(title)),
  ) || null;
}

function closeLegacyDialog(backdrop: HTMLElement) {
  const closeButton = backdrop.querySelector<HTMLButtonElement>('.mf-dialog-header button');
  if (closeButton) {
    closeButton.click();
  } else {
    backdrop.style.display = 'none';
    backdrop.style.pointerEvents = 'none';
  }
}

function rescueLegacyTutorial() {
  if (legacyHandling || document.getElementById(TUTORIAL_ROOT_ID)) return;
  const legacyTutorial = findLegacyBackdrop('Primeiros passos no MF Financeiro');
  if (!legacyTutorial) return;

  legacyHandling = true;
  closeLegacyDialog(legacyTutorial);
  window.setTimeout(() => {
    openTutorial();
    legacyHandling = false;
  }, 40);
}

function removeBrokenBackdrop() {
  document.querySelectorAll<HTMLElement>('.mf-dialog-backdrop').forEach((backdrop) => {
    if (backdrop.closest(`#${TUTORIAL_ROOT_ID}`)) return;
    const dialog = backdrop.querySelector<HTMLElement>('.mf-dialog');
    if (!dialog) {
      backdrop.remove();
      return;
    }
    const rect = dialog.getBoundingClientRect();
    const text = normalize(dialog.textContent);
    if (rect.width < 40 || rect.height < 40 || !text) {
      backdrop.style.display = 'none';
      backdrop.style.pointerEvents = 'none';
    }
  });
}

function installTutorialRescue() {
  installStyle();

  document.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('button');
    if (!button || normalize(button.textContent) !== 'ver tutorial') return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const profileBackdrop = findLegacyBackdrop('Seu espaço financeiro');
    if (profileBackdrop) closeLegacyDialog(profileBackdrop);
    window.setTimeout(openTutorial, 40);
  }, true);

  const observer = new MutationObserver(() => {
    rescueLegacyTutorial();
    window.setTimeout(removeBrokenBackdrop, 500);
  });
  observer.observe(document.body, { subtree: true, childList: true });

  rescueLegacyTutorial();
  window.setTimeout(removeBrokenBackdrop, 900);
  window.addEventListener('mf:open-tutorial', openTutorial as EventListener);

  window.addEventListener('beforeunload', () => {
    observer.disconnect();
    window.removeEventListener('mf:open-tutorial', openTutorial as EventListener);
    closeTutorial(false);
  }, { once: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installTutorialRescue, { once: true });
} else {
  installTutorialRescue();
}

export {};
