import Sidebar from "@/components/Sidebar";
import ContentWidth from "@/components/ContentWidth";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 min-w-0 overflow-y-auto p-4 pt-[4.5rem] lg:p-8 animate-fade-in">
        <ContentWidth>{children}</ContentWidth>
      </main>
    </div>
  );
}
