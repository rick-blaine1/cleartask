import React, { useEffect, useState, useRef } from 'react';
import TaskCard from './components/TaskCard';
import type { Task } from './db';
import { db } from './db';
import { speak, speakTaskCreated, speakAmbiguousInput } from './tts';
import './App.css';

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
  const recognitionRef = useRef<any>(null);

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
        // console.log('Speech Result:', speechResult); // Potentially sensitive user speech
        // Automatically send the speech result to the backend
        sendVoiceTranscriptToBackend(speechResult);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
        // console.log('Speech recognition ended.');
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
        speakAmbiguousInput();
      };
    } else {
      console.warn('Web Speech API not supported in this browser.');
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

    if (token) {
      localStorage.setItem('jwt', token);
      setIsLoggedIn(true);
      window.location.hash = ''; // Clean the URL
      fetchTasks(token);
    } else if (localStorage.getItem('jwt')) {
      setIsLoggedIn(true);
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
        console.error('Failed to fetch tasks', response.statusText);
        setTasks([]);
      }
    } catch (error) {
      console.error('Error fetching tasks:', error);
      setTasks([]);
    }
  };

  const handleInitiateDeleteConfirmation = (taskToConfirm: Task) => {
    setPendingDeletionTask(taskToConfirm);
    setIsUILocked(true);
    // Placeholder for app speaking: "Are you sure you want to delete [Task]?"
    // console.log(`App speaks: "Are you sure you want to delete [Task]?"`); // Sanitized task_name
    // Placeholder for opening mic for 10 seconds
    // console.log('Opening mic for 10 seconds...');
  };

  const handleCancelDeleteConfirmation = () => {
    setPendingDeletionTask(null);
    setIsUILocked(false);
    // console.log('Delete confirmation cancelled.');
  };

  const handleDeleteTask = async (taskId: string) => {
    const token = localStorage.getItem('jwt');
    if (!token) {
      console.error('No JWT token found.');
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
        console.error('Failed to delete task', response.statusText);
        alert('Failed to delete task. Please try again.');
      }
    } catch (error) {
      console.error('Error deleting task:', error);
      alert('Error deleting task. Please try again.');
    }
  };

  const handleToggleComplete = async (task: Task) => {
    const token = localStorage.getItem('jwt');
    if (!token) {
      console.error('No JWT token found.');
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
        console.error('Failed to toggle task completion:', errorData.message);
        speakAmbiguousInput();
      }
    } catch (error) {
      console.error('Error toggling task completion:', error);
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
      console.warn('AudioContext not initialized. Cannot play audio feedback.');
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
  };

  const handleSaveTaskDescription = async (taskId: string, newTitle: string, newDescription: string, newDate: string) => {
    const token = localStorage.getItem('jwt');
    if (!token) {
      console.error('No JWT token found.');
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
        console.error('Failed to save task:', errorData);
        alert('Failed to save task. Please try again.');
      }
    } catch (error) {
      console.error('Error saving task:', error);
      alert('Failed to save task. Please try again.');
    }
  };

  const sendVoiceTranscriptToBackend = async (transcript: string) => {
    const token = localStorage.getItem('jwt');
    if (!token) {
      console.error('No JWT token found.');
      return;
    }
    try {
      const apiUrl = `${import.meta.env.VITE_APP_API_BASE_URL}/api/tasks/create-from-voice`;
      const clientDate = new Date(); // Get current date/time on client
      const clientTimezoneOffset = clientDate.getTimezoneOffset(); // Get timezone offset in minutes

      // console.log('LLM Request:', { url: apiUrl, method: 'POST', body: { transcribedText: '[sanitized]', clientDate: clientDate.toISOString(), clientTimezoneOffset } }); // Sanitized transcribedText
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
        // console.log('LLM Response (Success): [sanitized]'); // Sanitized LLM response data
        
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
        console.error('LLM Response (Error):', errorData); // Log the LLM's error response
        console.error('Failed to create task from voice input:', errorData.message);

        speakAmbiguousInput();
      }
    } catch (error) {
      console.error('Error sending voice transcript to backend:', error);
      alert('Error communicating with the backend to create task.');
    }
  };

  return (
    <>
      <div className="card">
        {isLoggedIn ? (
          <>
            <button onClick={handleGoogleLogout}>
              Logout
            </button>
            <button onClick={isListening ? stopListening : startListening} disabled={!('webkitSpeechRecognition' in window)}>
              {isListening ? 'Stop Listening' : 'Start Voice Input'}
            </button>
            {transcript && <p>Transcript: {transcript}</p>}
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
    </>
  );
}

export default App;
