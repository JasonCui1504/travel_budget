import { makeCrud } from "@/lib/crud";
import { EXPENSE_FIELDS } from "@/lib/expense-fields";

const { PUT, DELETE } = makeCrud("expenses", [...EXPENSE_FIELDS]);
export { PUT, DELETE };
