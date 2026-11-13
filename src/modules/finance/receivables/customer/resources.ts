export const customerResources = {
  RECEIPT: {
    path: "receipts",
    singular: "receipt",
    plural: "Receipts",
    clientLabel: "Receipt client",
    dateLabel: "Receipt date",
  },
  ADVANCE_APPLICATION: {
    path: "advance-applications",
    singular: "advance application",
    plural: "Advance applications",
    clientLabel: "Application client",
    dateLabel: "Application date",
  },
  CUSTOMER_CREDIT: {
    path: "customer-credits",
    singular: "credit note",
    plural: "Customer credits",
    clientLabel: "Credit client",
    dateLabel: "Credit note date",
  },
  CUSTOMER_REFUND: {
    path: "customer-refunds",
    singular: "customer refund",
    plural: "Customer refunds",
    clientLabel: "Refund client",
    dateLabel: "Refund date",
  },
  UNALLOCATION: {
    path: "receipt-unallocations",
    singular: "settlement release",
    plural: "Settlement releases",
    clientLabel: "Client",
    dateLabel: "Release date",
  },
} as const;
