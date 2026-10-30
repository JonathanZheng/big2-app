export function ComingSoon({ title, summary }: { title: string; summary: string }) {
  return (
    <section className="border-3 border-ink bg-card p-6 shadow-brutal">
      <h1 className="text-5xl font-black tracking-tight leading-none">{title}</h1>
      <p className="mt-6 font-mono text-sm">{summary}</p>
      <p className="mt-2 font-mono text-sm">NOT BUILT YET.</p>
    </section>
  );
}
