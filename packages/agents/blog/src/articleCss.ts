// The article stylesheet emitted into every generated blog post (see htmlBuilder.ts).
//
// Adapted from the Bull or Bear reference article template. Scoped to `.page` /
// `.essay` / the widget classes below so this file can be dropped into the site
// without leaking styles onto surrounding markup (spec 12.5).
//
// Colors are var(--color-x, #fallback) — never bare hex and never a `:root{...}`
// override — for two reasons that both matter here:
//  1. The site (~/Downloads/BLOG, src/styles/global.css) already defines
//     --color-ink/--color-body/--color-mute/--color-surface-card/--color-surface-dark/
//     --color-on-dark/--color-hairline/--color-primary/--color-canvas as dark-mode-aware
//     tokens (light values under :root, dark values under :root.dark). When the
//     published <style> block lands in the site's MDX (via
//     supabase/functions/_shared/blogPost.ts#blogPostFragmentFromHtml), those
//     var()s resolve against the *site's* tokens, so post text/cards repaint
//     correctly in dark mode instead of staying stuck at a fixed light-mode hex.
//  2. A `:root{...}` block here doesn't get stripped by blogPostFragmentFromHtml
//     (it only strips bare `*`/`html`/`body`/`h1`/`h2` rules) — a `:root{--ink:#181818}`
//     shipped as post content would clobber the site's own global `--ink` variable
//     for the entire page, permanently pinning it to light-mode's value regardless
//     of the dark-mode toggle. That was the actual mechanism behind the flip-card/
//     text dark-mode bug this file used to have.
// The literal fallback after each comma keeps this same document readable when
// rendered standalone (no site CSS present) — e.g. the dashboard's "Preview HTML"
// button (apps/dashboard/src/components/DraftCanvas.tsx) opens this exact HTML in
// a bare tab — falling back to the original light-mode palette in that case.
// Flip-card and poll/callout token choices mirror
// ~/Downloads/BLOG/src/components/FlipRevealGrid.astro exactly.
export const ARTICLE_CSS = `  *{box-sizing:border-box;}
  html{background:var(--color-canvas, #FFFFFF);}
  body{
    margin:0; background:var(--color-canvas, #FFFFFF); color:var(--color-body, #181818);
    font-family:'Figtree', system-ui, sans-serif;
    line-height:1.72; font-size:18px;
    -webkit-font-smoothing:antialiased;
  }
  .page{max-width:700px; margin:0 auto; padding:56px 24px 90px;}

  h1,h2{font-family:'Outfit', system-ui, sans-serif; font-weight:700; color:var(--color-ink, #0D0D0D); margin:0;}

  .kicker{
    font-family:'Fragment Mono', monospace; font-size:.72rem; font-weight:400;
    letter-spacing:.14em; text-transform:uppercase; color:var(--color-mute, #787878);
    margin-bottom:18px;
  }
  h1{font-size:clamp(1.85rem, 5vw, 2.5rem); line-height:1.18; letter-spacing:-.01em; margin-bottom:16px;}
  .dek{font-size:1.15rem; line-height:1.55; color:var(--color-ink-soft, #454545); margin:0 0 30px; max-width:56ch;}

  .essay p{margin:0 0 24px; color:var(--color-body, #454545); font-size:1.03rem;}
  .essay p:last-child{margin-bottom:0;}
  .essay strong{color:var(--color-ink, #0D0D0D); font-weight:700;}
  .essay em{color:var(--color-ink, #0D0D0D); font-style:italic;}
  .essay .source-note{font-size:.85rem; color:var(--color-mute, #787878);}
  .essay .disclaimer{font-size:.85rem; color:var(--color-mute, #787878);}

  h2.section-head{font-size:1.4rem; line-height:1.3; margin:46px 0 18px;}

  .gap-widget{background:var(--color-surface-dark, #181818); border-radius:16px; padding:30px 26px; margin:30px 0; color:var(--color-on-dark, #F2F0EC);}
  .gap-label{font-family:'Fragment Mono', monospace; font-size:.68rem; letter-spacing:.1em; text-transform:uppercase; color:color-mix(in srgb, var(--color-on-dark, #F2F0EC) 65%, transparent); text-align:center; margin-bottom:20px;}
  .gap-row{display:flex; align-items:center; justify-content:center; gap:18px; flex-wrap:wrap;}
  .gap-col{text-align:center;}
  .gap-num{font-family:'Outfit', sans-serif; font-weight:800; font-size:2.1rem; line-height:1;}
  .gap-col.guess .gap-num{color:color-mix(in srgb, var(--color-on-dark, #F2F0EC) 80%, transparent);}
  .gap-col.real .gap-num{color:var(--color-on-dark, #fff);}
  .gap-sub{font-family:'Fragment Mono', monospace; font-size:.68rem; color:color-mix(in srgb, var(--color-on-dark, #F2F0EC) 55%, transparent); margin-top:8px;}
  .gap-arrow{font-size:1.4rem; color:var(--color-primary, #D6952E); margin-top:-14px;}
  .gap-foot{text-align:center; font-size:.86rem; color:color-mix(in srgb, var(--color-on-dark, #F2F0EC) 78%, transparent); margin-top:18px; max-width:42ch; margin-left:auto; margin-right:auto;}

  blockquote{margin:36px 0; padding:2px 0 2px 24px; border-left:2.5px solid var(--color-primary, #5D3FD3);}
  blockquote p{font-style:italic; font-size:1.15rem; line-height:1.5; color:var(--color-ink, #151515); margin:0;}

  .reveal-wrap{margin:34px 0;}
  .reveal-title{font-family:'Outfit', sans-serif; font-weight:700; font-size:1.02rem; text-align:center; margin-bottom:4px; color:var(--color-ink, #0D0D0D);}
  .reveal-sub{font-family:'Fragment Mono', monospace; font-size:.7rem; color:var(--color-stone, #ABABA7); text-align:center; margin-bottom:22px;}
  .flip-grid{display:grid; grid-template-columns:1fr 1fr; gap:14px;}
  .flip-card{perspective:1200px; height:168px; cursor:pointer;}
  .flip-inner{position:relative; width:100%; height:100%; transition:transform .55s cubic-bezier(.4,.2,.2,1); transform-style:preserve-3d;}
  .flip-card.flipped .flip-inner{transform:rotateY(180deg);}
  .flip-face{position:absolute; inset:0; backface-visibility:hidden; border-radius:12px; padding:16px 16px; display:flex; flex-direction:column;}
  .flip-front{background:var(--color-surface-card, #FAF9F7); border:1px solid var(--color-hairline, #E9E8E5); align-items:center; justify-content:center; text-align:center;}
  .flip-front .num{font-family:'Fragment Mono', monospace; font-size:.68rem; color:var(--color-primary, #5D3FD3); letter-spacing:.06em; text-transform:uppercase; margin-bottom:8px;}
  .flip-front .icon{font-size:1.7rem; margin-bottom:8px;}
  .flip-front .teaser{font-size:.84rem; color:var(--color-ink, #454545); font-weight:600;}
  .flip-front .tap-hint{font-family:'Fragment Mono', monospace; font-size:.6rem; color:var(--color-mute, #ABABA7); margin-top:10px;}
  .flip-back{background:var(--color-surface-dark, #5D3FD3); color:var(--color-on-dark, #fff); transform:rotateY(180deg); justify-content:center; overflow-y:auto;}
  .flip-back .b-title{font-family:'Outfit', sans-serif; font-weight:700; font-size:.92rem; margin-bottom:6px; color:var(--color-on-dark, #fff);}
  .flip-back .b-text{font-size:.76rem; line-height:1.5; color:color-mix(in srgb, var(--color-on-dark, #E6E1FA) 78%, transparent);}

  .poll{background:var(--color-surface-card, #FAF9F7); border:1px solid var(--color-hairline, #E9E8E5); border-radius:14px; padding:26px 26px 24px; margin:34px 0; text-align:center;}
  .poll-q{font-family:'Outfit', sans-serif; font-weight:700; font-size:1.05rem; color:var(--color-ink, #0D0D0D); margin-bottom:20px;}
  .poll-actions{display:flex; gap:12px; justify-content:center; flex-wrap:wrap; margin-bottom:6px;}
  .poll-btn{
    font-family:'Outfit', sans-serif; font-weight:700; font-size:.86rem; color:var(--color-ink, #181818);
    background:var(--color-canvas, #fff); border:1.5px solid var(--color-ink, #181818); border-radius:30px; padding:11px 20px; cursor:pointer;
  }
  .poll-btn:hover{background:var(--color-ink, #181818); color:var(--color-canvas, #fff);}
  .poll-reveal{display:none; margin-top:18px; text-align:left; padding:16px 18px; background:var(--color-surface-card, #fff); border:1px solid var(--color-hairline, #E9E8E5); border-radius:10px; font-size:.92rem; color:var(--color-body, #454545); line-height:1.6;}
  .poll-reveal.show{display:block;}

  .footer{margin-top:54px; padding-top:22px; border-top:1px solid var(--color-hairline, #E9E8E5);}
  .footer p{font-family:'Figtree', sans-serif; font-size:.8rem; line-height:1.7; color:var(--color-mute, #787878); margin:0 0 8px;}

  .essay a, .footer a{color:var(--color-primary, #5D3FD3); text-decoration:underline; text-underline-offset:2px;}

  .short-version{background:var(--color-surface-card, #FAF9F7); border:1px solid var(--color-hairline, #E9E8E5); border-radius:14px; padding:20px 22px; margin:0 0 34px;}
  .sv-label{font-family:'Fragment Mono', monospace; font-size:.7rem; letter-spacing:.12em; text-transform:uppercase; color:var(--color-mute, #787878); margin-bottom:10px;}
  .short-version ul{margin:0; padding-left:20px;}
  .short-version li{margin:0 0 8px; color:var(--color-body, #454545); font-size:.98rem; line-height:1.55;}
  .short-version li:last-child{margin-bottom:0;}

  .widget-title{font-family:'Outfit', sans-serif; font-weight:700; font-size:1.02rem; color:var(--color-ink, #0D0D0D); margin-bottom:4px;}
  .widget-sub{font-family:'Fragment Mono', monospace; font-size:.7rem; color:var(--color-mute, #787878); margin-bottom:16px;}

  .table-figure{margin:34px 0;}
  .table-figure figcaption{margin-bottom:12px;}
  .table-sub{display:block; font-size:.88rem; color:var(--color-mute, #787878); margin-top:2px;}
  .table-wrap{overflow-x:auto; -webkit-overflow-scrolling:touch; border:1px solid var(--color-hairline, #E9E8E5); border-radius:12px; max-width:100%;}
  .data-table{border-collapse:collapse; width:100%; min-width:420px; font-size:.92rem; line-height:1.45;}
  .data-table th, .data-table td{padding:11px 14px; text-align:left; vertical-align:top; border-bottom:1px solid var(--color-hairline, #E9E8E5); color:var(--color-body, #454545);}
  .data-table thead th{font-family:'Outfit', sans-serif; font-weight:700; color:var(--color-ink, #0D0D0D); background:var(--color-surface-card, #FAF9F7); white-space:nowrap;}
  .data-table tbody th{font-weight:600; color:var(--color-ink, #0D0D0D);}
  .data-table tbody tr:last-child th, .data-table tbody tr:last-child td{border-bottom:none;}
  .data-table .num{text-align:right; font-variant-numeric:tabular-nums;}
  .table-source, .table-foot{font-size:.8rem; color:var(--color-mute, #787878); margin-top:8px;}

  .quiz, .decision{background:var(--color-surface-card, #FAF9F7); border:1px solid var(--color-hairline, #E9E8E5); border-radius:14px; padding:24px 22px; margin:34px 0;}
  .quiz-q{margin-top:18px;}
  .quiz-q:first-of-type{margin-top:0;}
  .quiz-question, .decision-q{font-family:'Outfit', sans-serif; font-weight:700; font-size:1rem; color:var(--color-ink, #0D0D0D); margin:0 0 12px;}
  .quiz-options, .decision-actions{display:grid; gap:10px;}
  .quiz-opt, .decision-btn{
    font-family:'Figtree', sans-serif; font-size:.95rem; font-weight:600; text-align:left; color:var(--color-ink, #181818);
    background:var(--color-canvas, #fff); border:1.5px solid var(--color-hairline, #D9D8D5); border-radius:10px;
    padding:13px 16px; min-height:48px; cursor:pointer; width:100%;
  }
  .quiz-opt:hover, .decision-btn:hover{border-color:var(--color-ink, #181818);}
  .quiz-opt.is-answer{border-color:var(--color-success, #2E7D4F); background:color-mix(in srgb, var(--color-success, #2E7D4F) 10%, var(--color-canvas, #fff));}
  .quiz-opt.is-wrong{border-color:var(--color-danger, #B3261E); background:color-mix(in srgb, var(--color-danger, #B3261E) 8%, var(--color-canvas, #fff));}
  .quiz-opt[aria-disabled="true"]{cursor:default;}
  .decision-btn[aria-pressed="true"]{border-color:var(--color-primary, #5D3FD3); background:color-mix(in srgb, var(--color-primary, #5D3FD3) 8%, var(--color-canvas, #fff));}
  .quiz-result, .decision-reveal{margin-top:12px; padding:14px 16px; background:var(--color-canvas, #fff); border:1px solid var(--color-hairline, #E9E8E5); border-radius:10px; font-size:.92rem; line-height:1.6; color:var(--color-body, #454545);}
  .quiz-result strong, .dr-title{font-family:'Outfit', sans-serif; font-weight:700; color:var(--color-ink, #0D0D0D);}
  .dr-title{margin-bottom:4px;}
  .quiz-source, .dr-evidence{display:block; margin-top:6px; font-size:.8rem; color:var(--color-mute, #787878);}
  .quiz-score{margin-top:16px; font-family:'Outfit', sans-serif; font-weight:700; color:var(--color-ink, #0D0D0D);}

  .timeline-wrap{margin:34px 0;}
  .timeline{list-style:none; margin:14px 0 0; padding:0 0 0 18px; border-left:2px solid var(--color-hairline, #E9E8E5);}
  .timeline li{position:relative; margin:0 0 20px; padding-left:14px;}
  .timeline li:last-child{margin-bottom:0;}
  .timeline li::before{content:''; position:absolute; left:-25px; top:6px; width:10px; height:10px; border-radius:50%; background:var(--color-primary, #5D3FD3);}
  .tl-date{font-family:'Fragment Mono', monospace; font-size:.72rem; letter-spacing:.06em; text-transform:uppercase; color:var(--color-primary, #5D3FD3);}
  .tl-title{font-family:'Outfit', sans-serif; font-weight:700; color:var(--color-ink, #0D0D0D); margin:2px 0 4px;}
  .tl-text{font-size:.94rem; line-height:1.6; color:var(--color-body, #454545);}
  .tl-source{font-size:.78rem; color:var(--color-mute, #787878); margin-top:4px;}

  .flip-front .big-num{font-family:'Outfit', sans-serif; font-weight:800; font-size:1.5rem; color:var(--color-ink, #0D0D0D); margin-bottom:6px;}
  .flip-back .b-source{font-size:.66rem; margin-top:8px; color:color-mix(in srgb, var(--color-on-dark, #E6E1FA) 65%, transparent);}

  .sources-title{font-family:'Fragment Mono', monospace; font-size:.7rem; letter-spacing:.12em; text-transform:uppercase; color:var(--color-mute, #787878); margin-bottom:10px;}
  .sources-list{margin:0; padding-left:18px;}
  .sources-list li{font-size:.8rem; line-height:1.7; color:var(--color-mute, #787878);}

  .flip-card:focus-visible, .poll-btn:focus-visible, .quiz-opt:focus-visible, .decision-btn:focus-visible, .table-wrap:focus-visible, .essay a:focus-visible{
    outline:3px solid var(--color-primary, #5D3FD3); outline-offset:3px;
  }

  @media (max-width:560px){
    body{font-size:16.5px;}
    .page{padding:38px 18px 70px;}
    .flip-grid{grid-template-columns:1fr;}
    .flip-card{height:150px;}
    .gap-num{font-size:1.7rem;}
    .quiz, .decision{padding:20px 16px;}
    .data-table{font-size:.86rem;}
    .data-table th, .data-table td{padding:9px 11px;}
  }`;

