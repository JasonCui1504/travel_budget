import { makeCrud } from "@/lib/crud";
import { TODO_FIELDS } from "@/lib/todo-fields";

const { POST } = makeCrud("travel_todos", [...TODO_FIELDS]);
export { POST };
