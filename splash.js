// Fichier: splash.js — animation d'ouverture de l'application (≈ 4 s, touche l'écran pour passer).
// Script classique (pas un module) placé juste après <body> : l'écran est couvert avant le premier affichage.
// Une fois par lancement (sessionStorage). Si la page change pendant l'animation (connexion → Booster),
// l'animation reprend là où elle en était au lieu de recommencer.
(function () {
    var TOTAL = 4200;          // durée de l'animation (ms), fondu de sortie compris
    var FADE = 500;
    var KEY = 'splash-start';
    var CARDS = ['assets/cards3/V3_010.webp', 'assets/cards3/V3_021.webp', 'assets/cards3/V3_034.webp'];

    var start, now = Date.now();
    try {
        start = Number(sessionStorage.getItem(KEY));
        if (!start) { start = now; sessionStorage.setItem(KEY, String(start)); }
    } catch (e) { start = now; }
    var elapsed = now - start;
    if (elapsed >= TOTAL - FADE) return; // déjà vue pendant ce lancement

    var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

    var css = '' +
        '#splash{position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
        'background:radial-gradient(circle at 50% 42%,#1b2a4f 0%,#0a1224 62%,#05080f 100%);color:#fff;overflow:hidden;' +
        'font-family:"Lilita One","Outfit",system-ui,sans-serif;cursor:pointer;-webkit-tap-highlight-color:transparent;' +
        'animation:sp-out ' + FADE + 'ms ease ' + (TOTAL - FADE) + 'ms forwards}' +
        '#splash .sp-rays{position:absolute;width:160vmax;height:160vmax;left:50%;top:42%;margin:-80vmax 0 0 -80vmax;opacity:0;' +
        'background:repeating-conic-gradient(rgba(255,194,61,.10) 0 6deg,transparent 6deg 18deg);' +
        'animation:sp-fade 900ms ease 200ms forwards,sp-spin 14s linear infinite}' +
        '#splash .sp-stage{position:relative;width:min(78vw,340px);height:min(62vw,270px);perspective:900px}' +
        '#splash .sp-card{position:absolute;left:50%;top:50%;width:min(30vw,132px);aspect-ratio:931/1300;margin-left:calc(min(30vw,132px)/-2);' +
        'margin-top:calc(min(30vw,132px)*-0.7);perspective:800px;opacity:0}' +
        // Le retournement est sur un élément à part : l'opacité animée de la carte annulerait la 3D
        '#splash .sp-flip{position:absolute;inset:0;transform-style:preserve-3d;animation:sp-flip 450ms ease-in-out forwards}' +
        '#splash .sp-card img{position:absolute;inset:0;width:100%;height:100%;border-radius:8%;backface-visibility:hidden;' +
        '-webkit-backface-visibility:hidden;box-shadow:0 14px 30px rgba(0,0,0,.6)}' +
        '#splash .sp-card .sp-front{transform:rotateY(180deg)}' +
        '#splash .sp-c0{animation:sp-deal-l 600ms cubic-bezier(.2,.9,.3,1.2) 700ms forwards}' +
        '#splash .sp-c1{animation:sp-deal-c 600ms cubic-bezier(.2,.9,.3,1.2) 800ms forwards}' +
        '#splash .sp-c2{animation:sp-deal-r 600ms cubic-bezier(.2,.9,.3,1.2) 900ms forwards}' +
        '#splash .sp-c0 .sp-flip{animation-delay:1350ms}#splash .sp-c1 .sp-flip{animation-delay:1500ms}#splash .sp-c2 .sp-flip{animation-delay:1650ms}' +
        '#splash .sp-c1 .sp-glow{position:absolute;inset:-14%;border-radius:20%;background:radial-gradient(circle,rgba(255,210,90,.75),transparent 65%);' +
        'opacity:0;animation:sp-glow 1200ms ease 1900ms forwards;transform:translateZ(-1px)}' +
        '#splash .sp-logo{position:absolute;left:50%;top:50%;width:min(34vw,150px);margin:calc(min(34vw,150px)/-2) 0 0 calc(min(34vw,150px)/-2);' +
        'border-radius:50%;opacity:0;filter:drop-shadow(0 0 24px rgba(255,194,61,.8));animation:sp-logo 1300ms ease 0ms forwards}' +
        '#splash .sp-title{position:relative;margin-top:22px;font-size:clamp(34px,10vw,52px);letter-spacing:1px;opacity:0;transform:translateY(16px);' +
        'background:linear-gradient(180deg,#fff6cc,#ffc23d 55%,#c98a12);-webkit-background-clip:text;background-clip:text;color:transparent;' +
        'filter:drop-shadow(0 3px 0 rgba(0,0,0,.45));animation:sp-up 600ms ease 1900ms forwards;overflow:hidden}' +
        '#splash .sp-title::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.9) 50%,transparent 70%);' +
        'transform:translateX(-120%);mix-blend-mode:overlay;animation:sp-shine 900ms ease 2600ms forwards}' +
        '#splash .sp-sub{margin-top:6px;font-family:"Outfit",system-ui,sans-serif;font-weight:700;font-size:clamp(14px,4vw,18px);color:#d7a6ff;' +
        'opacity:0;transform:translateY(12px);animation:sp-up 600ms ease 2300ms forwards}' +
        '#splash .sp-bar{width:min(60vw,240px);height:6px;margin-top:26px;border-radius:9px;background:rgba(255,255,255,.12);overflow:hidden}' +
        '#splash .sp-bar i{display:block;height:100%;width:100%;transform-origin:left;transform:scaleX(0);' +
        'background:linear-gradient(90deg,#ffc23d,#ffe08a);animation:sp-load ' + (TOTAL - FADE) + 'ms linear 0ms forwards}' +
        '#splash .sp-skip{position:absolute;bottom:max(24px,env(safe-area-inset-bottom));font-family:"Outfit",system-ui,sans-serif;' +
        'font-size:13px;color:rgba(255,255,255,.55);opacity:0;animation:sp-fade 500ms ease 1200ms forwards}' +
        '@keyframes sp-out{to{opacity:0;visibility:hidden}}' +
        '@keyframes sp-fade{to{opacity:1}}' +
        '@keyframes sp-spin{to{transform:rotate(360deg)}}' +
        '@keyframes sp-logo{0%{opacity:0;transform:scale(.3)}45%{opacity:1;transform:scale(1.12)}70%{transform:scale(1)}100%{opacity:0;transform:scale(.6) translateY(-20px)}}' +
        '@keyframes sp-deal-l{from{opacity:0;transform:translate(0,40px) rotate(0) scale(.6)}to{opacity:1;transform:translate(-92%,14px) rotate(-14deg) scale(1)}}' +
        '@keyframes sp-deal-c{from{opacity:0;transform:translate(0,40px) rotate(0) scale(.6)}to{opacity:1;transform:translate(0,-10px) rotate(0) scale(1.08)}}' +
        '@keyframes sp-deal-r{from{opacity:0;transform:translate(0,40px) rotate(0) scale(.6)}to{opacity:1;transform:translate(92%,14px) rotate(14deg) scale(1)}}' +
        '@keyframes sp-flip{from{transform:rotateY(0)}to{transform:rotateY(180deg)}}' +
        '@keyframes sp-glow{0%{opacity:0}40%{opacity:1}100%{opacity:.55}}' +
        '@keyframes sp-up{to{opacity:1;transform:none}}' +
        '@keyframes sp-shine{to{transform:translateX(120%)}}' +
        '@keyframes sp-load{to{transform:scaleX(1)}}' +
        '@media (prefers-reduced-motion:reduce){#splash .sp-rays{animation:sp-fade 300ms forwards}}';

    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    var el = document.createElement('div');
    el.id = 'splash';
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', 'TCG JWBnDr — chargement');
    var cards = '';
    for (var i = 0; i < CARDS.length; i++) {
        cards += '<div class="sp-card sp-c' + i + '">' + (i === 1 ? '<span class="sp-glow"></span>' : '') +
            '<div class="sp-flip"><img src="assets/card-back/dos.png" alt=""><img class="sp-front" src="' + CARDS[i] + '" alt=""></div></div>';
    }
    el.innerHTML = '<div class="sp-rays"></div>' +
        '<div class="sp-stage">' + cards + '<img class="sp-logo" src="assets/logo/logo.png" alt=""></div>' +
        '<div class="sp-title">TCG JWBnDr</div>' +
        '<div class="sp-sub">✨ Série V3 disponible</div>' +
        '<div class="sp-bar"><i></i></div>' +
        '<div class="sp-skip">Touche l\'écran pour passer</div>';
    (document.body || document.documentElement).appendChild(el);
    // Reprise en cours de route (ou animations réduites) : on avance toutes les animations d'un coup
    var offset = reduced ? TOTAL - FADE - 600 : elapsed;
    if (offset > 0 && el.getAnimations) {
        el.getAnimations({ subtree: true }).forEach(function (a) { a.currentTime = offset; });
    }

    var done = false;
    function close(skip) {
        if (done) return;
        done = true;
        try { sessionStorage.setItem(KEY, '1'); } catch (e) { /* ignoré */ }
        if (skip) {
            el.style.transition = 'opacity 250ms ease';
            el.style.opacity = '0';
            setTimeout(remove, 260);
        } else remove();
    }
    function remove() { el.remove(); style.remove(); }
    el.addEventListener('click', function () { close(true); });
    setTimeout(function () { close(false); }, (reduced ? 600 : TOTAL - elapsed));
})();
