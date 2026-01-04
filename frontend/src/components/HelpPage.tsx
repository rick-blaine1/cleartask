import React from 'react';

const HelpPage: React.FC = () => {
  return (
    <div style={{ textAlign: 'left' }}>
      <h1>Help Page</h1>

      <h2>Task List Page</h2>
      
      <h3>Voice Input</h3>
      <ul>
        <li>On the task list page, click the start voice input button to engage the voice input. You may be asked to grant access to your microphone by the website.</li>
        <li>You can add tasks. For example "remind me to buy groceries on tuesday"</li>
        <li>You can edit existing tasks. For example "change buy apples to buy oranges" or "change buy groceries due date to May fourth"</li>
        <li>You can also complete tasks by saying things like "mark buy groceries as done"</li>
        <li>You can delete tasks. For example "delete buy cat food"</li>
      </ul>

      <h3>Task Cards</h3>
      <ul>
        <li>You can also edit, delete, and mark complete by clicking or tapping the buttons on the task cards.</li>
      </ul>
      
      <h2>Manage Authorized Senders / Task Creation From Emails</h2>
      <ul>
        <li>Here you can add and remove email addresses as Authorized Senders.</li>
        <li>After adding an email address, we will email that address with a magic link. Click the link in the email to confirm this email belongs to you.</li>
        <li>Once authorized, when you forward or send an email from one of these addresses to <strong>[YOUR APP EMAIL HERE]</strong>, one or more tasks will be created based on the email you send.</li>
      </ul>
    </div>
  );
};

export default HelpPage;
