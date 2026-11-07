import { makeCrud } from "@/lib/crud";
import { ESTIMATED_FIELDS } from "@/lib/estimated-fields";

const { POST } = makeCrud("trip_estimated_expenses", [...ESTIMATED_FIELDS]);
export { POST };
