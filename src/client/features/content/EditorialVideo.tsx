import { useState } from "react";
import {
  Node,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type ReactNodeViewProps,
} from "@tiptap/react";
import { Play, Trash2 } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import {
  editorialVideoId,
  videoEmbedUrl,
  videoWatchUrl,
} from "@/shared/editorialVideo";

function VideoPreview({ node, deleteNode, editor }: ReactNodeViewProps) {
  const [playing, setPlaying] = useState(false);
  const source: unknown = node.attrs.src;
  const label: unknown = node.attrs.title;
  const id = typeof source === "string" ? editorialVideoId(source) : null;
  if (!id) return null;
  const title = typeof label === "string" ? label : "YouTube video";
  return (
    <NodeViewWrapper
      className="my-5 overflow-hidden rounded-lg border border-border"
      contentEditable={false}
    >
      {playing ? (
        // The fixed cross-origin player needs its own origin for storage.
        <iframe
          className="aspect-video w-full"
          src={videoEmbedUrl(id)}
          title={title}
          referrerPolicy="strict-origin-when-cross-origin"
          // oxlint-disable-next-line react/iframe-missing-sandbox
          sandbox="allow-scripts allow-same-origin allow-presentation"
          allowFullScreen
        />
      ) : (
        <button
          type="button"
          className="flex aspect-[3/1] w-full items-center justify-center gap-3 bg-muted px-4 text-sm font-medium hover:bg-muted/70 focus-visible:outline-ring"
          onClick={() => setPlaying(true)}
        >
          <Play className="size-5" />
          Play {title}
        </button>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs">
        <a href={videoWatchUrl(id)} target="_blank" rel="noreferrer">
          Watch on YouTube
        </a>
        {editor.isEditable ? (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Remove video"
            onClick={deleteNode}
          >
            <Trash2 />
          </Button>
        ) : null}
      </div>
    </NodeViewWrapper>
  );
}

export const EditorialVideo = Node.create({
  name: "editorialVideo",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { src: { default: "" }, title: { default: "YouTube video" } };
  },
  parseHTML() {
    return [
      {
        tag: "iframe[src]",
        getAttrs: (element) =>
          editorialVideoId(element.getAttribute("src") ?? "") ? null : false,
      },
    ];
  },
  renderHTML({ node }) {
    const source: unknown = node.attrs.src;
    const title: unknown = node.attrs.title;
    return [
      "iframe",
      {
        src: typeof source === "string" ? source : "",
        title: typeof title === "string" ? title : "YouTube video",
      },
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(VideoPreview);
  },
});

export function InsertEditorialVideo({
  editor,
}: {
  editor: ReactNodeViewProps["editor"];
}) {
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [title, setTitle] = useState("");
  const id = editorialVideoId(address.trim());
  return (
    <>
      <Button
        size="icon-sm"
        variant="ghost"
        title="Embed YouTube video"
        aria-label="Embed YouTube video"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Play />
      </Button>
      {open ? (
        <form
          className="flex basis-full flex-wrap gap-2 py-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (!id) return;
            editor
              .chain()
              .focus()
              .insertContent({
                type: "editorialVideo",
                attrs: {
                  src: videoEmbedUrl(id),
                  title: title.trim() || "YouTube video",
                },
              })
              .run();
            setOpen(false);
            setAddress("");
            setTitle("");
          }}
        >
          <input
            type="url"
            aria-label="YouTube URL"
            placeholder="YouTube watch or share URL"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            className="min-w-48 flex-1 rounded-md border border-border bg-background px-2 text-xs"
          />
          <input
            aria-label="Video title"
            placeholder="Video title"
            value={title}
            maxLength={160}
            onChange={(event) => setTitle(event.target.value)}
            className="min-w-32 flex-1 rounded-md border border-border bg-background px-2 text-xs"
          />
          <Button size="sm" type="submit" disabled={!id}>
            Embed video
          </Button>
        </form>
      ) : null}
    </>
  );
}
