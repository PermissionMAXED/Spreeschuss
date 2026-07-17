export const POND_FISHING_STYLES = `
  :host { display:block; width:100%; height:100%; color:#183f48; font-family:Inter,ui-rounded,system-ui,sans-serif; }
  * { box-sizing:border-box; }
  button { border:0; color:inherit; font:inherit; cursor:pointer; }
  button:focus-visible { outline:3px solid #fff; outline-offset:2px; }
  .game { position:relative; width:100%; height:100%; min-height:620px; overflow:hidden; isolation:isolate;
    background:linear-gradient(#a9e8dd 0 16%,#6cc6b0 16% 24%,#368e8d 24% 100%); touch-action:none; user-select:none; }
  .sky { position:absolute; inset:0 0 auto; height:24%; overflow:hidden; background:linear-gradient(#d9f7e8,#8bd5c5); pointer-events:none; }
  .sky::before { content:""; position:absolute; width:78px; height:78px; right:10%; top:20px; border-radius:50%; background:#fff5b0; box-shadow:0 0 55px #fff8bd; }
  .sky::after { content:""; position:absolute; right:-8%; bottom:-34px; left:-8%; height:90px; border-radius:50% 50% 0 0; background:#4eaa72; box-shadow:inset 0 12px #74c780; }
  .top { position:relative; z-index:8; display:grid; grid-template-columns:auto 1fr auto; gap:10px; align-items:center;
    padding:max(13px,env(safe-area-inset-top)) 14px 7px; }
  .round-button { width:42px; height:42px; border:1px solid #fff9; border-radius:15px; background:#efffe5d9; box-shadow:0 6px 18px #14556833; font-size:17px; }
  .title { text-align:center; text-shadow:0 1px #fff9; }
  .title strong { display:block; font-size:19px; letter-spacing:-.5px; }
  .title small { display:block; color:#34706f; font-size:9px; font-weight:900; letter-spacing:1.1px; text-transform:uppercase; }
  .stats { position:relative; z-index:8; display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin:0 14px 8px; }
  .stat { padding:7px 4px; border:1px solid #fff9; border-radius:14px; background:#efffe4d0; box-shadow:0 5px 14px #14556826; text-align:center; }
  .stat span { display:block; color:#4a7771; font-size:8px; font-weight:900; letter-spacing:.8px; text-transform:uppercase; }
  .stat b { display:block; margin-top:1px; color:#23565b; font-size:14px; font-variant-numeric:tabular-nums; }
  .pond { position:absolute; z-index:2; top:24%; right:-12%; bottom:0; left:-12%; overflow:hidden; border-radius:50% 50% 0 0 / 10% 10% 0 0;
    background:radial-gradient(ellipse at 50% 12%,#92e0d2 0 5%,transparent 27%),repeating-radial-gradient(ellipse at 50% 30%,#55b8b9 0 3px,#319a9f 5px 22px);
    box-shadow:inset 0 18px #79ccba,inset 0 26px #e1d09c; }
  .pond::before { content:""; position:absolute; inset:0; opacity:.42; pointer-events:none;
    background:linear-gradient(105deg,transparent 42%,#fff8 47%,transparent 53%),radial-gradient(ellipse at 70% 60%,#fff6 0 1px,transparent 2px);
    background-size:100% 100%,38px 46px; animation:water 5s ease-in-out infinite alternate; }
  @keyframes water { to { transform:translateX(12px); opacity:.25; } }
  .lily { position:absolute; z-index:2; width:48px; height:25px; border-radius:50%; background:#4ca65a; box-shadow:inset -8px -4px #2f824d,0 4px 8px #1d656466; pointer-events:none; }
  .lily::after { content:"🌸"; position:absolute; top:-18px; left:12px; font-size:24px; }
  .lily.one { left:16%; top:22%; transform:rotate(-8deg); }
  .lily.two { right:15%; top:51%; transform:scale(.8) rotate(12deg); }
  .shadow { position:absolute; z-index:3; width:70px; height:22px; transform:translate(-50%,-50%) rotate(var(--angle));
    border-radius:60% 45% 45% 60%; opacity:.52; background:#164f5b; filter:blur(2px); box-shadow:12px 0 #164f5b; animation:swim 2.4s ease-in-out infinite alternate; pointer-events:none; }
  .shadow::after { content:""; position:absolute; right:-16px; top:2px; border-block:9px solid transparent; border-left:18px solid #164f5b; }
  @keyframes swim { to { transform:translate(-44%,-50%) rotate(var(--angle)); opacity:.38; } }
  .cast-line { position:absolute; z-index:5; left:50%; bottom:6%; width:3px; height:var(--line-length,0); transform:translateX(-50%) rotate(var(--line-angle,0deg)); transform-origin:bottom;
    border-radius:99px; background:#fff8dd; box-shadow:0 0 3px #294b55; pointer-events:none; }
  .bobber { position:absolute; z-index:6; left:var(--cast-x,50%); top:var(--cast-y,78%); width:18px; height:18px; transform:translate(-50%,-50%); border:5px solid #fff;
    border-radius:50%; background:#ed7358; box-shadow:0 5px 11px #164f5b88; pointer-events:none; transition:left .25s ease,top .25s ease; }
  .bobber[hidden],.cast-line[hidden] { display:none; }
  .bite .bobber { animation:bite .18s ease-in-out infinite alternate; box-shadow:0 0 0 16px #fff8,0 0 0 28px #fff3; }
  @keyframes bite { to { transform:translate(-50%,20%) scale(.8); } }
  .gooby { position:absolute; z-index:7; bottom:1.5%; left:50%; width:105px; height:91px; transform:translateX(-50%); border-radius:48% 48% 43% 43%;
    background:radial-gradient(circle at 35% 37%,#3f3432 0 4px,transparent 5px),radial-gradient(circle at 65% 37%,#3f3432 0 4px,transparent 5px),#f7d4a2;
    box-shadow:inset 13px -12px #eab47b,0 12px 24px #184b5366; pointer-events:none; }
  .gooby::before,.gooby::after { content:""; position:absolute; z-index:-1; top:-48px; width:28px; height:62px; border-radius:70% 70% 35% 35%; background:#f7d4a2; box-shadow:inset 0 0 0 7px #eeb590; }
  .gooby::before { left:24px; transform:rotate(-8deg); }.gooby::after { right:22px; transform:rotate(16deg); }
  .gooby span { position:absolute; right:-35px; top:22px; font-size:49px; transform:rotate(-24deg); filter:drop-shadow(0 4px 3px #174d5b66); }
  .gooby.fight { animation:pull .35s ease-in-out infinite alternate; }
  @keyframes pull { to { transform:translateX(-50%) rotate(-4deg) scale(1.02); } }
  .prompt { position:absolute; z-index:8; top:29%; left:50%; min-width:220px; padding:10px 16px; transform:translateX(-50%);
    border:1px solid #fff9; border-radius:99px; color:#f7ffff; background:#164f5bcc; box-shadow:0 8px 20px #174d5b44; font-size:11px; font-weight:900; text-align:center; pointer-events:none; }
  .prompt.bite { color:#684221; background:#fff3a3; animation:prompt-pop .35s ease-in-out infinite alternate; }
  @keyframes prompt-pop { to { transform:translateX(-50%) scale(1.08); } }
  .tension-wrap { position:absolute; z-index:9; right:22px; bottom:17%; left:22px; padding:10px 12px 12px; border:1px solid #fff9; border-radius:18px; background:#123f4bd9; box-shadow:0 10px 25px #12343e55; }
  .tension-wrap[hidden] { display:none; }
  .tension-copy { display:flex; justify-content:space-between; margin-bottom:6px; color:#d8f7ee; font-size:9px; font-weight:900; letter-spacing:.8px; }
  .meter { position:relative; height:18px; overflow:hidden; border:2px solid #fff8; border-radius:99px; background:linear-gradient(90deg,#5ec5e2,#e9d65a 58%,#ef665f); }
  .green { position:absolute; top:0; bottom:0; left:var(--green-start); width:var(--green-width); background:#69e785; box-shadow:0 0 14px #afffbd; }
  .needle { position:absolute; z-index:2; top:-3px; bottom:-3px; left:var(--tension); width:5px; transform:translateX(-50%); border:1px solid #314a42; border-radius:4px; background:#fff; box-shadow:0 1px 5px #102f38; transition:left .06s linear; }
  .reel { width:100%; min-height:50px; margin-top:8px; border-radius:15px; color:#fff; background:linear-gradient(#ee9b51,#cc6548); box-shadow:0 6px 0 #9f4c3a,0 9px 15px #071f2744; font-size:13px; font-weight:950; letter-spacing:.7px; touch-action:none; }
  .reel:active,.reel.held { transform:translateY(4px); box-shadow:0 2px 0 #9f4c3a; }
  .catch-card { position:absolute; z-index:11; top:43%; left:50%; width:min(82%,330px); padding:18px; transform:translate(-50%,-50%);
    border:2px solid #fff; border-radius:25px; color:#36534f; background:linear-gradient(145deg,#fffadf,#dff3d2); box-shadow:0 18px 50px #12343e88; text-align:center; pointer-events:none; animation:catch-in .4s cubic-bezier(.2,1.4,.4,1); }
  .catch-card[hidden] { display:none; }
  @keyframes catch-in { from { transform:translate(-50%,-50%) scale(.55) rotate(-6deg); opacity:0; } }
  .catch-card .fish { font-size:56px; filter:drop-shadow(0 6px 5px #174d5b55); }.catch-card b{display:block;font-size:20px}.catch-card small{font-size:11px;color:#668079}
  .overlay { position:absolute; z-index:20; inset:0; display:flex; align-items:center; justify-content:center; padding:22px 20px;
    background:linear-gradient(#174b6077,#0d3544e8); backdrop-filter:blur(10px); touch-action:auto; }
  .overlay[hidden] { display:none; }
  .panel { width:min(100%,410px); max-height:93%; overflow:auto; padding:23px 20px; border:1px solid #fff9; border-radius:30px;
    background:linear-gradient(150deg,#f4ffe5,#cceecf); box-shadow:0 22px 65px #082d3c99; text-align:center; }
  .mascot { font-size:56px; filter:drop-shadow(0 7px 7px #174d5b44); animation:float 2s ease-in-out infinite; }
  @keyframes float { 50% { transform:translateY(-5px) rotate(-3deg); } }
  h2 { margin:6px 0 5px; color:#28585a; font-size:27px; letter-spacing:-1px; } p { margin:0 auto 15px; max-width:320px; color:#557b75; font-size:12px; line-height:1.45; }
  .tip { display:grid; grid-template-columns:43px 1fr; gap:9px; align-items:center; margin:13px 0; padding:11px; border-radius:17px; background:#a9ddc477; text-align:left; }
  .tip em{font-style:normal;font-size:27px;text-align:center}.tip b{display:block;font-size:12px}.tip span{display:block;color:#66877e;font-size:10px}
  .dots{display:flex;justify-content:center;gap:6px;margin:13px 0}.dots i{width:7px;height:7px;border-radius:99px;background:#3c777755}.dots i.on{width:22px;background:#367d79}
  .difficulty { display:grid; gap:7px; margin:12px 0 16px; }
  .difficulty button { display:grid; grid-template-columns:43px 1fr auto; gap:9px; align-items:center; padding:10px 11px; border:2px solid transparent; border-radius:17px; color:#49726d; background:#b8e2c8; text-align:left; }
  .difficulty button.selected { border-color:#e4aa4e; background:#fff0b5; transform:scale(1.02); }.difficulty em{font-style:normal;font-size:25px}.difficulty b,.difficulty small{display:block}.difficulty b{font-size:12px}.difficulty small{font-size:9px}.difficulty strong{font-size:9px}
  .primary,.secondary { width:100%; min-height:49px; border-radius:17px; font-weight:950; }.primary{color:#fff;background:linear-gradient(145deg,#42a58a,#247276);box-shadow:0 8px 18px #246f7044,inset 0 1px #fff6}.secondary{margin-top:8px;color:#477069;background:#c5e5cb}
  .result-weight { margin:8px 0 3px; color:#25676b; font-size:36px; font-weight:950; }.result-score{margin-bottom:14px;color:#5e7d72;font-size:13px}.new-best{display:inline-block;margin-bottom:11px;padding:5px 10px;border-radius:99px;color:#8b5d1f;background:#ffe798;font-size:9px;font-weight:950;letter-spacing:1px}
  @media (max-height:700px){.game{min-height:100%}.panel{padding:15px}.mascot{font-size:41px}h2{font-size:22px}.tip{margin:7px 0}.difficulty{gap:5px;margin:7px 0 10px}.difficulty button{padding:7px 9px}.gooby{transform:translateX(-50%) scale(.8);transform-origin:bottom}.tension-wrap{bottom:13%}}
  @media (prefers-reduced-motion:reduce){*{animation-duration:1ms!important;transition-duration:1ms!important}}
`;
