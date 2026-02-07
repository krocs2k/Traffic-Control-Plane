import { Navbar } from '@/components/navbar';
import { Sidebar } from '@/components/sidebar';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="flex">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <div className="container max-w-screen-2xl py-6 px-4 md:px-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
