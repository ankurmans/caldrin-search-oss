import { describe, expect, it } from "vitest";
import { parseDataforseoAnswer } from "./dataforseoEvidence";

describe("DataForSEO answer evidence", () => {
  it("keeps safe cited pages without tracking parameters and drops citation pills from prose", () => {
    const result = parseDataforseoAnswer(
      {
        datetime: "2026-09-30 18:41:09 +00:00",
        markdown:
          "- **Acme** is open source. [caldrin.co](https://caldrin.co/blog?utm_source=chatgpt.com) See [SerpBear on GitHub](https://github.com/towfiqi/serpbear).",
        sources: [
          {
            url: "https://caldrin.co/blog?utm_source=chatgpt.com",
            title: "Blog",
          },
          { url: "javascript:alert(1)" },
        ],
        search_results: [{ url: "https://example.com/retrieved" }],
      },
      "chatgpt",
    );
    expect(result).toMatchObject({
      answerText: "Acme is open source.  See SerpBear on GitHub.",
      citations: [
        {
          url: "https://caldrin.co/blog",
          domain: "caldrin.co",
          title: "Blog",
          position: 1,
        },
      ],
      collectedAt: "2026-09-30T18:41:09.000Z",
    });
  });

  it("drops markdown backslash escapes from the answer text", () => {
    const result = parseDataforseoAnswer(
      { markdown: "1\\. CoverForce is a platform\\. Costs: \\$10\\*" },
      "chatgpt",
    );
    expect(result?.answerText).toBe("1. CoverForce is a platform. Costs: $10*");
  });

  it("decodes HTML entities in the answer text without producing markup", () => {
    const result = parseDataforseoAnswer(
      {
        markdown:
          "E&amp;S lines &#38; more &lt;b&gt;bold&lt;/b&gt; &#x2014; &bogus;",
      },
      "chatgpt",
    );
    expect(result?.answerText).toBe(
      "E&S lines & more <b>bold</b> \u2014 &bogus;",
    );
  });

  it("removes NUL characters, which Postgres text columns reject", () => {
    const result = parseDataforseoAnswer(
      {
        markdown: "Ac\0me",
        sources: [{ url: "https://caldrin.co/", title: "Ac\0me" }],
      },
      "chatgpt",
    );
    expect(result).toMatchObject({
      answerMarkdown: "Acme",
      citations: [{ title: "Acme" }],
    });
  });

  // An AI Mode answer has the AI Overview's shape.
  it.each(["google_ai_overview", "google_ai_mode"] as const)(
    "reads every %s reference as a citation",
    (engine) => {
      const result = parseDataforseoAnswer(
        {
          items: [
            {
              type: "ai_overview",
              markdown: "Use SerpBear.[[1]](https://ccbd.dev/blog)",
              references: [{ url: "https://ccbd.dev/blog" }],
              items: [
                {
                  references: [{ url: "https://matomo.org/" }],
                  links: [{ url: "https://github.com/towfiqi/serpbear" }],
                },
              ],
            },
          ],
        },
        engine,
      );
      expect(result?.answerText).toBe("Use SerpBear.");
      expect(result?.citations.map((citation) => citation.domain)).toEqual([
        "ccbd.dev",
        "matomo.org",
      ]);
    },
  );

  it("names the product and store on each Google AI Mode product card", () => {
    const result = parseDataforseoAnswer(
      {
        items: [
          {
            type: "ai_overview",
            // The answer's own markdown has the card's text without the card.
            markdown: "### Top picks\n\n\n\n---\n\n- Steams milk.",
            items: [
              {
                type: "ai_overview_shopping",
                // The card's own name is HTML-escaped.
                markdown:
                  "---\n\n[![De&#39;Longhi Dedica](https://api.dataforseo.com/cdn/i/1)](https://www.google.com/search?ibp=oshop)\n\n- Steams milk.",
                items: [{ title: "De'Longhi Dedica", seller: "Best Buy" }],
              },
            ],
          },
        ],
      },
      "google_ai_mode",
    );
    expect(result?.answerText).toBe(
      "Top picks\n\n\n\n---\n\nDe'Longhi Dedica · Best Buy\n\nSteams milk.",
    );
  });

  it.each(["google_ai_overview", "google_ai_mode"] as const)(
    "cites a page a %s answer links to in its text",
    (engine) => {
      const result = parseDataforseoAnswer(
        {
          items: [
            {
              type: "ai_overview",
              markdown:
                "Buy it via [LovelySkin](https://www.lovelyskin.com/o/spf).[[1]](https://ccbd.dev/blog) ![Tube](https://cdn.example/tube.png) [Shop](https://www.google.com/search?ibp=oshop)",
              references: [{ url: "https://ccbd.dev/blog", title: "Guide" }],
            },
          ],
        },
        engine,
      );
      expect(result?.citations).toMatchObject([
        { domain: "ccbd.dev", title: "Guide" },
        { domain: "www.lovelyskin.com", title: null },
      ]);
    },
  );

  it("treats a results page without an AI Overview as no answer", () => {
    expect(
      parseDataforseoAnswer(
        { items: [{ type: "organic", url: "https://caldrin.co/" }] },
        "google_ai_overview",
      ),
    ).toMatchObject({ answerMarkdown: null, citations: [] });
  });

  it("keeps the reported searches, retrieved pages and model apart from the cited pages", () => {
    const result = parseDataforseoAnswer(
      {
        model: "gpt-6",
        markdown: "Acme is a good pick.",
        fan_out_queries: ["best family tents 2026", " "],
        search_results: [
          {
            url: "https://tents.example/best?utm_source=chatgpt.com",
            title: "Best tents",
            description: "We tested seven tents.",
          },
          { url: "https://tents.example/best", title: "Duplicate" },
          { url: "https://other.example/read", title: "Not cited" },
          { url: "javascript:alert(1)" },
        ],
        sources: [{ url: "https://tents.example/best", title: "Best tents" }],
      },
      "chatgpt",
    );
    expect(result).toMatchObject({
      model: "gpt-6",
      queries: ["best family tents 2026"],
      retrievals: [
        {
          url: "https://tents.example/best",
          domain: "tents.example",
          title: "Best tents",
          description: "We tested seven tents.",
          position: 1,
        },
        { url: "https://other.example/read", position: 2 },
      ],
      citations: [
        { url: "https://tents.example/best", origin: "provider_source" },
      ],
    });
  });

  it("reports a field the provider did not return as not exposed, not as empty", () => {
    const silent = parseDataforseoAnswer({ markdown: "Hello." }, "chatgpt");
    expect(silent).toMatchObject({ queries: null, retrievals: null });
    const empty = parseDataforseoAnswer(
      { markdown: "Hello.", fan_out_queries: [], search_results: [] },
      "chatgpt",
    );
    expect(empty).toMatchObject({ queries: [], retrievals: [] });
  });

  it("never reads searches or retrieved pages from a Google AI result", () => {
    const result = parseDataforseoAnswer(
      {
        fan_out_queries: ["not an AI Overview field"],
        search_results: [{ url: "https://x.example/" }],
        items: [
          {
            type: "ai_overview",
            markdown: "See [the guide](https://guide.example/a).",
            references: [{ url: "https://src.example/a" }],
          },
        ],
      },
      "google_ai_overview",
    );
    expect(result).toMatchObject({
      queries: null,
      retrievals: null,
      model: null,
    });
    expect(result?.citations.map((c) => [c.domain, c.origin])).toEqual([
      ["src.example", "provider_source"],
      ["guide.example", "answer_link"],
    ]);
  });

  it("reads product cards from the ChatGPT products element and keeps only what is reported", () => {
    const result = parseDataforseoAnswer(
      {
        markdown: "Top picks below.",
        items: [
          {
            type: "chat_gpt_products",
            items: [
              {
                type: "chat_gpt_products_element",
                title: "Brooks Adrenaline GTS 25",
                price: 110,
                currency: "USD",
                tag: "Best overall",
                images: ["https://img.example/a.png"],
              },
              { type: "chat_gpt_products_element", title: "  " },
              {
                type: "chat_gpt_products_element",
                title: "Hoka Clifton 10",
              },
            ],
          },
        ],
      },
      "chatgpt",
    );
    expect(result?.products).toEqual([
      {
        position: 1,
        title: "Brooks Adrenaline GTS 25",
        price: 110,
        currency: "USD",
        tag: "Best overall",
        providerField: "chat_gpt_products_element",
      },
      {
        position: 2,
        title: "Hoka Clifton 10",
        price: null,
        currency: null,
        tag: null,
        providerField: "chat_gpt_products_element",
      },
    ]);
  });
});
