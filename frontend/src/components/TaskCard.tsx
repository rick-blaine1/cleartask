import React, { useState, useEffect } from 'react';
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
  onSave?: (taskId: string, newTitle: string, newDescription: string, newDate: string) => void; // New prop for saving edited description
}

const TaskCard: React.FC<TaskCardProps> = ({
  task,
  onToggleComplete,
  onEdit,
  onDelete,
  onInitiateDeleteConfirmation,
  onCancelDelete,
  isUILocked,
  isPendingDeletion,
  onSave
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedDescription, setEditedDescription] = useState(task.description || '');
  const [editedTitle, setEditedTitle] = useState(task.task_name || '');
  const [editedDate, setEditedDate] = useState(task.due_date ? task.due_date.split('T')[0] : '');

  useEffect(() => {
    setEditedDescription(task.description || '');
    setEditedTitle(task.task_name || '');
    setEditedDate(task.due_date ? task.due_date.split('T')[0] : '');
  }, [task.description, task.task_name, task.due_date]);

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

  const handleEditClick = () => {
    setEditedDescription(task.description || '');
    setEditedTitle(task.task_name || '');
    setEditedDate(task.due_date ? task.due_date.split('T')[0] : '');
    setIsEditing(true);
  };

  const handleSaveClick = () => {
    if (onSave && task.id) {
      onSave(task.id, editedTitle, editedDescription, editedDate || '');
      setIsEditing(false);
    }
  };

  const handleCancelClick = () => {
    setEditedDescription(task.description || '');
    setEditedTitle(task.task_name || '');
    setEditedDate(task.due_date ? task.due_date.split('T')[0] : '');
    setIsEditing(false);
  };

  return (
    <div className={cardClassName}>
      <div className="task-card-content">
        <div className="task-card-header">
          {isEditing ? (
            <input
              type="text"
              className="task-card-title-input task-card-title-input-large-contrast"
              value={editedTitle}
              onChange={(e) => setEditedTitle(e.target.value)}
            />
          ) : (
            <h3 className="task-card-title">{task.task_name}</h3>
          )}
          {isTier1 && <span className="task-card-badge">No Date</span>}
        </div>
        <p className="task-card-due-date">
          {isEditing ? (
            <>
              <label htmlFor={`date-input-${task.id}`} style={{ display: 'block', marginBottom: '4px' }}>
                Due Date:
              </label>
              <input
                id={`date-input-${task.id}`}
                type="date"
                className="task-card-date-input"
                value={editedDate}
                onChange={(e) => setEditedDate(e.target.value)}
                aria-label="Due date"
                aria-describedby="due-date-description"
              />
            </>
          ) : (
            task.due_date ? (() => {
              const [year, month, day] = task.due_date.split('T')[0].split('-').map(Number);
              const localDate = new Date(year, month - 1, day); // Month is 0-indexed
              const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' };
              return `Due: ${localDate.toLocaleDateString('en-US', options)}`;
            })() : 'No due date'
          )}
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
          isEditing ? (
            <>
              <button
                className="task-card-button task-card-button-save"
                onClick={handleSaveClick}
                aria-label="Save task description"
                disabled={isUILocked}
              >
                Save
              </button>
              <button
                className="task-card-button task-card-button-cancel"
                onClick={handleCancelClick}
                aria-label="Cancel editing"
                disabled={isUILocked}
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
                onClick={handleEditClick}
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
          )
        )}
      </div>
    </div>
  );
};

export default TaskCard;
