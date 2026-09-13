import { Readability } from '@mozilla/readability';
import { convert } from 'html-to-text';
import { JSDOM } from 'jsdom';
import pdfParse from 'pdf-parse';

export interface ExtractedHtml {
  title: string | null;
  text: string;
}

// Uses Readability (the actual Firefox Reader View algorithm) to strip nav/ads/
// boilerplate, then flattens the remaining article DOM to clean plain text.
// Falls back to the raw body when Readability can't identify an article (e.g.
// a non-article page) rather than failing the whole fetch.
export function extractReadableTextFromHtml(html: string, url: string): ExtractedHtml {
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article?.content) {
    const text = convert(dom.window.document.body.innerHTML, { wordwrap: false });
    const pageTitle = dom.window.document.title;
    return { title: pageTitle.length > 0 ? pageTitle : null, text };
  }

  const articleTitle = article.title ?? '';
  return {
    title: articleTitle.length > 0 ? articleTitle : null,
    text: convert(article.content, { wordwrap: false }),
  };
}

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const data = await pdfParse(buffer);
  return data.text;
}
