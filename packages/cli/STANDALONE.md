# Standalone CLI

kbs works as a standalone CLI without pi. This is useful for CI environments, scripting, or if you prefer working from the terminal.

## Installation

```bash
npm install -g @dustinbyrne/kbs
```

## Authentication

kbs uses [pi](https://github.com/badlogic/pi-mono) for AI agent sessions and reuses your existing pi authentication. You can also authenticate directly through the dashboard UI.

If you don't have pi set up yet: `npm i -g @mariozechner/pi-coding-agent && pi` then `/login`.

## Usage

### Start the dashboard

Launch the web UI and AI engine:

```bash
kbs dashboard
kbs dashboard --port 8080
```

### Create a task

```bash
kbs task create "Fix the login redirect bug"
kbs task create "Update hero section" --attach screenshot.png --attach design.pdf
```

### Manage tasks

```bash
kbs task list                        # List all tasks
kbs task show kbs-001                 # Show task details, steps, and log
kbs task move kbs-001 todo            # Move a task to a column
kbs task merge kbs-001                # Merge an in-review task and close it
kbs task log kbs-001 "Added context"  # Add a log entry
kbs task pause kbs-001                # Pause a task (stops automation)
kbs task unpause kbs-001              # Resume a paused task
kbs task attach kbs-001 ./error.log   # Attach a file to a task
```

### Typical workflow

```bash
# 1. Create a task — it lands in triage
kbs task create "Add dark mode support"

# 2. Start the dashboard — AI specs the task and begins working
kbs dashboard

# 3. Check progress
kbs task list
kbs task show kbs-042

# 4. When it reaches "in-review", review the changes and merge
kbs task merge kbs-042
```

## Standalone binary

Prebuilt standalone binaries are available that require no Node.js runtime. You can also build one yourself with [Bun](https://bun.sh/):

```bash
bun run build.ts
```

See the [GitHub repository](https://github.com/dustinbyrne/kbs) for platform-specific binaries and build instructions.
