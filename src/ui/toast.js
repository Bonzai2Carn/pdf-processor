/**
 * toast.js; lightweight toast notification
 */

let _timer = null;

export function showToast(msg, type = 'info', durationMs = 2500) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast visible' + (type !== 'info' ? ` toast--${type}` : '');
    el.hidden = false;
    clearTimeout(_timer);
    _timer = setTimeout(() => {
        el.classList.remove('visible');
        setTimeout(() => { el.hidden = true; }, 280);
    }, durationMs);
}
