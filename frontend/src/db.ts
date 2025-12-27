import Dexie from 'dexie';
import { type Table } from 'dexie';

export interface Task {
  id?: string;
  user_id: string;
  task_name: string;
  due_date: string | null;
  is_completed: boolean;
  original_request: string;
  is_archived?: boolean;
}

export class ClearTaskDexie extends Dexie {
  tasks!: Table<Task>;

  constructor() {
    super('ClearTaskDatabase');
    this.version(1).stores({
      tasks: '++id, user_id, task_name, due_date, is_completed, original_request'
    });
  }
}

export const db = new ClearTaskDexie();
