import { makeCrud } from "@/lib/crud";
import { TODO_FIELDS } from "@/lib/todo-fields";

const { PUT, DELETE } = makeCrud("travel_todos", [...TODO_FIELDS]);
export { PUT, DELETE };
