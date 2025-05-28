import { z } from 'zod';

export const klepTasksSchema = z.record(z.string(), z.string());

export type TasksFile = z.infer<typeof klepTasksSchema>;

export default klepTasksSchema;
