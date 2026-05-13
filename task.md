# Gemma 4 ↔ Figma MCP

Build an MCP server that lets **Gemma 4** running in **LM Studio** interact with Figma.

## Goal

Reach feature parity with the official Figma Dev Mode MCP that Claude Code uses, both for read (REST API) and write (in-canvas execution via a companion plugin).

## Stack

- Node.js + TypeScript
- `@modelcontextprotocol/sdk`
- Transport: `stdio`
- Figma REST API (Personal Access Token)
- Companion Figma plugin + WebSocket bridge (phase 3+)

## Phases

| # | Scope | Estimate (h) |
|---|-------|--------------|
| 1 | Scaffolding + REST read tools (`whoami`, `get_file`, `get_metadata`, `get_node`, `get_components`, `get_styles`, `get_comments`, `post_comment`, `get_image`) | 6–8 |
| 2 | Variables + Libraries (REST) | 3–5 |
| 3 | Companion plugin + WebSocket bridge, `use_figma`, `get_screenshot`, `get_design_context` | 10–14 |
| 4 | Write helpers on top of bridge: `create_new_file`, `upload_assets`, node create/edit wrappers | 4–6 |
| 5 | Code Connect tools | 8–12 |
| 6 | Design system + diagrams (`search_design_system`, `create_design_system_rules`, `generate_diagram`, `get_figjam`) | 6–10 |

**Approved scope right now: phase 1 only.**

## Phase 1 tools

| Tool | Endpoint | Notes |
|------|----------|-------|
| `whoami` | `GET /v1/me` | Current user |
| `get_file` | `GET /v1/files/{key}` | Full file tree |
| `get_metadata` | `GET /v1/files/{key}?depth=1` | Top-level structure only |
| `get_node` | `GET /v1/files/{key}/nodes?ids=...` | Specific nodes |
| `get_components` | `GET /v1/files/{key}/components` | Components in file |
| `get_styles` | `GET /v1/files/{key}/styles` | Styles in file |
| `get_comments` | `GET /v1/files/{key}/comments` | Read comments |
| `post_comment` | `POST /v1/files/{key}/comments` | Add a comment |
| `get_image` | `GET /v1/images/{key}?ids=...&format=...&scale=...` | Export PNG/SVG/JPG/PDF |

## Auth

`X-Figma-Token: <PAT>` header. Token stored in local `.env` only — never committed, never pasted in chat.
