# Hermes, step by step: from a clean machine to the first page in Figma

The operational companion to [agency-brutalist-hermes.md](agency-brutalist-hermes.md):
what to install, what to type, in what order, and how to tell it is working.
Windows 11, RTX 5090, Figma desktop. Commands verified against the Hermes
docs on 2026-10-11; if a flag has changed, `hermes --help` wins.

## 1. LM Studio: the model

1. Install LM Studio, download `qwen/qwen3.8-27b` (or `google/gemma-4-31b`).
2. Hermes needs **at least 64k context**, so load the model with 65536, not
   the default:

   ```powershell
   lms server start
   lms load qwen/qwen3.8-27b --context-length 65536 -y
   lms ps          # CONTEXT column must say 65536
   ```

   32k is enough for this server's eval scripts but Hermes refuses smaller
   windows; 65536 with a 27B model fits a 32 GB card with room for the KV cache.
3. Server auth: either disable "require API token" in Developer → Server
   settings, or create a token there and keep it for step 2.
4. Check: `curl http://localhost:1234/v1/models` returns the model id.

If LM Studio was restarted and `lms load` fails with `ENOENT … .internal\temp`,
create the folder `%USERPROFILE%\.lmstudio\.internal\temp` and retry.

## 2. Hermes: install and point it at LM Studio

```powershell
iex (irm https://hermes-agent.nousresearch.com/install.ps1)
hermes model                       # pick provider "LM Studio" and the loaded model
```

If the picker does not list LM Studio, set it by hand:

```powershell
hermes config set model lmstudio/qwen/qwen3.8-27b
hermes config set LM_BASE_URL http://localhost:1234/v1    # goes to ~/.hermes/.env
hermes config set LM_API_KEY <token-or-anything-if-auth-is-off>
```

Smoke test with no tools: `hermes --tui`, type `hi`, get an answer, `/exit`.

## 3. This server

```powershell
git clone <repo> "E:\Projects\gemma 4 figma mcp"
cd "E:\Projects\gemma 4 figma mcp"
npm install; cd plugin; npm install; cd ..
npm run build
copy .env.example .env         # paste FIGMA_TOKEN (REST tools only; canvas works without it)
```

## 4. Figma: the plugin

1. Figma desktop → Plugins → Development → Import plugin from manifest… →
   `plugin\manifest.json`.
2. Plugins → Development → Gemma 4 MCP Bridge. The window shows a red dot
   until a daemon exists; that is fine, the daemon starts with Hermes.
3. After any `npm run build` that touched `plugin\`, re-run the plugin.

## 5. Hermes config: server + skill

Edit `%USERPROFILE%\.hermes\config.yaml` (or `hermes config set` for single
keys). Add:

```yaml
mcp_servers:
  figma:                       # keep this name: tools become mcp_figma_*, skill is gated on mcp-figma
    command: node
    args: ["E:/Projects/gemma 4 figma mcp/dist/server.js"]
    timeout: 120
    tools:
      include: [bridge_status, get_current_page, get_selection, find_nodes, get_screenshot,
                use_figma, create_frame, create_rectangle, create_ellipse, create_text, create_line,
                clone_node, move_node, resize_node, set_fill, set_stroke, set_text, rename_node,
                delete_nodes, set_selection, group_nodes, set_auto_layout,
                get_metadata, get_node, get_components, get_styles, get_image, get_local_variables,
                get_file_component_sets, index_design_system, search_design_system,
                list_workspaces, list_dir, read_text_file, write_text_file, import_image_to_figma,
                create_flowchart, mermaid_to_canvas, create_sticky, create_connector,
                get_node_spec, list_pages, set_current_page, zoom_to,
                list_components, create_instance, get_instance_properties, set_instance_properties,
                swap_instance, create_component, combine_as_variants, detach_instance,
                list_variable_collections, list_variables, create_variable_collection,
                create_variable, set_variable_value, bind_variable, get_variable_defs,
                create_from_svg, insert_icon, search_icons, critique_design, list_critique_rules]

skills:
  external_dirs:
    - "E:/Projects/gemma 4 figma mcp/skills"
```

That `include` is the `design` profile (`scripts/eval/profiles.json`); for
pure canvas work use the shorter `core` list from the README. Leave
`lazy` off for the first run so Hermes caches the tool schemas; you may set
`lazy: true` afterwards.

Verify:

```powershell
hermes mcp test figma          # must list the tools; the first line of the server log
                               # says "bridge daemon autostarted" or "running"
```

In Figma the plugin's dot turns green within two seconds of the daemon
starting.

## 6. First session: prove the chain

```powershell
hermes --tui
```

In the chat:

```
/reload-mcp          (only if you edited config while a session was open)
/tools               → mcp_figma_* entries are listed
Which skills do you have?   → figma-mcp appears in the list
Is Figma connected?         → one mcp_figma_bridge_status call: file name, page, plugin build
Create a 200x100 frame named "Hello" at 0,0 and screenshot it.
```

The last line should be `mcp_figma_create_frame` then
`mcp_figma_get_screenshot`, with the PNG shown in the TUI (Qwen3.8 and Gemma 4
are multimodal; Hermes attaches tool images for vision models). Delete the
frame: `Delete the frame "Hello"`.

## 7. The real session (the agency example)

1. Open a **new** session per project (`hermes --tui` again, or `/new` if
   your version has it). Old context is not useful and costs tokens.
2. Paste **message 0, the brief**, as one message. Multi-line input:
   `Alt+Enter` or `Ctrl+J` between lines, `Enter` to send. Pasting a block
   from the clipboard usually keeps the newlines; check before sending.
3. Send **message 1** (page, fonts, tokens) and wait for the final reply.
   Do not queue the next message while tools are running.
4. Look at Figma, not only at the chat: the WIP page exists, the collection
   "Brutal" shows in the variables panel.
5. Continue with messages 2 → 7 from the example, one at a time. After each
   page build, open the screenshot Hermes attached; if the page drifted
   (rounded cards, shadows, Inter headings), answer with the one-line
   correction from the example and let it redo that page only.
6. Critique step: read the kept/fixed list; disagree in plain words
   ("fix the numbered labels too").
7. `/save` at milestones. `hermes -c` resumes the last session later.

## 8. What happens under the hood (so you can tell drift from failure)

| You see | It means |
|---------|----------|
| Hermes says it loaded the skill `figma-mcp` | the SKILL.md was read; prompts can stay short |
| `mcp_figma_bridge_status` on every message | old skill text; pull the repo, `/reload-mcp` |
| "Bridge daemon not reachable" | daemon died; `bridge_status` restarts it; else `start-bridge.bat`, check `daemon.log` |
| "Figma plugin not connected" | plugin window closed; re-run it, press Reconnect |
| tool result `…[truncated: N more chars]` | response capped at 20k chars; ask for a smaller `max_depth` or specific ids |
| a very long pause then prose, no tool call | the model's output limit was hit while reasoning; raise Hermes's max output tokens |
| context compression notice | Hermes compacted at 50% of the window; repeat the ids you still need in the next message |
| `exceed_context_size_error` | model loaded with a small context; reload with 65536 |

## 9. Daily start, after everything is installed

1. Open Figma, run the plugin.
2. `lms ps` — model loaded with 65536? If not, `lms load … --context-length 65536 -y`.
3. `hermes --tui`, paste the brief or `hermes -c` to continue.

The daemon, the MCP server and the skill take care of themselves.
