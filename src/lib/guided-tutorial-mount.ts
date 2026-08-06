import { supabase } from './supabase';

type TutorialStep = {
  eyebrow: string;
  title: string;
  description: string;
  navLabel?: string;
  visual: string;
};

const ROOT_ID = 'mf-safe-tutorial-root';
const STYLE_ID = 'mf-guided-tutorial-style';
const DISMISSED_PREFIX = 'mf:tutorial-dismissed:';

let currentStep = 0;
let activeUserId: string | null = null;
let autoCheckTimer: number | null = null;
let positionHandler: (() => void) | null = null;
let authSubscription: { unsubscribe: () => void } | null = null;
let checking = false;

const normalize = (value: string | null | undefined) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const steps: TutorialStep[] = [
  {
    eyebrow: 'Bem-vindo',
    title: 'Bem-vindo ao MF Financeiro',
    description: 'Em poucos passos você vai conhecer as principais áreas do aplicativo. O tour navega pela tela com você e não altera nenhum dado financeiro.',
    visual: `
      <div class="mf-guide-welcome" aria-hidden="true">
        <div class="mf-guide-orbit orbit-a"></div><div class="mf-guide-orbit orbit-b"></div>
        <div class="mf-guide-logo">MF</div>
        <div class="mf-guide-float a"><span>Saldo</span><b>Visão atual</b></div>
        <div class="mf-guide-float b"><span>Ciclo</span><b>5 → 20</b></div>
        <div class="mf-guide-float c"><span>Insights</span><b>Prioridades</b></div>
      </div>
      <p class="mf-guide-center">Você pode concluir o passo a passo ou usar <strong>Pular tutorial</strong> a qualquer momento. Depois de pular ou concluir, ele não abre sozinho novamente.</p>
    `,
  },
  {
    eyebrow: 'Área 1 de 6',
    title: 'Início: sua visão financeira do dia',
    description: 'Aqui ficam os números que ajudam a entender rapidamente como está sua situação agora.',
    navLabel: 'Início',
    visual: `
      <div class="mf-guide-grid four">
        <article><span>Saldo</span><b>Disponível agora</b><small>Valor confirmado da conta.</small></article>
        <article><span>Ciclo</span><b>Período atual</b><small>Organiza o dinheiro entre os pagamentos.</small></article>
        <article><span>Limites</span><b>Cartões</b><small>Uso e disponibilidade dos cartões.</small></article>
        <article><span>Alertas</span><b>Prioridades</b><small>Contas, faturas e compromissos próximos.</small></article>
      </div>
    `,
  },
  {
    eyebrow: 'Área 2 de 6',
    title: 'Movimentações: tudo que entrou e saiu',
    description: 'Registre entradas e saídas, acompanhe o histórico e importe extratos bancários para organizar períodos anteriores.',
    navLabel: 'Movimentações',
    visual: `
      <div class="mf-guide-flow">
        <div><i>+</i><span><b>Entrada</b><small>Salário, renda extra, benefício ou recebimento.</small></span><em>Receita</em></div>
        <div><i>−</i><span><b>Saída</b><small>Compra, conta, Pix, débito ou outro gasto.</small></span><em>Despesa</em></div>
        <div><i>↥</i><span><b>Importar extrato</b><small>CSV, OFX, PDF e planilhas passam por conferência antes de entrar.</small></span><em>Revisar</em></div>
      </div>
    `,
  },
  {
    eyebrow: 'Área 3 de 6',
    title: 'Contas: compromissos que se repetem',
    description: 'Organize o que precisa ser pago e deixe o MF considerar essas obrigações nas prioridades do ciclo.',
    navLabel: 'Contas',
    visual: `
      <div class="mf-guide-grid three">
        <article><span>Fixas</span><b>Contas mensais</b><small>Energia, aluguel, internet e outros compromissos recorrentes.</small></article>
        <article><span>Assinaturas</span><b>Serviços recorrentes</b><small>Streaming, apps e mensalidades.</small></article>
        <article><span>Orçamentos</span><b>Limites por categoria</b><small>Planeje quanto pretende gastar.</small></article>
      </div>
    `,
  },
  {
    eyebrow: 'Área 4 de 6',
    title: 'Cartões: limite, fatura e parcelamentos',
    description: 'Cadastre seus cartões para acompanhar o que já foi usado, a próxima fatura e as compras parceladas.',
    navLabel: 'Cartões',
    visual: `
      <div class="mf-guide-card-demo">
        <div class="mf-guide-credit"><span>MF CARD</span><b>•••• 2026</b><small>Limite e fechamento organizados</small></div>
        <div class="mf-guide-card-stats"><div><span>Fatura</span><b>Próximo vencimento</b></div><div><span>Parcelas</span><b>Compromissos futuros</b></div></div>
      </div>
    `,
  },
  {
    eyebrow: 'Área 5 de 6',
    title: 'Renda: salário, holerite e outras entradas',
    description: 'Centralize salário, adiantamento, benefícios e renda extra sem misturar esses valores com despesas.',
    navLabel: 'Renda',
    visual: `
      <div class="mf-guide-income">
        <div class="payday"><span>Dia 5</span><b>Fechamento da folha</b></div>
        <div class="payline"><i></i></div>
        <div class="payday"><span>Dia 20</span><b>Adiantamento</b></div>
        <div class="tags"><span>+ Renda extra</span><span>+ Benefício</span><span>+ Holerite</span></div>
      </div>
    `,
  },
  {
    eyebrow: 'Área 6 de 6',
    title: 'Análises: transforme registros em decisões',
    description: 'O MF cruza seus lançamentos, compromissos e renda para mostrar tendências, saúde financeira e próximos objetivos.',
    navLabel: 'Análises',
    visual: `
      <div class="mf-guide-analysis">
        <div class="bars"><i style="height:36%"></i><i style="height:58%"></i><i style="height:44%"></i><i style="height:78%"></i><i style="height:64%"></i><i style="height:88%"></i></div>
        <div class="list"><span><b>Resumo</b><small>Visão consolidada.</small></span><span><b>Insights</b><small>Prioridades e padrões.</small></span><span><b>Saúde</b><small>Equilíbrio financeiro.</small></span><span><b>Metas</b><small>Objetivos e progresso.</small></span></div>
      </div>
    `,
  },
  {
    eyebrow: 'Tudo pronto',
    title: 'Agora configure o MF com seus dados',
    description: 'A qualidade das projeções melhora conforme você confirma as informações principais.',
    visual: `
      <div class="mf-guide-checklist">
        <div><i>1</i><span><b>Confirme seu saldo atual</b><small>Use o valor real disponível no banco.</small></span></div>
        <div><i>2</i><span><b>Cadastre sua renda</b><small>Salário, benefícios e rendas extras.</small></span></div>
        <div><i>3</i><span><b>Inclua contas e cartões</b><small>O MF passa a reconhecer compromissos futuros.</small></span></div>
        <div><i>4</i><span><b>Registre ou importe movimentações</b><small>Revise tudo antes de alterar o saldo.</small></span></div>
      </div>
      <div class="mf-guide-note">O tutorial continua disponível no perfil para consulta manual.</div>
    `,
  },
];

