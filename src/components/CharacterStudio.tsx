import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  Cpu,
  Database,
  LoaderCircle,
  Play,
  Save,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { classNames } from "../lib/utils";
import {
  cancelTraining,
  getCharacterProject,
  getCurrentTrainingJob,
  getTrainingStatus,
  isTrainingActive,
  saveCharacterProject,
  startTraining,
  validateDataset,
  type CharacterProject,
  type DatasetReport,
  type TrainingJob,
  type TrainingStatus,
} from "../lib/training";

interface CharacterStudioProps {
  onClose: () => void;
  onModelCreated: (modelName: string) => void;
}

type StudioTab = "character" | "dataset" | "training";

const tabs: Array<{
  id: StudioTab;
  label: string;
  icon: typeof BookOpen;
}> = [
  { id: "character", label: "Character", icon: BookOpen },
  { id: "dataset", label: "Training data", icon: Database },
  { id: "training", label: "Train & export", icon: Sparkles },
];

const fieldLabels = {
  setting: "Setting",
  personality: "Personality",
  speakingStyle: "Speaking style",
  backstory: "Backstory",
  avoid: "Avoid",
} as const;

export function CharacterStudio({
  onClose,
  onModelCreated,
}: CharacterStudioProps) {
  const titleId = useId();
  const modalRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const logRef = useRef<HTMLPreElement>(null);
  const [activeTab, setActiveTab] = useState<StudioTab>("character");
  const [project, setProject] = useState<CharacterProject | null>(null);
  const [status, setStatus] = useState<TrainingStatus | null>(null);
  const [job, setJob] = useState<TrainingJob | null>(null);
  const [report, setReport] = useState<DatasetReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const active = isTrainingActive(job);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      getTrainingStatus(),
      getCharacterProject(),
      getCurrentTrainingJob(),
    ])
      .then(([nextStatus, nextProject, nextJob]) => {
        if (cancelled) return;
        setStatus(nextStatus);
        setProject(nextProject);
        setJob(nextJob);
        void validateDataset(nextProject.dataset).then((nextReport) => {
          if (!cancelled) setReport(nextReport);
        });
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not open the character studio.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      void getCurrentTrainingJob()
        .then(setJob)
        .catch((reason: unknown) => {
          setError(
            reason instanceof Error ? reason.message : "Could not read job progress.",
          );
        });
    }, 1500);
    return () => window.clearInterval(timer);
  }, [active]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !modalRef.current) return;
      const focusable = Array.from(
        modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const focused = document.activeElement;
      if (event.shiftKey && (focused === first || !modalRef.current.contains(focused))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (focused === last || !modalRef.current.contains(focused))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [job?.log]);

  const updateCharacter = (
    key: keyof CharacterProject["character"],
    value: string,
  ) => {
    setProject((previous) =>
      previous
        ? { ...previous, character: { ...previous.character, [key]: value } }
        : previous,
    );
    setSaved(false);
  };

  const updateProject = <K extends keyof CharacterProject>(
    key: K,
    value: CharacterProject[K],
  ) => {
    setProject((previous) =>
      previous ? { ...previous, [key]: value } : previous,
    );
    setSaved(false);
  };

  const handleSave = async () => {
    if (!project) return;
    setBusy("save");
    setError(null);
    try {
      const nextProject = await saveCharacterProject(project);
      setProject(nextProject);
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save project.");
    } finally {
      setBusy(null);
    }
  };

  const handleValidate = async () => {
    if (!project) return;
    setBusy("validate");
    setError(null);
    try {
      setReport(await validateDataset(project.dataset));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not validate data.");
    } finally {
      setBusy(null);
    }
  };

  const handleStart = async () => {
    if (!project) return;
    setBusy("start");
    setError(null);
    try {
      const nextReport = await validateDataset(project.dataset);
      setReport(nextReport);
      if (!nextReport.valid) {
        setActiveTab("dataset");
        return;
      }
      const nextJob = await startTraining(project);
      setJob(nextJob);
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not start training.");
    } finally {
      setBusy(null);
    }
  };

  const handleCancel = async () => {
    setBusy("cancel");
    setError(null);
    try {
      setJob(await cancelTraining());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not cancel training.");
    } finally {
      setBusy(null);
    }
  };

  const progress = job?.progress;
  const progressPercent =
    job?.status === "complete"
      ? 100
      : progress && progress.totalSteps > 0
        ? Math.min(100, Math.round((progress.step / progress.totalSteps) * 100))
        : 0;

  return (
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className="modal-overlay character-studio-overlay"
      role="dialog"
      onMouseDown={(event: MouseEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="character-studio" ref={modalRef}>
        <header className="character-studio-header">
          <div className="character-studio-heading">
            <span className="character-studio-mark" aria-hidden="true">
              <Sparkles size={19} />
            </span>
            <div>
              <p className="settings-eyebrow">Local character workshop</p>
              <h2 id={titleId}>Create a character model</h2>
              <p>Teach a small base model a consistent voice, then export it to Ollama.</p>
            </div>
          </div>
          <button
            ref={closeRef}
            aria-label="Close character studio"
            className="icon-button"
            type="button"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </header>

        <div className="character-studio-tabs" role="tablist" aria-label="Character model setup">
          {tabs.map((tab, index) => {
            const Icon = tab.icon;
            return (
              <button
                aria-selected={activeTab === tab.id}
                className={classNames("character-studio-tab", activeTab === tab.id && "is-active")}
                key={tab.id}
                role="tab"
                type="button"
                onClick={() => setActiveTab(tab.id)}
              >
                <span>{index + 1}</span>
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="character-studio-body">
          {error ? (
            <div className="training-alert is-error" role="alert">
              <AlertCircle size={16} />
              <span>{error}</span>
              <button aria-label="Dismiss error" type="button" onClick={() => setError(null)}>
                <X size={14} />
              </button>
            </div>
          ) : null}

          {loading || !project ? (
            <div className="training-loading">
              <LoaderCircle className="is-spinning" size={22} />
              <p>Opening the local workshop…</p>
            </div>
          ) : (
            <>
              {activeTab === "character" ? (
                <section className="training-panel" aria-label="Character definition">
                  <div className="training-panel-intro">
                    <div>
                      <h3>Who are they?</h3>
                      <p>This card is included in every training conversation and saved as the exported model’s system prompt.</p>
                    </div>
                    <button className="button-quiet" disabled={active || busy === "save"} type="button" onClick={() => void handleSave()}>
                      {busy === "save" ? <LoaderCircle className="is-spinning" size={14} /> : saved ? <Check size={14} /> : <Save size={14} />}
                      {saved ? "Saved" : "Save project"}
                    </button>
                  </div>
                  <div className="character-name-row">
                    <label className="training-field">
                      <span>Character name</span>
                      <input disabled={active} value={project.character.name} onChange={(event) => updateCharacter("name", event.target.value)} />
                    </label>
                    <div className="character-card-note">
                      <BookOpen size={16} />
                      <p>Personality belongs in training. Keep large or changing lore in prompts or retrieval instead.</p>
                    </div>
                  </div>
                  <div className="character-field-grid">
                    {(Object.keys(fieldLabels) as Array<keyof typeof fieldLabels>).map((key) => (
                      <label className={classNames("training-field", key === "backstory" && "is-wide")} key={key}>
                        <span>{fieldLabels[key]}</span>
                        <textarea disabled={active} rows={key === "backstory" ? 4 : 3} value={project.character[key]} onChange={(event) => updateCharacter(key, event.target.value)} />
                      </label>
                    ))}
                  </div>
                </section>
              ) : null}

              {activeTab === "dataset" ? (
                <section className="training-panel" aria-label="Training dataset">
                  <div className="training-panel-intro">
                    <div>
                      <h3>Show, don’t just describe</h3>
                      <p>Each JSONL line contains alternating user and assistant messages. Add <code>split: "evaluation"</code> to hold an example out of training.</p>
                    </div>
                    <button className="button-quiet" disabled={active || busy === "validate"} type="button" onClick={() => void handleValidate()}>
                      {busy === "validate" ? <LoaderCircle className="is-spinning" size={14} /> : <CheckCircle2 size={14} />}
                      Validate data
                    </button>
                  </div>
                  <div className="training-alert">
                    <AlertCircle size={16} />
                    <p>The 20 included Mara Vella examples are a <strong>pipeline test</strong>, not enough for a polished character. Replace them with varied, reviewed dialogue for a useful result.</p>
                  </div>
                  {report ? (
                    <div className={classNames("dataset-report", report.valid ? "is-valid" : "is-invalid")}>
                      <span>{report.valid ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}</span>
                      <strong>{report.examples} examples</strong>
                      <span>{report.trainExamples} training</span>
                      <span>{report.evaluationExamples} held out</span>
                    </div>
                  ) : null}
                  <textarea
                    aria-label="Training examples in JSONL format"
                    className="dataset-editor"
                    disabled={active}
                    spellCheck={false}
                    value={project.dataset}
                    onChange={(event) => {
                      updateProject("dataset", event.target.value);
                      setReport(null);
                    }}
                  />
                  {report && !report.valid ? (
                    <ul className="dataset-errors">
                      {report.errors.map((message) => <li key={message}>{message}</li>)}
                    </ul>
                  ) : null}
                </section>
              ) : null}

              {activeTab === "training" ? (
                <section className="training-panel" aria-label="Training and export">
                  <div className="training-panel-intro">
                    <div>
                      <h3>Train, export, and chat</h3>
                      <p>One local job trains a LoRA adapter, exports GGUF, and registers a new Ollama model. Existing models are never overwritten.</p>
                    </div>
                    {status?.ready ? <span className="training-ready"><CheckCircle2 size={14} /> Ready</span> : null}
                  </div>

                  <div className="training-hardware">
                    <Cpu size={19} />
                    <div>
                      <strong>{status?.gpu?.name ?? "Training service unavailable"}</strong>
                      <span>{status?.gpu ? `${(status.gpu.totalMb / 1024).toFixed(1)} GB VRAM · 4-bit QLoRA · one job at a time` : "Start the Python service to enable training."}</span>
                    </div>
                  </div>

                  <div className="training-config-grid">
                    <label className="training-field is-wide">
                      <span>Base training checkpoint</span>
                      <input disabled={active} value={project.baseModel} onChange={(event) => updateProject("baseModel", event.target.value)} />
                      <small>A Hugging Face model ID, not an installed Ollama name. The first run downloads it.</small>
                    </label>
                    <label className="training-field">
                      <span>New Ollama model name</span>
                      <input disabled={active} value={project.outputName} onChange={(event) => updateProject("outputName", event.target.value.toLowerCase())} />
                    </label>
                    <label className="training-field">
                      <span>Sequence length</span>
                      <select disabled={active} value={project.maxSeqLength} onChange={(event) => updateProject("maxSeqLength", Number(event.target.value))}>
                        <option value={512}>512 tokens · least memory</option>
                        <option value={1024}>1024 tokens · recommended</option>
                        <option value={2048}>2048 tokens · more memory</option>
                      </select>
                    </label>
                    <label className="training-field">
                      <span>Epochs</span>
                      <input disabled={active} max={10} min={1} type="number" value={project.epochs} onChange={(event) => updateProject("epochs", Number(event.target.value))} />
                    </label>
                    <label className="training-field">
                      <span>Learning rate</span>
                      <input disabled={active} max={0.01} min={0.000001} step={0.00005} type="number" value={project.learningRate} onChange={(event) => updateProject("learningRate", Number(event.target.value))} />
                    </label>
                  </div>

                  {job ? (
                    <div className={classNames("training-job", `is-${job.status}`)}>
                      <div className="training-job-heading">
                        <div>
                          <span className="training-job-status">{job.status === "complete" ? <CheckCircle2 size={15} /> : active ? <LoaderCircle className="is-spinning" size={15} /> : <AlertCircle size={15} />}{job.stage}</span>
                          <strong>{job.message}</strong>
                        </div>
                        {progress && progress.totalSteps > 0 ? (
                          <span>
                            {job.status === "complete" ? progress.totalSteps : progress.step}/{progress.totalSteps} steps
                          </span>
                        ) : null}
                      </div>
                      <div className="training-progress" aria-label={`Training progress ${progressPercent}%`}>
                        <span style={{ width: `${progressPercent}%` }} />
                      </div>
                      {progress?.loss !== null && progress?.loss !== undefined ? <p className="training-loss">Latest training loss: {progress.loss.toFixed(4)}</p> : null}
                      {job.log.length > 0 ? <pre className="training-log" ref={logRef}>{job.log.join("\n")}</pre> : null}
                      {job.status === "complete" ? (
                        <button className="button-primary training-use-model" type="button" onClick={() => onModelCreated(job.modelName)}>
                          Chat with {job.modelName}<ArrowRight size={15} />
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="training-actions">
                    <p>{active ? "You can close this window; the job continues locally." : "Training can take a long time and will use your GPU. Export also needs additional disk space."}</p>
                    {active ? (
                      <button className="button-danger" disabled={busy === "cancel" || job?.status === "cancelling"} type="button" onClick={() => void handleCancel()}>
                        <Square size={14} />{job?.status === "cancelling" ? "Cancelling…" : "Cancel job"}
                      </button>
                    ) : (
                      <button className="button-primary" disabled={!status?.ready || busy === "start" || !report?.valid} title={!report?.valid ? "Validate the dataset first" : undefined} type="button" onClick={() => void handleStart()}>
                        {busy === "start" ? <LoaderCircle className="is-spinning" size={15} /> : <Play size={15} />}
                        {busy === "start" ? "Starting…" : "Train & export"}
                      </button>
                    )}
                  </div>
                </section>
              ) : null}
            </>
          )}
        </div>

        <footer className="character-studio-footer">
          <span><span className={classNames("studio-service-dot", status?.ready && "is-ready")} />{status?.ready ? "Training service connected" : "Training service not ready"}</span>
          <span>Local files only · held-out examples are never trained on</span>
        </footer>
      </div>
    </div>
  );
}
