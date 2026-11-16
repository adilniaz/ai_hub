import {
  Check,
  MessageSquare,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sun,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type { Conversation, ModelsState } from "../types";
import {
  classNames,
  groupConversations,
  isMac,
} from "../lib/utils";
import { Logo } from "./Logo";

interface SidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  modelsState: ModelsState;
  streamingIds: Set<string>;
  mobileOpen: boolean;
  theme: "light" | "dark";
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  onOpenCharacterStudio: () => void;
  onRefreshModels: () => void;
  onCloseMobile: () => void;
}

export function Sidebar({
  conversations,
  activeId,
  modelsState,
  streamingIds,
  mobileOpen,
  theme,
  onSelect,
  onNewChat,
  onRename,
  onDelete,
  onToggleTheme,
  onOpenSettings,
  onOpenCharacterStudio,
  onRefreshModels,
  onCloseMobile,
}: SidebarProps) {
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);
  const mac = useMemo(isMac, []);

  useEffect(() => {
    if (!editingId) return;
    const frame = requestAnimationFrame(() => {
      renameRef.current?.focus();
      renameRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [editingId]);

  useEffect(() => {
    if (!mobileOpen) setEditingId(null);
  }, [mobileOpen]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return conversations;
    return conversations.filter(
      (conversation) =>
        conversation.title.toLowerCase().includes(normalized) ||
        conversation.messages.some((message) =>
          message.content.toLowerCase().includes(normalized),
        ),
    );
  }, [conversations, query]);

  const groups = useMemo(() => groupConversations(filtered), [filtered]);

  const startRename = (conversation: Conversation) => {
    setEditingId(conversation.id);
    setEditingTitle(conversation.title);
  };

  const finishRename = (event?: FormEvent) => {
    event?.preventDefault();
    if (!editingId) return;
    const nextTitle = editingTitle.trim();
    if (nextTitle) onRename(editingId, nextTitle);
    setEditingId(null);
  };

  const handleRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setEditingId(null);
    }
  };

  const handleSelect = (id: string) => {
    onSelect(id);
    onCloseMobile();
  };

  const handleNewChat = () => {
    onNewChat();
    onCloseMobile();
  };

  return (
    <>
      <button
        aria-label="Close sidebar"
        className={classNames("sidebar-scrim", mobileOpen && "is-visible")}
        type="button"
        onClick={onCloseMobile}
      />
      <aside className={classNames("sidebar", mobileOpen && "is-open")}>
        <div className="sidebar-header">
          <div className="brand">
            <span className="brand-mark">
              <Logo size={19} />
            </span>
            <div className="brand-text">
              <span className="brand-name">Local Chat</span>
              <span className="brand-sub">for Ollama</span>
            </div>
          </div>
          <button
            aria-label="Close sidebar"
            className="icon-button sidebar-close"
            type="button"
            onClick={onCloseMobile}
          >
            <X size={18} />
          </button>
        </div>

        <button className="new-chat" type="button" onClick={handleNewChat}>
          <span className="new-chat-label">
            <Plus size={17} strokeWidth={2.2} />
            New chat
          </span>
          <kbd>{mac ? "⌘⇧O" : "Ctrl ⇧ O"}</kbd>
        </button>

        <button
          className="character-studio-button"
          type="button"
          onClick={onOpenCharacterStudio}
        >
          <WandSparkles size={15} />
          Character studio
          <span>QLoRA</span>
        </button>

        <div className="search-box">
          <Search size={15} aria-hidden="true" />
          <input
            aria-label="Search conversations"
            placeholder="Search chats"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button
              aria-label="Clear search"
              className="search-clear"
              type="button"
              onClick={() => setQuery("")}
            >
              <X size={13} />
            </button>
          ) : null}
        </div>

        <nav className="chat-nav" aria-label="Conversations">
          {groups.length === 0 ? (
            <div className="chat-list-empty">
              <MessageSquare size={18} />
              <p>{query ? "No chats found" : "Your conversations will live here."}</p>
            </div>
          ) : (
            groups.map((group) => (
              <section className="chat-group" key={group.label}>
                <h2>{group.label}</h2>
                {group.chats.map((conversation) => {
                  const isEditing = editingId === conversation.id;
                  const isActive = activeId === conversation.id;
                  const isStreaming = streamingIds.has(conversation.id);
                  return (
                    <div
                      className={classNames(
                        "chat-item",
                        isActive && "is-active",
                        isEditing && "is-editing",
                      )}
                      key={conversation.id}
                    >
                      {isEditing ? (
                        <form className="chat-rename" onSubmit={finishRename}>
                          <input
                            ref={renameRef}
                            aria-label="Chat title"
                            maxLength={100}
                            value={editingTitle}
                            onChange={(event) =>
                              setEditingTitle(event.target.value)
                            }
                            onKeyDown={handleRenameKeyDown}
                          />
                          <button
                            aria-label="Save title"
                            className="rename-button"
                            type="submit"
                          >
                            <Check size={14} />
                          </button>
                          <button
                            aria-label="Cancel rename"
                            className="rename-button"
                            type="button"
                            onClick={() => setEditingId(null)}
                          >
                            <X size={14} />
                          </button>
                        </form>
                      ) : (
                        <>
                          <button
                            className="chat-item-main"
                            title={conversation.title}
                            type="button"
                            onClick={() => handleSelect(conversation.id)}
                          >
                            {isStreaming ? (
                              <span
                                className="chat-live"
                                aria-label="Generating response"
                              />
                            ) : null}
                            <span className="chat-item-title">
                              {conversation.title}
                            </span>
                          </button>
                          <div className="chat-item-actions">
                            <button
                              aria-label={`Rename ${conversation.title}`}
                              className="chat-action"
                              title="Rename"
                              type="button"
                              onClick={() => startRename(conversation)}
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              aria-label={`Delete ${conversation.title}`}
                              className="chat-action danger"
                              title="Delete"
                              type="button"
                              onClick={() => onDelete(conversation.id)}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </section>
            ))
          )}
        </nav>

        <div className="sidebar-footer">
          <div
            className="connection"
            data-state={modelsState.status}
            title={modelsState.error ?? undefined}
          >
            <span className="status-dot" />
            <div className="connection-copy">
              <span>Ollama</span>
              <small>
                {modelsState.status === "loading"
                  ? "Connecting…"
                  : modelsState.status === "error"
                    ? "Not reachable"
                    : modelsState.models.length === 0
                      ? "No models installed"
                      : `${modelsState.models.length} ${
                          modelsState.models.length === 1 ? "model" : "models"
                        } installed`}
              </small>
            </div>
            <button
              aria-label="Refresh models and connection"
              className={classNames(
                "icon-button connection-refresh",
                modelsState.status === "loading" && "is-spinning",
              )}
              title="Refresh connection"
              type="button"
              onClick={onRefreshModels}
            >
              <RefreshCw size={14} />
            </button>
          </div>

          <div className="sidebar-controls">
            <button
              className="settings-button"
              type="button"
              onClick={onOpenSettings}
            >
              <Settings2 size={15} />
              Settings
            </button>
            <button
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              className="icon-button theme-button"
              title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              type="button"
              onClick={onToggleTheme}
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
