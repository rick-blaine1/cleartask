import React, { useEffect, useState, useRef } from 'react';
import TaskCard from './components/TaskCard';
import AuthorizedSenders from './components/AuthorizedSenders';
import MagicLinkSuccess from './components/MagicLinkSuccess';
import HelpPage from './components/HelpPage';
import VerifyEmail from './components/VerifyEmail';
import type { Task } from './db';
import { db } from './db';
import { speak, speakTaskCreated, speakAmbiguousInput } from './tts';
import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import './App.css';

// Development-only logging utility
import { devLog, devError } from './utils/devLog';

declare global {
  interface Window {
    webkitSpeechRecognition: any;
  }
}

function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [pendingDeletionTask, setPendingDeletionTask] = useState<Task | null>(null); // New state for pending deletion task
  const [isUILocked, setIsUILocked] = useState<boolean>(false); // New state for UI lock
  const [isListening, setIsListening] = useState<boolean>(false);
  const [transcript, setTranscript] = useState<string>('');
  const [authError, setAuthError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const location = useLocation();
  const isAuthorizedSendersPage = location.pathname === '/authorized-senders';
  const isHelpPage = location.pathname === '/help';

  const audioContextRef = useRef<AudioContext | null>(null);

  // Sorting function: tasks without due dates first, then tasks with due dates (ascending)
  const sortTasks = (tasksToSort: Task[]): Task[] => {
    return [...tasksToSort].sort((a, b) => {
      // Tasks without due dates come first
      if (!a.due_date && b.due_date) return -1;
      if (a.due_date && !b.due_date) return 1;
      
      // Both have due dates: sort by due date ascending
      if (a.due_date && b.due_date) {
        const dateA = new Date(a.due_date).getTime();
        const dateB = new Date(b.due_date).getTime();
        if (dateA !== dateB) return dateA - dateB;
        // If due dates are equal, sort by createdAt (ascending - older first)
        const createdAtA = new Date((a as any).createdAt || (a as any).created_at || a.date).getTime();
        const createdAtB = new Date((b as any).createdAt || (b as any).created_at || b.date).getTime();
        return createdAtA - createdAtB;
      }
      
      // Neither has due date: sort by createdAt (ascending - older first)
      const createdAtA = new Date((a as any).createdAt || (a as any).created_at || a.date).getTime();
      const createdAtB = new Date((b as any).createdAt || (b as any).created_at || b.date).getTime();
      return createdAtA - createdAtB;
    });
  };

  const initAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  };

  useEffect(() => {
    // Initialize AudioContext on first user interaction
    const handleFirstInteraction = () => {
      initAudioContext();
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
      }
      document.removeEventListener('click', handleFirstInteraction);
      document.removeEventListener('keydown', handleFirstInteraction);
    };

    document.addEventListener('click', handleFirstInteraction);
    document.addEventListener('keydown', handleFirstInteraction);

    return () => {
      document.removeEventListener('click', handleFirstInteraction);
      document.removeEventListener('keydown', handleFirstInteraction);
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    if ('webkitSpeechRecognition' in window) {
      recognitionRef.current = new window.webkitSpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onstart = () => {
        setIsListening(true);
        setTranscript(''); // Clear previous transcript on new start
      };

      recognitionRef.current.onresult = (event: any) => {
        const speechResult = event.results[0][0].transcript;
        setTranscript(speechResult);

        // Automatically send the speech result to the backend
        sendVoiceTranscriptToBackend(speechResult);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);

      };

      recognitionRef.current.onerror = (event: any) => {
        setIsListening(false);
        speakAmbiguousInput();
      };
    } else {
      // Speech recognition not available
    }
  }, []);

  const startListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.start();
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
  };

  useEffect(() => {
    const hash = window.location.hash;
    const params = new URLSearchParams(hash.substring(1));
    const token = params.get('token');
    const error = params.get('error');

    if (error === 'access_denied') {
      setAuthError('Access Denied: Your email is not on the invited users list. Please contact the administrator for access.');
      window.location.hash = ''; // Clean the URL
      setIsLoggedIn(false);
    } else if (token) {
      localStorage.setItem('jwt', token);
      setIsLoggedIn(true);
      setAuthError(null);
      window.location.hash = ''; // Clean the URL
      fetchTasks(token);
    } else if (localStorage.getItem('jwt')) {
      setIsLoggedIn(true);
      setAuthError(null);
      fetchTasks(localStorage.getItem('jwt'));
    } else {
      setIsLoggedIn(false);
    }
  }, []);

  const fetchTasks = async (token: string | null) => {
    if (!token) return;
    try {
      const response = await fetch(`${import.meta.env.VITE_APP_API_BASE_URL}/api/tasks`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      if (response.ok) {
        const data = await response.json();
        setTasks(sortTasks(data));
      } else {
        devError('Failed to fetch tasks, status:', response.status);
        setTasks([]);
      }
    } catch (error) {
      devError('Error fetching tasks:', error);
      setTasks([]);
    }
  };

  const handleInitiateDeleteConfirmation = (taskToConfirm: Task) => {
    setPendingDeletionTask(taskToConfirm);
    setIsUILocked(true);
    // Placeholder for app speaking: "Are you sure you want to delete [Task]?"

    // Placeholder for opening mic for 10 seconds

  };

  const handleCancelDeleteConfirmation = () => {
    setPendingDeletionTask(null);
    setIsUILocked(false);

  };

  const handleDeleteTask = async (taskId: string) => {
    const token = localStorage.getItem('jwt');
    if (!token) {
      return;
    }

    try {
      const response = await fetch(`${import.meta.env.VITE_APP_API_BASE_URL}/api/tasks/${taskId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        setTasks(prevTasks => sortTasks(prevTasks.filter(task => task.id !== taskId)));
        setPendingDeletionTask(null);
        setIsUILocked(false);
      } else {
        devError('Failed to delete task, status:', response.status);
        alert('Failed to delete task. Please try again.');
      }
    } catch (error) {
      devError('Error deleting task:', error);
      alert('Error deleting task. Please try again.');
    }
  };

  const handleToggleComplete = async (task: Task) => {
    const token = localStorage.getItem('jwt');
    if (!token) {
      return;
    }

    try {
      // Send a more explicit command with the task ID to help the LLM
      const newCompletionStatus = !task.is_completed;
      const transcribedText = `Mark task "${task.task_name}" with ID ${task.id} as ${newCompletionStatus ? 'completed' : 'not completed'}`;
      
      const response = await fetch(`${import.meta.env.VITE_APP_API_BASE_URL}/api/tasks/create-from-voice`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transcribedText: transcribedText,
          clientDate: new Date().toISOString(),
          clientTimezoneOffset: new Date().getTimezoneOffset(),
        }),
      });

      if (response.ok) {
        const updatedTask = await response.json();
        setTasks(prevTasks =>
          sortTasks(prevTasks.map(t => (t.id === updatedTask.id ? updatedTask : t)))
        );
        speakTaskCreated(); // Reuse for completion/incompletion feedback
      } else {
        const errorData = await response.json();
        devError('Failed to toggle task completion, status:', response.status, 'error:', errorData);
        speakAmbiguousInput();
      }
    } catch (error) {
      devError('Error toggling task completion:', error);
      speakAmbiguousInput();
    }
  };

  const triggerHapticFeedback = (pattern: number | number[]) => {
    if (window.navigator && window.navigator.vibrate) {
      window.navigator.vibrate(pattern);
    }
  };

  const playAudioFeedback = (frequency: number, duration: number) => {
    if (audioContextRef.current) {
      const oscillator = audioContextRef.current.createOscillator();
      const gainNode = audioContextRef.current.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContextRef.current.destination);

      oscillator.type = 'sine';
      oscillator.frequency.value = frequency; // value in hertz
      gainNode.gain.setValueAtTime(1, audioContextRef.current.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioContextRef.current.currentTime + duration / 1000);

      oscillator.start(audioContextRef.current.currentTime);
      oscillator.stop(audioContextRef.current.currentTime + duration / 1000);
    } else {
      devLog('AudioContext not available.');
    }
  };

  const handleGoogleLogin = () => {
    // Ensure AudioContext is initialized before using it
    initAudioContext();
    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
    playAudioFeedback(440, 100); // Example: A short tone
    triggerHapticFeedback(50); // Example: A short vibration
    window.location.href = `${import.meta.env.VITE_APP_API_BASE_URL}/api/auth/google`;
  };

  const handleMicrosoftLogin = () => {
    // Ensure AudioContext is initialized before using it
    initAudioContext();
    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
    playAudioFeedback(440, 100); // Example: A short tone
    triggerHapticFeedback(50); // Example: A short vibration
    window.location.href = `${import.meta.env.VITE_APP_API_BASE_URL}/api/auth/microsoft`;
  };

  const handleGoogleLogout = () => {
    // Ensure AudioContext is initialized before using it
    initAudioContext();
    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
    playAudioFeedback(220, 150); // Example: A lower tone
    triggerHapticFeedback([100, 50, 100]); // Example: A double vibration
    localStorage.removeItem('jwt');
    setIsLoggedIn(false);
    setTasks([]);
    window.location.href = '/'; // Redirect to root URL
  };

  const handleSaveTaskDescription = async (taskId: string, newTitle: string, newDescription: string, newDate: string) => {
    const token = localStorage.getItem('jwt');
    if (!token) {

      alert('You must be logged in to save changes.');
      return;
    }

    try {
      // Update in backend
      const response = await fetch(`${import.meta.env.VITE_APP_API_BASE_URL}/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          task_name: newTitle,
          description: newDescription,
          due_date: newDate || null,
        }),
      });

      if (response.ok) {
        const updatedTask = await response.json();
        
        // Update in React state with the response from backend
        setTasks(prevTasks =>
          sortTasks(prevTasks.map(task =>
            task.id === taskId ? updatedTask : task
          ))
        );
      } else {
        const errorData = await response.json();
        devError('Failed to save task, status:', response.status, 'error:', errorData);
        alert('Failed to save task. Please try again.');
      }
    } catch (error) {
      devError('Error saving task:', error);
      alert('Failed to save task. Please try again.');
    }
  };

  const sendVoiceTranscriptToBackend = async (transcript: string) => {
    const token = localStorage.getItem('jwt');
    if (!token) {
      return;
    }
    try {
      const apiUrl = `${import.meta.env.VITE_APP_API_BASE_URL}/api/tasks/create-from-voice`;
      const clientDate = new Date(); // Get current date/time on client
      const clientTimezoneOffset = clientDate.getTimezoneOffset(); // Get timezone offset in minutes


      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ transcribedText: transcript, clientDate: clientDate.toISOString(), clientTimezoneOffset }),
      });

      if (response.ok) {
        const taskData = await response.json();

        // Handle both create (201) and update (200) responses
        if (response.status === 201) {
          // New task created - add to list
          setTasks(prevTasks => sortTasks([...prevTasks, taskData]));
        } else if (response.status === 200) {
          // Existing task updated - replace in list
          setTasks(prevTasks => sortTasks(prevTasks.map(task =>
            task.id === taskData.id ? taskData : task
          )));
        }

        setTranscript(''); // Clear the transcript input
        speakTaskCreated();
      } else {
        const errorData = await response.json();
        devError('Failed to send voice transcript to backend, status:', response.status, 'error:', errorData);
        speakAmbiguousInput();
      }
    } catch (error) {
      devError('Error communicating with the backend to create task:', error);
      alert('Error communicating with the backend to create task.');
    }
  };

  return (
    <>
      <div className="card">
        {authError && (
          <div className="auth-error-message">
            {authError}
          </div>
        )}
        {isLoggedIn ? (
          <>
            <nav className="main-nav">
              {!isHelpPage ? (
                <>
                  <NavLink to="/" onClick={handleGoogleLogout} className="nav-button">
                    Logout
                  </NavLink>
                  {!isAuthorizedSendersPage && (
                    <button onClick={isListening ? stopListening : startListening} disabled={!('webkitSpeechRecognition' in window)} className="nav-button">
                      {isListening ? 'Stop Listening' : 'Start Voice Input'}
                    </button>
                  )}
                  <NavLink to={isAuthorizedSendersPage ? "/" : "/authorized-senders"} className="nav-button">
                    {isAuthorizedSendersPage ? "Back to Task List" : "Manage Authorized Senders"}
                  </NavLink>
                  <NavLink to="/help" className="nav-button">
                    Help
                  </NavLink>
                </>
              ) : (
                <>
                  <NavLink to="/" onClick={handleGoogleLogout} className="nav-button">
                    Logout
                  </NavLink>
                  <NavLink to="/" className="nav-button">
                    Back to Task List
                  </NavLink>
                </>
              )}
            </nav>
          </>
        ) : (
          <>
            <button onClick={handleGoogleLogin}>
              Login with Google
            </button>
            <button onClick={handleMicrosoftLogin}>
              Login with Microsoft
            </button>
          </>
        )}
      </div>
      <Routes>
        <Route path="/" element={
          <div className={`task-list ${isUILocked ? 'locked-ui-overlay' : ''}`}>
            {tasks.map(task => (
              <TaskCard
                key={task.id}
                task={task}
                onToggleComplete={handleToggleComplete}
                onInitiateDeleteConfirmation={handleInitiateDeleteConfirmation}
                onCancelDelete={handleCancelDeleteConfirmation}
                isUILocked={isUILocked}
                isPendingDeletion={pendingDeletionTask?.id === task.id}
                onDelete={handleDeleteTask} // Pass the actual delete handler
                onSave={handleSaveTaskDescription}
              />
            ))}
            {!tasks.length && isLoggedIn && (
              <div className="no-tasks-message">
                No tasks to display
              </div>
            )}
          </div>
        } />
        <Route path="/authorized-senders" element={<AuthorizedSenders />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/magic-link-success" element={<MagicLinkSuccess />} />
        <Route path="/help" element={<HelpPage />} />
      </Routes>
    </>
  );
}

export default App;
