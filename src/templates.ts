// Starter layouts. Each `build()` returns a fresh SiteContent with new block
// IDs so applying the same template twice yields distinct, editable instances.

import { type SiteContent } from "./template.ts";

function id(): string {
    return Math.random().toString(36).slice(2, 10);
}

export interface Template {
    id: string;
    name: string;
    description: string;
    build: () => SiteContent;
}

export const TEMPLATES: readonly Template[] = [
    {
        id: "blank",
        name: "Blank",
        description: "Clean slate",
        build: () => ({
            header: "Hello, world",
            subheader: "This is your page. Click anything to make it yours.",
            accentColor: "#e6007a",
            background: "#0b0d12",
            fontFamily: "system-ui",
            blocks: [],
        }),
    },
    {
        id: "profile",
        name: "Profile",
        description: "Avatar, bio, and a few links",
        build: () => ({
            header: "Your Name",
            subheader: "What you do, in one line.",
            accentColor: "#b15a3e",
            background: "#faf7f2",
            fontFamily: "system-ui",
            layout: "profile",
            blocks: [
                {
                    id: id(),
                    type: "image",
                    variant: "avatar",
                    url: "https://",
                    alt: "Profile photo",
                    locked: true,
                },
                {
                    id: id(),
                    type: "paragraph",
                    text:
                        "A short bio — where you're from, what you're into, what " +
                        "you're building right now.",
                    locked: true,
                },
                { id: id(), type: "divider", locked: true },
                { id: id(), type: "link", label: "Twitter", url: "https://", locked: true },
                { id: id(), type: "link", label: "GitHub", url: "https://", locked: true },
                { id: id(), type: "link", label: "Email", url: "mailto:", locked: true },
            ],
        }),
    },
    {
        id: "linktree",
        name: "Linktree",
        description: "Tagline plus a stack of pill buttons",
        build: () => ({
            header: "@yourhandle",
            subheader: "Find me everywhere",
            accentColor: "#00d4ff",
            background: "#1a1a2e",
            fontFamily: "system-ui",
            blocks: [
                { id: id(), type: "link", variant: "pill", label: "Twitter", url: "https://", locked: true },
                { id: id(), type: "link", variant: "pill", label: "GitHub", url: "https://", locked: true },
                { id: id(), type: "link", variant: "pill", label: "LinkedIn", url: "https://", locked: true },
                { id: id(), type: "link", variant: "pill", label: "Newsletter", url: "https://", locked: true },
                { id: id(), type: "link", variant: "pill", label: "Email me", url: "mailto:", locked: true },
            ],
        }),
    },
    {
        id: "launch",
        name: "Launch",
        description: "Hero header, one big call to action",
        build: () => ({
            header: "Something New",
            subheader: "Now in early access.",
            accentColor: "#ffcc00",
            background: "#0b0d12",
            fontFamily: "system-ui",
            blocks: [
                {
                    id: id(),
                    type: "paragraph",
                    text:
                        "A short paragraph that says what it is and who it's for. " +
                        "Keep it to one or two sentences.",
                    locked: true,
                },
                {
                    id: id(),
                    type: "link",
                    variant: "pill",
                    label: "Get early access →",
                    url: "https://",
                    locked: true,
                },
                {
                    id: id(),
                    type: "image",
                    url: "https://",
                    alt: "Product screenshot",
                    locked: true,
                },
            ],
        }),
    },
    {
        id: "post",
        name: "Blog post",
        description: "Title, date, paragraphs, and an image",
        build: () => ({
            header: "Untitled post",
            subheader: "Draft · today",
            accentColor: "#6b4423",
            background: "#f7f3ed",
            fontFamily: "Georgia, serif",
            blocks: [
                {
                    id: id(),
                    type: "paragraph",
                    text:
                        "Open with the question or observation that pulled you in. " +
                        "Two or three sentences.",
                    locked: true,
                },
                {
                    id: id(),
                    type: "paragraph",
                    text:
                        "Then the body — be specific, name things, link out when it " +
                        "helps the reader.",
                    locked: true,
                },
                { id: id(), type: "divider", locked: true },
                {
                    id: id(),
                    type: "image",
                    url: "https://",
                    alt: "Supporting image",
                    locked: true,
                },
                {
                    id: id(),
                    type: "paragraph",
                    text:
                        "Close with what changed in your thinking and what you'd " +
                        "want a reader to walk away with.",
                    locked: true,
                },
            ],
        }),
    },
    {
        id: "event",
        name: "Event",
        description: "Title, when / where, big RSVP",
        build: () => ({
            header: "Event title",
            subheader: "Saturday · 7pm · A specific place",
            accentColor: "#ff6b9d",
            background: "#2d1f3f",
            fontFamily: "system-ui",
            blocks: [
                {
                    id: id(),
                    type: "paragraph",
                    text:
                        "One paragraph on what the event is. Set expectations: " +
                        "BYO drinks, dress code, what to bring.",
                    locked: true,
                },
                {
                    id: id(),
                    type: "link",
                    variant: "pill",
                    label: "RSVP",
                    url: "mailto:",
                    locked: true,
                },
                {
                    id: id(),
                    type: "image",
                    url: "https://",
                    alt: "Location or theme image",
                    locked: true,
                },
            ],
        }),
    },
];
