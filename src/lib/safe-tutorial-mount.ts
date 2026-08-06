import { supabase } from './supabase';

type TutorialStep = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  navLabel?: string;
  visual: string;
};

const TUTORIAL_ROOT_ID = 'mf-safe-tutorial-root';
const STYLE_ID = 'mf-safe-tutorial-style';
const LEGACY_TUTORIAL_TITLE = 'Primeiros passos no MF Financeiro';
const DISMISSED_PREFIX = 'mf:tutorial-dismissed:';

const normalize = (value: string | null | undefined) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const steps: TutorialStep[] = [
  {
    id: 'welcome',
    eyebrow: 'Bem-vindo',
    title: 'Bem-vindo ao MF Financeiro',
    description: 'Em poucos passos você vai conhecer as principais áreas do aplicativo. O tour navega pela tela junto com você e não altera nenhum dado financeiro.',
    visual: `
      <div class="mf-tour-welcome-visual" aria-hidden="true">
        <div class="mf-tour-orbit orbit-a"></div>
        <div class="mf-tour-orbit orbit-b"></div>
        <div class="mf-tour-logo">MF</div>
        <div class="mf-tour-float-card card-a"><span>Saldo</span><b>Visão atual</b></div>
        <div class="mf-tour-float-card card-b"><span>Ciclo</span><b>5 → 20</b></div>
        <div class="mf-tour-float-card card-c"><span>Insights</span><b>Prioridades</b></div>
      </div>
      <p class="mf-tour-center-copy">Você pode concluir o passo a passo ou usar <strong>Pular tutorial</strong> a qualquer momento. Depois de pular ou concluir, ele não abre sozinho novamente.</p>
    `,
  },
  {
    id: 'home',
    eyebrow: 'Área 1 de 6',
    title: 'Início: sua visão financeira do dia',
    description: 'Aqui ficam os números que ajudam a entender rapidamente como está sua situação agora.',
    navLabel: 'Início',
    visual: `
      <div class="mf-tour-demo-grid four">
        <article><span>Saldo</span><b>Disponível agora</b><small>Valor confirmado da conta.</small></article>
        <article><span>Ciclo</span><b>Período atual</b><small>Organiza o dinheiro entre os pagamentos.</small></article>
        <article><span>Limites</span><b>Cartões</b><small>Uso e disponibilidade dos cartões.</small></article>
        <article><span>Alertas</span><b>Prioridades</b><small>Contas, faturas e compromissos próximos.</small></article>
      </div>
    `,
  },
  {
    id: 'movements',
    eyebrow: 'Área 2 de 6',
    title: 'Movimentações: tudo que entrou e saiu',
    description: 'Registre entradas e saídas, acompanhe o histórico e importe extratos bancários para organizar períodos anteriores.',
    navLabel: 'Movimentações',
    visual: `
      <div class="mf-tour-flow-demo">
        <div class="mf-tour-flow-row income"><i>+</i><span><b>Entrada</b><small>Salário, renda extra, benefício ou recebimento.</small></span><em>Receita</em></div>
        <div class="mf-tour-flow-row expense"><i>−</i><span><b>Saída</b><small>Compra, conta, Pix, débito ou outro gasto.</small></span><em>Despesa</em></div>
        <div class="mf-tour-flow-row import"><i>↥</i><span><b>Importar extrato</b><small>CSV, OFX, PDF e planilhas passam por conferência antes de entrar.</small></span><em>Revisar</em></div>
      </div>
    `,
  },
  {
    id: 'accounts',
    eyebrow: 'Área 3 de 6',
    title: 'Contas: compromissos que se repetem',
    description: 'Organize o que precisa ser pago e deixe o MF considerar essas obrigações nas prioridades do ciclo.',
    navLabel: 'Contas',
    visual: `
      <div class="mf-tour-demo-grid three">
        <article><span>Fixas</span><b>Contas mensais</b><small>Energia, aluguel, internet e outros compromissos recorrentes.</small></article>
        <article><span>Assinaturas</span><b>Serviços recorrentes</b><small>Streaming, apps e mensalidades.</small></article>
        <article><span>Orçamentos</span><b>Limites por categoria</b><small>Planeje quanto pretende gastar.</small></article>
      </div>
    `,
  },
  {
    id: 'cards',
    eyebrow: 'Área 4 de 6',
    title: 'Cartões: limite, fatura e parcelamentos',
    description: 'Cadastre seus cartões para acompanhar o que já foi usado, a próxima fatura e as compras parceladas.',
    navLabel: 'Cartões',
    visual: `
      <div class="mf-tour-card-demo">
        <div class="mf-tour-credit-card"><span>MF CARD</span><b>•••• 2026</b><small>Limite e fechamento organizados</small></div>
        <div class="mf-tour-card-stats">
          <div><span>Fatura</span><b>Próximo vencimento</b></div>
          <div><span>Parcelas</span><b>Compromissos futuros</b></div>
        </div>
      </div>
    `,
  },
  {
    id: 'income',
    eyebrow: 'Área 5 de 6',
    title: 'Renda: salário, holerite e outras entradas',
    description: 'Centralize salário, adiantamento, benefícios e renda extra sem misturar esses valores com despesas.',
    navLabel: 'Renda',
    visual: `
      <div class="mf-tour-income-demo">
        <div class="mf-tour-payday"><span>Dia 5</span><b>Fechamento da folha</b></div>
        <div class="mf-tour-payline"><i></i></div>
        <div class="mf-tour-payday"><span>Dia 20</span><b>Adiantamento</b></div>
        <div class="mf-tour-income-tags"><span>+ Renda extra</span><span>+ Benefício</span><span>+ Holerite</span></div>
      </div>
    `,
  },
  {
    id: 'analysis',
    eyebrow: 'Área 6 de 6',
    title: 'Análises: transforme registros em decisões',
    description: 'O MF cruza seus lançamentos, compromissos e renda para mostrar tendências, saúde financeira e próximos objetivos.',
    navLabel: 'Análises',
    visual: `
      <div class="mf-tour-analysis-demo">
        <div class="mf-tour-bars"><i style="height:36%"></i><i style="height:58%"></i><i style="height:44%"></i><i style="height:78%"></i><i style="height:64%"></i><i style="height:88%"></i></div>
        <div class="mf-tour-analysis-list">
          <span><b>Resumo</b><small>Visão consolidada.</small></span>
          <span><b>Insights</b><small>Prioridades e padrões.</small></span>
          <span><b>Saúde</b><small>Equilíbrio financeiro.</small></span>
          <span><b>Metas</b><small>Objetivos e progresso.</small></span>
        </div>
      </div>
    `,
  },
  {
    id: 'finish',
    eyebrow: 'Tudo pronto',
    title: 'Agora configure o MF com seus dados',
    description: 'A qualidade das projeções melhora conforme você confirma as informações principais.',
    visual: `
      <div class="mf-tour-checklist">
        <div><i>1</i><span><b>Confirme seu saldo atual</b><small>Use o valor real disponível no banco.</small></span></div>
        <div><i>2</i><span><b>Cadastre sua renda</b><small>Salário, benefícios e rendas extras.</small></span></div>
        <div><i>3</i><span><b>Inclua contas e cartões</b><small>O MF passa a reconhecer compromissos futuros.</small></span></div>
        <div><i>4</i><span><b>Registre ou importe movimentações</b><small>Revise tudo antes de alterar o saldo.</small></span></div>
      </div>
      <div class="mf-tour-finish-note">O tutorial continua disponível no perfil para consulta manual.</div>
    `,
  },
];

