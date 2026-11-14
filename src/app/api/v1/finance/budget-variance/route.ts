import { planningRead } from "@/modules/finance/planning/http";
export const GET = (r: Request) => planningRead(r, "VARIANCE");
