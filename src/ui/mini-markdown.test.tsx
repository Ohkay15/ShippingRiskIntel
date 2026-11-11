import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MiniMarkdown } from "./mini-markdown";

const html = (text: string) => renderToStaticMarkup(<MiniMarkdown text={text} />);

describe("MiniMarkdown", () => {
  it("renders lists, bold, code and internal links", () => {
    const out = html("**3 shipments** have gaps:\n\n- [SH-001](/shipments/x) — `HH`");
    expect(out).toContain("<strong>3 shipments</strong>");
    expect(out).toContain('<a href="/shipments/x">SH-001</a>');
    expect(out).toContain("<code>HH</code>");
    expect(out).toContain("<ul><li>");
  });

  it("leaves snake_case identifiers alone but italicizes _words_", () => {
    expect(html("Rule: dg_cert_missing")).toContain("dg_cert_missing");
    expect(html("an _estimate_ only")).toContain("<em>estimate</em>");
  });

  it("never renders raw HTML or unsafe link schemes", () => {
    const out = html('<img src=x onerror=alert(1)> [click](javascript:alert(1))');
    expect(out).not.toContain("<img");
    expect(out).not.toContain("javascript:");
    expect(out).toContain("&lt;img");
  });
});
