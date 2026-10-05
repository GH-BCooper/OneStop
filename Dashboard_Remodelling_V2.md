# OneStop — Home Dashboard UI/UX Remediation Plan

## Purpose

This document defines the changes required for the **OneStop home dashboard**, with primary focus on the **mobile/PWA view** shown in the screenshots.

The goal is to make the dashboard polished, modern, fast, intuitive, and visually consistent while **preserving every existing feature and backend behavior**.

> **Critical constraint:** This is a UI/UX remediation. Do not remove, rename, disable, or alter existing tools, routes, APIs, tool-registry definitions, execution pipelines, authentication, workflows, history, offline behavior, or AI functionality unless explicitly required for a visual fix.

---

## 1. Current Problems Observed

### Header
- Too many small icons compete for attention.
- Some icons have unclear meaning at mobile size.
- Status, notifications, theme/language, profile, and menu controls are too compressed.
- The header needs clearer separation between application identity and actions.
- Secondary controls should move into the account/menu area.
- The mobile menu should behave like a proper navigation drawer rather than simply overlaying content.

### Hero
- The greeting occupies too much vertical space.
- The supporting text can be shorter and more product-focused.
- The AI input currently looks too much like a normal text field.
- The AI CTA and tool-search CTA compete slightly.
- The background effect is attractive but can become distracting behind important content.

### Favourites
- Favourites currently look like disconnected pills.
- Favourite state is not visually integrated with the tool shortcut.
- A clear way to manage favourites should remain available.

### Recently Used
- Another pill-based section creates visual repetition.
- Recent activity would be easier to scan as compact cards with tool name and time.

### All Tools
- Category cards consume substantial vertical space on mobile.
- Category descriptions can be shorter.
- Counts are useful but should not dominate.
- The section should remain easy to discover without overwhelming the first viewport.

### Popular Tools
- Another pill-based section creates too much repetition.
- It should look like a quick-action area rather than another tag list.

### Recent Jobs
- Operation, file, status, and timestamp need clearer hierarchy.
- Status indicators are too small.
- Job cards should be easier to scan.

### Footer
- The footer should be visually secondary on mobile.

---

# 2. Target Design Direction

OneStop should feel like:

> **A premium utility workspace, not a generic file-converter website.**

Keep the existing dark-first identity but refine it using:

- Strong typography
- Restrained gradients
- Subtle glass/metallic surfaces
- Consistent borders and shadows
- Compact but comfortable spacing
- Clear information hierarchy
- Minimal decorative noise
- Subtle micro-interactions
- Excellent mobile usability

Do not replace the visual identity unnecessarily.

---

# 3. Recommended Mobile Home Structure

```text
HEADER
  OneStop | Status | Profile | Menu

HERO
  Good morning, Brett
  Short product description
  AI command input
  Ask OneStop AI
  Search tools

QUICK ACCESS
  Favourite/important tools

RECENTLY USED
  3–5 recent tools

ALL TOOLS
  PDF
  Documents
  Excel / CSV / Data
  Images
  Audio & Video
  QR
  AI
  Utilities & Developer
  Security & Privacy
  Everyday / Money / Fun

POPULAR TOOLS
  Compact shortcuts

RECENT JOBS
  3–5 recent executions

FOOTER
  Minimal branding
```

The hierarchy should be:

1. Ask OneStop AI
2. Search
3. Personal shortcuts
4. Recent activity
5. Tool discovery
6. Popular tools
7. Recent jobs

---

# 4. Header Redesign

Keep:

- OneStop logo
- OneStop name
- Online/offline indicator
- Profile/account access
- Hamburger menu

On mobile, target:

```text
[Logo] OneStop       [Status] [Avatar] [☰]
```

Move secondary settings such as theme, language, notifications, and other preferences into the menu/account area.

### Status indicator

Use:

- Green = Online
- Amber = Limited connectivity
- Red = Offline / online-only tools unavailable

Tapping the indicator may open the existing `/status` page.

Do not change the underlying status logic.

---

# 5. Mobile Navigation Drawer

Use a proper drawer:

```text
OneStop

✨ AI Assistant
🧰 All Tools
🔗 Workflows
🕘 History

──────────────

⭐ Favourites
🔥 Popular
🕐 Recent

──────────────

⚙ Settings
ℹ About OneStop
```

Requirements:

- Smooth open/close animation
- Dimmed background
- Tap outside to close
- Escape to close where applicable
- Preserve the current route
- Do not reload the page
- Do not interfere with authentication

Use the existing routes and navigation system.

---

# 6. Hero / AI Assistant

This should be the strongest section of the home page.

### Heading

Keep the personalized greeting:

> Good morning, Brett

