import React, { useEffect, useState } from 'react';
import TaskCard from './components/TaskCard';
import type { Task } from './db';

function App() {
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    // Mock task data for demonstration
    setTasks([
      { id: '1', user_id: 'user1', task_name: 'Buy groceries', due_date: null, is_completed: false, original_request: 'Buy groceries' },
      { id: '2', user_id: 'user1', task_name: 'Pay bills', due_date: '2025-01-01', is_completed: false, original_request: 'Pay bills' },
      { id: '3', user_id: 'user1', task_name: 'Walk the dog', due_date: null, is_completed: false, original_request: 'Walk the dog' },
    ]);
  }, []);

  const handleGoogleLogin = () => {
    window.location.href = 'http://localhost:3000/api/auth/google';
  };

  return (
    <>
      <div className="card">
        <button onClick={handleGoogleLogin}>
          Login with Google
        </button>
      </div>
      <div className="task-list">
        {tasks.map(task => (
          <TaskCard key={task.id} task={task} />
        ))}
      </div>
    </>
  );
}

export default App;
