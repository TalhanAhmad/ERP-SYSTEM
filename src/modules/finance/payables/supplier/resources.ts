export const supplierResources = {
  PAYMENT: {
    path: "supplier-payments",
    singular: "payment",
    plural: "Payments",
    supplierLabel: "Payment supplier",
    dateLabel: "Payment date",
  },
  ADVANCE_APPLICATION: {
    path: "supplier-applications",
    singular: "advance application",
    plural: "Advance applications",
    supplierLabel: "Application supplier",
    dateLabel: "Application date",
  },
  SUPPLIER_CREDIT: {
    path: "supplier-credits",
    singular: "credit note",
    plural: "Supplier credits",
    supplierLabel: "Credit supplier",
    dateLabel: "Credit note date",
  },
  SUPPLIER_REFUND: {
    path: "supplier-refunds",
    singular: "supplier refund",
    plural: "Supplier refunds",
    supplierLabel: "Refund supplier",
    dateLabel: "Refund date",
  },
  UNALLOCATION: {
    path: "supplier-releases",
    singular: "settlement release",
    plural: "Settlement releases",
    supplierLabel: "Supplier",
    dateLabel: "Release date",
  },
} as const;
