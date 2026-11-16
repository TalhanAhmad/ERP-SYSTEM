import { ageingRead } from "@/modules/finance/reports/ageing/http";
export async function GET(request: Request) {
  return ageingRead(request, "AR");
}
