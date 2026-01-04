import { useEffect, useState, useRef, useCallback } from 'react';
import TaskCard from './components/TaskCard';
import AuthorizedSenders from './components/AuthorizedSenders';
import MagicLinkSuccess from './components/MagicLinkSuccess';
import HelpPage from './components/HelpPage';
import VerifyEmail from './components/VerifyEmail';
import type { Task } from './db';
import { speak, speakTaskCreated, speakAmbiguousInput, speakTaskUpdated } from './tts';
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
  const tasksRef = useRef<Task[]>([]); // Ref to hold latest tasks for closure access
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [pendingDeletionTask, setPendingDeletionTask] = useState<Task | null>(null); // State for task awaiting deletion confirmation
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState<boolean>(false); // State to control visibility of confirmation UI
  const [deleteConfirmationTimer, setDeleteConfirmationTimer] = useState<number>(10); // State for the countdown timer (starts at 10)
  const [confirmationId, setConfirmationId] = useState<string | null>(null); // State to store the confirmation ID from backend
  const deleteTimeoutRef = useRef<number | null>(null); // Ref to hold the timeout ID
  const countdownIntervalRef = useRef<number | null>(null); // Ref to hold the countdown interval ID
  const [isUILocked, setIsUILocked] = useState<boolean>(false); // State for UI lock
  const [isListening, setIsListening] = useState<boolean>(false);
  const [isAwaitingDeleteConfirmation, setIsAwaitingDeleteConfirmation] = useState<boolean>(false); // New state to track if awaiting delete confirmation
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

  // Cleanup function for delete confirmation state
  const cleanupDeleteConfirmation = useCallback(() => {
    devLog('[VOICE DEBUG] Cleaning up deletion confirmation state');
    if (deleteTimeoutRef.current) {
      clearTimeout(deleteTimeoutRef.current);
      deleteTimeoutRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setPendingDeletionTask(null);
    setShowDeleteConfirmation(false);
    setConfirmationId(null);
    setDeleteConfirmationTimer(10);
    setIsUILocked(false);
    setIsAwaitingDeleteConfirmation(false);
    devLog('[VOICE DEBUG] isAwaitingDeleteConfirmation set to FALSE');
  }, []);

  const startListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.start();
    }
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
  }, []);

  // Function to confirm deletion
  const handleConfirmDeletion = useCallback(async () => {
    if (!confirmationId) {
      devError('No confirmation ID available');
      cleanupDeleteConfirmation();
      return;
    }

    try {
      const response = await fetch(
        `${import.meta.env.VITE_APP_API_BASE_URL}/api/tasks/confirm-delete/${confirmationId}`,
        {
          method: 'POST',
          credentials: 'include', // Include cookies in request
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ confirmed: true }),
        }
      );

      if (response.status === 204) {
        // Task deleted successfully
        if (pendingDeletionTask?.id) {
          setTasks(prevTasks => sortTasks(prevTasks.filter(task => task.id !== pendingDeletionTask.id)));
          speak('Task deleted successfully.');
        }
        cleanupDeleteConfirmation();
      } else if (response.status === 404) {
        // Confirmation expired or not found
        speak('Confirmation expired. Please try again.');
        cleanupDeleteConfirmation();
      } else {
        const errorData = await response.json();
        devError('Failed to confirm deletion, status:', response.status, 'error:', errorData);
        speak('Failed to delete task. Please try again.');
        cleanupDeleteConfirmation();
      }
    } catch (error) {
      devError('Error confirming deletion:', error);
      speak('Error deleting task. Please try again.');
      cleanupDeleteConfirmation();
    }
  }, [confirmationId, pendingDeletionTask, sortTasks, cleanupDeleteConfirmation]);

  // Function to cancel deletion
  const handleCancelDeletion = useCallback(async () => {
    if (!confirmationId) {
      cleanupDeleteConfirmation();
      return;
    }

    try {
      const response = await fetch(
        `${import.meta.env.VITE_APP_API_BASE_URL}/api/tasks/confirm-delete/${confirmationId}`,
        {
          method: 'POST',
          credentials: 'include', // Include cookies in request
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ confirmed: false }),
        }
      );

      if (response.ok) {
        speak('Deletion cancelled.');
      }
    } catch (error) {
      devError('Error cancelling deletion:', error);
    } finally {
      cleanupDeleteConfirmation();
    }
  }, [confirmationId, cleanupDeleteConfirmation]);

  const sendVoiceTranscriptToBackend = useCallback(async (transcript: string) => {
    try {
      const apiUrl = `${import.meta.env.VITE_APP_API_BASE_URL}/api/tasks/create-from-voice`;
      const clientDate = new Date(); // Get current date/time on client
      const clientTimezoneOffset = clientDate.getTimezoneOffset(); // Get timezone offset in minutes


      const response = await fetch(apiUrl, {
        method: 'POST',
        credentials: 'include', // Include cookies in request
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ transcribedText: transcript, clientDate: clientDate.toISOString(), clientTimezoneOffset }),
      });

      if (response.status === 202) {
        // Backend is requesting confirmation for deletion
        const confirmationData = await response.json();
        
        devLog('[VOICE DEBUG] Received deletion confirmation request from backend:', confirmationData);
        
        if (confirmationData.requiresConfirmation && confirmationData.confirmationId && confirmationData.taskId) {
          // Find the task to delete using tasksRef to get current state
          const taskToDelete = tasksRef.current.find(task => task.id === confirmationData.taskId);
          
          if (taskToDelete) {
            devLog('[VOICE DEBUG] Setting up deletion confirmation state for task:', taskToDelete.task_name);
            // Set up confirmation state
            setPendingDeletionTask(taskToDelete);
            setConfirmationId(confirmationData.confirmationId);
            setShowDeleteConfirmation(true);
            setIsUILocked(true);
            setDeleteConfirmationTimer(10);
            setIsAwaitingDeleteConfirmation(true); // Set state to await confirmation
            
            devLog('[VOICE DEBUG] isAwaitingDeleteConfirmation set to TRUE');
            
            // Speak confirmation prompt - delay starting listening to avoid capturing TTS
            speak(`Are you sure you want to delete task: ${taskToDelete.task_name}?`);
            
            // Delay starting listening to allow TTS to finish
            setTimeout(() => {
              devLog('[VOICE DEBUG] Starting listening for confirmation response');
              startListening();
            }, 2000); // 2 second delay to allow TTS to complete
            
            // Start countdown timer
            let timeLeft = 10;
            countdownIntervalRef.current = window.setInterval(() => {
              timeLeft -= 1;
              setDeleteConfirmationTimer(timeLeft);
              
              if (timeLeft <= 0) {
                if (countdownIntervalRef.current) {
                  clearInterval(countdownIntervalRef.current);
                  countdownIntervalRef.current = null;
                }
              }
            }, 1000);
            
            // Set timeout to auto-cancel after 10 seconds
            deleteTimeoutRef.current = window.setTimeout(() => {
              speak('Confirmation timeout. Deletion cancelled.');
              cleanupDeleteConfirmation();
            }, 10000);
          } else {
            devError('Task not found for confirmation:', confirmationData.taskId);
            speakAmbiguousInput();
          }
        }
      } else if (response.ok) {
        const taskData = await response.json();

        // Handle both create (201) and update (200) responses
        if (response.status === 201) {
          // New task created - add to list
          setTasks(prevTasks => sortTasks([...prevTasks, taskData]));
          speakTaskCreated();
        } else if (response.status === 200) {
          // Existing task updated - replace in list
          setTasks(prevTasks => sortTasks(prevTasks.map(task =>
            task.id === taskData.id ? taskData : task
          )));
          speakTaskUpdated();
        }
      } else {
        const errorData = await response.json();
        devError('Failed to send voice transcript to backend, status:', response.status, 'error:', errorData);
        speakAmbiguousInput();
      }
    } catch (error) {
      devError('Error communicating with the backend to create task:', error);
      alert('Error communicating with the backend to create task.');
    }
  }, [sortTasks, startListening, cleanupDeleteConfirmation]);

  // Effect for setting up basic speech recognition event handlers (not onresult)
  useEffect(() => {
    if ('webkitSpeechRecognition' in window) {
      recognitionRef.current = new window.webkitSpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onstart = () => {
        setIsListening(true);
        playAudioFeedback(800, 100); // Higher tone for start
        triggerHapticFeedback(50);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
        playAudioFeedback(400, 150); // Lower tone for end
        triggerHapticFeedback(100);
      };

      recognitionRef.current.onerror = () => {
        setIsListening(false);
        speakAmbiguousInput();
      };
    } else {
      // Speech recognition not available
    }
  }, []);

  // Effect to handle speech recognition results, dependent on latest state
  useEffect(() => {
    if (!recognitionRef.current) return;

    recognitionRef.current.onresult = (event: any) => {
      const speechResult = event.results[0][0].transcript;

      // Stop listening immediately to prevent feedback loops and capture of TTS
      stopListening();

      // DIAGNOSTIC: Log the state when voice input is received
      devLog('[VOICE DEBUG] Voice input received:', {
        transcript: speechResult,
        isAwaitingDeleteConfirmation,
        confirmationId,
        pendingDeletionTaskId: pendingDeletionTask?.id
      });

      if (isAwaitingDeleteConfirmation) {
        devLog('[VOICE DEBUG] Handling as deletion confirmation');
        // Using .includes() for more robust matching against potential extra words caught by speech recognition
        if (speechResult.toLowerCase().includes('yes')) {
          devLog('[VOICE DEBUG] User confirmed deletion');
          handleConfirmDeletion();
        } else if (speechResult.toLowerCase().includes('no')) {
          devLog('[VOICE DEBUG] User cancelled deletion');
          handleCancelDeletion();
        } else {
          devLog('[VOICE DEBUG] Ambiguous confirmation response');
          speak('Please say yes or no to confirm.');
          // Re-enable listening briefly after speaking to allow TTS to finish
          setTimeout(() => {
            startListening();
          }, 1500);
        }
      } else {
        devLog('[VOICE DEBUG] Sending to backend as normal voice input');
        // Automatically send the speech result to the backend
        sendVoiceTranscriptToBackend(speechResult);
      }
    };
  }, [isAwaitingDeleteConfirmation, confirmationId, handleConfirmDeletion, handleCancelDeletion, sendVoiceTranscriptToBackend, startListening, stopListening]);

  useEffect(() => {
    const hash = window.location.hash;
    const params = new URLSearchParams(hash.substring(1));
    const loginSuccess = params.get('login');
    const error = params.get('error');

    if (error === 'access_denied') {
      setAuthError('Access Denied: Your email is not on the invited users list. Please contact the administrator for access.');
      window.location.hash = ''; // Clean the URL
      setIsLoggedIn(false);
    } else if (loginSuccess === 'success') {
      // JWT is now in httpOnly cookie, no need to store in localStorage
      setIsLoggedIn(true);
      setAuthError(null);
      window.location.hash = ''; // Clean the URL
      fetchTasks();
    } else {
      // Check if user is already logged in by attempting to fetch tasks
      // If JWT cookie exists and is valid, this will succeed
      checkAuthStatus();
    }
  }, []);

  const checkAuthStatus = async () => {
    try {
      const response = await fetch(`${import.meta.env.VITE_APP_API_BASE_URL}/api/tasks`, {
        credentials: 'include', // Include cookies in request
      });
      if (response.ok) {
        setIsLoggedIn(true);
        setAuthError(null);
        const data = await response.json();
        setTasks(sortTasks(data));
      } else {
        setIsLoggedIn(false);
      }
    } catch (error) {
      devError('Error checking auth status:', error);
      setIsLoggedIn(false);
    }
  };

  // Keep tasksRef in sync with tasks state
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const fetchTasks = async () => {
    try {
      const response = await fetch(`${import.meta.env.VITE_APP_API_BASE_URL}/api/tasks`, {
        credentials: 'include', // Include cookies in request
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
    cleanupDeleteConfirmation();
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      const response = await fetch(`${import.meta.env.VITE_APP_API_BASE_URL}/api/tasks/${taskId}`, {
        method: 'DELETE',
        credentials: 'include', // Include cookies in request
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
    try {
      // Send a more explicit command with the task ID to help the LLM
      const newCompletionStatus = !task.is_completed;
      const transcribedText = `Mark task "${task.task_name}" with ID ${task.id} as ${newCompletionStatus ? 'completed' : 'not completed'}`;
      
      const response = await fetch(`${import.meta.env.VITE_APP_API_BASE_URL}/api/tasks/create-from-voice`, {
        method: 'POST',
        credentials: 'include', // Include cookies in request
        headers: {
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
        speakTaskUpdated(); // Reuse for completion/incompletion feedback
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

  const handleGoogleLogout = async () => {
    // Ensure AudioContext is initialized before using it
    initAudioContext();
    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
    playAudioFeedback(220, 150); // Example: A lower tone
    triggerHapticFeedback([100, 50, 100]); // Example: A double vibration
    
    try {
      // Call backend logout endpoint to clear cookie
      await fetch(`${import.meta.env.VITE_APP_API_BASE_URL}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include', // Include cookies in request
      });
    } catch (error) {
      devError('Error during logout:', error);
    }
    
    setIsLoggedIn(false);
    setTasks([]);
    window.location.href = '/'; // Redirect to root URL
  };

  const handleSaveTaskDescription = async (taskId: string, newTitle: string, newDescription: string, newDate: string) => {
    try {
      // Update in backend
      const response = await fetch(`${import.meta.env.VITE_APP_API_BASE_URL}/api/tasks/${taskId}`, {
        method: 'PUT',
        credentials: 'include', // Include cookies in request
        headers: {
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
            <div className="main-nav">
              <button onClick={handleGoogleLogin} className="nav-button">
                Login with Google
              </button>
              <button onClick={handleMicrosoftLogin} className="nav-button">
                Login with Microsoft
              </button>
            </div>
            {!isLoggedIn && (
              <div style={{ textAlign: 'left' }}>
                <p>This app is still in beta</p>
                <p>Only invited users have access. If you'd like to be invited, contact the Administrator</p>
                <p>The administrator will have access to view any emails sent to the app's email</p>
                <p>The administrator has access to view the tasks you create</p>
              </div>
            )}
          </>
        )}
      </div>
      
      {/* Delete Confirmation Modal */}
      {showDeleteConfirmation && pendingDeletionTask && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Confirm Deletion</h2>
            <p>Are you sure you want to delete this task?</p>
            <p className="task-name-preview"><strong>{pendingDeletionTask.task_name}</strong></p>
            <p className="timeout-warning">Time remaining: {deleteConfirmationTimer} seconds</p>
            <div className="modal-buttons">
              <button onClick={handleConfirmDeletion} className="confirm-button">
                Yes, Delete
              </button>
              <button onClick={handleCancelDeletion} className="cancel-button">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      
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
