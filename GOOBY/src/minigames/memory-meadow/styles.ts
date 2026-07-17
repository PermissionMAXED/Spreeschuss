export const MEMORY_MEADOW_STYLES = `
  :host { display:block; width:100%; height:100%; color:#35472d; font-family:Inter,ui-rounded,system-ui,sans-serif; }
  * { box-sizing:border-box; }
  button { border:0; color:inherit; font:inherit; cursor:pointer; }
  button:focus-visible { outline:3px solid #fff; outline-offset:2px; }
  .game { position:relative; width:100%; height:100%; min-height:620px; overflow:hidden; isolation:isolate;
    background:radial-gradient(circle at 18% 14%,#fffbd1 0 6%,transparent 16%),
      linear-gradient(165deg,#c9e99d 0%,#82c779 54%,#41996d 100%); }
  .game::before,.game::after { content:""; position:absolute; border-radius:50%; pointer-events:none; opacity:.35; }
  .game::before { width:260px; height:260px; left:-100px; bottom:80px; background:#f3d45e; filter:blur(3px); }
  .game::after { width:180px; height:180px; right:-70px; top:170px; background:#b1e6de; }
  .petals { position:absolute; inset:0; pointer-events:none; opacity:.45;
    background-image:radial-gradient(ellipse,#fff 0 2px,transparent 3px),radial-gradient(ellipse,#ffe779 0 2px,transparent 3px);
    background-position:16px 32px,42px 14px; background-size:58px 70px,72px 62px; }
  .top { position:relative; z-index:2; display:grid; grid-template-columns:auto 1fr auto; gap:10px; align-items:center;
    padding:max(14px,env(safe-area-inset-top)) 14px 9px; }
  .round-button { width:42px; height:42px; border-radius:15px; background:#fffbdccc; box-shadow:0 7px 18px #35683d33; font-size:18px; }
  .title { min-width:0; text-align:center; text-shadow:0 1px #fff8; }
  .title strong { display:block; font-size:19px; letter-spacing:-.5px; }
  .title small { display:block; color:#53764a; font-size:10px; font-weight:800; letter-spacing:1.1px; text-transform:uppercase; }
  .stats { position:relative; z-index:2; display:grid; grid-template-columns:repeat(3,1fr); gap:7px; padding:0 14px 10px; }
  .stat { padding:8px 5px; border:1px solid #fff9; border-radius:14px; background:#fffbd9c7; box-shadow:0 6px 16px #35683d22; text-align:center; }
  .stat span { display:block; color:#6b825a; font-size:8px; font-weight:900; letter-spacing:1px; text-transform:uppercase; }
  .stat b { display:block; margin-top:2px; color:#3e5e37; font-size:15px; font-variant-numeric:tabular-nums; }
  .progress { position:relative; z-index:2; height:7px; margin:0 18px 12px; overflow:hidden; border-radius:99px; background:#4d875655; }
  .progress i { display:block; height:100%; border-radius:inherit; background:linear-gradient(90deg,#fff5a8,#f5c95f); box-shadow:0 0 10px #fff3a8; transition:width .3s ease; }
  .board { position:relative; z-index:2; display:grid; gap:8px; width:calc(100% - 28px); max-width:440px; height:min(62vh,540px);
    margin:0 auto; padding:10px; border:1px solid #fff8; border-radius:24px; background:#396f5147; box-shadow:inset 0 2px 12px #1c543744,0 18px 35px #2d634b2b; }
  .card { position:relative; min-width:0; min-height:0; padding:0; border-radius:16px; background:transparent; perspective:500px; }
  .card-inner { position:absolute; inset:0; border-radius:inherit; transform-style:preserve-3d; transition:transform .34s cubic-bezier(.2,.8,.2,1); }
  .card.is-up .card-inner { transform:rotateY(180deg) scale(1.025); }
  .face { position:absolute; inset:0; display:grid; place-items:center; border-radius:inherit; backface-visibility:hidden; -webkit-backface-visibility:hidden; }
  .back { border:2px solid #fffbd3; background:radial-gradient(circle at 50% 42%,#ffd759 0 13%,transparent 14%),
      repeating-conic-gradient(from 10deg,#fff4b8 0 12deg,#f2b95e 13deg 25deg); box-shadow:0 6px 0 #44754d,0 9px 15px #244d3838; }
  .back::after { content:""; width:42%; aspect-ratio:1; border-radius:50%; background:#e9a44f; box-shadow:inset 0 0 0 4px #fff8; }
  .front { transform:rotateY(180deg); border:2px solid #fff; background:linear-gradient(145deg,#fffef0,#e8f7ca); box-shadow:0 7px 0 #78a866,0 11px 18px #244d3838; font-size:clamp(25px,7vw,42px); }
  .trio .front { background:linear-gradient(145deg,#fff8ce,#ded4ff); box-shadow:0 7px 0 #9682bc,0 11px 18px #244d3838; }
  .matched .card-inner { animation:match-pop .48s ease; }
  .matched .front { filter:saturate(.8); opacity:.82; }
  @keyframes match-pop { 45% { transform:rotateY(180deg) scale(1.16) rotate(2deg); } }
  .toast { position:absolute; z-index:5; top:46%; left:50%; min-width:210px; padding:12px 18px; transform:translate(-50%,-50%) scale(.8);
    border:2px solid #fff; border-radius:22px; opacity:0; color:#fff; background:#4a785eea; box-shadow:0 14px 35px #244d3866;
    font-size:15px; font-weight:900; text-align:center; pointer-events:none; transition:.2s ease; }
  .toast.show { transform:translate(-50%,-50%) scale(1); opacity:1; }
  .shuffle { position:absolute; z-index:4; inset:0; display:grid; place-items:center; color:#fff; background:#8dd38622; pointer-events:none; }
  .shuffle[hidden] { display:none; }
  .dandelion { font-size:82px; filter:drop-shadow(0 8px 12px #315c43aa); animation:blow 1.35s ease-in-out both; }
  @keyframes blow { 0%{transform:translate(-110px,60px) rotate(-18deg);opacity:0} 20%{opacity:1} 100%{transform:translate(145px,-80px) rotate(28deg);opacity:0} }
  .overlay { position:absolute; z-index:10; inset:0; display:flex; align-items:center; justify-content:center; padding:24px 20px;
    background:linear-gradient(#29573b77,#183d32dd); backdrop-filter:blur(10px); }
  .overlay[hidden] { display:none; }
  .panel { width:min(100%,410px); max-height:92%; overflow:auto; padding:24px 20px; border:1px solid #fff9; border-radius:30px;
    background:linear-gradient(155deg,#fffde9,#e7f4cb); box-shadow:0 22px 65px #153d2c88; text-align:center; }
  .mascot { font-size:58px; filter:drop-shadow(0 7px 7px #47703f44); animation:bob 2s ease-in-out infinite; }
  @keyframes bob { 50% { transform:translateY(-5px) rotate(3deg); } }
  .panel h2 { margin:6px 0 5px; color:#365b38; font-size:28px; letter-spacing:-1px; }
  .panel p { margin:0 auto 17px; max-width:310px; color:#62805b; font-size:13px; line-height:1.45; }
  .tip { display:grid; grid-template-columns:42px 1fr; gap:10px; align-items:center; margin:14px 0; padding:11px;
    border-radius:17px; background:#cce4a477; text-align:left; }
  .tip b { display:block; color:#45683f; font-size:12px; }
  .tip span { color:#718868; font-size:10px; }
  .tip-icon { font-size:27px; text-align:center; }
  .dots { display:flex; justify-content:center; gap:6px; margin:14px 0; }
  .dots i { width:7px; height:7px; border-radius:99px; background:#71916755; }
  .dots i.on { width:22px; background:#5f8a52; }
  .difficulty { display:grid; gap:8px; margin:13px 0 17px; }
  .difficulty button { display:grid; grid-template-columns:48px 1fr auto; gap:10px; align-items:center; padding:10px 12px; border:2px solid transparent;
    border-radius:17px; color:#55704d; background:#dceabb; text-align:left; transition:.15s ease; }
  .difficulty button.selected { border-color:#efb84e; background:#fff2b8; transform:scale(1.02); }
  .difficulty em { font-style:normal; font-size:26px; }
  .difficulty b,.difficulty small { display:block; }
  .difficulty b { color:#3e603b; font-size:13px; }
  .difficulty small { margin-top:2px; font-size:9px; }
  .difficulty strong { color:#789267; font-size:10px; }
  .primary,.secondary { width:100%; min-height:49px; border-radius:17px; font-weight:900; }
  .primary { color:#fff; background:linear-gradient(145deg,#74a84f,#477f4f); box-shadow:0 8px 18px #477f4f44,inset 0 1px #fff6; }
  .secondary { margin-top:8px; color:#60785a; background:#dbe8c4; }
  .stars { margin:7px 0; color:#f3bd38; font-size:38px; letter-spacing:5px; text-shadow:0 3px #b47b2d; }
  .score { margin:8px 0 17px; color:#3f633c; font-size:34px; font-weight:950; }
  .new-best { display:inline-block; margin-bottom:12px; padding:5px 10px; border-radius:99px; color:#8b5d1f; background:#ffe798; font-size:9px; font-weight:950; letter-spacing:1px; }
  @media (max-height:700px) { .game{min-height:100%}.board{height:54vh}.panel{padding:16px}.mascot{font-size:42px}.panel h2{font-size:23px}.tip{margin:8px 0}.difficulty{gap:5px;margin:7px 0 10px}.difficulty button{padding:7px 10px} }
  :host([data-reduced-motion="true"]) * { animation-duration:1ms!important;transition-duration:1ms!important; }
  @media (prefers-reduced-motion:reduce) { *{animation-duration:1ms!important;transition-duration:1ms!important} }
`;
