export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { calendarToken } from "@/lib/auth";
import { CATEGORIES, getTrip, listPeople } from "@/lib/queries";
import Header from "../../Header";
import { requireTravelUser } from "../../session";
import TripClient from "./TripClient";

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireTravelUser();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [data, people] = await Promise.all([getTrip(id), listPeople()]);
  if (!data) notFound();
  return (
    <>
      <Header user={user} />
      <TripClient {...data} people={people} user={user} categories={CATEGORIES} calendarToken={calendarToken(id)} />
    </>
  );
}
