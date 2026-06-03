// CodeMirror 6 wrapper for the markdown/html source editors. Loaded via
// React.lazy from App.tsx so the whole CodeMirror bundle lives in its own
// chunk — block-editor users never download it.
//
// CM6 is the mobile-correct choice here: it was rewritten specifically for
// touch/IME support, and it disables autocorrect/autocapitalize on its
// content element by default.

import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import {
    EditorView,
    keymap,
    lineNumbers,
    placeholder as cmPlaceholder,
} from "@codemirror/view";
import {
    defaultKeymap,
    history,
    historyKeymap,
    indentWithTab,
} from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { oneDark } from "@codemirror/theme-one-dark";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";

export type CodeLanguage = "html" | "css" | "js" | "markdown";

const LANGUAGES: Record<CodeLanguage, () => ReturnType<typeof html>> = {
    html: () => html(),
    css: () => css(),
    js: () => javascript(),
    markdown: () => markdown(),
};

export default function CodeEditor({
    language,
    value,
    onChange,
    ariaLabel,
    placeholder,
}: {
    language: CodeLanguage;
    value: string;
    onChange: (next: string) => void;
    ariaLabel: string;
    placeholder?: string;
}) {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    // Refs so the view (created once per language) always sees the latest
    // callback/value without being torn down on every keystroke's re-render.
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const valueRef = useRef(value);
    valueRef.current = value;

    // (Re)create the view when the pane/language changes. Doc content rides
    // along via valueRef, so pane switches land on the right text.
    useEffect(() => {
        if (!hostRef.current) return;
        const view = new EditorView({
            state: EditorState.create({
                doc: valueRef.current,
                extensions: [
                    lineNumbers(),
                    history(),
                    indentOnInput(),
                    bracketMatching(),
                    closeBrackets(),
                    EditorView.lineWrapping,
                    oneDark,
                    LANGUAGES[language](),
                    ...(placeholder ? [cmPlaceholder(placeholder)] : []),
                    keymap.of([
                        ...closeBracketsKeymap,
                        ...defaultKeymap,
                        ...historyKeymap,
                        indentWithTab,
                    ]),
                    EditorView.updateListener.of((update) => {
                        if (update.docChanged)
                            onChangeRef.current(update.state.doc.toString());
                    }),
                    EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
                ],
            }),
            parent: hostRef.current,
        });
        viewRef.current = view;
        return () => {
            view.destroy();
            viewRef.current = null;
        };
    }, [language, placeholder, ariaLabel]);

    // External value changes (e.g. re-converting) sync into the live view.
    useEffect(() => {
        const view = viewRef.current;
        if (!view) return;
        const current = view.state.doc.toString();
        if (current !== value) {
            view.dispatch({
                changes: { from: 0, to: current.length, insert: value },
            });
        }
    }, [value]);

    return <div ref={hostRef} className="code-editor-host" />;
}
