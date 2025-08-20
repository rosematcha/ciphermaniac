// Lightweight card modal used for in-place card preview with history integration

export const CardModal = (() => {
  let modal = null;
  let pushed = false;

  function build() {
    modal = document.createElement('div');
    modal.className = 'card-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.style.position = 'fixed';
    modal.style.left = '50%';
    modal.style.top = '50%';
    modal.style.transform = 'translate(-50%,-50%)';
    modal.style.background = 'var(--panel)';
    modal.style.padding = '16px';
    modal.style.borderRadius = '8px';
    modal.style.boxShadow = '0 6px 24px rgba(0,0,0,0.6)';
    modal.style.zIndex = '1200';
    modal.style.minWidth = '260px';

    const title = document.createElement('h3');
    title.className = 'card-modal-title';
    title.style.margin = '0 0 8px 0';
    modal.appendChild(title);

    const body = document.createElement('div');
    body.className = 'card-modal-body';
    body.style.marginBottom = '12px';
    modal.appendChild(body);

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '8px';

    const openFull = document.createElement('a');
    openFull.className = 'card-modal-full';
    openFull.textContent = 'Open full page';
    openFull.href = '#';
    openFull.style.padding = '6px 10px';
    openFull.style.background = 'var(--accent)';
    openFull.style.color = 'white';
    openFull.style.borderRadius = '6px';
    openFull.style.textDecoration = 'none';
    actions.appendChild(openFull);

    const copyLink = document.createElement('button');
    copyLink.type = 'button';
    copyLink.className = 'card-modal-copy';
    copyLink.textContent = 'Copy link';
    copyLink.style.padding = '6px 10px';
    actions.appendChild(copyLink);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'card-modal-close';
    closeBtn.textContent = 'Close';
    closeBtn.style.padding = '6px 10px';
    actions.appendChild(closeBtn);

    modal.appendChild(actions);

    // Backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'card-modal-backdrop';
    backdrop.style.position = 'fixed';
    backdrop.style.left = '0';
    backdrop.style.top = '0';
    backdrop.style.width = '100%';
    backdrop.style.height = '100%';
    backdrop.style.background = 'rgba(0,0,0,0.45)';
    backdrop.style.zIndex = '1100';

    backdrop.addEventListener('click', () => close());
    closeBtn.addEventListener('click', () => close());

    copyLink.addEventListener('click', async () => {
      try {
        const link = modal.dataset.link;
        await navigator.clipboard.writeText(link);
      } catch (e) {
        // ignore
      }
    });

    return { modal, backdrop, title, body, openFull };
  }

  function ensure() {
    if(modal) return modEls;
    modEls = build();
    document.body.appendChild(modEls.backdrop);
    document.body.appendChild(modEls.modal);
    return modEls;
  }

  let modEls = null;

  function open(name, opts = {}){
    const { push = true } = opts;
    const els = ensure();
    els.title.textContent = name;
    els.body.textContent = '';
    els.body.textContent = `Preview for ${name}`;
    const full = `${location.pathname.replace(/index\.html?$/i, 'card.html')}${location.search}#card/${encodeURIComponent(name)}`;
    els.openFull.href = full;
    // set data link for copy
    els.modal.dataset.link = `${location.origin}${full}`;

    els.modal.style.display = '';
    els.backdrop.style.display = '';

    // focus management
    els.modal.focus && els.modal.focus();

    if(push){
      // push hash route
      const newUrl = `${location.pathname}${location.search}#card/${encodeURIComponent(name)}`;
      history.pushState({ modal: true }, '', newUrl);
      pushed = true;
    }
  }

  function close(){
    if(!modEls) return;
    modEls.modal.style.display = 'none';
    modEls.backdrop.style.display = 'none';
    if(pushed){
      // go back to previous history entry which should clear the modal hash
      pushed = false;
      try{ history.back(); }catch{}
    } else {
      // remove hash if present
      const clean = `${location.pathname}${location.search}`;
      history.replaceState(null, '', clean);
    }
  }

  return { open, close };
})();
