import {
  exportRead,
  exportMutation,
} from "@/modules/finance/reports/exports/http";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  return exportRead(request);
}
export async function POST(request: Request) {
  return exportMutation(request, "REQUEST");
}
