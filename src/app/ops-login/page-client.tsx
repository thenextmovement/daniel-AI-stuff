"use client";

import { useState } from "react";
import { OpsLoginCard } from "../ops/ops-login-card";
import type { OpsAppKey } from "../ops/ops-app-switcher";

function activeAppFromPath(path: string): OpsAppKey {
  if (path.startsWith("/ops/eu-supplier-3d-signs")) return "euSupplierQuotes";
  if (path.startsWith("/ops/sales-vergabe")) return "supplierSales";
  if (path.startsWith("/ops/management")) return "management";
  if (path.startsWith("/ops/tasks")) return "tasks";
  if (path.startsWith("/ops/customer-records/calls")) return "calls";
  if (path.startsWith("/ops/customer-records/price-review")) return "priceReview";
  if (path.startsWith("/ops/customer-records/shipping")) return "shipping";
  if (path.startsWith("/ops/customer-records/inbound-shipping")) return "inboundShipping";
  if (path.startsWith("/ops/offers")) return "offers";
  return "records";
}

export function OpsLoginPageClient({ nextPath }: { nextPath: string }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);


  async function login() {
    setError(null);
    const response = await fetch("/api/ops/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!response.ok) {
      setError("Ops-Login fehlgeschlagen.");
      return;
    }
    window.location.assign(nextPath);
  }

  return (
    <OpsLoginCard
      eyebrow="NEONTRIP Ops"
      title="Interner Login"
      description="Melde dich mit deinem internen Zugang an. Danach wirst du automatisch in den gewählten Bereich weitergeleitet."
      activeApp={activeAppFromPath(nextPath)}
      password={token}
      error={error}
      buttonLabel="Einloggen"
      showOperatorName={false}
      onPasswordChange={setToken}
      onSubmit={login}
    />
  );
}
