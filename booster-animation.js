// Fichier: booster-animation.js — mise en scène de l'ouverture d'un booster
// 1. Le booster apparaît, tremble ; sa lueur trahit la meilleure rareté à l'intérieur.
// 2. On le touche : il se déchire (flash + étincelles).
// 3. Les cartes, face cachée, se retournent une par une, de la moins rare à la plus rare,
//    avec un effet propre à chaque rareté (la légendaire a droit au grand spectacle).
// 4. Récapitulatif, bouton « Continuer ». Un bouton « Passer » mène directement au récap.

const RARITY_ORDER = ['Commune', 'Rare', 'epique', 'Légendaire'];
const RARITY_LABEL = { 'Commune': 'Commune', 'Rare': 'Rare', 'epique': 'Épique', 'Légendaire': 'Légendaire' };
const rarityKey = (r) => r.replace(/é/g, 'e'); // classe CSS : Commune, Rare, epique, Legendaire
const PACK_CLASS = { classic: '', daily: '', v2: 'v2', daily_v2: 'v2', v3: 'v3', legendary: 'legendary', v3_legendary: 'legendary' };

const wait = (ms) => new Promise(r => setTimeout(r, ms));
import { play, vibrate } from './sfx.js';
const RARITY_SOUND = { 'Commune': 'common', 'Rare': 'rare', 'epique': 'epic', 'Légendaire': 'legendary' };

/** Gerbe de particules centrée dans `host` */
function burst(host, { count = 24, color = '#ffd76a', spread = 220, size = 8 } = {}) {
    const layer = document.createElement('div');
    layer.className = 'fx-particles';
    for (let i = 0; i < count; i++) {
        const p = document.createElement('span');
        const angle = Math.random() * Math.PI * 2;
        const dist = spread * (0.45 + Math.random() * 0.55);
        p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
        p.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
        p.style.setProperty('--s', `${size * (0.5 + Math.random())}px`);
        p.style.setProperty('--c', color);
        p.style.animationDelay = `${Math.random() * 80}ms`;
        layer.appendChild(p);
    }
    host.appendChild(layer);
    setTimeout(() => layer.remove(), 1400);
}

/** Pluie de paillettes dorées sur tout l'écran (légendaire) */
function confetti(host, count = 60) {
    const layer = document.createElement('div');
    layer.className = 'fx-confetti';
    const colors = ['#ffd76a', '#ffc23d', '#fff3c2', '#ff9f1c', '#ffffff'];
    for (let i = 0; i < count; i++) {
        const c = document.createElement('span');
        c.style.left = `${Math.random() * 100}%`;
        c.style.setProperty('--c', colors[i % colors.length]);
        c.style.setProperty('--r', `${Math.random() * 720 - 360}deg`);
        c.style.animationDuration = `${1.6 + Math.random() * 1.4}s`;
        c.style.animationDelay = `${Math.random() * 400}ms`;
        layer.appendChild(c);
    }
    host.appendChild(layer);
    setTimeout(() => layer.remove(), 3600);
}

function flash(host, color = '#ffffff') {
    const f = document.createElement('div');
    f.className = 'fx-flash';
    f.style.setProperty('--c', color);
    host.appendChild(f);
    setTimeout(() => f.remove(), 700);
}

/**
 * Joue toute l'animation. Résout quand le joueur touche « Continuer ».
 * @param {{cards: object[], isNew: boolean[], boosterType: string}} options
 */
