import React, { useState } from 'react';
import type { Task } from '../db';
import { speakDeleteConfirmationPrompt } from '../tts';

interface TaskCardProps {
  task: Task;
  onToggleComplete?: (task: Task) => void;
  onEdit?: (taskId: string) => void;
  onDelete?: (taskId: string) => void;
  onInitiateDeleteConfirmation: (task: Task) => void; // New prop for delete confirmation
  onCancelDelete: () => void; // New prop for canceling delete confirmation
  isUILocked: boolean; // New prop to indicate if UI is locked
  isPendingDeletion: boolean; // New prop to indicate if this specific task is pending deletion
}

const TaskCard: React.FC<TaskCardProps> = ({
  task,
  onToggleComplete,
  onEdit,
  onDelete,
  onInitiateDeleteConfirmation,
  onCancelDelete,
  isUILocked,
  isPendingDeletion
}) => {
  const isTier1 = task.due_date === null;
  
  // Build class names based on state
  const cardClassName = `task-card ${isTier1 ? 'tier-1-task' : ''} ${isPendingDeletion ? 'pending-delete' : ''} ${isUILocked ? 'ui-locked' : ''}`;

  const handleDeleteClick = () => {
    if (!isPendingDeletion) {
      // First click: initiate delete confirmation process in App.tsx
      onInitiateDeleteConfirmation(task);
    } else {
      // This part should ideally be handled by App.tsx after confirmation
      // For now, keep the original onDelete logic for direct deletion if needed
      if (onDelete) {
        onDelete(task.id!);
      }
    }
  };

  const handleCancelDelete = () => {
    onCancelDelete();
  };

  const handleToggleComplete = () => {
    if (onToggleComplete && task.id) {
      onToggleComplete(task);
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
          {task.due_date ? (() => {
            const [year, month, day] = task.due_date.split('T')[0].split('-').map(Number);
            const localDate = new Date(year, month - 1, day); // Month is 0-indexed
            return `Due: ${localDate.toLocaleDateString()}`;
          })() : 'No due date'}
        </p>
        <p className="task-card-status">
          Status: {task.is_completed ? 'Completed' : 'Pending'}
        </p>
      </div>
      
      <div className={`task-card-actions ${isUILocked ? 'disabled-actions' : ''}`}>
        {isPendingDeletion ? (
          <>
            <button
              className="task-card-button task-card-button-confirm-delete"
              onClick={() => onDelete && onDelete(task.id!)}
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
          </>
        ) : (
          <>
            <button
              className={`task-card-button task-card-button-complete ${task.is_completed ? 'completed' : ''}`}
              onClick={handleToggleComplete}
              aria-label={task.is_completed ? 'Mark as incomplete' : 'Mark as complete'}
              disabled={isUILocked}
            >
              {task.is_completed ? '✓ Done' : 'Complete'}
            </button>
            <button
              className="task-card-button task-card-button-edit"
              onClick={handleEdit}
              aria-label="Edit task"
              disabled={isUILocked}
            >
              Edit
            </button>
            <button
              className="task-card-button task-card-button-delete"
              onClick={handleDeleteClick}
              aria-label="Delete task"
              disabled={isUILocked}
            >
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default TaskCard;
