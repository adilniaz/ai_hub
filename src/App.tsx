import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CharacterStudio } from "./components/CharacterStudio";
import { ChatView } from "./components/ChatView";
import { ModelSettingsModal } from "./components/ModelSettingsModal";
import { SettingsModal } from "./components/SettingsModal";
import { Sidebar } from "./components/Sidebar";
import { Toast } from "./components/Toast";
import { fetchModels, streamChat } from "./lib/api";
import {
  getEffectiveModelOptions,
  hasModelOverrides,
} from "./lib/modelOptions";
import {
  loadConversations,
  loadSettings,
  saveConversations,
  saveSettings,
} from "./lib/storage";
import { makeChatTitle, uid } from "./lib/utils";
import type {
  ApiChatMessage,
  ChatMessage,
  Conversation,
  MessageStats,
  ModelOptions,
  ModelsState,
  Settings,
  ToastState,
} from "./types";

function buildApiMessages(
  messages: ChatMessage[],
  systemPrompt: string,
): ApiChatMessage[] {
  const result: ApiChatMessage[] = [];
  const trimmedSystemPrompt = systemPrompt.trim();
  if (trimmedSystemPrompt) {
    result.push({ role: "system", content: trimmedSystemPrompt });
  }

  for (const message of messages) {
    if (message.role === "assistant" && !message.content) continue;
    const apiMessage: ApiChatMessage = {
      role: message.role,
      content: message.content,
    };
    if (message.images?.length) {
      apiMessage.images = message.images.map((image) => {
        const commaIndex = image.indexOf(",");
        return commaIndex >= 0 ? image.slice(commaIndex + 1) : image;
      });
    }
    result.push(apiMessage);
  }

  return result;
}

function getLatestChatId(chats: Conversation[]): string | null {
  return [...chats].sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null;
}

