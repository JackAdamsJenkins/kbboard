import { useState, useEffect, useCallback, useRef } from "react";
import { THINKING_LEVELS } from "@kb/core";
import type { Settings } from "@kb/core";
import { fetchSettings, updateSettings, fetchAuthStatus, loginProvider, logoutProvider, fetchModels } from "../api";
import type { AuthProvider, ModelInfo } from "../api";
import type { ToastType } from "../hooks/useToast";

/**
 * Settings sections configuration.
 *
 * Each section groups related settings fields under a sidebar nav item.
 * To add a new section:
 *   1. Add an entry to SETTINGS_SECTIONS with a unique id and label
 *   2. Add a corresponding case in renderSectionFields()
 *
 * Sections:
 *   - general: Task prefix configuration
 *   - scheduling: Concurrency, poll interval, file overlap serialization
 *   - worktrees: Worktree limits, init commands, recycling
 *   - commands: Test and build command configuration
 *   - merge: Auto-merge settings
 *   - model: Default AI model selection for agent sessions
 *   - authentication: OAuth provider status, login/logout (operates independently of Save)
 */
const SETTINGS_SECTIONS = [
  { id: "general", label: "General" },
  { id: "model", label: "Model" },
  { id: "scheduling", label: "Scheduling" },
  { id: "worktrees", label: "Worktrees" },
  { id: "commands", label: "Commands" },
  { id: "merge", label: "Merge" },
  { id: "google", label: "Google API Keys" },
] as const;

export type SectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

interface SettingsModalProps {
  onClose: () => void;
  addToast: (message: string, type?: ToastType) => void;
  /** Optional section to show when the modal first opens. Defaults to "general". */
  initialSection?: SectionId;
}

