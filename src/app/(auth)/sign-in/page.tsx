import { redirect } from "next/navigation";

import { safeNextPath } from "@/auth/constants";
import { getCurrentUser } from "@/auth/session";
import { SignInForm } from "@/ui/auth-forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in · ShippingRiskIntel" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const next = safeNextPath((await searchParams).next);
  if (await getCurrentUser()) redirect(next);
  return (
    <>
      <h1>Sign in</h1>
      <p className="auth-lead">Score every shipment, see its coverage gap, and track conditions on the lane.</p>
      <SignInForm next={next} />
    </>
  );
}
