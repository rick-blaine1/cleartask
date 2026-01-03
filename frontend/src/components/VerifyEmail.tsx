import React, { useEffect, useState, useRef } from 'react';
import { devLog, devError } from '../utils/devLog';
import { useSearchParams, useNavigate } from 'react-router-dom';

const VerifyEmail: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [message, setMessage] = useState<string>('Verifying your email...');
  const hasVerified = useRef(false);

  useEffect(() => {
    const verifyEmail = async () => {
      // Prevent duplicate verification attempts (React 18 Strict Mode runs effects twice)
      if (hasVerified.current) {
        devLog('[VERIFY-EMAIL] Already verified, skipping duplicate call');
        return;
      }
      hasVerified.current = true;
      const token = searchParams.get('token');
      
      if (!token) {
        setStatus('error');
        setMessage('Invalid verification link. No token provided.');
        return;
      }

      try {
        devLog('[VERIFY-EMAIL] Starting verification request');
        const response = await fetch(
          `${import.meta.env.VITE_APP_API_BASE_URL}/api/email-ingestion/verify-magic-link?token=${token}`
        );

        devLog('[VERIFY-EMAIL] Response received:', {
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
          headers: Object.fromEntries(response.headers.entries())
        });

        if (response.ok) {
          const successData = await response.json();
          devLog('[VERIFY-EMAIL] Success response data:', successData);
          setStatus('success');
          setMessage('Email verified successfully!');
          
          // Redirect to authorized senders page after 2 seconds
          setTimeout(() => {
            navigate('/authorized-senders');
          }, 2000);
        } else {
          devLog('[VERIFY-EMAIL] Non-OK response, parsing error data');
          const errorData = await response.json();
          devLog('[VERIFY-EMAIL] Error response data:', errorData);
          setStatus('error');
          setMessage(errorData.message || 'Failed to verify email.');
        }
      } catch (error) {
        devError('[VERIFY-EMAIL] Exception caught:', error);
        setStatus('error');
        setMessage('Network error. Please try again later.');
      }
    };

    verifyEmail();
  }, [searchParams, navigate]);

  return (
    <div className="verify-email-container" style={{ 
      maxWidth: '600px', 
      margin: '50px auto', 
      padding: '20px', 
      textAlign: 'center' 
    }}>
      {status === 'verifying' && (
        <>
          <h2>Verifying Email...</h2>
          <p>{message}</p>
          <div className="spinner" style={{ 
            border: '4px solid #f3f3f3',
            borderTop: '4px solid #3498db',
            borderRadius: '50%',
            width: '40px',
            height: '40px',
            animation: 'spin 1s linear infinite',
            margin: '20px auto'
          }}></div>
        </>
      )}
      
      {status === 'success' && (
        <>
          <h2 style={{ color: 'green' }}>✓ Email Verified!</h2>
          <p>{message}</p>
          <p>Redirecting you to the Authorized Senders page...</p>
        </>
      )}
      
      {status === 'error' && (
        <>
          <h2 style={{ color: 'red' }}>✗ Verification Failed</h2>
          <p>{message}</p>
          <button 
            onClick={() => navigate('/authorized-senders')}
            style={{
              marginTop: '20px',
              padding: '10px 20px',
              fontSize: '16px',
              cursor: 'pointer'
            }}
          >
            Go to Authorized Senders
          </button>
        </>
      )}
    </div>
  );
};

export default VerifyEmail;
