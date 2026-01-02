import React, { useEffect } from 'react';

const MagicLinkSuccess: React.FC = () => {
  useEffect(() => {
    // Announce verification success for screen readers
    const ariaLiveRegion = document.getElementById('aria-live-announcer');
    if (ariaLiveRegion) {
      ariaLiveRegion.ariaLive = 'assertive';
      ariaLiveRegion.textContent = 'Email verification successful!';
    }

    // Optional: Redirect to a different page after a few seconds or show a link to home
    const timer = setTimeout(() => {
      // window.location.href = '/'; // Example: redirect to home
    }, 5000);

    return () => {
      clearTimeout(timer);
      if (ariaLiveRegion) {
        ariaLiveRegion.textContent = '';
        ariaLiveRegion.ariaLive = 'off';
      }
    };
  }, []);

  return (
    <div className="magic-link-success-container" aria-labelledby="magic-link-success-heading">
      <h2 id="magic-link-success-heading">Email Verified Successfully!</h2>
      <p>Your email address has been successfully verified.</p>
      <p>You can now close this page or return to the main application.</p>
      <div id="aria-live-announcer" role="status" className="visually-hidden"></div>
    </div>
  );
};

export default MagicLinkSuccess;