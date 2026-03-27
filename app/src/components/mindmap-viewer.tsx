"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./mindmap-viewer.module.css";

export type MindmapNodeKind = "query" | "section" | "definition" | "punishment" | "entity";

export type MindmapNode = {
  id: string;
  label: string;
  kind: MindmapNodeKind;
  summary: string;
  sectionNumber?: string;
  chapter?: string;
  documentName?: string;
};

export type MindmapEdge = {
  source: string;
  target: string;
  label: string;
};

export type MindmapGraph = {
  query: string;
  nodes: MindmapNode[];
  edges: MindmapEdge[];
};

type PositionedNode = MindmapNode & { x: number; y: number };

const NODE_W = 196;
const NODE_H = 96;

type NodePosition = { x: number; y: number };

function kindClass(kind: MindmapNodeKind): string {
  if (kind === "query") return styles.kindQuery;
  if (kind === "section") return styles.kindSection;
  if (kind === "definition") return styles.kindDefinition;
  if (kind === "punishment") return styles.kindPunishment;
  return styles.kindEntity;
}

function compact(value: string, max = 52): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}

function layout(graph: MindmapGraph): { width: number; height: number; nodes: PositionedNode[] } {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const root = nodeById.get("query") ?? graph.nodes[0];

  const outgoing = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();

  for (const edge of graph.edges) {
    const out = outgoing.get(edge.source) ?? new Set<string>();
    out.add(edge.target);
    outgoing.set(edge.source, out);

    const inc = incoming.get(edge.target) ?? new Set<string>();
    inc.add(edge.source);
    incoming.set(edge.target, inc);
  }

  const levels = new Map<string, number>();
  const queue: string[] = [];

  if (root) {
    levels.set(root.id, 0);
    queue.push(root.id);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentLevel = levels.get(current) ?? 0;
    const neighbors = new Set<string>([
      ...(outgoing.get(current) ?? []),
      ...(incoming.get(current) ?? []),
    ]);

    for (const next of neighbors) {
      if (levels.has(next)) {
        continue;
      }
      levels.set(next, currentLevel + 1);
      queue.push(next);
    }
  }

  for (const node of graph.nodes) {
    if (!levels.has(node.id)) {
      levels.set(node.id, 1);
    }
  }

  const grouped = new Map<number, MindmapNode[]>();
  for (const node of graph.nodes) {
    const level = levels.get(node.id) ?? 1;
    const bucket = grouped.get(level) ?? [];
    bucket.push(node);
    grouped.set(level, bucket);
  }

  const maxLevel = Math.max(...grouped.keys(), 1);
  const colGap = 220;
  const rowGap = 120;
  const width = Math.max(1240, (maxLevel + 1) * colGap + 360);

  let maxRows = 1;
  for (const [, bucket] of grouped) {
    maxRows = Math.max(maxRows, bucket.length);
  }
  const height = Math.max(700, maxRows * rowGap + 260);

  const nodes: PositionedNode[] = [];

  for (const [level, bucketRaw] of grouped) {
    const bucket = [...bucketRaw].sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));
    const laneHeight = bucket.length * rowGap;
    const laneStart = (height - laneHeight) / 2;

    bucket.forEach((node, index) => {
      const x = 80 + level * colGap;
      const y = laneStart + index * rowGap;
      nodes.push({ ...node, x, y });
    });
  }

  if (root) {
    const idx = nodes.findIndex((node) => node.id === root.id);
    if (idx >= 0) {
      nodes[idx] = { ...nodes[idx], x: 80, y: (height - NODE_H) / 2 };
    }
  }

  return { width, height, nodes };
}

type MindmapViewerProps = {
  graph: MindmapGraph;
  selectedNodeId: string | null;
  loadingNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onExpandNode: (nodeId: string) => void;
};

