import {
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "../../contexts/AuthContext";
import { useBranding } from "../../contexts/BrandingContext";
import { cn } from "../../lib/utils";

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const location = useLocation();

  // Auto-close the drawer when the route changes — covers nav-link clicks plus
  // any programmatic redirects (e.g., role-gated routes bouncing to /).
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex h-screen bg-zinc-50 text-zinc-900">
      {/* Desktop sidebar — always visible at md+ */}
      <aside className="hidden md:flex w-60 shrink-0 flex-col bg-stone-200 text-stone-700 border-r border-stone-300">
        <SidebarContents onNavigate={closeMobile} />
      </aside>

      {/* Mobile drawer — overlay + sliding sidebar */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            onClick={closeMobile}
            aria-hidden="true"
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-72 flex flex-col bg-stone-200 text-stone-700 md:hidden">
            <SidebarContents onNavigate={closeMobile} mobile onClose={closeMobile} />
          </aside>
        </>
      )}

      <main className="flex-1 flex flex-col overflow-hidden">
        <MobileHeader onOpen={() => setMobileOpen(true)} />
        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function SidebarContents({
  onNavigate,
  mobile,
  onClose,
}: {
  onNavigate: () => void;
  mobile?: boolean;
  onClose?: () => void;
}) {
  const { user, logout } = useAuth();
  const branding = useBranding();
  const isAdmin = user?.role === "admin" || user?.role === "superadmin";

  return (
    <>
      <div className="flex h-16 items-center justify-between gap-2 px-5 border-b border-stone-300 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {branding.has_logo && branding.logo_url ? (
            <img src={branding.logo_url} alt="logo" className="h-7 w-7 shrink-0" />
          ) : (
            <div className="h-7 w-7 rounded bg-stone-500 shrink-0" />
          )}
          <Link
            to="/"
            onClick={onNavigate}
            className="text-xl font-semibold tracking-tight text-stone-900 truncate"
          >
            {branding.client_name}
          </Link>
        </div>
        {mobile && onClose && (
          <button
            onClick={onClose}
            className="text-stone-600 hover:text-stone-900 p-1 rounded shrink-0"
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        <NavItem
          to="/"
          icon={<MessageSquare size={18} />}
          label="Troubleshooting"
          end
          onClick={onNavigate}
        />
        {isAdmin && (
          <NavItem
            to="/admin"
            icon={<LayoutDashboard size={18} />}
            label="Usage Dashboard"
            onClick={onNavigate}
          />
        )}
        {isAdmin && (
          <NavItem
            to="/documents"
            icon={<FileText size={18} />}
            label="Documents"
            onClick={onNavigate}
          />
        )}
        {isAdmin && (
          <NavItem
            to="/users"
            icon={<Users size={18} />}
            label="Users"
            onClick={onNavigate}
          />
        )}
        {isAdmin && (
          <>
            <div className="pt-6 pb-2 px-3 text-sm uppercase tracking-wider text-stone-500">
              Operations
            </div>
            <NavItem
              to="/cse"
              icon={<ShieldCheck size={18} />}
              label="CSE Console"
              onClick={onNavigate}
            />
          </>
        )}
      </nav>
      <div className="border-t border-stone-300 p-3 space-y-2 shrink-0">
        <div className="px-3 py-2">
          <div className="text-lg font-medium text-stone-900 truncate">
            {user?.full_name || user?.email}
          </div>
          <div className="text-sm text-stone-600 capitalize mt-0.5">{user?.role}</div>
        </div>
        <button
          onClick={logout}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-lg hover:bg-stone-300 hover:text-stone-900 transition-colors"
        >
          <LogOut size={18} />
          Sign out
        </button>
        {branding.powered_by && (
          <p className="px-3 text-xs text-stone-500 leading-tight">
            Powered by <span className="text-stone-700">{branding.powered_by}</span>
          </p>
        )}
      </div>
    </>
  );
}

function MobileHeader({ onOpen }: { onOpen: () => void }) {
  const branding = useBranding();
  return (
    <header className="md:hidden sticky top-0 z-30 flex items-center gap-3 border-b border-zinc-200 bg-white px-4 py-3">
      <button
        onClick={onOpen}
        className="text-zinc-700 hover:text-zinc-900 p-1 -ml-1 rounded"
        aria-label="Open menu"
      >
        <Menu size={22} />
      </button>
      <span className="text-xl font-semibold tracking-tight truncate">
        {branding.client_name}
      </span>
    </header>
  );
}

function NavItem({
  to,
  icon,
  label,
  end,
  onClick,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  end?: boolean;
  onClick?: () => void;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-md px-3 py-2 text-lg transition-colors",
          isActive
            ? "bg-stone-700 text-white"
            : "text-stone-700 hover:bg-stone-300 hover:text-stone-900",
        )
      }
    >
      {icon}
      {label}
    </NavLink>
  );
}
