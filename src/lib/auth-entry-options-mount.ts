import { supabase } from './supabase';
import { resolveAuthState } from './access-control';

const STYLE_ID = 'mf-auth-entry-options-style';
const OPTIONS_ID = 'mf-auth-entry-options';
const MODAL_ID = 'mf-auth-email-login-modal';
const ADMIN_LOGIN_PATH = '/admin-login';
const ADMIN_OAUTH_INTENT = 'mf-admin-oauth-intent';
const STORAGE_EMAIL = 'mf-auth-email';

function normalize(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .mf-auth-entry-options{margin-top:16px;padding-top:15px;border-top:1px solid rgba(255,255,255,.08)}
    .mf-auth-entry-label{display:flex;align-items:center;gap:10px;margin-bottom:10px;color:rgba(255,255,255,.32);font-size:9px;font-weight:850;letter-spacing:.12em;text-transform:uppercase}
    .mf-auth-entry-label::before,.mf-auth-entry-label::after{content:'';height:1px;flex:1;background:rgba(255,255,255,.08)}
    .mf-auth-entry-buttons{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .mf-auth-entry-button{min-height:42px;display:flex;align-items:center;justify-content:center;gap:8px;padding:9px 10px;border:1px solid rgba(255,255,255,.1);border-radius:11px;background:rgba(255,255,255,.035);color:rgba(255,255,255,.78);font:800 10px/1 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;cursor:pointer;transition:.16s ease}
    .mf-auth-entry-button:hover{border-color:rgba(0,242,255,.24);background:rgba(0,242,255,.07);color:#fff;transform:translateY(-1px)}
    .mf-auth-entry-button:disabled{opacity:.5;cursor:wait;transform:none}
    .mf-auth-entry-button svg{width:16px;height:16px;flex:0 0 16px}
    .mf-auth-entry-note{min-height:15px;margin-top:8px;text-align:center;color:rgba(255,255,255,.3);font-size:9px;line-height:1.4}
    .mf-auth-email-login-overlay{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:20px;background:rgba(2,5,8,.76);backdrop-filter:blur(14px);animation:mf-auth-email-overlay-in .18s ease both}
    .mf-auth-email-login-card{position:relative;width:min(400px,100%);padding:24px;border:1px solid rgba(255,255,255,.09);border-radius:20px;background:linear-gradient(180deg,rgba(16,21,27,.99),rgba(7,10,14,.995));box-shadow:0 28px 80px rgba(0,0,0,.48);animation:mf-auth-email-card-in .22s cubic-bezier(.22,.8,.2,1) both}
    .mf-auth-email-login-mark{width:46px;height:46px;margin:0 auto 12px;display:grid;place-items:center;border-radius:14px;background:linear-gradient(135deg,#1468ff,#00f2ff 55%,#15d4b3);box-shadow:0 0 28px rgba(0,242,255,.18);color:#031014;font-weight:950;font-size:15px}
    .mf-auth-email-login-card h3{margin:0;text-align:center;color:#fff;font-size:18px;font-weight:900;letter-spacing:-.02em}
    .mf-auth-email-login-card p{margin:5px 0 18px;text-align:center;color:rgba(255,255,255,.38);font-size:10px;line-height:1.5}
    .mf-auth-email-login-field{display:block;margin-top:11px}
    .mf-auth-email-login-field span{display:block;margin:0 0 6px;color:rgba(255,255,255,.55);font-size:10px;font-weight:750}
    .mf-auth-email-login-field input{width:100%;box-sizing:border-box;padding:12px 13px;border:1px solid rgba(255,255,255,.1);border-radius:11px;outline:0;background:rgba(255,255,255,.045);color:#fff;font:500 13px/1.2 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;transition:.15s ease}
    .mf-auth-email-login-field input:focus{border-color:rgba(0,242,255,.45);box-shadow:0 0 0 3px rgba(0,242,255,.07)}
    .mf-auth-email-login-error{display:none;margin-top:11px;padding:9px 10px;border:1px solid rgba(248,113,113,.2);border-radius:9px;background:rgba(248,113,113,.08);color:#fca5a5;font-size:10px;line-height:1.45}
    .mf-auth-email-login-error.show{display:block}
    .mf-auth-email-login-actions{display:grid;grid-template-columns:auto 1fr;gap:8px;margin-top:16px}
    .mf-auth-email-login-actions button{min-height:40px;padding:9px 13px;border-radius:10px;font:850 10px/1 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;cursor:pointer;transition:.15s ease}
    .mf-auth-email-cancel{border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.035);color:rgba(255,255,255,.58)}
    .mf-auth-email-submit{border:0;background:#00f2ff;color:#031014;box-shadow:0 8px 24px rgba(0,242,255,.12)}
    .mf-auth-email-login-actions button:disabled{opacity:.55;cursor:wait}
    @keyframes mf-auth-email-overlay-in{from{opacity:0}to{opacity:1}}
    @keyframes mf-auth-email-card-in{from{opacity:0;transform:translateY(12px) scale(.985)}to{opacity:1;transform:none}}
    @media(max-width:520px){.mf-auth-entry-buttons{grid-template-columns:1fr}.mf-auth-email-login-card{padding:21px}.mf-auth-email-login-actions{grid-template-columns:1fr}}
    @media(prefers-reduced-motion:reduce){.mf-auth-entry-button,.mf-auth-email-login-overlay,.mf-auth-email-login-card{animation:none!important;transition:none!important}}
  `;
  document.head.appendChild(style);
}

function stateMessage(state: Awaited<ReturnType<typeof resolveAuthState>>) {
  if (state === 'pending') return 'Sua solicitação ainda está aguardando aprovação.';
  if (state === 'approved') return 'Seu acesso foi aprovado. Use a tela principal para cadastrar sua senha.';
  if (state === 'confirmation_pending') return 'Sua conta foi criada, mas o e-mail ainda precisa ser confirmado.';
  if (state === 'denied') return 'Esta solicitação de acesso não foi aprovada.';
  if (state === 'new') return 'Este e-mail ainda não possui conta. Solicite acesso na tela principal.';
  return '';
}

function closeEmailModal() {
  document.getElementById(MODAL_ID)?.remove();
}

function openEmailModal() {
  closeEmailModal();

  const overlay = document.createElement('div');
  overlay.id = MODAL_ID;
  overlay.className = 'mf-auth-email-login-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Entrar com e-mail');

  const rememberedEmail = (() => {
    try { return window.localStorage.getItem(STORAGE_EMAIL) || ''; } catch { return ''; }
  })();

  overlay.innerHTML = `
    <form class="mf-auth-email-login-card">
      <div class="mf-auth-email-login-mark" aria-hidden="true">MF</div>
      <h3>Entrar com e-mail</h3>
      <p>Use o e-mail e a senha da sua conta MFinanceiro.</p>
      <label class="mf-auth-email-login-field"><span>E-mail</span><input name="email" type="email" autocomplete="email" required value="${rememberedEmail.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}" placeholder="seu@email.com"></label>
      <label class="mf-auth-email-login-field"><span>Senha</span><input name="password" type="password" autocomplete="current-password" minlength="8" required placeholder="Sua senha"></label>
      <div class="mf-auth-email-login-error" role="alert"></div>
      <div class="mf-auth-email-login-actions">
        <button class="mf-auth-email-cancel" type="button">Voltar</button>
        <button class="mf-auth-email-submit" type="submit">Entrar</button>
      </div>
    </form>
  `;

  const form = overlay.querySelector<HTMLFormElement>('form')!;
  const cancel = overlay.querySelector<HTMLButtonElement>('.mf-auth-email-cancel')!;
  const submit = overlay.querySelector<HTMLButtonElement>('.mf-auth-email-submit')!;
  const emailInput = form.elements.namedItem('email') as HTMLInputElement;
  const passwordInput = form.elements.namedItem('password') as HTMLInputElement;
  const errorBox = overlay.querySelector<HTMLElement>('.mf-auth-email-login-error')!;

  const showError = (message: string) => {
    errorBox.textContent = message;
    errorBox.classList.add('show');
  };

  cancel.addEventListener('click', closeEmailModal);
  overlay.addEventListener('pointerdown', (event) => {
    if (event.target === overlay) closeEmailModal();
  });
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeEmailModal();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.classList.remove('show');
    const normalizedEmail = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value;
    if (!normalizedEmail || !password) return;

    submit.disabled = true;
    cancel.disabled = true;
    submit.textContent = 'Entrando...';

    try {
      const state = await resolveAuthState(normalizedEmail);
      if (state !== 'account') {
        showError(stateMessage(state) || 'Esta conta ainda não está disponível para login.');
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
      if (error) {
        const raw = String(error.message || '').toLowerCase();
        if (raw.includes('invalid login credentials')) showError('E-mail ou senha incorretos.');
        else if (raw.includes('email not confirmed')) showError('Confirme seu e-mail antes de entrar.');
        else showError(String(error.message || 'Não foi possível entrar.'));
        return;
      }

      try { window.localStorage.setItem(STORAGE_EMAIL, normalizedEmail); } catch { /* noop */ }
      closeEmailModal();
    } catch (error: any) {
      showError(String(error?.message || 'Não foi possível entrar agora. Tente novamente.'));
    } finally {
      submit.disabled = false;
      cancel.disabled = false;
      submit.textContent = 'Entrar';
    }
  });

  document.body.appendChild(overlay);
  window.setTimeout(() => (emailInput.value ? passwordInput : emailInput).focus(), 0);
}

async function startAdminGithub(button: HTMLButtonElement, note: HTMLElement) {
  button.disabled = true;
  note.textContent = 'Abrindo o GitHub...';
  try {
    window.sessionStorage.setItem(ADMIN_OAUTH_INTENT, '1');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: `${window.location.origin}${ADMIN_LOGIN_PATH}` },
    });
    if (error) throw error;
  } catch (error: any) {
    try { window.sessionStorage.removeItem(ADMIN_OAUTH_INTENT); } catch { /* noop */ }
    note.textContent = String(error?.message || 'Não foi possível abrir o acesso pelo GitHub.');
    button.disabled = false;
  }
}

function createOptions() {
  const root = document.createElement('div');
  root.id = OPTIONS_ID;
  root.className = 'mf-auth-entry-options';
  root.innerHTML = `
    <div class="mf-auth-entry-label">Já possui acesso?</div>
    <div class="mf-auth-entry-buttons">
      <button type="button" class="mf-auth-entry-button mf-auth-entry-email" aria-label="Entrar com e-mail">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>
        <span>Entrar com e-mail</span>
      </button>
      <button type="button" class="mf-auth-entry-button mf-auth-entry-github" aria-label="Entrar com GitHub">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .9a11.1 11.1 0 0 0-3.51 21.64c.56.1.76-.24.76-.54v-2.1c-3.11.68-3.77-1.32-3.77-1.32-.51-1.3-1.24-1.65-1.24-1.65-1.02-.7.08-.68.08-.68 1.12.08 1.71 1.15 1.71 1.15 1 1.71 2.62 1.22 3.26.93.1-.72.39-1.22.71-1.5-2.48-.28-5.09-1.24-5.09-5.53 0-1.22.44-2.22 1.15-3-.12-.28-.5-1.42.11-2.96 0 0 .94-.3 3.05 1.15A10.6 10.6 0 0 1 12 6.12c.94 0 1.88.13 2.77.37 2.12-1.45 3.05-1.15 3.05-1.15.61 1.54.23 2.68.11 2.96.72.78 1.15 1.78 1.15 3 0 4.3-2.61 5.24-5.1 5.52.4.35.76 1.03.76 2.08V22c0 .3.2.65.77.54A11.1 11.1 0 0 0 12 .9Z"/></svg>
        <span>Entrar com GitHub</span>
      </button>
    </div>
    <div class="mf-auth-entry-note">GitHub é validado como acesso administrativo.</div>
  `;

  const emailButton = root.querySelector<HTMLButtonElement>('.mf-auth-entry-email')!;
  const githubButton = root.querySelector<HTMLButtonElement>('.mf-auth-entry-github')!;
  const note = root.querySelector<HTMLElement>('.mf-auth-entry-note')!;
  emailButton.addEventListener('click', openEmailModal);
  githubButton.addEventListener('click', () => void startAdminGithub(githubButton, note));
  return root;
}

function syncOptions() {
  if (window.location.pathname.replace(/\/+$/, '') === ADMIN_LOGIN_PATH) {
    document.getElementById(OPTIONS_ID)?.remove();
    return;
  }

  const card = document.querySelector<HTMLElement>('.mf-auth-card');
  if (!card) return;
  const title = normalize(card.querySelector('h2')?.textContent);
  const shouldShow = title.includes('solicite seu acesso');

  const existing = document.getElementById(OPTIONS_ID);
  if (!shouldShow) {
    existing?.remove();
    return;
  }
  if (existing && card.contains(existing)) return;

  const form = card.querySelector('form');
  const options = createOptions();
  if (form) form.insertAdjacentElement('afterend', options);
  else card.appendChild(options);
}

function mount() {
  installStyles();
  syncOptions();
  const observer = new MutationObserver(syncOptions);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  window.addEventListener('beforeunload', () => observer.disconnect(), { once: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
else mount();

export {};
