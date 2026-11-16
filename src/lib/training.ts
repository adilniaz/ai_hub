export interface CharacterProject {
  version: 1;
  character: {
    name: string;
    setting: string;
    personality: string;
    speakingStyle: string;
    backstory: string;
    avoid: string;
  };
  baseModel: string;
  outputName: string;
  dataset: string;
  maxSeqLength: number;
  epochs: number;
  learningRate: number;
}

export interface TrainingStatus {
  ready: boolean;
  python: string;
  gpu: { name: string; totalMb: number; usedMb: number } | null;
  dependencies: { unsloth: boolean; trl: boolean; peft: boolean };
  error: string | null;
}

export interface DatasetReport {
  valid: boolean;
  examples: number;
  trainExamples: number;
  evaluationExamples: number;
  errors: string[];
}

export type TrainingJobStatus =
  | "queued"
  | "running"
  | "cancelling"
  | "complete"
  | "error"
  | "cancelled";

export interface TrainingJob {
  id: string;
  status: TrainingJobStatus;
  stage: "preparing" | "training" | "exporting" | "registering" | "complete";
  message: string;
  progress: { step: number; totalSteps: number; loss: number | null } | null;
  createdAt: string;
  updatedAt: string;
  modelName: string;
  error: string | null;
  log: string[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/training${path}`, {
      ...init,
      headers: init?.body
        ? { "content-type": "application/json", ...init.headers }
        : init?.headers,
    });
  } catch {
    throw new Error(
      "The character training service is not reachable. Start it with npm run training.",
    );
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!response.ok) {
    const detail =
      typeof payload === "object" && payload !== null && "detail" in payload
        ? payload.detail
        : payload;
    if (typeof detail === "string") throw new Error(detail);
    if (typeof detail === "object" && detail !== null && "message" in detail) {
      throw new Error(String(detail.message));
    }
    if (Array.isArray(detail)) {
      const message = detail
        .map((entry) =>
          typeof entry === "object" && entry !== null && "msg" in entry
            ? String(entry.msg)
            : String(entry),
        )
        .join(" ");
      throw new Error(message || `Request failed (${response.status}).`);
    }
    throw new Error(`Training request failed (${response.status}).`);
  }
  return payload as T;
}

export function getTrainingStatus(): Promise<TrainingStatus> {
  return request<TrainingStatus>("/status");
}

export function getCharacterProject(): Promise<CharacterProject> {
  return request<CharacterProject>("/project");
}

export function saveCharacterProject(
  project: CharacterProject,
): Promise<CharacterProject> {
  return request<CharacterProject>("/project", {
    method: "PUT",
    body: JSON.stringify(project),
  });
}

export function validateDataset(dataset: string): Promise<DatasetReport> {
  return request<DatasetReport>("/validate", {
    method: "POST",
    body: JSON.stringify({ dataset }),
  });
}

export function startTraining(project: CharacterProject): Promise<TrainingJob> {
  return request<TrainingJob>("/jobs", {
    method: "POST",
    body: JSON.stringify(project),
  });
}

export function getCurrentTrainingJob(): Promise<TrainingJob | null> {
  return request<TrainingJob | null>("/jobs/current");
}

export function cancelTraining(): Promise<TrainingJob | null> {
  return request<TrainingJob | null>("/jobs/cancel", { method: "POST" });
}

export function isTrainingActive(job: TrainingJob | null): boolean {
  return Boolean(
    job && ["queued", "running", "cancelling"].includes(job.status),
  );
}
