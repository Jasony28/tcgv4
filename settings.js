// Fichier: settings.js — fenêtre « Paramètres » (bouton ⚙️ de l'en-tête)
import { getSettings, setSetting, play } from './sfx.js';

export function openSettings() {
    document.getElementById('settings-modal')?.remove();
    const s = getSettings();
    const canVibrate = typeof navigator !== 'undefined' && !!navigator.vibrate;
    const modal = document.createElement('div');
    modal.id = 'settings-modal';
    modal.className = 'settings-overlay';
    modal.innerHTML = `
        <div class="settings-sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div class="settings-head">
                <h3 id="settings-title">⚙️ Paramètres</h3>
                <button class="settings-close" aria-label="Fermer">&times;</button>
            </div>
            <label class="settings-row">
                <span><strong>🔊 Sons</strong><small>Bruitages des boosters, des cartes et des boutons</small></span>
                <input type="checkbox" class="switch" data-key="sound" ${s.sound ? 'checked' : ''}>
            </label>
            <div class="settings-row ${s.sound ? '' : 'disabled'}" id="volume-row">
                <span><strong>Volume</strong></span>
                <input type="range" min="0" max="100" step="5" value="${Math.round(s.volume * 100)}" id="volume-range" aria-label="Volume">
                <button class="profile-btn ghost small" id="sound-test" type="button">Tester</button>
            </div>
            <label class="settings-row">
                <span><strong>📳 Vibrations</strong><small>${canVibrate ? 'Quand une carte rare apparaît' : "Pas disponible sur cet appareil"}</small></span>
                <input type="checkbox" class="switch" data-key="vibration" ${s.vibration ? 'checked' : ''} ${canVibrate ? '' : 'disabled'}>
            </label>
            <label class="settings-row">
                <span><strong>✨ Animation d'ouverture</strong><small>Au lancement de l'application</small></span>
                <input type="checkbox" class="switch" data-key="splash" ${s.splash ? 'checked' : ''}>
            </label>
            <p class="settings-note">Ces réglages sont enregistrés sur cet appareil.</p>
            ${document.getElementById('logout-button') ? '<button class="profile-btn ghost settings-logout" id="settings-logout" type="button">Se déconnecter</button>' : ''}
        </div>`;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    modal.querySelector('.settings-close').onclick = close;
    modal.querySelectorAll('.switch').forEach(input => {
        input.onchange = () => {
            setSetting(input.dataset.key, input.checked);
            if (input.dataset.key === 'sound') {
                modal.querySelector('#volume-row').classList.toggle('disabled', !input.checked);
                if (input.checked) play('success');
            }
        };
    });
    const range = modal.querySelector('#volume-range');
    range.oninput = () => setSetting('volume', Number(range.value) / 100);
    range.onchange = () => play('coins');
    modal.querySelector('#sound-test').onclick = () => play('legendary');
    const logout = modal.querySelector('#settings-logout');
    if (logout) logout.onclick = () => document.getElementById('logout-button')?.click();
}
