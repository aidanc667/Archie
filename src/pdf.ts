// src/pdf.ts
import { mdToPdf } from "md-to-pdf";

// Minimal monochrome design, deliberately restrained: near-black/gray text,
// a small solid accent mark (not a full-width gradient banner), uppercase
// tracked section headers with a thin underline, one muted color used
// sparingly. Intended to read like an audit/consulting deliverable, not a
// SaaS product page.
const PDF_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap');

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: Georgia, 'Times New Roman', 'Source Serif 4', serif;
    font-size: 11pt;
    line-height: 1.7;
    color: #1a1a1a;
    background: #ffffff;
    padding: 0;
  }

  /* Small accent mark at the top of the first page, not a full-width banner */
  body::before {
    content: '';
    display: block;
    height: 3px;
    width: 60px;
    background: #1a1a1a;
    margin-bottom: 40px;
  }

  h1 {
    font-size: 24pt;
    font-weight: 700;
    color: #1a1a1a;
    letter-spacing: -0.3px;
    margin-bottom: 6px;
  }

  h1 + p {
    font-size: 10pt;
    color: #666666;
    font-style: italic;
    margin-bottom: 28px;
    padding-bottom: 20px;
    border-bottom: 1px solid #d0d0d0;
  }

  h2 {
    font-size: 12pt;
    font-weight: 700;
    color: #1a1a1a;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    margin-top: 30px;
    margin-bottom: 10px;
    padding-bottom: 6px;
    border-bottom: 1px solid #1a1a1a;
  }

  h3 {
    font-size: 11.5pt;
    font-weight: 700;
    color: #1a1a1a;
    margin-top: 18px;
    margin-bottom: 6px;
  }

  p {
    margin-bottom: 12px;
    color: #2b2b2b;
  }

  ul, ol {
    margin: 0 0 14px 22px;
    color: #2b2b2b;
  }

  li {
    margin-bottom: 5px;
  }

  li::marker {
    color: #666666;
  }

  strong {
    font-weight: 700;
    color: #1a1a1a;
  }

  code {
    font-family: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace;
    font-size: 9.5pt;
    background: #f2f2f2;
    color: #1a1a1a;
    padding: 1px 5px;
    border-radius: 2px;
  }

  blockquote {
    border-left: 2px solid #999999;
    background: #f7f7f7;
    margin: 16px 0;
    padding: 10px 16px;
  }

  blockquote p {
    color: #444444;
    margin: 0;
    font-style: italic;
  }

  hr {
    border: none;
    border-top: 1px solid #d0d0d0;
    margin: 26px 0;
  }

  /* Tables */
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 16px 0;
    font-size: 10.5pt;
  }

  th {
    background: #f2f2f2;
    color: #1a1a1a;
    font-weight: 700;
    text-align: left;
    padding: 8px 12px;
    border-bottom: 1px solid #1a1a1a;
  }

  td {
    padding: 8px 12px;
    color: #2b2b2b;
    border-bottom: 1px solid #d0d0d0;
  }

  tr:last-child td {
    border-bottom: none;
  }

  /* Page footer */
  @page {
    margin: 18mm 20mm 22mm 20mm;
    @bottom-center {
      content: "ARCHIE Architecture Report  ·  Page " counter(page) " of " counter(pages);
      font-family: Georgia, serif;
      font-size: 8pt;
      color: #999999;
    }
  }
`;

export async function convertToPdf(text: string, outPath: string): Promise<void> {
  await mdToPdf(
    { content: text },
    {
      dest: outPath,
      css: PDF_CSS,
      pdf_options: {
        format: "A4",
        printBackground: true,
        margin: { top: "18mm", right: "20mm", bottom: "22mm", left: "20mm" },
      },
      // GitHub Actions' Ubuntu runners have no usable Chromium sandbox
      // (unprivileged user namespaces are restricted), so Puppeteer's
      // default launch crashes there with "No usable sandbox!". --no-sandbox
      // is standard for CI environments; only applied under CI, not locally.
      launch_options: process.env.CI ? { args: ["--no-sandbox"] } : {},
    }
  );
}
