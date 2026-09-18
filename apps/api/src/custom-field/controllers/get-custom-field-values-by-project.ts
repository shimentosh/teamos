import { and, eq } from "drizzle-orm";
import db from "../../database";
import {
  customFieldDefinitionTable,
  customFieldValueTable,
  taskTable,
} from "../../database/schema";
import { visibleTasks } from "../../utils/task-visibility";

async function getCustomFieldValuesByProject(
  projectId: string,
  viewer: string | null = null,
) {
  return db
    .select({
      id: customFieldValueTable.id,
      taskId: customFieldValueTable.taskId,
      fieldId: customFieldValueTable.fieldId,
      value: customFieldValueTable.value,
      fieldName: customFieldDefinitionTable.name,
      fieldPosition: customFieldDefinitionTable.position,
      fieldType: customFieldDefinitionTable.type,
      fieldOptions: customFieldDefinitionTable.options,
    })
    .from(customFieldValueTable)
    .innerJoin(taskTable, eq(customFieldValueTable.taskId, taskTable.id))
    .innerJoin(
      customFieldDefinitionTable,
      eq(customFieldValueTable.fieldId, customFieldDefinitionTable.id),
    )
    .where(and(eq(taskTable.projectId, projectId), visibleTasks(viewer)));
}

export default getCustomFieldValuesByProject;
