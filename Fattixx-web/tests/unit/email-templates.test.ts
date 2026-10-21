import { describe, expect, it } from "vitest";
import { TEMPLATES, fillTemplate, htmlToText, brandedLayout } from "@/lib/email-templates";
import { contrastText } from "@/lib/branding";

describe("email templates", () => {
  it("escapes {{vars}} and inserts {{{raw}}} HTML", () => {
    const out = fillTemplate("<p>{{name}} · {{{rows}}} · {{missing}}</p>", { name: "<b>Jane</b>", rows: "<tr><td>x</td></tr>" });
    expect(out).toBe("<p>&lt;b&gt;Jane&lt;/b&gt; · <tr><td>x</td></tr> · </p>");
  });

  it("every default template renders its sample without leftover placeholders", () => {
    for (const t of TEMPLATES) {
      const vars = { platform_name: "Fattixx", support_email: "help@fattixx.com", ...t.sample };
      const body = fillTemplate(t.body, vars);
      const subject = fillTemplate(t.subject, vars);
      expect(body, t.key).not.toMatch(/\{\{/);
      expect(subject, t.key).not.toMatch(/\{\{/);
      expect(subject.length, t.key).toBeGreaterThan(5);
    }
  });

  it("produces a readable text version that keeps link URLs", () => {
    const text = htmlToText('<p>Hello <strong>Jane</strong></p><p><a href="https://x.test/t/1">Open ticket</a></p><table><tr><td>1 × GA</td><td>$25.00</td></tr></table>');
    expect(text).toContain("Hello Jane");
    expect(text).toContain("Open ticket: https://x.test/t/1");
    expect(text).toContain("1 × GA  $25.00");
    expect(text).not.toMatch(/<[^>]+>/);
  });

  it("branded layout uses the accent colour and logo", () => {
    const html = brandedLayout("Title", "<p>Body</p>", { name: "Acme Tix", color: "#123456", logoPath: "orgs/logo.webp", supportEmail: "s@acme.test" }, "https://acme.test");
    expect(html).toContain("background:#123456");
    expect(html).toContain('src="https://acme.test/api/uploads/orgs/logo.webp"');
    expect(html).toContain("s@acme.test");
  });

  it("picks readable text colour for a brand colour", () => {
    expect(contrastText("#f59e0b")).toBe("#18181b");
    expect(contrastText("#1e3a8a")).toBe("#ffffff");
    expect(contrastText("nonsense")).toBe("#18181b");
  });
});
