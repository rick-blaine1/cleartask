# Invited Users Implementation Plan

## 1. Overview

This document outlines the implementation plan for restricting user logins based on an email whitelist. Only users whose email addresses match an entry in the `INVITED_USERS` environment variable will be permitted to log in. This includes support for wildcard matching using `*`.

## 2. Backend Modifications

### 2.1 Email Validation Middleware ✅ COMPLETED
- ✅ Created a helper function [`isEmailWhitelisted()`](backend/app.js:30-40) to check if an email is in the whitelist.
- ✅ This function:
    - Extracts the user's email address from the OAuth response.
    - Retrieves the `INVITED_USERS` list from environment variables.
    - For each entry in `INVITED_USERS`:
        - If the entry contains `*`, converts it into a regular expression pattern (e.g., `user*@example.com` becomes `/^user.*@example.com$/`).
        - Compares the user's email against the entry/pattern (case-insensitive).
    - Returns `true` if the email matches any entry, `false` otherwise.
    - If no whitelist is configured (empty `INVITED_USERS`), all emails are allowed.

### 2.2 Error Handling ✅ COMPLETED
- ✅ Implemented robust error handling in both OAuth callbacks.
- ✅ Logging is in place for unauthorized login attempts using `fastify.log.warn()`.
- ✅ Returns HTTP 403 Forbidden status code with descriptive error message: "Access Denied: Your email is not on the invited users list."

### 2.3 Integration with Existing Authentication Flow ✅ COMPLETED
- ✅ Integrated email validation into [`/api/auth/google/callback`](backend/app.js:513-556) route (after fetching user profile, before database operations).
- ✅ Integrated email validation into [`/api/auth/microsoft/callback`](backend/app.js:564-622) route (after fetching user profile, before database operations).
- ✅ Validation occurs after successful OAuth but before JWT generation and session creation.

## 3. Frontend Modifications

### 3.1 Display Error Message ⏳ PENDING
- Modify the frontend login component (`frontend/src/App.tsx` or related authentication components) to handle the 403 Forbidden response.
- When a 403 status code is received, display a user-friendly error message indicating that their email is not authorized to log in. This message should be clear and inform the user about the restriction.

## 4. Configuration

### 4.1 `.env` File Definition ✅ COMPLETED
- ✅ The `INVITED_USERS` variable is documented in [`.env.example`](.env.example:36) with an example including wildcard usage.
- ✅ It is a comma-separated string of authorized email addresses, supporting `*` as a wildcard.
- ✅ Example in `.env.example`:
    ```
    INVITED_USERS="user1@example.com,rick*@gmail.com,admin@example.com"
    ```
- ✅ In the backend, this variable is parsed into an array at application startup ([`backend/app.js:47-50`](backend/app.js:47-50)), and each entry is processed to handle wildcard matching.

## 5. Implementation Status

### Completed
- ✅ Backend email validation helper function with wildcard support
- ✅ Integration with Google OAuth callback
- ✅ Integration with Microsoft OAuth callback
- ✅ Error handling and logging
- ✅ `.env.example` documentation

### Pending
- ⏳ Frontend error message display for 403 responses
