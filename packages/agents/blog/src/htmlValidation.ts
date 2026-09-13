// Deterministic structural checks against spec 12.5's HTML requirements. Runs on
// output this package itself assembled (htmlBuilder.ts), so these mostly guard
// against future changes to the builder rather than model misbehavior — the model
// never touches raw HTML directly (see htmlBuilder.ts's comment).

export interface BlogHtmlValidationResult {
  valid: boolean;
  issues: string[];
}

export function validateBlogHtml(html: string): BlogHtmlValidationResult {
  const issues: string[] = [];

  const h1Count = (html.match(/<h1[\s>]/gi) ?? []).length;
  if (h1Count !== 1) {
    issues.push(`Expected exactly one <h1>, found ${h1Count}.`);
  }

  if (/<script[\s>]/i.test(html)) {
    issues.push('Contains a <script> tag — never embed tracking scripts or unrelated code (spec 12.5).');
  }

  if (/\son(click|load|error|mouseover)\s*=/i.test(html)) {
    issues.push('Contains an inline event handler attribute — not allowed in article HTML.');
  }

  const imgTags = html.match(/<img\b[^>]*>/gi) ?? [];
  const imgsMissingAlt = imgTags.filter((tag) => !/\balt\s*=\s*"[^"]*"/i.test(tag));
  if (imgsMissingAlt.length > 0) {
    issues.push(`${imgsMissingAlt.length} <img> tag(s) missing an alt attribute (spec 12.5).`);
  }

  const anchorIds = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  const duplicateIds = anchorIds.filter((id, i) => anchorIds.indexOf(id) !== i);
  if (duplicateIds.length > 0) {
    issues.push(`Duplicate element id(s): ${[...new Set(duplicateIds)].join(', ')} — TOC anchors must be unique.`);
  }

  const tocHrefs = [...html.matchAll(/<nav class="toc"[\s\S]*?<\/nav>/gi)]
    .flatMap((navMatch) => [...navMatch[0].matchAll(/href="#([^"]+)"/g)])
    .map((m) => m[1]);
  const missingTargets = tocHrefs.filter((id) => !anchorIds.includes(id));
  if (missingTargets.length > 0) {
    issues.push(`TOC link(s) point to missing anchor(s): ${missingTargets.join(', ')}.`);
  }

  return { valid: issues.length === 0, issues };
}
