export interface PdfPasswordPromptOptions {
  fileName?: string;
  incorrect?: boolean;
}

let activePrompt: Promise<string | null> | null = null;

export function requestPdfPassword(options: PdfPasswordPromptOptions = {}): Promise<string | null> {
  if (activePrompt) return activePrompt;

  activePrompt = new Promise<string | null>((resolve) => {
    const existing = document.getElementById('mf-pdf-password-modal');
    existing?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'mf-pdf-password-modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'mf-pdf-password-title');
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:2147483600',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'padding:20px',
      'background:rgba(0,0,0,.76)',
      'backdrop-filter:blur(8px)'
    ].join(';');

    const panel = document.createElement('div');
    panel.style.cssText = [
      'width:min(440px,100%)',
      'border:1px solid rgba(255,255,255,.12)',
      'border-radius:20px',
      'padding:22px',
      'background:#151515',
      'color:#fff',
      'box-shadow:0 24px 80px rgba(0,0,0,.55)',
      'font-family:inherit'
    ].join(';');

    const badge = document.createElement('div');
    badge.textContent = 'PDF PROTEGIDO';
    badge.style.cssText = 'display:inline-flex;padding:5px 9px;border-radius:999px;background:rgba(168,85,247,.16);color:#c084fc;font-size:10px;font-weight:800;letter-spacing:.12em;margin-bottom:12px';

    const title = document.createElement('h3');
    title.id = 'mf-pdf-password-title';
    title.textContent = options.incorrect ? 'Senha incorreta' : 'Este extrato precisa de senha';
    title.style.cssText = 'margin:0;font-size:20px;line-height:1.25;font-weight:800';

    const description = document.createElement('p');
    description.textContent = options.incorrect
      ? 'A senha informada não abriu o PDF. Confira a senha do extrato e tente novamente.'
      : 'Digite a senha usada para abrir este PDF. Ela será usada somente nesta leitura e não será salva.';
    description.style.cssText = 'margin:9px 0 0;color:rgba(255,255,255,.62);font-size:13px;line-height:1.55';

    const fileLabel = document.createElement('div');
    fileLabel.textContent = options.fileName ? `Arquivo: ${options.fileName}` : 'Arquivo PDF protegido';
    fileLabel.style.cssText = 'margin-top:14px;padding:9px 11px;border-radius:10px;background:rgba(255,255,255,.05);color:rgba(255,255,255,.55);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';

    const form = document.createElement('form');
    form.style.cssText = 'margin-top:16px';

    const label = document.createElement('label');
    label.textContent = 'Senha do PDF';
    label.style.cssText = 'display:block;margin-bottom:7px;color:rgba(255,255,255,.72);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em';

    const inputWrap = document.createElement('div');
    inputWrap.style.cssText = 'display:flex;align-items:center;gap:8px';

    const input = document.createElement('input');
    input.type = 'password';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = 'Digite a senha';
    input.style.cssText = 'flex:1;min-width:0;height:44px;border:1px solid rgba(255,255,255,.14);border-radius:11px;background:#0f0f0f;color:#fff;padding:0 12px;outline:none;font:inherit;font-size:14px';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.textContent = 'Mostrar';
    toggle.style.cssText = 'height:44px;border:1px solid rgba(255,255,255,.12);border-radius:11px;background:rgba(255,255,255,.05);color:rgba(255,255,255,.72);padding:0 12px;cursor:pointer;font-size:11px;font-weight:700';
    toggle.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.textContent = show ? 'Ocultar' : 'Mostrar';
      input.focus();
    });

    const error = document.createElement('div');
    error.style.cssText = 'min-height:18px;margin-top:7px;color:#fca5a5;font-size:11px';
    if (options.incorrect) error.textContent = 'Senha incorreta. Tente novamente.';

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;justify-content:flex-end;gap:9px;margin-top:14px';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancelar';
    cancel.style.cssText = 'height:40px;border:1px solid rgba(255,255,255,.12);border-radius:10px;background:transparent;color:rgba(255,255,255,.7);padding:0 15px;cursor:pointer;font-size:12px;font-weight:700';

    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.textContent = 'Abrir PDF';
    submit.style.cssText = 'height:40px;border:0;border-radius:10px;background:#7c3aed;color:#fff;padding:0 17px;cursor:pointer;font-size:12px;font-weight:800';

    const privacy = document.createElement('p');
    privacy.textContent = 'A senha fica apenas na memória durante a abertura deste arquivo e é descartada em seguida.';
    privacy.style.cssText = 'margin:15px 0 0;color:rgba(255,255,255,.38);font-size:10px;line-height:1.45';

    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      input.value = '';
      overlay.remove();
      document.removeEventListener('keydown', onKeyDown, true);
      activePrompt = null;
      resolve(value);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(null);
      }
    };

    cancel.addEventListener('click', () => finish(null));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = input.value;
      if (!value) {
        error.textContent = 'Digite a senha do PDF para continuar.';
        input.focus();
        return;
      }
      finish(value);
    });

    inputWrap.append(input, toggle);
    actions.append(cancel, submit);
    form.append(label, inputWrap, error, actions);
    panel.append(badge, title, description, fileLabel, form, privacy);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKeyDown, true);

    window.setTimeout(() => input.focus(), 0);
  });

  return activePrompt;
}