export function playBoosterOpening({ cards, isNew, boosterType }) {
    return new Promise((resolve) => {
        // Ordre de révélation : de la moins rare à la plus rare (le suspense monte)
        const order = cards.map((card, i) => ({ card, isNew: isNew[i] }))
            .sort((a, b) => RARITY_ORDER.indexOf(a.card.rarity) - RARITY_ORDER.indexOf(b.card.rarity));
        const best = order[order.length - 1].card.rarity;

        const stage = document.createElement('div');
        stage.className = `booster-stage best-${rarityKey(best)}`;
        stage.innerHTML = `
            <div class="stage-bg"></div>
            <button class="stage-skip" type="button">Passer ⏭</button>
            <div class="stage-hint">Touche le booster pour l'ouvrir</div>
            <div class="stage-pack ${PACK_CLASS[boosterType] || ''}">
                <div class="pack-glow"></div>
                <img class="pack-top" src="assets/booster/booster.webp" alt="">
                <img class="pack-bottom" src="assets/booster/booster.webp" alt="">
            </div>
        `;
        document.body.appendChild(stage);
        document.body.classList.add('stage-open');
        requestAnimationFrame(() => stage.classList.add('visible'));

        const hint = stage.querySelector('.stage-hint');
        const pack = stage.querySelector('.stage-pack');
        let finished = false;

        const finish = () => {
            if (finished) return;
            finished = true;
            showRecap();
        };
        stage.querySelector('.stage-skip').addEventListener('click', (e) => { e.stopPropagation(); finish(); });

        // --- 1 & 2 : ouverture du booster ---
        pack.addEventListener('click', async () => {
            if (pack.classList.contains('opening')) return;
            pack.classList.add('opening');
            hint.textContent = '';
            vibrate(30);
            await wait(650);
            if (finished) return;
            pack.classList.add('torn');
            play('open');
            flash(stage, best === 'Légendaire' ? '#ffe08a' : '#ffffff');
            burst(stage, { count: 30, color: { 'Légendaire': '#ffc23d', 'epique': '#c27bff' }[best] || '#9ccaff', spread: 260 });
            await wait(550);
            if (finished) return;
            pack.remove();
            startCards();
        }, { once: false });

        // --- 3 : révélation carte par carte ---
        let index = 0;
        let busy = false;
        let cardEl = null;

        function buildCard(entry) {
            const el = document.createElement('div');
            el.className = `flip-card rarity-${rarityKey(entry.card.rarity)}`;
            el.innerHTML = `
                <div class="flip-inner">
                    <div class="flip-face flip-back"><img src="assets/card-back/dos.webp" alt=""></div>
                    <div class="flip-face flip-front">
                        <img src="${entry.card.image}" alt="${entry.card.name}">
                        ${entry.isNew ? '<span class="new-ribbon big">Nouvelle !</span>' : ''}
                    </div>
                </div>
                <div class="flip-label"><span class="rarity-chip rarity-${rarityKey(entry.card.rarity)}">${RARITY_LABEL[entry.card.rarity]}</span><strong>${entry.card.name}</strong></div>
            `;
            return el;
        }

        function startCards() {
            stage.insertAdjacentHTML('beforeend', `
                <div class="stage-rays"></div>
                <div class="stage-cards"></div>
                <div class="stage-counter"></div>
                <div class="stage-banner"></div>
            `);
            dealNext();
        }

        function dealNext() {
            const holder = stage.querySelector('.stage-cards');
            stage.querySelector('.stage-counter').textContent = `${index + 1} / ${order.length}`;
            hint.textContent = 'Touche la carte pour la retourner';
            cardEl = buildCard(order[index]);
            cardEl.classList.add('dealing');
            holder.appendChild(cardEl);
            cardEl.addEventListener('click', onCardTap);
        }

        async function onCardTap() {
            if (busy || finished) return;
            busy = true;
            const entry = order[index];
            const rarity = entry.card.rarity;

            if (!cardEl.classList.contains('flipped')) {
                hint.textContent = '';
                // Suspense avant le retournement pour les cartes rares
                if (rarity === 'Légendaire') {
                    cardEl.classList.add('charging', 'charging-gold');
                    play('charge');
                    vibrate([40, 60, 40, 60, 80]);
                    await wait(1100);
                } else if (rarity === 'epique') {
                    cardEl.classList.add('charging', 'charging-purple');
                    play('charge');
                    vibrate(50);
                    await wait(550);
                }
                if (finished) return;
                cardEl.classList.remove('charging', 'charging-gold', 'charging-purple');
                cardEl.classList.add('flipped');
                stage.dataset.reveal = rarityKey(rarity);
                play('flip');
                setTimeout(() => play(RARITY_SOUND[rarity]), 120);
                if (entry.isNew) setTimeout(() => play('newcard'), 450);

                if (rarity === 'Légendaire') {
                    flash(stage, '#ffe08a');
                    burst(stage, { count: 46, color: '#ffc23d', spread: 320, size: 10 });
                    confetti(stage);
                    stage.classList.add('shake');
                    setTimeout(() => stage.classList.remove('shake'), 500);
                    showBanner('LÉGENDAIRE !', 'gold');
                    vibrate([120, 60, 200]);
                } else if (rarity === 'epique') {
                    burst(stage, { count: 30, color: '#c27bff', spread: 240 });
                    showBanner('ÉPIQUE !', 'purple');
                } else if (rarity === 'Rare') {
                    burst(stage, { count: 14, color: '#6db7ff', spread: 160, size: 6 });
                }
                if (entry.isNew) setTimeout(() => burst(stage, { count: 10, color: '#34d985', spread: 120, size: 5 }), 250);
                await wait(rarity === 'Légendaire' ? 900 : 450);
                hint.textContent = index === order.length - 1 ? 'Touche pour voir le récap' : 'Touche pour la carte suivante';
            } else {
                // Carte suivante : l'actuelle s'envole
                cardEl.classList.add('leaving');
                stage.dataset.reveal = '';
                hideBanner();
                await wait(280);
                cardEl.remove();
                index++;
                if (index >= order.length) { busy = false; finish(); return; }
                dealNext();
            }
            busy = false;
        }

        function showBanner(text, tone) {
            const b = stage.querySelector('.stage-banner');
            b.className = `stage-banner show ${tone}`;
            b.textContent = text;
        }
        function hideBanner() {
            const b = stage.querySelector('.stage-banner');
            if (b) b.className = 'stage-banner';
        }

        // --- 4 : récapitulatif ---
        function showRecap() {
            stage.querySelectorAll('.stage-pack, .stage-cards, .stage-counter, .stage-banner, .stage-skip, .stage-rays').forEach(e => e.remove());
            stage.dataset.reveal = '';
            hint.textContent = '';
            const counts = {};
            order.forEach(o => { counts[o.card.rarity] = (counts[o.card.rarity] || 0) + 1; });
            const newCount = order.filter(o => o.isNew).length;
            const chips = RARITY_ORDER.filter(r => counts[r])
                .map(r => `<span class="rarity-chip rarity-${rarityKey(r)}">${counts[r]} ${RARITY_LABEL[r]}${counts[r] > 1 && r !== 'epique' ? 's' : ''}</span>`).join('');
            stage.insertAdjacentHTML('beforeend', `
                <div class="stage-recap">
                    <h3>Booster ouvert !</h3>
                    <div class="recap-chips">${chips}${newCount ? `<span class="rarity-chip new">${newCount} nouvelle${newCount > 1 ? 's' : ''}</span>` : ''}</div>
                    <div class="recap-grid">
                        ${order.map(o => `
                            <div class="card rarity-${rarityKey(o.card.rarity)}">
                                <img class="card-image" src="${o.card.image}" alt="${o.card.name}">
                                ${o.isNew ? '<span class="new-ribbon">Nouvelle</span>' : ''}
                            </div>`).join('')}
                    </div>
                    <button class="recap-button" type="button">Continuer</button>
                </div>
            `);
            if (best === 'Légendaire') confetti(stage, 40);
            stage.querySelector('.recap-button').addEventListener('click', () => {
                stage.classList.remove('visible');
                setTimeout(() => {
                    stage.remove();
                    document.body.classList.remove('stage-open');
                    resolve();
                }, 250);
            });
        }
    });
}
