// Shared selection for browser DTOs: never include object keys or upload leases.
export const attachmentFields = {
  id: true,
  fileName: true,
  mimeType: true,
  byteSize: true,
  status: true,
  createdAt: true,
} as const;