export function MindmapViewer(props: MindmapViewerProps) {
  const scene = useMemo(() => layout(props.graph), [props.graph]);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [draggingPan, setDraggingPan] = useState(false);
  const [nodePositions, setNodePositions] = useState<Map<string, NodePosition>>(new Map());

  const panRef = useRef<{ startX: number; startY: number; left: number; top: number } | null>(null);
  const nodeDragRef = useRef<{
    nodeId: string;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef<string | null>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const left = Math.max(0, Math.floor((scene.width - viewport.clientWidth) / 2));
    const top = Math.max(0, Math.floor((scene.height - viewport.clientHeight) / 2));
    viewport.scrollTo({ left, top, behavior: "smooth" });
  }, [scene.width, scene.height, props.graph.query]);

  const positionById = useMemo(() => {
    const map = new Map<string, PositionedNode>();
    for (const node of scene.nodes) {
      const override = nodePositions.get(node.id);
      map.set(node.id, {
        ...node,
        x: override?.x ?? node.x,
        y: override?.y ?? node.y,
      });
    }
    return map;
  }, [nodePositions, scene.nodes]);

  function beginPan(event: React.MouseEvent<HTMLDivElement>) {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    panRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
    };
    setDraggingPan(true);
  }

  function onPointerMove(event: React.MouseEvent<HTMLDivElement>) {
    const nodeDrag = nodeDragRef.current;
    if (nodeDrag) {
      const dx = event.clientX - nodeDrag.startX;
      const dy = event.clientY - nodeDrag.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        nodeDrag.moved = true;
      }

      setNodePositions((previous) => {
        const next = new Map(previous);
        next.set(nodeDrag.nodeId, {
          x: Math.max(20, nodeDrag.originX + dx),
          y: Math.max(20, nodeDrag.originY + dy),
        });
        return next;
      });
      return;
    }

    const viewport = viewportRef.current;
    const pan = panRef.current;
    if (!viewport || !pan) {
      return;
    }

    const dx = event.clientX - pan.startX;
    const dy = event.clientY - pan.startY;
    viewport.scrollLeft = pan.left - dx;
    viewport.scrollTop = pan.top - dy;
  }

  function stopInteractions() {
    const dragged = nodeDragRef.current;
    if (dragged?.moved) {
      suppressClickRef.current = dragged.nodeId;
    }

    panRef.current = null;
    nodeDragRef.current = null;
    setDraggingPan(false);
  }

  function onNodeMouseDown(nodeId: string, event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    const current = positionById.get(nodeId);
    if (!current) {
      return;
    }

    nodeDragRef.current = {
      nodeId,
      startX: event.clientX,
      startY: event.clientY,
      originX: current.x,
      originY: current.y,
      moved: false,
    };
  }

  function onNodeClick(nodeId: string) {
    if (suppressClickRef.current === nodeId) {
      suppressClickRef.current = null;
      return;
    }
    props.onSelectNode(nodeId);
  }

  return (
    <div
      ref={viewportRef}
      className={`${styles.viewport} ${draggingPan ? styles.dragging : ""}`}
      onMouseDown={beginPan}
      onMouseMove={onPointerMove}
      onMouseUp={stopInteractions}
      onMouseLeave={stopInteractions}
    >
      <div className={styles.canvas} style={{ width: `${scene.width}px`, height: `${scene.height}px` }}>
        <svg className={styles.edges} viewBox={`0 0 ${scene.width} ${scene.height}`} aria-hidden>
          {props.graph.edges.map((edge, index) => {
            const from = positionById.get(edge.source);
            const to = positionById.get(edge.target);
            if (!from || !to) {
              return null;
            }

            const startX = from.x + NODE_W;
            const startY = from.y + NODE_H / 2;
            const endX = to.x;
            const endY = to.y + NODE_H / 2;
            const midX = startX + (endX - startX) / 2;
            const path = `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`;
            const labelX = midX;
            const labelY = startY + (endY - startY) / 2 - 8;

            return (
              <g key={`${edge.source}-${edge.target}-${index}`}>
                <path d={path} className={styles.edgePath} />
                <text x={labelX} y={labelY} className={styles.edgeLabel}>
                  {compact(edge.label, 26)}
                </text>
              </g>
            );
          })}
        </svg>

        {scene.nodes.map((node) => {
          const selected = props.selectedNodeId === node.id;
          const loading = props.loadingNodeId === node.id;
          const position = positionById.get(node.id) ?? node;

          return (
            <button
              key={node.id}
              type="button"
              className={`${styles.node} ${kindClass(node.kind)} ${selected ? styles.nodeSelected : ""}`}
              style={{ left: `${position.x}px`, top: `${position.y}px` }}
              onClick={() => onNodeClick(node.id)}
              onDoubleClick={() => props.onExpandNode(node.id)}
              title="Drag to move node. Double-click to expand."
              onMouseDown={(event) => onNodeMouseDown(node.id, event)}
            >
              <div className={styles.nodeHead}>
                <span className={styles.nodeTitle}>{compact(node.label, 54)}</span>
                {loading ? <span className={styles.loading}>...</span> : null}
              </div>
              <p className={styles.nodeSummary}>{compact(node.summary, 120)}</p>
              <span className={styles.badge}>{node.kind}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
