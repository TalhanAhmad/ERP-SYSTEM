export const financeSections = [
  {
    label: "Daily transactions",
    description: "Create and review billing, cash entries and journal drafts.",
    links: [
      {
        label: "Invoices",
        href: "/finance/invoices",
      },
      {
        label: "Receipts",
        href: "/finance/receipts",
      },
      {
        label: "Bills & expenses",
        href: "/finance/bills",
      },
      {
        label: "Supplier payments",
        href: "/finance/supplier-payments",
      },
      {
        label: "Cash register",
        href: "/finance/cash-register",
      },
      {
        label: "Journals",
        href: "/finance/journals",
      },
    ],
  },
  {
    label: "Client adjustments",
    description:
      "Apply held funds and retain corrections to client settlements.",
    links: [
      {
        label: "Apply advances",
        href: "/finance/advance-applications",
      },
      {
        label: "Credits",
        href: "/finance/customer-credits",
      },
      {
        label: "Refunds",
        href: "/finance/customer-refunds",
      },
      {
        label: "Settlement releases",
        href: "/finance/receipt-unallocations",
      },
    ],
  },
  {
    label: "Supplier adjustments",
    description:
      "Apply supplier funds and review credits, refunds and releases.",
    links: [
      {
        label: "Supplier advances",
        href: "/finance/supplier-applications",
      },
      {
        label: "Supplier credits",
        href: "/finance/supplier-credits",
      },
      {
        label: "Supplier refunds",
        href: "/finance/supplier-refunds",
      },
      {
        label: "Payment releases",
        href: "/finance/supplier-releases",
      },
    ],
  },
  {
    label: "Reports",
    description:
      "Inspect posted statements, supporting ledgers and private exports.",
    links: [
      {
        label: "General ledger",
        href: "/finance/reports/general-ledger",
      },
      {
        label: "Trial balance",
        href: "/finance/reports/trial-balance",
      },
      {
        label: "Roll-forward reports",
        href: "/finance/reports/roll-forwards/PROJECTS",
      },
      {
        label: "Receivables ageing",
        href: "/finance/reports/receivables-ageing",
      },
      {
        label: "Payables ageing",
        href: "/finance/reports/payables-ageing",
      },
      {
        label: "Direct cash flow",
        href: "/finance/reports/cash-flow",
      },
      {
        label: "Profit and loss",
        href: "/finance/reports/profit-loss",
      },
      {
        label: "Balance sheet",
        href: "/finance/reports/balance-sheet",
      },
      {
        label: "Report exports",
        href: "/finance/exports",
      },
      {
        label: "Statement presentation",
        href: "/finance/report-settings",
      },
    ],
  },
  {
    label: "Projects & planning",
    description: "Review project costs, budgets and cash forecasts.",
    links: [
      {
        label: "Commercial projects",
        href: "/finance/projects",
      },
      {
        label: "Cost allocations",
        href: "/finance/cost-allocations",
      },
      {
        label: "Budgets",
        href: "/finance/budgets",
      },
      {
        label: "Cash forecasts",
        href: "/finance/forecasts",
      },
    ],
  },
  {
    label: "Assets & funding",
    description: "Track assets, investments, loans and financing movements.",
    links: [
      {
        label: "Fixed assets",
        href: "/finance/assets",
      },
      {
        label: "Asset movements",
        href: "/finance/asset-movements",
      },
      {
        label: "Investments",
        href: "/finance/investments",
      },
      {
        label: "Loans",
        href: "/finance/loans",
      },
      {
        label: "Founder funding",
        href: "/finance/funding",
      },
      {
        label: "Transfers",
        href: "/finance/transfers",
      },
    ],
  },
  {
    label: "Banking & evidence",
    description:
      "Review bank statements, reconciliation and retained source evidence.",
    links: [
      {
        label: "Bank statements",
        href: "/finance/statements",
      },
      {
        label: "Bank matching",
        href: "/finance/bank-matches",
      },
      {
        label: "Bank reconciliations",
        href: "/finance/reconciliations",
      },
      {
        label: "Evidence",
        href: "/finance/attachments",
      },
    ],
  },
  {
    label: "Setup & controls",
    description:
      "Maintain accounting references, periods, schedules and finance access.",
    links: [
      {
        label: "Parties",
        href: "/finance/parties",
      },
      {
        label: "Cash accounts",
        href: "/finance/cash-accounts",
      },
      {
        label: "Accounts",
        href: "/finance/accounts",
      },
      {
        label: "Periods",
        href: "/finance/periods",
      },
      {
        label: "Fiscal years",
        href: "/finance/fiscal-years",
      },
      {
        label: "Opening balances",
        href: "/finance/openings",
      },
      {
        label: "Recurring drafts",
        href: "/finance/automation",
      },
      {
        label: "Revenue recognition",
        href: "/finance/recognitions",
      },
      {
        label: "Opening credit reviews",
        href: "/finance/opening-credit-reviews",
      },
      {
        label: "Tax policies",
        href: "/finance/tax-codes",
      },
      {
        label: "Access",
        href: "/finance/access",
      },
    ],
  },
] as const;