Reduce its size slightly so it does not dominate the viewport.

### Supporting text

Use something concise such as:

> Convert, edit, inspect, or automate your files — or tell OneStop what you want to do.

### AI command input

Make the input feel like an AI command bar.

Example placeholder:

> `e.g. Convert these images to PDF, compress it, and create a QR code`

Requirements:

- Clear focus state
- Good contrast
- Rounded but not excessively rounded
- Enter submits
- Multiline where already supported
- Attachment/microphone controls only if the corresponding functionality already exists

Do not add UI controls for functionality that does not exist.

### Primary CTA

> ✨ Ask OneStop AI

This should be the strongest CTA.

Include:

- Hover/press state
- Loading state
- Disabled state

### Secondary CTA

> Search all tools

Make it visually subordinate to the AI CTA.

---

# 7. Quick Access / Favourites

Replace disconnected pills with compact shortcuts.

Example:

```text
Quick access

[ 📄 Compress PDF ] [ 🖼 Image Compressor ]
[ ▣ QR Generator ] [ 📄 Word → PDF ]
```

Each shortcut should:

- Show tool icon
- Show tool name
- Preserve favourite/unfavourite functionality
- Navigate to the existing tool route

Show approximately 4–6 items on the home page, with a View All/manage option if necessary.

---

# 8. Recently Used

Use compact cards instead of another pill row.

Example:

```text
Recently used                         View all →

┌────────────────────────────────────┐
│ 📄 PDF → HTML                  2m  │
│    Document conversion             │
└────────────────────────────────────┘

┌────────────────────────────────────┐
│ 🖼 Image Cropper               8m  │
│    Image tools                     │
└────────────────────────────────────┘
```

Show roughly 3–5 entries.

The full history remains available through the existing history functionality.

---

# 9. All Tools

Keep the existing categories and tool counts.

Recommended category card:

```text
[icon] PDF
      Merge, split, compress, OCR and convert
      34 tools                                  →
```

Each card should contain:

- Category icon
- Category name
- Short description
- Tool count
- Navigation affordance

### Critical requirement

Counts must come from the existing tool registry.

Do **not** hard-code `34`, `30`, etc. into the home page.

The home page should remain correct if the registry changes from 292 tools to another number.

---

# 10. Category Visual System

Use a cohesive visual system.

Prefer:

- Dark neutral surfaces
- Subtle icon accents
- Consistent borders
- Consistent shadows

Avoid making every category a different bright color.

---

# 11. Popular Tools

Keep this section but make it compact.

Example:

```text
Popular tools

Compress PDF
Image Compressor
QR Code Generator
Word → PDF
PDF → Images
YouTube → MP4
Excel → PDF
CSV → Excel
```

Use compact buttons/chips with icons where helpful.

Do not create a second complicated popularity system if existing usage data can be reused.

---

# 12. Recent Jobs

Keep the current functionality but improve hierarchy.

Example:

```text
Recent jobs                              All history →

┌────────────────────────────────────────┐
│ PDF → Images                    ✓      │
│ blocks.pdf                             │
│ 2 minutes ago                          │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│ YouTube → MP4                   ✓      │
│ 42 characters from URL                 │
│ Sep 24, 2026                            │
└────────────────────────────────────────┘
```

Support:

- Success
- Processing
- Failed
- Cancelled

Use text + icon rather than color alone.

---

# 13. Empty States

Every dynamic section should have an intentional empty state.

### No favourites

```text
No favourites yet

Star tools you use often and they'll appear here.

[ Browse tools ]
```

### No recent tools

```text
Nothing here yet

Your recently used tools will appear here.
```

### No jobs

```text
No jobs yet

Your completed and recent operations will appear here.
```

Avoid empty boxes or broken layouts.

---

# 14. Offline State

Keep the existing `/status` functionality.

The home page only needs a compact status indicator.

If an internet-dependent tool is selected while offline:

```text
Internet connection required

This tool needs an internet connection.
Connect to the internet and try again.

[ Try again ]
```

Do not disable the whole application.

Offline-compatible tools must continue working.

---

# 15. Desktop Behaviour

Do not simply stretch the mobile layout onto desktop.

On desktop:

- Use a centered max-width content area.
- Allow multi-column layouts.
- Keep the AI hero prominent.
- Use a persistent sidebar if appropriate.
- Keep category cards compact.
- Avoid excessive whitespace.
- Preserve the same information hierarchy.

Suggested desktop structure:

