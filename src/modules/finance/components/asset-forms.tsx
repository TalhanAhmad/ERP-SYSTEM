"use client";
import { useState } from "react";
import { FinanceActionForm } from "./finance-action-form";
import { AccountPicker } from "./account-picker";
import type { assetDetail } from "../assets/service";
type Asset = Awaited<ReturnType<typeof assetDetail>>["item"];
export function AssetForm({ item, hosted }: { item?: Asset; hosted: boolean }) {
  const [sourceKind, setSourceKind] = useState(
      item?.fundingMovementId ? "FUNDING_MOVEMENT" : "BILL_LINE",
    ),
    [source, setSource] = useState(
      item?.billLineId ?? item?.fundingMovementId ?? null,
    ),
    [custodian, setCustodian] = useState(item?.custodianId ?? null),
    [convention, setConvention] = useState(item?.convention ?? "PENDING");
  return (
    <FinanceActionForm
      hosted={hosted}
      label={item ? "Save asset details" : "Register purchased asset"}
      endpoint={"/api/v1/finance/assets" + (item ? "/" + item.id : "")}
      method={item ? "PATCH" : "POST"}
      redirectPrefix={item ? undefined : "/finance/assets/"}
      business={(f) => ({
        tag: String(f.get("tag")),
        description: String(f.get("description")),
        location: String(f.get("location")),
        custodianId: custodian,
        inServiceDate: item?.usedAt
          ? item.inServiceDate
          : String(f.get("inServiceDate")),
        usefulLifeMonths: item?.usedAt
          ? item.usefulLifeMonths
          : Number(f.get("usefulLifeMonths")),
        residualValue: item?.usedAt
          ? item.residualValue
          : String(f.get("residualValue")),
        depreciationMethod: "STRAIGHT_LINE",
        convention: item?.usedAt ? item.convention : convention,
        firstDepMonth: item?.usedAt
          ? item.firstDepMonth
          : convention === "PENDING"
            ? null
            : String(f.get("firstDepMonth")),
        policyEvidence: item?.usedAt
          ? item.policyEvidence
          : convention === "PENDING"
            ? null
            : String(f.get("policyEvidence")),
        reason: String(f.get("reason")),
        ...(item
          ? { expectedVersion: item.version }
          : {
              billLineId: sourceKind === "BILL_LINE" ? source : null,
              fundingMovementId:
                sourceKind === "FUNDING_MOVEMENT" ? source : null,
              cost: String(f.get("cost")),
            }),
      })}
    >
      {!item && (
        <>
          <label>
            Posted purchase source type
            <select
              value={sourceKind}
              onChange={(e) => {
                setSourceKind(e.target.value);
                setSource(null);
              }}
            >
              <option value="BILL_LINE">
                Posted bill or paid-expense asset line
              </option>
              <option value="FUNDING_MOVEMENT">
                Founder-funded asset or noncash capital
              </option>
            </select>
          </label>
          <AccountPicker
            key={sourceKind}
            kind={
              sourceKind === "BILL_LINE"
                ? "asset-bill-line"
                : "asset-funding-source"
            }
            label="Posted asset purchase"
            value={source}
            onChange={setSource}
            required
          />
          <label>
            Allocated purchase cost (PKR)
            <input name="cost" inputMode="decimal" required />
          </label>
          <p>
            Cost comes from the posted asset debit, excluding recoverable tax.
            Registration allocates the purchase and creates no additional
            journal. Multiple assets cannot exceed the source’s unallocated net
            cost.
          </p>
        </>
      )}
      <div className="form-grid">
        <label>
          Asset tag
          <input
            name="tag"
            required
            minLength={3}
            maxLength={40}
            defaultValue={item?.tag}
          />
        </label>
        <label>
          Location
          <input
            name="location"
            required
            maxLength={160}
            defaultValue={item?.location}
          />
        </label>
      </div>
      <label>
        Asset description
        <textarea
          name="description"
          required
          maxLength={1000}
          defaultValue={item?.description}
        />
      </label>
      <AccountPicker
        kind="asset-custodian"
        label="Custodian (optional)"
        value={custodian}
        onChange={setCustodian}
        initial={
          item?.custodian && custodian
            ? [
                {
                  id: custodian,
                  code: "@" + item.custodian.username,
                  name: item.custodian.displayName,
                },
              ]
            : []
        }
      />
      <fieldset disabled={!!item?.usedAt}>
        <legend>Initial depreciation policy</legend>
        <div className="form-grid">
          <label>
            In-service date
            <input
              name="inServiceDate"
              type="date"
              required
              defaultValue={item?.inServiceDate}
            />
          </label>
          <label>
            Useful life (months)
            <input
              name="usefulLifeMonths"
              type="number"
              required
              min={1}
              max={1200}
              defaultValue={item?.usefulLifeMonths}
            />
          </label>
          <label>
            Residual value (PKR)
            <input
              name="residualValue"
              inputMode="decimal"
              required
              defaultValue={item?.residualValue ?? "0.00"}
            />
          </label>
        </div>
        <p>
          Depreciation method: straight line. Purchase source and cost stay in
          history; correcting an unused source allocation requires voiding its
          registration.
        </p>
        <label>
          Monthly convention review
          <select
            value={convention}
            onChange={(e) => setConvention(e.target.value)}
          >
            <option value="PENDING">Pending company confirmation</option>
            <option value="FULL_MONTH_FROM_FIRST_MONTH">
              Confirmed full month from the chosen first month
            </option>
          </select>
        </label>
        {convention === "FULL_MONTH_FROM_FIRST_MONTH" && (
          <>
            <label>
              First depreciation month
              <input
                name="firstDepMonth"
                type="month"
                required
                defaultValue={item?.firstDepMonth ?? ""}
              />
            </label>
            <label>
              Convention approval evidence
              <textarea
                name="policyEvidence"
                required
                minLength={3}
                maxLength={1000}
                defaultValue={item?.policyEvidence ?? ""}
              />
            </label>
          </>
        )}
      </fieldset>
      {item?.usedAt && (
        <p>
          Initial policy is locked after use. Record a dated policy change for
          future charges.
        </p>
      )}
    </FinanceActionForm>
  );
}
export function AssetVoidForm({
  item,
  hosted,
}: {
  item: Asset;
  hosted: boolean;
}) {
  return (
    <FinanceActionForm
      hosted={hosted}
      label="Void unused registration"
      endpoint={"/api/v1/finance/assets/" + item.id + "/void"}
      business={(f) => ({
        expectedVersion: item.version,
        reason: String(f.get("reason")),
      })}
    >
      <label className="check-label">
        <input type="checkbox" required />I reviewed this unused registration.
        Its purchase journal will remain, and its allocation will be released.
      </label>
    </FinanceActionForm>
  );
}