function storageKey(userId = activeUserId) {
  return `${DISMISSED_PREFIX}${userId || 'pending'}`;
}

function dismissedLocally(userId = activeUserId) {
  try {
    const key = storageKey(userId);
    return localStorage.getItem(key) === '1' || sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function markDismissedLocally() {
  try {
    localStorage.setItem(storageKey(), '1');
    sessionStorage.setItem(storageKey(), '1');
  } catch {
    // The durable database flag still remains available.
  }
}

async function persistSeen() {
  try {
    const userId = activeUserId || (await supabase.auth.getUser()).data.user?.id || null;
    if (!userId) return;
    await supabase.from('mf_user_settings').update({ onboarding_seen: true }).eq('user_id', userId);
  } catch {
    // Closing the tutorial never depends on network availability.
  }
}

function installStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${ROOT_ID}{position:fixed;inset:0;z-index:2147483000;pointer-events:none;color:#fff;font-family:inherit}
    #${ROOT_ID} *{box-sizing:border-box}
    #${ROOT_ID}.centered{pointer-events:auto;background:rgba(0,0,0,.78);backdrop-filter:blur(9px)}
    #${ROOT_ID} .spotlight{position:fixed;z-index:1;border:2px solid rgba(0,242,255,.95);border-radius:16px;box-shadow:0 0 0 9999px rgba(0,0,0,.76),0 0 0 6px rgba(0,242,255,.10),0 0 38px rgba(0,242,255,.45);pointer-events:none;transition:.32s cubic-bezier(.2,.8,.2,1);animation:mfGuidePulse 1.9s ease-in-out infinite}
    #${ROOT_ID}.centered .spotlight{display:none}
    #${ROOT_ID} .panel{position:fixed;z-index:3;width:min(490px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:hidden;border:1px solid rgba(255,255,255,.14);border-radius:24px;background:linear-gradient(155deg,rgba(17,17,21,.98),rgba(7,7,9,.98));box-shadow:0 28px 90px rgba(0,0,0,.72);pointer-events:auto;animation:mfGuideIn .3s ease both}
    #${ROOT_ID}.centered .panel{left:50%;top:50%;transform:translate(-50%,-50%);width:min(650px,calc(100vw - 32px));animation-name:mfGuideCenterIn}
    #${ROOT_ID} header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:20px 20px 14px;border-bottom:1px solid rgba(255,255,255,.07)}
    #${ROOT_ID} .eyebrow{display:block;margin-bottom:6px;color:#00f2ff;font-size:10px;font-weight:950;letter-spacing:.13em;text-transform:uppercase}
    #${ROOT_ID} h2{margin:0;font-size:clamp(20px,3vw,27px);line-height:1.12;letter-spacing:-.02em}
    #${ROOT_ID} .description{margin:8px 0 0;max-width:560px;color:rgba(255,255,255,.58);font-size:12px;line-height:1.58}
    #${ROOT_ID} .close{flex:0 0 auto;display:grid;place-items:center;width:38px;height:38px;border:1px solid rgba(255,255,255,.12);border-radius:12px;background:rgba(255,255,255,.05);color:#fff;cursor:pointer;font-size:21px}
    #${ROOT_ID} .body{min-height:210px;max-height:430px;overflow-y:auto;padding:19px 20px}
    #${ROOT_ID} footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 20px 18px;border-top:1px solid rgba(255,255,255,.07)}
    #${ROOT_ID} .progress{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
    #${ROOT_ID} .progress i{display:block;width:6px;height:6px;border-radius:999px;background:rgba(255,255,255,.16);transition:.2s ease}
    #${ROOT_ID} .progress i.active{width:24px;background:#00f2ff;box-shadow:0 0 14px rgba(0,242,255,.35)}
    #${ROOT_ID} .actions{display:flex;justify-content:flex-end;align-items:center;gap:7px;flex-wrap:wrap}
    #${ROOT_ID} button{font-family:inherit}
    #${ROOT_ID} .secondary,#${ROOT_ID} .primary{border-radius:12px;padding:10px 13px;cursor:pointer;font-size:10px;font-weight:950;transition:.18s ease}
    #${ROOT_ID} .secondary{border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);color:#fff}
    #${ROOT_ID} .primary{border:1px solid #00f2ff;background:#00f2ff;color:#050505;box-shadow:0 8px 24px rgba(0,242,255,.12)}
    #${ROOT_ID} .mf-guide-center{max-width:520px;margin:8px auto 0;text-align:center;color:rgba(255,255,255,.58);font-size:12px;line-height:1.65}
    #${ROOT_ID} .mf-guide-center strong{color:#fff}
    #${ROOT_ID} .mf-guide-welcome{position:relative;width:min(360px,100%);height:190px;margin:0 auto 10px;display:grid;place-items:center}
    #${ROOT_ID} .mf-guide-logo{position:relative;z-index:3;display:grid;place-items:center;width:82px;height:82px;border-radius:27px;border:1px solid rgba(0,242,255,.35);background:rgba(0,242,255,.10);color:#00f2ff;font-size:27px;font-weight:1000;box-shadow:0 0 50px rgba(0,242,255,.18);animation:mfGuideFloat 2.8s ease-in-out infinite}
    #${ROOT_ID} .mf-guide-orbit{position:absolute;border:1px solid rgba(0,242,255,.14);border-radius:50%;animation:mfGuideSpin 12s linear infinite}.orbit-a{width:170px;height:170px}.orbit-b{width:250px;height:120px;animation-duration:16s;animation-direction:reverse}
    #${ROOT_ID} .mf-guide-float{position:absolute;z-index:4;display:grid;gap:2px;min-width:104px;padding:9px 11px;border:1px solid rgba(255,255,255,.1);border-radius:12px;background:rgba(15,15,18,.92);box-shadow:0 14px 34px rgba(0,0,0,.38);animation:mfGuideFloat 3.2s ease-in-out infinite}.mf-guide-float span{color:rgba(255,255,255,.4);font-size:9px;text-transform:uppercase;font-weight:900}.mf-guide-float b{font-size:11px}.mf-guide-float.a{left:0;top:25px}.mf-guide-float.b{right:0;top:22px;animation-delay:.5s}.mf-guide-float.c{right:22px;bottom:9px;animation-delay:1s}
    #${ROOT_ID} .mf-guide-grid{display:grid;gap:9px}.mf-guide-grid.four{grid-template-columns:repeat(2,minmax(0,1fr))}.mf-guide-grid.three{grid-template-columns:repeat(3,minmax(0,1fr))}.mf-guide-grid article{position:relative;overflow:hidden;min-height:98px;padding:13px;border:1px solid rgba(255,255,255,.09);border-radius:15px;background:rgba(255,255,255,.035);animation:mfGuideItem .35s ease both}.mf-guide-grid article:after{content:'';position:absolute;left:0;bottom:0;width:58%;height:2px;background:linear-gradient(90deg,#00f2ff,transparent);animation:mfGuideScan 2.4s ease-in-out infinite}.mf-guide-grid span{display:block;margin-bottom:7px;color:#00f2ff;font-size:9px;font-weight:950;text-transform:uppercase}.mf-guide-grid b{display:block;font-size:12px}.mf-guide-grid small{display:block;margin-top:5px;color:rgba(255,255,255,.43);font-size:9px;line-height:1.4}
    #${ROOT_ID} .mf-guide-flow{display:grid;gap:9px}.mf-guide-flow>div{display:grid;grid-template-columns:34px 1fr auto;align-items:center;gap:10px;padding:11px 12px;border:1px solid rgba(255,255,255,.09);border-radius:14px;background:rgba(255,255,255,.03);animation:mfGuideItem .35s ease both}.mf-guide-flow i{display:grid;place-items:center;width:30px;height:30px;border-radius:10px;background:rgba(0,242,255,.10);color:#00f2ff;font-style:normal;font-weight:1000}.mf-guide-flow span{display:grid;gap:3px}.mf-guide-flow b{font-size:11px}.mf-guide-flow small{color:rgba(255,255,255,.42);font-size:9px}.mf-guide-flow em{color:rgba(255,255,255,.34);font-size:9px;font-style:normal;text-transform:uppercase;font-weight:900}
    #${ROOT_ID} .mf-guide-card-demo{display:grid;grid-template-columns:1.25fr .75fr;gap:11px}.mf-guide-credit{min-height:142px;display:flex;flex-direction:column;justify-content:space-between;padding:17px;border-radius:20px;border:1px solid rgba(0,242,255,.26);background:radial-gradient(circle at 85% 10%,rgba(0,242,255,.20),transparent 40%),linear-gradient(145deg,#12151a,#090a0c);animation:mfGuideTilt 4s ease-in-out infinite}.mf-guide-credit span{color:#00f2ff;font-size:10px;font-weight:950;letter-spacing:.14em}.mf-guide-credit b{font-size:16px}.mf-guide-credit small{color:rgba(255,255,255,.42);font-size:9px}.mf-guide-card-stats{display:grid;gap:9px}.mf-guide-card-stats div{display:flex;flex-direction:column;justify-content:center;padding:12px;border:1px solid rgba(255,255,255,.08);border-radius:14px;background:rgba(255,255,255,.03)}.mf-guide-card-stats span{color:rgba(255,255,255,.36);font-size:9px;text-transform:uppercase;font-weight:900}.mf-guide-card-stats b{margin-top:4px;font-size:10px}
    #${ROOT_ID} .mf-guide-income{padding:8px 2px 2px}.mf-guide-income .payday{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 13px;border:1px solid rgba(255,255,255,.09);border-radius:14px;background:rgba(255,255,255,.03)}.mf-guide-income .payday span{color:#00f2ff;font-size:10px;font-weight:950;text-transform:uppercase}.mf-guide-income .payday b{font-size:11px}.mf-guide-income .payline{height:37px;position:relative;margin-left:24px}.mf-guide-income .payline:before{content:'';position:absolute;left:0;top:0;bottom:0;width:2px;background:rgba(0,242,255,.18)}.mf-guide-income .payline i{position:absolute;left:-3px;top:0;width:8px;height:8px;border-radius:50%;background:#00f2ff;box-shadow:0 0 14px rgba(0,242,255,.7);animation:mfGuidePay 1.8s ease-in-out infinite}.mf-guide-income .tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}.mf-guide-income .tags span{padding:7px 9px;border-radius:999px;border:1px solid rgba(0,242,255,.17);background:rgba(0,242,255,.06);color:rgba(255,255,255,.66);font-size:9px;font-weight:850}
    #${ROOT_ID} .mf-guide-analysis{display:grid;grid-template-columns:1fr 1.15fr;gap:12px}.mf-guide-analysis .bars{min-height:150px;display:flex;align-items:flex-end;gap:7px;padding:16px 13px 12px;border:1px solid rgba(255,255,255,.08);border-radius:16px;background:rgba(255,255,255,.025)}.mf-guide-analysis .bars i{flex:1;min-width:7px;border-radius:6px 6px 2px 2px;background:linear-gradient(180deg,#00f2ff,rgba(0,242,255,.16));transform-origin:bottom;animation:mfGuideBar .8s ease both}.mf-guide-analysis .list{display:grid;gap:7px}.mf-guide-analysis .list span{display:grid;gap:2px;padding:9px 10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.025)}.mf-guide-analysis .list b{font-size:10px}.mf-guide-analysis .list small{color:rgba(255,255,255,.4);font-size:8.5px}
    #${ROOT_ID} .mf-guide-checklist{display:grid;gap:8px}.mf-guide-checklist>div{display:flex;align-items:center;gap:11px;padding:11px 12px;border:1px solid rgba(255,255,255,.08);border-radius:14px;background:rgba(255,255,255,.03)}.mf-guide-checklist i{display:grid;place-items:center;flex:0 0 auto;width:29px;height:29px;border-radius:999px;background:rgba(0,242,255,.11);color:#00f2ff;font-size:10px;font-style:normal;font-weight:950}.mf-guide-checklist span{display:grid;gap:3px}.mf-guide-checklist b{font-size:11px}.mf-guide-checklist small{color:rgba(255,255,255,.43);font-size:9px}.mf-guide-note{margin-top:11px;padding:10px 11px;border:1px solid rgba(0,242,255,.16);border-radius:12px;background:rgba(0,242,255,.06);color:rgba(255,255,255,.53);font-size:9px}
    .mf-guide-active-target{position:relative !important;z-index:2147483002 !important}
    @keyframes mfGuidePulse{0%,100%{box-shadow:0 0 0 9999px rgba(0,0,0,.76),0 0 0 5px rgba(0,242,255,.08),0 0 26px rgba(0,242,255,.32)}50%{box-shadow:0 0 0 9999px rgba(0,0,0,.76),0 0 0 9px rgba(0,242,255,.12),0 0 44px rgba(0,242,255,.5)}}
    @keyframes mfGuideIn{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}
    @keyframes mfGuideCenterIn{from{opacity:0;transform:translate(-50%,-47%) scale(.97)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
    @keyframes mfGuideFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}@keyframes mfGuideSpin{to{transform:rotate(360deg)}}@keyframes mfGuideItem{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}@keyframes mfGuideScan{0%,100%{transform:translateX(-30%);opacity:.35}50%{transform:translateX(115%);opacity:1}}@keyframes mfGuideTilt{0%,100%{transform:perspective(500px) rotateY(0)}50%{transform:perspective(500px) rotateY(-4deg) translateY(-2px)}}@keyframes mfGuidePay{0%{top:0;opacity:.2}50%{opacity:1}100%{top:29px;opacity:.2}}@keyframes mfGuideBar{from{transform:scaleY(.05);opacity:.25}to{transform:scaleY(1);opacity:1}}
    @media(prefers-reduced-motion:reduce){#${ROOT_ID} *,#${ROOT_ID} *:before,#${ROOT_ID} *:after{animation-duration:.01ms !important;animation-iteration-count:1 !important;transition-duration:.01ms !important}}
    @media(max-width:720px){#${ROOT_ID} .panel,#${ROOT_ID}.centered .panel{left:8px !important;right:8px !important;top:auto !important;bottom:8px !important;width:auto !important;transform:none !important;max-height:calc(100vh - 16px);border-radius:22px 22px 12px 12px}#${ROOT_ID} header{padding:16px 15px 12px}#${ROOT_ID} .body{min-height:170px;max-height:48vh;padding:15px}#${ROOT_ID} footer{padding:12px 15px 14px;align-items:flex-end}.mf-guide-grid.three,.mf-guide-grid.four{grid-template-columns:1fr 1fr !important}.mf-guide-card-demo,.mf-guide-analysis{grid-template-columns:1fr !important}.mf-guide-welcome{height:165px !important}}
    @media(max-width:430px){#${ROOT_ID} .progress{display:none}#${ROOT_ID} footer{justify-content:flex-end}.mf-guide-grid.three,.mf-guide-grid.four{grid-template-columns:1fr !important}.mf-guide-flow>div{grid-template-columns:32px 1fr !important}.mf-guide-flow em{display:none}}
  `;
  document.head.appendChild(style);
}

function clearTarget() {
  document.querySelectorAll<HTMLElement>('.mf-guide-active-target').forEach((element) => element.classList.remove('mf-guide-active-target'));
}

function findNavTarget(label?: string): HTMLButtonElement | null {
  if (!label) return null;
  const wanted = normalize(label);
  return Array.from(document.querySelectorAll<HTMLButtonElement>('#mf-simple-navigation-root button'))
    .find((button) => normalize(button.textContent) === wanted) || null;
}

function positionTour() {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;
  const step = steps[currentStep] || steps[0];
  const target = findNavTarget(step.navLabel);
  const spotlight = root.querySelector<HTMLElement>('.spotlight');
  const panel = root.querySelector<HTMLElement>('.panel');
  if (!spotlight || !panel) return;

  clearTarget();
  if (!target || !step.navLabel) {
    root.classList.add('centered');
    spotlight.style.opacity = '0';
    panel.style.left = '';
    panel.style.top = '';
    return;
  }

  root.classList.remove('centered');
  target.classList.add('mf-guide-active-target');
  const rect = target.getBoundingClientRect();
  const pad = 7;
  spotlight.style.opacity = '1';
  spotlight.style.left = `${Math.max(4, rect.left - pad)}px`;
  spotlight.style.top = `${Math.max(4, rect.top - pad)}px`;
  spotlight.style.width = `${Math.min(window.innerWidth - 8, rect.width + pad * 2)}px`;
  spotlight.style.height = `${Math.min(window.innerHeight - 8, rect.height + pad * 2)}px`;

  if (window.innerWidth <= 720) return;
  const panelWidth = Math.min(490, window.innerWidth - 48);
  const panelHeight = Math.max(300, panel.getBoundingClientRect().height || 430);
  panel.style.left = `${Math.min(Math.max(24, rect.left), Math.max(24, window.innerWidth - panelWidth - 24))}px`;
  let top = rect.bottom + 22;
  if (top + panelHeight > window.innerHeight - 20) top = Math.max(20, rect.top - panelHeight - 20);
  panel.style.top = `${top}px`;
}

function closeTutorial(markSeen = true) {
  if (autoCheckTimer !== null) {
    window.clearTimeout(autoCheckTimer);
    autoCheckTimer = null;
  }
  clearTarget();
  document.getElementById(ROOT_ID)?.remove();
  document.removeEventListener('keydown', handleKeydown);
  if (positionHandler) {
    window.removeEventListener('resize', positionHandler);
    window.removeEventListener('scroll', positionHandler, true);
    positionHandler = null;
  }
  document.documentElement.style.removeProperty('overflow');
  if (markSeen) {
    markDismissedLocally();
    void persistSeen();
  }
}

function previousStep() {
  if (currentStep <= 0) return;
  currentStep -= 1;
  renderStep(true);
}

function nextStep() {
  if (currentStep < steps.length - 1) {
    currentStep += 1;
    renderStep(true);
    return;
  }
  closeTutorial(true);
  findNavTarget('Início')?.click();
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeTutorial(true);
  if (event.key === 'ArrowRight') nextStep();
  if (event.key === 'ArrowLeft') previousStep();
}

function renderStep(navigate = false) {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;
  const step = steps[currentStep] || steps[0];
  if (navigate) findNavTarget(step.navLabel)?.click();

  root.innerHTML = `
    <div class="spotlight" aria-hidden="true"></div>
    <section class="panel" role="dialog" aria-modal="true" aria-labelledby="mf-guided-tutorial-title">
      <header><div><span class="eyebrow">${step.eyebrow}</span><h2 id="mf-guided-tutorial-title">${step.title}</h2><p class="description">${step.description}</p></div><button type="button" class="close" data-action="close" aria-label="Pular e fechar tutorial">×</button></header>
      <div class="body">${step.visual}</div>
      <footer><div class="progress" aria-label="Progresso do tutorial">${steps.map((_, index) => `<i class="${index === currentStep ? 'active' : ''}"></i>`).join('')}</div><div class="actions"><button type="button" class="secondary" data-action="skip">Pular tutorial</button>${currentStep > 0 ? '<button type="button" class="secondary" data-action="back">Voltar</button>' : ''}<button type="button" class="primary" data-action="next">${currentStep === steps.length - 1 ? 'Concluir' : currentStep === 0 ? 'Começar tour' : 'Próximo'}</button></div></footer>
    </section>`;

  root.querySelector<HTMLElement>('[data-action="close"]')?.addEventListener('click', () => closeTutorial(true));
  root.querySelector<HTMLElement>('[data-action="skip"]')?.addEventListener('click', () => closeTutorial(true));
  root.querySelector<HTMLElement>('[data-action="back"]')?.addEventListener('click', previousStep);
  root.querySelector<HTMLElement>('[data-action="next"]')?.addEventListener('click', nextStep);
  window.setTimeout(positionTour, navigate ? 260 : 40);
  window.setTimeout(positionTour, navigate ? 520 : 160);
}

function openTutorial() {
  installStyle();
  closeTutorial(false);
  currentStep = 0;
  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.className = 'centered';
  document.body.appendChild(root);
  document.documentElement.style.overflow = 'hidden';
  document.addEventListener('keydown', handleKeydown);
  positionHandler = () => window.requestAnimationFrame(positionTour);
  window.addEventListener('resize', positionHandler);
  window.addEventListener('scroll', positionHandler, true);
  renderStep(false);
}

async function maybeOpenForNewUser(attempt = 0) {
  if (checking || document.getElementById(ROOT_ID)) return;
  checking = true;
  try {
    const { data } = await supabase.auth.getUser();
    const userId = data.user?.id || null;
    activeUserId = userId;
    if (!userId || dismissedLocally(userId)) return;

    const { data: settings, error } = await supabase
      .from('mf_user_settings')
      .select('onboarding_seen')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) return;
    if (!settings) {
      if (attempt < 4) scheduleAutoCheck(attempt + 1, 650 + attempt * 350);
      return;
    }
    if (settings.onboarding_seen === true || dismissedLocally(userId)) return;

    scheduleAutoCheck(-1, 500);
  } finally {
    checking = false;
  }
}

function scheduleAutoCheck(attempt: number, delay: number) {
  if (autoCheckTimer !== null) window.clearTimeout(autoCheckTimer);
  autoCheckTimer = window.setTimeout(() => {
    autoCheckTimer = null;
    if (attempt === -1) {
      if (!dismissedLocally() && !document.getElementById(ROOT_ID)) openTutorial();
      return;
    }
    void maybeOpenForNewUser(attempt);
  }, delay);
}

function mount() {
  installStyle();
  supabase.auth.getUser().then(({ data }) => {
    activeUserId = data.user?.id || null;
    if (activeUserId) void maybeOpenForNewUser();
  }).catch(() => undefined);

  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    activeUserId = session?.user?.id || null;
    if (activeUserId) void maybeOpenForNewUser();
    else closeTutorial(false);
  });
  authSubscription = data.subscription;

  window.addEventListener('mf:open-tutorial', openTutorial as EventListener);
  window.addEventListener('beforeunload', () => {
    if (autoCheckTimer !== null) window.clearTimeout(autoCheckTimer);
    authSubscription?.unsubscribe();
    window.removeEventListener('mf:open-tutorial', openTutorial as EventListener);
    closeTutorial(false);
  }, { once: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
else mount();

export {};
