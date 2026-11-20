import { openingRead, openingMutation } from "@/modules/finance/opening/http";
export async function GET(request: Request) {
  return openingRead(request, "LIST");
}
export async function POST(request: Request) {
  return openingMutation(request, "CREATE");
}
