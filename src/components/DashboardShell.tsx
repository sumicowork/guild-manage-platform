'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import { AdminSwitcher } from '@/components/AdminSwitcher';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import {
  LayoutDashboard,
  FileText,
  MessageSquare,
  Users,
  AlertTriangle,
  Settings,
  RefreshCw,
  Sliders,
  LogOut,
  Menu,
} from 'lucide-react';

const navItems = [
  { href: '/', label: '仪表盘', icon: LayoutDashboard },
  { href: '/feeds', label: '帖子管理', icon: FileText },
  { href: '/comments', label: '评论管理', icon: MessageSquare },
  { href: '/members', label: '成员管理', icon: Users },
  { href: '/violations', label: '违规记录', icon: AlertTriangle },
  { href: '/violations/config', label: '违规配置', icon: Sliders },
  { href: '/crawl', label: '爬取管理', icon: RefreshCw },
  { href: '/settings', label: '系统设置', icon: Settings },
];

interface DashboardShellProps {
  children: React.ReactNode;
}

export function DashboardShell({ children }: DashboardShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [selectedIdentityId, setSelectedIdentityId] = useState<number | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = () => {
    api.clearToken();
    router.push('/login');
  };

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  const SidebarContent = () => (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center px-4">
        <h1 className="text-base font-semibold text-gray-900">频道管理平台</h1>
      </div>
      <Separator className="bg-gray-200" />
      <nav className="flex-1 space-y-0.5 px-2 py-3">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
              }`}
            >
              <Icon className="size-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <Separator className="bg-gray-200" />
      <div className="p-3">
        <AdminSwitcher selectedId={selectedIdentityId} onSelect={setSelectedIdentityId} />
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Desktop sidebar */}
      <aside className="hidden w-56 shrink-0 border-r border-gray-200 bg-white lg:block">
        <SidebarContent />
      </aside>

      {/* Mobile sidebar */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger
          render={
            <Button variant="ghost" size="icon" className="fixed top-3 left-3 z-40 lg:hidden">
              <Menu className="size-5" />
            </Button>
          }
        />
        <SheetContent side="left" className="w-56 border-gray-200 bg-white p-0">
          <SidebarContent />
        </SheetContent>
      </Sheet>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 lg:px-6">
          <div className="lg:hidden" /> {/* Spacer for mobile menu button */}
          <div className="hidden lg:block" />
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={handleLogout} className="text-gray-500 hover:text-gray-900">
              <LogOut className="size-4" />
              <span className="ml-1.5 hidden sm:inline">退出</span>
            </Button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
