export const dynamic = "force-dynamic";

import {
  CATEGORIES,
  getBudgetSummary,
  listExpenses,
  listTodos,
  listTrips,
} from "@/lib/queries";
import BudgetClient from "./BudgetClient";
import Header from "./Header";
import { requireTravelUser } from "./session";

export default async function TravelBudgetPage() {
  const user = await requireTravelUser();
  const [summary, expenses, trips, todos] = await Promise.all([getBudgetSummary(), listExpenses(), listTrips(), listTodos()]);
  return (
    <>
      <Header user={user} />
      <BudgetClient
        user={user}
        summary={summary}
        expenses={expenses}
        trips={trips.map((t) => ({ id: t.id, name: t.name, start_date: t.start_date }))}
        categories={CATEGORIES}
        todos={todos}
      />
    </>
  );
}
