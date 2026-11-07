import { makeCrud } from "@/lib/crud";
import { ESTIMATED_FIELDS } from "@/lib/estimated-fields";

const { PUT, DELETE } = makeCrud("trip_estimated_expenses", [...ESTIMATED_FIELDS]);
export { PUT, DELETE };
