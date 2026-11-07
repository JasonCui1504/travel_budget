import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { TRAVEL_COOKIE, verifySessionToken } from "@/lib/auth";

/** The signed-in username; sends anyone else to the login page. */
export async function requireTravelUser(): Promise<string> {
  const store = await cookies();
  const user = verifySessionToken(store.get(TRAVEL_COOKIE)?.value);
  if (!user) redirect("/login");
  return user;
}
