import React, { useEffect, useState, useRef } from 'react';
import TaskCard from './components/TaskCard';
import type { Task } from './db';

function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [isFetchingAISuggestion, setIsFetchingAISuggestion] = useState<boolean>(false);

  const audioContextRef = useRef<AudioContext | null>(null);

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
        setTasks(data);
      } else {
        console.error('Failed to fetch tasks', response.statusText);
        setTasks([]);
      }
    } catch (error) {
      console.error('Error fetching tasks:', error);
      setTasks([]);
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
    window.location.href = 'http://localhost:3000/api/auth/google';
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

  const fetchOpenAISuggestion = async () => {
    const token = localStorage.getItem('jwt');
    if (!token) {
      console.error('No JWT token found.');
      return;
    }
    setIsFetchingAISuggestion(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_APP_API_BASE_URL}/api/openai-task-suggestion`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      if (response.ok) {
        const data = await response.json();
        alert(`AI Suggested Task: ${data.suggestion}`);
      } else {
        console.error('Failed to fetch AI suggestion', response.statusText);
        alert('Failed to get AI task suggestion. Please try again later.');
      }
    } catch (error) {
      console.error('Error fetching AI suggestion:', error);
      alert('Failed to get AI task suggestion. Please try again later.');
    } finally {
      setIsFetchingAISuggestion(false);
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
            <button onClick={fetchOpenAISuggestion} disabled={isFetchingAISuggestion}>
              {isFetchingAISuggestion ? 'Getting Suggestion...' : 'Get AI Task Suggestion'}
            </button>
          </>
        ) : (
          <button onClick={handleGoogleLogin}>
            Login with Google
          </button>
        )}
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
