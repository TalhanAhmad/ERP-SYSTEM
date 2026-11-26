"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { financeSections } from "./navigation-links";

export function FinanceNavigationMenu({ demo }: { demo: boolean }) {
  const pathname = usePathname();
  return <FinanceMenu key={pathname} pathname={pathname} demo={demo} />;
}
function FinanceMenu({ pathname, demo }: { pathname: string; demo: boolean }) {
  const [query, setQuery] = useState("");
  const disclosure = useRef<HTMLDetailsElement>(null);
  const dismiss = () => {
    if (disclosure.current?.open) {
      disclosure.current.open = false;
      disclosure.current.querySelector("summary")?.focus();
    }
    setQuery("");
  };
  const search = query.trim().toLowerCase();
  const sections = financeSections
    .map((section) => ({
      ...section,
      links: section.links.filter((link) =>
        `${section.label} ${link.label}`.toLowerCase().includes(search),
      ),
    }))
    .filter((section) => section.links.length);
  const current = (href: string) =>
    pathname === href.split("?")[0] ||
    (href !== "/finance" && pathname.startsWith(href + "/"));
  const shortcuts = [
    ["Finance", "/finance"],
    ["Invoices", "/finance/invoices"],
    ["Bills & expenses", "/finance/bills"],
    ["Journals", "/finance/journals"],
  ];
  return (
    <nav aria-label="Finance navigation" className="finance-navigation">
      <div className="finance-shortcuts">
        {shortcuts.map(([label, href]) => (
          <Link
            key={href}
            href={href}
            prefetch={false}
            onNavigate={dismiss}
            aria-current={current(href) ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </div>
      <details ref={disclosure} className="finance-menu">
        <summary>Browse finance pages</summary>
        <div className="finance-menu-content">
          <label>
            Find a finance page
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search reports, payments, accounts…"
            />
          </label>
          <div className="finance-menu-groups">
            {sections.map((section) => (
              <section key={section.label} aria-label={section.label}>
                <h2>{section.label}</h2>
                <ul>
                  {section.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        prefetch={false}
                        onNavigate={dismiss}
                        aria-current={current(link.href) ? "page" : undefined}
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          {!sections.length && (
            <p role="status">
              No finance pages match your search. Try a page or group name.
            </p>
          )}
        </div>
      </details>
      {demo && (
        <div
          className="finance-demo-shortcuts"
          aria-label="January 2020 sample reports"
        >
          <span>Sample reports:</span>
          <Link
            href="/finance/reports/trial-balance?from=2020-01-01&to=2020-01-31"
            prefetch={false}
            onNavigate={dismiss}
          >
            Demo January 2020 trial balance
          </Link>
          <Link
            href="/finance/reports/profit-loss?from=2020-01-01&to=2020-01-31"
            prefetch={false}
            onNavigate={dismiss}
          >
            Demo January 2020 profit and loss
          </Link>
          <Link
            href="/finance/reports/balance-sheet?asOf=2020-01-31"
            prefetch={false}
            onNavigate={dismiss}
          >
            Demo January 2020 balance sheet
          </Link>
        </div>
      )}
    </nav>
  );
}
