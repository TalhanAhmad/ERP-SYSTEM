import { fileRead, fileMutation } from "@/modules/finance/documents/files/http";
export const GET = (r: Request) => fileRead(r);
export const POST = (r: Request) => fileMutation(r, "RESERVE");
