import "server-only";
import { parseRuntime } from "@/lib/runtime-config";
export const env = parseRuntime(process.env);
