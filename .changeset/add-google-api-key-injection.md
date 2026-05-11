---
"@dustinbyrne/kb": patch
---

Transitioned to a manual Google API key management system, removing persistent OAuth providers. Core services (Triage, Reviewer, Merger) now inject API keys from user settings directly into agent sessions. Standardized the default model to gemma-4-31b-it and fixed Windows path issues in the engine test suite.
