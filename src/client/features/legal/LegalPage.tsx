import type { ReactNode } from "react";

// A plain public page for the Terms and Privacy Policy of this deployment.
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated?: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 text-sm leading-relaxed text-foreground">
      <a href="/" className="text-muted-foreground hover:text-foreground">
        Caldrin Search
      </a>
      <h1 className="mt-6 text-2xl font-semibold">{title}</h1>
      {updated ? (
        <p className="mt-1 text-muted-foreground">Last updated {updated}</p>
      ) : null}
      <div className="mt-8 space-y-6 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-medium [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:space-y-1">
        {children}
      </div>
    </main>
  );
}
