export const dynamic = "force-dynamic";

import { getPlanning, listTrips } from "@/lib/queries";
import Header from "../Header";
import { requireTravelUser } from "../session";
import TripsClient from "./TripsClient";

export default async function TripsPage() {
  const user = await requireTravelUser();
  const today = new Date().toISOString().slice(0, 10);
  const [trips, planning] = await Promise.all([listTrips(), getPlanning(today)]);
  return (
    <>
      <Header user={user} />
      <TripsClient trips={trips} today={today} planning={planning} />
    </>
  );
}
