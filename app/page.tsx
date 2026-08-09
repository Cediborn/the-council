import { CouncilApp } from "@/components/council/CouncilApp";

export default function HomePage() {
  return (
    <main className="bg-council min-h-dvh">
      <div className="grain-overlay pointer-events-none fixed inset-0 opacity-30" aria-hidden="true" />
      <CouncilApp />
    </main>
  );
}
