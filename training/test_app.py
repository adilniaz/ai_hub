"""Lightweight regression tests for the training control plane."""

from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from training import app as training_app


class DatasetValidationTests(unittest.TestCase):
    def test_default_dataset_has_training_and_held_out_examples(self) -> None:
        project = training_app.default_project()
        report, records = training_app.parse_dataset(project["dataset"])
        self.assertTrue(report["valid"], report["errors"])
        self.assertEqual(report["examples"], 20)
        self.assertEqual(report["trainExamples"], 16)
        self.assertEqual(report["evaluationExamples"], 4)
        self.assertEqual(len(records), 20)

    def test_rejects_invalid_roles(self) -> None:
        dataset = json.dumps(
            {
                "messages": [
                    {"role": "assistant", "content": "Wrong first role"},
                    {"role": "assistant", "content": "Wrong last role"},
                ]
            }
        )
        report, _ = training_app.parse_dataset(dataset)
        self.assertFalse(report["valid"])
        self.assertTrue(report["errors"])


class DummyThread:
    def __init__(self, *args, **kwargs) -> None:
        pass

    def start(self) -> None:
        pass


class DummyProcess:
    pid = 12345


class JobSubmissionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        root = Path(self.temporary_directory.name)
        self.old_jobs_dir = training_app.JOBS_DIR
        self.old_project_path = training_app.PROJECT_PATH
        self.old_job = training_app._job
        self.old_process = training_app._process
        training_app.JOBS_DIR = root / "jobs"
        training_app.PROJECT_PATH = root / "project.json"
        training_app._job = None
        training_app._process = None

    def tearDown(self) -> None:
        training_app.JOBS_DIR = self.old_jobs_dir
        training_app.PROJECT_PATH = self.old_project_path
        training_app._job = self.old_job
        training_app._process = self.old_process
        self.temporary_directory.cleanup()

    @patch.object(training_app.threading, "Thread", DummyThread)
    @patch.object(training_app.subprocess, "Popen", return_value=DummyProcess())
    @patch.object(training_app, "installed_ollama_models", return_value=set())
    def test_job_submission_starts_isolated_worker(self, *_mocks) -> None:
        project = training_app.Project(**training_app.default_project())
        job = training_app.post_job(project)
        self.assertEqual(job["status"], "running")
        self.assertEqual(job["modelName"], "mara-vella")
        job_dir = training_app.JOBS_DIR / job["id"]
        self.assertTrue((job_dir / "project.json").is_file())
        self.assertTrue((job_dir / "dataset.jsonl").is_file())
        self.assertEqual(training_app.PROJECT_PATH.read_text(encoding="utf-8")[0], "{")

    @patch.object(training_app, "installed_ollama_models", return_value={"mara-vella:latest"})
    def test_job_submission_refuses_to_overwrite_model(self, *_mocks) -> None:
        project = training_app.Project(**training_app.default_project())
        with self.assertRaises(training_app.HTTPException) as context:
            training_app.post_job(project)
        self.assertEqual(context.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
