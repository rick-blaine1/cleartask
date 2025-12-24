# UI Design & Theme Reference: ClearTask

This document defines the visual constraints and CSS theme variables for ClearTask to ensure WCAG AAA compliance and high-vision accessibility.

## 1. Core Visual Constants (CSS Variables)
Apply these to the root of the application to maintain a consistent high-contrast theme across all components.

~~~~css
:root {
  /* Colors - WCAG AAA Compliant */
  --bg-color: #000000;             /* OLED Black */
  --text-primary: #FFFFFF;         /* Pure White */
  --color-priority: #FFFF00;       /* Electric Yellow */
  --color-archive: #808080;        /* Neutral Gray for secondary/archived text */

  /* Typography */
  --font-main: 'Atkinson Hyperlegible', sans-serif; /* */
  --base-font-size: 24px;          /* */
  --line-height: 1.5;              /* Prevents line-skipping */

  /* Touch Targets & Spacing */
  --min-tap-target: 80px;          /* Mandatory for all interactive elements */
  --standard-padding: 20px;
  --border-width-priority: 4px;    /* Visible thickness for priority borders */
}
~~~~

## 2. Component-Specific Rules

### 2.1 Task Cards
- **Priority Tier 1:** Must use `border: var(--border-width-priority) solid var(--color-priority)`.
- **Sizing:** Every card must have a `min-height` of `var(--min-tap-target)` to ensure a large touch surface.
- **Pending Deletion State:** Apply a solid `var(--color-priority)` background with black text (`#000000`) to provide a high-contrast visual "lock" during the confirmation gate.

### 2.2 The Microphone Button
- **Fixed Positioning:** Must be pinned to the bottom center for consistent physical access.
- **Size:** Mandatory `80px x 80px` minimum dimensions.
- **Visuals:** High-contrast icon (White on Black or Yellow on Black).

### 2.3 Layout Stability
- **No Layout Shifts:** Adding tasks or expanding the Archive must not move existing UI elements.
- **Scaling Support:** Use `rem` or `em` units for all dimensions to ensure the layout remains functional at **200% system-level text magnification**.

## 3. Accessibility Enforcement for Roo Code
- **Redundancy:** Color must never be the only indicator of state. For Priority Tier 1, use both the Yellow Border AND a text label like "No Date".
- **Full-Page Redirects:** Ensure the Auth flow uses full-page redirects rather than pop-ups to remain compatible with screen magnifiers.