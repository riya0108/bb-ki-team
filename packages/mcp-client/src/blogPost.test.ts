import { describe, expect, it } from 'vitest';

import { BlogHtmlParseError, blogPostFragmentFromHtml, slugify } from './blogPost.js';

// Mirrors packages/agents/blog/src/htmlBuilder.ts's fixed output shape closely
// enough to exercise every extraction this module relies on, without depending on
// that package directly (it already depends on this one).
const SAMPLE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Why &quot;No-Cost EMI&quot; Isn&#39;t Free</title>
<meta name="description" content="A look at who actually pays for &quot;no-cost&quot; EMI.">
<style>
  :root{--ink:#181818;}
  *{box-sizing:border-box;}
  html{background:#FFFFFF;}
  body{margin:0; background:#FFFFFF;}
  h1,h2{font-family:'Outfit', sans-serif;}
  .essay p{margin:0;}
  h2.section-head{font-size:1.4rem;}
  @media (max-width:560px){
    body{font-size:16.5px;}
    .essay p{margin:0 0 8px;}
  }
</style>
</head>
<body>
<div class="page">
  <header>
    <div class="kicker">Personal Finance &amp; Money</div>
    <h1>Why "No-Cost EMI" Isn't Free</h1>
    <p class="dek">A deck.</p>
  </header>
  <main class="essay">
    <section id="the-catch">
      <h2 class="section-head">The catch</h2>
      <p>Someone always pays.</p>
    </section>
  </main>
  <footer class="footer">
    <p>Source A &middot; Source B</p>
  </footer>
</div>
<script>document.querySelectorAll('.flip-card').forEach(function () {});</script>
</body>
</html>`;

describe('slugify', () => {
  it('matches htmlBuilder.ts behavior', () => {
    expect(slugify('Why "No-Cost EMI" Isn\'t Free')).toBe('why-no-cost-emi-isnt-free');
  });
});

describe('blogPostFragmentFromHtml', () => {
  it('extracts and unescapes title, description, and category', () => {
    const fragment = blogPostFragmentFromHtml(SAMPLE_HTML);
    expect(fragment.title).toBe('Why "No-Cost EMI" Isn\'t Free');
    expect(fragment.metaDescription).toBe('A look at who actually pays for "no-cost" EMI.');
    expect(fragment.categoryRaw).toBe('Personal Finance & Money');
  });

  it('builds bodyMdx from the style block, article body, footer, and script', () => {
    const fragment = blogPostFragmentFromHtml(SAMPLE_HTML);
    expect(fragment.bodyMdx).toContain('<style>');
    expect(fragment.bodyMdx).toContain('.essay p{margin:0;}');
    expect(fragment.bodyMdx).toContain('<h2 class="section-head">The catch</h2>');
    expect(fragment.bodyMdx).toContain('<footer class="footer">');
    expect(fragment.bodyMdx).toContain('Source A &middot; Source B');
    expect(fragment.bodyMdx).toContain("document.querySelectorAll('.flip-card')");
    // Never carries the <h1>/.dek header through — the site's own layout renders
    // title/description from frontmatter, so duplicating it would show it twice.
    expect(fragment.bodyMdx).not.toContain('<h1>');
    expect(fragment.bodyMdx).not.toContain('class="dek"');
  });

  it('strips bare element/universal selectors from the style block but keeps class-scoped and :root rules', () => {
    const fragment = blogPostFragmentFromHtml(SAMPLE_HTML);
    expect(fragment.bodyMdx).toContain(':root{--ink:#181818;}');
    expect(fragment.bodyMdx).toContain("h2.section-head{font-size:1.4rem;}");
    expect(fragment.bodyMdx).not.toMatch(/(^|\n|\})\s*\*\s*\{/);
    expect(fragment.bodyMdx).not.toMatch(/(^|\n|\})\s*html\s*\{/);
    expect(fragment.bodyMdx).not.toMatch(/(^|\n|\})\s*body\s*\{/);
    expect(fragment.bodyMdx).not.toMatch(/(^|\n|\})\s*h1\s*,\s*h2\s*\{/);
    // The @media block itself survives, with only its bare `body` sub-rule dropped.
    expect(fragment.bodyMdx).toContain('@media (max-width:560px)');
    expect(fragment.bodyMdx).toContain('.essay p{margin:0 0 8px;}');
    expect(fragment.bodyMdx).not.toContain('body{font-size:16.5px;}');
  });

  it('throws a clear error when a required section is missing', () => {
    expect(() => blogPostFragmentFromHtml('<html><body>no title here</body></html>')).toThrow(BlogHtmlParseError);
  });

  it('wraps style/script content as a JS template-literal expression, since MDX parses raw <style>/<script> braces as JSX', () => {
    const fragment = blogPostFragmentFromHtml(SAMPLE_HTML);
    expect(fragment.bodyMdx).toMatch(/<style>\{`[\s\S]*`\}<\/style>/);
    expect(fragment.bodyMdx).toMatch(/<script>\{`[\s\S]*`\}<\/script>/);
  });

  it('escapes backticks and ${ sequences so the template literal stays valid JS', () => {
    const htmlWithBacktick = SAMPLE_HTML.replace(
      "document.querySelectorAll('.flip-card').forEach(function () {});",
      'const x = `weird${1}`; // backtick test',
    );
    const fragment = blogPostFragmentFromHtml(htmlWithBacktick);
    expect(fragment.bodyMdx).toContain('\\`weird\\${1}\\`');
  });
});
