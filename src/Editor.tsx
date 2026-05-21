import { useState } from "react";
import {
    type Block,
    type SiteContent,
    FONT_OPTIONS,
} from "./template.ts";

interface EditorProps {
    value: SiteContent;
    onChange: (next: SiteContent) => void;
}

function patch<T extends SiteContent, K extends keyof T>(
    value: T,
    key: K,
    next: T[K],
): T {
    return { ...value, [key]: next };
}

function newBlockId(): string {
    return Math.random().toString(36).slice(2, 10);
}

const BLOCK_PRESETS: Record<Block["type"], () => Block> = {
    paragraph: () => ({ id: newBlockId(), type: "paragraph", text: "More text here" }),
    link: () => ({ id: newBlockId(), type: "link", label: "My link", url: "https://" }),
    image: () => ({ id: newBlockId(), type: "image", url: "https://", alt: "" }),
    divider: () => ({ id: newBlockId(), type: "divider" }),
};

export function Editor({ value, onChange }: EditorProps) {
    const [showAdd, setShowAdd] = useState(false);

    const setBlocks = (next: Block[]) => onChange(patch(value, "blocks", next));
    const updateBlock = (id: string, patcher: (b: Block) => Block) =>
        setBlocks(value.blocks.map((b) => (b.id === id ? patcher(b) : b)));
    const removeBlock = (id: string) => setBlocks(value.blocks.filter((b) => b.id !== id));
    const addBlock = (type: Block["type"]) => {
        setBlocks([...value.blocks, BLOCK_PRESETS[type]()]);
        setShowAdd(false);
    };

    return (
        <div className="editor">
            <Field label="Header">
                <input
                    type="text"
                    value={value.header}
                    onChange={(e) => onChange(patch(value, "header", e.target.value))}
                />
            </Field>

            <Field label="Subheader">
                <textarea
                    rows={2}
                    value={value.subheader}
                    onChange={(e) => onChange(patch(value, "subheader", e.target.value))}
                />
            </Field>

            <div className="row">
                <Field label="Accent" className="row-half">
                    <input
                        type="color"
                        value={value.accentColor}
                        onChange={(e) => onChange(patch(value, "accentColor", e.target.value))}
                    />
                </Field>
                <Field label="Background" className="row-half">
                    <input
                        type="color"
                        value={value.background}
                        onChange={(e) => onChange(patch(value, "background", e.target.value))}
                    />
                </Field>
            </div>

            <Field label="Font">
                <select
                    value={value.fontFamily}
                    onChange={(e) => onChange(patch(value, "fontFamily", e.target.value))}
                >
                    {FONT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                            {opt.label}
                        </option>
                    ))}
                </select>
            </Field>

            {value.blocks.length > 0 && (
                <div className="blocks">
                    {value.blocks.map((block) => (
                        <BlockEditor
                            key={block.id}
                            block={block}
                            onChange={(b) => updateBlock(block.id, () => b)}
                            onRemove={() => removeBlock(block.id)}
                        />
                    ))}
                </div>
            )}

            {showAdd ? (
                <div className="add-menu">
                    <button onClick={() => addBlock("paragraph")}>Paragraph</button>
                    <button onClick={() => addBlock("link")}>Link</button>
                    <button onClick={() => addBlock("image")}>Image</button>
                    <button onClick={() => addBlock("divider")}>Divider</button>
                    <button className="ghost" onClick={() => setShowAdd(false)}>
                        Cancel
                    </button>
                </div>
            ) : (
                <button className="add-trigger" onClick={() => setShowAdd(true)}>
                    + Add element
                </button>
            )}
        </div>
    );
}

function Field({
    label,
    className,
    children,
}: {
    label: string;
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <label className={`field${className ? ` ${className}` : ""}`}>
            <span className="field-label">{label}</span>
            {children}
        </label>
    );
}

function BlockEditor({
    block,
    onChange,
    onRemove,
}: {
    block: Block;
    onChange: (next: Block) => void;
    onRemove: () => void;
}) {
    return (
        <div className="block">
            <div className="block-head">
                <span className="block-type">{block.type}</span>
                <button className="block-remove" onClick={onRemove} aria-label="Remove block">
                    ×
                </button>
            </div>
            {block.type === "paragraph" && (
                <textarea
                    rows={2}
                    value={block.text}
                    onChange={(e) => onChange({ ...block, text: e.target.value })}
                />
            )}
            {block.type === "link" && (
                <>
                    <input
                        type="text"
                        placeholder="Label"
                        value={block.label}
                        onChange={(e) => onChange({ ...block, label: e.target.value })}
                    />
                    <input
                        type="url"
                        placeholder="https://"
                        value={block.url}
                        onChange={(e) => onChange({ ...block, url: e.target.value })}
                    />
                </>
            )}
            {block.type === "image" && (
                <>
                    <input
                        type="url"
                        placeholder="https:// image url"
                        value={block.url}
                        onChange={(e) => onChange({ ...block, url: e.target.value })}
                    />
                    <input
                        type="text"
                        placeholder="alt text"
                        value={block.alt}
                        onChange={(e) => onChange({ ...block, alt: e.target.value })}
                    />
                </>
            )}
            {block.type === "divider" && <p className="block-meta">— horizontal rule —</p>}
        </div>
    );
}
