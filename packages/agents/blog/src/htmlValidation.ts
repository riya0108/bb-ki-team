// Deterministic structural checks against spec 12.5's HTML requirements. Runs on
// output this package itself assembled (htmlBuilder.ts), so these mostly guard
// against future changes to the builder rather than model misbehavior — the model
// never touches raw HTML directly (see htmlBuilder.ts's comment).

import { INTERACTIVE_SCRIPT } from './htmlBuilder.js';

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

  // htmlBuilder.ts emits at most one <script> tag, and its source is always exactly
  // INTERACTIVE_SCRIPT (never interpolated with model output) — anything else,
  // including an external `src=`, a tracking snippet, or injected content, fails.
  const scriptMatches = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)];
  for (const match of scriptMatches) {
    const attrs = match[1] ?? '';
    const body = (match[2] ?? '').trim();
    if (/\bsrc\s*=/i.test(attrs)) {
      issues.push('Contains a <script src="..."> tag — never load external/tracking scripts (spec 12.5).');
    } else if (body !== INTERACTIVE_SCRIPT.trim()) {
      issues.push('Contains a <script> tag whose content is not the builder\'s known interactive script (spec 12.5).');
    }
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
    issues.push(`Duplicate element id(s): ${[...new Set(duplicateIds)].join(', ')} — heading anchors must be unique.`);
  }

  return { valid: issues.length === 0, issues };
}
