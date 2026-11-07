import { makeCrud } from "@/lib/crud";
import { EXPENSE_FIELDS, validateNewExpense } from "@/lib/expense-fields";

const { POST } = makeCrud("expenses", [...EXPENSE_FIELDS], validateNewExpense);
export { POST };
