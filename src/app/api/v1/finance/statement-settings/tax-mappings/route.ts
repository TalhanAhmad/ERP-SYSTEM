import { statementSettingMutation } from "@/modules/finance/reports/statements/http";
export const POST = (r: Request) =>
  statementSettingMutation(r, "TAX_MAPPING_SET");