let currentStep = 0;
let legacyHandling = false;
let activeUserId: string | null = null;
let autoOpenTimer: number | null = null;
let resizeHandler: (() => void) | null = null;

function installStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${TUTORIAL_ROOT_ID} {
      position: fixed;
      inset: 0;
      z-index: 2147483000;
      pointer-events: none;
      color: #fff;
      font-family: inherit;
    }
    #${TUTORIAL_ROOT_ID} * { box-sizing: border-box; }
    #${TUTORIAL_ROOT_ID}.mf-tour-centered { pointer-events: auto; background: rgba(0,0,0,.78); backdrop-filter: blur(9px); }
    #${TUTORIAL_ROOT_ID} .mf-tour-spotlight {
      position: fixed;
      z-index: 1;
      border: 2px solid rgba(0,242,255,.95);
      border-radius: 16px;
      box-shadow: 0 0 0 9999px rgba(0,0,0,.76), 0 0 0 6px rgba(0,242,255,.10), 0 0 38px rgba(0,242,255,.45);
      pointer-events: none;
      transition: top .34s cubic-bezier(.2,.8,.2,1), left .34s cubic-bezier(.2,.8,.2,1), width .34s cubic-bezier(.2,.8,.2,1), height .34s cubic-bezier(.2,.8,.2,1), opacity .2s ease;
      animation: mfTourPulse 1.9s ease-in-out infinite;
    }
    #${TUTORIAL_ROOT_ID}.mf-tour-centered .mf-tour-spotlight { display: none; }
    #${TUTORIAL_ROOT_ID} .mf-tour-panel {
      position: fixed;
      z-index: 3;
      width: min(490px, calc(100vw - 32px));
      max-height: calc(100vh - 32px);
      overflow: hidden;
      border: 1px solid rgba(255,255,255,.14);
      border-radius: 24px;
      background: linear-gradient(155deg, rgba(17,17,21,.98), rgba(7,7,9,.98));
      box-shadow: 0 28px 90px rgba(0,0,0,.72), 0 0 0 1px rgba(0,242,255,.03) inset;
      pointer-events: auto;
      animation: mfTourPanelIn .34s cubic-bezier(.2,.8,.2,1) both;
    }
    #${TUTORIAL_ROOT_ID}.mf-tour-centered .mf-tour-panel {
      left: 50%;
      top: 50%;
      transform: translate(-50%,-50%);
      width: min(650px, calc(100vw - 32px));
    }
    #${TUTORIAL_ROOT_ID} .mf-tour-header { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; padding:20px 20px 14px; border-bottom:1px solid rgba(255,255,255,.07); }
    #${TUTORIAL_ROOT_ID} .mf-tour-eyebrow { display:block; margin-bottom:6px; color:#00f2ff; font-size:10px; font-weight:950; letter-spacing:.13em; text-transform:uppercase; }
    #${TUTORIAL_ROOT_ID} h2 { margin:0; font-size:clamp(20px,3vw,27px); line-height:1.12; letter-spacing:-.02em; }
    #${TUTORIAL_ROOT_ID} .mf-tour-description { margin:8px 0 0; max-width:560px; color:rgba(255,255,255,.58); font-size:12px; line-height:1.58; }
    #${TUTORIAL_ROOT_ID} .mf-tour-close { flex:0 0 auto; display:grid; place-items:center; width:38px; height:38px; border:1px solid rgba(255,255,255,.12); border-radius:12px; background:rgba(255,255,255,.05); color:#fff; cursor:pointer; font-size:21px; }
    #${TUTORIAL_ROOT_ID} .mf-tour-close:hover { border-color:rgba(0,242,255,.35); background:rgba(0,242,255,.08); }
    #${TUTORIAL_ROOT_ID} .mf-tour-body { min-height:210px; max-height:430px; overflow-y:auto; padding:19px 20px; }
    #${TUTORIAL_ROOT_ID} .mf-tour-footer { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 20px 18px; border-top:1px solid rgba(255,255,255,.07); }
    #${TUTORIAL_ROOT_ID} .mf-tour-progress { display:flex; align-items:center; gap:5px; flex-wrap:wrap; }
    #${TUTORIAL_ROOT_ID} .mf-tour-progress i { display:block; width:6px; height:6px; border-radius:999px; background:rgba(255,255,255,.16); transition:.25s ease; }
    #${TUTORIAL_ROOT_ID} .mf-tour-progress i.active { width:24px; background:#00f2ff; box-shadow:0 0 14px rgba(0,242,255,.35); }
    #${TUTORIAL_ROOT_ID} .mf-tour-actions { display:flex; justify-content:flex-end; align-items:center; gap:7px; flex-wrap:wrap; }
    #${TUTORIAL_ROOT_ID} button { font-family:inherit; }
    #${TUTORIAL_ROOT_ID} .mf-tour-secondary, #${TUTORIAL_ROOT_ID} .mf-tour-primary { border-radius:12px; padding:10px 13px; cursor:pointer; font-size:10px; font-weight:950; letter-spacing:.02em; transition:.18s ease; }
    #${TUTORIAL_ROOT_ID} .mf-tour-secondary { border:1px solid rgba(255,255,255,.12); background:rgba(255,255,255,.04); color:#fff; }
    #${TUTORIAL_ROOT_ID} .mf-tour-secondary:hover { background:rgba(255,255,255,.09); }
    #${TUTORIAL_ROOT_ID} .mf-tour-primary { border:1px solid #00f2ff; background:#00f2ff; color:#050505; box-shadow:0 8px 24px rgba(0,242,255,.12); }
    #${TUTORIAL_ROOT_ID} .mf-tour-primary:hover { transform:translateY(-1px); box-shadow:0 10px 30px rgba(0,242,255,.22); }
    #${TUTORIAL_ROOT_ID} .mf-tour-center-copy { max-width:520px; margin:8px auto 0; text-align:center; color:rgba(255,255,255,.58); font-size:12px; line-height:1.65; }
    #${TUTORIAL_ROOT_ID} .mf-tour-center-copy strong { color:#fff; }
    #${TUTORIAL_ROOT_ID} .mf-tour-welcome-visual { position:relative; width:min(360px,100%); height:190px; margin:0 auto 10px; display:grid; place-items:center; }
    #${TUTORIAL_ROOT_ID} .mf-tour-logo { position:relative; z-index:3; display:grid; place-items:center; width:82px; height:82px; border-radius:27px; border:1px solid rgba(0,242,255,.35); background:linear-gradient(145deg,rgba(0,242,255,.18),rgba(0,242,255,.04)); color:#00f2ff; font-size:27px; font-weight:1000; box-shadow:0 0 50px rgba(0,242,255,.18); animation:mfTourLogoFloat 2.8s ease-in-out infinite; }
    #${TUTORIAL_ROOT_ID} .mf-tour-orbit { position:absolute; border:1px solid rgba(0,242,255,.14); border-radius:50%; animation:mfTourSpin 12s linear infinite; }
    #${TUTORIAL_ROOT_ID} .orbit-a { width:170px; height:170px; }
    #${TUTORIAL_ROOT_ID} .orbit-b { width:250px; height:120px; animation-duration:16s; animation-direction:reverse; }
    #${TUTORIAL_ROOT_ID} .mf-tour-float-card { position:absolute; z-index:4; display:grid; gap:2px; min-width:104px; padding:9px 11px; border:1px solid rgba(255,255,255,.1); border-radius:12px; background:rgba(15,15,18,.92); box-shadow:0 14px 34px rgba(0,0,0,.38); animation:mfTourCardFloat 3.2s ease-in-out infinite; }
    #${TUTORIAL_ROOT_ID} .mf-tour-float-card span { color:rgba(255,255,255,.4); font-size:9px; text-transform:uppercase; font-weight:900; }
    #${TUTORIAL_ROOT_ID} .mf-tour-float-card b { font-size:11px; }
    #${TUTORIAL_ROOT_ID} .card-a { left:0; top:25px; }
    #${TUTORIAL_ROOT_ID} .card-b { right:0; top:22px; animation-delay:.55s; }
    #${TUTORIAL_ROOT_ID} .card-c { right:22px; bottom:9px; animation-delay:1.05s; }
    #${TUTORIAL_ROOT_ID} .mf-tour-demo-grid { display:grid; gap:9px; }
    #${TUTORIAL_ROOT_ID} .mf-tour-demo-grid.four { grid-template-columns:repeat(2,minmax(0,1fr)); }
    #${TUTORIAL_ROOT_ID} .mf-tour-demo-grid.three { grid-template-columns:repeat(3,minmax(0,1fr)); }
    #${TUTORIAL_ROOT_ID} .mf-tour-demo-grid article { position:relative; overflow:hidden; min-height:98px; padding:13px; border:1px solid rgba(255,255,255,.09); border-radius:15px; background:rgba(255,255,255,.035); animation:mfTourItemIn .36s ease both; }
    #${TUTORIAL_ROOT_ID} .mf-tour-demo-grid article::after { content:''; position:absolute; left:0; bottom:0; width:58%; height:2px; background:linear-gradient(90deg,#00f2ff,transparent); animation:mfTourScan 2.4s ease-in-out infinite; }
    #${TUTORIAL_ROOT_ID} .mf-tour-demo-grid span { display:block; margin-bottom:7px; color:#00f2ff; font-size:9px; font-weight:950; text-transform:uppercase; }
    #${TUTORIAL_ROOT_ID} .mf-tour-demo-grid b { display:block; font-size:12px; }
    #${TUTORIAL_ROOT_ID} .mf-tour-demo-grid small { display:block; margin-top:5px; color:rgba(255,255,255,.43); font-size:9px; line-height:1.4; }
    #${TUTORIAL_ROOT_ID} .mf-tour-flow-demo { display:grid; gap:9px; }
    #${TUTORIAL_ROOT_ID} .mf-tour-flow-row { display:grid; grid-template-columns:34px 1fr auto; align-items:center; gap:10px; padding:11px 12px; border:1px solid rgba(255,255,255,.09); border-radius:14px; background:rgba(255,255,255,.03); animation:mfTourFlowIn .38s ease both; }
    #${TUTORIAL_ROOT_ID} .mf-tour-flow-row:nth-child(2){animation-delay:.08s}.mf-tour-flow-row:nth-child(3){animation-delay:.16s}
    #${TUTORIAL_ROOT_ID} .mf-tour-flow-row i { display:grid; place-items:center; width:30px; height:30px; border-radius:10px; background:rgba(0,242,255,.10); color:#00f2ff; font-style:normal; font-weight:1000; }
    #${TUTORIAL_ROOT_ID} .mf-tour-flow-row span { display:grid; gap:3px; }
    #${TUTORIAL_ROOT_ID} .mf-tour-flow-row b { font-size:11px; }
    #${TUTORIAL_ROOT_ID} .mf-tour-flow-row small { color:rgba(255,255,255,.42); font-size:9px; line-height:1.35; }
    #${TUTORIAL_ROOT_ID} .mf-tour-flow-row em { color:rgba(255,255,255,.34); font-size:9px; font-style:normal; text-transform:uppercase; font-weight:900; }
    #${TUTORIAL_ROOT_ID} .mf-tour-card-demo { display:grid; grid-template-columns:1.25fr .75fr; gap:11px; }
    #${TUTORIAL_ROOT_ID} .mf-tour-credit-card { min-height:142px; display:flex; flex-direction:column; justify-content:space-between; padding:17px; border-radius:20px; border:1px solid rgba(0,242,255,.26); background:radial-gradient(circle at 85% 10%,rgba(0,242,255,.20),transparent 40%),linear-gradient(145deg,#12151a,#090a0c); box-shadow:0 18px 45px rgba(0,0,0,.34); animation:mfTourCardTilt 4s ease-in-out infinite; }
    #${TUTORIAL_ROOT_ID} .mf-tour-credit-card span { color:#00f2ff; font-size:10px; font-weight:950; letter-spacing:.14em; }
    #${TUTORIAL_ROOT_ID} .mf-tour-credit-card b { font-size:16px; letter-spacing:.09em; }
    #${TUTORIAL_ROOT_ID} .mf-tour-credit-card small { color:rgba(255,255,255,.42); font-size:9px; }
    #${TUTORIAL_ROOT_ID} .mf-tour-card-stats { display:grid; gap:9px; }
    #${TUTORIAL_ROOT_ID} .mf-tour-card-stats div { display:flex; flex-direction:column; justify-content:center; padding:12px; border:1px solid rgba(255,255,255,.08); border-radius:14px; background:rgba(255,255,255,.03); }
    #${TUTORIAL_ROOT_ID} .mf-tour-card-stats span { color:rgba(255,255,255,.36); font-size:9px; text-transform:uppercase; font-weight:900; }
    #${TUTORIAL_ROOT_ID} .mf-tour-card-stats b { margin-top:4px; font-size:10px; }
    #${TUTORIAL_ROOT_ID} .mf-tour-income-demo { padding:8px 2px 2px; }
    #${TUTORIAL_ROOT_ID} .mf-tour-payday { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:11px 13px; border:1px solid rgba(255,255,255,.09); border-radius:14px; background:rgba(255,255,255,.03); }
    #${TUTORIAL_ROOT_ID} .mf-tour-payday span { color:#00f2ff; font-size:10px; font-weight:950; text-transform:uppercase; }
    #${TUTORIAL_ROOT_ID} .mf-tour-payday b { font-size:11px; }
    #${TUTORIAL_ROOT_ID} .mf-tour-payline { height:37px; position:relative; margin-left:24px; }
    #${TUTORIAL_ROOT_ID} .mf-tour-payline::before { content:''; position:absolute; left:0; top:0; bottom:0; width:2px; background:rgba(0,242,255,.18); }
    #${TUTORIAL_ROOT_ID} .mf-tour-payline i { position:absolute; left:-3px; top:0; width:8px; height:8px; border-radius:50%; background:#00f2ff; box-shadow:0 0 14px rgba(0,242,255,.7); animation:mfTourPayMove 1.8s ease-in-out infinite; }
    #${TUTORIAL_ROOT_ID} .mf-tour-income-tags { display:flex; gap:6px; flex-wrap:wrap; margin-top:12px; }
    #${TUTORIAL_ROOT_ID} .mf-tour-income-tags span { padding:7px 9px; border-radius:999px; border:1px solid rgba(0,242,255,.17); background:rgba(0,242,255,.06); color:rgba(255,255,255,.66); font-size:9px; font-weight:850; }
    #${TUTORIAL_ROOT_ID} .mf-tour-analysis-demo { display:grid; grid-template-columns:1fr 1.15fr; gap:12px; align-items:stretch; }
    #${TUTORIAL_ROOT_ID} .mf-tour-bars { min-height:150px; display:flex; align-items:flex-end; gap:7px; padding:16px 13px 12px; border:1px solid rgba(255,255,255,.08); border-radius:16px; background:rgba(255,255,255,.025); }
    #${TUTORIAL_ROOT_ID} .mf-tour-bars i { flex:1; min-width:7px; border-radius:6px 6px 2px 2px; background:linear-gradient(180deg,#00f2ff,rgba(0,242,255,.16)); transform-origin:bottom; animation:mfTourBarGrow .8s cubic-bezier(.2,.8,.2,1) both; }
    #${TUTORIAL_ROOT_ID} .mf-tour-bars i:nth-child(2){animation-delay:.06s}.mf-tour-bars i:nth-child(3){animation-delay:.12s}.mf-tour-bars i:nth-child(4){animation-delay:.18s}.mf-tour-bars i:nth-child(5){animation-delay:.24s}.mf-tour-bars i:nth-child(6){animation-delay:.30s}
    #${TUTORIAL_ROOT_ID} .mf-tour-analysis-list { display:grid; gap:7px; }
    #${TUTORIAL_ROOT_ID} .mf-tour-analysis-list span { display:grid; gap:2px; padding:9px 10px; border:1px solid rgba(255,255,255,.08); border-radius:12px; background:rgba(255,255,255,.025); }
    #${TUTORIAL_ROOT_ID} .mf-tour-analysis-list b { font-size:10px; }
    #${TUTORIAL_ROOT_ID} .mf-tour-analysis-list small { color:rgba(255,255,255,.4); font-size:8.5px; }
    #${TUTORIAL_ROOT_ID} .mf-tour-checklist { display:grid; gap:8px; }
    #${TUTORIAL_ROOT_ID} .mf-tour-checklist > div { display:flex; align-items:center; gap:11px; padding:11px 12px; border:1px solid rgba(255,255,255,.08); border-radius:14px; background:rgba(255,255,255,.03); animation:mfTourFlowIn .35s ease both; }
    #${TUTORIAL_ROOT_ID} .mf-tour-checklist > div:nth-child(2){animation-delay:.06s}.mf-tour-checklist > div:nth-child(3){animation-delay:.12s}.mf-tour-checklist > div:nth-child(4){animation-delay:.18s}
    #${TUTORIAL_ROOT_ID} .mf-tour-checklist i { display:grid; place-items:center; flex:0 0 auto; width:29px; height:29px; border-radius:999px; background:rgba(0,242,255,.11); color:#00f2ff; font-size:10px; font-style:normal; font-weight:950; }
    #${TUTORIAL_ROOT_ID} .mf-tour-checklist span { display:grid; gap:3px; }
    #${TUTORIAL_ROOT_ID} .mf-tour-checklist b { font-size:11px; }
    #${TUTORIAL_ROOT_ID} .mf-tour-checklist small { color:rgba(255,255,255,.43); font-size:9px; }
    #${TUTORIAL_ROOT_ID} .mf-tour-finish-note { margin-top:11px; padding:10px 11px; border:1px solid rgba(0,242,255,.16); border-radius:12px; background:rgba(0,242,255,.06); color:rgba(255,255,255,.53); font-size:9px; }
    .mf-tour-active-target { position:relative !important; z-index:2147483002 !important; }
    @keyframes mfTourPulse { 0%,100%{box-shadow:0 0 0 9999px rgba(0,0,0,.76),0 0 0 5px rgba(0,242,255,.08),0 0 26px rgba(0,242,255,.32)} 50%{box-shadow:0 0 0 9999px rgba(0,0,0,.76),0 0 0 9px rgba(0,242,255,.12),0 0 44px rgba(0,242,255,.5)} }
    @keyframes mfTourPanelIn { from{opacity:0;transform:translateY(10px) scale(.98)} to{opacity:1;transform:translateY(0) scale(1)} }
    #${TUTORIAL_ROOT_ID}.mf-tour-centered .mf-tour-panel { animation-name:mfTourPanelCenterIn; }
    @keyframes mfTourPanelCenterIn { from{opacity:0;transform:translate(-50%,-47%) scale(.97)} to{opacity:1;transform:translate(-50%,-50%) scale(1)} }
    @keyframes mfTourLogoFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-7px)} }
    @keyframes mfTourSpin { to{transform:rotate(360deg)} }
    @keyframes mfTourCardFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
    @keyframes mfTourItemIn { from{opacity:0;transform:translateY(7px)} to{opacity:1;transform:none} }
    @keyframes mfTourFlowIn { from{opacity:0;transform:translateX(-8px)} to{opacity:1;transform:none} }
    @keyframes mfTourScan { 0%,100%{transform:translateX(-30%);opacity:.35} 50%{transform:translateX(115%);opacity:1} }
    @keyframes mfTourCardTilt { 0%,100%{transform:perspective(500px) rotateY(0deg)} 50%{transform:perspective(500px) rotateY(-4deg) translateY(-2px)} }
    @keyframes mfTourPayMove { 0%{top:0;opacity:.2} 50%{opacity:1} 100%{top:29px;opacity:.2} }
    @keyframes mfTourBarGrow { from{transform:scaleY(.05);opacity:.25} to{transform:scaleY(1);opacity:1} }
    @media (prefers-reduced-motion: reduce) {
      #${TUTORIAL_ROOT_ID} *, #${TUTORIAL_ROOT_ID} *::before, #${TUTORIAL_ROOT_ID} *::after { animation-duration:.01ms !important; animation-iteration-count:1 !important; transition-duration:.01ms !important; }
    }
    @media (max-width: 720px) {
      #${TUTORIAL_ROOT_ID} .mf-tour-panel, #${TUTORIAL_ROOT_ID}.mf-tour-centered .mf-tour-panel { left:8px !important; right:8px !important; top:auto !important; bottom:8px !important; width:auto !important; transform:none !important; max-height:calc(100vh - 16px); border-radius:22px 22px 12px 12px; }
      #${TUTORIAL_ROOT_ID}.mf-tour-centered .mf-tour-panel { animation-name:mfTourPanelIn; }
      #${TUTORIAL_ROOT_ID} .mf-tour-header { padding:16px 15px 12px; }
      #${TUTORIAL_ROOT_ID} .mf-tour-body { min-height:170px; max-height:48vh; padding:15px; }
      #${TUTORIAL_ROOT_ID} .mf-tour-footer { padding:12px 15px 14px; align-items:flex-end; }
      #${TUTORIAL_ROOT_ID} .mf-tour-demo-grid.three, #${TUTORIAL_ROOT_ID} .mf-tour-demo-grid.four { grid-template-columns:1fr 1fr; }
      #${TUTORIAL_ROOT_ID} .mf-tour-card-demo, #${TUTORIAL_ROOT_ID} .mf-tour-analysis-demo { grid-template-columns:1fr; }
      #${TUTORIAL_ROOT_ID} .mf-tour-credit-card { min-height:112px; }
      #${TUTORIAL_ROOT_ID} .mf-tour-bars { min-height:105px; }
      #${TUTORIAL_ROOT_ID} .mf-tour-welcome-visual { height:165px; }
      #${TUTORIAL_ROOT_ID} .card-a { left:4px; }.mf-tour-float-card.card-b{right:4px}.mf-tour-float-card.card-c{right:20px}
      #${TUTORIAL_ROOT_ID} .mf-tour-actions { gap:5px; }
      #${TUTORIAL_ROOT_ID} .mf-tour-secondary, #${TUTORIAL_ROOT_ID} .mf-tour-primary { padding:9px 10px; }
    }
    @media (max-width: 430px) {
      #${TUTORIAL_ROOT_ID} .mf-tour-progress { display:none; }
      #${TUTORIAL_ROOT_ID} .mf-tour-footer { justify-content:flex-end; }
      #${TUTORIAL_ROOT_ID} .mf-tour-demo-grid.three, #${TUTORIAL_ROOT_ID} .mf-tour-demo-grid.four { grid-template-columns:1fr; }
      #${TUTORIAL_ROOT_ID} .mf-tour-flow-row { grid-template-columns:32px 1fr; }
      #${TUTORIAL_ROOT_ID} .mf-tour-flow-row em { display:none; }
    }
  `;
  document.head.appendChild(style);
}

function dismissedLocally(userId: string | null) {
  try {
    const key = userId ? `${DISMISSED_PREFIX}${userId}` : `${DISMISSED_PREFIX}pending`;
    return localStorage.getItem(key) === '1' || sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

async function markSeen() {
  try {
    const userId = activeUserId || (await supabase.auth.getUser()).data.user?.id || null;
    if (!userId) return;
    await supabase
      .from('mf_user_settings')
      .update({ onboarding_seen: true })
      .eq('user_id', userId);
  } catch {
    // Closing must never depend on the network.
  }
}

function clearHighlightedTarget() {
  document.querySelectorAll<HTMLElement>('.mf-tour-active-target').forEach((element) => {
    element.classList.remove('mf-tour-active-target');
  });
}

function findNavTarget(label: string | undefined): HTMLElement | null {
  if (!label) return null;
  const wanted = normalize(label);
  const simpleButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('#mf-simple-navigation-root button'));
  const exact = simpleButtons.find((button) => normalize(button.textContent) === wanted);
  if (exact) return exact;
  return simpleButtons.find((button) => normalize(button.textContent).includes(wanted)) || null;
}

function navigateToStep(step: TutorialStep) {
  if (!step.navLabel) return;
  const target = findNavTarget(step.navLabel);
  if (target instanceof HTMLButtonElement) {
    try { target.click(); } catch { /* visual tour can continue even if navigation is unavailable */ }
  }
}

function placePanelAndSpotlight() {
  const root = document.getElementById(TUTORIAL_ROOT_ID);
  if (!root) return;
  const step = steps[currentStep] || steps[0];
  const target = findNavTarget(step.navLabel);
  const spotlight = root.querySelector<HTMLElement>('.mf-tour-spotlight');
  const panel = root.querySelector<HTMLElement>('.mf-tour-panel');
  if (!spotlight || !panel) return;

  clearHighlightedTarget();

  if (!target || !step.navLabel) {
    root.classList.add('mf-tour-centered');
    spotlight.style.opacity = '0';
    panel.style.left = '';
    panel.style.top = '';
    return;
  }

  root.classList.remove('mf-tour-centered');
  target.classList.add('mf-tour-active-target');
  const rect = target.getBoundingClientRect();
  const pad = 7;
  spotlight.style.opacity = '1';
  spotlight.style.left = `${Math.max(4, rect.left - pad)}px`;
  spotlight.style.top = `${Math.max(4, rect.top - pad)}px`;
  spotlight.style.width = `${Math.min(window.innerWidth - 8, rect.width + pad * 2)}px`;
  spotlight.style.height = `${Math.min(window.innerHeight - 8, rect.height + pad * 2)}px`;

  if (window.innerWidth <= 720) return;

  const panelWidth = Math.min(490, window.innerWidth - 48);
  const measuredHeight = Math.max(300, panel.getBoundingClientRect().height || 430);
  const left = Math.min(Math.max(24, rect.left), Math.max(24, window.innerWidth - panelWidth - 24));
  let top = rect.bottom + 22;
  if (top + measuredHeight > window.innerHeight - 20) {
    top = Math.max(20, rect.top - measuredHeight - 20);
  }
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

function closeTutorial(markAsSeen = true) {
  if (autoOpenTimer !== null) {
    window.clearTimeout(autoOpenTimer);
    autoOpenTimer = null;
  }
  clearHighlightedTarget();
  document.getElementById(TUTORIAL_ROOT_ID)?.remove();
  document.removeEventListener('keydown', handleKeydown);
  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler);
    window.removeEventListener('scroll', resizeHandler, true);
    resizeHandler = null;
  }
  document.documentElement.style.removeProperty('overflow');
  if (markAsSeen) void markSeen();
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeTutorial(true);
  if (event.key === 'ArrowRight') nextStep();
  if (event.key === 'ArrowLeft') previousStep();
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
  const home = findNavTarget('Início');
  if (home instanceof HTMLButtonElement) {
    try { home.click(); } catch { /* no-op */ }
  }
}

function renderStep(navigate = false) {
  const root = document.getElementById(TUTORIAL_ROOT_ID);
  if (!root) return;
  const step = steps[currentStep] || steps[0];

  if (navigate) navigateToStep(step);

  root.innerHTML = `
    <div class="mf-tour-spotlight" aria-hidden="true"></div>
    <section class="mf-tour-panel" role="dialog" aria-modal="true" aria-labelledby="mf-safe-tutorial-title">
      <header class="mf-tour-header">
        <div>
          <span class="mf-tour-eyebrow">${step.eyebrow}</span>
          <h2 id="mf-safe-tutorial-title">${step.title}</h2>
          <p class="mf-tour-description">${step.description}</p>
        </div>
        <button type="button" class="mf-tour-close" data-action="close" aria-label="Pular e fechar tutorial">×</button>
      </header>
      <div class="mf-tour-body">${step.visual}</div>
      <footer class="mf-tour-footer">
        <div class="mf-tour-progress" aria-label="Progresso do tutorial">
          ${steps.map((_, index) => `<i class="${index === currentStep ? 'active' : ''}"></i>`).join('')}
        </div>
        <div class="mf-tour-actions">
          <button type="button" class="mf-tour-secondary" data-action="skip">Pular tutorial</button>
          ${currentStep > 0 ? '<button type="button" class="mf-tour-secondary" data-action="back">Voltar</button>' : ''}
          <button type="button" class="mf-tour-primary" data-action="next">${currentStep === steps.length - 1 ? 'Concluir' : currentStep === 0 ? 'Começar tour' : 'Próximo'}</button>
        </div>
      </footer>
    </section>
  `;

  root.querySelector<HTMLElement>('[data-action="close"]')?.addEventListener('click', () => closeTutorial(true));
  root.querySelector<HTMLElement>('[data-action="skip"]')?.addEventListener('click', () => closeTutorial(true));
  root.querySelector<HTMLElement>('[data-action="back"]')?.addEventListener('click', previousStep);
  root.querySelector<HTMLElement>('[data-action="next"]')?.addEventListener('click', nextStep);

  window.setTimeout(placePanelAndSpotlight, navigate ? 260 : 40);
  window.setTimeout(placePanelAndSpotlight, navigate ? 520 : 160);
}

function openTutorial() {
  installStyle();
  closeTutorial(false);
  currentStep = 0;

  const root = document.createElement('div');
  root.id = TUTORIAL_ROOT_ID;
  root.className = 'mf-tour-centered';
  document.body.appendChild(root);
  document.documentElement.style.overflow = 'hidden';
  document.addEventListener('keydown', handleKeydown);

  resizeHandler = () => window.requestAnimationFrame(placePanelAndSpotlight);
  window.addEventListener('resize', resizeHandler);
  window.addEventListener('scroll', resizeHandler, true);

  renderStep(false);
}

function findLegacyBackdrop(title: string) {
  const target = normalize(title);
  return Array.from(document.querySelectorAll<HTMLElement>('.mf-dialog-backdrop')).find((backdrop) =>
    normalize(backdrop.textContent).includes(target),
  ) || null;
}

function closeLegacyDialog(backdrop: HTMLElement) {
  backdrop.style.display = 'none';
  backdrop.style.pointerEvents = 'none';
  try {
    backdrop.querySelector<HTMLButtonElement>('.mf-dialog-header button')?.click();
  } catch {
    // Removing the obsolete portal is enough to recover the page.
  }
  backdrop.remove();
}

function removeBrokenBackdrop() {
  document.querySelectorAll<HTMLElement>('.mf-dialog-backdrop').forEach((backdrop) => {
    const dialog = backdrop.querySelector<HTMLElement>('.mf-dialog');
    if (!dialog) {
      backdrop.remove();
      return;
    }
    const rect = dialog.getBoundingClientRect();
    if (rect.width < 160 || rect.height < 100) {
      backdrop.style.display = 'none';
      backdrop.style.pointerEvents = 'none';
    }
  });
}

function rescueLegacyTutorial() {
  if (legacyHandling || document.getElementById(TUTORIAL_ROOT_ID)) return;
  const legacyTutorial = findLegacyBackdrop(LEGACY_TUTORIAL_TITLE);
  if (!legacyTutorial) return;

  legacyHandling = true;
  closeLegacyDialog(legacyTutorial);
  window.setTimeout(() => {
    openTutorial();
    legacyHandling = false;
  }, 40);
}

async function maybeOpenForNewUser() {
  try {
    const { data } = await supabase.auth.getUser();
    const userId = data.user?.id || null;
    activeUserId = userId;
    if (!userId || dismissedLocally(userId) || document.getElementById(TUTORIAL_ROOT_ID)) return;

    const { data: settings } = await supabase
      .from('mf_user_settings')
      .select('onboarding_seen')
      .eq('user_id', userId)
      .maybeSingle();

    if (!settings || settings.onboarding_seen === true || dismissedLocally(userId)) return;

    if (autoOpenTimer !== null) window.clearTimeout(autoOpenTimer);
    autoOpenTimer = window.setTimeout(() => {
      autoOpenTimer = null;
      if (!document.getElementById(TUTORIAL_ROOT_ID) && !dismissedLocally(userId)) openTutorial();
    }, 650);
  } catch {
    // The legacy onboarding can still trigger the same safe tour as a fallback.
  }
}

function mountSafeTutorial() {
  installStyle();

  supabase.auth.getUser().then(({ data }) => {
    activeUserId = data.user?.id || null;
    void maybeOpenForNewUser();
  }).catch(() => undefined);

  supabase.auth.onAuthStateChange((_event, session) => {
    activeUserId = session?.user?.id || null;
    if (activeUserId) void maybeOpenForNewUser();
  });

  const observer = new MutationObserver(() => {
    rescueLegacyTutorial();
    window.setTimeout(removeBrokenBackdrop, 500);
    if (document.getElementById(TUTORIAL_ROOT_ID)) window.setTimeout(placePanelAndSpotlight, 80);
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
  document.addEventListener('DOMContentLoaded', mountSafeTutorial, { once: true });
} else {
  mountSafeTutorial();
}

export {};
