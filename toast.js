// toast.js
export function showToast(type, message, duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    // Apparition animée
    setTimeout(() => toast.classList.add('toast-show'), 50);
    // Disparition auto
    setTimeout(() => {
        toast.classList.remove('toast-show');
        setTimeout(() => toast.remove(), 400);
    }, duration);
}
// Utilisation : showToast('success', "Carte vendue !") ou showToast('error', "Erreur…")
export function showConfirmDialog({ 
    title = "Confirmation", 
    message = "Êtes-vous sûr ?", 
    confirmText = "Confirmer", 
    cancelText = "Annuler" 
} = {}) {
    return new Promise((resolve) => {
        const modal = document.getElementById('custom-modal');
        const modalTitle = document.getElementById('custom-modal-title');
        const modalMsg = document.getElementById('custom-modal-message');
        const modalActions = document.getElementById('custom-modal-actions');
        const modalClose = document.getElementById('custom-modal-close');
        if (!modal || !modalTitle || !modalMsg || !modalActions || !modalClose) return resolve(false);

        modalTitle.textContent = title;
        modalMsg.textContent = message;

        modalActions.innerHTML = '';
        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = confirmText;
        confirmBtn.onclick = () => { modal.style.display = "none"; resolve(true); };
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = cancelText;
        cancelBtn.className = "cancel";
        cancelBtn.onclick = () => { modal.style.display = "none"; resolve(false); };

        modalActions.appendChild(confirmBtn);
        modalActions.appendChild(cancelBtn);
        modal.style.display = "flex";

        // Fermer par croix ou clic fond
        modalClose.onclick = () => { modal.style.display = "none"; resolve(false); };
        modal.onclick = e => { if (e.target === modal) { modal.style.display = "none"; resolve(false); } };
    });
}
/*
document.getElementById('vendre-btn').addEventListener('click', async () => {
    const ok = await showConfirmDialog({
        title: "Confirmation",
        message: "Vendre Minecraft pour 500 pièces ?",
        confirmText: "Oui, vendre"
    });
    if (ok) {
        // Appelle la logique de vente ici
    }
});

*/