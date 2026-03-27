"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { MindmapGraph, MindmapViewer } from "@/components/mindmap-viewer";
import styles from "./chat.module.css";

type ChatResponse = {
  answer: string;
  domain: string;
  imageDescription?: string | null;
};

type MindmapResponse = {
  mindmapId?: string;
  domain: string;
  graph?: MindmapGraph;
  definition?: string;
  sources?: string[];
};

type MindmapListItem = {
  id: string;
  user_id: string;
  domain: string;
  query: string;
  action: "generate" | "expand" | "define";
  node_count: number;
  edge_count: number;
  created_at: string;
  updated_at: string;
};

type MindmapRecord = MindmapListItem & {
  graph: MindmapGraph;
  sources: string[];
};

type Message = {
  role: "user" | "assistant";
  content: string;
};

function generateUserId() {
  if (typeof window === "undefined") {
    return "anonymous";
  }

  const existing = window.localStorage.getItem("pragya_user_id");
  if (existing) {
    return existing;
  }

  const generated = crypto.randomUUID();
  window.localStorage.setItem("pragya_user_id", generated);
  return generated;
}

export default function ChatPage() {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [imageName, setImageName] = useState("");
  const [imagePayload, setImagePayload] = useState<{ base64: string; mimeType: string } | null>(null);
  const [mindmapPromptOpen, setMindmapPromptOpen] = useState(false);
  const [mindmapViewerOpen, setMindmapViewerOpen] = useState(false);
  const [mindmapInput, setMindmapInput] = useState("");
  const [mindmapGraph, setMindmapGraph] = useState<MindmapGraph | null>(null);
  const [mindmapSources, setMindmapSources] = useState<string[]>([]);
  const [mindmapDomain, setMindmapDomain] = useState("");
  const [mindmapBusy, setMindmapBusy] = useState(false);
  const [mindmapId, setMindmapId] = useState<string | null>(null);
  const [expandingNodeId, setExpandingNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [nodeDefinition, setNodeDefinition] = useState("");
  const [definitionBusy, setDefinitionBusy] = useState(false);
  const [mindmapError, setMindmapError] = useState("");
  const [savedOpen, setSavedOpen] = useState(false);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedItems, setSavedItems] = useState<MindmapListItem[]>([]);
  const selectedNode = useMemo(() => {
    if (!mindmapGraph || !selectedNodeId) {
      return null;
    }
    return mindmapGraph.nodes.find((node) => node.id === selectedNodeId) ?? null;
  }, [mindmapGraph, selectedNodeId]);

  const userId = useMemo(() => generateUserId(), []);
  const chatHistory = useMemo(
    () => messages.filter((message) => message.role === "user").map((message) => message.content.slice(0, 48)),
    [messages],
  );

  async function onImageChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      setImageName("");
      setImagePayload(null);
      return;
    }

    const reader = new FileReader();
    const loadPromise = new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Failed to read image file."));
    });

    reader.readAsDataURL(file);
    const dataUrl = await loadPromise;
    const base64 = dataUrl.split(",")[1] ?? "";

    setImageName(file.name);
    setImagePayload({ base64, mimeType: file.type || "image/png" });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!question.trim()) {
      return;
    }

    setIsLoading(true);
    setError("");

    const userMessage: Message = { role: "user", content: question };
    setMessages((prev) => [...prev, userMessage]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId,
          message: question,
          imageBase64: imagePayload?.base64,
          imageMimeType: imagePayload?.mimeType,
        }),
      });

      const payload = (await response.json()) as ChatResponse & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Request failed.");
      }

      const context = payload.imageDescription ? `\n\nImage Analysis:\n${payload.imageDescription}` : "";
      const assistantMessage: Message = {
        role: "assistant",
        content: `[Domain: ${payload.domain}]\n\n${payload.answer}${context}`,
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setQuestion("");
      setImageName("");
      setImagePayload(null);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Chat failed.");
    } finally {
      setIsLoading(false);
    }
  }

  async function buildMindmap() {
    const prompt = mindmapInput.trim() || question.trim();
    if (!prompt) {
      setMindmapError("Enter a question for mindmap generation.");
      return;
    }

    setMindmapBusy(true);
    setMindmapError("");
    setNodeDefinition("");
    setSelectedNodeId(null);

    try {
      const response = await fetch("/api/mindmap", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId,
          query: prompt,
          action: "generate",
        }),
      });

      const payload = (await response.json()) as MindmapResponse & { error?: string };
      if (!response.ok || !payload.graph) {
        throw new Error(payload.error ?? "Mindmap generation failed.");
      }

      setMindmapId(payload.mindmapId ?? null);
      setMindmapGraph(payload.graph);
      setMindmapInput(prompt);
      setMindmapSources(payload.sources ?? []);
      setMindmapDomain(payload.domain);
      setMindmapPromptOpen(false);
      setMindmapViewerOpen(true);
    } catch (mindmapBuildError) {
      setMindmapError(mindmapBuildError instanceof Error ? mindmapBuildError.message : "Mindmap generation failed.");
    } finally {
      setMindmapBusy(false);
    }
  }

  async function expandMindmapNode(nodeId: string) {
    if (!mindmapGraph) {
      return;
    }

    setExpandingNodeId(nodeId);
    setMindmapError("");

    try {
      const response = await fetch("/api/mindmap", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId,
          query: mindmapInput,
          action: "expand",
          mindmapId,
          graph: mindmapGraph,
          focusNodeId: nodeId,
        }),
      });

      const payload = (await response.json()) as MindmapResponse & { error?: string };
      if (!response.ok || !payload.graph) {
        throw new Error(payload.error ?? "Node expansion failed.");
      }

      if (payload.mindmapId) {
        setMindmapId(payload.mindmapId);
      }
      setMindmapGraph(payload.graph);
      if (payload.sources?.length) {
        setMindmapSources(payload.sources);
      }
    } catch (mindmapExpandError) {
      setMindmapError(mindmapExpandError instanceof Error ? mindmapExpandError.message : "Node expansion failed.");
    } finally {
      setExpandingNodeId(null);
    }
  }

  async function defineMindmapNode(nodeId: string) {
    if (!mindmapGraph) {
      return;
    }

    setSelectedNodeId(nodeId);
    setDefinitionBusy(true);
    setNodeDefinition("");
    setMindmapError("");

    try {
      const response = await fetch("/api/mindmap", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId,
          query: mindmapInput,
          action: "define",
          mindmapId,
          graph: mindmapGraph,
          nodeId,
        }),
      });

      const payload = (await response.json()) as MindmapResponse & { error?: string };
      if (!response.ok || !payload.definition) {
        throw new Error(payload.error ?? "Definition generation failed.");
      }

      if (payload.mindmapId) {
        setMindmapId(payload.mindmapId);
      }
      setNodeDefinition(payload.definition);
      if (payload.sources?.length) {
        setMindmapSources(payload.sources);
      }
    } catch (defineError) {
      setMindmapError(defineError instanceof Error ? defineError.message : "Definition generation failed.");
    } finally {
      setDefinitionBusy(false);
    }
  }

  async function openSavedMindmaps() {
    setSavedOpen(true);
    setSavedLoading(true);
    setMindmapError("");

    try {
      const response = await fetch(`/api/mindmap?userId=${encodeURIComponent(userId)}`);
      const payload = (await response.json()) as { mindmaps?: MindmapListItem[]; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load saved mindmaps.");
      }
      setSavedItems(payload.mindmaps ?? []);
    } catch (savedError) {
      setMindmapError(savedError instanceof Error ? savedError.message : "Failed to load saved mindmaps.");
    } finally {
      setSavedLoading(false);
    }
  }

  async function loadSavedMindmap(id: string) {
    setSavedLoading(true);
    setMindmapError("");

    try {
      const response = await fetch(
        `/api/mindmap?userId=${encodeURIComponent(userId)}&mindmapId=${encodeURIComponent(id)}`,
      );
      const payload = (await response.json()) as { mindmap?: MindmapRecord; error?: string };
      if (!response.ok || !payload.mindmap) {
        throw new Error(payload.error ?? "Failed to open mindmap.");
      }

      setMindmapId(payload.mindmap.id);
      setMindmapInput(payload.mindmap.query);
      setMindmapDomain(payload.mindmap.domain);
      setMindmapGraph(payload.mindmap.graph);
      setMindmapSources(payload.mindmap.sources ?? []);
      setSavedOpen(false);
      setMindmapViewerOpen(true);
    } catch (loadError) {
      setMindmapError(loadError instanceof Error ? loadError.message : "Failed to open mindmap.");
    } finally {
      setSavedLoading(false);
    }
  }

  return (
    <section className={styles.shell}>
      <aside className={styles.rail}>
        <div className={styles.railHead}>
          <h2 className={styles.brand}>Pragya</h2>
          <Link href="/" className="ghost-btn">
            Exit
          </Link>
        </div>

        <button type="button" className={styles.newChat} onClick={() => setMessages([])}>
          + New chat
        </button>
        <button type="button" className={styles.newChat} onClick={() => void openSavedMindmaps()}>
          Saved mindmaps
        </button>

        <div className={styles.history}>
          <p className={styles.historyLabel}>Recent prompts</p>
          {chatHistory.length === 0 ? <p className="muted">No prompts yet.</p> : null}
          {chatHistory.map((item, index) => (
            <button key={`${item}-${index}`} type="button" className={styles.historyItem} onClick={() => setQuestion(item)}>
              {item}
            </button>
          ))}
        </div>
      </aside>

      <div className={styles.main}>
        <header className={styles.mainHead}>
          <h3>Legal Assistant</h3>
          <p>Domain-routed answers from citizen, HR, and company law corpora</p>
        </header>

        <div className={styles.stream}>
          {messages.length === 0 && (
            <div className={styles.empty}>
              <h4>How can Pragya help today?</h4>
              <p>Ask a legal question, or upload an image for multimodal understanding.</p>
            </div>
          )}
          {messages.map((message, index) => (
            <article
              key={`${message.role}-${index}`}
              className={`${styles.row} ${message.role === "user" ? styles.rowUser : styles.rowAssistant}`}
            >
              <div className={styles.avatar}>{message.role === "user" ? "U" : "P"}</div>
              <div className={styles.card}>
                <strong>{message.role === "user" ? "You" : "Pragya"}</strong>
                <p>{message.content}</p>
              </div>
            </article>
          ))}
        </div>

        <form className={styles.compose} onSubmit={onSubmit}>
          <div>
            <textarea
              className={styles.textarea}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Message Pragya"
              rows={3}
            />
          </div>

          <div className={styles.bottom}>
            <div className={styles.bottomLeft}>
              <label className={styles.fileChip}>
                <input className={styles.fileInput} type="file" accept="image/*" onChange={onImageChange} />
                <span>{imageName ? `Image: ${imageName}` : "Attach image"}</span>
              </label>
              <button
                type="button"
                className={styles.mindmapBtn}
                onClick={() => {
                  const latestUserPrompt =
                    [...messages].reverse().find((item) => item.role === "user")?.content ?? question;
                  setMindmapInput((previous) => previous || latestUserPrompt);
                  setMindmapPromptOpen(true);
                  setMindmapError("");
                }}
              >
                Generate Mindmap
              </button>
            </div>
            <button type="submit" disabled={isLoading} className={styles.send}>
              {isLoading ? "Thinking..." : "Send"}
            </button>
          </div>

          {error ? <p className={styles.error}>{error}</p> : null}
        </form>
      </div>

      {mindmapPromptOpen ? (
        <div className={styles.overlay} role="dialog" aria-modal="true">
          <div className={styles.promptCard}>
            <h4>Build Legal Mindmap</h4>
            <p>Type the query/topic you want to map.</p>
            <textarea
              className={styles.promptInput}
              value={mindmapInput}
              onChange={(event) => setMindmapInput(event.target.value)}
              rows={4}
              placeholder="Example: theft, criminal intimidation, wrongful gain"
            />
            <div className={styles.promptActions}>
              <button type="button" className={styles.secondaryBtn} onClick={() => setMindmapPromptOpen(false)}>
                Cancel
              </button>
              <button type="button" className={styles.primaryBtn} onClick={buildMindmap} disabled={mindmapBusy}>
                {mindmapBusy ? "Building..." : "Build"}
              </button>
            </div>
            {mindmapError ? <p className={styles.error}>{mindmapError}</p> : null}
          </div>
        </div>
      ) : null}

      {mindmapViewerOpen && mindmapGraph ? (
        <div className={styles.overlay} role="dialog" aria-modal="true">
          <div className={styles.viewerCard}>
            <header className={styles.viewerHead}>
              <div>
                <h3>Legal Mindmap</h3>
                <p>
                  Query: {mindmapInput} {mindmapDomain ? `| Domain: ${mindmapDomain}` : ""}
                </p>
              </div>
              <div className={styles.viewerActions}>
                <button type="button" className={styles.secondaryBtn} onClick={() => setMindmapPromptOpen(true)}>
                  New query
                </button>
                <button type="button" className={styles.secondaryBtn} onClick={() => setMindmapViewerOpen(false)}>
                  Close
                </button>
              </div>
            </header>

            <div className={styles.viewerBody}>
              <div className={styles.viewerCanvas}>
                <MindmapViewer
                  graph={mindmapGraph}
                  selectedNodeId={selectedNodeId}
                  loadingNodeId={expandingNodeId}
                  onSelectNode={(nodeId) => {
                    setSelectedNodeId(nodeId);
                    setNodeDefinition("");
                  }}
                  onExpandNode={(nodeId) => void expandMindmapNode(nodeId)}
                />
              </div>
              <aside className={styles.viewerSide}>
                <h4>Node Definition</h4>
                {definitionBusy ? <p className="muted">Generating definition...</p> : null}
                {!definitionBusy && nodeDefinition ? <p className={styles.sideText}>{nodeDefinition}</p> : null}
                {!definitionBusy && !nodeDefinition ? (
                  <p className="muted">Click a node to generate grounded legal definition. Double-click node to expand.</p>
                ) : null}

                <h4>Sources</h4>
                <div className={styles.sources}>
                  {mindmapSources.length === 0 ? <p className="muted">No sources available.</p> : null}
                  {mindmapSources.map((source, index) => (
                    <p key={`${source}-${index}`}>{`[S${index + 1}] ${source}`}</p>
                  ))}
                </div>
                {mindmapError ? <p className={styles.error}>{mindmapError}</p> : null}
              </aside>
            </div>

            {selectedNode ? (
              <div className={styles.nodePreview}>
                <div className={styles.nodePreviewHead}>
                  <strong>{selectedNode.label}</strong>
                  <button type="button" className={styles.secondaryBtn} onClick={() => setSelectedNodeId(null)}>
                    Close
                  </button>
                </div>
                <p className={styles.sideText}>{selectedNode.summary}</p>
                <p className={styles.previewMeta}>
                  Kind: {selectedNode.kind}
                  {selectedNode.sectionNumber ? ` | Section: ${selectedNode.sectionNumber}` : ""}
                  {selectedNode.chapter ? ` | Chapter: ${selectedNode.chapter}` : ""}
                </p>
                <div className={styles.previewActions}>
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    disabled={definitionBusy}
                    onClick={() => void defineMindmapNode(selectedNode.id)}
                  >
                    {definitionBusy ? "Generating..." : "Generate definition"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {savedOpen ? (
        <div className={styles.overlay} role="dialog" aria-modal="true">
          <div className={styles.promptCard}>
            <h4>Saved Mindmaps</h4>
            <p>Reopen previously generated graphs.</p>
            <div className={styles.savedList}>
              {savedLoading ? <p className="muted">Loading...</p> : null}
              {!savedLoading && savedItems.length === 0 ? <p className="muted">No saved mindmaps yet.</p> : null}
              {!savedLoading
                ? savedItems.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      className={styles.savedItem}
                      onClick={() => void loadSavedMindmap(item.id)}
                    >
                      <strong>{item.query}</strong>
                      <span>
                        {item.domain} | nodes {item.node_count} | edges {item.edge_count}
                      </span>
                      <span>{new Date(item.updated_at).toLocaleString()}</span>
                    </button>
                  ))
                : null}
            </div>
            <div className={styles.promptActions}>
              <button type="button" className={styles.secondaryBtn} onClick={() => setSavedOpen(false)}>
                Close
              </button>
            </div>
            {mindmapError ? <p className={styles.error}>{mindmapError}</p> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
