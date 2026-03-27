"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isLanding = pathname === "/";
  const isAdminRoute = pathname.startsWith("/admin");
  const adminTab = searchParams.get("tab") ?? "ingestion";
  const adminEmail = searchParams.get("email") ?? "";

  const adminTypeLabel = adminEmail.startsWith("citizen_admin")
    ? "Citizen Admin"
    : adminEmail.startsWith("hr_admin")
      ? "HR Admin"
      : adminEmail.startsWith("company_admin")
        ? "Company Admin"
        : "Administrator";

  if (isLanding || !isAdminRoute) {
    return <main className="page-wrapper">{children}</main>;
  }

  const navItems = [
    { key: "ingestion", href: "/admin", label: "Ingestion", icon: "IN" },
  ] as const;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${collapsed ? "is-collapsed" : ""}`}>
        <div className="sidebar-header">
          {!collapsed && (
            <div className="brand-wrap">
              <span className="brand-logo">⚖</span>
              <h1>Pragya</h1>
            </div>
          )}
          <button
            type="button"
            className="ghost-btn"
            onClick={() => setCollapsed((value) => !value)}
            aria-label="Toggle sidebar"
          >
            {collapsed ? ">" : "<"}
          </button>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={pathname.startsWith("/admin") && (adminTab === item.key || adminTab === "ingestion") ? "active" : ""}
              title={item.label}
            >
              <span className="nav-icon">{item.icon}</span>
              {!collapsed ? <span className="nav-label">{item.label}</span> : null}
            </Link>
          ))}
        </nav>

        {!collapsed && (
          <div className="sidebar-footer">
            <div className="avatar-badge">A</div>
            <div className="sidebar-footer-meta">
              <p>Welcome back</p>
              <strong>{adminTypeLabel}</strong>
              <Link href="/" className="sidebar-exit-link">
                Exit
              </Link>
            </div>
          </div>
        )}
      </aside>

      <main className="page-wrapper">{children}</main>
    </div>
  );
}
