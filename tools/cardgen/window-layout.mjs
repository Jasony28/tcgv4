// Mise en page "classique" (Commune / Rare) : illustration dans une fenêtre, fond clair aux couleurs du type.
// Rare = fenêtre holographique + cadre argent brillant + étoile ; Commune = mat + rond.
export async function renderWindow({ g, card, art, T, FR, W, H, B, rand, helpers }) {
    const { rr, metal, glyph, energy, title, text, wrap, sparkle } = helpers;
    const RARE = card.rarity === 'Rare';
    const INK = '#1b1e24';
    const dark = (t, x, y, size, opts = {}) => text(t, x, y, size, { color: INK, shadow: false, ...opts });
    const darkTitle = (t, x, y, size, opts = {}) =>
        title(t, x, y, size, { fill: ['#2c3038', '#0c0e12'], stroke: 'rgba(255,255,255,.85)', sw: size * 0.1, glow: null, ...opts });

    // 1) Cadre (argent mat pour commune, brillant pour rare)
    g.save(); rr(0, 0, W, H, 36); g.clip();
    g.fillStyle = RARE ? metal(0, 0, W, H) : metal(0, 0, W, H, ['#e7eaed', '#c3c8ce', '#dfe3e6']); g.fillRect(0, 0, W, H);
    g.restore();

    // 2) Fond du type, avec une texture de rayons légers
    const ix = B, iy = B, iw = W - 2 * B, ih = H - 2 * B;
    g.save(); rr(ix, iy, iw, ih, 22); g.clip();
    const bg = g.createLinearGradient(0, iy, 0, iy + ih);
    bg.addColorStop(0, mix(T.a, '#ffffff', 0.35)); bg.addColorStop(0.5, T.a); bg.addColorStop(1, mix(T.b, T.a, 0.45));
    g.fillStyle = bg; g.fillRect(ix, iy, iw, ih);
    g.globalAlpha = 0.18; g.fillStyle = '#ffffff';
    for (let i = 0; i < 18; i++) { // rayons depuis le haut droit
        const a0 = Math.PI * 0.5 + i * 0.09, a1 = a0 + 0.035;
        g.beginPath(); g.moveTo(W, 0); g.lineTo(W + Math.cos(a0) * 2600, Math.sin(a0) * 2600); g.lineTo(W + Math.cos(a1) * 2600, Math.sin(a1) * 2600); g.fill();
    }
    g.globalAlpha = 1;
    g.restore();
    g.save(); rr(ix, iy, iw, ih, 22); g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 2; g.stroke(); g.restore();

    // 3) En-tête
    g.save(); g.beginPath(); g.moveTo(40, 34); g.lineTo(168, 34); g.lineTo(150, 64); g.lineTo(40, 64); g.closePath();
    g.fillStyle = metal(40, 34, 168, 64, ['#ffffff', '#b8bec5', '#f2f4f6']); g.shadowColor = 'rgba(0,0,0,.3)'; g.shadowBlur = 5; g.fill(); g.restore();
    dark(card.stage || 'BASE', 98, 58, 21, { font: 'BlackItalic', align: 'center' });
    let ns = card.nameSize || 58; g.font = ns + 'px Black';
    while (g.measureText(card.name + (card.suffix ? '  ' + card.suffix : '')).width > 560 && ns > 36) { ns--; g.font = ns + 'px Black'; }
    const nm = darkTitle(card.name, 44, 128, ns);
    if (card.suffix) darkTitle(card.suffix, 44 + nm.w + 12, 128, ns * 0.8, { font: 'BlackItalic' });
    energy(card.type, 856, 92, 34);
    if (card.type2) energy(card.type2, 822, 118, 17);
    const hpR = card.type2 ? 796 : 808;
    const hpm = darkTitle(String(card.hp), hpR, 114, 62, { align: 'right' });
    darkTitle('PV', hpR - hpm.w - 6, 110, 22, { align: 'right' });

    // 4) Fenêtre d'illustration
    const wx = 52, wy = 150, ww = W - 104, wh = card.windowH || 570;
    g.save(); g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 16; g.shadowOffsetY = 6;
    rr(wx - 9, wy - 9, ww + 18, wh + 18, 10); g.fillStyle = RARE ? metal(wx, wy, wx + ww, wy + wh) : metal(wx, wy, wx + ww, wy + wh, ['#d2d6db', '#a7adb4', '#cfd3d8']); g.fill();
    g.restore();
    g.save(); rr(wx, wy, ww, wh, 4); g.clip();
    const sc = Math.max(ww / art.width, wh / art.height) * (card.zoom || 1);
    const dw = art.width * sc, dh = art.height * sc;
    g.drawImage(art, wx + (ww - dw) / 2 + (card.offsetX || 0), wy - (dh - wh) * (card.focusY ?? 0.22), dw, dh);
    if (RARE) { // holo : arc-en-ciel + reflet + quelques éclats
        g.globalCompositeOperation = 'overlay';
        const rb = g.createLinearGradient(wx, wy, wx + ww, wy + wh);
        ['#ff3cac', '#784ba0', '#2b86c5', '#3cffd0', '#fff95b', '#ff3cac'].forEach((col, i, a) => rb.addColorStop(i / (a.length - 1), col));
        g.globalAlpha = 0.32; g.fillStyle = rb; g.fillRect(wx, wy, ww, wh); g.globalAlpha = 1;
        g.globalCompositeOperation = 'screen';
        const sw = g.createLinearGradient(wx, wy, wx + ww, wy + wh);
        sw.addColorStop(0.3, 'rgba(255,255,255,0)'); sw.addColorStop(0.45, 'rgba(255,255,255,.22)'); sw.addColorStop(0.6, 'rgba(255,255,255,0)');
        g.fillStyle = sw; g.fillRect(wx, wy, ww, wh);
        g.globalCompositeOperation = 'source-over';
        for (let i = 0; i < 80; i++) sparkle(wx + rand() * ww, wy + rand() * wh, 1.5 + rand() ** 3 * 7, 0.3 + rand() * 0.5);
    }
    g.restore();
    g.save(); rr(wx, wy, ww, wh, 4); g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 2; g.stroke(); g.restore();

    // 5) Bandeau sous l'illustration : ville + illustrateur
    const by = wy + wh + 14;
    g.save(); g.beginPath(); g.moveTo(170, by); g.lineTo(W - 170, by); g.lineTo(W - 190, by + 34); g.lineTo(190, by + 34); g.closePath();
    g.fillStyle = RARE ? metal(170, by, W - 170, by + 34) : metal(170, by, W - 170, by + 34, ['#eef0f2', '#c9ced3', '#eef0f2']);
    g.shadowColor = 'rgba(0,0,0,.25)'; g.shadowBlur = 5; g.fill(); g.restore();
    dark(`${card.city}  ·  Illus. ${card.illustrator || 'jason'}`, W / 2, by + 25, 20, { font: 'SemiItalic', align: 'center' });

    // 6) Talent + attaques
    const top = by + 50, bottom = 1110;
    const blocks = (card.ability ? 1 : 0) + card.attacks.length;
    const free = bottom - top - estimate();
    const gap = Math.max(0, free / (blocks + 1));
    let y = top + gap + (card.ability ? 30 : -14);
    if (card.ability) {
        g.save(); g.beginPath(); g.moveTo(66, y - 30); g.lineTo(236, y - 30); g.lineTo(218, y + 8); g.lineTo(52, y + 8); g.closePath();
        const rg = g.createLinearGradient(0, y - 30, 0, y + 8); rg.addColorStop(0, '#ff6a5a'); rg.addColorStop(1, '#b3121c');
        g.fillStyle = rg; g.shadowColor = 'rgba(0,0,0,.3)'; g.shadowBlur = 5; g.fill(); g.restore();
        text('Talent', 144, y - 2, 26, { font: 'BlackItalic', align: 'center', shadow: false });
        darkTitle(card.ability.name, 252, y, 34);
        g.save(); g.font = '27px Text'; g.restore();
        y = darkWrap(card.ability.text, 60, y + 44, W - 120, 34, 27) + 24;
        y += gap * 0.5; line(y); y += gap * 0.5;
    }
    for (const atk of card.attacks) {
        y += 44;
        const n = Math.max(3, atk.cost.length);
        atk.cost.forEach((t, i) => energy(t, 82 + i * 50, y - 13, 22));
        const nx = 82 + n * 50 - 10;
        g.font = '52px Black'; const dmgW = g.measureText(String(atk.damage)).width;
        let fs = 38; g.font = `${fs}px Black`;
        while (g.measureText(atk.name).width > W - 64 - dmgW - 24 - nx && fs > 24) { fs--; g.font = `${fs}px Black`; }
        darkTitle(atk.name, nx, y, fs);
        darkTitle(String(atk.damage), W - 64, y + 3, 52, { align: 'right' });
        if (atk.text) y = darkWrap(atk.text, 60, y + 42, W - 120, 34, 27);
        y += gap - 4;
    }

    // 7) Faiblesse / résistance / retraite
    const sy = 1150;
    line(sy - 30); line(sy + 20);
    dark('faiblesse', 66, sy + 2, 21, { font: 'Semi' });
    if (card.weakness) { energy(card.weakness, 186, sy - 6, 14); dark('×2', 206, sy + 2, 21, { font: 'Black' }); }
    dark('résistance', 330, sy + 2, 21, { font: 'Semi' });
    if (card.resistance) { energy(card.resistance, 456, sy - 6, 14); dark('-30', 476, sy + 2, 21, { font: 'Black' }); }
    dark('retraite', 600, sy + 2, 21, { font: 'Semi' });
    for (let i = 0; i < (card.retreat || 0); i++) energy('incolore', 706 + i * 32, sy - 6, 13);

    // 8) Texte d'ambiance + pied de carte
    if (card.flavor) darkWrap(card.flavor, 60, 1210, W - 120, 24, 19, 'SemiItalic');
    const fy = 1258, fx = W - 50;
    if (RARE) glyph('star', fx - 10, fy - 8, 20, INK);
    else { g.save(); g.beginPath(); g.arc(fx - 10, fy - 8, 8, 0, 7); g.fillStyle = INK; g.fill(); g.restore(); }
    dark(card.number, fx - 32, fy, 21, { font: 'Black', align: 'right' });
    g.font = '21px Black'; const numW = g.measureText(card.number).width;
    const hx = fx - 32 - numW - 26, hy = fy - 8;
    g.save(); g.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; g.lineTo(hx + Math.cos(a) * 18, hy + Math.sin(a) * 18); } g.closePath();
    g.fillStyle = INK; g.fill(); g.restore();
    text(card.set || 'V3', hx, hy + 6, 15, { font: 'Black', align: 'center', color: '#fff', shadow: false });

    function estimate() { // hauteur du texte sans les espaces
        let h = 0; g.font = '27px Text';
        const nl = (t) => { let n = 1, l = ''; for (const w of t.split(' ')) { const tt = l ? l + ' ' + w : w; if (g.measureText(tt).width > W - 120 && l) { n++; l = w; } else l = tt; } return n; };
        if (card.ability) h += 44 + nl(card.ability.text) * 34;
        for (const a of card.attacks) h += 44 + (a.text ? 42 + (nl(a.text) - 1) * 34 : 0);
        return h;
    }
    function line(yy) { const lg = g.createLinearGradient(50, 0, W - 50, 0); lg.addColorStop(0, 'rgba(0,0,0,0)'); lg.addColorStop(0.15, 'rgba(0,0,0,.35)'); lg.addColorStop(0.85, 'rgba(0,0,0,.35)'); lg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = lg; g.fillRect(50, yy, W - 100, 2); }
    function darkWrap(t, x, yy, maxW, lh, size, font = 'Text') {
        g.font = `${size}px ${font}`; const lines = []; let l = '';
        for (const w of t.split(' ')) { const tt = l ? l + ' ' + w : w; if (g.measureText(tt).width > maxW && l) { lines.push(l); l = w; } else l = tt; }
        if (l) lines.push(l);
        lines.forEach((s, i) => dark(s, x, yy + i * lh, size, { font }));
        return yy + (lines.length - 1) * lh;
    }
}

function mix(a, b, t) {
    const p = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const A = p(a), Bc = p(b);
    return '#' + A.map((v, i) => Math.round(v + (Bc[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
