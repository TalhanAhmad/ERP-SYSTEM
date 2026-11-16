export const assetErrors: Record<string, string> = {
  FINANCE_ASSET_EVENT_MISMATCH:
    "Asset history, journal and derived balances must agree.",
  FINANCE_ASSET_STALE_BASIS:
    "Asset values or policy changed. Refresh and review this draft before posting.",
  FINANCE_ASSET_DATE_ORDER:
    "Use a date on or after the asset’s latest posted movement.",
  FINANCE_ASSET_CAPACITY:
    "The movement would overstate cost, create negative depreciation/value, or exceed the remaining balance.",
  FINANCE_ASSET_MAPPING:
    "Choose active reviewed asset, depreciation and result mappings.",
  FINANCE_ASSET_MONTH:
    "Choose a valid confirmed schedule month and a posting date on or after its month end.",
  FINANCE_ASSET_MONTH_ORDER: "Post or resolve earlier schedule months first.",
  FINANCE_ASSET_POLICY_REVIEW:
    "A correction or value change requires a reviewed prospective policy before more depreciation.",
  FINANCE_ASSET_POLICY_USED:
    "Posted policy is retained. Record a dated reviewed policy change.",
  FINANCE_ASSET_DISPOSED:
    "Reverse the disposal before recording further asset activity.",
  FINANCE_ASSET_MOVEMENT_IMMUTABLE:
    "Posted asset movements retain their history; use a dated reversal.",
  FINANCE_ASSET_SOURCE:
    "Choose a posted fixed-asset bill line or eligible founder-funded asset source.",
  FINANCE_ASSET_SOURCE_CAPACITY:
    "Registered assets would exceed this purchase’s remaining net cost. Void an unused registration or use a separate eligible source.",
  FINANCE_ASSET_IMMUTABLE:
    "Purchase source and cost are retained. Correct an unused registration by voiding it and registering again.",
  FINANCE_ASSET_CUSTODIAN:
    "Choose an active person for a new custody assignment.",
  FINANCE_ASSET_POLICY:
    "Confirm the full-month convention with evidence and a first month on or after service/recognition.",
};
