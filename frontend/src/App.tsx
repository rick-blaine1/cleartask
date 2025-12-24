import React, { useState, useEffect } from 'react';
import TaskCard from './components/TaskCard';
import type { Task } from './db';

function App() {
  const [count, setCount] = useState(0);
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
      <div>
        <a href="https://vitejs.dev" target="_blank">
          <img src="/vite.svg" className="logo" alt="Vite logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src="/react.svg" className="logo react" alt="React logo" />
        </a>
      </div>
      <h1>Vite + React</h1>
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
        <button onClick={handleGoogleLogin}>
          Login with Google
        </button>
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR
        </p>
      </div>
      <div className="task-list">
        {tasks.map(task => (
          <TaskCard key={task.id} task={task} />
        ))}
      </div>
      <p className="read-the-docs">
        Click on the Vite and React logos to learn more
      </p>
    </>
  );
}

export default App;