export function SettingsModal({ onClose, addToast, initialSection }: SettingsModalProps) {
  const [form, setForm] = useState<Settings & { worktreeInitCommand?: string }>({ maxConcurrent: 2, maxWorktrees: 4, pollIntervalMs: 15000, groupOverlappingFiles: false, autoMerge: true, recycleWorktrees: false, includeTaskIdInCommit: true, worktreeInitCommand: "" });
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<SectionId>(initialSection ?? SETTINGS_SECTIONS[0].id);
  const [prefixError, setPrefixError] = useState<string | null>(null);

  // Auth state (independent of the settings save flow)
  const [authProviders, setAuthProviders] = useState<AuthProvider[]>([]);
  const [authLoading, setAuthLoading] = useState(false);
  const [authActionInProgress, setAuthActionInProgress] = useState<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Model state
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([
    { provider: "google", id: "gemma-4-31b-it", name: "Gemma 4 31B IT", reasoning: false, contextWindow: 131072 }
  ]);
  const [modelsLoading, setModelsLoading] = useState(false);

  useEffect(() => {
    fetchSettings()
      .then((s) => {
        setForm(s);
        setLoading(false);
      })
      .catch((err) => {
        addToast(err.message, "error");
        setLoading(false);
      });
  }, [addToast]);

  // Load auth status when the authentication section is active
  const loadAuthStatus = useCallback(async () => {
    try {
      const { providers } = await fetchAuthStatus();
      setAuthProviders(providers);
    } catch {
      // Silently fail — auth may not be configured
    }
  }, []);

  useEffect(() => {
    if (activeSection === "model") {
      setModelsLoading(true);
      fetchModels()
        .then((models) => setAvailableModels(models))
        .catch(() => setAvailableModels([]))
        .finally(() => setModelsLoading(false));
    }
  }, [activeSection]);

  useEffect(() => {
    if (activeSection === "authentication") {
      setAuthLoading(true);
      loadAuthStatus().finally(() => setAuthLoading(false));
    }
    // Clean up polling when leaving auth section
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [activeSection, loadAuthStatus]);

  const handleAddKey = () => {
    setForm((f) => ({
      ...f,
      googleApiKeys: [...(f.googleApiKeys || []), ""],
    }));
  };

  const handleUpdateKey = (index: number, value: string) => {
    setForm((f) => {
      const keys = [...(f.googleApiKeys || [])];
      keys[index] = value;
      return { ...f, googleApiKeys: keys };
    });
  };

  const handleRemoveKey = (index: number) => {
    setForm((f) => {
      const keys = [...(f.googleApiKeys || [])];
      keys.splice(index, 1);
      return { ...f, googleApiKeys: keys };
    });
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  const handleSave = useCallback(async () => {
    if (prefixError) return;
    try {
      const payload = {
        ...form,
        worktreeInitCommand: form.worktreeInitCommand?.trim() || undefined,
        taskPrefix: form.taskPrefix?.trim() || undefined,
      };
      await updateSettings(payload);
      addToast("Settings saved", "success");
      onClose();
    } catch (err: any) {
      addToast(err.message, "error");
    }
  }, [form, prefixError, onClose, addToast]);

  const renderSectionFields = () => {
    switch (activeSection) {
      case "general":
        return (
          <>
            <h4 className="settings-section-heading">General</h4>
            <div className="form-group">
              <label htmlFor="taskPrefix">Task Prefix</label>
              <input
                id="taskPrefix"
                type="text"
                placeholder="KB"
                value={form.taskPrefix || ""}
                onChange={(e) => {
                  const val = e.target.value;
                  setForm((f) => ({ ...f, taskPrefix: val || undefined }));
                  if (val && !/^[A-Z]{1,10}$/.test(val)) {
                    setPrefixError("Prefix must be 1–10 uppercase letters");
                  } else {
                    setPrefixError(null);
                  }
                }}
              />
              {prefixError && <small className="field-error">{prefixError}</small>}
              {!prefixError && <small>Prefix for new task IDs (e.g. KB, PROJ)</small>}
            </div>
          </>
        );
      case "model": {
        // Group models by provider
        const modelsByProvider = availableModels.reduce<Record<string, ModelInfo[]>>((acc, m) => {
          (acc[m.provider] ??= []).push(m);
          return acc;
        }, {});
        const selectedValue = form.defaultProvider && form.defaultModelId
          ? `${form.defaultProvider}/${form.defaultModelId}`
          : "";
        return (
          <>
            <h4 className="settings-section-heading">Model</h4>
            {modelsLoading ? (
              <div className="settings-empty-state">Loading available models…</div>
            ) : availableModels.length === 0 ? (
              <div className="settings-empty-state settings-muted">
                No models available. Configure authentication first.
              </div>
            ) : (
              <div className="form-group">
                <label htmlFor="defaultModel">Default Model</label>
                <select
                  id="defaultModel"
                  value={selectedValue || "google/gemma-4-31b-it"}
                  onChange={(e) => {
                    const val = e.target.value;
                    const slashIdx = val.indexOf("/");
                    setForm((f) => ({
                      ...f,
                      defaultProvider: val.slice(0, slashIdx),
                      defaultModelId: val.slice(slashIdx + 1),
                    }));
                  }}
                >
                  {Object.entries(modelsByProvider).map(([provider, models]) => (
                    <optgroup key={provider} label={provider}>
                      {models.map((m) => (
                        <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
                          {m.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <small>Select the AI model used for agent sessions. Default: Gemma 4 31B IT.</small>
              </div>
            )}
            {(() => {
              const selectedModel = availableModels.find(
                (m) => m.provider === form.defaultProvider && m.id === form.defaultModelId,
              );
              if (selectedModel && !selectedModel.reasoning) return null;
              return (
                <div className="form-group">
                  <label htmlFor="defaultThinkingLevel">Thinking Effort</label>
                  <select
                    id="defaultThinkingLevel"
                    value={form.defaultThinkingLevel || ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      setForm((f) => ({ ...f, defaultThinkingLevel: val || undefined } as any));
                    }}
                  >
                    <option value="">Default</option>
                    {THINKING_LEVELS.map((level) => (
                      <option key={level} value={level}>
                        {level.charAt(0).toUpperCase() + level.slice(1)}
                      </option>
                    ))}
                  </select>
                  <small>Controls how much reasoning effort the AI model uses. Higher levels produce better results but cost more.</small>
                </div>
              );
            })()}
          </>
        );
      }
      case "scheduling":
        return (
          <>
            <h4 className="settings-section-heading">Scheduling</h4>
            <div className="form-group">
              <label htmlFor="maxConcurrent">Max Concurrent Tasks</label>
              <input
                id="maxConcurrent"
                type="number"
                min={1}
                max={10}
                value={form.maxConcurrent}
                onChange={(e) =>
                  setForm((f) => ({ ...f, maxConcurrent: Number(e.target.value) }))
                }
              />
            </div>
            <div className="form-group">
              <label htmlFor="pollIntervalMs">Poll Interval (ms)</label>
              <input
                id="pollIntervalMs"
                type="number"
                min={5000}
                step={1000}
                value={form.pollIntervalMs}
                onChange={(e) =>
                  setForm((f) => ({ ...f, pollIntervalMs: Number(e.target.value) }))
                }
              />
            </div>
            <div className="form-group">
              <label htmlFor="groupOverlappingFiles" className="checkbox-label">
                <input
                  id="groupOverlappingFiles"
                  type="checkbox"
                  checked={form.groupOverlappingFiles}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, groupOverlappingFiles: e.target.checked }))
                  }
                />
                Serialize tasks with overlapping files
              </label>
              <small>When enabled, tasks that modify the same files are queued serially to avoid merge conflicts</small>
            </div>
          </>
        );
      case "worktrees":
        return (
          <>
            <h4 className="settings-section-heading">Worktrees</h4>
            <div className="form-group">
              <label htmlFor="maxWorktrees">Max Worktrees</label>
              <input
                id="maxWorktrees"
                type="number"
                min={1}
                max={20}
                value={form.maxWorktrees}
                onChange={(e) =>
                  setForm((f) => ({ ...f, maxWorktrees: Number(e.target.value) }))
                }
              />
              <small>Limits total git worktrees including in-review tasks</small>
            </div>
            <div className="form-group">
              <label htmlFor="worktreeInitCommand">Worktree Init Command</label>
              <input
                id="worktreeInitCommand"
                type="text"
                placeholder="pnpm install"
                value={form.worktreeInitCommand || ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, worktreeInitCommand: e.target.value }))
                }
              />
              <small>Shell command to run in each new worktree after creation</small>
            </div>
            <div className="form-group">
              <label htmlFor="recycleWorktrees" className="checkbox-label">
                <input
                  id="recycleWorktrees"
                  type="checkbox"
                  checked={form.recycleWorktrees}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, recycleWorktrees: e.target.checked }))
                  }
                />
                Recycle worktrees
              </label>
              <small>When enabled, completed task worktrees are returned to an idle pool instead of being deleted, preserving build caches for faster startup</small>
            </div>
          </>
        );
      case "commands":
        return (
          <>
            <h4 className="settings-section-heading">Commands</h4>
            <div className="form-group">
              <label htmlFor="testCommand">Test Command</label>
              <input
                id="testCommand"
                type="text"
                placeholder="e.g. pnpm test"
                value={form.testCommand || ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, testCommand: e.target.value || undefined }))
                }
              />
              <small>Command used to run tests — injected into generated task specs</small>
            </div>
            <div className="form-group">
              <label htmlFor="buildCommand">Build Command</label>
              <input
                id="buildCommand"
                type="text"
                placeholder="e.g. pnpm build"
                value={form.buildCommand || ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, buildCommand: e.target.value || undefined }))
                }
              />
              <small>Command used to build the project — injected into generated task specs</small>
            </div>
          </>
        );
      case "merge":
        return (
          <>
            <h4 className="settings-section-heading">Merge</h4>
            <div className="form-group">
              <label htmlFor="autoMerge" className="checkbox-label">
                <input
                  id="autoMerge"
                  type="checkbox"
                  checked={form.autoMerge}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, autoMerge: e.target.checked }))
                  }
                />
                Auto-merge completed tasks
              </label>
              <small>When enabled, tasks that pass review are automatically merged into the main branch</small>
            </div>
            <div className="form-group">
              <label htmlFor="includeTaskIdInCommit" className="checkbox-label">
                <input
                  id="includeTaskIdInCommit"
                  type="checkbox"
                  checked={form.includeTaskIdInCommit !== false}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, includeTaskIdInCommit: e.target.checked }))
                  }
                />
                Include task ID in commit scope
              </label>
              <small>When disabled, merge commit messages omit the task ID from the scope (e.g. <code>feat: ...</code> instead of <code>feat(KB-001): ...</code>)</small>
            </div>
          </>
        );
      case "google":
        return (
          <>
            <h4 className="settings-section-heading">Google API Keys</h4>
            <div className="api-keys-list">
              {(form.googleApiKeys || []).map((key, index) => (
                <div key={index} className="api-key-row">
                  <input
                    type="password"
                    placeholder="Enter Google API Key"
                    value={key}
                    onChange={(e) => handleUpdateKey(index, e.target.value)}
                  />
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => handleRemoveKey(index)}
                    title="Remove key"
                  >
                    &times;
                  </button>
                </div>
              ))}
              <button className="btn btn-sm" onClick={handleAddKey}>
                + Add API Key
              </button>
            </div>
            <small className="auth-hint">
              Google API keys are used by the AI engine to access Gemini and Gemma models.
            </small>
          </>
        );
    }
  };

  return (
    <div className="modal-overlay open" onClick={handleOverlayClick}>
      <div className="modal modal-lg">
        <div className="modal-header">
          <h3>Settings</h3>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        {loading ? (
          <div className="settings-empty-state settings-loading">Loading…</div>
        ) : (
          <div className="settings-layout">
            <nav className="settings-sidebar">
              {SETTINGS_SECTIONS.map((section) => (
                <button
                  key={section.id}
                  className={`settings-nav-item${activeSection === section.id ? " active" : ""}`}
                  onClick={() => setActiveSection(section.id)}
                >
                  {section.label}
                </button>
              ))}
            </nav>
            <div className="settings-content">
              {renderSectionFields()}
            </div>
          </div>
        )}
        <div className="modal-actions">
          <button className="btn btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={loading}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
