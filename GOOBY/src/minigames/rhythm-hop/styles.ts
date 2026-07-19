export const RHYTHM_HOP_STYLES = `
  :host { display:block; width:100%; height:100%; color:#352c58; font-family:Inter,ui-rounded,system-ui,sans-serif; }
  * { box-sizing:border-box; }
  button { border:0; color:inherit; font:inherit; cursor:pointer; }
  button:focus-visible { outline:3px solid #fff; outline-offset:2px; }
  .game { --beat:#ffda6a; position:relative; width:100%; height:100%; min-height:620px; overflow:hidden; isolation:isolate;
    background:radial-gradient(circle at 50% 17%,#8a78d6 0 8%,transparent 28%),linear-gradient(170deg,#4f427f 0%,#322c68 47%,#182d55 100%); }
  .starscape { position:absolute; inset:0; opacity:.52; pointer-events:none;
    background-image:radial-gradient(circle,#fff 0 1.5px,transparent 2px),radial-gradient(circle,#ffe66d 0 1px,transparent 2px);
    background-position:8px 14px,31px 45px;background-size:58px 61px,79px 73px;animation:twinkle 3s ease-in-out infinite alternate; }
  @keyframes twinkle{to{opacity:.28;transform:translateY(4px)}}
  .moon { position:absolute; top:13%; right:9%; width:74px; aspect-ratio:1; border-radius:50%; background:#fff2b2; box-shadow:0 0 45px #fff1ac88,inset -13px -7px #e8d398; pointer-events:none; }
  .top { position:relative; z-index:8; display:grid; grid-template-columns:auto 1fr auto; gap:9px; align-items:center;padding:max(13px,env(safe-area-inset-top)) 13px 7px;color:#fff; }
  .round-button{width:42px;height:42px;border:1px solid #fff6;border-radius:15px;color:#fff;background:#8273bb99;box-shadow:0 6px 17px #10193b66;font-size:17px}
  .title{text-align:center;text-shadow:0 2px #201b4a}.title strong{display:block;font-size:18px;letter-spacing:-.4px}.title small{display:block;color:#d7cbff;font-size:9px;font-weight:900;letter-spacing:1.1px;text-transform:uppercase}
  .stats{position:relative;z-index:8;display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:0 13px 8px}.stat{padding:7px 4px;border:1px solid #fff5;border-radius:14px;color:#fff;background:#655a9999;box-shadow:0 5px 14px #11163855;text-align:center;backdrop-filter:blur(5px)}
  .stat span{display:block;color:#d9d0f5;font-size:8px;font-weight:900;letter-spacing:.8px;text-transform:uppercase}.stat b{display:block;margin-top:1px;font-size:14px;font-variant-numeric:tabular-nums}
  .track { position:absolute; z-index:2; top:20%; right:9%; bottom:17%; left:9%; overflow:hidden; border:1px solid #fff4; border-radius:24px 24px 35px 35px;
    background:linear-gradient(90deg,#473c7566 0 32.7%,#fff2 33% 33.5%,#473c7566 34% 65.8%,#fff2 66.2% 66.7%,#473c7566 67% 100%);
    box-shadow:inset 0 0 35px #10183f88,0 20px 40px #0b153a66; }
  .track::before{content:"";position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent 0 46px,#fff1 47px 48px);animation:scroll-grid 1.3s linear infinite}
  @keyframes scroll-grid{to{background-position-y:48px}}
  .lane-glow{position:absolute;z-index:1;top:0;bottom:0;width:33.333%;left:calc(var(--lane)*33.333%);opacity:0;background:linear-gradient(transparent,#e6caff44 60%,#ffdc7777);transition:opacity .08s}.lane-glow.on{opacity:1}
  .finish-line{position:absolute;z-index:3;right:0;bottom:83px;left:0;height:7px;background:linear-gradient(90deg,#ffdb5e,#fff,#ff8bc9);box-shadow:0 0 16px #fff7}
  .finish-line::before{content:"HOP!";position:absolute;right:0;bottom:8px;left:0;color:#fff;font-size:9px;font-weight:950;letter-spacing:3px;text-align:center;text-shadow:0 2px #33265e}
  .note{position:absolute;z-index:4;left:calc((var(--lane) + .5)*33.333%);bottom:var(--note-y);display:grid;width:48px;aspect-ratio:1;transform:translate(-50%,50%);place-items:center;border:2px solid #fff;border-radius:50%;
    color:#4e3763;background:radial-gradient(circle at 36% 30%,#fff 0 9%,transparent 10%),linear-gradient(145deg,#ffef8b,#f2a950);box-shadow:0 5px 0 #b56d4a,0 0 18px #ffd96d88;font-size:20px;font-weight:950;transition:bottom .05s linear}
  .note.hard{border-radius:15px;background:radial-gradient(circle at 36% 30%,#fff 0 8%,transparent 9%),linear-gradient(145deg,#f2b0ff,#8e71e8);box-shadow:0 5px 0 #5e4ca5,0 0 18px #c49dff88}
  .note.hold::before{content:"";position:absolute;bottom:50%;left:50%;width:14px;height:var(--hold-len);transform:translateX(-50%);border:1px solid #fff8;border-radius:99px 99px 8px 8px;background:linear-gradient(#ffe9a0cc,#ffb35e88);box-shadow:0 0 12px #ffd96d88;pointer-events:none}
  .note.hard.hold::before{background:linear-gradient(#e5c8ffcc,#9c7ded88);box-shadow:0 0 12px #c49dff88}
  .note.holding{border-color:#fffbe2;box-shadow:0 0 26px #fff3ae,0 0 10px #ffd96d;animation:hold-pulse .3s ease-in-out infinite alternate}
  @keyframes hold-pulse{to{transform:translate(-50%,50%) scale(1.09)}}
  .lane-glow.sparkle{background:linear-gradient(transparent,#fff8 55%,#ffe25e)}
  .gooby{position:absolute;z-index:6;bottom:39px;left:calc((var(--lane) + .5)*33.333%);width:76px;height:68px;transform:translateX(-50%);border-radius:48% 48% 43% 43%;
    background:radial-gradient(circle at 35% 37%,#392f39 0 3px,transparent 4px),radial-gradient(circle at 65% 37%,#392f39 0 3px,transparent 4px),radial-gradient(ellipse at 50% 67%,#fff0d0 0 28%,transparent 29%),#f5d1a4;
    box-shadow:inset 10px -9px #e8ad78,0 9px 18px #0e173b88;transition:left .13s cubic-bezier(.2,1.4,.4,1);animation:hop .52s ease-in-out infinite}
  .gooby::before,.gooby::after{content:"";position:absolute;z-index:-1;top:-38px;width:21px;height:48px;border-radius:70% 70% 35% 35%;background:#f5d1a4;box-shadow:inset 0 0 0 6px #eeb38e}.gooby::before{left:18px;transform:rotate(-7deg)}.gooby::after{right:17px;transform:rotate(17deg)}
  @keyframes hop{50%{transform:translateX(-50%) translateY(-7px) scaleY(1.03)}}
  .gooby.wobble{animation:wobble .12s ease-in-out 3}@keyframes wobble{25%{transform:translateX(-50%) rotate(-7deg)}75%{transform:translateX(-50%) rotate(7deg)}}
  .judgment{position:absolute;z-index:9;top:29%;left:50%;transform:translateX(-50%) scale(.7);opacity:0;color:#fff;font-size:27px;font-weight:1000;font-style:italic;letter-spacing:1px;text-shadow:0 4px #3c2867,0 0 18px #fff;pointer-events:none}
  .judgment.show{animation:judge .55s ease both}@keyframes judge{20%{transform:translateX(-50%) scale(1.2);opacity:1}100%{transform:translateX(-50%) translateY(-25px) scale(.95);opacity:0}}
  .judgment.good{color:#bdeeff}.judgment.miss{color:#ff9aaa;text-shadow:0 4px #7e2f53}
  .judgment.sparkle{color:#fff6c9;text-shadow:0 4px #8a6a1f,0 0 26px #ffe45e,0 0 8px #fff}
  .combo-pop{position:absolute;z-index:8;top:35%;left:50%;transform:translateX(-50%);color:#ffec90;font-size:13px;font-weight:950;text-shadow:0 3px #3c2867;pointer-events:none}
  .controls{position:absolute;z-index:8;right:9%;bottom:max(12px,env(safe-area-inset-bottom));left:9%;display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
  .lane-button{min-height:62px;border:1px solid #fff7;border-radius:18px;color:#fff;background:linear-gradient(145deg,#8975ca,#574a9b);box-shadow:0 7px 0 #342c72,0 11px 18px #0d143866;font-size:23px;font-weight:950;touch-action:manipulation}
  .lane-button:active{transform:translateY(5px);box-shadow:0 2px 0 #342c72}.lane-button small{display:block;margin-top:2px;color:#d8ceff;font-size:8px;letter-spacing:1px}
  .progress{position:absolute;z-index:8;right:11%;bottom:calc(17% - 2px);left:11%;height:5px;overflow:hidden;border-radius:99px;background:#fff3}.progress i{display:block;width:var(--progress);height:100%;border-radius:inherit;background:linear-gradient(90deg,#ffce61,#ff8fd3);box-shadow:0 0 10px #ffcf80}
  .overlay{position:absolute;z-index:20;inset:0;display:flex;align-items:center;justify-content:center;padding:22px 20px;background:linear-gradient(#342a6277,#151b45ec);backdrop-filter:blur(10px)}
  .overlay[hidden]{display:none}.panel{width:min(100%,415px);max-height:93%;overflow:auto;padding:23px 20px;border:1px solid #fff8;border-radius:30px;color:#493e6a;background:linear-gradient(150deg,#fff8dd,#e4d8fa);box-shadow:0 22px 65px #0a103799;text-align:center}
  .mascot{font-size:55px;filter:drop-shadow(0 7px 7px #33265e55);animation:mascot-hop 1.4s ease-in-out infinite}@keyframes mascot-hop{50%{transform:translateY(-6px) rotate(4deg)}}
  h2{margin:6px 0 5px;color:#493a78;font-size:27px;letter-spacing:-1px}p{margin:0 auto 14px;max-width:320px;color:#71668f;font-size:12px;line-height:1.45}
  .tip{display:grid;grid-template-columns:43px 1fr;gap:9px;align-items:center;margin:13px 0;padding:11px;border-radius:17px;background:#cfc1ef88;text-align:left}.tip em{font-style:normal;font-size:26px;text-align:center}.tip b{display:block;font-size:12px}.tip span{display:block;color:#7c7197;font-size:10px}
  .dots{display:flex;justify-content:center;gap:6px;margin:13px 0}.dots i{width:7px;height:7px;border-radius:99px;background:#67548f55}.dots i.on{width:22px;background:#6753a1}
  .songs{display:grid;gap:7px;margin:11px 0}.song{display:grid;grid-template-columns:44px 1fr auto;gap:9px;align-items:center;padding:9px 10px;border:2px solid transparent;border-radius:17px;color:#62567f;background:#d8cdf0;text-align:left}.song.selected{border-color:#e3a949;background:#fff0b5;transform:scale(1.015)}.song em{font-style:normal;font-size:25px}.song b,.song small{display:block}.song b{font-size:12px}.song small{font-size:9px}.song strong{font-size:9px}
  .mode{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:10px 0 15px}.mode button{padding:10px;border:2px solid transparent;border-radius:15px;background:#cfc1ea;font-size:11px;font-weight:900}.mode button.selected{border-color:#8a68c7;color:#fff;background:#7257aa}
  .primary,.secondary{width:100%;min-height:49px;border-radius:17px;font-weight:950}.primary{color:#fff;background:linear-gradient(145deg,#8062bd,#514388);box-shadow:0 8px 18px #35286655,inset 0 1px #fff6}.secondary{margin-top:8px;color:#6b5d89;background:#d7ccec}
  .grade{margin:8px 0;color:#f0ad43;font-size:52px;font-weight:1000;text-shadow:0 4px #9c633b}.result-score{color:#493a78;font-size:32px;font-weight:1000}.result-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:12px 0}.result-grid div{padding:8px 4px;border-radius:13px;background:#d8cdf0}.result-grid b,.result-grid span{display:block}.result-grid b{font-size:15px}.result-grid span{font-size:8px;font-weight:900;text-transform:uppercase}.result-grid .sparkle-cell{background:linear-gradient(150deg,#ffedb1,#ffd98a);box-shadow:inset 0 0 0 1px #e8b45499}.result-grid .sparkle-cell b{color:#8a6a1f}.new-best{display:inline-block;margin-bottom:11px;padding:5px 10px;border-radius:99px;color:#8b5d1f;background:#ffe798;font-size:9px;font-weight:950;letter-spacing:1px}
  @media(max-height:700px){.game{min-height:100%}.track{bottom:18%;}.panel{padding:15px}.mascot{font-size:40px}h2{font-size:22px}.tip{margin:7px 0}.songs{gap:4px;margin:6px 0}.song{padding:6px 9px}.mode{margin:6px 0 9px}.lane-button{min-height:51px}}
  :host([data-reduced-motion="true"]) *{animation-duration:1ms!important;transition-duration:1ms!important}
  @media(prefers-reduced-motion:reduce){*{animation-duration:1ms!important;transition-duration:1ms!important}}
`;