export default function App() {
  const [conversations, setConversations] =
    useState<Conversation[]>(loadConversations);
  const [activeId, setActiveId] = useState<string | null>(() =>
    getLatestChatId(loadConversations()),
  );
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [modelsState, setModelsState] = useState<ModelsState>({
    status: "loading",
    models: [],
    error: null,
  });
  const [streamingByConversation, setStreamingByConversation] = useState<
    Record<string, string>
  >({});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [characterStudioOpen, setCharacterStudioOpen] = useState(false);
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const [newChatNonce, setNewChatNonce] = useState(0);
  const [toast, setToast] = useState<ToastState | null>(null);

  const conversationsRef = useRef(conversations);
  const abortControllers = useRef(new Map<string, AbortController>());
  const modelsAbort = useRef<AbortController | null>(null);
  const toastTimer = useRef<number | null>(null);
  const storageWarningShown = useRef(false);

  const activeConversation =
    conversations.find((conversation) => conversation.id === activeId) ?? null;

  const currentModel = useMemo(() => {
    if (modelsState.models.length === 0) return "";
    const preferred = activeConversation?.model || settings.lastModel;
    return modelsState.models.some((model) => model.name === preferred)
      ? preferred
      : modelsState.models[0].name;
  }, [modelsState.models, activeConversation?.model, settings.lastModel]);

  const currentModelInfo = modelsState.models.find(
    (model) => model.name === currentModel,
  );
  const currentModelOptions = currentModel
    ? (settings.modelOptions[currentModel] ?? {})
    : {};
  const currentModelCustomized = currentModel
    ? hasModelOverrides(settings, currentModel)
    : false;

  const activeStreamingMessageId = activeId
    ? (streamingByConversation[activeId] ?? null)
    : null;

  const streamingIds = useMemo(
    () => new Set(Object.keys(streamingByConversation)),
    [streamingByConversation],
  );

  const dismissToast = useCallback(() => {
    if (toastTimer.current) {
      window.clearTimeout(toastTimer.current);
      toastTimer.current = null;
    }
    setToast(null);
  }, []);

  const showToast = useCallback(
    (message: string, actionLabel?: string, onAction?: () => void) => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      setToast({ id: uid(), message, actionLabel, onAction });
      toastTimer.current = window.setTimeout(() => {
        setToast(null);
        toastTimer.current = null;
      }, 5000);
    },
    [],
  );

  const loadModels = useCallback(async () => {
    modelsAbort.current?.abort();
    const controller = new AbortController();
    modelsAbort.current = controller;
    setModelsState((previous) => ({
      status: "loading",
      models: previous.models,
      error: null,
    }));

    try {
      const models = await fetchModels(controller.signal);
      if (controller.signal.aborted) return;
      setModelsState({ status: "ready", models, error: null });
      setSettings((previous) => {
        if (
          previous.lastModel &&
          models.some((model) => model.name === previous.lastModel)
        ) {
          return previous;
        }
        return { ...previous, lastModel: models[0]?.name ?? "" };
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      const message =
        error instanceof Error
          ? error.message
          : "Could not connect to Ollama.";
      setModelsState((previous) => ({
        status: "error",
        models: previous.models,
        error: message,
      }));
    }
  }, []);

  useEffect(() => {
    void loadModels();
    return () => modelsAbort.current?.abort();
  }, [loadModels]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    root.style.setProperty("--font-scale", String(settings.fontScale));
    root.style.setProperty("--ui-scale", String(settings.uiScale));
    root.style.setProperty(
      "--ui-width",
      `${100 / settings.uiScale}%`,
    );
    root.style.setProperty(
      "--ui-height",
      `${100 / settings.uiScale}dvh`,
    );
    const themeColor = document.querySelector('meta[name="theme-color"]');
    themeColor?.setAttribute(
      "content",
      settings.theme === "dark" ? "#141311" : "#f3efe6",
    );
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    conversationsRef.current = conversations;
    const timer = window.setTimeout(() => {
      const saved = saveConversations(conversations);
      if (!saved && !storageWarningShown.current) {
        storageWarningShown.current = true;
        showToast("Browser storage is full — recent changes may not be saved.");
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [conversations, showToast]);

  useEffect(() => {
    const flush = () => saveConversations(conversationsRef.current);
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, []);

  useEffect(() => {
    return () => {
      for (const controller of abortControllers.current.values()) {
        controller.abort();
      }
    };
  }, []);

  useEffect(() => {
    document.title = activeConversation
      ? `${activeConversation.title} — Local Chat`
      : "Local Chat — for Ollama";
  }, [activeConversation?.title]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "o"
      ) {
        event.preventDefault();
        setActiveId(null);
        setNewChatNonce((current) => current + 1);
        setSidebarOpen(false);
      }
      if (event.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  const updateMessage = useCallback(
    (conversationId: string, messageId: string, patch: Partial<ChatMessage>) => {
      setConversations((previous) =>
        previous.map((conversation) => {
          if (conversation.id !== conversationId) return conversation;
          return {
            ...conversation,
            messages: conversation.messages.map((message) =>
              message.id === messageId ? { ...message, ...patch } : message,
            ),
          };
        }),
      );
    },
    [],
  );

  const startGeneration = useCallback(
    async ({
      conversationId,
      assistantId,
      modelName,
      apiMessages,
      options,
    }: {
      conversationId: string;
      assistantId: string;
      modelName: string;
      apiMessages: ApiChatMessage[];
      options: ModelOptions;
    }) => {
      const controller = new AbortController();
      abortControllers.current.set(conversationId, controller);
      setStreamingByConversation((previous) => ({
        ...previous,
        [conversationId]: assistantId,
      }));

      let content = "";
      let thinking = "";
      let stats: MessageStats | null = null;
      let frame: number | null = null;

      const flush = () => {
        frame = null;
        updateMessage(conversationId, assistantId, { content, thinking });
      };
      const scheduleFlush = () => {
        if (frame === null) frame = requestAnimationFrame(flush);
      };
      const cancelFlush = () => {
        if (frame !== null) {
          cancelAnimationFrame(frame);
          frame = null;
        }
      };

      try {
        await streamChat({
          model: modelName,
          messages: apiMessages,
          options,
          signal: controller.signal,
          onToken: (token) => {
            content += token.content;
            thinking += token.thinking;
            scheduleFlush();
          },
          onDone: (nextStats) => {
            stats = nextStats;
          },
        });

        cancelFlush();
        if (controller.signal.aborted) {
          updateMessage(conversationId, assistantId, {
            content,
            thinking,
            stopped: true,
          });
        } else {
          const empty = !content.trim() && !thinking.trim();
          updateMessage(conversationId, assistantId, {
            content,
            thinking,
            stats: stats ?? undefined,
            error: empty ? "The model returned an empty response." : undefined,
          });
        }
      } catch (error) {
        cancelFlush();
        if (controller.signal.aborted) {
          updateMessage(conversationId, assistantId, {
            content,
            thinking,
            stopped: true,
          });
        } else {
          updateMessage(conversationId, assistantId, {
            content,
            thinking,
            error:
              error instanceof Error
                ? error.message
                : "Something went wrong while generating a response.",
          });
        }
      } finally {
        abortControllers.current.delete(conversationId);
        setStreamingByConversation((previous) => {
          if (!(conversationId in previous)) return previous;
          const next = { ...previous };
          delete next[conversationId];
          return next;
        });
        setConversations((previous) =>
          previous.map((conversation) =>
            conversation.id === conversationId
              ? { ...conversation, updatedAt: Date.now() }
              : conversation,
          ),
        );
      }
    },
    [updateMessage],
  );

  const handleSend = useCallback(
    ({ text, images }: { text: string; images: string[] }) => {
      const trimmed = text.trim();
      if (!trimmed && images.length === 0) return;
      if (!currentModel) {
        showToast("No Ollama model is available yet.");
        return;
      }

      const targetId = activeConversation?.id ?? uid();
      if (abortControllers.current.has(targetId)) {
        showToast("Let the current response finish first.");
        return;
      }

      const now = Date.now();
      const userMessage: ChatMessage = {
        id: uid(),
        role: "user",
        content: trimmed,
        images: images.length > 0 ? images : undefined,
        createdAt: now,
      };
      const assistantId = uid();
      const assistantMessage: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        createdAt: now,
        model: currentModel,
      };
      const history = activeConversation?.messages ?? [];
      const apiMessages = buildApiMessages(
        [...history, userMessage],
        settings.systemPrompt,
      );
      const options = getEffectiveModelOptions(settings, currentModel);

      if (activeConversation) {
        setConversations((previous) =>
          previous.map((conversation) =>
            conversation.id === targetId
              ? {
                  ...conversation,
                  model: currentModel,
                  updatedAt: now,
                  messages: [
                    ...conversation.messages,
                    userMessage,
                    assistantMessage,
                  ],
                }
              : conversation,
          ),
        );
      } else {
        const title = makeChatTitle(trimmed);
        const conversation: Conversation = {
          id: targetId,
          title,
          createdAt: now,
          updatedAt: now,
          model: currentModel,
          messages: [userMessage, assistantMessage],
        };
        setConversations((previous) => [conversation, ...previous]);
      }

      setActiveId(targetId);
      void startGeneration({
        conversationId: targetId,
        assistantId,
        modelName: currentModel,
        apiMessages,
        options,
      });
    },
    [
      activeConversation,
      currentModel,
      settings,
      showToast,
      startGeneration,
    ],
  );

  const handleStop = useCallback(() => {
    if (!activeId) return;
    abortControllers.current.get(activeId)?.abort();
  }, [activeId]);

  const handleRegenerate = useCallback(() => {
    if (!activeConversation || !currentModel) return;
    if (abortControllers.current.has(activeConversation.id)) return;

    const messages = activeConversation.messages;
    let lastUserIndex = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === "user") {
        lastUserIndex = index;
        break;
      }
    }
    if (lastUserIndex < 0) return;

    const context = messages.slice(0, lastUserIndex + 1);
    const assistantId = uid();
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: Date.now(),
      model: currentModel,
    };
    const apiMessages = buildApiMessages(context, settings.systemPrompt);
    const options = getEffectiveModelOptions(settings, currentModel);

    setConversations((previous) =>
      previous.map((conversation) =>
        conversation.id === activeConversation.id
          ? {
              ...conversation,
              model: currentModel,
              updatedAt: Date.now(),
              messages: [...context, assistantMessage],
            }
          : conversation,
      ),
    );

    void startGeneration({
      conversationId: activeConversation.id,
      assistantId,
      modelName: currentModel,
      apiMessages,
      options,
    });
  }, [activeConversation, currentModel, settings, startGeneration]);

  const handleModelChange = useCallback(
    (model: string) => {
      setSettings((previous) => ({ ...previous, lastModel: model }));
      if (!activeId) return;
      setConversations((previous) =>
        previous.map((conversation) =>
          conversation.id === activeId
            ? { ...conversation, model }
            : conversation,
        ),
      );
    },
    [activeId],
  );

  const handleSaveModelOptions = useCallback(
    (options: ModelOptions) => {
      if (!currentModel) return;
      setSettings((previous) => {
        const modelOptions = { ...previous.modelOptions };
        if (Object.keys(options).length === 0) {
          delete modelOptions[currentModel];
        } else {
          modelOptions[currentModel] = options;
        }
        return { ...previous, modelOptions };
      });
      showToast("Model settings saved");
    },
    [currentModel, showToast],
  );

  const handleResetModelOptions = useCallback(() => {
    if (!currentModel) return;
    setSettings((previous) => {
      if (!(currentModel in previous.modelOptions)) return previous;
      const modelOptions = { ...previous.modelOptions };
      delete modelOptions[currentModel];
      return { ...previous, modelOptions };
    });
    showToast("Model settings reset");
  }, [currentModel, showToast]);

  const handleNewChat = useCallback(() => {
    setActiveId(null);
    setNewChatNonce((current) => current + 1);
    setSidebarOpen(false);
  }, []);

  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const openCharacterStudio = useCallback(() => {
    setCharacterStudioOpen(true);
    setSidebarOpen(false);
  }, []);
  const closeCharacterStudio = useCallback(() => setCharacterStudioOpen(false), []);
  const openModelSettings = useCallback(() => setModelSettingsOpen(true), []);
  const closeModelSettings = useCallback(() => setModelSettingsOpen(false), []);

  const handleModelCreated = useCallback(
    (modelName: string) => {
      handleModelChange(modelName);
      setCharacterStudioOpen(false);
      void loadModels();
      showToast(`${modelName} is ready to chat`);
    },
    [handleModelChange, loadModels, showToast],
  );

  const handleRename = useCallback((id: string, title: string) => {
    setConversations((previous) =>
      previous.map((conversation) =>
        conversation.id === id ? { ...conversation, title } : conversation,
      ),
    );
  }, []);

  const handleDelete = useCallback(
    (id: string) => {
      const deleted = conversations.find((conversation) => conversation.id === id);
      if (!deleted) return;

      abortControllers.current.get(id)?.abort();
      abortControllers.current.delete(id);
      setStreamingByConversation((previous) => {
        if (!(id in previous)) return previous;
        const next = { ...previous };
        delete next[id];
        return next;
      });

      const remaining = conversations.filter(
        (conversation) => conversation.id !== id,
      );
      setConversations(remaining);
      if (activeId === id) setActiveId(getLatestChatId(remaining));

      showToast("Chat deleted", "Undo", () => {
        setConversations((previous) => [deleted, ...previous]);
        setActiveId(deleted.id);
      });
    },
    [activeId, conversations, showToast],
  );

  const handleClearAll = useCallback(() => {
    for (const controller of abortControllers.current.values()) {
      controller.abort();
    }
    abortControllers.current.clear();
    setStreamingByConversation({});
    setConversations([]);
    setActiveId(null);
    setSettingsOpen(false);
    showToast("All chats cleared");
  }, [showToast]);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((previous) => ({ ...previous, ...patch }));
  }, []);

  const toggleTheme = useCallback(() => {
    setSettings((previous) => ({
      ...previous,
      theme: previous.theme === "dark" ? "light" : "dark",
    }));
  }, []);

  return (
    <div className="app-shell">
      <Sidebar
        activeId={activeId}
        conversations={conversations}
        mobileOpen={sidebarOpen}
        modelsState={modelsState}
        streamingIds={streamingIds}
        theme={settings.theme}
        onCloseMobile={() => setSidebarOpen(false)}
        onDelete={handleDelete}
        onNewChat={handleNewChat}
        onOpenCharacterStudio={openCharacterStudio}
        onOpenSettings={openSettings}
        onRefreshModels={() => void loadModels()}
        onRename={handleRename}
        onSelect={setActiveId}
        onToggleTheme={toggleTheme}
      />
      <ChatView
        key={`${activeId ?? "new"}-${newChatNonce}`}
        conversation={activeConversation}
        hasModelOverrides={currentModelCustomized}
        model={currentModel}
        modelsState={modelsState}
        streamingMessageId={activeStreamingMessageId}
        onModelChange={handleModelChange}
        onOpenModelSettings={openModelSettings}
        onOpenSidebar={() => setSidebarOpen(true)}
        onRefreshModels={() => void loadModels()}
        onRegenerate={handleRegenerate}
        onSend={handleSend}
        onStop={handleStop}
      />
      {modelSettingsOpen && currentModel ? (
        <ModelSettingsModal
          key={`model-settings-${currentModel}`}
          defaults={{
            temperature: settings.temperature,
            numCtx: settings.numCtx,
          }}
          model={currentModel}
          modelInfo={currentModelInfo}
          options={currentModelOptions}
          onClose={closeModelSettings}
          onReset={handleResetModelOptions}
          onSave={handleSaveModelOptions}
        />
      ) : null}
      {settingsOpen ? (
        <SettingsModal
          conversationCount={conversations.length}
          settings={settings}
          onChange={updateSettings}
          onClearAll={handleClearAll}
          onClose={closeSettings}
        />
      ) : null}
      {characterStudioOpen ? (
        <CharacterStudio
          onClose={closeCharacterStudio}
          onModelCreated={handleModelCreated}
        />
      ) : null}
      {toast ? <Toast toast={toast} onDismiss={dismissToast} /> : null}
    </div>
  );
}
