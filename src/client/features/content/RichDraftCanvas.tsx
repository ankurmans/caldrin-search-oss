import { useEffect, useState } from "react";
import {
  EditorContent,
  useEditor,
  useEditorState,
  type Editor,
} from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { EditorialVideo, InsertEditorialVideo } from "./EditorialVideo";
import { Image } from "@tiptap/extension-image";
import {
  Bold,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Redo2,
  Table2,
  Undo2,
} from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import {
  sanitizeHtml,
  safeEditorialAddress,
} from "@/server/features/content/rules/sanitizeHtml";

const extensions = [
  StarterKit.configure({
    heading: { levels: [2, 3, 4] },
    link: { openOnClick: false, autolink: false, linkOnPaste: false },
    codeBlock: false,
  }),
  TableKit.configure({ table: { resizable: false } }),
  Image.configure({ allowBase64: false }),
  EditorialVideo,
];

export function RichDraftCanvas({
  html,
  editable,
  onUpdate,
  onEditor,
}: {
  html: string;
  editable: boolean;
  onUpdate: (html: string) => void;
  onEditor: (editor: Editor | null) => void;
}) {
  const editor = useEditor({
    extensions,
    content: sanitizeHtml(html),
    immediatelyRender: false,
    onUpdate: ({ editor: updated }) =>
      onUpdate(sanitizeHtml(updated.getHTML())),
    editorProps: {
      transformPastedHTML: (pasted) => sanitizeHtml(pasted),
      attributes: {
        role: "textbox",
        "aria-label": "Article body",
        "aria-multiline": "true",
        class:
          "mx-auto min-h-72 max-w-[86ch] px-4 py-5 text-[15px] leading-relaxed outline-none md:px-7 [&_p+p]:mt-3 [&_h2]:mt-6 [&_h2]:text-xl [&_h3]:mt-5 [&_h3]:text-lg [&_h4]:mt-4 [&_h4]:text-base [&_h2]:font-semibold [&_h3]:font-semibold [&_h4]:font-semibold [&_a]:underline [&_ul]:ml-6 [&_ul]:list-disc [&_ol]:ml-6 [&_ol]:list-decimal [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_table]:my-3 [&_table]:w-full [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:bg-muted [&_th]:p-2 [&_img]:my-3 [&_img]:max-w-full [&_.selectedCell]:bg-muted",
      },
    },
  });
  useEffect(() => {
    onEditor(editor);
    return () => onEditor(null);
  }, [editor, onEditor]);
  useEffect(() => {
    if (editor && sanitizeHtml(editor.getHTML()) !== html)
      editor.commands.setContent(sanitizeHtml(html), { emitUpdate: false });
  }, [editor, html]);
  useEffect(() => {
    editor?.setEditable(editable, false);
  }, [editor, editable]);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card focus-within:border-ring">
      {editor && editable ? <DraftToolbar editor={editor} /> : null}
      <EditorContent editor={editor} />
    </div>
  );
}

function DraftToolbar({ editor }: { editor: Editor }) {
  const [insert, setInsert] = useState<"link" | "image" | null>(null);
  const [address, setAddress] = useState("");
  const [alt, setAlt] = useState("");
  const styles = useEditorState({
    editor,
    selector: ({ editor: selected }) => ({
      heading:
        ([2, 3, 4] as const).find((level) =>
          selected.isActive("heading", { level }),
        ) ?? 0,
      bold: selected.isActive("bold"),
      italic: selected.isActive("italic"),
      unordered: selected.isActive("bulletList"),
      ordered: selected.isActive("orderedList"),
      table: selected.isActive("table"),
    }),
  });
  return (
    <div className="space-y-2 border-b border-border bg-muted/40 px-3 py-2">
      <div
        className="flex flex-wrap items-center gap-1"
        role="group"
        aria-label="Text formatting"
      >
        <select
          aria-label="Paragraph style"
          className="mr-1 rounded-md border bg-card px-1.5 py-1 text-xs"
          value={styles.heading}
          onChange={(event) => {
            const level = Number(event.target.value);
            if (level === 2 || level === 3 || level === 4)
              editor.chain().focus().setHeading({ level }).run();
            else editor.chain().focus().setParagraph().run();
          }}
        >
          <option value="0">Paragraph</option>
          <option value="2">Heading 2</option>
          <option value="3">Heading 3</option>
          <option value="4">Heading 4</option>
        </select>
        <Button
          size="icon-sm"
          variant="ghost"
          title="Bold"
          aria-label="Bold"
          aria-pressed={styles.bold}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          title="Italic"
          aria-label="Italic"
          aria-pressed={styles.italic}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          title="Bulleted list"
          aria-label="Bulleted list"
          aria-pressed={styles.unordered}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          title="Numbered list"
          aria-label="Numbered list"
          aria-pressed={styles.ordered}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          title="Link"
          aria-label="Link"
          aria-expanded={insert === "link"}
          onClick={() => {
            const href: unknown = editor.getAttributes("link").href;
            setAddress(typeof href === "string" ? href : "");
            setInsert(insert === "link" ? null : "link");
          }}
        >
          <Link2 />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          title="Image"
          aria-label="Image"
          aria-expanded={insert === "image"}
          onClick={() => {
            setAddress("");
            setAlt("");
            setInsert(insert === "image" ? null : "image");
          }}
        >
          <ImagePlus />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          title="Insert table"
          aria-label="Insert table"
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 2, withHeaderRow: true })
              .run()
          }
        >
          <Table2 />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          title="Undo"
          aria-label="Undo"
          onClick={() => editor.chain().focus().undo().run()}
        >
          <Undo2 />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          title="Redo"
          aria-label="Redo"
          onClick={() => editor.chain().focus().redo().run()}
        >
          <Redo2 />
        </Button>
        <InsertEditorialVideo editor={editor} />
        {styles.table ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => editor.chain().focus().addRowAfter().run()}
            >
              Add row
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => editor.chain().focus().addColumnAfter().run()}
            >
              Add column
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => editor.chain().focus().deleteTable().run()}
            >
              Remove table
            </Button>
          </>
        ) : null}
      </div>
      {insert ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const url = address.trim();
            if (!safeEditorialAddress(url, insert === "link")) return;
            if (insert === "image")
              editor.chain().focus().setImage({ src: url, alt }).run();
            else if (editor.state.selection.empty && !editor.isActive("link")) {
              editor
                .chain()
                .focus()
                .insertContent({
                  type: "text",
                  text: url,
                  marks: [{ type: "link", attrs: { href: url } }],
                })
                .run();
            } else
              editor
                .chain()
                .focus()
                .extendMarkRange("link")
                .setLink({ href: url })
                .run();
            setInsert(null);
          }}
        >
          <Input
            aria-label={insert === "image" ? "Image URL" : "Link URL"}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="https://…"
            className="h-8 min-w-36 flex-1"
          />
          {insert === "image" ? (
            <Input
              aria-label="Image description"
              value={alt}
              onChange={(event) => setAlt(event.target.value)}
              placeholder="Image description"
              className="h-8 flex-1"
            />
          ) : null}
          <Button
            size="sm"
            type="submit"
            disabled={!safeEditorialAddress(address.trim(), insert === "link")}
          >
            Insert
          </Button>
          {insert === "link" && editor.isActive("link") ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                editor
                  .chain()
                  .focus()
                  .extendMarkRange("link")
                  .unsetLink()
                  .run();
                setInsert(null);
              }}
            >
              Remove link
            </Button>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
