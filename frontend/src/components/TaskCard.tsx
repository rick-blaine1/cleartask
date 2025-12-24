import React, { useState } from 'react';
import type { Task } from '../db';

interface TaskCardProps {
  task: Task;
  onToggleComplete?: (taskId: string) => void;
  onEdit?: (taskId: string) => void;
  onDelete?: (taskId: string) => void;
}

const TaskCard: React.FC<TaskCardProps> = ({
  task,
  onToggleComplete,
  onEdit,
  onDelete
}) => {
  const [pendingDelete, setPendingDelete] = useState(false);
  const isTier1 = task.due_date === null;
  
  // Build class names based on state
  const cardClassName = `task-card ${isTier1 ? 'tier-1-task' : ''} ${pendingDelete ? 'pending-delete' : ''}`;

  const handleDeleteClick = () => {
    if (!pendingDelete) {
      // First click: enter pending delete state
      setPendingDelete(true);
    } else {
      // Second click: confirm deletion
      if (onDelete) {
        onDelete(task.id!);
      }
      setPendingDelete(false);
    }
  };

  const handleCancelDelete = () => {
    setPendingDelete(false);
  };

  const handleToggleComplete = () => {
    if (onToggleComplete && task.id) {
      onToggleComplete(task.id);
    }
  };

  const handleEdit = () => {
    if (onEdit && task.id) {
      onEdit(task.id);
    }
  };

  return (
    <div className={cardClassName}>
      <div className="task-card-content">
        <div className="task-card-header">
          <h3 className="task-card-title">{task.task_name}</h3>
          {isTier1 && <span className="task-card-badge">No Date</span>}
        </div>
        <p className="task-card-due-date">
          {task.due_date ? `Due: ${new Date(task.due_date).toLocaleDateString()}` : 'No due date'}
        </p>
        <p className="task-card-status">
          Status: {task.is_completed ? 'Completed' : 'Pending'}
        </p>
      </div>
      
      {pendingDelete ? (
        <div className="task-card-actions">
          <button
            className="task-card-button task-card-button-confirm-delete"
            onClick={handleDeleteClick}
            aria-label="Confirm delete task"
          >
            Confirm Delete
          </button>
          <button
            className="task-card-button task-card-button-cancel"
            onClick={handleCancelDelete}
            aria-label="Cancel delete"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="task-card-actions">
          <button
            className={`task-card-button task-card-button-complete ${task.is_completed ? 'completed' : ''}`}
            onClick={handleToggleComplete}
            aria-label={task.is_completed ? 'Mark as incomplete' : 'Mark as complete'}
          >
            {task.is_completed ? '✓ Done' : 'Complete'}
          </button>
          <button
            className="task-card-button task-card-button-edit"
            onClick={handleEdit}
            aria-label="Edit task"
          >
            Edit
          </button>
          <button
            className="task-card-button task-card-button-delete"
            onClick={handleDeleteClick}
            aria-label="Delete task"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
};

export default TaskCard;