```text
┌──────────────┬───────────────────────────────────────┐
│              │ Header                                │
│ Sidebar      ├───────────────────────────────────────┤
│              │ Hero / AI Assistant                   │
│ AI Assistant │                                       │
│ All Tools    │ Quick Access                          │
│ Workflows    │                                       │
│ History      │ Recently Used                         │
│              │                                       │
│              │ All Tools                             │
│              │                                       │
│              │ Popular + Recent Jobs                 │
└──────────────┴───────────────────────────────────────┘
```

---

# 16. Typography

Use a clean modern sans-serif.

Recommended hierarchy:

- Heading: 700
- Section heading: 600
- Body: 400–500
- Metadata: 400

Avoid excessive font weights.

Text should remain readable at small mobile sizes.

---

# 17. Spacing

Use a consistent spacing scale:

```text
4px
8px
12px
16px
20px
24px
32px
40px
48px
```

Suggested mobile defaults:

- 16px horizontal page padding
- 20–24px section spacing
- 12–16px card padding

Do not manually invent unrelated margins for each component.

---

# 18. Cards and Surfaces

Refine the existing card style rather than replacing it.

Use:

- Subtle borders
- Subtle shadows
- Moderate radius
- Dark/translucent surfaces
- Restrained blur

Avoid:

- Excessive glass blur
- Glowing borders everywhere
- Huge shadows
- Excessively rounded cards
- Too many gradients

---

# 19. Background

The existing subtle dark/light streak background can remain.

Refine it by:

- Reducing contrast
- Keeping decorative elements behind content
- Avoiding bright streaks directly behind text
- Maintaining strong text contrast

The background should support the interface, not compete with it.

---

# 20. Light Theme

The light theme should feel like the same product, not an inverted dark theme.

Ensure:

- Readable text
- Visible borders
- Subtle shadows
- Clear card separation
- Accessible button contrast
- Consistent accent colors

---

# 21. Responsive Requirements

The dashboard must work cleanly at:

- 320px
- 360px
- 375px
- 390px
- 414px
- 430px
- Tablet widths
- Desktop

There must be no:

- Horizontal scrolling
- Clipped text
- Overlapping menus
- Controls extending beyond the viewport
- Oversized cards
- Broken navigation
- Fixed elements covering content

---

# 22. Touch Targets

Mobile controls must be comfortable to tap.

Pay particular attention to:

- Hamburger
- Status
- Profile
- Favourite star
- Cards
- Buttons
- Navigation items

Do not create tiny icon-only controls merely to fit more information.

---

# 23. Animations

Use subtle animations only:

- Card hover/press
- Button press
- Drawer open/close
- Favourite toggle
- Loading states
- Small section transitions

Avoid:

- Constant moving backgrounds
- Excessive bouncing
- Long transitions
- Animating every element

Target roughly 150–250ms for normal UI transitions.

Respect `prefers-reduced-motion`.

---

# 24. Loading States

Every dynamic section should have a proper loading state.

Examples:

```text
Loading favourites...
Loading recent tools...
Loading recent jobs...
```

Use skeletons where practical.

Avoid large layout shifts while data loads.

---

# 25. Error States

If one dashboard data source fails:

```text
Something went wrong

We couldn't load this section.

[ Try again ]
```

One failed section must not break the entire home page.

For example:

- Recent jobs failure must not break All Tools.
- Favourites failure must not break AI Assistant.
- Network-status failure must not break local tools.

---

# 26. Authentication Behaviour

Do not change the existing authentication implementation.

### Logged in

Show:

- Personalized greeting
- Synced favourites
- Synced history where available
- Account information

### Logged out

If anonymous/local usage is supported:

- Local tools remain usable.
- Local history remains local.
- Account-specific sync can prompt the user to sign in.

Do not force authentication merely to use local tools unless that is already an explicit product requirement.

---

# 27. Preserve Existing Functionality

The redesign must not break:

- `/`
- `/tools`
- `/assistant`
- `/workflows`
- `/history`
- `/status`
- Authentication
- Google OAuth
- Local processing
- Offline PWA functionality
- Service worker
- Tool execution
- Tool registry
- Tool counts
- Favourites
- Recent tools
- Recent jobs
- File uploads
- Downloads
- AI execution plans
- Tool chaining
- Workflow execution

The home page should consume existing APIs/hooks/services instead of duplicating business logic.

---

# 28. Tool Registry Integration

The dashboard must remain registry-driven.

```text
Tool Registry
      ↓
Group/filter tools
      ↓
Generate category metadata
      ↓
Render dashboard
```

Do not maintain a second hard-coded list of the 292 tools on the home page.

Use tool IDs for:

- Favourites
- Recent tools
- Popular tools
- Tool routes

This prevents UI/backend drift.

---

# 29. Accessibility

Ensure:

