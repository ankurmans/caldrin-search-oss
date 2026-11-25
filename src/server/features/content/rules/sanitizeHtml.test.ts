import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "./sanitizeHtml";

describe("sanitizeHtml", () => {
  it("keeps plain editorial markup unchanged", () => {
    const html =
      '<h2>Heading</h2><p>Text with <strong>bold</strong> and <a href="https://shop.example/a">a link</a>.</p><ul><li>One</li></ul><img src="https://cdn.example/x.jpg" alt="Swing">';
    expect(sanitizeHtml(html)).toBe(html);
  });

  it("drops scripts with their contents, handlers and hidden-scheme links", () => {
    const out = sanitizeHtml(
      '<p onclick="x()">Hi</p><script>alert(1)</script><a href="java\tscript:alert(1)" onmouseover="y()">go</a><iframe src="https://evil.example"></iframe><img src="javascript:alert(1)">',
    );
    expect(out).toBe("<p>Hi</p><a>go</a>");
  });

  it("round-trips editor tables and encoded attributes while dropping unsafe image URLs", () => {
    const input =
      '<table><tbody><tr><td colspan="2"><p>One &amp; two</p></td></tr></tbody></table><p><a href="https://example.com/?a=1&amp;b=2">Read</a></p>';
    expect(sanitizeHtml(sanitizeHtml(input))).toBe(input);
    expect(
      sanitizeHtml(
        '<img src="javascript&#58;alert(1)"><img src="//example.com/a"><img src="/photo.jpg" alt="a &amp; b">',
      ),
    ).toBe('<img src="/photo.jpg" alt="a &amp; b">');
  });

  it("keeps only supplied sources and rewrites video embeds to a fixed host", () => {
    const body =
      '<a href="https://example.com/guide">Guide</a><a href="https://example.com/made-up">Unverified</a><iframe src="https://youtu.be/aBcD1234xyz" onload="bad()" srcdoc="bad"></iframe><iframe src="https://youtube.com.evil.example/embed/aBcD1234xyz"></iframe>';
    const result = sanitizeHtml(body, {
      links: new Set(["https://example.com/guide"]),
      images: new Set(),
      videos: new Set(["aBcD1234xyz"]),
    });
    expect(result).toBe(
      '<a href="https://example.com/guide">Guide</a>Unverified<iframe src="https://www.youtube-nocookie.com/embed/aBcD1234xyz" title="YouTube video" width="640" height="360" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation" allowfullscreen></iframe>',
    );
    expect(sanitizeHtml(result)).toBe(result);
  });

  it("removes unknown tags but keeps their text", () => {
    expect(sanitizeHtml("<div><font color=red>Hello</font></div>")).toBe(
      "Hello",
    );
  });
});
