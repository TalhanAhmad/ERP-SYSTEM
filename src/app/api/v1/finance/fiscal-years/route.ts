import { yearRead, yearMutation } from "@/modules/finance/year-closing/http";
export async function GET(request: Request) {
  return yearRead(request, "LIST");
}
export async function POST(request: Request) {
  return yearMutation(request, "CREATE");
}