- Keyboard navigation
- Visible focus states
- Semantic buttons and links
- Accessible icon labels
- Sufficient contrast
- Status not communicated by color alone
- Screen-reader-friendly navigation
- Reduced-motion support
- Proper heading hierarchy

Accessibility improvements must not alter tool behavior.

---

# 30. Performance

The home page should be lightweight.

Only load:

- Tool metadata
- Category information
- Dashboard data

Tool implementations should remain lazy-loaded.

Do **not** initialize on the home page:

- FFmpeg
- LibreOffice
- Ollama
- Heavy AI models
- Image-processing models
- Video-processing engines

unless explicitly required.

This is especially important for mobile devices.

---

# 31. Recommended Component Structure

Keep the implementation modular without over-engineering.

```text
HomePage
├── DashboardHeader
├── HeroAssistant
├── ToolSearch
├── QuickAccess
├── RecentTools
├── ToolCategories
├── PopularTools
├── RecentJobs
└── DashboardFooter
```

Supporting components:

```text
CategoryCard
ToolShortcut
RecentToolCard
RecentJobCard
StatusIndicator
MobileMenu
SectionHeader
EmptyState
LoadingState
ErrorState
```

Do not create dozens of unnecessary abstractions.

---

# 32. Data Flow

Use the existing application state/services:

```text
Existing state/services
        ↓
Dashboard hooks
        ↓
Home components
        ↓
UI
```

Do not:

- Move processing logic into UI components.
- Create a second database layer.
- Create a second authentication system.
- Create a second tool registry.

---

# 33. Mobile Navigation Priority

When space is limited:

### Tier 1
- AI Assistant
- All Tools
- Workflows
- History

### Tier 2
- Favourites
- Recent Tools
- Account

### Tier 3
- Settings
- Status
- About
- Secondary utilities

This keeps the interface usable without removing functionality.

---

# 34. Final Home Layout

The final mobile page should approximately be:

```text
HEADER
  OneStop | Status | Profile | Menu

HERO
  Good morning, Brett
  Short product description
  AI command input
  Ask OneStop AI
  Search tools

QUICK ACCESS
  Favourite/important tools

RECENTLY USED
  3–5 recent tools

ALL TOOLS
  PDF
  Documents
  Excel / CSV / Data
  Images
  Audio & Video
  QR
  AI
  Utilities & Developer
  Security & Privacy
  Everyday / Money / Fun

POPULAR TOOLS
  Compact shortcuts

RECENT JOBS
  3–5 recent executions

FOOTER
  Minimal branding
```

---

# 35. What Must NOT Be Changed

Do not:

- Remove tools.
- Reduce the 292-tool registry.
- Rename tool IDs.
- Change API contracts.
- Change execution pipelines.
- Change authentication implementation.
- Change the database schema unnecessarily.
- Remove offline support.
- Remove PWA functionality.
- Replace local processing with cloud processing.
- Add mandatory paid services.
- Add mandatory APIs.
- Introduce unnecessary dependencies.
- Rewrite the application architecture.
- Introduce another state-management system without need.
- Hard-code tool counts.
- Hard-code tool metadata that already exists in the registry.

The objective is **UI improvement, not architectural replacement**.

---

# 36. Acceptance Criteria

The redesign is complete only when:

- [ ] Mobile dashboard looks polished at 320–430px widths.
- [ ] Desktop layout remains responsive and visually consistent.
- [ ] No horizontal overflow exists.
- [ ] Header is significantly clearer.
- [ ] AI Assistant is clearly the primary action.
- [ ] Tool search is easy to discover.
- [ ] Favourites are easy to access.
- [ ] Recently used tools are easy to scan.
- [ ] All tool categories remain accessible.
- [ ] Popular tools remain accessible.
- [ ] Recent jobs remain accessible.
- [ ] Offline indicator still works.
- [ ] `/status` remains functional.
- [ ] Existing routes remain unchanged.
- [ ] Existing authentication remains unchanged.
- [ ] Tool execution remains unchanged.
- [ ] PWA/offline behavior remains unchanged.
- [ ] Tool counts come from the registry.
- [ ] Heavy processing libraries do not load unnecessarily on the home page.
- [ ] Dark and light themes both work.
- [ ] Keyboard navigation works.
- [ ] Touch targets are comfortable.
- [ ] Loading, error, and empty states are handled.
- [ ] No existing functionality regresses.

---

# 37. Implementation Principle

> **Make OneStop feel substantially better without changing what OneStop can do.**

The existing architecture and functionality are the foundation. The home dashboard should become a clean, high-quality interface on top of that foundation.

The final result should feel:

**Fast → Clean → Premium → Useful → Discoverable → Local-first → Uncluttered**

while remaining simple enough to maintain.
