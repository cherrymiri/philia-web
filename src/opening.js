// Opening page, same order as the other loves: kicker, title, subtitle, text, guide, start.
// Starting asks for full screen inside the same click; if the browser refuses, the work starts anyway.
// Full screen only resizes the page, so nothing in the scene is reset by entering or leaving it.
export function setupOpening() {
  const page = document.getElementById('opening');
  const start = document.getElementById('startbtn');
  const fs = document.getElementById('fsbtn');
  const root = document.documentElement;
  const supported = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled) && !!(root.requestFullscreen || root.webkitRequestFullscreen);
  const isOn = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  const enter = () => {
    if (!supported || isOn()) return;
    try {
      const r = root.requestFullscreen ? root.requestFullscreen({ navigationUI: 'hide' }) : root.webkitRequestFullscreen();
      r?.catch?.(() => {});
    } catch { /* stays windowed */ }
  };
  const exit = () => { try { const r = document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen?.(); r?.catch?.(() => {}); } catch { /* already out */ } };
  const sync = () => {
    const on = isOn();
    fs.setAttribute('aria-pressed', String(on));
    fs.setAttribute('aria-label', on ? '전체화면 끝내기' : '전체화면');
  };
  for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(ev, sync);
  fs.addEventListener('click', () => (isOn() ? exit() : enter()));
  start.addEventListener('click', () => {
    if (page.classList.contains('closing')) return;
    enter();
    page.classList.add('closing');
    fs.hidden = !supported;
    setTimeout(() => { page.hidden = true; }, 900);
  });
  document.body.classList.add('has-opening');
}
