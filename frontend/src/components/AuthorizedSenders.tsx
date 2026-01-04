import React, { useState, useEffect } from 'react';

interface AuthorizedSender {
  id: string;
  email: string;
  isVerified: boolean;
}

const AuthorizedSenders: React.FC = () => {
  const [emailInput, setEmailInput] = useState<string>('');
  const [authorizedSenders, setAuthorizedSenders] = useState<AuthorizedSender[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAuthorizedSenders();
  }, []);

  const fetchAuthorizedSenders = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${import.meta.env.VITE_APP_API_BASE_URL}/api/authorized-senders`, {
        credentials: 'include', // Include cookies in request
      });
      if (response.ok) {
        const data: AuthorizedSender[] = await response.json();
        setAuthorizedSenders(data);
      } else {
        const errorData = await response.json();
        setError(errorData.message || 'Failed to fetch authorized senders.');
      }
    } catch (err) {
      setError('Network error or failed to connect to API.');
    } finally {
      setLoading(false);
    }
  };

  const handleAddSender = async () => {
    if (!emailInput) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${import.meta.env.VITE_APP_API_BASE_URL}/api/authorized-senders`, {
        method: 'POST',
        credentials: 'include', // Include cookies in request
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: emailInput }),
      });
      if (response.ok) {
        setEmailInput('');
        fetchAuthorizedSenders(); // Refresh the list
      } else {
        const errorData = await response.json();
        setError(errorData.message || 'Failed to add sender.');
      }
    } catch (err) {
      setError('Network error or failed to connect to API.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSender = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${import.meta.env.VITE_APP_API_BASE_URL}/api/authorized-senders/${id}`, {
        method: 'DELETE',
        credentials: 'include', // Include cookies in request
      });
      if (response.ok) {
        fetchAuthorizedSenders(); // Refresh the list
      } else {
        const errorData = await response.json();
        setError(errorData.message || 'Failed to delete sender.');
      }
    } catch (err) {
      setError('Network error or failed to connect to API.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${import.meta.env.VITE_APP_API_BASE_URL}/api/authorized-senders/${id}/resend-verification`, {
        method: 'POST',
        credentials: 'include', // Include cookies in request
      });
      if (response.ok) {
        alert('Verification email sent!');
      } else {
        const errorData = await response.json();
        setError(errorData.message || 'Failed to resend verification.');
      }
    } catch (err) {
      setError('Network error or failed to connect to API.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="authorized-senders-container">
      <h2>Manage Authorized Senders</h2>

      {loading && <p>Loading...</p>}
      {error && <p className="error-message">Error: {error}</p>}

      <div className="add-sender-form">
        <input
          type="email"
          value={emailInput}
          onChange={(e) => setEmailInput(e.target.value)}
          placeholder="Enter email address"
          disabled={loading}
          className="email-input-large"
        />
        <button onClick={handleAddSender} disabled={loading || !emailInput}>Add Sender</button>
      </div>

      <ul className="sender-list">
        {authorizedSenders.map((sender) => (
          <li key={sender.id} className="sender-item flex-container">
            <span className="email-display">{sender.email}</span>
            {sender.isVerified ? (
              <span className="verified-status">Verified</span>
            ) : (
              <>
                <span className="unverified-status">Unverified</span>
                <button onClick={() => handleResendVerification(sender.id)} disabled={loading}>Resend Verification</button>
              </>
            )}
            <button onClick={() => handleDeleteSender(sender.id)} disabled={loading}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default AuthorizedSenders;
