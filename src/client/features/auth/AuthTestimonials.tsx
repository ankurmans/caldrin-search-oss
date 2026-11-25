// The panel beside the sign-in form. It states what the product does; it shows
// no customer names, quotes or photos.
const POINTS = [
  "Keyword, SERP, backlink and domain research on your own provider keys.",
  "AI answers and citations saved as evidence you can review and compare.",
  "Content drafts and site changes go through review and keep a history.",
  "One MCP endpoint lets your agent work inside the project you choose.",
];

export function AuthTestimonials() {
  return (
    <aside
      aria-label="About this installation"
      className="relative hidden flex-col justify-center overflow-hidden bg-primary p-12 text-neutral-900 lg:flex"
    >
      <div className="relative mx-auto w-full max-w-md space-y-6">
        <h2 className="text-2xl leading-snug font-semibold text-balance">
          Search evidence to a reviewed change, on your own infrastructure.
        </h2>
        <ul className="space-y-3">
          {POINTS.map((point) => (
            <li
              key={point}
              className="rounded-2xl bg-white/70 p-4 text-base leading-relaxed text-pretty shadow-sm ring-1 ring-black/5"
            >
              {point}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
